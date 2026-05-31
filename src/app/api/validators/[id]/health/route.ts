import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// POST /api/validators/[id]/health - Check validator health
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  let status: string = 'Offline'
  let version: string | null = null

  try {
    // Probe the validator's health endpoint via HTTP
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const url = `http://${validator.host}:${validator.validatorPort}/api/validator/v0/version`
    const res = await fetch(url, {
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (res.ok) {
      const data = await res.json()

      status = 'Online'
      version = data.version || data.Version || null
    } else {
      status = 'Error'
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      status = 'Offline'
    } else {
      status = 'Error'
    }
  }

  const updated = await prisma.validator.update({
    where: { id },
    data: {
      status,
      version,
      lastHealthCheck: new Date(),
      lastSyncAt: status === 'Online' ? new Date() : validator.lastSyncAt
    },
    select: {
      id: true,
      name: true,
      status: true,
      version: true,
      lastHealthCheck: true,
      lastSyncAt: true
    }
  })

  return NextResponse.json(updated)
}
