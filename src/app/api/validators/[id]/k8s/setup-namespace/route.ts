import { prisma } from '@/lib/prisma'
import { ensureNamespace } from '@/lib/k8s'

/**
 * POST /api/validators/[id]/k8s/setup-namespace
 *
 * Idempotently create the namespace stored in K8sConfig.namespace.
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

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'

  try {
    const created = await ensureNamespace(validator.k8sConfig.kubeconfig, namespace)

    await prisma.k8sConfig.update({
      where: { validatorId: id },
      data: { namespaceCreatedAt: new Date() }
    })

    return Response.json({
      ok: true,
      namespace,
      created,
      message: created ? `Namespace ${namespace} created` : `Namespace ${namespace} already exists`
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    return Response.json({ ok: false, error: message }, { status: 502 })
  }
}
