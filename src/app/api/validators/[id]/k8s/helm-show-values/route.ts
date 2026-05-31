import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * GET /api/validators/[id]/k8s/helm-show-values?chartRef=oci://...&version=0.6.2
 *
 * Runs `helm show values <chart>` on the host and returns the raw default
 * values.yaml. Used by the install dialog to discover correct override keys
 * (e.g. storageClass) for the chart being installed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  const chartRef = (url.searchParams.get('chartRef') ?? '').trim()
  const version = (url.searchParams.get('version') ?? '').trim()

  if (!chartRef || !/^[a-zA-Z0-9._\-/:@+]+$/.test(chartRef)) {
    return Response.json({ error: 'invalid chartRef' }, { status: 400 })
  }

  if (version && !/^[a-zA-Z0-9._\-+]+$/.test(version)) {
    return Response.json({ error: 'invalid version' }, { status: 400 })
  }

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator || validator.deploymentMode !== 'k8s') {
    return Response.json({ error: 'K8s not configured' }, { status: 400 })
  }

  let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

  try {
    conn = await sshConnect(validator)
    const versionFlag = version ? `--version ${version}` : ''
    const res = await sshExec(conn, withK8sEnv(`helm show values ${chartRef} ${versionFlag}`))

    return Response.json({ output: res.output, exitCode: res.code })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    conn?.end()
  }
}
