import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const VALID = ['DevNet', 'TestNet', 'MainNet'] as const

const presetSchema = z.object({
  sponsorSvUrl: z.string().trim().url().or(z.literal('')),
  scanUrl: z.string().trim().url().or(z.literal('')),
  sequencerUrl: z.string().trim().url().or(z.literal('')),
  migrationId: z.number().int().min(0).nullable()
})

export async function GET() {
  const presets = await prisma.networkPreset.findMany()

  // Ensure all three networks always exist in the response
  const map = new Map(presets.map(p => [p.network, p]))

  const result = VALID.map(net => map.get(net) ?? {
    network: net,
    sponsorSvUrl: '',
    scanUrl: '',
    sequencerUrl: '',
    migrationId: null,
    updatedAt: null
  })

  return NextResponse.json({ presets: result })
}

export async function PUT(req: Request) {
  let body: unknown

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const schema = z.object({
    network: z.enum(VALID),
    ...presetSchema.shape
  })

  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { network, sponsorSvUrl, scanUrl, sequencerUrl, migrationId } = parsed.data

  const preset = await prisma.networkPreset.upsert({
    where: { network },
    update: { sponsorSvUrl, scanUrl, sequencerUrl, migrationId },
    create: { network, sponsorSvUrl, scanUrl, sequencerUrl, migrationId }
  })

  return NextResponse.json({ preset })
}
