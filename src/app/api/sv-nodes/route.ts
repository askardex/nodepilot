import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// GET /api/sv-nodes?network=DevNet
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const network = searchParams.get('network') || 'DevNet'

  const nodes = await prisma.svScanNode.findMany({
    where: { network },
    orderBy: { name: 'asc' }
  })

  return NextResponse.json(nodes)
}
