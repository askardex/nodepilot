import { NextResponse } from 'next/server'

// In-memory cache (per server process)
let cache: { data: SpliceRelease[]; fetchedAt: number } | null = null
const TTL_MS = 10 * 60 * 1000 // 10 minutes

export type SpliceRelease = {
  tag: string // e.g. "v0.5.17"
  version: string // e.g. "0.5.17"
  name: string
  publishedAt: string
  prerelease: boolean
  htmlUrl: string
}

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return NextResponse.json({ releases: cache.data, cached: true })
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }

    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const res = await fetch('https://api.github.com/repos/digital-asset/decentralized-canton-sync/releases?per_page=20', {
      headers,
      next: { revalidate: 600 }
    })

    if (!res.ok) {
      const text = await res.text()

      return NextResponse.json(
        { error: `GitHub API error ${res.status}`, detail: text.slice(0, 500) },
        { status: 502 }
      )
    }

    const json: Array<{
      tag_name: string
      name: string
      published_at: string
      prerelease: boolean
      draft: boolean
      html_url: string
    }> = await res.json()

    const releases: SpliceRelease[] = json
      .filter(r => !r.draft && r.tag_name.startsWith('v'))
      .slice(0, 4)
      .map(r => ({
        tag: r.tag_name,
        version: r.tag_name.replace(/^v/, ''),
        name: r.name || r.tag_name,
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        htmlUrl: r.html_url
      }))

    cache = { data: releases, fetchedAt: Date.now() }

    return NextResponse.json({ releases, cached: false })
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch releases', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
