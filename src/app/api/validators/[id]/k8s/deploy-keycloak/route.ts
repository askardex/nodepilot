import crypto from 'crypto'

import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'
import { encryptSecret } from '@/lib/secrets'

/**
 * POST /api/validators/[id]/k8s/deploy-keycloak
 *
 * Deploys Keycloak inside the k3s cluster as a Deployment + Service,
 * creates an Ingress resource, then provisions the Canton realm +
 * 4 Splice clients. Streams SSE log events.
 *
 * Body: { realm?: string, baseDomain?: string, keycloakSubdomain?: string }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    realm?: string
    baseDomain?: string
    keycloakSubdomain?: string
  }

  const realm = String(body.realm ?? 'canton').replace(/[^a-z0-9-]/gi, '') || 'canton'
  const baseDomain = (body.baseDomain ?? '').trim()
  const kcSubdomain = (body.keycloakSubdomain ?? 'auth').trim()

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true, config: true }
  })

  if (!validator || validator.deploymentMode !== 'k8s' || !validator.k8sConfig?.kubeconfig) {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'
  const adminPass: string = crypto.randomBytes(15).toString('base64url').slice(0, 20)

  // Public hostname for Keycloak (used in Ingress + OIDC issuer URL)
  const kcFqdn = baseDomain ? `${kcSubdomain}.${baseDomain}` : ''
  let kcPublicBase = kcFqdn ? `https://${kcFqdn}` : `http://${validator.host}:30180`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (level: 'info' | 'warn' | 'error' | 'stdout', message: string) =>
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ timestamp: new Date().toISOString(), level, message })}\n\n`
        ))

      const done = (ok: boolean, summary?: string) => {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ message: '__DONE__', ok, summary })}\n\n`
        ))
        controller.close()
      }

      let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

      try {
        emit('info', `Connecting to ${validator.host}…`)
        conn = await sshConnect(validator, 20_000)
        emit('info', '✓ SSH connected')

        // ── 1. Deploy Keycloak as K8s Deployment + Service ───────────────
        emit('info', 'Creating Keycloak Deployment + Service…')

        const kcHostnameEnv = kcFqdn
          ? [
              `        - name: KC_HOSTNAME`,
              `          value: "${kcPublicBase}"`,
              `        - name: KC_PROXY_HEADERS`,
              `          value: "xforwarded"`
            ].join('\n')
          : ''

        const deployYaml = [
          `apiVersion: apps/v1`,
          `kind: Deployment`,
          `metadata:`,
          `  name: keycloak`,
          `  namespace: ${namespace}`,
          `  labels:`,
          `    app: keycloak`,
          `spec:`,
          `  replicas: 1`,
          `  selector:`,
          `    matchLabels:`,
          `      app: keycloak`,
          `  template:`,
          `    metadata:`,
          `      labels:`,
          `        app: keycloak`,
          `    spec:`,
          `      containers:`,
          `      - name: keycloak`,
          `        image: quay.io/keycloak/keycloak:26.2`,
          `        args: ["start-dev"]`,
          `        ports:`,
          `        - containerPort: 8080`,
          `          name: http`,
          `        env:`,
          `        - name: KC_BOOTSTRAP_ADMIN_USERNAME`,
          `          value: "admin"`,
          `        - name: KC_BOOTSTRAP_ADMIN_PASSWORD`,
          `          value: "${adminPass}"`,
          `        - name: KEYCLOAK_ADMIN`,
          `          value: "admin"`,
          `        - name: KEYCLOAK_ADMIN_PASSWORD`,
          `          value: "${adminPass}"`,
          `        - name: KC_HTTP_ENABLED`,
          `          value: "true"`,
          `        - name: KC_HOSTNAME_STRICT`,
          `          value: "false"`,
          ...(kcHostnameEnv ? [kcHostnameEnv] : []),
          `        resources:`,
          `          requests:`,
          `            cpu: 250m`,
          `            memory: 512Mi`,
          `          limits:`,
          `            cpu: "1"`,
          `            memory: 1Gi`,
          `        readinessProbe:`,
          `          httpGet:`,
          `            path: /realms/master`,
          `            port: 8080`,
          `          initialDelaySeconds: 30`,
          `          periodSeconds: 10`,
          `---`,
          `apiVersion: v1`,
          `kind: Service`,
          `metadata:`,
          `  name: keycloak`,
          `  namespace: ${namespace}`,
          `spec:`,
          `  selector:`,
          `    app: keycloak`,
          `  ports:`,
          `  - port: 8080`,
          `    targetPort: 8080`,
          `    name: http`,
        ].join('\n') + '\n'

        const deployB64 = Buffer.from(deployYaml, 'utf8').toString('base64')
        const applyRes = await sshExec(conn, withK8sEnv(
          `echo '${deployB64}' | base64 -d | kubectl apply -f -`
        ))

        if (applyRes.code !== 0) {
          emit('error', `Failed to apply Keycloak manifests: ${applyRes.output.slice(-200)}`)
          throw new Error('kubectl apply failed')
        }

        emit('info', '✓ Deployment + Service created')

        // ── 2. Create Ingress (if domain configured) ─────────────────────
        if (kcFqdn) {
          emit('info', `Creating Ingress for ${kcFqdn}…`)

          // Detect existing TLS setup from splice-validator-ingress
          let tlsMode: 'letsencrypt' | 'existing-secret' | 'none' = 'none'

          const issuerCheck = await sshExec(conn, withK8sEnv(
            `kubectl get clusterissuer letsencrypt-prod --no-headers 2>/dev/null && echo __FOUND__ || echo __MISSING__`
          ))

          if (issuerCheck.output.includes('__FOUND__')) {
            tlsMode = 'letsencrypt'
            emit('info', '  Found cert-manager ClusterIssuer — will use Let\'s Encrypt')
          } else {
            // Check if a TLS secret already exists (custom cert uploaded via Public Access)
            const secretCheck = await sshExec(conn, withK8sEnv(
              `kubectl get secret splice-validator-tls -n ${namespace} --no-headers 2>/dev/null && echo __FOUND__ || echo __MISSING__`
            ))

            if (secretCheck.output.includes('__FOUND__')) {
              tlsMode = 'existing-secret'
              emit('info', '  Found existing TLS secret — will reuse for Keycloak')
            } else {
              emit('warn', '  No TLS configured — Keycloak ingress will be HTTP only (set up TLS via Public Access first)')
              kcPublicBase = `http://${kcFqdn}`
            }
          }

          const certAnnotation = tlsMode === 'letsencrypt'
            ? '    cert-manager.io/cluster-issuer: letsencrypt-prod'
            : ''

          const entrypoint = tlsMode !== 'none' ? 'websecure' : 'web'

          const tlsSecretName = tlsMode === 'letsencrypt' ? 'keycloak-tls' : 'splice-validator-tls'

          const ingressLines = [
            `apiVersion: networking.k8s.io/v1`,
            `kind: Ingress`,
            `metadata:`,
            `  name: keycloak-ingress`,
            `  namespace: ${namespace}`,
            `  annotations:`,
            `    traefik.ingress.kubernetes.io/router.entrypoints: ${entrypoint}`,
            ...(certAnnotation ? [certAnnotation] : []),
            `spec:`,
            `  ingressClassName: traefik`,
            ...(tlsMode !== 'none' ? [
              `  tls:`,
              `  - hosts:`,
              `    - ${kcFqdn}`,
              `    secretName: ${tlsSecretName}`,
            ] : []),
            `  rules:`,
            `  - host: ${kcFqdn}`,
            `    http:`,
            `      paths:`,
            `      - path: /`,
            `        pathType: Prefix`,
            `        backend:`,
            `          service:`,
            `            name: keycloak`,
            `            port:`,
            `              number: 8080`,
          ]

          const ingressYaml = ingressLines.join('\n') + '\n'

          const ingressB64 = Buffer.from(ingressYaml, 'utf8').toString('base64')
          const ingressRes = await sshExec(conn, withK8sEnv(
            `echo '${ingressB64}' | base64 -d | kubectl apply -f -`
          ))

          if (ingressRes.code !== 0) {
            emit('warn', `Ingress creation failed (non-fatal): ${ingressRes.output.slice(-100)}`)
          } else {
            emit('info', `✓ Ingress created: ${kcFqdn}`)
          }
        } else {
          // Expose as NodePort so it can be accessed without a domain
          emit('info', 'No domain configured — exposing Keycloak via NodePort 30180…')

          await sshExec(conn, withK8sEnv(
            `kubectl patch svc keycloak -n ${namespace} ` +
            `-p '{"spec":{"type":"NodePort","ports":[{"port":8080,"targetPort":8080,"nodePort":30180,"name":"http"}]}}'`
          ))

          emit('info', `✓ Keycloak accessible at http://${validator.host}:30180`)
        }

        // ── 3. Wait for Keycloak pod running ─────────────────────────────
        emit('info', 'Waiting for Keycloak pod to start (up to 5 min)…')

        const deadline = Date.now() + 300_000

        while (Date.now() < deadline) {
          const podRes = await sshExec(conn, withK8sEnv(
            `kubectl get pods -n ${namespace} -l app=keycloak --no-headers 2>/dev/null`
          ))

          if (podRes.code === 0) {
            const lines = podRes.output.split('\n').filter(Boolean)
            const ready = lines.filter(l => /\s+1\/1\s+Running/.test(l))

            if (ready.length > 0) {
              emit('info', `✓ Keycloak pod Running (${ready.length}/${lines.length})`)
              break
            }

            const pending = lines.map(l => {
              const parts = l.split(/\s+/)

              return `${parts[0]}: ${parts[2]}`
            }).join(', ')

            emit('stdout', `Waiting… ${pending}`)
          }

          await new Promise(r => setTimeout(r, 5000))
        }

        if (Date.now() >= deadline) {
          emit('error', 'Keycloak pod did not become ready within 5 minutes')
          throw new Error('keycloak pod timeout')
        }

        // ── 4. Wait for admin API ready ──────────────────────────────────
        emit('info', 'Waiting for Keycloak admin API…')

        // Get Keycloak ClusterIP to reach it from inside the VPS
        const svcRes = await sshExec(conn, withK8sEnv(
          `kubectl get svc keycloak -n ${namespace} -o jsonpath='{.spec.clusterIP}'`
        ))

        const kcClusterIP = svcRes.output.trim()

        if (!kcClusterIP || kcClusterIP === 'None') {
          emit('error', 'Could not resolve Keycloak ClusterIP')
          throw new Error('no ClusterIP')
        }

        const kcInternalBase = `http://${kcClusterIP}:8080`
        let accessToken = ''

        for (let i = 1; i <= 60; i++) {
          const tryToken = await sshExec(conn,
            `curl -s --max-time 4 -X POST "${kcInternalBase}/realms/master/protocol/openid-connect/token"` +
            ` -H "Content-Type: application/x-www-form-urlencoded"` +
            ` -d "grant_type=password&client_id=admin-cli&username=admin&password=${adminPass}"`
          )

          const tokenBody = tryToken.output.trim()

          if (tokenBody.includes('"access_token"')) {
            try {
              accessToken = JSON.parse(tokenBody).access_token ?? ''
            } catch {
              const m = tokenBody.match(/"access_token"\s*:\s*"([^"]+)"/)

              if (m) accessToken = m[1]
            }

            if (accessToken) break
          }

          emit('stdout', `[${i}/60] Not ready yet — ${tokenBody.slice(0, 60).replace(/\n/g, ' ') || 'no response'}`)
          await new Promise(r => setTimeout(r, 4000))
        }

        if (!accessToken) {
          emit('error', 'Keycloak admin API did not become ready')
          throw new Error('admin token failed')
        }

        emit('info', '✓ Admin API ready')

        // ── 5. Create realm ──────────────────────────────────────────────
        emit('info', `Creating realm "${realm}"…`)

        const realmPayload = JSON.stringify({
          realm,
          enabled: true,
          displayName: 'Canton Network',
          accessTokenLifespan: 3600,
          ssoSessionIdleTimeout: 36000,
          ssoSessionMaxLifespan: 86400
        })

        const createRealmRes = await sshExec(conn,
          `curl -sf -X POST "${kcInternalBase}/admin/realms"` +
          ` -H "Authorization: Bearer ${accessToken}"` +
          ` -H "Content-Type: application/json"` +
          ` -d '${realmPayload.replace(/'/g, "'\\''")}' -o /dev/null -w "%{http_code}"`
        )

        const realmCode = createRealmRes.output.trim()

        if (!['201', '409'].includes(realmCode)) {
          emit('error', `Create realm failed (HTTP ${realmCode})`)
          throw new Error('realm creation failed')
        }

        emit('info', realmCode === '409' ? `Realm "${realm}" already exists` : `✓ Realm "${realm}" created`)

        // ── 6. Create 4 Splice clients ───────────────────────────────────
        const createClient = async (clientId: string, confidential: boolean): Promise<string | null> => {
          const clientPayload = JSON.stringify({
            clientId,
            enabled: true,
            publicClient: !confidential,
            serviceAccountsEnabled: confidential,
            standardFlowEnabled: !confidential,
            directAccessGrantsEnabled: false,
            ...(confidential ? {} : { redirectUris: ['*'], webOrigins: ['*'] })
          })

          const createRes = await sshExec(conn!,
            `curl -sf -X POST "${kcInternalBase}/admin/realms/${realm}/clients"` +
            ` -H "Authorization: Bearer ${accessToken}"` +
            ` -H "Content-Type: application/json"` +
            ` -d '${clientPayload.replace(/'/g, "'\\''")}' -o /dev/null -w "%{http_code}"`
          )

          if (!['201', '409'].includes(createRes.output.trim())) {
            throw new Error(`Create client ${clientId} failed (HTTP ${createRes.output.trim()})`)
          }

          if (!confidential) return null

          // Get client UUID
          const listRes = await sshExec(conn!,
            `curl -sf "${kcInternalBase}/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}"` +
            ` -H "Authorization: Bearer ${accessToken}"`
          )

          const clients = JSON.parse(listRes.output) as Array<{ id: string }>

          if (!clients.length) throw new Error(`Client ${clientId} not found`)

          const uuid = clients[0].id

          // Get secret
          const secretRes = await sshExec(conn!,
            `curl -sf "${kcInternalBase}/admin/realms/${realm}/clients/${uuid}/client-secret"` +
            ` -H "Authorization: Bearer ${accessToken}"`
          )

          const secret = JSON.parse(secretRes.output).value as string

          if (!secret) throw new Error(`No secret for ${clientId}`)

          return secret
        }

        emit('info', 'Creating Splice clients…')

        emit('info', '  → validator-backend (confidential)')
        const validatorSecret = await createClient('validator-backend', true)

        if (!validatorSecret) throw new Error('validator-backend secret missing')

        emit('info', '  → ledger-api (confidential)')
        await createClient('ledger-api', true)

        emit('info', '  → wallet-ui (public)')
        await createClient('wallet-ui', false)

        emit('info', '  → ans-ui (public)')
        await createClient('ans-ui', false)

        emit('info', '✓ All 4 clients created')

        // ── 7. Create operator user ──────────────────────────────────────
        const operatorPassword: string = crypto.randomBytes(12).toString('base64url')

        emit('info', 'Creating operator user…')

        const createUserRes = await sshExec(conn,
          `curl -sf -X POST "${kcInternalBase}/admin/realms/${realm}/users"` +
          ` -H "Authorization: Bearer ${accessToken}"` +
          ` -H "Content-Type: application/json"` +
          ` -d '${JSON.stringify({
            username: 'operator',
            enabled: true,
            credentials: [{ type: 'password', value: operatorPassword, temporary: false }]
          }).replace(/'/g, "'\\''")}' -o /dev/null -w "%{http_code}"`
        )

        const userCode = createUserRes.output.trim()

        if (!['201', '409'].includes(userCode)) {
          throw new Error(`Create user failed (HTTP ${userCode})`)
        }

        // Resolve operator UUID
        const userListRes = await sshExec(conn,
          `curl -sf "${kcInternalBase}/admin/realms/${realm}/users?username=operator&exact=true"` +
          ` -H "Authorization: Bearer ${accessToken}"`
        )

        const walletAdminUser = (JSON.parse(userListRes.output) as Array<{ id: string }>)[0]?.id

        if (!walletAdminUser) throw new Error('Could not resolve operator UUID')

        emit('info', userCode === '201'
          ? `✓ Operator created (UUID: ${walletAdminUser})`
          : `✓ Operator exists (UUID: ${walletAdminUser})`)

        if (userCode === '201') {
          emit('warn', 'Operator password was generated and stored in Keycloak but is not shown in logs.')
        }

        // ── 8. Resolve validator-backend service account UUID ────────────
        emit('info', 'Resolving validator-backend service account…')

        const vbListRes = await sshExec(conn,
          `curl -sf "${kcInternalBase}/admin/realms/${realm}/clients?clientId=validator-backend"` +
          ` -H "Authorization: Bearer ${accessToken}"`
        )

        const vbUuid = (JSON.parse(vbListRes.output) as Array<{ id: string }>)[0]?.id

        if (!vbUuid) throw new Error('validator-backend not found')

        const saRes = await sshExec(conn,
          `curl -sf "${kcInternalBase}/admin/realms/${realm}/clients/${vbUuid}/service-account-user"` +
          ` -H "Authorization: Bearer ${accessToken}"`
        )

        const ledgerApiAdminUser = (JSON.parse(saRes.output) as { id: string }).id

        if (!ledgerApiAdminUser) throw new Error('Could not resolve service account UUID')

        emit('info', `✓ Ledger admin user (sub): ${ledgerApiAdminUser}`)

        // ── 9. Add audience mappers ──────────────────────────────────────
        const targetAudience = `${kcPublicBase}/realms/${realm}`

        const addAudienceMapper = async (cUuid: string, cId: string) => {
          const mapper = JSON.stringify({
            name: 'splice-audience',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-audience-mapper',
            config: {
              'included.custom.audience': targetAudience,
              'id.token.claim': 'false',
              'access.token.claim': 'true'
            }
          })

          const res = await sshExec(conn!,
            `curl -s -X POST "${kcInternalBase}/admin/realms/${realm}/clients/${cUuid}/protocol-mappers/models"` +
            ` -H "Authorization: Bearer ${accessToken}"` +
            ` -H "Content-Type: application/json"` +
            ` -d '${mapper.replace(/'/g, "'\\''")}' -o /dev/null -w "%{http_code}"`
          )

          if (!['201', '409'].includes(res.output.trim())) {
            throw new Error(`Audience mapper for ${cId} failed (HTTP ${res.output.trim()})`)
          }

          emit('info', `  ✓ ${cId}: audience mapper ${res.output.trim() === '409' ? 'exists' : 'added'}`)
        }

        emit('info', `Adding audience mappers (aud=${targetAudience})…`)
        await addAudienceMapper(vbUuid, 'validator-backend')

        // ledger-api
        const laListRes = await sshExec(conn,
          `curl -sf "${kcInternalBase}/admin/realms/${realm}/clients?clientId=ledger-api"` +
          ` -H "Authorization: Bearer ${accessToken}"`
        )

        const laUuid = (JSON.parse(laListRes.output) as Array<{ id: string }>)[0]?.id

        if (laUuid) await addAudienceMapper(laUuid, 'ledger-api')

        // wallet-ui + ans-ui
        // Also add a User Property mapper that maps `username` → `sub` so
        // Splice's WALLET_ADMIN_USER / validatorWalletUsers can be configured
        // by username (e.g. "operator") instead of the Keycloak UUID.
        const addSubAsUsernameMapper = async (cUuid: string, cId: string) => {
          const mapper = JSON.stringify({
            name: 'splice-sub-username',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-usermodel-property-mapper',
            config: {
              'user.attribute': 'username',
              'claim.name': 'sub',
              'jsonType.label': 'String',
              'id.token.claim': 'true',
              'access.token.claim': 'true',
              'userinfo.token.claim': 'true'
            }
          })

          const res = await sshExec(conn!,
            `curl -s -X POST "${kcInternalBase}/admin/realms/${realm}/clients/${cUuid}/protocol-mappers/models"` +
            ` -H "Authorization: Bearer ${accessToken}"` +
            ` -H "Content-Type: application/json"` +
            ` -d '${mapper.replace(/'/g, "'\\''")}' -o /dev/null -w "%{http_code}"`
          )

          if (!['201', '409'].includes(res.output.trim())) {
            throw new Error(`Sub=username mapper for ${cId} failed (HTTP ${res.output.trim()})`)
          }

          emit('info', `  ✓ ${cId}: sub=username mapper ${res.output.trim() === '409' ? 'exists' : 'added'}`)
        }

        for (const publicClient of ['wallet-ui', 'ans-ui']) {
          const cListRes = await sshExec(conn,
            `curl -sf "${kcInternalBase}/admin/realms/${realm}/clients?clientId=${publicClient}"` +
            ` -H "Authorization: Bearer ${accessToken}"`
          )

          const cUuid = (JSON.parse(cListRes.output) as Array<{ id: string }>)[0]?.id

          if (cUuid) {
            await addAudienceMapper(cUuid, publicClient)
            await addSubAsUsernameMapper(cUuid, publicClient)
          }
        }

        // ── 10. Build auth URLs ──────────────────────────────────────────
        const issuerUrl = `${kcPublicBase}/realms/${realm}`
        const jwksUrl = `${issuerUrl}/protocol/openid-connect/certs`
        const wellknownUrl = `${issuerUrl}/.well-known/openid-configuration`
        const encryptedAdminPass = encryptSecret(String(adminPass))
        const encryptedOperatorPass = encryptSecret(String(operatorPassword))
        const encryptedValidatorSecret = encryptSecret(String(validatorSecret))

        // walletAdminUser is stored as the operator USERNAME (not UUID).
        // The wallet-ui/ans-ui clients have a User Property mapper that
        // overrides the JWT `sub` claim with the username, so Splice
        // matches WALLET_ADMIN_USER / validatorWalletUsers against username.
        const walletAdminUserToStore = 'operator'

        // ── 11. Save to DB ───────────────────────────────────────────────
        emit('info', 'Saving configuration…')

        await prisma.validatorConfig.upsert({
          where: { validatorId: id },
          create: {
            validatorId: id,
            keycloakEnabled: true,
            keycloakPort: 8080,
            keycloakRealm: realm,
            keycloakAdminPass: encryptedAdminPass,
            keycloakOperatorPass: encryptedOperatorPass,
            keycloakDeployedAt: new Date(),
            authEnabled: true,
            authUrl: issuerUrl,
            authJwksUrl: jwksUrl,
            authWellknownUrl: wellknownUrl,
            validatorClientId: 'validator-backend',
            validatorClientSecret: encryptedValidatorSecret,
            ledgerApiAdminUser,
            walletAdminUser: walletAdminUserToStore,
            walletUiClientId: 'wallet-ui',
            ansUiClientId: 'ans-ui',
            ledgerApiAudience: issuerUrl,
            validatorAudience: issuerUrl
          },
          update: {
            keycloakEnabled: true,
            keycloakPort: 8080,
            keycloakRealm: realm,
            keycloakAdminPass: encryptedAdminPass,
            keycloakOperatorPass: encryptedOperatorPass,
            keycloakDeployedAt: new Date(),
            authEnabled: true,
            authUrl: issuerUrl,
            authJwksUrl: jwksUrl,
            authWellknownUrl: wellknownUrl,
            validatorClientId: 'validator-backend',
            validatorClientSecret: encryptedValidatorSecret,
            ledgerApiAdminUser,
            walletAdminUser: walletAdminUserToStore,
            walletUiClientId: 'wallet-ui',
            ansUiClientId: 'ans-ui',
            ledgerApiAudience: issuerUrl,
            validatorAudience: issuerUrl
          }
        })

        emit('info', '✓ Configuration saved')
        emit('info', '')
        emit('info', '┌─────────────────────────────────────────────────────')
        emit('info', `│  Keycloak: ${kcPublicBase}`)
        emit('info', `│  Admin console: ${kcPublicBase}/admin`)
        emit('info', `│`)
        emit('info', `│  Admin username: admin`)
        emit('info', `│  Operator username (${realm}): operator`)
        emit('info', `│  Passwords are generated and stored server-side (not shown in logs).`)
        emit('info', `│`)
        emit('info', `│  Realm: ${realm}`)
        emit('info', `│  Issuer: ${issuerUrl}`)
        emit('info', '└─────────────────────────────────────────────────────')
        emit('info', '')
        emit('info', '✅ Keycloak deployed in K8s!')
        emit('warn', '⚠  To enable OIDC on participant + validator:')
        emit('warn', '   1. Re-install participant with Auth = Enabled')
        emit('warn', '   2. Re-install validator with Auth = Enabled')
        emit('warn', `   OIDC Authority URL: ${issuerUrl}`)
        emit('warn', `   Audience: ${issuerUrl}`)
        emit('warn', `   Wallet User ID: ${walletAdminUserToStore}`)

        done(true, `Keycloak running in ${namespace}, realm "${realm}"`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)

        emit('error', `Deploy failed: ${msg}`)
        done(false, msg)
      } finally {
        conn?.end()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  })
}

/**
 * DELETE /api/validators/[id]/k8s/deploy-keycloak
 * Remove Keycloak Deployment, Service, and Ingress from k3s.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator || validator.deploymentMode !== 'k8s' || !validator.k8sConfig) {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'
  const conn = await sshConnect(validator, 15_000)

  try {
    await sshExec(conn, withK8sEnv(
      `kubectl delete deploy keycloak -n ${namespace} --ignore-not-found && ` +
      `kubectl delete svc keycloak -n ${namespace} --ignore-not-found && ` +
      `kubectl delete ingress keycloak-ingress -n ${namespace} --ignore-not-found`
    ))
  } finally {
    conn.end()
  }

  await prisma.validatorConfig.updateMany({
    where: { validatorId: id },
    data: {
      keycloakEnabled: false,
      keycloakDeployedAt: null,
      keycloakAdminPass: null,
      keycloakOperatorPass: null
    }
  })

  return Response.json({ ok: true })
}
