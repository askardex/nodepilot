import { Client } from 'ssh2'

import { prisma } from '@/lib/prisma'
import { rewriteK3sServerHost, probeCluster } from '@/lib/k8s'

/**
 * POST /api/validators/[id]/k8s/connect
 *
 * Auto-fetch kubeconfig from a k3s VPS via SSH:
 *   1. SSH to validator.host
 *   2. Read /etc/rancher/k3s/k3s.yaml
 *   3. Rewrite server URL (127.0.0.1 → public host)
 *   4. Probe cluster from NodePilot
 *   5. Save kubeconfig into K8sConfig
 *
 * Body: {} (no params — uses validator's existing SSH credentials)
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator) {
    return Response.json({ error: 'Validator not found' }, { status: 404 })
  }

  if (validator.deploymentMode !== 'k8s') {
    return Response.json({ error: 'Validator is not in K8s mode' }, { status: 400 })
  }

  // Auto-create K8sConfig row if missing (backfill for validators created
  // before this feature, or before nested-create was wired in).
  if (!validator.k8sConfig) {
    await prisma.k8sConfig.create({
      data: { validatorId: id }
    })
    validator.k8sConfig = await prisma.k8sConfig.findUnique({ where: { validatorId: id } })
  }

  if (!validator.k8sConfig) {
    return Response.json({ error: 'Failed to initialise K8s config' }, { status: 500 })
  }

  // Only auto-fetch for k3s clusters; other cluster types must paste kubeconfig manually
  if (validator.k8sConfig.clusterType !== 'k3s') {
    return Response.json(
      { error: `Auto-fetch only supports k3s; for ${validator.k8sConfig.clusterType} paste kubeconfig manually` },
      { status: 400 }
    )
  }

  try {
    // Step 1: SSH and read kubeconfig
    const rawKubeconfig = await sshReadFile(validator, '/etc/rancher/k3s/k3s.yaml')

    if (!rawKubeconfig.includes('apiVersion')) {
      return Response.json(
        { error: 'k3s kubeconfig not found on VPS — is k3s installed and running?' },
        { status: 400 }
      )
    }

    // Step 2: Rewrite server URL to public host
    const kubeconfig = rewriteK3sServerHost(rawKubeconfig, validator.host)

    // Step 3: Probe the cluster from NodePilot
    let probe: Awaited<ReturnType<typeof probeCluster>>

    try {
      probe = await probeCluster(kubeconfig)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      return Response.json(
        {
          error: `Cluster reachable check failed: ${message}. ` +
            `Verify that port 6443 is open on the VPS firewall.`
        },
        { status: 502 }
      )
    }

    // Step 4: Persist kubeconfig + context + connect timestamp
    const updated = await prisma.k8sConfig.update({
      where: { validatorId: id },
      data: {
        kubeconfig,
        context: probe.contextName,
        connectedAt: new Date(),
        lastTestedAt: new Date()
      }
    })

    return Response.json({
      ok: true,
      cluster: {
        serverVersion: probe.serverVersion,
        nodeCount: probe.nodeCount,
        contextName: probe.contextName
      },
      namespace: updated.namespace
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    return Response.json({ error: message }, { status: 500 })
  }
}

// --- SSH helpers (kept local to k8s routes; do not share with compose) ---

type SshTarget = {
  host: string
  sshPort: number
  sshUsername: string
  sshAuthType: string
  sshPassword: string | null
  sshPrivateKey: string | null
}

function sshConnect(target: SshTarget): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    const timeout = setTimeout(() => {
      conn.end()
      reject(new Error('SSH connection timed out'))
    }, 15000)

    conn.on('ready', () => {
      clearTimeout(timeout)
      resolve(conn)
    })

    conn.on('error', err => {
      clearTimeout(timeout)
      reject(err)
    })

    const opts: Record<string, unknown> = {
      host: target.host,
      port: target.sshPort,
      username: target.sshUsername,
      readyTimeout: 10000
    }

    if (target.sshAuthType === 'password') {
      opts.password = target.sshPassword
    } else {
      opts.privateKey = target.sshPrivateKey
    }

    conn.connect(opts)
  })
}

function sshExec(conn: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err)

        return
      }

      let stdout = ''
      let stderr = ''

      stream.on('data', (data: Buffer) => { stdout += data.toString() })
      stream.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
      stream.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`Command failed (exit ${code}): ${stderr || stdout}`))

          return
        }

        resolve(stdout)
      })
    })
  })
}

async function sshReadFile(target: SshTarget, path: string): Promise<string> {
  const conn = await sshConnect(target)

  try {
    // sudo cat for k3s.yaml which is root-owned mode 600
    return await sshExec(conn, `sudo cat ${path} 2>/dev/null || cat ${path}`)
  } finally {
    conn.end()
  }
}
