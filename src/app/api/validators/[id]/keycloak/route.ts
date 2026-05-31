import crypto from 'crypto'

import { Client } from 'ssh2'

import { prisma } from '@/lib/prisma'
import { encryptSecret } from '@/lib/secrets'

type ValidatorRow = {
  host: string
  sshPort: number
  sshUsername: string
  sshAuthType: string
  sshPassword: string | null
  sshPrivateKey: string | null
}

function connectSSH(v: ValidatorRow): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    const timeout = setTimeout(() => { conn.end(); reject(new Error('SSH timed out')) }, 30000)

    conn.on('ready', () => { clearTimeout(timeout); resolve(conn) })
    conn.on('error', err => { clearTimeout(timeout); reject(err) })

    const cfg: Record<string, unknown> = {
      host: v.host,
      port: v.sshPort,
      username: v.sshUsername,
      readyTimeout: 15000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 20
    }

    if (v.sshAuthType === 'password') cfg.password = v.sshPassword
    else cfg.privateKey = v.sshPrivateKey

    conn.connect(cfg as Parameters<Client['connect']>[0])
  })
}

function execSSH(conn: Client, cmd: string, onChunk?: (s: string) => void): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)

      let output = ''

      stream.on('data', (d: Buffer) => { const s = d.toString();

 output += s; onChunk?.(s) })
      stream.stderr.on('data', (d: Buffer) => { const s = d.toString();

 output += s; onChunk?.(s) })
      stream.on('close', (code: number) => resolve({ code, output: output.trim() }))
    })
  })
}

function escapeForDoubleQuotedShell(value: string): string {
  if (/[\n\r\x00]/.test(value)) throw new Error('Invalid characters in credential')

  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
}

// POST /api/validators/[id]/keycloak
// Deploy Keycloak container on the VPS via SSH, create realm + 4 Splice clients,
// then save auth config back to ValidatorConfig. Streams SSE log events.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await req.json().catch(() => ({})) as {
    port?: number
    realm?: string
    adminUsername?: string
    adminPassword?: string
    operatorUsername?: string
    operatorPassword?: string
  }

  const port: number = Number(body.port ?? 8180)
  const realm: string = String(body.realm ?? 'canton').replace(/[^a-z0-9-]/gi, '')
  const adminUsername: string = String(body.adminUsername ?? 'admin').trim()
  const operatorUsername: string = String(body.operatorUsername ?? 'operator').trim()
  const inputAdminPassword = String(body.adminPassword ?? '').trim()
  const inputOperatorPassword = String(body.operatorPassword ?? '').trim()
  const usernameRegex = /^[a-zA-Z0-9._-]{3,64}$/

  if (port < 1024 || port > 65535) {
    return new Response(JSON.stringify({ error: 'Invalid port' }), { status: 400 })
  }

  if (!usernameRegex.test(adminUsername)) {
    return new Response(JSON.stringify({ error: 'Invalid admin username format' }), { status: 400 })
  }

  if (!usernameRegex.test(operatorUsername)) {
    return new Response(JSON.stringify({ error: 'Invalid operator username format' }), { status: 400 })
  }

  if (inputAdminPassword && inputAdminPassword.length < 8) {
    return new Response(JSON.stringify({ error: 'Admin password must be at least 8 characters' }), { status: 400 })
  }

  if (inputOperatorPassword && inputOperatorPassword.length < 8) {
    return new Response(JSON.stringify({ error: 'Operator password must be at least 8 characters' }), { status: 400 })
  }

  // Backward-compatible fallback for older clients that don't send password fields.
  const adminPass = inputAdminPassword || crypto.randomBytes(15).toString('base64url').slice(0, 20)
  const operatorPassword = inputOperatorPassword || crypto.randomBytes(12).toString('base64url')

  const validator = await prisma.validator.findUnique({ where: { id }, include: { config: true } })

  if (!validator) {
    return new Response(JSON.stringify({ error: 'Validator not found' }), { status: 404 })
  }

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

      let conn: Client | null = null

      try {
        emit('info', `Connecting to ${validator.host}:${validator.sshPort}…`)
        conn = await connectSSH(validator)
        emit('info', '✓ SSH connected')

        // ── 1. Check Docker is available ──────────────────────────────────
        const dockerCheck = await execSSH(conn, 'docker info --format "{{.ServerVersion}}" 2>&1')

        if (dockerCheck.code !== 0) {
          emit('error', 'Docker is not available on this VPS. Install Docker first.')
          throw new Error('docker not available')
        }

        emit('info', `✓ Docker ${dockerCheck.output.split('\n')[0]}`)

        // ── 2. Remove any existing keycloak-nodepilot container ──────────
        emit('info', 'Removing any existing Keycloak container…')
        await execSSH(conn, 'docker rm -f keycloak-nodepilot 2>/dev/null || true')

        // ── 3. Use requested bootstrap credentials ───────────────────────
        const adminUsernameEsc = escapeForDoubleQuotedShell(adminUsername)
        const adminPassEsc = escapeForDoubleQuotedShell(adminPass)

        // ── 4. Pull Keycloak image ────────────────────────────────────────
        emit('info', 'Pulling Keycloak image (quay.io/keycloak/keycloak:26.2)…')
        emit('info', 'This may take 2–5 minutes on first pull (image ~400 MB)…')

        const pull = await execSSH(
          conn,
          'docker pull quay.io/keycloak/keycloak:26.2 2>&1 | tail -5',
          c => emit('stdout', c.trimEnd())
        )

        if (pull.code !== 0) {
          emit('error', `docker pull failed (code ${pull.code})`)
          throw new Error('docker pull failed')
        }

        emit('info', '✓ Image ready')

        // ── 5. Start Keycloak container ───────────────────────────────────
        emit('info', `Starting Keycloak on port ${port}…`)

        // Build public hostname so Keycloak generates correct redirect URIs when
        // accessed via nginx HTTPS reverse proxy.
        const cfg = validator.config
        const kcSubdomain = cfg?.keycloakSubdomain ?? 'auth'
        const baseDomain = cfg?.baseDomain

        const kcPublicUrl = baseDomain
          ? `https://${kcSubdomain}.${baseDomain}`
          : undefined

        const runCmd = [
          'docker run -d',
          '--name keycloak-nodepilot',
          '--restart unless-stopped',
          `-p 127.0.0.1:${port}:8080`,
          `-e KC_BOOTSTRAP_ADMIN_USERNAME=${adminUsernameEsc}`,
          `-e "KC_BOOTSTRAP_ADMIN_PASSWORD=${adminPassEsc}"`,
          `-e KEYCLOAK_ADMIN=${adminUsernameEsc}`,
          `-e "KEYCLOAK_ADMIN_PASSWORD=${adminPassEsc}"`,

          // Tell Keycloak it's behind an HTTPS reverse proxy
          `-e KC_PROXY_HEADERS=xforwarded`,
          `-e KC_HTTP_ENABLED=true`,
          `-e KC_HOSTNAME_STRICT=false`,
          ...(kcPublicUrl ? [`-e KC_HOSTNAME=${kcPublicUrl}`] : []),
          'quay.io/keycloak/keycloak:26.2 start-dev'
        ].join(' ')

        const runResult = await execSSH(conn, `${runCmd} 2>&1`)

        if (runResult.code !== 0) {
          emit('error', `Failed to start Keycloak: ${runResult.output}`)
          throw new Error('keycloak start failed')
        }

        emit('info', `✓ Container started: ${runResult.output.slice(0, 12)}…`)

        // ── 6+7. Poll until admin token succeeds (up to 5 min) ────────────
        // We poll the token endpoint directly. /realms/master returning 200
        // does NOT mean the admin user is ready — so we skip that check and
        // just try the token endpoint until it works.
        emit('info', 'Waiting for Keycloak admin API to be ready (up to 5 min)…')

        const kcBase = `http://localhost:${port}`
        let accessToken = ''

        for (let i = 1; i <= 60; i++) {
          // --max-time 4 so curl doesn't hang if port isn't open yet
          const tryToken = await execSSH(conn,
            `curl -s --max-time 4 -X POST "${kcBase}/realms/master/protocol/openid-connect/token"` +
            ` -H "Content-Type: application/x-www-form-urlencoded"` +
            ` -d "grant_type=password&client_id=admin-cli&username=${encodeURIComponent(adminUsername)}&password=${encodeURIComponent(adminPass)}"`
          )

          const body = tryToken.output.trim()

          if (body.includes('"access_token"')) {
            try {
              accessToken = JSON.parse(body).access_token ?? ''
            } catch {
              const m = body.match(/"access_token"\s*:\s*"([^"]+)"/)

              if (m) accessToken = m[1]
            }

            if (accessToken) break
          }

          // Show every attempt so user sees progress
          const shortErr = body.slice(0, 80).replace(/\n/g, ' ')

          emit('stdout', `[${i}/60] Not ready yet — ${shortErr || 'no response'}`)

          // Sleep in Node.js — no extra SSH round-trip overhead
          await new Promise(r => setTimeout(r, 4000))
        }

        if (!accessToken) {
          const logsResult = await execSSH(conn, 'docker logs --tail 30 keycloak-nodepilot 2>&1')

          emit('error', 'Keycloak admin API did not become ready within 5 minutes.')
          emit('error', `Container logs:\n${logsResult.output}`)
          throw new Error('token fetch failed')
        }

        emit('info', '✓ Keycloak admin API ready')

        // ── 8. Create realm ────────────────────────────────────────────────
        emit('info', `Creating realm "${realm}"…`)

        const realmPayload = JSON.stringify({
          realm,
          enabled: true,
          displayName: 'Canton Network',
          accessTokenLifespan: 3600,
          ssoSessionIdleTimeout: 36000,
          ssoSessionMaxLifespan: 86400
        })

        const createRealmCmd = [
          `curl -sf -X POST "http://localhost:${port}/admin/realms"`,
          `-H "Authorization: Bearer ${accessToken}"`,
          `-H "Content-Type: application/json"`,
          `-d '${realmPayload.replace(/'/g, "'\\''")}'`,
          `-o /dev/null -w "%{http_code}"`
        ].join(' ')

        const realmResult = await execSSH(conn, createRealmCmd)

        if (!['201', '409'].includes(realmResult.output.trim())) {
          emit('error', `Create realm failed (HTTP ${realmResult.output.trim()})`)
          throw new Error('realm creation failed')
        }

        emit('info', realmResult.output.trim() === '409' ? `Realm "${realm}" already exists — continuing` : `✓ Realm "${realm}" created`)

        // ── 9. Helper: create client + get secret ─────────────────────────
        const createClient = async (clientId: string, confidential: boolean): Promise<string | null> => {
          const clientPayload = JSON.stringify({
            clientId,
            enabled: true,
            publicClient: !confidential,
            serviceAccountsEnabled: confidential,
            standardFlowEnabled: !confidential ? true : false,
            directAccessGrantsEnabled: false,
            ...(confidential ? {} : {
              redirectUris: ['*'],
              webOrigins: ['*']
            })
          })

          const createClientCmd = [
            `curl -sf -X POST "http://localhost:${port}/admin/realms/${realm}/clients"`,
            `-H "Authorization: Bearer ${accessToken}"`,
            `-H "Content-Type: application/json"`,
            `-d '${clientPayload.replace(/'/g, "'\\''")}'`,
            `-o /dev/null -w "%{http_code}"`
          ].join(' ')

          const createResult = await execSSH(conn!, createClientCmd)
          const httpCode = createResult.output.trim()

          if (!['201', '409'].includes(httpCode)) {
            throw new Error(`Create client ${clientId} failed (HTTP ${httpCode})`)
          }

          if (!confidential) return null

          // Get client UUID
          const listCmd = [
            `curl -sf "http://localhost:${port}/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}"`,
            `-H "Authorization: Bearer ${accessToken}"`
          ].join(' ')

          const listResult = await execSSH(conn!, listCmd)
          const clients = JSON.parse(listResult.output) as Array<{ id: string }>

          if (!clients.length) throw new Error(`Client ${clientId} not found after create`)

          const uuid = clients[0].id

          // Get client secret
          const secretCmd = [
            `curl -sf "http://localhost:${port}/admin/realms/${realm}/clients/${uuid}/client-secret"`,
            `-H "Authorization: Bearer ${accessToken}"`
          ].join(' ')

          const secretResult = await execSSH(conn!, secretCmd)
          const secret = JSON.parse(secretResult.output).value as string

          if (!secret) throw new Error(`No secret for client ${clientId}`)

          return secret
        }

        // ── 10. Create 4 Splice clients ───────────────────────────────────
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

        // ── 10a. Create operator user ─────────────────────────────────────
        // The human operator needs a Keycloak user to log into wallet-ui.
        // WALLET_ADMIN_USER must be set to this user's UUID so the validator
        // recognizes them as the wallet admin (party owner).
        emit('info', `Creating operator user "${operatorUsername}"…`)

        const createUserCmd = [
          `curl -sf -X POST "http://localhost:${port}/admin/realms/${realm}/users"`,
          `-H "Authorization: Bearer ${accessToken}"`,
          `-H "Content-Type: application/json"`,
          `-d '${JSON.stringify({
            username: operatorUsername,
            enabled: true,
            credentials: [{ type: 'password', value: operatorPassword, temporary: false }]
          }).replace(/'/g, "'\\''")}'`,
          `-o /dev/null -w "%{http_code}"`
        ].join(' ')

        const createUserCode = (await execSSH(conn!, createUserCmd)).output.trim()

        // 201 = created, 409 = already exists
        if (!['201', '409'].includes(createUserCode)) {
          throw new Error(`Failed to create operator user (HTTP ${createUserCode})`)
        }

        // Resolve UUID
        const userListResult = await execSSH(conn,
          `curl -sf "http://localhost:${port}/admin/realms/${realm}/users?username=${encodeURIComponent(operatorUsername)}&exact=true" -H "Authorization: Bearer ${accessToken}"`)

        const walletAdminUser = (JSON.parse(userListResult.output) as Array<{ id: string }>)[0]?.id

        if (!walletAdminUser) throw new Error('Could not resolve operator user UUID')

        if (createUserCode === '201') {
          emit('info', `✓ Operator user created (UUID: ${walletAdminUser})`)
        } else {
          emit('info', `✓ Operator user already exists (UUID: ${walletAdminUser})`)
        }

        // Fetch the service-account-user UUID for the validator-backend client.
        // The validator-app authenticates to participant's Ledger API using its
        // own client credentials (validator-backend), so the JWT `sub` claim
        // sent to participant is THIS client's service-account UUID. Splice's
        // participant config must match that UUID via `additional-admin-user-id`.
        // Using ledger-api's UUID instead causes:
        //   "Token user <validator-backend-uuid> does not match expected user
        //    <ledger-api-uuid>"
        emit('info', 'Resolving validator-backend service account UUID…')

        const vbClientList = await execSSH(conn,
          `curl -sf "http://localhost:${port}/admin/realms/${realm}/clients?clientId=validator-backend" -H "Authorization: Bearer ${accessToken}"`)

        const vbClientUuid = (JSON.parse(vbClientList.output) as Array<{ id: string }>)[0]?.id

        if (!vbClientUuid) throw new Error('validator-backend client not found after create')

        const saUserResult = await execSSH(conn,
          `curl -sf "http://localhost:${port}/admin/realms/${realm}/clients/${vbClientUuid}/service-account-user" -H "Authorization: Bearer ${accessToken}"`)

        const ledgerApiAdminUser = (JSON.parse(saUserResult.output) as { id: string }).id

        if (!ledgerApiAdminUser) throw new Error('Could not resolve validator-backend service account UUID')

        emit('info', `✓ Ledger admin user (sub): ${ledgerApiAdminUser}`)

        // ── 10b. Add audience mappers ─────────────────────────────────────
        // Splice's participant + validator-app verify the JWT `aud` claim
        // against `LEDGER_API_AUTH_AUDIENCE` / `VALIDATOR_AUTH_AUDIENCE`.
        // Keycloak by default sets `aud` to the client_id (or "account"),
        // so without a custom audience mapper the participant rejects every
        // token with: "Authorization error: Audience doesn't match the
        // target value" → UNAUTHENTICATED → validator restart loop.
        // We add an Audience protocol-mapper on each confidential client
        // that includes the issuer URL as a custom audience.
        const targetAudience = `${(cfg?.baseDomain && cfg.baseDomain.trim())
          ? `https://${kcSubdomain}.${cfg!.baseDomain!.trim()}`
          : `http://${validator.host}:${port}`}/realms/${realm}`

        const addAudienceMapper = async (clientUuid: string, clientId: string) => {
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


          // Idempotent: 409 = already exists, treat as success
          const cmd = [
            `curl -s -X POST "http://localhost:${port}/admin/realms/${realm}/clients/${clientUuid}/protocol-mappers/models"`,
            `-H "Authorization: Bearer ${accessToken}"`,
            `-H "Content-Type: application/json"`,
            `-d '${mapper.replace(/'/g, "'\\''")}'`,
            `-o /dev/null -w "%{http_code}"`
          ].join(' ')

          const r = await execSSH(conn!, cmd)
          const code = r.output.trim()

          if (!['201', '409'].includes(code)) {
            throw new Error(`Add audience mapper to ${clientId} failed (HTTP ${code})`)
          }

          emit('info', `  ✓ ${clientId}: audience mapper ${code === '409' ? 'already present' : 'added'}`)
        }

        emit('info', `Adding audience mapper (aud=${targetAudience})…`)

        // validator-backend: needed for both ledger-api + validator-app calls
        await addAudienceMapper(vbClientUuid, 'validator-backend')


        // ledger-api: needed when wallet/UIs call participant directly
        const ledgerClientList2 = await execSSH(conn,
          `curl -sf "http://localhost:${port}/admin/realms/${realm}/clients?clientId=ledger-api" -H "Authorization: Bearer ${accessToken}"`)

        const ledgerClientUuid2 = (JSON.parse(ledgerClientList2.output) as Array<{ id: string }>)[0]?.id

        if (ledgerClientUuid2) await addAudienceMapper(ledgerClientUuid2, 'ledger-api')

        // wallet-ui + ans-ui: public clients used for browser login. Without
        // the mapper, the user's access_token has aud="wallet-ui" but validator
        // expects aud=issuerUrl → 401 "The supplied authentication is invalid".
        // We also add a User Property mapper that overrides the `sub` claim
        // with the user's `username`, so Splice's WALLET_ADMIN_USER /
        // validatorWalletUsers can be configured by username instead of UUID.
        const addSubAsUsernameMapper = async (clientUuid: string, clientId: string) => {
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

          const cmd = [
            `curl -s -X POST "http://localhost:${port}/admin/realms/${realm}/clients/${clientUuid}/protocol-mappers/models"`,
            `-H "Authorization: Bearer ${accessToken}"`,
            `-H "Content-Type: application/json"`,
            `-d '${mapper.replace(/'/g, "'\\''")}'`,
            `-o /dev/null -w "%{http_code}"`
          ].join(' ')

          const r = await execSSH(conn!, cmd)
          const code = r.output.trim()

          if (!['201', '409'].includes(code)) {
            throw new Error(`Add sub=username mapper to ${clientId} failed (HTTP ${code})`)
          }

          emit('info', `  ✓ ${clientId}: sub=username mapper ${code === '409' ? 'already present' : 'added'}`)
        }

        for (const publicClientId of ['wallet-ui', 'ans-ui']) {
          const cList = await execSSH(conn,
            `curl -sf "http://localhost:${port}/admin/realms/${realm}/clients?clientId=${publicClientId}" -H "Authorization: Bearer ${accessToken}"`)

          const cUuid = (JSON.parse(cList.output) as Array<{ id: string }>)[0]?.id

          if (cUuid) {
            await addAudienceMapper(cUuid, publicClientId)
            await addSubAsUsernameMapper(cUuid, publicClientId)
          }
        }

        // ── 11. Build auth URLs ────────────────────────────────────────────
        // Prefer the public HTTPS domain if the user has configured Public Access.
        // Fall back to direct IP:port (HTTP) only when no domain is configured.
        const hasDomain = !!(cfg?.baseDomain && cfg.baseDomain.trim())

        const keycloakPublicBase = hasDomain
          ? `https://${kcSubdomain}.${cfg!.baseDomain!.trim()}`
          : `http://${validator.host}:${port}`

        const issuerUrl = `${keycloakPublicBase}/realms/${realm}`
        const jwksUrl = `${issuerUrl}/protocol/openid-connect/certs`
        const wellknownUrl = `${issuerUrl}/.well-known/openid-configuration`
        const encryptedAdminPass = encryptSecret(adminPass)
        const encryptedOperatorPass = encryptSecret(operatorPassword)
        const encryptedValidatorSecret = encryptSecret(validatorSecret)

        // walletAdminUser is stored as the operator USERNAME (not UUID).
        // The wallet-ui/ans-ui clients now have a User Property mapper that
        // overrides JWT `sub` with the username, so Splice will match
        // WALLET_ADMIN_USER / validatorWalletUsers against the username string.
        const walletAdminUserToStore = operatorUsername

        // ── 12. Save to DB ────────────────────────────────────────────────
        emit('info', 'Saving configuration…')

        await prisma.validatorConfig.upsert({
          where: { validatorId: id },
          create: {
            validatorId: id,
            keycloakEnabled: true,
            keycloakPort: port,
            keycloakRealm: realm,
            keycloakAdminPass: encryptedAdminPass,
            keycloakOperatorPass: encryptedOperatorPass,
            keycloakDeployedAt: new Date(),

            // Auth config pre-filled
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
            ledgerApiAudience: `${keycloakPublicBase}/realms/${realm}`,
            validatorAudience: `${keycloakPublicBase}/realms/${realm}`
          },
          update: {
            keycloakEnabled: true,
            keycloakPort: port,
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
            ledgerApiAudience: `${keycloakPublicBase}/realms/${realm}`,
            validatorAudience: `${keycloakPublicBase}/realms/${realm}`
          }
        })

        emit('info', '✓ Configuration saved')
        emit('info', '')
        emit('info', `┌─────────────────────────────────────────────────────`)
        emit('info', `│  Keycloak ready at: ${keycloakPublicBase}`)
        emit('info', `│  Admin console: ${keycloakPublicBase}/admin`)
        emit('info', `│`)
        emit('info', `│  Admin username: ${adminUsername}`)
        emit('info', `│  Operator username (${realm}): ${operatorUsername}`)
        emit('info', `│  Passwords are generated and stored server-side (not shown in logs).`)
        emit('info', `│`)
        emit('info', `│  Realm: ${realm}`)
        emit('info', `│  Issuer: ${issuerUrl}`)
        emit('info', `└───────────────────────────────────────────────────`)
        emit('info', '')
        emit('info', '✅ Keycloak deployment complete!')
        emit('warn', '⚠  Auth Config has been pre-filled. Review & restart the validator to apply.')

        done(true, `Keycloak running on port ${port}, realm "${realm}", auth config pre-filled.`)
      } catch (err: unknown) {
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
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  })
}

// DELETE /api/validators/[id]/keycloak
// Stop and remove the Keycloak container, clear keycloakDeployedAt.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })

  const conn = await connectSSH(validator as ValidatorRow)

  try {
    await new Promise<void>((resolve, reject) =>
      conn.exec('docker rm -f keycloak-nodepilot 2>&1', (err, stream) => {
        if (err) return reject(err)
        stream.on('close', () => resolve())
        stream.resume()
      })
    )
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

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
}
