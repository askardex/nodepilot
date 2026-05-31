import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * POST /api/validators/[id]/k8s/pvc-cleanup
 *
 * Body: { releaseName: string }  // e.g. "postgres"
 *
 * StatefulSet PVCs are NOT deleted automatically when the release is uninstalled,
 * which means a previous install with a wrong storageClass leaves a Pending PVC
 * that the next install reuses. This endpoint deletes PVCs labelled with the
 * release so the next install can recreate them with the correct class.
 *
 * SAFETY: this is destructive (data loss). Only call after the user confirms.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => ({})) as { releaseName?: string }
  const releaseName = (body.releaseName ?? '').trim()

  if (!releaseName || !/^[a-z0-9][a-z0-9-]{0,52}$/.test(releaseName)) {
    return Response.json({ error: 'invalid releaseName' }, { status: 400 })
  }

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator || validator.deploymentMode !== 'k8s' || !validator.k8sConfig) {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'

  let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

  try {
    conn = await sshConnect(validator)

    // Try multiple label selectors — different StatefulSets use different conventions.
    // The chart sets `app=postgres` and `app.kubernetes.io/instance=postgres`,
    // but the PVC template may not inherit either, so we also fall back to a
    // name-prefix match.
    const cmd = withK8sEnv(
      `kubectl delete pvc -n ${namespace} -l app.kubernetes.io/instance=${releaseName} --ignore-not-found 2>&1 ; ` +
        `kubectl delete pvc -n ${namespace} -l app=${releaseName} --ignore-not-found 2>&1 ; ` +
        // Best-effort: any PVC whose name contains the release name (covers `pg-data-postgres-0`).
        `for p in $(kubectl get pvc -n ${namespace} -o name 2>/dev/null | grep -i ${releaseName} || true); do ` +
        `kubectl delete -n ${namespace} $p --ignore-not-found 2>&1 ; done`
    )

    const res = await sshExec(conn, cmd)

    return Response.json({ output: res.output, exitCode: res.code })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    conn?.end()
  }
}
