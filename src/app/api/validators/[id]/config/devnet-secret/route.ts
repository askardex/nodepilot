import { NextResponse } from 'next/server'

import { Client } from 'ssh2'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// POST: request a one-time onboarding secret from a DevNet sponsor SV.
// Body: { sponsorSvUrl: string }
//
// Note: the sponsor SV's `/api/sv/v0/devnet/onboard/validator/prepare`
// endpoint is IP-whitelisted to validator hosts. We therefore SSH into
// the validator and execute `curl` from there instead of calling it
// directly from the NodePilot server.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  if (validator.network !== 'DevNet') {
    return NextResponse.json(
      { error: 'Auto-generate is only available for DevNet sponsors' },
      { status: 400 }
    )
  }

  let body: { sponsorSvUrl?: string }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sponsorSvUrl = (body.sponsorSvUrl || '').trim().replace(/\/+$/, '')

  if (!sponsorSvUrl) {
    return NextResponse.json({ error: 'sponsorSvUrl is required' }, { status: 400 })
  }

  let parsed: URL

  try {
    parsed = new URL(sponsorSvUrl)
  } catch {
    return NextResponse.json({ error: 'sponsorSvUrl must be a valid URL' }, { status: 400 })
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return NextResponse.json({ error: 'sponsorSvUrl must be http(s)' }, { status: 400 })
  }

  const target = `${sponsorSvUrl}/api/sv/v0/devnet/onboard/validator/prepare`

  // Run curl on the remote validator host (IP is whitelisted there).
  // Append HTTP status as a marker so we can split body / status.
  const remoteCmd = [
    `curl -s -m 20 --connect-timeout 10`,
    `-X POST`,
    `-H 'Content-Type: application/json'`,
    `-d '{}'`,
    `-w '\\n__HTTP_STATUS__:%{http_code}'`,
    `'${target.replace(/'/g, "'\\''")}'`
  ].join(' ')

  let conn: Client | null = null

  try {
    conn = await connectSSH(validator)
    const raw = await execCommand(conn, remoteCmd)

    conn.end()

    const m = raw.match(/__HTTP_STATUS__:(\d+)\s*$/)
    const status = m ? parseInt(m[1], 10) : 0
    const responseBody = m ? raw.slice(0, m.index).trimEnd() : raw

    if (status === 0) {
      return NextResponse.json(
        { error: 'curl failed on validator host', detail: raw.slice(0, 500) },
        { status: 502 }
      )
    }

    if (status < 200 || status >= 300) {
      return NextResponse.json(
        {
          error: `Sponsor SV responded ${status}`,
          detail: responseBody.slice(0, 500),
          hint: status === 403
            ? 'Validator host IP is not whitelisted by the sponsor SV. Contact your sponsor to whitelist this VPS.'
            : undefined
        },
        { status: 502 }
      )
    }

    let secret: string | null = null

    try {
      const json = JSON.parse(responseBody)

      if (typeof json === 'object' && json !== null) {
        // Direct JSON object: { secret: "..." }
        secret = json.secret || json.onboardingSecret || json.onboarding_secret || null
      } else if (typeof json === 'string') {
        // JSON-quoted string — likely base64-encoded JSON from DevNet SV
        // Response format: base64({"sponsoringSv":"...","secret":"...","partyHint":null})
        try {
          const decoded = Buffer.from(json, 'base64').toString('utf8')
          const inner = JSON.parse(decoded)

          secret = inner.secret || null
        } catch {
          // Not valid base64 JSON — use the raw string as the secret
          secret = json
        }
      }
    } catch {
      // Response is not valid JSON — try as raw base64
      const trimmed = responseBody.trim().replace(/^"|"$/g, '')

      try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf8')
        const inner = JSON.parse(decoded)

        secret = inner.secret || null
      } catch {
        // Not base64 either — use as-is if it looks like a token
        if (trimmed.length > 0 && trimmed.length < 500 && !trimmed.includes('\n')) {
          secret = trimmed
        }
      }
    }

    if (!secret) {
      return NextResponse.json(
        { error: 'Sponsor SV did not return a secret', detail: responseBody.slice(0, 500) },
        { status: 502 }
      )
    }

    return NextResponse.json({ secret })
  } catch (err: any) {
    if (conn) conn.end()

    return NextResponse.json(
      { error: 'Failed to reach sponsor SV via validator', detail: String(err?.message || err) },
      { status: 502 }
    )
  }
}

function connectSSH(validator: { host: string; sshPort: number; sshUsername: string; sshAuthType: string; sshPassword: string | null; sshPrivateKey: string | null }): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    const timeout = setTimeout(() => {
      conn.end()
      reject(new Error('SSH connection timed out'))
    }, 15000)

    conn.on('ready', () => { clearTimeout(timeout); resolve(conn) })
    conn.on('error', err => { clearTimeout(timeout); reject(err) })

    const opts: Record<string, unknown> = {
      host: validator.host,
      port: validator.sshPort,
      username: validator.sshUsername,
      readyTimeout: 10000
    }

    if (validator.sshAuthType === 'password') opts.password = validator.sshPassword
    else opts.privateKey = validator.sshPrivateKey

    conn.connect(opts)
  })
}

function execCommand(conn: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err)

        return
      }

      let output = ''

      stream.on('data', (d: Buffer) => { output += d.toString() })
      stream.stderr.on('data', (d: Buffer) => { output += d.toString() })
      stream.on('close', () => resolve(output))
    })
  })
}
