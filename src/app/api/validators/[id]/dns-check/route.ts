import { promises as dns } from 'node:dns'

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// GET /api/validators/[id]/dns-check?fqdns=a.com,b.com
// Resolves A/AAAA for each FQDN and compares against the validator host.
// If validator host is itself a hostname, it is resolved first.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    select: { host: true }
  })

  if (!validator) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const fqdnsParam = url.searchParams.get('fqdns') ?? ''
  const fqdns = fqdnsParam.split(',').map(s => s.trim()).filter(Boolean)

  if (fqdns.length === 0) {
    return NextResponse.json({ error: 'No fqdns provided' }, { status: 400 })
  }

  // Determine VPS expected IPs — host may be IP or hostname.
  const ipv4Re = /^\d{1,3}(?:\.\d{1,3}){3}$/
  let expectedIps: string[] = []

  if (ipv4Re.test(validator.host)) {
    expectedIps = [validator.host]
  } else {
    try { expectedIps = await dns.resolve4(validator.host) } catch { /* host may be ipv6/unresolvable */ }
  }

  // Well-known Cloudflare IPv4 ranges (first two octets).
  // When a domain resolves to CF IPs it means the orange-cloud proxy is on.
  // We treat this as "ok" because CF proxies traffic to the origin (our VPS).
  const cfPrefixes = [
    '104.16.', '104.17.', '104.18.', '104.19.', '104.20.', '104.21.',
    '104.22.', '104.23.', '104.24.', '104.25.', '104.26.', '104.27.',
    '172.64.', '172.65.', '172.66.', '172.67.', '172.68.', '172.69.',
    '172.70.', '172.71.',
    '162.158.', '141.101.', '108.162.', '190.93.', '188.114.',
    '197.234.', '198.41.', '131.0.'
  ]

  const isCfIp = (ip: string) => cfPrefixes.some(p => ip.startsWith(p))

  const results = await Promise.all(fqdns.map(async fqdn => {
    let a: string[] = []
    let aaaa: string[] = []
    let error: string | null = null

    try { a = await dns.resolve4(fqdn) } catch (e) {
      const code = (e as NodeJS.ErrnoException).code

      if (code !== 'ENODATA') error = code ?? 'lookup failed'
    }

    try { aaaa = await dns.resolve6(fqdn) } catch { /* aaaa optional */ }

    const directMatch = expectedIps.length > 0 && a.some(ip => expectedIps.includes(ip))
    const cfProxied = !directMatch && a.length > 0 && a.every(isCfIp)
    const ok = !error && (directMatch || cfProxied)

    return { fqdn, a, aaaa, matches: directMatch, cfProxied, ok, error }
  }))

  return NextResponse.json({
    expectedIps,
    results,
    allOk: expectedIps.length > 0 && results.every(r => r.ok),
    checkedAt: new Date().toISOString()
  })
}
