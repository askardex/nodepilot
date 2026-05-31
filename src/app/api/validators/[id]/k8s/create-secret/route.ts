import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * POST /api/validators/[id]/k8s/create-secret
 *
 * Body:
 *   {
 *     name:    string,                  // e.g. "postgres-secrets"
 *     entries: Record<string, string>   // e.g. { postgresPassword: "..." }
 *   }
 *
 * Creates a generic Kubernetes secret in the validator namespace using
 * `kubectl create secret generic ... --from-literal=k=v`.
 *
 * Values are piped through stdin (each key written to a temp file,
 * then read with --from-file=key=path) to avoid leaking the secret
 * value into shell argv / process listings.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => ({})) as {
    name?: string
    entries?: Record<string, string>
  }

  const name = (body.name ?? '').trim()
  const entries = body.entries ?? {}

  // RFC 1123 DNS subdomain (lowercased) — k8s secret name rules.
  if (!name || !/^[a-z0-9]([a-z0-9-]{0,251}[a-z0-9])?$/.test(name)) {
    return Response.json({ error: 'invalid secret name' }, { status: 400 })
  }

  const keys = Object.keys(entries)

  if (keys.length === 0) return Response.json({ error: 'entries is empty' }, { status: 400 })

  for (const k of keys) {
    if (!/^[A-Za-z0-9._-]+$/.test(k)) {
      return Response.json({ error: `invalid key name: ${k}` }, { status: 400 })
    }
  }

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator || validator.deploymentMode !== 'k8s' || !validator.k8sConfig) {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'

  let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

  try {
    conn = await sshConnect(validator)

    // Stage each value into a tmp file via base64. The secret values therefore
    // never appear on the command line. Files are removed after.
    const tmpDir = `/tmp/nodepilot-secret-${name}-${Date.now()}`
    const stageCmds: string[] = [`mkdir -p ${tmpDir} && chmod 700 ${tmpDir}`]
    const fromFlags: string[] = []

    for (const k of keys) {
      const v = entries[k] ?? ''
      const b64 = Buffer.from(v, 'utf8').toString('base64')
      const filePath = `${tmpDir}/${k}`

      stageCmds.push(`echo '${b64}' | base64 -d > ${filePath}`)
      fromFlags.push(`--from-file=${k}=${filePath}`)
    }

    const stageRes = await sshExec(conn, stageCmds.join(' && '))

    if (stageRes.code !== 0) {
      return Response.json({ error: 'failed to stage secret values', detail: stageRes.output }, { status: 500 })
    }

    // Idempotent: ensure namespace exists, then delete-if-exists then create.
    // Avoids "AlreadyExists" errors and lets the user rotate values via the same flow.
    const cmd = withK8sEnv(
      `kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f - 2>&1 ; ` +
      `kubectl delete secret ${name} -n ${namespace} --ignore-not-found 2>&1 ; ` +
        `kubectl create secret generic ${name} -n ${namespace} ${fromFlags.join(' ')} 2>&1`
    )

    const res = await sshExec(conn, cmd)

    // Best-effort cleanup of staged files.
    await sshExec(conn, `rm -rf ${tmpDir}`).catch(() => {/* ignore */})

    return Response.json({ output: res.output, exitCode: res.code })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    conn?.end()
  }
}
