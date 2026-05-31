import { prisma } from '@/lib/prisma'
import { Client } from 'ssh2'

type ServerStats = {
  cpuUsage: number
  ramUsed: number
  ramTotal: number
  diskUsed: number
  diskTotal: number
  diskPercent: number
  loadAvg: string
  uptimeSeconds: number
  dockerRunning: number
  dockerTotal: number
  podsRunning?: number
  podsTotal?: number
  networkRx: string
  networkTx: string
}

// In-process cache: per validator ID, store last fetched result + timestamp
// SSH to VPS is only done once per 30s, regardless of how many browser tabs poll
const cache = new Map<string, { data: ServerStats; fetchedAt: number; fetching: boolean }>()
const CACHE_TTL_MS = 30_000 // 30 seconds between real SSH fetches

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

    conn.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    const config: Record<string, unknown> = {
      host: validator.host,
      port: validator.sshPort,
      username: validator.sshUsername,
      readyTimeout: 10000
    }

    if (validator.sshAuthType === 'password') {
      config.password = validator.sshPassword
    } else {
      config.privateKey = validator.sshPrivateKey
    }

    conn.connect(config as Parameters<Client['connect']>[0])
  })
}

function execCommand(conn: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err)

      let output = ''

      stream.on('data', (data: Buffer) => { output += data.toString() })
      stream.stderr.on('data', () => { /* ignore stderr */ })
      stream.on('close', () => resolve(output.trim()))
    })
  })
}

// GET /api/validators/[id]/server-stats
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const cached = cache.get(id)
  const now = Date.now()

  // Return cached data if still fresh — zero SSH cost for subsequent browser polls
  if (cached && !cached.fetching && now - cached.fetchedAt < CACHE_TTL_MS) {
    return Response.json(cached.data)
  }

  // If another request is already fetching, return stale data if available
  if (cached?.fetching && cached.data) {
    return Response.json(cached.data)
  }

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) {
    return Response.json({ error: 'Validator not found' }, { status: 404 })
  }

  // Mark as fetching to prevent duplicate SSH sessions
  if (cached) {
    cached.fetching = true
  } else {
    cache.set(id, { data: null as unknown as ServerStats, fetchedAt: 0, fetching: true })
  }

  let conn: Client | null = null

  try {
    conn = await connectSSH(validator)

    const isK8s = validator.deploymentMode === 'k8s'

    // K8s mode: query running/total pods across all namespaces.
    // Compose mode: keep original docker ps queries unchanged.
    const containerRunningCmd = isK8s
      ? 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && export PATH=$PATH:/usr/local/bin && (sudo kubectl get pods -A --no-headers --field-selector=status.phase=Running 2>/dev/null || sudo k3s kubectl get pods -A --no-headers --field-selector=status.phase=Running 2>/dev/null) | wc -l'
      : 'docker ps -q 2>/dev/null | wc -l'

    const containerTotalCmd = isK8s
      ? 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && export PATH=$PATH:/usr/local/bin && (sudo kubectl get pods -A --no-headers 2>/dev/null || sudo k3s kubectl get pods -A --no-headers 2>/dev/null) | wc -l'
      : 'docker ps -aq 2>/dev/null | wc -l'

    // Run all commands in parallel for speed
    const [cpuRaw, ramRaw, diskRaw, loadRaw, uptimeRaw, containerRunningRaw, containerTotalRaw, networkRaw] = await Promise.all([
      // CPU usage: use vmstat 1 2 (1-second sample, take second line for accuracy)
      execCommand(conn, "vmstat 1 2 | tail -1 | awk '{print 100 - $15}'"),
      // RAM: used and total in MB
      execCommand(conn, "free -m | grep Mem | awk '{print $3,$2}'"),
      // Disk: used and total in GB + percent
      execCommand(conn, "df -BG / | tail -1 | awk '{gsub(\"G\",\"\"); print $3,$2,$5}'"),
      // Load average
      execCommand(conn, "cat /proc/loadavg | awk '{print $1,$2,$3}'"),
      // Uptime in seconds for structured parsing
      execCommand(conn, "cat /proc/uptime | awk '{print int($1)}'"),
      // Containers (Docker) or Pods (K8s) — running
      execCommand(conn, containerRunningCmd),
      // Containers (Docker) or Pods (K8s) — total
      execCommand(conn, containerTotalCmd),
      // Network RX/TX bytes on primary interface
      execCommand(conn, "cat /proc/net/dev | grep -E 'eth0|ens|enp' | head -1 | awk '{print $2,$10}'")
    ])

    conn.end()

    // Parse results
    const [ramUsedStr, ramTotalStr] = ramRaw.split(' ')
    const [diskUsedStr, diskTotalStr, diskPercentStr] = diskRaw.split(' ')
    const [rxBytes, txBytes] = networkRaw.split(' ')

    const stats: ServerStats = {
      cpuUsage: Math.round(parseFloat(cpuRaw) || 0),
      ramUsed: parseInt(ramUsedStr) || 0,
      ramTotal: parseInt(ramTotalStr) || 0,
      diskUsed: parseInt(diskUsedStr) || 0,
      diskTotal: parseInt(diskTotalStr) || 0,
      diskPercent: parseInt(diskPercentStr) || 0,
      loadAvg: loadRaw || '0 0 0',
      uptimeSeconds: parseInt(uptimeRaw) || 0,
      dockerRunning: isK8s ? 0 : (parseInt(containerRunningRaw) || 0),
      dockerTotal: isK8s ? 0 : (parseInt(containerTotalRaw) || 0),
      podsRunning: isK8s ? (parseInt(containerRunningRaw) || 0) : undefined,
      podsTotal: isK8s ? (parseInt(containerTotalRaw) || 0) : undefined,
      networkRx: formatBytes(parseInt(rxBytes) || 0),
      networkTx: formatBytes(parseInt(txBytes) || 0)
    }

    // Save to cache
    cache.set(id, { data: stats, fetchedAt: Date.now(), fetching: false })

    return Response.json(stats)
  } catch (err) {
    if (conn) conn.end()

    // Clear fetching flag so next request retries
    const entry = cache.get(id)

    if (entry) entry.fetching = false

    return Response.json({ error: `SSH connection failed: ${(err as Error).message}` }, { status: 500 })
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
