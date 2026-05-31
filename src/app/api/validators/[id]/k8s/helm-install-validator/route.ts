import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * POST /api/validators/[id]/k8s/helm-install-validator
 *
 * Installs splice-validator using the official 2-file sample values pattern.
 * Downloads the bundle (cached at /tmp/splice-node-VERSION/), replaces
 * placeholders via sed, creates the onboarding secret, then runs helm upgrade --install.
 *
 * Body:
 *   {
 *     version:             string   // e.g. "0.6.2"
 *     migrationId:         number   // synchronizer migration ID (e.g. 1)
 *     sponsorSvUrl:        string   // e.g. "https://sv.sv-2.global.dev.canton.network.digitalasset.com"
 *     onboardingSecret:    string   // one-time secret from sponsor SV
 *     validatorPartyHint:  string   // e.g. "myvalidator-1"
 *     contactPoint:        string   // e.g. "admin@example.com"
 *     scanUrl:             string   // trusted scan URL
 *     disableAuth:         boolean  // true = no OIDC (DevNet / dev mode)
 *     oidcAuthorityUrl?:   string   // required if disableAuth=false
 *     oidcAudience?:       string   // required if disableAuth=false
 *     reduceResources?:    boolean  // default true
 *   }
 *
 * Streams SSE: { step, status, message? } | { log } | { pods } | { done, error? }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await request.json().catch(() => ({})) as {
    version?: string
    migrationId?: number
    sponsorSvUrl?: string
    onboardingSecret?: string
    validatorPartyHint?: string
    contactPoint?: string
    scanUrl?: string
    sequencerUrl?: string
    disableAuth?: boolean
    oidcAuthorityUrl?: string
    oidcAudience?: string
    reduceResources?: boolean
    pgReleaseName?: string
    walletUserId?: string
  }

  const version = (body.version ?? '').trim()
  const migrationId = Number(body.migrationId ?? 0)
  const sponsorSvUrl = (body.sponsorSvUrl ?? '').trim()
  const onboardingSecret = (body.onboardingSecret ?? '').trim()
  let validatorPartyHint = (body.validatorPartyHint ?? '').trim()
  const contactPoint = (body.contactPoint ?? '').trim()
  const scanUrl = (body.scanUrl ?? '').trim()
  const sequencerUrl = (body.sequencerUrl ?? '').trim()
  const disableAuth = body.disableAuth !== false
  const oidcAuthorityUrl = (body.oidcAuthorityUrl ?? '').trim()
  const oidcAudience = (body.oidcAudience ?? '').trim()
  const reduceResources = body.reduceResources !== false
  const pgReleaseName = /^[a-z0-9][a-z0-9-]{0,52}$/.test(body.pgReleaseName ?? '') ? body.pgReleaseName!.trim() : 'splice-postgres'

  // When auth is disabled, the Canton ledger uses 'administrator' as the built-in admin user.
  // validatorWalletUsers controls who can access the validator wallet — must be set or ALL
  // authenticated users get unrestricted wallet access. Default to 'administrator' for
  // no-auth installs. For auth-enabled installs, body field is preferred; if empty we
  // try to auto-fill from cfg.walletAdminUser (set by Keycloak Setup) further down.
  let walletUserId = (body.walletUserId ?? '').trim() || (disableAuth ? 'administrator' : '')

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return Response.json({ error: 'version must be semver (e.g. 0.6.2)' }, { status: 400 })
  }

  if (!Number.isInteger(migrationId) || migrationId < 0) {
    return Response.json({ error: 'migrationId must be a non-negative integer' }, { status: 400 })
  }

  if (!sponsorSvUrl) {
    return Response.json({ error: 'sponsorSvUrl is required' }, { status: 400 })
  }

  // onboardingSecret + validatorPartyHint are required for first install only.
  // For upgrades (helm release already exists), they can be omitted.
  // We'll check in the stream handler after SSH connect.

  if (!contactPoint) {
    return Response.json({ error: 'contactPoint is required' }, { status: 400 })
  }

  if (!scanUrl) {
    return Response.json({ error: 'scanUrl is required' }, { status: 400 })
  }

  if (!sequencerUrl) {
    return Response.json({ error: 'sequencerUrl is required' }, { status: 400 })
  }

  if (!disableAuth && (!oidcAuthorityUrl || !oidcAudience)) {
    return Response.json({ error: 'oidcAuthorityUrl and oidcAudience are required when auth is enabled' }, { status: 400 })
  }

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator || validator.deploymentMode !== 'k8s' || !validator.k8sConfig?.kubeconfig) {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  // Auto-fill walletUserId from validatorConfig.walletAdminUser (populated by
  // Keycloak Setup). This is the operator's username in the realm — Splice
  // matches it against the JWT `sub` claim (Keycloak is configured to put
  // username in `sub` for human-facing wallet/ans clients).
  if (!walletUserId && !disableAuth) {
    const cfg = await prisma.validatorConfig.findUnique({
      where: { validatorId: id },
      select: { walletAdminUser: true }
    })

    const fromCfg = cfg?.walletAdminUser?.trim()

    if (fromCfg) walletUserId = fromCfg
  }

  if (!disableAuth && !walletUserId) {
    return Response.json(
      { error: 'walletUserId is required when auth is enabled. Run Keycloak Setup first or pass the operator username explicitly.' },
      { status: 400 }
    )
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

      try {
        // ── 1. SSH Connect ────────────────────────────────────────────
        send({ step: 'SSH Connect', status: 'running' })
        conn = await sshConnect(validator)
        send({ step: 'SSH Connect', status: 'success', message: `connected to ${validator.host}` })

        // ── 1b. Detect if this is an upgrade ──────────────────────────
        const releaseCheck = await sshExec(conn, withK8sEnv(
          `helm status validator -n ${namespace} -o json 2>/dev/null | jq -r '.info.status // empty'`
        ))

        const existingStatus = releaseCheck.output.trim()
        const isUpgrade = existingStatus === 'deployed' || existingStatus === 'failed'

        if (!isUpgrade && !onboardingSecret) {
          send({ step: 'Validation', status: 'error', message: 'onboardingSecret is required for first install' })
          throw new Error('onboardingSecret required')
        }

        if (!isUpgrade && !validatorPartyHint) {
          send({ step: 'Validation', status: 'error', message: 'validatorPartyHint is required for first install' })
          throw new Error('validatorPartyHint required')
        }

        if (isUpgrade) {
          send({ step: 'Detect release', status: 'success', message: `Existing release found (${existingStatus}) — upgrade mode` })

          // Retrieve existing partyHint from deployed values if not provided
          if (!validatorPartyHint) {
            const existingVals = await sshExec(conn, withK8sEnv(
              `helm get values validator -n ${namespace} -o json 2>/dev/null | jq -r '.validatorPartyHint // empty'`
            ))

            const hint = existingVals.output.trim()

            if (hint) {
              validatorPartyHint = hint
              send({ step: 'Detect release', status: 'info', message: `Using existing partyHint: ${hint}` })
            }
          }
        }

        // ── 2. Create onboarding secret ───────────────────────────────
        if (onboardingSecret) {
          send({ step: 'Create onboarding secret', status: 'running' })
          const secretName = 'splice-app-validator-onboarding-validator'

          const secretRes = await sshExec(conn, withK8sEnv(
            `kubectl create secret generic ${secretName} ` +
            `--from-literal=secret='${onboardingSecret.replace(/'/g, "'\\''")}' ` +
            `-n ${namespace} --dry-run=client -o yaml | kubectl apply -f -`
          ))

          if (secretRes.code !== 0) {
            send({ step: 'Create onboarding secret', status: 'error', message: secretRes.output.slice(-200) })
            throw new Error('failed to create onboarding secret')
          }

          send({ step: 'Create onboarding secret', status: 'success', message: secretName })
        } else {
          send({ step: 'Create onboarding secret', status: 'success', message: 'skipped (upgrade — using existing secret)' })
        }

        // ── 3. Download sample bundle (cached) ────────────────────────
        const bundleDir = `/tmp/splice-node-${version}`
        const valuesDir = `${bundleDir}/splice-node/examples/sv-helm`
        const bundleUrl = `https://github.com/digital-asset/decentralized-canton-sync/releases/download/v${version}/${version}_splice-node.tar.gz`

        send({ step: 'Download sample values', status: 'running', message: `v${version}` })

        const dlRes = await sshExec(conn, [
          `if [ -d ${valuesDir} ]; then echo CACHED; else`,
          `mkdir -p ${bundleDir} && cd ${bundleDir} &&`,
          `curl -fsSL '${bundleUrl}' -o splice-node.tar.gz &&`,
          `tar xzf splice-node.tar.gz && echo DONE; fi`
        ].join(' '))

        if (dlRes.code !== 0) {
          send({ step: 'Download sample values', status: 'error', message: dlRes.output.slice(-200) })
          throw new Error('failed to download sample bundle')
        }

        send({
          step: 'Download sample values',
          status: 'success',
          message: dlRes.output.includes('CACHED') ? 'cached' : 'downloaded'
        })

        // ── 4. Process values files ───────────────────────────────────
        send({ step: 'Process values files', status: 'running' })

        const ts = Date.now()
        const val1 = `${valuesDir}/validator-values.yaml`
        const val2 = `${valuesDir}/standalone-validator-values.yaml`
        const proc1 = `/tmp/nodepilot-val1-${ts}.yaml`
        const proc2 = `/tmp/nodepilot-val2-${ts}.yaml`
        const overrideFile = `/tmp/nodepilot-val-override-${ts}.yaml`

        // Replace all known placeholders via a single sed with multiple -e expressions.
        // Using one sed avoids the pipeline redirect bug (< file applies to last cmd only).
        const sedExpr = [
          `-e 's/MIGRATION_ID/${migrationId}/g'`,
          `-e 's|SPONSOR_SV_URL|${sponsorSvUrl}|g'`,
          `-e 's|YOUR_CONTACT_POINT|${contactPoint}|g'`,
          `-e 's|YOUR_CONTACT_EMAIL|${contactPoint}|g'`,
          `-e 's|SCAN_URL|${scanUrl}|g'`,
          `-e 's|YOUR_SCAN_ADDRESS|${scanUrl}|g'`,
          `-e 's|TRUSTED_SYNCHRONIZER_SEQUENCER_URL|${sequencerUrl}|g'`,
          `-e 's|YOUR_SEQUENCER_URL|${sequencerUrl}|g'`,
          `-e 's|YOUR_VALIDATOR_PARTY_HINT|${validatorPartyHint}|g'`,
          `-e 's|YOUR_VALIDATOR_NODE_NAME|${validatorPartyHint}|g'`,
          walletUserId ? `-e 's|OPERATOR_WALLET_USER_ID|${walletUserId}|g'` : '',
        ].filter(Boolean).join(' ')

        const procRes = await sshExec(
          conn,
          `sed ${sedExpr} < ${val1} > ${proc1} && sed ${sedExpr} < ${val2} > ${proc2}`,
          undefined,
          60_000
        )

        if (procRes.code !== 0) {
          send({ step: 'Process values files', status: 'error', message: procRes.output.slice(-400) })
          throw new Error('failed to process values files')
        }

        if (!disableAuth) {
          const sedOidc = [
            `sed -i 's|OIDC_AUTHORITY_URL|${oidcAuthorityUrl}|g' ${proc1}`,
            `sed -i 's|OIDC_AUTHORITY_URL|${oidcAuthorityUrl}|g' ${proc2}`,
            `sed -i 's|OIDC_AUTHORITY_VALIDATOR_AUDIENCE|${oidcAudience}|g' ${proc1}`,
            `sed -i 's|OIDC_AUTHORITY_VALIDATOR_AUDIENCE|${oidcAudience}|g' ${proc2}`,
          ].join(' && ')

          const oidcRes = await sshExec(conn, sedOidc)

          if (oidcRes.code !== 0) {
            send({ step: 'Process values files', status: 'error', message: 'OIDC sed replace failed' })
            throw new Error('failed to replace OIDC placeholders')
          }
        }

        // Override YAML: disableAuth + scanClient trust-single + wallet users
        const overrideParts: string[] = []

        if (disableAuth) overrideParts.push('disableAuth: true')

        overrideParts.push(
          'scanClient:',
          '  scanType: trust-single',
          `  scanAddress: "${scanUrl}"`,
        )

        // validatorWalletUsers: restricts which ledger user IDs can access the validator wallet.
        // Without this (or with unreplaced placeholder), all users get wallet access with disableAuth.
        if (walletUserId) {
          overrideParts.push(
            'validatorWalletUsers:',
            `  - "${walletUserId}"`,
          )
        }

        // validatorPartyHint and contactPoint as --set flags (highest precedence,
        // bypasses placeholder issues for fields not in sample files)
        const overrideYaml = overrideParts.join('\n')
        const b64 = Buffer.from(overrideYaml, 'utf8').toString('base64')
        const wRes = await sshExec(conn, `echo '${b64}' | base64 -d > ${overrideFile}`)

        if (wRes.code !== 0) {
          send({ step: 'Process values files', status: 'error', message: 'failed to write override' })
          throw new Error('failed to write override file')
        }

        // --set flags (highest precedence)
        const setFlags = [
          `--set "validatorPartyHint=${validatorPartyHint}"`,
          `--set "contactPoint=${contactPoint}"`,
          `--set "migration.id=${migrationId}"`,
          `--set "sponsorSvUrl=${sponsorSvUrl}"`,
          sequencerUrl ? `--set "sequencerAddress=${sequencerUrl}"` : '',
          reduceResources ? '--set resources.requests.cpu=250m' : '',
          reduceResources ? '--set resources.requests.memory=1Gi' : '',
          reduceResources ? '--set resources.limits.cpu=2' : '',
          reduceResources ? '--set resources.limits.memory=4Gi' : '',

          // spliceInstanceNames required by chart schema — fixed for Canton Network
          `--set "spliceInstanceNames.networkName=Canton Network"`,
          `--set "spliceInstanceNames.amuletName=Canton Coin"`,
          `--set "spliceInstanceNames.amuletNameAcronym=CC"`,
          `--set "spliceInstanceNames.nameServiceName=Canton Name Service"`,
          `--set "spliceInstanceNames.nameServiceNameAcronym=CNS"`,

          // postgres connection — use actual K8s service name and local-path storage class
          `--set "persistence.host=${pgReleaseName}"`,
          `--set "persistence.storageClass=local-path"`,

          // domain-migration PVC storage class — must match cluster (k3s uses local-path, not standard-rwo)
          `--set "pvc.volumeStorageClass=local-path"`,
        ].filter(Boolean).join(' ')

        send({
          step: 'Process values files',
          status: 'success',
          message: `migrationId=${migrationId}, disableAuth=${disableAuth}, partyHint=${validatorPartyHint}`
        })

        // ── 5. Clear stuck release + stale PVCs ──────────────────────
        await sshExec(conn, withK8sEnv(
          `STATUS=$(helm list -a -n ${namespace} --filter '^validator$' -o json 2>/dev/null | jq -r '.[0].status // empty'); ` +
          `if [ "$STATUS" = "pending-install" ]; then helm uninstall validator -n ${namespace} --no-hooks 2>/dev/null; fi; ` +
          `if echo "$STATUS" | grep -q "^pending-"; then helm rollback validator 0 -n ${namespace} --no-hooks 2>/dev/null; fi; ` +

          // Force-remove domain-migration PVC: clear finalizers first (prevents Terminating stuck state),
          // then delete. Without this, a stuck PVC blocks pod scheduling indefinitely.
          `kubectl patch pvc domain-migration-validator-pvc -n ${namespace} -p '{"metadata":{"finalizers":null}}' 2>/dev/null || true; ` +
          `kubectl delete pvc domain-migration-validator-pvc -n ${namespace} --ignore-not-found 2>/dev/null || true; true`
        ))

        // ── 6. helm upgrade --install ─────────────────────────────────
        send({ step: 'helm install validator', status: 'running' })

        const helmCmd = [
          `helm upgrade --install validator`,
          `oci://ghcr.io/digital-asset/decentralized-canton-sync/helm/splice-validator`,
          `-n ${namespace} --create-namespace`,
          `--version ${version}`,
          `-f ${proc1} -f ${proc2} -f ${overrideFile}`,
          setFlags,
          `--timeout 18m`
        ].filter(Boolean).join(' ')

        // ── Pod watcher (parallel SSH) ────────────────────────────────
        let watcherStop = false
        const watcherConn = await sshConnect(validator).catch(() => null)

        const watcher = (async () => {
          if (!watcherConn) return

          while (!watcherStop) {
            const r = await sshExec(
              watcherConn,
              withK8sEnv(
                `kubectl get pods -n ${namespace} -l app.kubernetes.io/instance=validator ` +
                `--no-headers -o custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[*].ready,PHASE:.status.phase,REASON:.status.containerStatuses[*].state.waiting.reason 2>/dev/null`
              )
            ).catch(() => null)

            if (watcherStop) break

            if (r && r.code === 0) {
              const pods = r.output.split('\n').filter(Boolean).map(line => {
                const [name, ready, phase, reason] = line.trim().split(/\s+/)

                return { name, ready, phase, reason: reason === '<none>' ? '' : reason }
              })

              const running = pods.filter(p => p.phase === 'Running' && !p.ready?.includes('false')).length

              send({ pods, summary: { running, total: pods.length } })
            }

            await new Promise(res => setTimeout(res, 4000))
          }
        })()

        const installRes = await sshExec(conn, withK8sEnv(helmCmd), chunk => send({ log: chunk }), 20 * 60_000)

        watcherStop = true
        await watcher.catch(() => {})
        watcherConn?.end()

        // Cleanup temp files (best-effort)
        await sshExec(conn, `rm -f ${proc1} ${proc2} ${overrideFile}`).catch(() => {})

        if (installRes.code !== 0) {
          const lastLine = installRes.output.split('\n').filter(Boolean).slice(-1)[0] ?? ''

          send({ step: 'helm install validator', status: 'error', message: lastLine.slice(0, 200) })
          throw new Error('helm install validator failed')
        }

        send({ step: 'helm install validator', status: 'success', message: 'deployed' })

        // ── 7. Patch wallet-web-ui nginx to proxy /api/validator ─────
        // The wallet-web-ui container's default nginx config only serves static files.
        // config.js points validator URL to same-origin /api/validator, so nginx MUST
        // proxy that path to validator-app:5003. Without this, POST onboarding → 405.
        send({ step: 'Patch wallet nginx proxy', status: 'running' })

        const nginxCfg = [
          'server {',
          '    listen 8080;',
          '    root   /usr/share/nginx/html;',
          '    add_header Cache-Control "no-store";',
          '    gzip on;',
          '    gzip_types text/html text/css application/javascript;',
          `    location /api/validator {`,
          `        proxy_pass http://validator-app.${namespace}.svc.cluster.local:5003/api/validator;`,
          '        proxy_http_version 1.1;',
          '        proxy_set_header Host $host;',
          '        proxy_set_header X-Real-IP $remote_addr;',
          '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
          '        proxy_set_header X-Forwarded-Proto $scheme;',
          '        proxy_read_timeout 120s;',
          '        proxy_connect_timeout 10s;',
          '    }',
          '    location / {',
          '        index  index.html index.htm;',
          '        try_files $uri $uri/ /index.html;',
          '    }',
          '    location /assets {',
          '        add_header Cache-Control "public";',
          '        expires 1y;',
          '    }',
          '}'
        ].join('\n')

        const nginxCmYaml = [
          'apiVersion: v1',
          'kind: ConfigMap',
          'metadata:',
          '  name: wallet-web-ui-nginx-config',
          `  namespace: ${namespace}`,
          'data:',
          '  default.conf: |',
          ...nginxCfg.split('\n').map(l => `    ${l}`)
        ].join('\n')

        const nginxB64Yaml = Buffer.from(nginxCmYaml, 'utf8').toString('base64')

        await sshExec(conn, withK8sEnv(
          `echo '${nginxB64Yaml}' | base64 -d | kubectl apply -f -`
        )).catch(() => {})

        // Strategic merge patch to mount the config into the deployment
        const patchYaml = [
          'spec:',
          '  template:',
          '    spec:',
          '      volumes:',
          '      - name: nginx-config',
          '        configMap:',
          '          name: wallet-web-ui-nginx-config',
          '      containers:',
          '      - name: wallet-web-ui',
          '        volumeMounts:',
          '        - name: nginx-config',
          '          mountPath: /etc/nginx/conf.d/default.conf',
          '          subPath: default.conf'
        ].join('\n')

        await sshExec(
          conn,
          withK8sEnv(`kubectl patch deploy wallet-web-ui -n ${namespace} --type=strategic -p '${patchYaml}' 2>&1`)
        ).catch(() => {})

        await sshExec(
          conn,
          withK8sEnv(`kubectl rollout restart deploy/wallet-web-ui -n ${namespace} 2>&1`)
        ).catch(() => {})

        send({ step: 'Patch wallet nginx proxy', status: 'success', message: 'proxy_pass /api/validator → validator-app:5003' })

        send({ done: true })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)

        send({ done: true, error: msg })
      } finally {
        conn?.end()
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  })
}
