import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * POST /api/validators/[id]/k8s/expose-services
 *
 * Patches wallet-web-ui, ans-web-ui, and validator-app services
 * from ClusterIP to NodePort so they can be accessed from outside
 * the cluster via the VPS IP.
 *
 * Port mapping:
 *   wallet-web-ui  :80  → NodePort 30080
 *   ans-web-ui     :80  → NodePort 30081
 *   validator-app  :5003 → NodePort 30003
 *   validator-app  :10013 → NodePort 30013
 *
 * Returns: { ports: { wallet: number, ans: number, validatorApi: number } }
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
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'

  let conn
  try {
    conn = await sshConnect(validator)

    // Patch wallet-web-ui
    await sshExec(
      conn,
      withK8sEnv(
        `kubectl patch svc wallet-web-ui -n ${namespace} ` +
        `--type=json -p '[{"op":"replace","path":"/spec/type","value":"NodePort"},` +
        `{"op":"replace","path":"/spec/ports/0/nodePort","value":30080}]' 2>&1 || ` +
        `kubectl patch svc wallet-web-ui -n ${namespace} ` +
        `-p '{"spec":{"type":"NodePort","ports":[{"port":80,"targetPort":8080,"nodePort":30080}]}}' 2>&1`
      )
    )

    // Patch ans-web-ui
    await sshExec(
      conn,
      withK8sEnv(
        `kubectl patch svc ans-web-ui -n ${namespace} ` +
        `-p '{"spec":{"type":"NodePort","ports":[{"port":80,"targetPort":8080,"nodePort":30081}]}}' 2>&1`
      )
    )

    // Patch validator-app (two ports)
    await sshExec(
      conn,
      withK8sEnv(
        `kubectl patch svc validator-app -n ${namespace} ` +
        `-p '{"spec":{"type":"NodePort","ports":[` +
        `{"port":5003,"targetPort":5003,"nodePort":30003,"name":"http"},` +
        `{"port":10013,"targetPort":10013,"nodePort":30013,"name":"admin"}` +
        `]}}' 2>&1`
      )
    )

    // Verify
    const svcRes = await sshExec(
      conn,
      withK8sEnv(`kubectl get svc -n ${namespace} wallet-web-ui ans-web-ui validator-app -o json 2>&1`)
    )

    const ports: Record<string, number> = { wallet: 30080, ans: 30081, validatorApi: 30003 }

    try {
      const parsed = JSON.parse(svcRes.output || '{}')
      if (parsed.items) {
        for (const svc of parsed.items) {
          const name: string = svc.metadata?.name ?? ''
          const nodePorts: number[] = (svc.spec?.ports ?? []).map((p: any) => p.nodePort).filter(Boolean)
          if (name === 'wallet-web-ui' && nodePorts[0]) ports.wallet = nodePorts[0]
          if (name === 'ans-web-ui' && nodePorts[0]) ports.ans = nodePorts[0]
          if (name === 'validator-app' && nodePorts[0]) ports.validatorApi = nodePorts[0]
        }
      }
    } catch {
      // keep defaults
    }

    return Response.json({ ports })
  } catch (err: any) {
    return Response.json({ error: err?.message || 'SSH error' }, { status: 500 })
  } finally {
    conn?.end()
  }
}
