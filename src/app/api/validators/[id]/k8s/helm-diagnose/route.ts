import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * GET /api/validators/[id]/k8s/helm-diagnose?releaseName=postgres
 *
 * Returns combined kubectl describe / pvc / events output for a release.
 * Used by the install dialog to show why pods are stuck Pending without
 * waiting for the helm `--wait --timeout 10m` to expire.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  const releaseName = (url.searchParams.get('releaseName') ?? '').trim()

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

    const res = await sshExec(
      conn,
      withK8sEnv(
        `echo '=== Pods ===' && ` +
          `kubectl get pods -n ${namespace} -l app.kubernetes.io/instance=${releaseName} -o wide 2>&1 ; ` +
          `echo && echo '=== PVCs (namespace) ===' && ` +
          `kubectl get pvc -n ${namespace} 2>&1 ; ` +
          `echo && echo '=== StorageClasses ===' && ` +
          `kubectl get storageclass 2>&1 ; ` +
          `echo && echo '=== Pod describe ===' && ` +
          `kubectl describe pod -n ${namespace} -l app.kubernetes.io/instance=${releaseName} 2>&1 | tail -150 ; ` +
          `echo && echo '=== Recent events ===' && ` +
          `kubectl get events -n ${namespace} --sort-by=.lastTimestamp 2>&1 | tail -30`
      )
    )

    return Response.json({ output: res.output, exitCode: res.code })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    conn?.end()
  }
}
