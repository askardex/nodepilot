import { prisma } from '@/lib/prisma'
import { sshConnect, sshExec, withK8sEnv } from '@/lib/k8s-ssh'

/**
 * POST /api/validators/[id]/k8s/helm-init
 *
 * Phase 3 groundwork: smoke-test the helm + kubectl toolchain on the validator
 * host and stream progress to the UI. Verifies:
 *   1. helm binary present & version
 *   2. kubectl reaches the local cluster
 *   3. k3s nodes are Ready
 *   4. lists existing helm releases (so we can detect prior installs)
 *
 * Streams SSE events: { step, status, message? } and a final { done: true }.
 *
 * No charts are installed here. Actual `helm install` of splice-postgres /
 * splice-validator lands in a follow-up endpoint once values.yaml UX is wired.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const validator = await prisma.validator.findUnique({
    where: { id },
    include: { k8sConfig: true }
  })

  if (!validator) {
    return new Response(JSON.stringify({ error: 'Validator not found' }), { status: 404 })
  }

  if (validator.deploymentMode !== 'k8s') {
    return new Response(JSON.stringify({ error: 'Validator is not in K8s mode' }), { status: 400 })
  }

  if (!validator.k8sConfig?.kubeconfig) {
    return new Response(
      JSON.stringify({ error: 'K8s connection not established — complete K8s Connection card first' }),
      { status: 400 }
    )
  }

  const namespace = validator.k8sConfig.namespace?.trim() || 'validator'

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let conn: Awaited<ReturnType<typeof sshConnect>> | null = null

      const runStep = async (
        step: string,
        cmd: string,
        parse?: (out: string) => string | undefined
      ): Promise<{ ok: boolean; output: string }> => {
        send({ step, status: 'running' })

        const { code, output } = await sshExec(conn!, withK8sEnv(cmd))

        if (code !== 0) {
          send({ step, status: 'error', message: output.split('\n').slice(-1)[0]?.slice(0, 160) || `exit ${code}` })

          return { ok: false, output }
        }

        const summary = parse?.(output) ?? output.split('\n')[0]?.slice(0, 160)

        send({ step, status: 'success', message: summary })

        return { ok: true, output }
      }

      try {
        send({ step: 'SSH Connect', status: 'running' })
        conn = await sshConnect(validator)
        send({ step: 'SSH Connect', status: 'success', message: `connected to ${validator.host}` })

        const helmStep = await runStep(
          'Helm version',
          'helm version --short',
          out => out.trim()
        )

        if (!helmStep.ok) throw new Error('helm not available')

        const kubectlStep = await runStep(
          'kubectl reachable',
          'kubectl version --client=false -o json 2>/dev/null | head -1 || kubectl version --short 2>/dev/null',
          out => {
            const match = out.match(/v\d+\.\d+\.\d+[^\s"]*/)

            return match ? `server ${match[0]}` : out.split('\n')[0]
          }
        )

        if (!kubectlStep.ok) throw new Error('kubectl cannot reach cluster')

        const nodesStep = await runStep(
          'Cluster nodes Ready',
          'kubectl get nodes --no-headers',
          out => {
            const lines = out.trim().split('\n').filter(Boolean)
            const ready = lines.filter(l => /\sReady\s/.test(l)).length

            return `${ready}/${lines.length} Ready`
          }
        )

        if (!nodesStep.ok) throw new Error('cluster nodes not Ready')

        await runStep(
          'Helm releases (existing)',
          `helm list -n ${namespace} 2>/dev/null || true`,
          out => {
            const lines = out.trim().split('\n').filter(Boolean)

            // first line is header: NAME NAMESPACE REVISION ...
            if (lines.length <= 1) return 'no releases yet'

            return `${lines.length - 1} release(s) in ns ${namespace}`
          }
        )

        send({ done: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        send({ step: 'Helm init', status: 'error', message })
        send({ done: true, error: message })
      } finally {
        conn?.end()
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  })
}
