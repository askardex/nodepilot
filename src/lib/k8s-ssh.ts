/**
 * SSH helpers shared across K8s-mode API routes ONLY.
 *
 * Do not import from compose-mode routes — those use their own ssh helpers
 * inside install/route.ts to avoid coupling.
 *
 * All commands are run with PATH augmented to include /usr/local/bin so that
 * `helm` and `kubectl` (installed by k3s install-package step) resolve in
 * non-interactive shells. KUBECONFIG is also exported for k3s VPS hosts.
 */

import { Client } from 'ssh2'

export type SshTarget = {
  host: string
  sshPort: number
  sshUsername: string
  sshAuthType: string
  sshPassword: string | null
  sshPrivateKey: string | null
}

export function sshConnect(target: SshTarget, timeoutMs = 15000): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    const timeout = setTimeout(() => {
      conn.end()
      reject(new Error('SSH connection timed out'))
    }, timeoutMs)

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
      readyTimeout: 10000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 20
    }

    if (target.sshAuthType === 'password') {
      opts.password = target.sshPassword
    } else {
      opts.privateKey = target.sshPrivateKey
    }

    conn.connect(opts as Parameters<Client['connect']>[0])
  })
}

/**
 * Run a single command, returning {code, output}. Output combines stdout+stderr.
 * onChunk is called incrementally for streaming UIs.
 * timeoutMs defaults to 120s — increase for slow operations.
 */
export function sshExec(
  conn: Client,
  command: string,
  onChunk?: (chunk: string) => void,
  timeoutMs = 120_000
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err)

      let output = ''

      const timer = setTimeout(() => {
        stream.close()
        reject(new Error(`SSH exec timed out after ${timeoutMs / 1000}s`))
      }, timeoutMs)

      stream.on('data', (data: Buffer) => {
        const chunk = data.toString()

        output += chunk
        onChunk?.(chunk)
      })
      stream.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString()

        output += chunk
        onChunk?.(chunk)
      })
      stream.on('close', (code: number) => {
        clearTimeout(timer)
        resolve({ code, output: output.trim() })
      })
    })
  })
}

/**
 * Wrap a command so PATH includes /usr/local/bin and KUBECONFIG points at the
 * k3s default location. Safe to call repeatedly; idempotent.
 */
export function withK8sEnv(cmd: string): string {
  return `export PATH=$PATH:/usr/local/bin && export KUBECONFIG=/etc/rancher/k3s/k3s.yaml && ${cmd}`
}
