import { prisma } from '@/lib/prisma'
import { probeCluster } from '@/lib/k8s'

/**
 * POST /api/validators/[id]/k8s/test-connection
 *
 * Verify the saved kubeconfig still reaches the cluster.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator) {
    return Response.json({ error: 'Validator not found' }, { status: 404 })
  }

  if (validator.deploymentMode !== 'k8s' || !validator.k8sConfig) {
    return Response.json({ error: 'Validator is not in K8s mode' }, { status: 400 })
  }

  if (!validator.k8sConfig.kubeconfig) {
    return Response.json({ error: 'No kubeconfig saved — run /k8s/connect first' }, { status: 400 })
  }

  try {
    const probe = await probeCluster(validator.k8sConfig.kubeconfig)

    await prisma.k8sConfig.update({
      where: { validatorId: id },
      data: { lastTestedAt: new Date() }
    })

    return Response.json({
      ok: true,
      serverVersion: probe.serverVersion,
      nodeCount: probe.nodeCount,
      contextName: probe.contextName
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    return Response.json({ ok: false, error: message }, { status: 502 })
  }
}
