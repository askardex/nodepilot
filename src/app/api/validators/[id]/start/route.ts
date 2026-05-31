import { Client } from 'ssh2'

import { prisma } from '@/lib/prisma'
import { decryptSecret } from '@/lib/secrets'

type Validator = {
  host: string
  sshPort: number
  sshUsername: string
  sshAuthType: string
  sshPassword: string | null
  sshPrivateKey: string | null
}

function connectSSH(v: Validator): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    const timeout = setTimeout(() => { conn.end(); reject(new Error('SSH connection timed out')) }, 30000)

    conn.on('ready', () => { clearTimeout(timeout); resolve(conn) })
    conn.on('error', err => { clearTimeout(timeout); reject(err) })

    const config: Record<string, unknown> = {
      host: v.host,
      port: v.sshPort,
      username: v.sshUsername,
      readyTimeout: 15000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 20
    }

    if (v.sshAuthType === 'password') config.password = v.sshPassword
    else config.privateKey = v.sshPrivateKey

    conn.connect(config as Parameters<Client['connect']>[0])
  })
}

function execStream(conn: Client, cmd: string, onChunk?: (s: string) => void): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)

      let output = ''

      stream.on('data', (d: Buffer) => { const c = d.toString();

 output += c; onChunk?.(c) })
      stream.stderr.on('data', (d: Buffer) => { const c = d.toString();

 output += c; onChunk?.(c) })
      stream.on('close', (code: number) => resolve({ code, output: output.trim() }))
    })
  })
}

// Shell-escape a value for safe use inside double quotes. Refuses anything with
// control chars / backticks / $() — these should never appear in legitimate
// config values and would be a code-injection vector via SSH.
function shq(value: string): string {
  if (/[`$\\\n\r\x00]/.test(value)) {
    throw new Error(`unsafe shell value: ${value.slice(0, 40)}…`)
  }

  return `"${value.replace(/"/g, '\\"')}"`
}

// POST /api/validators/[id]/start
// Streams SSE log events while running start.sh on the remote VPS.
// Reads all flags from ValidatorConfig (sponsorSvUrl, scanUrl, sequencerUrl,
// migrationId, partyHint, onboardingSecret, disableBft, trafficThroughput).
// On success: marks validator runState=Running and pins firstStartedAt
// (after which partyHint is immutable).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({ where: { id }, include: { config: true } })

  if (!validator) {
    return new Response(JSON.stringify({ error: 'Validator not found' }), { status: 404 })
  }

  if (!validator.installPath || validator.installState !== 'Installed') {
    return new Response(JSON.stringify({ error: 'Splice node is not installed yet — run Install first.' }), { status: 400 })
  }

  const cfg = validator.config

  if (!cfg) {
    return new Response(JSON.stringify({ error: 'Network config missing — fill the Network Config card first.' }), { status: 400 })
  }

  let onboardingSecret: string | null
  let validatorClientSecret: string | null

  try {
    onboardingSecret = decryptSecret(cfg.onboardingSecret)
    validatorClientSecret = decryptSecret(cfg.validatorClientSecret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    return new Response(JSON.stringify({ error: `Stored secret decryption failed: ${msg}` }), { status: 500 })
  }

  // Required Stage-3 fields
  const missing: string[] = []

  if (!cfg.sponsorSvUrl) missing.push('sponsorSvUrl')
  if (!cfg.scanUrl) missing.push('scanUrl')
  if (!cfg.sequencerUrl) missing.push('sequencerUrl')
  if (cfg.migrationId === null || cfg.migrationId === undefined) missing.push('migrationId')
  if (!cfg.partyHint) missing.push('partyHint')

  if (missing.length) {
    return new Response(JSON.stringify({ error: `Network config incomplete: ${missing.join(', ')}` }), { status: 400 })
  }

  // OnboardingSecret is required for the FIRST start. After firstStartedAt
  // is set, the secret is single-use (already consumed) and start.sh ignores it.
  const isFirstStart = !cfg.firstStartedAt

  if (isFirstStart && !onboardingSecret) {
    return new Response(JSON.stringify({ error: 'onboardingSecret required for first start' }), { status: 400 })
  }

  const validatorRoot = `${validator.installPath}/docker-compose/validator`
  const imageTag = validator.spliceVersion ?? '0.5.17'

  // Mark Starting before opening the stream so the UI sees the state change.
  await prisma.validator.update({
    where: { id },
    data: { runState: 'Starting', lastStartError: null }
  })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const log = (level: 'info' | 'warn' | 'error' | 'stdout' | 'stderr', message: string) => {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ timestamp: new Date().toISOString(), level, message })}\n\n`
        ))
      }

      const done = () => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: '__DONE__' })}\n\n`))
        controller.close()
      }

      let conn: Client | null = null
      let collected = ''
      const collect = (c: string) => { collected += c }

      try {
        log('info', `Connecting to ${validator.host}:${validator.sshPort}…`)
        conn = await connectSSH(validator)
        log('info', '✓ SSH connected')

        // Verify install layout
        log('info', `Verifying ${validatorRoot}…`)

        const verify = await execStream(conn, `test -x ${shq(`${validatorRoot}/start.sh`)} && echo OK`)

        if (!verify.output.includes('OK')) {
          log('error', `start.sh not found at ${validatorRoot}/start.sh — was the bundle extracted?`)
          throw new Error('install layout invalid')
        }

        // If Public Access is in domain mode, the host nginx (system) takes
        // ports :80/:443. The container "splice-validator-nginx-1" defaults
        // to publishing :80:80, which collides. Remap it to 127.0.0.1:8080
        // (loopback only) so host nginx can proxy to it. Idempotent — does
        // nothing on subsequent starts. Mirrors canton-ops domainConfigSteps.
        if (cfg.publicAccessMode === 'domain') {
          log('info', 'Domain mode → ensuring splice-nginx is bound to 127.0.0.1:8080…')

          const internalPort = cfg.portSpliceNginx ?? 8080

          // Find the compose file (varies by Splice version: compose.yaml,
          // docker-compose.yaml, or compose-validator.yaml).
          const remapCmd = [
            `cd ${shq(validatorRoot)}`,
            `COMPOSE_FILE=$(ls compose.yaml compose-validator.yaml docker-compose.yaml 2>/dev/null | head -1)`,
            `if [ -z "$COMPOSE_FILE" ]; then echo "ERROR: no compose file found" >&2; exit 1; fi`,
            `echo "Using $COMPOSE_FILE"`,
            `cp -n "$COMPOSE_FILE" "$COMPOSE_FILE.bak" 2>/dev/null || true`,
            // Only rewrite if a :80:80 binding still exists. The sed handles
            // ${HOST_BIND_IP:-127.0.0.1}:80:80 / 0.0.0.0:80:80 / 127.0.0.1:80:80 / "80:80".
            `if grep -qE ':80:80"' "$COMPOSE_FILE" || grep -qE '"80:80"' "$COMPOSE_FILE"; then ` +
              `sed -i -E ` +
                `-e 's@\\$\\{HOST_BIND_IP:-127\\.0\\.0\\.1\\}:80:80@127.0.0.1:${internalPort}:80@' ` +
                `-e 's@"0\\.0\\.0\\.0:80:80"@"127.0.0.1:${internalPort}:80"@' ` +
                `-e 's@"127\\.0\\.0\\.1:80:80"@"127.0.0.1:${internalPort}:80"@' ` +
                `-e 's@^([[:space:]]*-[[:space:]]*)"80:80"@\\1"127.0.0.1:${internalPort}:80"@' ` +
                `"$COMPOSE_FILE" && echo "✓ Remapped splice-nginx to 127.0.0.1:${internalPort}"; ` +
            `else echo "Already remapped (no :80:80 binding found)"; fi`
          ].join(' && ')

          const remap = await execStream(conn, remapCmd, c => log('stdout', c.trimEnd()))

          if (remap.code !== 0) {
            log('error', `Failed to remap splice-nginx ports (code ${remap.code})`)
            throw new Error('compose remap failed')
          }
        }

        // Fix participant health check (safety net for upgrades from older Nodepilot).
        // The canton-participant image's built-in HEALTHCHECK uses "localhost:5061"
        // which resolves to ::1 (IPv6) inside the container, but the gRPC health
        // server only binds to 0.0.0.0 (IPv4) — health check fails → restart loop.
        // We add a compose-level healthcheck that overrides image-level.
        // Install route does this on extract; this is a fallback for existing installs.
        {
          const composeFile = `${validatorRoot}/compose.yaml`
          const hcFixCmd = [
            `if [ -f ${shq(composeFile)} ] && ! grep -q '127.0.0.1:5061' ${shq(composeFile)}; then`,
            `  sed -i '/^  participant:/,/^  [a-z]/{/restart: always/a\\    healthcheck:\\n      test: ["CMD-SHELL", "grpcurl -plaintext 127.0.0.1:5061 grpc.health.v1.Health/Check || exit 1"]\\n      interval: 5s\\n      timeout: 5s\\n      retries: 3\\n      start_period: 600s\n}' ${shq(composeFile)}`,
            `  echo "✓ Patched participant healthcheck (IPv4 127.0.0.1:5061)"`,
            `else echo "Healthcheck already patched"; fi`
          ].join('; ')

          const hcFix = await execStream(conn, hcFixCmd, c => log('stdout', c.trimEnd()))
          if (hcFix.code !== 0) {
            log('warn', `Could not patch participant healthcheck (non-fatal, code ${hcFix.code})`)
          }
        }

        // Same IPv6 issue for validator-app: its image HEALTHCHECK uses
        // "localhost:5003" which resolves to ::1 → health check fails →
        // Docker restarts the container in a loop. Override with IPv4.
        {
          const composeFile = `${validatorRoot}/compose.yaml`
          const validatorPort = cfg.portValidatorApi ?? 5003
          const hcFixCmd = [
            `if [ -f ${shq(composeFile)} ] && ! grep -q '127.0.0.1:${validatorPort}' ${shq(composeFile)}; then`,
            `  sed -i '/^  validator:/,/^  [a-z]/{/restart: always/a\\    healthcheck:\\n      test: ["CMD-SHELL", "curl -sSfk https://127.0.0.1:${validatorPort}/api/validator/livez || exit 1"]\\n      interval: 10s\\n      timeout: 5s\\n      retries: 3\\n      start_period: 600s\n}' ${shq(composeFile)}`,
            `  echo "✓ Patched validator-app healthcheck (IPv4 127.0.0.1:${validatorPort})"`,
            `else echo "Validator-app healthcheck already patched"; fi`
          ].join('; ')

          const hcFix = await execStream(conn, hcFixCmd, c => log('stdout', c.trimEnd()))
          if (hcFix.code !== 0) {
            log('warn', `Could not patch validator-app healthcheck (non-fatal, code ${hcFix.code})`)
          }
        }

        // Port preflight — abort before start.sh if a non-docker, non-splice
        // process is bound to a port we need. Prevents the cryptic "address
        // already in use" failure mid-start (e.g. host nginx vs splice-nginx
        // both wanting :80 in direct-IP mode).
        const isDomain = cfg.publicAccessMode === 'domain'

        const requiredPorts: Array<{ port: number; label: string }> = [
          { port: cfg.portValidatorApi ?? 5003, label: 'Validator API' },
          { port: cfg.portLedgerApi ?? 5001, label: 'Ledger API' },
          { port: cfg.portJsonApi ?? 7575, label: 'JSON Ledger API' },
          { port: cfg.portWalletUi ?? 2000, label: 'Wallet/ANS UI' }
        ]

        if (isDomain) {
          requiredPorts.push({ port: cfg.portSpliceNginx ?? 8080, label: 'Splice nginx (loopback)' })
        } else {
          requiredPorts.push({ port: 80, label: 'Splice nginx' })
        }

        log('info', `Port preflight (${requiredPorts.map(p => p.port).join(', ')})…`)

        const portsAlt = requiredPorts.map(p => p.port).join('|')
        const probeCmd = `ss -Hltnp 2>/dev/null | awk -v ports='^(${portsAlt})$' '{ split($4,a,":"); p=a[length(a)]; if (p ~ ports) print p":"$0 }' || true`
        const probe = await execStream(conn, probeCmd)
        const blockers: string[] = []

        for (const line of probe.output.split('\n').filter(Boolean)) {
          const colon = line.indexOf(':')
          const port = parseInt(line.slice(0, colon), 10)
          const m = line.slice(colon + 1).match(/users:\(\("([^"]+)"/)
          const owner = m?.[1] ?? 'unknown'

          // docker-proxy = previous splice run, will be replaced by compose up
          if (/^docker-proxy$|^docker$|^containerd/.test(owner)) continue

          const label = requiredPorts.find(p => p.port === port)?.label ?? `port ${port}`

          blockers.push(`:${port} (${label}) is held by ${owner}`)
        }

        if (blockers.length > 0) {
          for (const b of blockers) log('error', b)
          log('error', 'Port preflight failed — stop the conflicting service(s) (e.g. `systemctl stop apache2`) and retry.')
          throw new Error(`port conflict: ${blockers.join('; ')}`)
        }

        log('info', '✓ Port preflight clean')

        // Build start.sh flag list. We embed the secret in the shell only via
        // ONBOARD_TOKEN env var that start.sh reads via -o "$ONBOARD_TOKEN".
        const flags: string[] = [
          `-s ${shq(cfg.sponsorSvUrl!)}`,
          `-c ${shq(cfg.scanUrl!)}`,
          `-q ${shq(cfg.sequencerUrl!)}`,
          `-m ${cfg.migrationId}`,
          `-p ${shq(cfg.partyHint!)}`,
          '-E' // bind to 0.0.0.0 for external VPS access
        ]

        if (cfg.disableBft) flags.push('-b')
        if (isFirstStart) flags.push('-o "$ONBOARD_TOKEN"')
        else flags.push('-o ""')

        // Enable authentication (-a flag) when configured.
        // start.sh without -a adds compose-disable-auth.yaml which strips all
        // auth middleware — wallet/ANS are then open to anyone on the network.
        if (cfg.authEnabled) {
          flags.push('-a')
          log('info', `Authentication ENABLED — issuer: ${cfg.authUrl ?? '(not set)'}`)
        } else {
          log('warn', 'Authentication DISABLED — validator is running without auth (DevNet only)')
        }

        log('info', `Starting validator (${isFirstStart ? 'first start' : 'restart'}, IMAGE_TAG=${imageTag})…`)

        // We always run via bash -lc to ensure docker is on $PATH, and we
        // export ONBOARD_TOKEN through the environment to keep the secret
        // out of the argv (visible in `ps`).
        const env: Record<string, string> = {
          IMAGE_TAG: imageTag,
          ONBOARD_TOKEN: isFirstStart ? onboardingSecret ?? '' : '',
          // Network endpoints — required by validator-app config; without
          // these, validator crashes with "Empty string ... admin-api.url".
          // Compose reads these from .env, not shell env.
          SPONSOR_SV_ADDRESS: cfg.sponsorSvUrl!,
          SCAN_ADDRESS: cfg.scanUrl!,
          SEQUENCER_ADDRESS: cfg.sequencerUrl!,
          MIGRATION_ID: String(cfg.migrationId ?? 0),
          PARTY_HINT: cfg.partyHint!,
          PARTICIPANT_IDENTIFIER: cfg.partyHint!,
          ONBOARDING_SECRET: onboardingSecret ?? '',
          CONTACT_POINT: cfg.contactPoint ?? ''
        }

        // Auth env vars — Splice reads these from .env to configure OIDC middleware.
        // Only injected when auth is enabled; otherwise start.sh ignores them.
        if (cfg.authEnabled) {
          if (cfg.authUrl)               env.AUTH_URL                   = cfg.authUrl
          if (cfg.authJwksUrl)           env.AUTH_JWKS_URL               = cfg.authJwksUrl
          if (cfg.authWellknownUrl)      env.AUTH_WELLKNOWN_URL          = cfg.authWellknownUrl
          if (cfg.ledgerApiAudience)     env.LEDGER_API_AUTH_AUDIENCE    = cfg.ledgerApiAudience
          if (cfg.ledgerApiScope)        env.LEDGER_API_AUTH_SCOPE       = cfg.ledgerApiScope
          if (cfg.validatorAudience)     env.VALIDATOR_AUTH_AUDIENCE     = cfg.validatorAudience
          if (cfg.validatorClientId)     env.VALIDATOR_AUTH_CLIENT_ID    = cfg.validatorClientId
          if (validatorClientSecret)     env.VALIDATOR_AUTH_CLIENT_SECRET = validatorClientSecret
          if (cfg.walletUiClientId)      env.WALLET_UI_CLIENT_ID         = cfg.walletUiClientId
          if (cfg.ansUiClientId)         env.ANS_UI_CLIENT_ID            = cfg.ansUiClientId

          // CRITICAL: When auth is on, Splice sets `additional-admin-user-id`
          // on participant + wallet to this value. The participant compares it
          // against the JWT's `sub` claim. Keycloak puts the service-account
          // user's UUID in `sub`, NOT the username string. So this MUST be
          // the UUID resolved by the keycloak deploy step (which queries
          // /admin/realms/{realm}/clients/{uuid}/service-account-user).
          // Empty string fails the Daml User-ID regex → participant crashes.
          const adminUser = cfg.ledgerApiAdminUser
          if (!adminUser) {
            log('error', 'ledgerApiAdminUser is empty — re-run Keycloak setup to populate it')
            throw new Error('ledgerApiAdminUser missing — Keycloak deploy must run first')
          }
          env.LEDGER_API_ADMIN_USER = adminUser
          // WALLET_ADMIN_USER is the human operator who logs into wallet-ui.
          // Their JWT sub = Keycloak user UUID (not the service-account UUID).
          // Falls back to ledgerApiAdminUser if not explicitly set.
          env.WALLET_ADMIN_USER = cfg.walletAdminUser || adminUser
        }

        // Traffic Top-Up — start.sh's default .env template sets
        // TARGET_TRAFFIC_THROUGHPUT=20000 which causes a bootstrap deadlock:
        // the validator reserves 20 KB/s, but a brand-new validator has 0
        // amulets so it can't BUY traffic, so the first tx (to receive faucet)
        // is blocked with HTTP 429 "Traffic balance below reserved". This
        // matches the canton-ops `fixTrafficBootstrap` pattern.
        //
        // We ALWAYS export TARGET_TRAFFIC_THROUGHPUT to override the default:
        // - Auto top-up DISABLED (default)  → 0 = no reservation, bootstrap-safe
        // - Auto top-up ENABLED              → user value (only after wallet has amulets)
        const target = (cfg.autoTopUpEnabled && cfg.trafficThroughput && cfg.trafficThroughput > 0)
          ? cfg.trafficThroughput
          : 0
        env.TARGET_TRAFFIC_THROUGHPUT = String(target)
        env.MIN_TRAFFIC_TOPUP_INTERVAL = (cfg.autoTopUpEnabled && cfg.trafficTopupInterval) || '1m'
        log('info', target > 0
          ? `Auto top-up ENABLED: target=${target} B/s, interval=${env.MIN_TRAFFIC_TOPUP_INTERVAL} (wallet must have amulets)`
          : `Auto top-up DISABLED: TARGET_TRAFFIC_THROUGHPUT=0 (bootstrap-safe — enable later in Network Config)`
        )

        const envExports = Object.entries(env)
          .map(([k, v]) => `export ${k}=${shq(v)}`)
          .join('; ')

        // Docker Compose reads variables from .env file, NOT from shell env.
        // start.sh generates .env but leaves auth/traffic fields empty or with
        // defaults. We patch .env directly so compose picks up the right values.
        // Uses sed to replace existing keys, or appends missing keys.
        // ONBOARD_TOKEN is intentionally excluded — that's a transient shell
        // var consumed by start.sh's `-o` flag.
        // ONBOARDING_SECRET is only injected on first-start: once the party is
        // registered on the SV, the secret is consumed and leaving it in .env
        // is noise. If the user later switches network (migrationId / sponsorSv
        // / scan / sequencer change), the config PUT route clears
        // firstStartedAt → next start is treated as first-start again and the
        // (new) secret is re-injected.
        const envPatchEntries = Object.entries(env).filter(([k]) => {
          if (k === 'ONBOARD_TOKEN') return false
          if (k === 'ONBOARDING_SECRET' && !isFirstStart) return false
          return true
        })
        if (envPatchEntries.length > 0) {
          const envFilePath = `${validatorRoot}/.env`
          const sedParts = envPatchEntries.map(([k, v]) => {
            const escaped = v.replace(/[&/\\]/g, '\\$&').replace(/"/g, '\\"')
            return `-e 's|^${k}=.*|${k}="${escaped}"|'`
          })
          // First sed to replace existing keys, then append any that don't exist
          const appendParts = envPatchEntries.map(([k, v]) => {
            const escaped = v.replace(/'/g, "'\\''")
            return `grep -q '^${k}=' ${shq(envFilePath)} || echo '${k}="${escaped}"' >> ${shq(envFilePath)}`
          })
          const patchCmd = [
            `sed -i ${sedParts.join(' ')} ${shq(envFilePath)} 2>/dev/null || true`,
            ...appendParts
          ].join('; ')

          await execStream(conn, patchCmd)
          log('info', `✓ Patched .env with ${envPatchEntries.length} variable(s)`)
        }

        // Force-remove participant + validator containers so start.sh recreates
        // them with the latest compose.yaml (healthcheck override applies). Other
        // containers (postgres, nginx, UIs) keep running. Idempotent — silent
        // when containers don't exist.
        await execStream(conn,
          'docker rm -f splice-validator-participant-1 splice-validator-validator-1 2>/dev/null; true')

        const cmd = `cd ${shq(validatorRoot)} && ${envExports}; ./start.sh ${flags.join(' ')}`

        // start.sh writes the .env file itself, then runs `docker compose up -d`.
        // It can take a couple of minutes — we stream all output to the client.
        const result = await execStream(conn, cmd, c => {
          collect(c)
          log('stdout', c.trimEnd())
        })

        if (result.code !== 0) {
          log('error', `start.sh exited with code ${result.code}`)
          throw new Error(`start.sh exited ${result.code}`)
        }

        log('info', '✓ start.sh completed — waiting for containers…')

        // Restart Keycloak too if it was deployed (stop route stops it, so we
        // need to bring it back up). Idempotent — silent if container doesn't exist.
        await execStream(conn,
          'docker start keycloak-nodepilot 2>/dev/null && echo "✓ Keycloak started" || true',
          c => log('stdout', c.trimEnd()))

        // Wait for at least 4 containers to be running (postgres, participant,
        // validator-app, nginx — bare minimum). We poll up to 12×5s.
        for (let i = 1; i <= 12; i++) {
          const ps = await execStream(conn,
            `cd ${shq(validatorRoot)} && docker compose ps --status running -q | wc -l`)

          const running = parseInt(ps.output.trim(), 10) || 0

          log('info', `[${i}/12] running containers: ${running}`)

          if (running >= 4) break

          await new Promise(r => setTimeout(r, 5000))
        }

        // Probe livez (port from config; falls back to 5003)
        const livezPort = cfg.portValidatorApi ?? 5003

        log('info', `Probing https://localhost:${livezPort}/livez …`)

        const liveProbe = await execStream(conn,
          `curl -sk -o /dev/null -w '%{http_code}' --max-time 5 https://localhost:${livezPort}/livez || echo 000`)

        const code = liveProbe.output.trim()

        if (/^(200|204)$/.test(code)) {
          log('info', `✓ /livez returned ${code}`)
        } else {
          log('warn', `/livez returned ${code} — validator may still be initializing`)
        }

        conn.end()

        // Mark Running. Pin firstStartedAt on first successful start so
        // partyHint becomes immutable. Clear onboardingSecret if it was
        // single-use (devnet __AUTO__ tokens are already gone, but explicit
        // secrets are kept so users can restart without re-entering them).
        await prisma.validator.update({
          where: { id },
          data: {
            runState: 'Running',
            lastStartedAt: new Date(),
            lastStartError: null,
            lastStartLog: collected.slice(-8000),
            status: 'Online'
          }
        })

        if (isFirstStart) {
          await prisma.validatorConfig.update({
            where: { validatorId: id },
            data: { firstStartedAt: new Date() }
          })
        }

        log('info', '✓ Validator is running')
        done()
      } catch (err) {
        if (conn) conn.end()

        const msg = err instanceof Error ? err.message : 'unknown error'

        log('error', msg)

        await prisma.validator.update({
          where: { id },
          data: {
            runState: 'StartError',
            lastStartError: msg,
            lastStartLog: collected.slice(-8000)
          }
        })

        done()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }
  })
}
