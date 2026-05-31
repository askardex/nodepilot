import { prisma } from '@/lib/prisma'
import { Client } from 'ssh2'

function connectSSH(validator: { host: string; sshPort: number; sshUsername: string; sshAuthType: string; sshPassword: string | null; sshPrivateKey: string | null }): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    const timeout = setTimeout(() => {
      conn.end()
      reject(new Error('SSH connection timed out'))
    }, 15000)

    conn.on('ready', () => { clearTimeout(timeout); resolve(conn) })
    conn.on('error', (err) => { clearTimeout(timeout); reject(err) })

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
      if (err) { reject(err); return }

      let output = ''

      stream.on('data', (data: Buffer) => { output += data.toString() })
      stream.stderr.on('data', () => {})
      stream.on('close', () => resolve(output.trim()))
    })
  })
}

const metricCommands: Record<string, { title: string; command: string }> = {
  cpu: {
    title: 'Top Processes by CPU',
    command: "ps aux --sort=-%cpu | awk 'NR<=11 {printf \"%-10s %-6s %-6s %s\\n\", $1, $3, $4, $11}'"
  },
  ram: {
    title: 'Memory Details',
    command: "free -h && echo '---' && cat /proc/meminfo | grep -E 'MemTotal|MemFree|MemAvailable|Cached|Buffers|SwapTotal|SwapFree'"
  },
  disk: {
    title: 'Disk Usage',
    command: "df -h | grep -v tmpfs | grep -v udev"
  },
  docker: {
    title: 'Docker Containers',
    // Use JSON format (one object per line) — deterministic parsing in the
    // UI. The "table" format aligns columns based on widest cell, which
    // breaks when one container's STATUS contains "(health: starting)".
    command: "docker ps -a --format '{{json .}}' 2>/dev/null || echo 'Docker not available'"
  },
  network: {
    title: 'Network Interfaces',
    command: "cat /proc/net/dev | awk 'NR>2 {printf \"%-12s RX: %-12s TX: %s\\n\", $1, $2, $10}' && echo '---' && ss -s 2>/dev/null | head -5"
  },
  load: {
    title: 'System Load & Processes',
    command: "uptime && echo '---' && ps aux --sort=-%cpu | awk 'NR<=6 {printf \"%-20s CPU:%-6s MEM:%-6s %s\\n\", $1, $3, $4, $11}'"
  },
  uptime: {
    title: 'System Uptime & Users',
    command: "uptime && echo '---' && who && echo '---' && last | head -5"
  },
  dockerlogs: {
    title: 'Docker Container Logs',
    // container name is passed via query param; command is built dynamically below
    command: ''
  }
}

// GET /api/validators/[id]/server-stats/detail?metric=cpu|ram|disk|docker|network|load|uptime|dockerlogs&container=NAME
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const metric = searchParams.get('metric') ?? 'cpu'

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) {
    return Response.json({ error: 'Validator not found' }, { status: 404 })
  }

  const metricConfig = metricCommands[metric]

  if (!metricConfig) {
    return Response.json({ error: `Unknown metric: ${metric}` }, { status: 400 })
  }

  let conn: Client | null = null

  try {
    conn = await connectSSH(validator)

    let command = metricConfig.command

    // Dynamic command for dockerlogs: fetch last 100 lines of a container
    if (metric === 'dockerlogs') {
      const container = searchParams.get('container') ?? ''

      // Sanitize container name — only allow alphanumeric, dash, underscore, dot
      if (!container || !/^[a-zA-Z0-9._-]+$/.test(container)) {
        conn.end()

        return Response.json({ error: 'Invalid or missing container name' }, { status: 400 })
      }

      command = `docker logs --tail 100 --timestamps "${container}" 2>&1 || echo "Container not found"`
    }

    const output = await execCommand(conn, command)

    conn.end()

    return Response.json({ title: metricConfig.title, output })
  } catch (err) {
    if (conn) conn.end()

    return Response.json({ error: `SSH failed: ${(err as Error).message}` }, { status: 500 })
  }
}
