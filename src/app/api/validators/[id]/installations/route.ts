import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// GET /api/validators/[id]/installations
// List all Splice installations recorded for this validator.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({ where: { id }, select: { id: true } })

  if (!validator) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  const installations = await prisma.spliceInstallation.findMany({
    where: { validatorId: id },
    orderBy: [{ isActive: 'desc' }, { installedAt: 'desc' }],
    select: {
      id: true,
      version: true,
      installPath: true,
      isActive: true,
      installedAt: true
    }
  })

  return NextResponse.json({ installations })
}
