import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'

import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, email, password } = body

    // Registration is only open for initial bootstrap.
    // After at least one user exists, new accounts must not be created from this public endpoint.
    const userCount = await prisma.user.count()

    if (userCount > 0) {
      return NextResponse.json(
        { error: 'Registration is closed' },
        { status: 403 }
      )
    }

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } })

    if (existing) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 409 }
      )
    }

    // Hash password with high cost factor (anti brute-force)
    const passwordHash = await hash(password, 12)

    const user = await prisma.user.create({
      data: { name, email, passwordHash }
    })

    return NextResponse.json(
      { id: user.id, name: user.name, email: user.email },
      { status: 201 }
    )
  } catch (err) {
    console.error('Register error:', err)

    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    )
  }
}

// GET — check if any users exist (for first-time setup)
export async function GET() {
  const count = await prisma.user.count()

  return NextResponse.json({ hasUsers: count > 0 })
}
