import { NextResponse } from 'next/server'

import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { encryptSecret } from '@/lib/secrets'

// Stage 3 — Network parameters. Stages 4/5 are accepted as optional fields
// so the same endpoint can be reused later. UI only sends what each stage
// owns; missing fields are left untouched on PUT.
const networkSchema = z.object({
  migrationId: z.number().int().nonnegative().optional(),
  sponsorSvUrl: z.string().url().optional().or(z.literal('')),
  scanUrl: z.string().url().optional().or(z.literal('')),
  sequencerUrl: z.string().url().optional().or(z.literal('')),
  onboardingSecret: z.string().min(1).max(2048).optional().or(z.literal('')),
  partyHint: z
    .string()
    .regex(/^[a-zA-Z0-9]+-[a-zA-Z0-9]+-\d+$/, 'Format: <organization>-<function>-<enumerator> e.g. myCompany-myWallet-1')
    .optional()
    .or(z.literal('')),
  disableBft: z.boolean().optional(),

  // Stage 4 (auth) — accepted but not required here
  authEnabled: z.boolean().optional(),
  authUrl: z.string().url().optional().or(z.literal('')),
  authJwksUrl: z.string().url().optional().or(z.literal('')),
  authWellknownUrl: z.string().url().optional().or(z.literal('')),
  ledgerApiAudience: z.string().optional().or(z.literal('')),
  ledgerApiScope: z.string().optional().or(z.literal('')),
  ledgerApiAdminUser: z.string().optional().or(z.literal('')),
  validatorAudience: z.string().optional().or(z.literal('')),
  validatorClientId: z.string().optional().or(z.literal('')),
  validatorClientSecret: z.string().optional().or(z.literal('')),
  walletAdminUser: z.string().optional().or(z.literal('')),
  walletUiClientId: z.string().optional().or(z.literal('')),
  ansUiClientId: z.string().optional().or(z.literal('')),
  contactPoint: z.string().optional().or(z.literal('')),

  // Stage 5 (public access — domain & SSL via nginx)
  publicAccessMode: z.enum(['direct', 'domain']).optional(),
  routingMode: z.enum(['multi', 'path']).optional(),
  baseDomain: z.string().optional().or(z.literal('')),

  enableWallet: z.boolean().optional(),
  walletSubdomain: z.string().optional().or(z.literal('')),
  enableAns: z.boolean().optional(),
  ansSubdomain: z.string().optional().or(z.literal('')),
  enableApi: z.boolean().optional(),
  apiSubdomain: z.string().optional().or(z.literal('')),
  enableMetrics: z.boolean().optional(),
  metricsSubdomain: z.string().optional().or(z.literal('')),
  enableGrpcLedger: z.boolean().optional(),
  grpcLedgerSubdomain: z.string().optional().or(z.literal('')),
  enableKeycloak: z.boolean().optional(),
  keycloakSubdomain: z.string().optional().or(z.literal('')),

  portLedgerApi: z.number().int().min(1).max(65535).optional().nullable(),
  portWalletUi: z.number().int().min(1).max(65535).optional().nullable(),
  portJsonApi: z.number().int().min(1).max(65535).optional().nullable(),
  portValidatorApi: z.number().int().min(1).max(65535).optional().nullable(),
  portSpliceNginx: z.number().int().min(1).max(65535).optional().nullable(),

  sslEnabled: z.boolean().optional(),
  sslMode: z.enum(['letsencrypt', 'custom']).optional(),
  sslEmail: z.string().email().optional().or(z.literal('')),
  customCertPem: z.string().optional().or(z.literal('')),
  customKeyPem: z.string().optional().or(z.literal('')),

  // Stage 6 (advanced)
  proxyHost: z.string().optional().or(z.literal('')),
  proxyPort: z.number().int().min(1).max(65535).optional().nullable(),
  autoTopUpEnabled: z.boolean().optional(),
  trafficThroughput: z.number().int().min(0).optional().nullable(),
  trafficTopupInterval: z.string().optional().or(z.literal(''))
})

// GET /api/validators/[id]/config
// Returns the current ValidatorConfig (creating an empty row if missing).
// Secrets are masked: returns boolean flags instead of raw secret values.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    select: { id: true, network: true }
  })

  if (!validator) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  const config = await prisma.validatorConfig.upsert({
    where: { validatorId: id },
    create: { validatorId: id },
    update: {},
    include: { sslCertificate: true }
  })

  // Mask secrets — never return raw values to the browser.
  const { onboardingSecret, validatorClientSecret, keycloakAdminPass, keycloakOperatorPass, sslCertificate, ...rest } = config

  return NextResponse.json({
    network: validator.network,
    config: {
      ...rest,
      hasOnboardingSecret: !!onboardingSecret,
      hasValidatorClientSecret: !!validatorClientSecret,
      hasKeycloakAdminPass: !!keycloakAdminPass,
      hasKeycloakOperatorPass: !!keycloakOperatorPass,
      sslCertPem: sslCertificate?.certPem ?? null,
      hasSslPrivateKey: !!sslCertificate?.keyPem
    }
  })
}

// PUT /api/validators/[id]/config
// Partial update — only the fields present in the body are written.
// Empty strings for optional fields clear them. Secrets are only updated when
// a non-empty value is provided.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({ where: { id }, select: { id: true } })

  if (!validator) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = networkSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  // Block partyHint changes after the validator has been started for the first
  // time — it becomes part of the operator party id and cannot be changed.
  // We check BOTH firstStartedAt (set after successful onboarding) AND whether
  // a partyHint already exists and differs. Even if firstStartedAt gets cleared
  // (e.g. network change), once a participant DB has been initialized with a
  // party hint, it's baked into postgres and cannot be changed without wiping.
  const existing = await prisma.validatorConfig.findUnique({ where: { validatorId: id } })

  if (existing?.partyHint && parsed.data.partyHint && parsed.data.partyHint !== existing.partyHint && existing.firstStartedAt) {
    return NextResponse.json(
      { error: 'partyHint is immutable after first start — participant identity is baked into the database. To change party hint, wipe the participant database first.' },
      { status: 400 }
    )
  }

  // Auth requires a public domain. OIDC providers (Auth0, Keycloak) reject
  // bare-IP callback URLs in production, so we hard-block enabling auth
  // unless walletDomain is set and publicAccessMode is "domain".
  const effectiveMode = parsed.data.publicAccessMode ?? existing?.publicAccessMode ?? 'direct'
  const effectiveWalletDomain = existing?.walletDomain ?? ''

  if (parsed.data.authEnabled === true && (effectiveMode !== 'domain' || !effectiveWalletDomain)) {
    return NextResponse.json(
      { error: 'Configure a public domain (Public Access) before enabling OIDC authentication.' },
      { status: 400 }
    )
  }

  // Build update payload — empty strings for optional fields become null;
  // secrets are only written when a non-empty value is supplied.
  const data: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue

    if (key === 'onboardingSecret' || key === 'validatorClientSecret') {
      if (value !== '' && value !== null) data[key] = encryptSecret(String(value))

      continue
    }

    data[key] = value === '' ? null : value
  }

  // Re-onboarding trigger: changing any network-identity field means the
  // previous onboarding (party registered on the old SV / migration) is no
  // longer valid. Clear firstStartedAt so the next Start treats it as a
  // first-start and re-injects ONBOARDING_SECRET into .env. The user is
  // expected to also update onboardingSecret to one issued for the new
  // network — Splice will return 401 "Unknown secret" otherwise.
  if (existing?.firstStartedAt) {
    const networkKeys = ['migrationId', 'sponsorSvUrl', 'scanUrl', 'sequencerUrl'] as const

    const networkChanged = networkKeys.some(k => {
      const next = parsed.data[k]

      if (next === undefined) return false

      const prev = (existing as Record<string, unknown>)[k]
      const normNext = next === '' ? null : next
      const normPrev = prev ?? null

      return normNext !== normPrev
    })

    if (networkChanged) data.firstStartedAt = null
  }

  // Derive cached canonical hosts (walletDomain/ansDomain/validatorDomain)
  // from baseDomain + per-service subdomain whenever any Stage 5 field is in
  // the payload. Other features (Auth lock, OIDC redirect URI, nginx render)
  // can then read a single field without re-deriving.
  const stage5Touched = [
    'publicAccessMode', 'routingMode', 'baseDomain',
    'enableWallet', 'walletSubdomain', 'enableAns', 'ansSubdomain',
    'enableApi', 'apiSubdomain', 'enableMetrics', 'metricsSubdomain',
    'enableGrpcLedger', 'grpcLedgerSubdomain'
  ].some(k => k in parsed.data)

  if (stage5Touched) {
    const mode = (parsed.data.publicAccessMode ?? existing?.publicAccessMode ?? 'direct') as 'direct' | 'domain'
    const routing = (parsed.data.routingMode ?? existing?.routingMode ?? 'multi') as 'multi' | 'path'
    const base = (parsed.data.baseDomain ?? existing?.baseDomain ?? '').trim()

    const eff = (k: keyof typeof parsed.data, fallback: unknown) =>
      parsed.data[k] !== undefined ? parsed.data[k] : fallback

    const walletEnabled = eff('enableWallet', existing?.enableWallet ?? true) as boolean
    const ansEnabled = eff('enableAns', existing?.enableAns ?? true) as boolean
    const apiEnabled = eff('enableApi', existing?.enableApi ?? true) as boolean
    const walletSub = (eff('walletSubdomain', existing?.walletSubdomain ?? 'wallet') as string ?? '').trim()
    const ansSub = (eff('ansSubdomain', existing?.ansSubdomain ?? 'ans') as string ?? '').trim()
    const apiSub = (eff('apiSubdomain', existing?.apiSubdomain ?? 'api') as string ?? '').trim()

    const fqdn = (sub: string) => {
      if (mode !== 'domain' || !base) return null
      if (routing === 'path') return base

      return sub ? `${sub}.${base}` : base
    }

    data.walletDomain = walletEnabled ? fqdn(walletSub) : null
    data.ansDomain = ansEnabled ? fqdn(ansSub) : null
    data.validatorDomain = apiEnabled ? fqdn(apiSub) : null
  }

  data.configuredAt = new Date()

  // Handle custom SSL certificate: create/update SslCertificate record
  // and link it via sslCertificateId. Remove virtual fields that aren't
  // real Prisma columns before upserting.
  const sslMode = data.sslMode as string | undefined
  const customCertPem = data.customCertPem as string | undefined
  const customKeyPem = data.customKeyPem as string | undefined

  delete data.sslMode
  delete data.customCertPem
  delete data.customKeyPem

  if (sslMode === 'custom' && customCertPem && customKeyPem) {
    // Derive domain list from base domain for the cert label
    const baseDomain = (data.baseDomain ?? existing?.baseDomain ?? '') as string

    const cert = await prisma.sslCertificate.create({
      data: {
        label: `Custom cert \u2014 ${baseDomain || 'unknown'}`,
        domains: baseDomain,
        source: 'custom',
        certPem: customCertPem,
        keyPem: customKeyPem
      }
    })

    data.sslCertificateId = cert.id
    data.sslEmail = null
  } else if (sslMode === 'letsencrypt') {
    // When switching back to Let's Encrypt, clear the stored cert reference
    // so configure-domain will use certbot instead of the stored cert
    data.sslCertificateId = null
  }

  const config = await prisma.validatorConfig.upsert({
    where: { validatorId: id },
    create: { validatorId: id, ...data },
    update: data,
    include: { sslCertificate: true }
  })

  const { onboardingSecret, validatorClientSecret, keycloakAdminPass, keycloakOperatorPass, sslCertificate: savedCert, ...rest } = config

  return NextResponse.json({
    config: {
      ...rest,
      hasOnboardingSecret: !!onboardingSecret,
      hasValidatorClientSecret: !!validatorClientSecret,
      hasKeycloakAdminPass: !!keycloakAdminPass,
      hasKeycloakOperatorPass: !!keycloakOperatorPass,
      sslCertPem: savedCert?.certPem ?? null,
      hasSslPrivateKey: !!savedCert?.keyPem
    }
  })
}
