/**
 * Kubernetes client helpers for NodePilot K8s mode.
 *
 * IMPORTANT: This file is for K8s deployment mode only. Never import it
 * from compose-mode routes. Compose flow continues to use ssh2 directly.
 */

import { KubeConfig, CoreV1Api, AppsV1Api, VersionApi } from '@kubernetes/client-node'

export type K8sClientSet = {
  kc: KubeConfig
  core: CoreV1Api
  apps: AppsV1Api
  version: VersionApi
}

/**
 * Build a Kubernetes client set from a kubeconfig YAML string (as stored in
 * the K8sConfig.kubeconfig DB field).
 */
export function clientFromKubeconfig(kubeconfig: string): K8sClientSet {
  const kc = new KubeConfig()

  kc.loadFromString(kubeconfig)

  return {
    kc,
    core: kc.makeApiClient(CoreV1Api),
    apps: kc.makeApiClient(AppsV1Api),
    version: kc.makeApiClient(VersionApi)
  }
}

/**
 * Test that the cluster is reachable and return basic info.
 * Throws on connection failure.
 */
export async function probeCluster(kubeconfig: string): Promise<{
  serverVersion: string
  nodeCount: number
  contextName: string
}> {
  const { kc, core, version } = clientFromKubeconfig(kubeconfig)

  const ver = await version.getCode()
  const nodes = await core.listNode()

  return {
    serverVersion: ver.gitVersion || 'unknown',
    nodeCount: nodes.items.length,
    contextName: kc.getCurrentContext()
  }
}

/**
 * Ensure a namespace exists. Returns true if created, false if already existed.
 */
export async function ensureNamespace(kubeconfig: string, namespace: string): Promise<boolean> {
  const { core } = clientFromKubeconfig(kubeconfig)

  try {
    await core.readNamespace({ name: namespace })

    return false
  } catch (err: unknown) {
    // Namespace not found → create it
    const errorWithCode = err as { code?: number; statusCode?: number }
    const code = errorWithCode.code ?? errorWithCode.statusCode

    if (code !== 404) throw err

    await core.createNamespace({
      body: {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: namespace }
      }
    })

    return true
  }
}

/**
 * Rewrite the server URL in a k3s-generated kubeconfig.
 * k3s writes "server: https://127.0.0.1:6443" by default — replace 127.0.0.1
 * with the public VPS host so NodePilot (running elsewhere) can reach it.
 */
export function rewriteK3sServerHost(kubeconfig: string, publicHost: string): string {
  return kubeconfig.replace(/server:\s*https:\/\/127\.0\.0\.1:6443/g, `server: https://${publicHost}:6443`)
}
