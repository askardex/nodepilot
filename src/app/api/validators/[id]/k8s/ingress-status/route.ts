import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * GET /api/validators/[id]/k8s/ingress-status
 *
 * Returns:
 *   - certManagerInstalled: boolean | null (null = SSH error)
 *   - exposedPorts: { wallet, ans, validatorApi } | null  (null = not NodePort)
 *   - ingress: { baseDomain, routingMode, tlsEnabled, services } | null (null = no ingress)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    conn = await sshConnect(validator, 20_000)

    // ── 1. cert-manager ─────────────────────────────────────────────────
    let certManagerInstalled: boolean | null = null
    try {
      const { output } = await sshExec(
        conn,
        withK8sEnv(`kubectl get namespace cert-manager --no-headers 2>/dev/null && echo __FOUND__ || echo __MISSING__`)
      )
      certManagerInstalled = output.includes('__FOUND__')
    } catch {
      certManagerInstalled = null
    }

    // ── 2. NodePort services ─────────────────────────────────────────────
    let exposedPorts: { wallet: number; ans: number; validatorApi: number } | null = null
    try {
      const { output } = await sshExec(
        conn,
        withK8sEnv(
          `kubectl get svc wallet-web-ui ans-web-ui validator-app -n ${namespace} -o json 2>/dev/null`
        )
      )
      const parsed = JSON.parse(output || '{}')
      if (parsed.items) {
        const ports: Record<string, number> = {}
        for (const svc of parsed.items) {
          const name: string = svc.metadata?.name ?? ''
          if (svc.spec?.type !== 'NodePort') continue
          const np: number[] = (svc.spec?.ports ?? []).map((p: any) => p.nodePort).filter(Boolean)
          if (name === 'wallet-web-ui' && np[0]) ports.wallet = np[0]
          if (name === 'ans-web-ui' && np[0]) ports.ans = np[0]
          if (name === 'validator-app' && np[0]) ports.validatorApi = np[0]
        }
        if (ports.wallet || ports.ans || ports.validatorApi) {
          exposedPorts = {
            wallet: ports.wallet ?? 30080,
            ans: ports.ans ?? 30081,
            validatorApi: ports.validatorApi ?? 30003
          }
        }
      }
    } catch {
      // ignore
    }

    // ── 3. TLS secret info ───────────────────────────────────────────────
    let tlsSecretExists = false
    let tlsCertInfo: { subject: string; issuer: string; notAfter: string; sans: string[] } | null = null

    try {
      const { output: certOut } = await sshExec(
        conn,
        withK8sEnv(
          `kubectl get secret splice-validator-tls -n ${namespace} -o jsonpath="{.data.tls\\.crt}" 2>/dev/null`
        )
      )

      if (certOut.trim()) {
        tlsSecretExists = true

        // Decode cert and extract metadata
        const { output: certInfo } = await sshExec(
          conn,
          withK8sEnv(
            `kubectl get secret splice-validator-tls -n ${namespace} -o jsonpath="{.data.tls\\.crt}" | base64 -d | openssl x509 -noout -subject -issuer -enddate -ext subjectAltName 2>/dev/null || true`
          )
        )

        if (certInfo.trim()) {
          const subjectMatch = certInfo.match(/subject=(.+)/)
          const issuerMatch = certInfo.match(/issuer=(.+)/)
          const dateMatch = certInfo.match(/notAfter=(.+)/)
          const sanMatch = certInfo.match(/DNS:[^\n]+/g)

          tlsCertInfo = {
            subject: subjectMatch?.[1]?.trim() ?? '',
            issuer: issuerMatch?.[1]?.trim() ?? '',
            notAfter: dateMatch?.[1]?.trim() ?? '',
            sans: (sanMatch ?? []).map(s => s.replace(/^DNS:/g, '').trim())
                    .flatMap(s => s.split(/,\s*/).map(x => x.replace(/^DNS:/g, '').trim()))
                    .filter(Boolean)
          }
        }
      }
    } catch {
      // non-fatal
    }

    // ── 4. Existing Ingress ──────────────────────────────────────────────
    let ingress: {
      baseDomain: string
      routingMode: 'multi' | 'path'
      tlsEnabled: boolean
      enableWallet: boolean
      walletSubdomain: string
      enableAns: boolean
      ansSubdomain: string
      enableApi: boolean
      apiSubdomain: string
      tlsMode: 'letsencrypt' | 'custom'
      tlsEmail: string
    } | null = null

    try {
      const { output } = await sshExec(
        conn,
        withK8sEnv(
          `kubectl get ingress splice-validator-ingress -n ${namespace} -o json 2>/dev/null || echo null`
        )
      )
      if (output && output !== 'null') {
        const obj = JSON.parse(output)
        const rules: Array<{ host: string; http: { paths: Array<{ path: string; backend: { service: { name: string } } }> } }> =
          obj.spec?.rules ?? []
        const tlsEnabled = (obj.spec?.tls ?? []).length > 0
        const annotations = obj.metadata?.annotations ?? {}
        const isLE = annotations['cert-manager.io/cluster-issuer'] === 'letsencrypt-prod'

        // Detect routing mode: if all rules share the same host → path-based
        const hosts = [...new Set(rules.map(r => r.host).filter(Boolean))]
        const routingMode: 'multi' | 'path' = hosts.length === 1 && rules[0]?.http?.paths?.length > 1 ? 'path' : 'multi'
        const baseDomain = routingMode === 'path' ? hosts[0] : hosts[0]?.split('.').slice(1).join('.') || hosts[0]

        const findSvc = (name: string) => {
          for (const rule of rules) {
            for (const p of rule.http?.paths ?? []) {
              if (p.backend?.service?.name === name) {
                return { host: rule.host, path: p.path }
              }
            }
          }
          return null
        }

        const walletEntry = findSvc('wallet-web-ui')
        const ansEntry = findSvc('ans-web-ui')
        const apiEntry = findSvc('validator-app')

        ingress = {
          baseDomain,
          routingMode,
          tlsEnabled,
          enableWallet: !!walletEntry,
          walletSubdomain: walletEntry && routingMode === 'multi'
            ? walletEntry.host.split('.')[0]
            : 'wallet',
          enableAns: !!ansEntry,
          ansSubdomain: ansEntry && routingMode === 'multi'
            ? ansEntry.host.split('.')[0]
            : 'ans',
          enableApi: !!apiEntry,
          apiSubdomain: apiEntry && routingMode === 'multi'
            ? apiEntry.host.split('.')[0]
            : 'api',
          tlsMode: isLE ? 'letsencrypt' : 'custom',
          tlsEmail: ''
        }
      }
    } catch {
      // no ingress or parse error — leave null
    }

    return Response.json({ certManagerInstalled, exposedPorts, ingress, tlsSecretExists, tlsCertInfo })
  } catch (err: any) {
    return Response.json({ error: err?.message || 'SSH error' }, { status: 500 })
  } finally {
    conn?.end()
  }
}
