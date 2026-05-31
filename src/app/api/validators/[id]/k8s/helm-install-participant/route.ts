import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * POST /api/validators/[id]/k8s/helm-install-participant
 *
 * Installs splice-participant using the official 2-file sample values pattern.
 * Downloads the bundle (cached at /tmp/splice-node-VERSION/), replaces
 * placeholders via sed, then runs helm upgrade --install.
 *
 * Body:
 *   {
 *     version:              string   // e.g. "0.6.2"
 *     migrationId:          number   // synchronizer migration ID (e.g. 0)
 *     disableAuth:          boolean  // true = no OIDC (DevNet / dev mode)
 *     oidcAuthorityUrl?:    string   // required if disableAuth=false
 *     oidcLedgerApiAudience?: string // required if disableAuth=false
 *   }
 *
 * Streams SSE: { step, status, message? } | { log } | { done, error? }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await request.json().catch(() => ({})) as {
    version?: string
    migrationId?: number
    disableAuth?: boolean
    oidcAuthorityUrl?: string
    oidcLedgerApiAudience?: string
    reduceResources?: boolean
    postgresReleaseName?: string
  }

  const version = (body.version ?? '').trim()
  const migrationId = Number(body.migrationId ?? 0)
  const disableAuth = body.disableAuth !== false
  const oidcAuthorityUrl = (body.oidcAuthorityUrl ?? '').trim()
  const oidcLedgerApiAudience = (body.oidcLedgerApiAudience ?? '').trim()
  const reduceResources = body.reduceResources !== false // default true

  // postgresReleaseName determines the K8s service name for postgres.
  // Must match the Helm release name used when installing splice-postgres
  // (default 'splice-postgres' → service 'splice-postgres').
  const postgresReleaseName = /^[a-z0-9][a-z0-9-]{0,52}$/.test(body.postgresReleaseName ?? '')
    ? body.postgresReleaseName!.trim()
    : 'splice-postgres'

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return Response.json({ error: 'version must be semver (e.g. 0.6.2)' }, { status: 400 })
  }

  if (!Number.isInteger(migrationId) || migrationId < 0) {
    return Response.json({ error: 'migrationId must be a non-negative integer' }, { status: 400 })
  }

  if (!disableAuth && (!oidcAuthorityUrl || !oidcLedgerApiAudience)) {
    return Response.json({ error: 'oidcAuthorityUrl and oidcLedgerApiAudience are required when auth is enabled' }, { status: 400 })
  }

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator || validator.deploymentMode !== 'k8s' || !validator.k8sConfig?.kubeconfig) {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

      try {
        // ── 1. SSH Connect ─────────────────────────────────────────────
        send({ step: 'SSH Connect', status: 'running' })
        conn = await sshConnect(validator)
        send({ step: 'SSH Connect', status: 'success', message: `connected to ${validator.host}` })

        // ── 2. Download sample bundle (cached) ─────────────────────────
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

        // ── 3. Build processed values files (sed replace placeholders) ──
        send({ step: 'Process values files', status: 'running' })

        const ts = Date.now()
        const part1 = `${valuesDir}/participant-values.yaml`
        const part2 = `${valuesDir}/standalone-participant-values.yaml`
        const proc1 = `/tmp/nodepilot-part1-${ts}.yaml`
        const proc2 = `/tmp/nodepilot-part2-${ts}.yaml`
        const overrideFile = `/tmp/nodepilot-part-override-${ts}.yaml`

        // Replace MIGRATION_ID in both files
        const sedMigration = `sed 's/MIGRATION_ID/${migrationId}/g'`

        const proc1Res = await sshExec(conn, `${sedMigration} < ${part1} > ${proc1}`)
        const proc2Res = await sshExec(conn, `${sedMigration} < ${part2} > ${proc2}`)

        if (proc1Res.code !== 0 || proc2Res.code !== 0) {
          send({ step: 'Process values files', status: 'error', message: 'sed replace failed' })
          throw new Error('failed to process values files')
        }

        // Replace OIDC placeholders if auth is enabled
        if (!disableAuth) {
          const sedOidc = [
            `sed -i 's|OIDC_AUTHORITY_URL|${oidcAuthorityUrl}|g' ${proc1}`,
            `sed -i 's|OIDC_AUTHORITY_URL|${oidcAuthorityUrl}|g' ${proc2}`,
            `sed -i 's|OIDC_AUTHORITY_LEDGER_API_AUDIENCE|${oidcLedgerApiAudience}|g' ${proc1}`,
            `sed -i 's|OIDC_AUTHORITY_LEDGER_API_AUDIENCE|${oidcLedgerApiAudience}|g' ${proc2}`,
          ].join(' && ')

          const oidcRes = await sshExec(conn, sedOidc)

          if (oidcRes.code !== 0) {
            send({ step: 'Process values files', status: 'error', message: 'OIDC sed replace failed' })
            throw new Error('failed to replace OIDC placeholders')
          }
        }

        // Build override YAML: disableAuth only (via -f file)
        // Resources are overridden via --set which has highest helm precedence
        // and is immune to nested-key mismatches in the values files.
        const overrideParts: string[] = []

        if (disableAuth) overrideParts.push('disableAuth: true')

        const overrideYaml = overrideParts.join('\n')

        if (overrideYaml) {
          const b64 = Buffer.from(overrideYaml, 'utf8').toString('base64')
          const wRes = await sshExec(conn, `echo '${b64}' | base64 -d > ${overrideFile}`)

          if (wRes.code !== 0) {
            send({ step: 'Process values files', status: 'error', message: 'failed to write override' })
            throw new Error('failed to write override file')
          }
        }

        // --set flags for resource reduction (highest precedence, beats any values file)
        const resourceSetFlags = reduceResources
          ? [
              '--set resources.requests.cpu=250m',
              '--set resources.requests.memory=1Gi',
              '--set resources.limits.cpu=2',
              '--set resources.limits.memory=4Gi',
            ].join(' ')
          : ''

        send({ step: 'Process values files', status: 'success', message: `migrationId=${migrationId}, disableAuth=${disableAuth}, reduceResources=${reduceResources}, postgresHost=${postgresReleaseName}` })

        // ── 4. Clear stuck release ─────────────────────────────────────
        await sshExec(conn, withK8sEnv(
          `STATUS=$(helm list -a -n ${namespace} --filter '^participant$' -o json 2>/dev/null | jq -r '.[0].status // empty'); ` +
          `if [ "$STATUS" = "pending-install" ]; then helm uninstall participant -n ${namespace} --no-hooks 2>/dev/null; fi; ` +
          `if echo "$STATUS" | grep -q "^pending-"; then helm rollback participant 0 -n ${namespace} --no-hooks 2>/dev/null; fi; true`
        ))

        // ── 5. helm upgrade --install ──────────────────────────────────
        send({ step: 'helm install participant', status: 'running' })

        const helmCmd = [
          `helm upgrade --install participant`,
          `oci://ghcr.io/digital-asset/decentralized-canton-sync/helm/splice-participant`,
          `-n ${namespace} --create-namespace`,
          `--version ${version}`,
          `-f ${proc1} -f ${proc2}`,
          overrideYaml ? `-f ${overrideFile}` : '',
          resourceSetFlags,

          // persistence.host must match the K8s service name created by the postgres Helm release.
          // The service name = release name, so 'splice-postgres' release → service 'splice-postgres'.
          `--set persistence.host=${postgresReleaseName}`,
          `--wait --timeout 10m`
        ].filter(Boolean).join(' ')

        // ── Pod watcher (parallel SSH) — polls every 4s while helm waits ──
        let watcherStop = false
        const watcherConn = await sshConnect(validator).catch(() => null)

        const watcher = (async () => {
          if (!watcherConn) return

          while (!watcherStop) {
            const r = await sshExec(
              watcherConn,
              withK8sEnv(
                `kubectl get pods -n ${namespace} -l app.kubernetes.io/instance=participant ` +
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

        const installRes = await sshExec(conn, withK8sEnv(helmCmd), chunk => send({ log: chunk }))

        watcherStop = true
        await watcher.catch(() => {})
        watcherConn?.end()

        // Cleanup temp files (best-effort)
        await sshExec(conn, `rm -f ${proc1} ${proc2} ${overrideFile}`).catch(() => {})

        if (installRes.code !== 0) {
          const lastLine = installRes.output.split('\n').filter(Boolean).slice(-1)[0] ?? ''

          send({ step: 'helm install participant', status: 'error', message: lastLine.slice(0, 200) })
          throw new Error('helm install participant failed')
        }

        send({ step: 'helm install participant', status: 'success', message: 'deployed' })
        send({ done: true })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)

        send({ done: true, error: msg })
      } finally {
        conn?.end()
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
