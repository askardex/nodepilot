import { NextResponse } from 'next/server'

import { Client } from 'ssh2'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// Whitelist of packages we allow auto-install for.
const ALLOWED = new Set(['jq', 'curl', 'tar', 'k3s / kubectl', 'Helm', 'k3s Service', 'Traefik Ingress', 'cert-manager'])

// Custom install commands for non-apt packages
const CUSTOM_INSTALL: Record<string, { install: string; verify: string }> = {
  'k3s / kubectl': {
    install: 'curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable servicelb" sh - 2>&1',
    verify: 'export PATH=$PATH:/usr/local/bin && (kubectl version --client 2>/dev/null || /usr/local/bin/kubectl version --client 2>/dev/null || k3s kubectl version --client 2>/dev/null) | grep -oE "v[0-9]+\\.[0-9]+\\.[0-9]+" | head -1 || echo NOT_INSTALLED'
  },
  'Helm': {
    install: 'curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash 2>&1',
    verify: 'export PATH=$PATH:/usr/local/bin && (helm version --short 2>/dev/null || /usr/local/bin/helm version --short 2>/dev/null) | grep -oE "v[0-9]+\\.[0-9]+\\.[0-9]+" | head -1 || echo NOT_INSTALLED'
  },
  'k3s Service': {
    install: 'curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable servicelb" sh - 2>&1',
    verify: 'systemctl is-active k3s 2>/dev/null || echo NOT_INSTALLED'
  },
  'Traefik Ingress': {
    // k3s ships Traefik by default. If it is missing, k3s was likely installed with
    // --disable traefik. Re-install k3s without that flag to restore it.
    // After install, apply HelmChartConfig to enable hostNetwork + ports 80/443
    // so bare-metal VPS can receive traffic directly (no cloud LoadBalancer).
    install: [
      'curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable servicelb" sh - 2>&1',
      '&& export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && export PATH=$PATH:/usr/local/bin',

      // Apply HelmChartConfig — k3s watches this CRD and auto-reconfigures Traefik
      '&& cat <<\'HCCEOF\' | kubectl apply -f - 2>&1',
      'apiVersion: helm.cattle.io/v1',
      'kind: HelmChartConfig',
      'metadata:',
      '  name: traefik',
      '  namespace: kube-system',
      'spec:',
      '  valuesContent: |-',
      '    hostNetwork: true',
      '    ports:',
      '      web:',
      '        port: 80',
      '      websecure:',
      '        port: 443',
      '    service:',
      '      type: ClusterIP',
      'HCCEOF',

      // Wait for Traefik pods to restart with new config
      '&& echo "Waiting for Traefik rollout..."',
      '&& sleep 5 && kubectl rollout status deploy traefik -n kube-system --timeout=90s 2>&1',
    ].join('\n'),
    verify: 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && export PATH=$PATH:/usr/local/bin && (kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik --no-headers 2>/dev/null || kubectl get pods -n kube-system -l app=traefik --no-headers 2>/dev/null) | grep -c Running || echo "0"'
  },
  'cert-manager': {
    install: 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && export PATH=$PATH:/usr/local/bin && kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.17.2/cert-manager.yaml 2>&1 && echo "Waiting for pods..." && sleep 30',
    verify: 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && export PATH=$PATH:/usr/local/bin && (kubectl get pods -n cert-manager --no-headers 2>/dev/null || k3s kubectl get pods -n cert-manager --no-headers 2>/dev/null) | grep -c Running || echo NOT_INSTALLED'
  }
}

// POST /api/validators/[id]/install-package
// Body: { package: 'jq' | 'curl' | 'tar' }
// Streams plain text output of `apt-get install -y <pkg>` over SSH.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) {
    return NextResponse.json({ error: 'Validator not found' }, { status: 404 })
  }

  let body: { package?: string }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const pkg = (body.package || '').trim()

  if (!ALLOWED.has(pkg)) {
    return NextResponse.json({ error: `Package "${pkg}" not in allow-list` }, { status: 400 })
  }

  const isCustom = pkg in CUSTOM_INSTALL

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }

      let conn: Client | null = null

      try {
        conn = await connectSSH(validator)

        if (isCustom) {
          const custom = CUSTOM_INSTALL[pkg]

          send({ step: `install ${pkg}`, status: 'running' })

          const installOut = await execCommand(conn, `${custom.install}; echo "__EXIT__:$?"`)

          send({ log: installOut })

          const exitMatch = installOut.match(/__EXIT__:(\d+)/)
          const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 1

          if (exitCode !== 0) {
            send({ step: `install ${pkg}`, status: 'error', message: `Install exited ${exitCode}` })
            send({ done: true, success: false })
            conn.end()
            controller.close()

            return
          }

          const verify = (await execCommand(conn, custom.verify)).trim()

          if (verify.includes('NOT_INSTALLED')) {
            send({ step: `install ${pkg}`, status: 'error', message: 'Verification failed' })
            send({ done: true, success: false })
          } else {
            send({ step: `install ${pkg}`, status: 'success', message: verify })
            send({ done: true, success: true, version: verify })
          }
        } else {
          // Standard apt package install
          send({ step: 'apt-update', status: 'running' })

          const updateOut = await execCommand(conn, 'DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 || true')

          send({ log: updateOut })
          send({ step: 'apt-update', status: 'success' })

          send({ step: `install ${pkg}`, status: 'running' })

          const installOut = await execCommand(
            conn,
            `DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg} 2>&1; echo "__EXIT__:$?"`
          )

          send({ log: installOut })

          const exitMatch = installOut.match(/__EXIT__:(\d+)/)
          const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 1

          if (exitCode !== 0) {
            send({ step: `install ${pkg}`, status: 'error', message: `apt-get exited ${exitCode}` })
            send({ done: true, success: false })
            conn.end()
            controller.close()

            return
          }

          const verify = (await execCommand(conn, `${pkg} --version 2>&1 | head -1 || echo NOT_INSTALLED`)).trim()

          if (verify.includes('NOT_INSTALLED')) {
            send({ step: `install ${pkg}`, status: 'error', message: 'Verification failed' })
            send({ done: true, success: false })
          } else {
            send({ step: `install ${pkg}`, status: 'success', message: verify })
            send({ done: true, success: true, version: verify })
          }
        }

        conn.end()
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)

        send({ step: 'ssh', status: 'error', message: msg })
        send({ done: true, success: false })
        if (conn) conn.end()
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  })
}

function connectSSH(validator: { host: string; sshPort: number; sshUsername: string; sshAuthType: string; sshPassword: string | null; sshPrivateKey: string | null }): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    const timeout = setTimeout(() => {
      conn.end()
      reject(new Error('SSH connection timed out'))
    }, 15000)

    conn.on('ready', () => { clearTimeout(timeout); resolve(conn) })
    conn.on('error', err => { clearTimeout(timeout); reject(err) })

    const opts: Record<string, unknown> = {
      host: validator.host,
      port: validator.sshPort,
      username: validator.sshUsername,
      readyTimeout: 10000
    }

    if (validator.sshAuthType === 'password') opts.password = validator.sshPassword
    else opts.privateKey = validator.sshPrivateKey

    conn.connect(opts)
  })
}

function execCommand(conn: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err)

        return
      }

      let output = ''

      stream.on('data', (d: Buffer) => { output += d.toString() })
      stream.stderr.on('data', (d: Buffer) => { output += d.toString() })
      stream.on('close', () => resolve(output))
    })
  })
}
