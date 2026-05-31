/**
 * GET /api/canton/versions
 *
 * Returns the most recent Splice releases from GitHub.
 * Source: https://github.com/digital-asset/decentralized-canton-sync/releases
 *
 * Cached in-memory for 10 minutes to avoid hitting GitHub's anonymous rate
 * limit (60 req/h per IP). Failures fall back to a hardcoded list so the UI
 * never goes empty.
 */

type Cached = { fetchedAt: number; versions: string[] }

const CACHE_TTL_MS = 10 * 60 * 1000

// Module-scoped cache. Survives across requests in the same Next runtime.
let cache: Cached | null = null

// Fallback used only when GitHub API is unreachable.
// Kept minimal — real versions are fetched dynamically.
const FALLBACK_VERSIONS: string[] = []

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return Response.json({ ok: true, versions: cache.versions, cached: true })
  }

  try {
    const res = await fetch(
      'https://api.github.com/repos/digital-asset/decentralized-canton-sync/releases?per_page=12',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'NodePilot'
        },
        // Next 16 fetch — disable internal caching, we manage our own.
        cache: 'no-store'
      }
    )

    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}`)
    }

    const json = await res.json() as Array<{ tag_name?: string; prerelease?: boolean; draft?: boolean }>

    const versions = json
      .filter(r => !r.draft && !r.prerelease)
      .map(r => (r.tag_name ?? '').replace(/^v/, ''))
      .filter(v => /^\d+\.\d+\.\d+/.test(v))
      .slice(0, 4)

    if (versions.length === 0) throw new Error('no versions parsed')

    cache = { fetchedAt: Date.now(), versions }

    return Response.json({ ok: true, versions, cached: false })
  } catch (err) {
    return Response.json({
      ok: true,
      versions: FALLBACK_VERSIONS,
      cached: false,
      fallback: true,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
