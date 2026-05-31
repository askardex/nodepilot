import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * POST /api/validators/[id]/k8s/helm-deploy-stack
 *
 * ONE-CLICK full Canton stack deployment for K8s (DevNet).
 * Mirrors the simplicity of the docker-compose install route.
 *
 * Body: { version?: string, postgresPassword?: string, disableAuth?: boolean }
 *
 * Steps (automatic, no user intervention):
 *   1. SSH Connect
 *   2. Download sample values bundle (from GitHub releases)
 *   3. Create postgres-secrets (if missing)
 *   4. helm install postgres
 *   5. Wait for postgres pod Running
 *   6. helm install participant
 *   7. Wait for participant pod Running
 *   8. Fetch DevNet onboarding secret (from sponsor SV)
 *   9. Create onboarding secret
 *  10. helm install validator
 *  11. Wait for validator pod Running
 *  12. Done
 *
 * Streams SSE: { step, status, message? } and final { done: true, error? }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await request.json().catch(() => ({})) as {
    version?: string
    postgresPassword?: string
    disableAuth?: boolean
    validatorPartyHint?: string
    contactPoint?: string
    walletUserId?: string
  }

  const version = (body.version ?? '0.6.2').trim()
  const postgresPassword = (body.postgresPassword ?? 'cnadmin-splice-' + Date.now()).trim()
  const disableAuth = body.disableAuth !== false // default true for DevNet
  const validatorPartyHint = (body.validatorPartyHint ?? '').trim()
  const contactPoint = (body.contactPoint ?? '').trim()
  let walletUserId = (body.walletUserId ?? '').trim() || (disableAuth ? 'administrator' : '')

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return Response.json({ error: 'invalid version' }, { status: 400 })
  }

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator || validator.deploymentMode !== 'k8s' || !validator.k8sConfig?.kubeconfig) {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  // Auto-fill walletUserId from validatorConfig.walletAdminUser (Keycloak Setup).
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

  const SPONSOR_SV_URL = 'https://sv.sv-1.dev.global.canton.network.sync.global'

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

      try {
        // ─── Step 1: Connect ───────────────────────────────────────────
        send({ step: 'SSH Connect', status: 'running' })
        conn = await sshConnect(validator)
        send({ step: 'SSH Connect', status: 'success', message: `connected to ${validator.host}` })

        // ─── Step 2: Download sample bundle ────────────────────────────
        const bundleDir = `/tmp/splice-node-${version}`
        const bundleUrl = `https://github.com/digital-asset/decentralized-canton-sync/releases/download/v${version}/${version}_splice-node.tar.gz`
        const valuesDir = `${bundleDir}/splice-node/examples/sv-helm`

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

        send({ step: 'Download sample values', status: 'success', message: dlRes.output.includes('CACHED') ? 'cached' : 'downloaded' })

        // ─── Step 3: Create postgres-secrets ───────────────────────────
        send({ step: 'Create postgres-secrets', status: 'running' })

        const b64pw = Buffer.from(postgresPassword, 'utf8').toString('base64')
        const secretRes = await sshExec(conn, withK8sEnv(
          `kubectl get secret postgres-secrets -n ${namespace} >/dev/null 2>&1 && echo EXISTS || ` +
            `(echo '${b64pw}' | base64 -d > /tmp/_pw && ` +
            `kubectl create secret generic postgres-secrets -n ${namespace} --from-file=postgresPassword=/tmp/_pw && ` +
            `rm -f /tmp/_pw && echo CREATED)`
        ))

        if (secretRes.code !== 0) {
          send({ step: 'Create postgres-secrets', status: 'error', message: secretRes.output.slice(-160) })
          throw new Error('failed to create postgres-secrets')
        }

        send({ step: 'Create postgres-secrets', status: 'success', message: secretRes.output.includes('EXISTS') ? 'already exists' : 'created' })

        // ─── Step 4: Install postgres ──────────────────────────────────
        send({ step: 'Install postgres', status: 'running' })

        // Use the official postgres values file + override storage class for k3s
        const pgValuesFile = `${valuesDir}/postgres-values-validator-participant.yaml`
        const pgOverride = `/tmp/nodepilot-pg-override-${Date.now()}.yaml`

        // Write k3s storage override
        await sshExec(conn, `echo 'db:\n  volumeStorageClass: local-path\n  volumeSize: 50Gi\nresources:\n  requests:\n    cpu: 250m\n    memory: 512Mi\n  limits:\n    memory: 4Gi' > ${pgOverride}`)

        // Clear stuck state if any
        await sshExec(conn, withK8sEnv(
          `STATUS=$(helm list -a -n ${namespace} --filter '^postgres$' -o json 2>/dev/null | jq -r '.[0].status // empty'); ` +
            `if [ "$STATUS" = "pending-install" ]; then helm uninstall postgres -n ${namespace} --no-hooks 2>/dev/null; fi; ` +
            `if echo "$STATUS" | grep -q "^pending-"; then helm rollback postgres 0 -n ${namespace} --no-hooks 2>/dev/null; fi; true`
        ))

        const pgInstall = await sshExec(conn, withK8sEnv(
          `helm upgrade --install postgres oci://ghcr.io/digital-asset/decentralized-canton-sync/helm/splice-postgres ` +
            `-n ${namespace} --create-namespace --version ${version} ` +
            `-f ${pgValuesFile} -f ${pgOverride} --wait --timeout 5m`
        ), chunk => send({ log: chunk }))

        await sshExec(conn, `rm -f ${pgOverride}`).catch(() => {})

        if (pgInstall.code !== 0) {
          send({ step: 'Install postgres', status: 'error', message: pgInstall.output.split('\n').slice(-1)[0]?.slice(0, 200) })
          throw new Error('postgres install failed')
        }

        send({ step: 'Install postgres', status: 'success', message: 'deployed' })

        // ─── Step 5: Wait postgres running ─────────────────────────────
        send({ step: 'Wait postgres ready', status: 'running' })
        const pgWait = await waitPodReady(conn, namespace, 'postgres', 120)

        if (!pgWait.ok) {
          send({ step: 'Wait postgres ready', status: 'error', message: pgWait.message })
          throw new Error('postgres pod not ready')
        }

        send({ step: 'Wait postgres ready', status: 'success', message: pgWait.message })

        // ─── Step 6: Install participant ───────────────────────────────
        send({ step: 'Install participant', status: 'running' })

        const partValuesFile = `${valuesDir}/participant-values.yaml`
        const partStandaloneFile = `${valuesDir}/standalone-participant-values.yaml`
        const partOverride = `/tmp/nodepilot-part-override-${Date.now()}.yaml`

        // Write override: disable auth + set migration id to 0 (DevNet)
        const partOverrideContent = disableAuth
          ? 'disableAuth: true'
          : ''

        if (partOverrideContent) {
          await sshExec(conn, `echo '${partOverrideContent}' > ${partOverride}`)
        }

        // Clear stuck state
        await sshExec(conn, withK8sEnv(
          `STATUS=$(helm list -a -n ${namespace} --filter '^participant$' -o json 2>/dev/null | jq -r '.[0].status // empty'); ` +
            `if [ "$STATUS" = "pending-install" ]; then helm uninstall participant -n ${namespace} --no-hooks 2>/dev/null; fi; ` +
            `if echo "$STATUS" | grep -q "^pending-"; then helm rollback participant 0 -n ${namespace} --no-hooks 2>/dev/null; fi; true`
        ))

        const partCmd = [
          `helm upgrade --install participant oci://ghcr.io/digital-asset/decentralized-canton-sync/helm/splice-participant`,
          `-n ${namespace} --create-namespace --version ${version}`,
          `-f ${partValuesFile} -f ${partStandaloneFile}`,
          partOverrideContent ? `-f ${partOverride}` : '',
          `--wait --timeout 5m`
        ].filter(Boolean).join(' ')

        const partInstall = await sshExec(conn, withK8sEnv(partCmd), chunk => send({ log: chunk }))

        if (partOverrideContent) await sshExec(conn, `rm -f ${partOverride}`).catch(() => {})

        if (partInstall.code !== 0) {
          send({ step: 'Install participant', status: 'error', message: partInstall.output.split('\n').slice(-1)[0]?.slice(0, 200) })
          throw new Error('participant install failed')
        }

        send({ step: 'Install participant', status: 'success', message: 'deployed' })

        // ─── Step 7: Wait participant running ──────────────────────────
        send({ step: 'Wait participant ready', status: 'running' })
        const partWait = await waitPodReady(conn, namespace, 'participant', 180)

        if (!partWait.ok) {
          send({ step: 'Wait participant ready', status: 'error', message: partWait.message })
          throw new Error('participant pod not ready')
        }

        send({ step: 'Wait participant ready', status: 'success', message: partWait.message })

        // ─── Step 8: Fetch DevNet onboarding secret ────────────────────
        send({ step: 'Fetch onboarding secret', status: 'running', message: 'DevNet auto-provision' })

        const obRes = await sshExec(conn,
          `curl -sfS -X POST '${SPONSOR_SV_URL}/api/sv/v0/devnet/onboard/validator/prepare' --max-time 30`
        )

        if (obRes.code !== 0 || !obRes.output.trim()) {
          send({ step: 'Fetch onboarding secret', status: 'error', message: obRes.output.slice(-160) || 'empty response' })
          throw new Error('failed to fetch onboarding secret from sponsor SV')
        }

        const rawOnboarding = obRes.output.trim().replace(/^"|"$/g, '') // strip JSON quotes if present

        // The response is base64-encoded JSON: {"sponsoringSv":"...","secret":"...","partyHint":null}
        // Decode and extract just the `secret` field — that's what the Helm chart's env var expects.
        let onboardingSecretValue: string

        try {
          const decoded = Buffer.from(rawOnboarding, 'base64').toString('utf8')
          const parsed = JSON.parse(decoded)

          onboardingSecretValue = parsed.secret

          if (!onboardingSecretValue) throw new Error('missing secret field')
        } catch {
          // Fallback: treat the raw response as the secret itself
          onboardingSecretValue = rawOnboarding
        }

        send({ step: 'Fetch onboarding secret', status: 'success', message: 'received' })

        // ─── Step 9: Create onboarding k8s secret ──────────────────────
        send({ step: 'Create onboarding secret', status: 'running' })

        const obSecRes = await sshExec(conn, withK8sEnv(
          `kubectl delete secret splice-app-validator-onboarding-validator -n ${namespace} --ignore-not-found && ` +
            `kubectl create secret generic splice-app-validator-onboarding-validator -n ${namespace} ` +
            `--from-literal=secret='${onboardingSecretValue.replace(/'/g, "'\\'")}'`
        ))

        if (obSecRes.code !== 0) {
          send({ step: 'Create onboarding secret', status: 'error', message: obSecRes.output.slice(-160) })
          throw new Error('failed to create onboarding secret')
        }

        send({ step: 'Create onboarding secret', status: 'success' })

        // ─── Step 10: Install validator ────────────────────────────────
        send({ step: 'Install validator', status: 'running' })

        const valValuesFile = `${valuesDir}/validator-values.yaml`
        const valStandaloneFile = `${valuesDir}/standalone-validator-values.yaml`
        const valOverride = `/tmp/nodepilot-val-override-${Date.now()}.yaml`

        // Replace placeholders in sample values files so Helm doesn't error on
        // unresolved YAML template variables. Same sed expressions as helm-install-validator.
        const scanUrl = 'https://scan.sv-1.dev.global.canton.network.digitalasset.com'
        const seqUrl = 'https://sequencer-1.sv-1.dev.global.canton.network.digitalasset.com:443'

        const sedExpr = [
          `-e 's/MIGRATION_ID/1/g'`,
          `-e 's|SPONSOR_SV_URL|${SPONSOR_SV_URL}|g'`,
          `-e 's|YOUR_CONTACT_POINT|${contactPoint || 'admin@example.com'}|g'`,
          `-e 's|YOUR_CONTACT_EMAIL|${contactPoint || 'admin@example.com'}|g'`,
          `-e 's|SCAN_URL|${scanUrl}|g'`,
          `-e 's|YOUR_SCAN_ADDRESS|${scanUrl}|g'`,
          `-e 's|TRUSTED_SYNCHRONIZER_SEQUENCER_URL|${seqUrl}|g'`,
          `-e 's|YOUR_SEQUENCER_URL|${seqUrl}|g'`,
          `-e 's|YOUR_VALIDATOR_PARTY_HINT|${validatorPartyHint || 'validator-1'}|g'`,
          `-e 's|YOUR_VALIDATOR_NODE_NAME|${validatorPartyHint || 'validator-1'}|g'`,
          walletUserId ? `-e 's|OPERATOR_WALLET_USER_ID|${walletUserId}|g'` : '',
        ].filter(Boolean).join(' ')

        const proc1 = `/tmp/nodepilot-val1-${Date.now()}.yaml`
        const proc2 = `/tmp/nodepilot-val2-${Date.now()}.yaml`

        await sshExec(conn, `sed ${sedExpr} < ${valValuesFile} > ${proc1} && sed ${sedExpr} < ${valStandaloneFile} > ${proc2}`)

        // Clear stuck state + stale PVCs
        await sshExec(conn, withK8sEnv(
          `STATUS=$(helm list -a -n ${namespace} --filter '^validator$' -o json 2>/dev/null | jq -r '.[0].status // empty'); ` +
            `if [ "$STATUS" = "pending-install" ]; then helm uninstall validator -n ${namespace} --no-hooks 2>/dev/null; fi; ` +
            `if echo "$STATUS" | grep -q "^pending-"; then helm rollback validator 0 -n ${namespace} --no-hooks 2>/dev/null; fi; ` +
            // Force-remove domain-migration PVC: clear finalizers first to prevent Terminating stuck state
            `kubectl patch pvc domain-migration-validator-pvc -n ${namespace} -p '{"metadata":{"finalizers":null}}' 2>/dev/null || true; ` +
            `kubectl delete pvc domain-migration-validator-pvc -n ${namespace} --ignore-not-found 2>/dev/null || true; true`
        ))

        // Build --set flags matching helm-install-validator route
        const setFlags = [
          validatorPartyHint ? `--set "validatorPartyHint=${validatorPartyHint}"` : '',
          contactPoint ? `--set "contactPoint=${contactPoint}"` : '',
          `--set "migration.id=1"`,
          `--set "sponsorSvUrl=${SPONSOR_SV_URL}"`,
          `--set "sequencerAddress=https://sequencer-1.sv-1.dev.global.canton.network.digitalasset.com:443"`,
          `--set "spliceInstanceNames.networkName=Canton Network"`,
          `--set "spliceInstanceNames.amuletName=Canton Coin"`,
          `--set "spliceInstanceNames.amuletNameAcronym=CC"`,
          `--set "spliceInstanceNames.nameServiceName=Canton Name Service"`,
          `--set "spliceInstanceNames.nameServiceNameAcronym=CNS"`,
          `--set "persistence.host=splice-postgres"`,
          `--set "persistence.storageClass=local-path"`,
          `--set "pvc.volumeStorageClass=local-path"`,
          `--set resources.requests.cpu=250m`,
          `--set resources.requests.memory=1Gi`,
          `--set resources.limits.cpu=2`,
          `--set resources.limits.memory=4Gi`,
        ].filter(Boolean).join(' ')

        // Override YAML for scanClient + wallet users
        const valOverrideParts: string[] = []

        if (disableAuth) valOverrideParts.push('disableAuth: true')

        valOverrideParts.push(
          'scanClient:',
          '  scanType: trust-single',
          `  scanAddress: "https://scan.sv-1.dev.global.canton.network.digitalasset.com"`,
        )

        if (walletUserId) {
          valOverrideParts.push(
            'validatorWalletUsers:',
            `  - "${walletUserId}"`,
          )
        }

        const valOverrideYaml = valOverrideParts.join('\n')
        const valOverrideB64 = Buffer.from(valOverrideYaml, 'utf8').toString('base64')

        await sshExec(conn, `echo '${valOverrideB64}' | base64 -d > ${valOverride}`)

        const valCmd = [
          `helm upgrade --install validator oci://ghcr.io/digital-asset/decentralized-canton-sync/helm/splice-validator`,
          `-n ${namespace} --create-namespace --version ${version}`,
          `-f ${proc1} -f ${proc2} -f ${valOverride}`,
          setFlags,
          `--timeout 18m`
        ].filter(Boolean).join(' ')

        const valInstall = await sshExec(conn, withK8sEnv(valCmd), chunk => send({ log: chunk }), 20 * 60_000)

        await sshExec(conn, `rm -f ${valOverride} ${proc1} ${proc2}`).catch(() => {})

        if (valInstall.code !== 0) {
          send({ step: 'Install validator', status: 'error', message: valInstall.output.split('\n').slice(-1)[0]?.slice(0, 200) })
          throw new Error('validator install failed')
        }

        send({ step: 'Install validator', status: 'success', message: 'deployed' })

        // ─── Step 11: Wait validator running ───────────────────────────
        // DevNet onboarding can take a very long time (topology BFT processing across
        // 13 sequencers). Use a generous timeout — the pod will keep retrying.
        send({ step: 'Wait validator ready', status: 'running' })
        const valWait = await waitPodReady(conn, namespace, 'validator-app', 600)

        send({
          step: 'Wait validator ready',
          status: valWait.ok ? 'success' : 'error',
          message: valWait.message
        })

        // ─── Done ──────────────────────────────────────────────────────
        send({ done: true })
      } catch (err) {
        send({ done: true, error: err instanceof Error ? err.message : String(err) })
      } finally {
        conn?.end()
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  })
}

// ── Helper: wait for pods with a label to become Running ────────────────────
async function waitPodReady(
  conn: Awaited<ReturnType<typeof sshConnect>>,
  namespace: string,
  instance: string,
  timeoutSec: number
): Promise<{ ok: boolean; message: string }> {
  const deadline = Date.now() + timeoutSec * 1000

  while (Date.now() < deadline) {
    const res = await sshExec(
      conn,
      withK8sEnv(
        `kubectl get pods -n ${namespace} -l app.kubernetes.io/instance=${instance} --no-headers 2>/dev/null`
      )
    )

    if (res.code === 0) {
      const lines = res.output.split('\n').filter(Boolean)
      const running = lines.filter(l => /\s+Running\s+/.test(l) || /\s1\/1\s+Running/.test(l))

      if (running.length > 0 && running.length === lines.length) {
        return { ok: true, message: `${running.length}/${lines.length} Running` }
      }
    }

    await new Promise(r => setTimeout(r, 5000))
  }

  return { ok: false, message: `timeout after ${timeoutSec}s` }
}
