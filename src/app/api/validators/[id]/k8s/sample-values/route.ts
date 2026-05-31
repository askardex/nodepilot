import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec } from '@/lib/k8s-ssh'

/**
 * GET /api/validators/[id]/k8s/sample-values?file=participant-values.yaml&version=0.6.2
 *
 * Downloads the official Splice helm sample values bundle from GitHub Releases
 * onto the host (cached at /tmp/splice-node-VERSION/) and returns the requested
 * file's contents.
 *
 * Bundle URL (per docs):
 *   https://github.com/digital-asset/decentralized-canton-sync/releases/download/vVERSION/VERSION_splice-node.tar.gz
 *
 * Files inside `splice-node/examples/sv-helm/`:
 *   - postgres-values-validator-participant.yaml
 *   - participant-values.yaml
 *   - standalone-participant-values.yaml
 *   - validator-values.yaml
 *   - standalone-validator-values.yaml
 *   - validator-cluster-ingress-values.yaml
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  const file = (url.searchParams.get('file') ?? '').trim()
  const version = (url.searchParams.get('version') ?? '').trim() || '0.6.2'

  // Whitelist filenames — we never want this to read arbitrary host paths.
  const allowed = new Set([
    'postgres-values-validator-participant.yaml',
    'participant-values.yaml',
    'standalone-participant-values.yaml',
    'validator-values.yaml',
    'standalone-validator-values.yaml',
    'validator-cluster-ingress-values.yaml'
  ])

  if (!allowed.has(file)) {
    return Response.json({ error: 'unknown file', allowed: [...allowed] }, { status: 400 })
  }

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return Response.json({ error: 'invalid version' }, { status: 400 })
  }

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator || validator.deploymentMode !== 'k8s') {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  const bundleDir = `/tmp/splice-node-${version}`
  const bundleUrl = `https://github.com/digital-asset/decentralized-canton-sync/releases/download/v${version}/${version}_splice-node.tar.gz`
  const filePath = `${bundleDir}/splice-node/examples/sv-helm/${file}`

  let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

  try {
    conn = await sshConnect(validator)

    // Idempotent: only download if the file isn't already there.
    const cmd =
      `if [ ! -f ${filePath} ]; then ` +
        `mkdir -p ${bundleDir} && cd ${bundleDir} && ` +
        `curl -fsSL '${bundleUrl}' -o splice-node.tar.gz && ` +
        `tar xzf splice-node.tar.gz ; ` +
      `fi ; ` +
      `cat ${filePath}`

    const res = await sshExec(conn, cmd)

    if (res.code !== 0) {
      return Response.json({ error: 'failed to fetch sample values', detail: res.output }, { status: 500 })
    }

    return Response.json({ output: res.output })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    conn?.end()
  }
}
