import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * POST /api/validators/[id]/k8s/helm-install
 *
 * Body:
 *   {
 *     releaseName: string,         // e.g. "splice-postgres"
 *     chartRef:    string,         // e.g. "oci://registry.example.com/charts/splice-postgres"
 *     version?:    string,         // e.g. "0.5.18"
 *     valuesYaml?: string,         // optional YAML override
 *     wait?:       boolean         // default true
 *   }
 *
 * Streams SSE: { step, status, message? } and final { done: true, error? }.
 *
 * Auth note: this does NOT call `helm registry login`. If the chart ref is a
 * private OCI registry, the user must `helm registry login` on the host out-of-band
 * (or we add a /k8s/helm-login endpoint later).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await request.json().catch(() => ({})) as {
    releaseName?: string
    chartRef?: string
    version?: string
    valuesYaml?: string
    wait?: boolean
  }

  const releaseName = (body.releaseName ?? '').trim()
  const chartRef = (body.chartRef ?? '').trim()
  const version = (body.version ?? '').trim()
  const valuesYaml = body.valuesYaml ?? ''
  const wait = body.wait !== false

  // Defensive validation — release names and chart refs end up in shell commands.
  if (!releaseName || !/^[a-z0-9][a-z0-9-]{0,52}$/.test(releaseName)) {
    return new Response(
      JSON.stringify({ error: 'releaseName must be lowercase alphanumeric/hyphens, ≤53 chars' }),
      { status: 400 }
    )
  }

  if (!chartRef || !/^[a-zA-Z0-9._\-/:@+]+$/.test(chartRef)) {
    return new Response(
      JSON.stringify({ error: 'chartRef contains unsupported characters' }),
      { status: 400 }
    )
  }

  if (version && !/^[a-zA-Z0-9._\-+]+$/.test(version)) {
    return new Response(JSON.stringify({ error: 'version contains unsupported characters' }), { status: 400 })
  }

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator) {
    return new Response(JSON.stringify({ error: 'Validator not found' }), { status: 404 })
  }

  if (validator.deploymentMode !== 'k8s' || !validator.k8sConfig?.kubeconfig) {
    return new Response(JSON.stringify({ error: 'K8s not configured' }), { status: 400 })
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

      try {
        send({ step: 'SSH Connect', status: 'running' })
        conn = await sshConnect(validator)
        send({ step: 'SSH Connect', status: 'success', message: `connected to ${validator.host}` })

        // Stage values.yaml (if provided) into a temp file on the host.
        // We use a per-release temp path to avoid cross-talk if multiple installs
        // run concurrently. The file is removed at the end (best-effort).
        const tmpValues = `/tmp/nodepilot-values-${releaseName}-${Date.now()}.yaml`
        let valuesFlag = ''

        if (valuesYaml.trim()) {
          send({ step: 'Stage values.yaml', status: 'running' })

          // Write via base64 to avoid heredoc quoting issues with YAML content.
          const b64 = Buffer.from(valuesYaml, 'utf8').toString('base64')
          const writeRes = await sshExec(
            conn,
            `echo '${b64}' | base64 -d > ${tmpValues} && wc -c < ${tmpValues}`
          )

          if (writeRes.code !== 0) {
            send({ step: 'Stage values.yaml', status: 'error', message: writeRes.output.slice(-160) })
            throw new Error('failed to write values.yaml')
          }

          valuesFlag = `-f ${tmpValues}`
          send({ step: 'Stage values.yaml', status: 'success', message: `${writeRes.output.trim()} bytes` })

          // Echo a preview of the values file to the log so the user can verify
          // their overrides actually reached helm (e.g. db.volumeStorageClass).
          const previewLines = valuesYaml.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).slice(0, 12)

          send({ log: `[values applied — ${previewLines.length} non-comment lines]\n${previewLines.join('\n')}\n\n` })
        } else {
          send({ log: '[no values.yaml override — using chart defaults]\n' })
        }

        // ── Pre-flight: clear any stuck release ────────────────────────────
        // If a previous install/upgrade was interrupted, helm leaves the release
        // in `pending-install` / `pending-upgrade` / `pending-rollback` state
        // and refuses to retry with: "another operation (install/upgrade/
        // rollback) is in progress". The only way out is `helm uninstall`
        // (for pending-install) or `helm rollback` (for pending-upgrade).
        send({ step: 'Check release state', status: 'running' })

        const stateRes = await sshExec(
          conn,
          withK8sEnv(`helm list -a -n ${namespace} --filter '^${releaseName}$' -o json`)
        )

        if (stateRes.code === 0) {
          try {
            const list = JSON.parse(stateRes.output || '[]') as Array<{ name: string; status: string; revision: string }>
            const existing = list.find(r => r.name === releaseName)

            if (existing && existing.status.startsWith('pending-')) {
              send({
                step: 'Check release state',
                status: 'running',
                message: `release stuck in '${existing.status}' — recovering…`
              })

              if (existing.status === 'pending-install') {
                // No prior revision to roll back to — uninstall the half-created release.
                await sshExec(conn, withK8sEnv(`helm uninstall ${releaseName} -n ${namespace} --no-hooks`))
                send({ step: 'Check release state', status: 'success', message: 'cleared pending-install' })
              } else {
                // pending-upgrade / pending-rollback — rollback to last known good revision.
                const target = Math.max(1, parseInt(existing.revision, 10) - 1)

                await sshExec(conn, withK8sEnv(`helm rollback ${releaseName} ${target} -n ${namespace} --no-hooks`))
                send({ step: 'Check release state', status: 'success', message: `rolled back to rev ${target}` })
              }
            } else {
              send({
                step: 'Check release state',
                status: 'success',
                message: existing ? `current status: ${existing.status}` : 'no existing release'
              })
            }
          } catch {
            send({ step: 'Check release state', status: 'success', message: 'unable to parse state, proceeding' })
          }
        } else {
          send({ step: 'Check release state', status: 'success', message: 'helm list failed, proceeding' })
        }

        // Run helm upgrade --install (idempotent — creates if missing, upgrades if exists).
        const versionFlag = version ? `--version ${version}` : ''
        const waitFlag = wait ? '--wait --timeout 10m' : ''
        const helmCmd = [
          `helm upgrade --install ${releaseName} ${chartRef}`,
          `--namespace ${namespace} --create-namespace`,
          versionFlag,
          valuesFlag,
          waitFlag
        ].filter(Boolean).join(' ')

        send({ step: 'helm upgrade --install', status: 'running', message: `${releaseName} → ${chartRef}` })

        // ── Parallel pod watcher ────────────────────────────────────────────
        // helm `--wait` is silent for minutes while pods come up. Open a second
        // SSH connection and poll `kubectl get pods` every ~4s so the UI shows
        // live progress (which pods are Pending / ContainerCreating / Running).
        let watcherStop = false
        const watcherConn = await sshConnect(validator).catch(() => null)

        const watcher = (async () => {
          if (!watcherConn) return

          while (!watcherStop) {
            const r = await sshExec(
              watcherConn,
              withK8sEnv(
                `kubectl get pods -n ${namespace} -l app.kubernetes.io/instance=${releaseName} ` +
                  `--no-headers -o custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[*].ready,PHASE:.status.phase,REASON:.status.containerStatuses[*].state.waiting.reason 2>/dev/null`
              )
            ).catch(() => null)

            if (watcherStop) break

            if (r && r.code === 0) {
              const pods = r.output
                .split('\n')
                .filter(Boolean)
                .map(line => {
                  const [name, ready, phase, reason] = line.trim().split(/\s+/)

                  return { name, ready, phase, reason: reason === '<none>' ? '' : reason }
                })

              const running = pods.filter(p => p.phase === 'Running' && !p.ready?.includes('false')).length

              send({ pods, summary: { running, total: pods.length } })
            }

            // 4s interval — short enough to feel live, long enough to not spam SSH.
            await new Promise(res => setTimeout(res, 4000))
          }
        })()

        const installRes = await sshExec(conn, withK8sEnv(helmCmd), chunk => {
          // Stream raw output as log events for live tailing.
          send({ log: chunk })
        })

        // Stop watcher and tear down its connection.
        watcherStop = true
        await watcher.catch(() => {/* ignore */})
        watcherConn?.end()

        // Cleanup tmp file (best-effort, non-fatal).
        if (valuesFlag) {
          await sshExec(conn, `rm -f ${tmpValues}`).catch(() => {/* ignore */})
        }

        if (installRes.code !== 0) {
          send({
            step: 'helm upgrade --install',
            status: 'error',
            message: installRes.output.split('\n').slice(-1)[0]?.slice(0, 200) || `exit ${installRes.code}`
          })

          // ── Auto-diagnose on failure ──────────────────────────────────────
          // helm errors like "context deadline exceeded" are unhelpful. Pull
          // pod descriptions and recent namespace events so the user can see
          // the actual reason (ImagePullBackOff, PVC pending, OOMKilled, …).
          send({ step: 'Diagnose failure', status: 'running' })

          const describeRes = await sshExec(
            conn,
            withK8sEnv(
              `echo '=== Pods ===' && ` +
                `kubectl get pods -n ${namespace} -l app.kubernetes.io/instance=${releaseName} -o wide 2>&1 ; ` +
                `echo && echo '=== PVCs ===' && ` +
                `kubectl get pvc -n ${namespace} 2>&1 ; ` +
                `echo && echo '=== Pod describe ===' && ` +
                `kubectl describe pod -n ${namespace} -l app.kubernetes.io/instance=${releaseName} 2>&1 | tail -120 ; ` +
                `echo && echo '=== Recent events ===' && ` +
                `kubectl get events -n ${namespace} --sort-by=.lastTimestamp 2>&1 | tail -25`
            )
          )

          if (describeRes.output) {
            // Stream as log chunks so the existing log viewer picks it up.
            send({ log: '\n\n========== DIAGNOSTICS ==========\n' + describeRes.output })
          }

          send({ step: 'Diagnose failure', status: 'success', message: 'see log tail below' })

          throw new Error(`helm install failed (exit ${installRes.code}) — see diagnostics`)
        }

        send({ step: 'helm upgrade --install', status: 'success', message: 'release deployed' })

        // Verify pods come up.
        send({ step: 'Verify pods', status: 'running' })

        const podsRes = await sshExec(
          conn,
          withK8sEnv(`kubectl get pods -n ${namespace} -l app.kubernetes.io/instance=${releaseName} --no-headers`)
        )

        if (podsRes.code !== 0) {
          send({ step: 'Verify pods', status: 'error', message: 'kubectl get pods failed' })
        } else {
          const lines = podsRes.output.split('\n').filter(Boolean)
          const running = lines.filter(l => /\sRunning\s/.test(l)).length

          send({
            step: 'Verify pods',
            status: running === lines.length && lines.length > 0 ? 'success' : 'error',
            message: `${running}/${lines.length} pods Running`
          })
        }

        send({ done: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        send({ done: true, error: message })
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
