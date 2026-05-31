import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * POST /api/validators/[id]/k8s/helm-uninstall
 *
 * Body: { releaseName: string, keepHistory?: boolean }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await request.json().catch(() => ({})) as {
    releaseName?: string
    keepHistory?: boolean
  }

  const releaseName = (body.releaseName ?? '').trim()

  if (!releaseName || !/^[a-z0-9][a-z0-9-]{0,52}$/.test(releaseName)) {
    return Response.json({ error: 'Invalid releaseName' }, { status: 400 })
  }

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

    const flag = body.keepHistory ? '--keep-history' : ''
    const cmd = `helm uninstall ${releaseName} -n ${namespace} ${flag}`

    const res = await sshExec(conn, withK8sEnv(cmd))

    if (res.code !== 0) {
      return Response.json(
        { ok: false, error: res.output.slice(-300) || `exit ${res.code}` },
        { status: 502 }
      )
    }

    return Response.json({ ok: true, message: res.output.split('\n').slice(-1)[0] })
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    )
  } finally {
    conn?.end()
  }
}
