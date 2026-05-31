import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { updateValidatorSchema } from '@/lib/validators.schema'

// GET /api/validators/[id] - Get single validator
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      host: true,
      sshPort: true,
      network: true,
      deploymentMode: true,
      validatorPort: true,
      version: true,
      partyId: true,
      synchronizerId: true,
      hostname: true,
      status: true,
      uptime: true,
      lastSyncAt: true,
      lastHealthCheck: true,
      installState: true,
      spliceVersion: true,
      installPath: true,
      installError: true,
      installedAt: true,
      runState: true,
      lastStartedAt: true,
      lastStoppedAt: true,
      lastStartError: true,
      createdAt: true,
      updatedAt: true
      // SSH credentials excluded for security
    }
  })

  if (!validator) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  return NextResponse.json(validator)
}

// PATCH /api/validators/[id] - Update validator
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const body = await request.json()
    const parsed = updateValidatorSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const existing = await prisma.validator.findUnique({ where: { id } })

    if (!existing) {
      return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
    }

    const validator = await prisma.validator.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        host: true,
        sshPort: true,
        network: true,
        deploymentMode: true,
        version: true,
        status: true,
        updatedAt: true
      }
    })

    return NextResponse.json(validator)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/validators/[id] - Delete validator
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const existing = await prisma.validator.findUnique({ where: { id } })

  if (!existing) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  await prisma.validator.delete({ where: { id } })

  return NextResponse.json({ message: 'Validator deleted' })
}
