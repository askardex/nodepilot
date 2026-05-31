import { Client } from 'ssh2'

import { prisma } from '@/lib/prisma'

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

// POST /api/validators/[id]/stop
// Streams `docker compose down` (or stop.sh if present) output.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) {
    return new Response(JSON.stringify({ error: 'Validator not found' }), { status: 404 })
  }

  if (!validator.installPath) {
    return new Response(JSON.stringify({ error: 'Splice node not installed' }), { status: 400 })
  }

  const root = `${validator.installPath}/docker-compose/validator`

  await prisma.validator.update({ where: { id }, data: { runState: 'Stopping' } })

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

      try {
        log('info', `Connecting to ${validator.host}…`)
        conn = await connectSSH(validator)

        log('info', 'Stopping validator stack…')

        // Prefer stop.sh (knows about the right compose file overlays); fall
        // back to plain `docker compose down`.
        const cmd = `cd "${root}" && (test -x ./stop.sh && ./stop.sh || docker compose down)`
        const result = await execStream(conn, cmd, c => log('stdout', c.trimEnd()))

        if (result.code !== 0) {
          log('warn', `stop returned exit ${result.code} — containers may already be down`)
        }

        // Stop Keycloak too — it's deployed separately by Nodepilot, so
        // stop.sh doesn't touch it. Idempotent (silent if not running).
        log('info', 'Stopping Keycloak (if running)…')
        await execStream(conn,
          'docker stop keycloak-nodepilot 2>/dev/null; true',
          c => log('stdout', c.trimEnd()))

        conn.end()

        await prisma.validator.update({
          where: { id },
          data: { runState: 'Stopped', lastStoppedAt: new Date(), status: 'Offline' }
        })

        log('info', '✓ Validator stopped')
        done()
      } catch (err) {
        if (conn) conn.end()

        const msg = err instanceof Error ? err.message : 'unknown error'

        log('error', msg)

        await prisma.validator.update({
          where: { id },
          data: { runState: 'StartError', lastStartError: msg }
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
