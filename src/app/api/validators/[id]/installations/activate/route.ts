import { NextResponse } from 'next/server'
import { Client } from 'ssh2'

import { prisma } from '@/lib/prisma'

function connectSSH(validator: {
  host: string
  sshPort: number
  sshUsername: string
  sshAuthType: string
  sshPassword: string | null
  sshPrivateKey: string | null
}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    const timeout = setTimeout(() => {
      conn.end()
      reject(new Error('SSH connection timed out'))
    }, 20000)

    conn.on('ready', () => { clearTimeout(timeout); resolve(conn) })
    conn.on('error', err => { clearTimeout(timeout); reject(err) })

    const config: Record<string, unknown> = {
      host: validator.host,
      port: validator.sshPort,
      username: validator.sshUsername,
      readyTimeout: 15000
    }

    if (validator.sshAuthType === 'password') {
      config.password = validator.sshPassword
    } else {
      config.privateKey = validator.sshPrivateKey
    }

    conn.connect(config as Parameters<Client['connect']>[0])
  })
}

function exec(conn: Client, cmd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)

      let output = ''

      stream.on('data', (data: Buffer) => { output += data.toString() })
      stream.stderr.on('data', (data: Buffer) => { output += data.toString() })
      stream.on('close', (code: number) => resolve({ code, output: output.trim() }))
    })
  })
}

// POST /api/validators/[id]/installations/activate { version }
// Mark a specific installed version as the active one. Mirrors active path
// onto Validator.spliceVersion / installPath so docker-compose commands use it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { version?: string } = {}

  try { body = await request.json() } catch { /* empty */ }

  const version = body.version?.trim()

  if (!version) {
    return NextResponse.json({ error: 'Missing version' }, { status: 400 })
  }

  const installation = await prisma.spliceInstallation.findUnique({
    where: { validatorId_version: { validatorId: id, version } }
  })

  if (!installation) {
    return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
  }

  await prisma.$transaction([
    prisma.spliceInstallation.updateMany({
      where: { validatorId: id },
      data: { isActive: false }
    }),
    prisma.spliceInstallation.update({
      where: { validatorId_version: { validatorId: id, version } },
      data: { isActive: true }
    }),
    prisma.validator.update({
      where: { id },
      data: {
        spliceVersion: version,
        installPath: installation.installPath,
        installState: 'Installed'
      }
    })
  ])

  return NextResponse.json({ ok: true, version, installPath: installation.installPath })
}

// DELETE /api/validators/[id]/installations/activate?version=...
// Uninstall a version: remove its directory on the host and delete the row.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  const version = url.searchParams.get('version')?.trim()

  if (!version) {
    return NextResponse.json({ error: 'Missing version' }, { status: 400 })
  }

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  const installation = await prisma.spliceInstallation.findUnique({
    where: { validatorId_version: { validatorId: id, version } }
  })

  if (!installation) {
    return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
  }

  // Safety: require the path to be under /root/splice-nodes/ to avoid catastrophic rm -rf
  if (!installation.installPath.startsWith('/root/splice-nodes/')) {
    return NextResponse.json(
      { error: `Refusing to remove unexpected path: ${installation.installPath}` },
      { status: 400 }
    )
  }

  let removeOutput = ''
  let conn: Client | null = null

  try {
    conn = await connectSSH(validator)
    const result = await exec(conn, `rm -rf ${installation.installPath} && echo OK`)

    removeOutput = result.output

    if (result.code !== 0) {
      return NextResponse.json({ error: `rm failed: ${result.output}` }, { status: 500 })
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    if (conn) conn.end()
  }

  // Remove DB row, then re-sync mirrored fields on Validator
  await prisma.spliceInstallation.delete({
    where: { validatorId_version: { validatorId: id, version } }
  })

  const remaining = await prisma.spliceInstallation.findMany({
    where: { validatorId: id },
    orderBy: { installedAt: 'desc' }
  })

  if (remaining.length === 0) {
    await prisma.validator.update({
      where: { id },
      data: {
        installState: 'NotInstalled',
        spliceVersion: null,
        installPath: null,
        installedAt: null
      }
    })
  } else if (installation.isActive) {
    // Promote the most recent remaining install to active
    const next = remaining[0]

    await prisma.$transaction([
      prisma.spliceInstallation.update({
        where: { id: next.id },
        data: { isActive: true }
      }),
      prisma.validator.update({
        where: { id },
        data: {
          spliceVersion: next.version,
          installPath: next.installPath,
          installState: 'Installed'
        }
      })
    ])
  }

  return NextResponse.json({ ok: true, removed: version, output: removeOutput })
}
