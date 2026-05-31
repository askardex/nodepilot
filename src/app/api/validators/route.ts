import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { generateValidatorId } from '@/lib/id'
import { createValidatorSchema } from '@/lib/validators.schema'

// GET /api/validators - List all validators
export async function GET() {
  const validators = await prisma.validator.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      host: true,
      sshPort: true,
      network: true,
      deploymentMode: true,
      validatorPort: true,
      version: true,
      hostname: true,
      status: true,
      uptime: true,
      lastSyncAt: true,
      lastHealthCheck: true,
      createdAt: true,
      updatedAt: true
      // SSH credentials excluded for security
    }
  })

  return NextResponse.json(validators)
}

// POST /api/validators - Create a new validator
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = createValidatorSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const data = parsed.data

    const validatorId = generateValidatorId()

    const validator = await prisma.validator.create({
      data: {
        id: validatorId,
        name: data.name,
        host: data.host,
        sshPort: data.sshPort,
        sshUsername: data.sshUsername,
        sshAuthType: data.sshAuthType,
        sshPassword: data.sshPassword || null,
        sshPrivateKey: data.sshPrivateKey || null,
        network: data.network,
        hostname: data.hostname || null,
        deploymentMode: data.deploymentMode || 'compose',
        status: 'Unconfigured',
        ...(data.deploymentMode === 'k8s' && data.kubeconfig ? {
          k8sConfig: {
            create: {
              kubeconfig: data.kubeconfig,
              clusterType: data.clusterType || 'k3s',
              namespace: data.k8sNamespace || 'validator'
            }
          }
        } : {})
      },
      select: {
        id: true,
        name: true,
        host: true,
        sshPort: true,
        network: true,
        deploymentMode: true,
        status: true,
        createdAt: true
      }
    })

    return NextResponse.json(validator, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
