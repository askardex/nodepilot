import { NextResponse } from 'next/server'

import { z } from 'zod'
import { Client } from 'ssh2'

const testConnectionSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(255)
    .trim()
    .refine(
      val => {
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/
        const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/

        return ipRegex.test(val) || hostnameRegex.test(val)
      },
      { message: 'Must be a valid IP address or hostname' }
    ),
  port: z.number().int().min(1).max(65535).default(22),
  authType: z.enum(['password', 'key']),
  username: z.string().min(1).max(100),
  password: z.string().max(500).optional(),
  privateKey: z.string().max(10000).optional()
})

// POST /api/validators/test-connection
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = testConnectionSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { host, port, authType, username, password, privateKey } = parsed.data

    // Validate auth credentials present
    if (authType === 'password' && !password) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    if (authType === 'key' && !privateKey) {
      return NextResponse.json({ error: 'Private key is required' }, { status: 400 })
    }

    const result = await testSSHConnection({ host, port, username, password, privateKey, authType })

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function testSSHConnection(opts: {
  host: string
  port: number
  username: string
  authType: string
  password?: string
  privateKey?: string
}): Promise<{ success: boolean; message: string; hostname?: string }> {
  return new Promise(resolve => {
    const conn = new Client()
    const timeout = setTimeout(() => {
      conn.end()
      resolve({ success: false, message: 'Connection timed out (10s)' })
    }, 10000)

    conn.on('ready', () => {
      // Get hostname to confirm we're connected
      conn.exec('hostname', (err, stream) => {
        if (err) {
          clearTimeout(timeout)
          conn.end()
          resolve({ success: true, message: 'Connected (could not read hostname)' })

          return
        }

        let output = ''

        stream.on('data', (data: Buffer) => {
          output += data.toString()
        })

        stream.on('close', () => {
          clearTimeout(timeout)
          conn.end()
          resolve({
            success: true,
            message: 'Connection successful',
            hostname: output.trim()
          })
        })
      })
    })

    conn.on('error', (err: Error) => {
      clearTimeout(timeout)

      let message = 'Connection failed'

      if (err.message.includes('Authentication')) {
        message = 'Authentication failed - check username/password'
      } else if (err.message.includes('ECONNREFUSED')) {
        message = 'Connection refused - check host and port'
      } else if (err.message.includes('ETIMEDOUT') || err.message.includes('EHOSTUNREACH')) {
        message = 'Host unreachable - check IP address'
      } else {
        message = `Connection failed: ${err.message}`
      }

      resolve({ success: false, message })
    })

    const connectOpts: Record<string, unknown> = {
      host: opts.host,
      port: opts.port,
      username: opts.username,
      readyTimeout: 10000
    }

    if (opts.authType === 'password') {
      connectOpts.password = opts.password
    } else {
      connectOpts.privateKey = opts.privateKey
    }

    conn.connect(connectOpts)
  })
}
