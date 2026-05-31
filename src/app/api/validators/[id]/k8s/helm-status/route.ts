import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * GET /api/validators/[id]/k8s/helm-status
 *
 * Returns:
 *   - helm releases in the validator namespace
 *   - pod summary (running/total) in the namespace
 *   - cluster node count
 *
 * Read-only; does not mutate state.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator) {
    return Response.json({ error: 'Validator not found' }, { status: 404 })
  }

  if (validator.deploymentMode !== 'k8s' || !validator.k8sConfig?.kubeconfig) {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'

  let conn

  try {
    conn = await sshConnect(validator)

    const releasesRes = await sshExec(
      conn,
      withK8sEnv(`helm list -n ${namespace} -o json 2>/dev/null || echo "[]"`)
    )

    let releases: Array<{ name: string; chart: string; status: string; revision: string; updated: string }> = []

    try {
      const parsed = JSON.parse(releasesRes.output || '[]')

      if (Array.isArray(parsed)) {
        releases = parsed.map(r => ({
          name: String(r.name ?? ''),
          chart: String(r.chart ?? ''),
          status: String(r.status ?? ''),
          revision: String(r.revision ?? ''),
          updated: String(r.updated ?? '')
        }))
      }
    } catch {
      // ignore — keep empty
    }

    const podsRes = await sshExec(
      conn,
      withK8sEnv(`kubectl get pods -n ${namespace} --no-headers 2>/dev/null || true`)
    )

    const podLines = podsRes.output.split('\n').filter(Boolean)
    const podsRunning = podLines.filter(l => /\sRunning\s/.test(l)).length

    const nodesRes = await sshExec(
      conn,
      withK8sEnv('kubectl get nodes --no-headers 2>/dev/null || true')
    )

    const nodeLines = nodesRes.output.split('\n').filter(Boolean)
    const nodesReady = nodeLines.filter(l => /\sReady\s/.test(l)).length

    // Fetch participant values to expose current databaseName (contains migrationId)
    let participantDatabaseName: string | null = null
    const partValuesRes = await sshExec(
      conn,
      withK8sEnv(`helm get values participant -n ${namespace} -o json 2>/dev/null || echo "{}"`)
    )

    try {
      const pv = JSON.parse(partValuesRes.output || '{}')

      participantDatabaseName = pv?.persistence?.databaseName ?? null
    } catch { /* ignore */ }

    return Response.json({
      ok: true,
      namespace,
      releases,
      participantDatabaseName,
      pods: { running: podsRunning, total: podLines.length },
      nodes: { ready: nodesReady, total: nodeLines.length }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    return Response.json({ ok: false, error: message }, { status: 502 })
  } finally {
    conn?.end()
  }
}
