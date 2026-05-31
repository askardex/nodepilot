import { prisma } from '@/lib/prisma'
import { Client } from 'ssh2'

type InstallStep = {
  step: string
  status: 'pending' | 'running' | 'success' | 'error'
  message?: string
  progress?: number // 0-100 for download progress
}

function connectSSH(validator: { host: string; sshPort: number; sshUsername: string; sshAuthType: string; sshPassword: string | null; sshPrivateKey: string | null }): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    const timeout = setTimeout(() => {
      conn.end()
      reject(new Error('SSH connection timed out'))
    }, 30000)

    conn.on('ready', () => { clearTimeout(timeout); resolve(conn) })
    conn.on('error', (err) => { clearTimeout(timeout); reject(err) })

    const config: Record<string, unknown> = {
      host: validator.host,
      port: validator.sshPort,
      username: validator.sshUsername,
      readyTimeout: 15000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 20
    }

    if (validator.sshAuthType === 'password') {
      config.password = validator.sshPassword
    } else {
      config.privateKey = validator.sshPrivateKey
    }

    conn.connect(config as Parameters<Client['connect']>[0])
  })
}

function execStream(conn: Client, command: string, onData?: (chunk: string) => void): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err)

      let output = ''

      stream.on('data', (data: Buffer) => {
        const chunk = data.toString()

        output += chunk
        onData?.(chunk)
      })
      stream.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString()

        output += chunk
        onData?.(chunk)
      })
      stream.on('close', (code: number) => resolve({ code, output: output.trim() }))
    })
  })
}

// POST /api/validators/[id]/install
// Body: { version: "0.5.17", customUrl?: string }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { version?: string; customUrl?: string } = {}

  try { body = await request.json() } catch { /* empty body ok */ }

  const version = body.version ?? '0.5.17'
  const customUrl = body.customUrl?.trim()

  // Per-version install path so multiple versions can coexist on the same host
  // without overwriting each other. The "active" one is tracked via
  // SpliceInstallation.isActive and mirrored to Validator.installPath.
  const installPath = `/root/splice-nodes/v${version}`

  const validator = await prisma.validator.findUnique({ where: { id } })

  if (!validator) {
    return new Response(JSON.stringify({ error: 'Validator not found' }), { status: 404 })
  }

  if (validator.deploymentMode === 'k8s') {
    return new Response(
      JSON.stringify({ error: 'Compose install disabled in K8s mode — Helm install lands in Phase 3' }),
      { status: 400 }
    )
  }

  // Mark as installing
  await prisma.validator.update({
    where: { id },
    data: { installState: 'Installing', installError: null, spliceVersion: version, installPath }
  })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: InstallStep | { log: string } | { done: true }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let conn: Client | null = null
      let installLog = ''

      const run = async (label: string, cmd: string): Promise<boolean> => {
        send({ step: label, status: 'running' })

        const { code, output } = await execStream(conn!, cmd, chunk => {
          installLog += chunk
        })

        if (code !== 0) {
          send({ step: label, status: 'error', message: `exit code ${code}` })

          return false
        }

        send({ step: label, status: 'success', message: output.split('\n').slice(-1)[0]?.slice(0, 80) })

        return true
      }

      try {
        // Connect
        send({ step: 'SSH Connect', status: 'running' })
        conn = await connectSSH(validator)
        send({ step: 'SSH Connect', status: 'success', message: `connected to ${validator.host}` })

        // Step 1: Prerequisites — per Canton docs the host must have:
        //   docker compose (>= 2.26.0), curl, jq, tar
        // Detect arch (AMD64 / ARM64 are both supported).
        send({ step: 'Check prerequisites', status: 'running' })

        const preCmd = [
          'which curl >/dev/null 2>&1 || { echo "MISSING: curl"; exit 11; }',
          'which tar  >/dev/null 2>&1 || { echo "MISSING: tar";  exit 12; }',
          'which jq   >/dev/null 2>&1 || { echo "MISSING: jq";   exit 13; }',
          'which docker >/dev/null 2>&1 || { echo "MISSING: docker"; exit 14; }',
          // docker compose v2 is "docker compose" (not "docker-compose"); require >= 2.26.0
          'DC_VER=$(docker compose version --short 2>/dev/null) || { echo "MISSING: docker compose plugin"; exit 15; }',
          // simple lexicographic version compare on dotted numbers
          'awk -v v="$DC_VER" -v min="2.26.0" \'BEGIN{ split(v,a,"."); split(min,b,"."); for(i=1;i<=3;i++){ ai=a[i]+0; bi=b[i]+0; if(ai>bi)exit 0; if(ai<bi)exit 1 } exit 0 }\' || { echo "OUTDATED: docker compose $DC_VER (need >= 2.26.0)"; exit 16; }',
          'echo "OK arch=$(uname -m) docker-compose=$DC_VER"'
        ].join(' && ')

        const preResult = await execStream(conn, preCmd, chunk => { installLog += chunk })

        if (preResult.code !== 0) {
          send({ step: 'Check prerequisites', status: 'error', message: preResult.output.split('\n').slice(-1)[0]?.slice(0, 120) })
          throw new Error(`prerequisites failed: ${preResult.output.slice(-200)}`)
        }

        const arch = preResult.output.includes('aarch64') || preResult.output.includes('arm64') ? 'arm64' : 'amd64'
        const dcMatch = preResult.output.match(/docker-compose=([^\s]+)/)
        const dcVer = dcMatch?.[1] ?? '?'

        send({ step: 'Check prerequisites', status: 'success', message: `arch: ${arch} · compose: ${dcVer}` })

        // Step 3: Create install directory
        if (!(await run('Prepare directory', `mkdir -p ${installPath} && cd ${installPath}`))) throw new Error('mkdir failed')

        // Step 4: Download tarball with progress parsing
        const tarballUrl = customUrl || `https://github.com/digital-asset/decentralized-canton-sync/releases/download/v${version}/${version}_splice-node.tar.gz`
        const tarballPath = `/tmp/${version}_splice-node.tar.gz`

        send({ step: `Download Splice ${version}`, status: 'running', progress: 0 })

        // First, get total size via HEAD
        const headResult = await execStream(conn, `curl -sIL --max-time 30 "${tarballUrl}" | grep -i content-length | tail -1 | awk '{print $2}' | tr -d '\\r'`)
        const totalBytes = parseInt(headResult.output.trim(), 10) || 0
        const totalMB = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(0) : '?'

        // Use curl with byte progress (-w/--write-out periodic via xargs not portable; instead use stderr % parsing)
        const downloadCmd = `curl -fL --progress-bar --max-time 600 -o ${tarballPath} "${tarballUrl}" 2>&1`
        let lastProgress = 0
        const downloadResult = await execStream(conn, downloadCmd, chunk => {
          installLog += chunk
          // Parse percent from curl progress-bar output (e.g. "##### 45.6%")
          const matches = chunk.match(/(\d{1,3}(?:\.\d+)?)%/g)

          if (matches && matches.length > 0) {
            const last = matches[matches.length - 1]
            const pct = parseFloat(last)

            if (!isNaN(pct) && pct - lastProgress >= 1) {
              lastProgress = pct
              const downloadedMB = totalBytes > 0 ? ((totalBytes * pct / 100) / 1024 / 1024).toFixed(0) : '?'

              send({
                step: `Download Splice ${version}`,
                status: 'running',
                progress: Math.min(pct, 99),
                message: totalBytes > 0 ? `${downloadedMB} / ${totalMB} MB` : `${pct.toFixed(0)}%`
              })
            }
          }
        })

        if (downloadResult.code !== 0) {
          send({ step: `Download Splice ${version}`, status: 'error', message: `curl exited ${downloadResult.code}` })
          throw new Error('download failed')
        }

        send({
          step: `Download Splice ${version}`,
          status: 'success',
          progress: 100,
          message: totalBytes > 0 ? `${totalMB} MB downloaded` : 'completed'
        })

        // Step 5: Verify tarball size
        const sizeResult = await execStream(conn, `du -h ${tarballPath} | awk '{print $1}'`)

        send({ step: 'Verify download', status: 'success', message: sizeResult.output.trim() })

        // Step 6: Extract
        send({ step: 'Extract archive', status: 'running' })
        const extractResult = await execStream(
          conn,
          `tar -xzf ${tarballPath} -C ${installPath} --strip-components=1`,
          chunk => { installLog += chunk }
        )

        if (extractResult.code !== 0) {
          send({ step: 'Extract archive', status: 'error', message: `tar exited ${extractResult.code}` })
          throw new Error('extract failed')
        }

        send({ step: 'Extract archive', status: 'success' })

        // Step 6.5: Patch compose.yaml — the canton-participant Docker image
        // ships a HEALTHCHECK that uses "localhost:5061" which resolves to
        // ::1 (IPv6) inside the container, but the gRPC health server only
        // binds to 0.0.0.0 (IPv4). This makes the health check permanently
        // fail → Docker keeps restarting the container in a loop. We add a
        // compose-level healthcheck (overrides image-level) that uses the
        // explicit IPv4 address. Idempotent — only patches if not already done.
        send({ step: 'Patch healthcheck (IPv4 fix)', status: 'running' })
        const composeFile = `${installPath}/docker-compose/validator/compose.yaml`
        const patchHc = await execStream(conn, [
          `if [ -f ${composeFile} ] && ! grep -q '127.0.0.1:5061' ${composeFile}; then`,
          `  sed -i '/^  participant:/,/^  [a-z]/{/restart: always/a\\    healthcheck:\\n      test: ["CMD-SHELL", "grpcurl -plaintext 127.0.0.1:5061 grpc.health.v1.Health/Check || exit 1"]\\n      interval: 5s\\n      timeout: 5s\\n      retries: 3\\n      start_period: 600s\n}' ${composeFile} && echo PATCHED`,
          `else echo "ALREADY_PATCHED"; fi`
        ].join('; '))

        if (patchHc.output.includes('PATCHED')) {
          send({ step: 'Patch healthcheck (IPv4 fix)', status: 'success', message: 'Added IPv4 healthcheck for participant' })
        } else {
          send({ step: 'Patch healthcheck (IPv4 fix)', status: 'success', message: 'Already patched' })
        }

        // Step 6.6: Same IPv6 fix for validator-app — its image HEALTHCHECK
        // uses "localhost:5003" which resolves to ::1 → health check fails →
        // Docker restarts the container in a loop.
        send({ step: 'Patch validator-app healthcheck', status: 'running' })
        const patchHcVal = await execStream(conn, [
          `if [ -f ${composeFile} ] && ! grep -q '127.0.0.1:5003' ${composeFile}; then`,
          `  sed -i '/^  validator:/,/^  [a-z]/{/restart: always/a\\    healthcheck:\\n      test: ["CMD-SHELL", "curl -sSfk https://127.0.0.1:5003/api/validator/livez || exit 1"]\\n      interval: 10s\\n      timeout: 5s\\n      retries: 3\\n      start_period: 600s\n}' ${composeFile} && echo PATCHED`,
          `else echo "ALREADY_PATCHED"; fi`
        ].join('; '))

        if (patchHcVal.output.includes('PATCHED')) {
          send({ step: 'Patch validator-app healthcheck', status: 'success', message: 'Added IPv4 healthcheck for validator-app' })
        } else {
          send({ step: 'Patch validator-app healthcheck', status: 'success', message: 'Already patched' })
        }

        // Step 7: Verify structure
        send({ step: 'Verify install', status: 'running' })
        const verifyResult = await execStream(conn, `test -d ${installPath}/docker-compose/validator && echo OK`)

        if (!verifyResult.output.includes('OK')) {
          send({ step: 'Verify install', status: 'error', message: 'docker-compose/validator not found' })
          throw new Error('invalid structure')
        }

        send({ step: 'Verify install', status: 'success', message: 'docker-compose/validator present' })

        // Step 8: Cleanup tarball
        send({ step: 'Cleanup', status: 'running' })
        await execStream(conn, `rm -f ${tarballPath}`)
        send({ step: 'Cleanup', status: 'success' })

        // Note: docker compose pull is skipped here — it requires .env (IMAGE_TAG, etc.)
        // which will be configured in the next stage (Configure → Start)

        conn.end()

        // Record/update the installation row and mark it active
        // (deactivate any previously-active installation for this validator).
        await prisma.$transaction([
          prisma.spliceInstallation.updateMany({
            where: { validatorId: id },
            data: { isActive: false }
          }),
          prisma.spliceInstallation.upsert({
            where: { validatorId_version: { validatorId: id, version } },
            create: { validatorId: id, version, installPath, isActive: true },
            update: { installPath, isActive: true, installedAt: new Date() }
          }),
          prisma.validator.update({
            where: { id },
            data: {
              installState: 'Installed',
              spliceVersion: version,
              installPath,
              installLog: installLog.slice(-5000),
              installedAt: new Date()
            }
          })
        ])

        send({ step: 'Complete', status: 'success', message: `Splice ${version} installed at ${installPath}` })
        send({ done: true })
        controller.close()
      } catch (err) {
        if (conn) conn.end()

        const errorMsg = (err as Error).message

        await prisma.validator.update({
          where: { id },
          data: {
            installState: 'InstallError',
            installError: errorMsg,
            installLog: installLog.slice(-5000)
          }
        })

        send({ step: 'Failed', status: 'error', message: errorMsg })
        send({ done: true })
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }
  })
}
