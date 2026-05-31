import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

type K8sPublicForm = {
  routingMode: 'multi' | 'path'
  baseDomain: string
  enableWallet: boolean
  walletSubdomain: string
  enableAns: boolean
  ansSubdomain: string
  enableApi: boolean
  apiSubdomain: string
  tlsEnabled: boolean
  tlsMode: 'letsencrypt' | 'custom'
  tlsEmail: string
  customCertPem: string
  customKeyPem: string
}

function buildIngressYaml(form: K8sPublicForm, namespace: string): string {
  const {
    routingMode, baseDomain,
    enableWallet, walletSubdomain,
    enableAns, ansSubdomain,
    enableApi, apiSubdomain,
    tlsEnabled, tlsMode
  } = form

  const getHost = (sub: string) =>
    routingMode === 'multi' ? `${sub}.${baseDomain}` : baseDomain
  const getPath = (path: string) =>
    routingMode === 'path' ? `/${path}` : '/'

  const services: Array<{ host: string; path: string; svc: string; port: number }> = []
  if (enableWallet) services.push({ host: getHost(walletSubdomain), path: getPath('wallet'), svc: 'wallet-web-ui', port: 80 })
  if (enableAns)    services.push({ host: getHost(ansSubdomain),    path: getPath('ans'),    svc: 'ans-web-ui',    port: 80 })
  if (enableApi)    services.push({ host: getHost(apiSubdomain),    path: getPath('api'),    svc: 'validator-app', port: 5003 })

  // Group paths by host
  const hostMap = new Map<string, Array<{ path: string; svc: string; port: number }>>()
  for (const s of services) {
    if (!hostMap.has(s.host)) hostMap.set(s.host, [])
    hostMap.get(s.host)!.push(s)
  }
  const hosts = [...hostMap.keys()]

  const rulesYaml = hosts.map(host => {
    const paths = hostMap.get(host)!
    const pathsYaml = paths.map(p =>
      `      - path: ${p.path}\n        pathType: Prefix\n        backend:\n          service:\n            name: ${p.svc}\n            port:\n              number: ${p.port}`
    ).join('\n')
    return `  - host: ${host}\n    http:\n      paths:\n${pathsYaml}`
  }).join('\n')

  const certAnnotation = tlsEnabled && tlsMode === 'letsencrypt'
    ? '\n    cert-manager.io/cluster-issuer: letsencrypt-prod'
    : ''
  const entrypoint = tlsEnabled ? 'websecure' : 'web'

  const tlsSection = tlsEnabled
    ? `  tls:\n  - hosts:\n${hosts.map(h => `    - ${h}`).join('\n')}\n    secretName: splice-validator-tls\n`
    : ''

  return (
    `apiVersion: networking.k8s.io/v1\n` +
    `kind: Ingress\n` +
    `metadata:\n` +
    `  name: splice-validator-ingress\n` +
    `  namespace: ${namespace}\n` +
    `  annotations:\n` +
    `    traefik.ingress.kubernetes.io/router.entrypoints: ${entrypoint}${certAnnotation}\n` +
    `spec:\n` +
    `  ingressClassName: traefik\n` +
    `${tlsSection}` +
    `  rules:\n` +
    `${rulesYaml}\n`
  )
}

function buildClusterIssuerYaml(email: string): string {
  return (
    `apiVersion: cert-manager.io/v1\n` +
    `kind: ClusterIssuer\n` +
    `metadata:\n` +
    `  name: letsencrypt-prod\n` +
    `spec:\n` +
    `  acme:\n` +
    `    server: https://acme-v02.api.letsencrypt.org/directory\n` +
    `    email: ${email}\n` +
    `    privateKeySecretRef:\n` +
    `      name: letsencrypt-prod\n` +
    `    solvers:\n` +
    `    - http01:\n` +
    `        ingress:\n` +
    `          class: traefik\n`
  )
}

function buildTlsSecretYaml(namespace: string, certPem: string, keyPem: string): string {
  return (
    `apiVersion: v1\n` +
    `kind: Secret\n` +
    `metadata:\n` +
    `  name: splice-validator-tls\n` +
    `  namespace: ${namespace}\n` +
    `type: kubernetes.io/tls\n` +
    `stringData:\n` +
    `  tls.crt: |\n` +
    certPem.trim().split('\n').map(l => `    ${l}`).join('\n') + '\n' +
    `  tls.key: |\n` +
    keyPem.trim().split('\n').map(l => `    ${l}`).join('\n') + '\n'
  )
}

async function applyYaml(
  conn: Parameters<typeof sshExec>[0],
  yaml: string
): Promise<string> {
  const b64 = Buffer.from(yaml).toString('base64')
  const { output } = await sshExec(
    conn,
    withK8sEnv(`echo '${b64}' | base64 -d | kubectl apply -f -`),
    undefined,
    60_000
  )
  return output.trim()
}

/**
 * POST /api/validators/[id]/k8s/apply-ingress
 *
 * Generates and applies Kubernetes Ingress resources via kubectl on the VPS.
 *
 * Body: K8sPublicForm
 * Returns: { applied: string[] }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator) return Response.json({ error: 'Validator not found' }, { status: 404 })
  if (validator.deploymentMode !== 'k8s' || !validator.k8sConfig) {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  let body: K8sPublicForm
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    baseDomain, enableWallet, enableAns, enableApi,
    tlsEnabled, tlsMode, tlsEmail, customCertPem, customKeyPem
  } = body

  // Validate
  if (!baseDomain?.trim()) return Response.json({ error: 'baseDomain is required' }, { status: 400 })
  if (!enableWallet && !enableAns && !enableApi) {
    return Response.json({ error: 'At least one service must be enabled' }, { status: 400 })
  }
  if (tlsEnabled && tlsMode === 'letsencrypt' && !tlsEmail?.trim()) {
    return Response.json({ error: 'ACME email is required for Let\'s Encrypt' }, { status: 400 })
  }

  // For custom TLS, cert fields can be empty if the secret already exists in the cluster
  const hasNewCustomCert = !!(customCertPem?.trim() && customKeyPem?.trim())

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'
  const applied: string[] = []

  let conn
  try {
    conn = await sshConnect(validator, 20_000)

    // 1. ClusterIssuer (Let's Encrypt)
    if (tlsEnabled && tlsMode === 'letsencrypt') {
      const yaml = buildClusterIssuerYaml(tlsEmail.trim())
      const out = await applyYaml(conn, yaml)
      applied.push(`ClusterIssuer: ${out}`)
    }

    // 2. Custom TLS Secret (only if new cert provided — otherwise keep existing)
    if (tlsEnabled && tlsMode === 'custom' && hasNewCustomCert) {
      const yaml = buildTlsSecretYaml(namespace, customCertPem!, customKeyPem!)
      const out = await applyYaml(conn, yaml)
      applied.push(`Secret (TLS): ${out}`)
    } else if (tlsEnabled && tlsMode === 'custom' && !hasNewCustomCert) {
      // Check that existing secret exists
      const { output: chk } = await sshExec(
        conn,
        withK8sEnv(`kubectl get secret splice-validator-tls -n ${namespace} --no-headers 2>/dev/null && echo __FOUND__ || echo __MISSING__`)
      )

      if (chk.includes('__MISSING__')) {
        conn.end()

        return Response.json({ error: 'No TLS certificate found in cluster. Please paste Certificate PEM and Private Key PEM.' }, { status: 400 })
      }

      applied.push('Secret (TLS): using existing certificate')
    }

    // 3. Ingress
    const ingressYaml = buildIngressYaml(body, namespace)
    const out = await applyYaml(conn, ingressYaml)
    applied.push(`Ingress: ${out}`)

    return Response.json({ applied })
  } catch (err: any) {
    return Response.json({ error: err?.message || 'SSH error' }, { status: 500 })
  } finally {
    conn?.end()
  }
}
