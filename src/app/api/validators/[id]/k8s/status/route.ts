import { prisma } from '@/lib/prisma'

/**
 * GET /api/validators/[id]/k8s/status
 *
 * Lightweight endpoint to hydrate K8s connection state on page load.
 * Returns whether kubeconfig exists, namespace ready, etc — from DB only,
 * no SSH / cluster call (instant).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  if (validator.deploymentMode !== 'k8s') {
    return Response.json({ connected: false })
  }

  const cfg = validator.k8sConfig

  return Response.json({
    connected: !!cfg?.kubeconfig,
    namespace: cfg?.namespace ?? 'validator',
    namespaceReady: !!cfg?.namespaceCreatedAt,
    connectedAt: cfg?.connectedAt ?? null,
    lastTestedAt: cfg?.lastTestedAt ?? null
  })
}
