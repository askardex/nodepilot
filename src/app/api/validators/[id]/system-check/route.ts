import { Client } from 'ssh2'

import { prisma } from '@/lib/prisma'

type CheckResult = {
  name: string
  value: string
  status: 'pass' | 'fail' | 'warn' | 'info'
}

// POST /api/validators/[id]/system-check - Stream system checks via SSE
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) {
    return new Response(JSON.stringify({ error: 'Validator not found' }), { status: 404 })
  }

  const scanNodes = await prisma.svScanNode.findMany({ where: { network: validator.network } })

  // Pull the validator's port assignments from config so port-conflict checks
  // reflect what the next start will actually try to bind.
  const cfg = await prisma.validatorConfig.findUnique({
    where: { validatorId: id },
    select: {
      publicAccessMode: true,
      portLedgerApi: true,
      portWalletUi: true,
      portJsonApi: true,
      portValidatorApi: true,
      portSpliceNginx: true
    }
  })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: CheckResult) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const sendDone = () => {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }

      try {
        const conn = await connectSSH(validator)
        const isK8s = validator.deploymentMode === 'k8s'

        // Phase 1: System checks
        const baseChecks: Array<{ name: string; command: string; min?: number }> = [
          { name: 'OS Version', command: 'cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \\"' },
          { name: 'CPU Cores', command: 'nproc', min: 4 },
          { name: 'RAM Total (GB)', command: "free -g | grep Mem | awk '{print $2}'", min: 7 },
          { name: 'Disk Free (GB)', command: "df -BG / | tail -1 | awk '{print $4}' | tr -d 'G'", min: 50 },
        ]

        const composeChecks = [
          { name: 'Docker Installed', command: 'docker --version 2>/dev/null || echo "NOT_INSTALLED"' },
          { name: 'Docker Compose', command: 'docker compose version 2>/dev/null || docker-compose --version 2>/dev/null || echo "NOT_INSTALLED"' },
          { name: 'Docker Running', command: 'docker ps -q 2>/dev/null | wc -l' },
        ]

        const k8sChecks = [
          { name: 'k3s / kubectl', command: 'export PATH=$PATH:/usr/local/bin && (kubectl version --client 2>/dev/null || /usr/local/bin/kubectl version --client 2>/dev/null || k3s kubectl version --client 2>/dev/null) | grep -oE "v[0-9]+\\.[0-9]+\\.[0-9]+" | head -1 || echo "NOT_INSTALLED"' },
          { name: 'Helm', command: 'export PATH=$PATH:/usr/local/bin && (helm version --short 2>/dev/null || /usr/local/bin/helm version --short 2>/dev/null) | grep -oE "v[0-9]+\\.[0-9]+\\.[0-9]+" | head -1 || echo "NOT_INSTALLED"' },
          { name: 'k3s Service', command: 'systemctl is-active k3s 2>/dev/null || echo "NOT_INSTALLED"' },
          { name: 'Cluster Ready', command: 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && export PATH=$PATH:/usr/local/bin && (kubectl get nodes --no-headers 2>/dev/null || k3s kubectl get nodes --no-headers 2>/dev/null) | awk \'{print $2}\' | head -1 || echo "NOT_INSTALLED"' },
          { name: 'Traefik Ingress', command: 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && export PATH=$PATH:/usr/local/bin && (kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik --no-headers 2>/dev/null || kubectl get pods -n kube-system -l app=traefik --no-headers 2>/dev/null) | grep -c Running || echo "0"' },
          { name: 'cert-manager', command: 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && export PATH=$PATH:/usr/local/bin && (kubectl get pods -n cert-manager --no-headers 2>/dev/null || k3s kubectl get pods -n cert-manager --no-headers 2>/dev/null) | grep -c Running || echo "0"' },
        ]

        const commonChecks = [
          { name: 'curl', command: 'curl --version 2>/dev/null | head -1 || echo "NOT_INSTALLED"' },
          { name: 'jq', command: 'jq --version 2>/dev/null || echo "NOT_INSTALLED"' },
          { name: 'Egress IP', command: 'curl -sSL --max-time 5 http://checkip.amazonaws.com 2>/dev/null || echo "UNKNOWN"' }
        ]

        const systemChecks: Array<{ name: string; command: string; min?: number }> = [
          ...baseChecks,
          ...(isK8s ? k8sChecks : composeChecks),
          ...commonChecks
        ]

        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

        for (const check of systemChecks) {
          try {
            const output = (await execCommand(conn, check.command)).trim()
            let status: CheckResult['status'] = 'info'

            if (check.min !== undefined) {
              const num = parseInt(output)

              status = isNaN(num) ? 'fail' : num >= check.min ? 'pass' : 'fail'
            } else if (check.name === 'k3s Service') {
              status = output === 'active' ? 'pass' : 'fail'
            } else if (check.name === 'Cluster Ready') {
              if (output.includes('NOT_INSTALLED') || output === '') {
                // k3s not yet installed — show as warn (will pass after k3s install)
                status = 'warn'
              } else {
                status = output === 'Ready' ? 'pass' : 'fail'
              }
            } else if (check.name === 'k3s / kubectl' && !output.includes('NOT_INSTALLED')) {
              // Require kubectl >= v1.26.1 (Splice spec)
              const m = output.match(/v(\d+)\.(\d+)\.(\d+)/)

              if (m) {
                const [, maj, min, patch] = m.map(Number)
                const ok = maj > 1 || (maj === 1 && (min > 26 || (min === 26 && patch >= 1)))

                status = ok ? 'pass' : 'fail'
              } else {
                status = 'warn'
              }
            } else if (check.name === 'Helm' && !output.includes('NOT_INSTALLED')) {
              // Require helm >= v3.11.1 (Splice spec)
              const m = output.match(/v(\d+)\.(\d+)\.(\d+)/)

              if (m) {
                const [, maj, min, patch] = m.map(Number)
                const ok = maj > 3 || (maj === 3 && (min > 11 || (min === 11 && patch >= 1)))

                status = ok ? 'pass' : 'fail'
              } else {
                status = 'warn'
              }
            } else if (check.name === 'Traefik Ingress') {
              const n = parseInt(output)

              // Traefik ships with k3s by default — fail is significant (Ingress won't work)
              status = isNaN(n) || n === 0 ? 'fail' : 'pass'
            } else if (check.name === 'cert-manager') {
              const n = parseInt(output)

              // cert-manager is optional (only needed for Let's Encrypt TLS)
              status = isNaN(n) || n === 0 ? 'warn' : 'pass'
            } else if (output.includes('NOT_INSTALLED') || output === '' || output === 'NONE') {
              status = isK8s && (check.name === 'k3s / kubectl' || check.name === 'Helm') ? 'fail' : 'warn'
            } else {
              status = 'pass'
            }

            // Friendlier display value
            let displayValue = output

            if (check.name === 'Cluster Ready' && (output.includes('NOT_INSTALLED') || output === '')) {
              displayValue = 'k3s not running yet'
            } else if (check.name === 'Traefik Ingress' && (output === '0' || output === '')) {
              displayValue = 'NOT_INSTALLED — Ingress & domain routing will not work'
            } else if (check.name === 'Traefik Ingress' && parseInt(output) > 0) {
              displayValue = `${output} pod(s) running`
            } else if (check.name === 'cert-manager' && (output === '0' || output === '')) {
              displayValue = 'Not installed — required only for Let\'s Encrypt TLS'
            } else if (check.name === 'cert-manager' && parseInt(output) > 0) {
              displayValue = `${output} pod(s) running`
            }

            send({ name: check.name, value: displayValue, status })
            await sleep(700)
          } catch {
            send({ name: check.name, value: 'Error', status: 'fail' })
            await sleep(700)
          }
        }

        // Phase 2: IP Whitelist - check each SV node individually for streaming
        if (scanNodes.length === 0) {
          send({ name: 'IP Whitelist', value: `No scan nodes for ${validator.network}`, status: 'warn' })
        } else {
          const curlCheck = (await execCommand(conn, 'which curl >/dev/null 2>&1 && echo "OK" || echo "MISSING"')).trim()

          if (curlCheck === 'MISSING') {
            send({ name: 'IP Whitelist', value: 'curl not installed — run: apt install -y curl', status: 'fail' })
          } else {
            let passed = 0
            const total = scanNodes.length

            // Send initial summary
            send({ name: 'IP Whitelist', value: `0/${total} SV nodes accessible`, status: 'info' })

            // Check each node individually and stream result
            for (const node of scanNodes) {
              try {
                const output = await execCommand(conn, `curl -fsS -m 5 --connect-timeout 5 "${node.url}/api/scan/version" 2>/dev/null | grep -o '"version":"[^"]*"' || echo "TIMEOUT"`)
                const result = output.trim()

                if (result.includes('version')) {
                  passed++
                  const ver = result.match(/"version":"([^"]+)"/)?.[1] || ''

                  send({ name: `↳ ${node.name}`, value: ver, status: 'pass' })
                } else {
                  send({ name: `↳ ${node.name}`, value: 'Not whitelisted', status: 'fail' })
                }

                // Update summary (always 'info' so frontend roller skips it
                // and lets the per-node names sit in the spotlight evenly).
                send({
                  name: 'IP Whitelist',
                  value: `${passed}/${total} SV nodes accessible`,
                  status: 'info'
                })
                await sleep(500)
              } catch {
                send({ name: `↳ ${node.name}`, value: 'Error', status: 'fail' })
              }
            }

            // Final summary status
            send({
              name: 'IP Whitelist',
              value: `${passed}/${total} SV nodes accessible`,
              status: passed === total ? 'pass' : passed === 0 ? 'fail' : 'warn'
            })
          }
        }

        // Phase 3: Required Ports — detect host-side conflicts before
        // deployment tries to bind.
        const portList: Array<{ port: number; label: string; required: boolean }> = []

        const isDomain = cfg?.publicAccessMode === 'domain'

        if (isK8s) {
          // K8s mode: k3s API server + ingress + node agent
          portList.push({ port: 6443, label: 'Kubernetes API', required: true })
          portList.push({ port: 80, label: 'Ingress HTTP', required: true })
          portList.push({ port: 443, label: 'Ingress HTTPS', required: true })
          portList.push({ port: 10250, label: 'Node Agent', required: true })
        } else {
          // Compose mode: Splice container ports
          portList.push({ port: cfg?.portValidatorApi ?? 5003, label: 'Validator API', required: true })
          portList.push({ port: cfg?.portLedgerApi ?? 5001, label: 'Ledger API (gRPC)', required: true })
          portList.push({ port: cfg?.portJsonApi ?? 7575, label: 'JSON Ledger API', required: true })
          portList.push({ port: cfg?.portWalletUi ?? 2000, label: 'Wallet/ANS UI', required: true })

          if (isDomain) {
            portList.push({ port: cfg?.portSpliceNginx ?? 8080, label: 'Splice nginx (internal)', required: true })
            portList.push({ port: 80, label: 'Host nginx HTTP', required: true })
            portList.push({ port: 443, label: 'Host nginx HTTPS', required: true })
          } else {
            portList.push({ port: 80, label: 'Splice nginx', required: true })
          }
        }

        // Build a single command that prints "<port>:<process>" lines for any
        // listening port we care about. Uses ss (preferred, present on every
        // modern systemd box) with `-Hltnp` for clean machine-readable output.
        const ports = portList.map(p => p.port).join('|')
        const portProbeCmd = `ss -Hltnp 2>/dev/null | awk -v ports='^(${ports})$' '{ split($4,a,":"); p=a[length(a)]; if (p ~ ports) print p":"$0 }' || true`
        const portProbeOut = await execCommand(conn, portProbeCmd)
        const lines = portProbeOut.split('\n').filter(Boolean)

        // Map port → owner string ("docker-proxy" / "nginx" / "" if free)
        const owners = new Map<number, string>()

        for (const line of lines) {
          const colonIdx = line.indexOf(':')
          const port = parseInt(line.slice(0, colonIdx), 10)
          const rest = line.slice(colonIdx + 1)

          // Extract process name from users:(("name",pid=…
          const m = rest.match(/users:\(\("([^"]+)"/)
          const owner = m?.[1] ?? 'unknown'

          // Keep first owner; also accumulate so we don't drop secondary
          // listeners (e.g. ipv4 + ipv6 binding).
          if (!owners.has(port)) owners.set(port, owner)
        }

        send({ name: 'Required Ports', value: `Checking ${portList.length} ports…`, status: 'info' })

        for (const { port, label } of portList) {
          const owner = owners.get(port)

          // In K8s mode, 6443 (API) and 10250 (Node Agent) MUST be bound by
          // k3s right now. Ports 80/443 are reserved for the ingress
          // controller deployed later — being free now is expected.
          const isK8sCoreRequired = isK8s && (port === 6443 || port === 10250)
          const isK8sIngressReserved = isK8s && (port === 80 || port === 443)

          if (!owner) {
            if (isK8sCoreRequired) {
              send({
                name: `↳ Port ${port} (${label})`,
                value: 'not bound (k3s not running yet)',
                status: 'warn'
              })
            } else if (isK8sIngressReserved) {
              send({
                name: `↳ Port ${port} (${label})`,
                value: 'reserved for ingress (will bind on deploy)',
                status: 'pass'
              })
            } else {
              send({ name: `↳ Port ${port} (${label})`, value: 'free', status: 'pass' })
            }
          } else if (isK8s && /^k3s|^traefik|^kubelet|^containerd/.test(owner)) {
            // k3s-managed process — expected
            send({ name: `↳ Port ${port} (${label})`, value: `${owner} (K8s — OK)`, status: 'pass' })
          } else if (!isK8s && /^docker-proxy$|^docker$|^containerd/.test(owner)) {
            // Docker is already publishing this port — most likely a previous
            // splice run; not a conflict, will be reused/restarted by compose.
            send({ name: `↳ Port ${port} (${label})`, value: `in use by ${owner} (Docker — OK)`, status: 'info' })
          } else if (port === 80 && !isK8s && isDomain && /^nginx$/.test(owner)) {
            send({ name: `↳ Port ${port} (${label})`, value: 'host nginx (OK)', status: 'pass' })
          } else if (port === 443 && !isK8s && isDomain && /^nginx$/.test(owner)) {
            send({ name: `↳ Port ${port} (${label})`, value: 'host nginx (OK)', status: 'pass' })
          } else {
            send({
              name: `↳ Port ${port} (${label})`,
              value: `CONFLICT — used by ${owner}`,
              status: 'fail'
            })
          }

          await sleep(150)
        }

        const conflicts = portList.filter(({ port }) => {
          const o = owners.get(port)

          if (!o) return false
          if (isK8s && /^k3s|^traefik|^kubelet|^containerd/.test(o)) return false
          if (!isK8s && /^docker-proxy$|^docker$|^containerd/.test(o)) return false
          if (!isK8s && (port === 80 || port === 443) && isDomain && /^nginx$/.test(o)) return false

          return true
        })

        send({
          name: 'Required Ports',
          value: conflicts.length === 0
            ? `All ${portList.length} ports clear`
            : `${conflicts.length} conflict(s) — fix before start`,
          status: conflicts.length === 0 ? 'pass' : 'fail'
        })

        conn.end()
        sendDone()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'SSH failed'

        send({ name: 'Error', value: msg, status: 'fail' })
        sendDone()
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

    conn.on('ready', () => {
      clearTimeout(timeout)
      resolve(conn)
    })

    conn.on('error', (err: Error) => {
      clearTimeout(timeout)
      reject(err)
    })

    const connectOpts: Record<string, unknown> = {
      host: validator.host,
      port: validator.sshPort,
      username: validator.sshUsername,
      readyTimeout: 10000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 10
    }

    if (validator.sshAuthType === 'password') {
      connectOpts.password = validator.sshPassword
    } else {
      connectOpts.privateKey = validator.sshPrivateKey
    }

    conn.connect(connectOpts)
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

      stream.on('data', (data: Buffer) => { output += data.toString() })
      stream.stderr.on('data', () => {}) // ignore stderr
      stream.on('close', () => { resolve(output) })
    })
  })
}
