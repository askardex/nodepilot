'use client'

import { useState } from 'react'

import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Stack from '@mui/material/Stack'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import Chip from '@mui/material/Chip'
import Box from '@mui/material/Box'

import type { Validator } from './types'
import { ActionCard, type ChipStatusColor } from './ActionCard'

// ─── K8s Connection Status (lives only on detail page; never affects compose) ──

export type K8sConnectionState = {
  connected: boolean
  serverVersion?: string
  nodeCount?: number
  namespace?: string
  namespaceReady?: boolean
}

export function K8sConnectionCard({
  state, onClick
}: { state: K8sConnectionState; onClick: () => void }) {
  const fullyReady = state.connected && state.namespaceReady
  const partial = state.connected && !state.namespaceReady

  const chipLabel: string | undefined = fullyReady
    ? 'Ready'
    : partial
      ? 'Cluster OK'
      : state.connected
        ? 'Connected'
        : undefined

  const chipColor: ChipStatusColor = fullyReady ? 'success' : partial ? 'warning' : 'default'

  const accent = state.connected
    ? 'linear-gradient(90deg, var(--mui-palette-info-main), var(--mui-palette-info-light))'
    : 'linear-gradient(90deg, var(--mui-palette-primary-main), transparent)'

  return (
    <ActionCard
      icon='tabler-ship'
      title='K8s Connection'
      caption='Kubeconfig · Cluster · Namespace'
      chipLabel={chipLabel}
      chipColor={chipColor}
      accentColor='info'
      customAccentBar={accent}
      showBackgroundPattern
      onClick={onClick}
      extra={state.connected ? (
        <Box mt={1}>
          <Typography variant='caption' color='text.secondary' display='block'>
            {state.serverVersion} · {state.nodeCount} node{(state.nodeCount ?? 0) === 1 ? '' : 's'}
          </Typography>
          {state.namespace && (
            <Typography variant='caption' color='text.secondary' display='block'>
              ns: {state.namespace} {state.namespaceReady ? '✓' : '(not created)'}
            </Typography>
          )}
        </Box>
      ) : undefined}
    />
  )
}

// ─── K8s Connection Dialog ──────────────────────────────────────────

type ConnectResult = {
  ok?: boolean
  cluster?: { serverVersion: string; nodeCount: number; contextName: string }
  namespace?: string
  error?: string
}

type NsResult = { ok?: boolean; namespace?: string; created?: boolean; message?: string; error?: string }

export function K8sConnectionDialog({
  open, validator, onClose, onStateChange
}: {
  open: boolean
  validator: Validator
  onClose: () => void
  onStateChange: (next: K8sConnectionState) => void
}) {
  const [busy, setBusy] = useState<'connect' | 'test' | 'namespace' | null>(null)
  const [connect, setConnect] = useState<ConnectResult | null>(null)
  const [test, setTest] = useState<{ ok: boolean; serverVersion?: string; nodeCount?: number; contextName?: string; at?: string } | null>(null)
  const [ns, setNs] = useState<NsResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const callApi = async (path: string) => {
    const res = await fetch(`/api/validators/${validator.id}/k8s/${path}`, { method: 'POST' })
    const data = await res.json()

    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

    return data
  }

  const runConnect = async () => {
    setBusy('connect')
    setError(null)

    try {
      const data: ConnectResult = await callApi('connect')

      setConnect(data)
      onStateChange({
        connected: true,
        serverVersion: data.cluster?.serverVersion,
        nodeCount: data.cluster?.nodeCount,
        namespace: data.namespace,
        namespaceReady: false
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const runTest = async () => {
    setBusy('test')
    setError(null)
    setTest(null)

    try {
      const data = await callApi('test-connection')

      setTest({
        ok: true,
        serverVersion: data.serverVersion,
        nodeCount: data.nodeCount,
        contextName: data.contextName,
        at: new Date().toLocaleTimeString()
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setTest({ ok: false })
    } finally {
      setBusy(null)
    }
  }

  const runNamespace = async () => {
    setBusy('namespace')
    setError(null)

    try {
      const data: NsResult = await callApi('setup-namespace')

      setNs(data)

      if (connect?.cluster) {
        onStateChange({
          connected: true,
          serverVersion: connect.cluster.serverVersion,
          nodeCount: connect.cluster.nodeCount,
          namespace: data.namespace,
          namespaceReady: true
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>K8s Connection</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <Typography variant='body2' color='text.secondary'>
            Connect NodePilot to your Kubernetes cluster, verify reachability, and create
            the deployment namespace.
          </Typography>

          {/* Step 1 */}
          <Box>
            <Stack direction='row' alignItems='center' spacing={1.5}>
              <Chip size='small' label='1' />
              <Typography variant='subtitle2' sx={{ flex: 1 }}>Fetch kubeconfig from VPS</Typography>
              <Button
                size='small'
                variant='contained'
                disabled={busy !== null}
                onClick={runConnect}
              >
                {busy === 'connect' ? 'Connecting…' : 'Connect'}
              </Button>
            </Stack>
            <Typography variant='caption' color='text.secondary' sx={{ ml: 5 }}>
              SSH into {validator.host} → read /etc/rancher/k3s/k3s.yaml → save to NodePilot
            </Typography>
            {busy === 'connect' && <LinearProgress sx={{ mt: 1 }} />}
            {connect?.cluster && (
              <Alert severity='success' sx={{ mt: 1 }}>
                Cluster {connect.cluster.serverVersion} · {connect.cluster.nodeCount} node(s)
                · ctx: {connect.cluster.contextName}
              </Alert>
            )}
          </Box>

          {/* Step 2 */}
          <Box>
            <Stack direction='row' alignItems='center' spacing={1.5}>
              <Chip size='small' label='2' />
              <Typography variant='subtitle2' sx={{ flex: 1 }}>Test connection</Typography>
              <Button
                size='small'
                variant='outlined'
                disabled={busy !== null}
                onClick={runTest}
              >
                {busy === 'test' ? 'Testing…' : 'Test'}
              </Button>
            </Stack>
            <Typography variant='caption' color='text.secondary' sx={{ ml: 5 }}>
              Re-probe the cluster using the saved kubeconfig
            </Typography>
            {busy === 'test' && <LinearProgress sx={{ mt: 1 }} />}
            {test?.ok && (
              <Alert severity='success' sx={{ mt: 1 }}>
                Reachable · {test.serverVersion} · {test.nodeCount} node(s) · ctx: {test.contextName}
                {test.at && <> · {test.at}</>}
              </Alert>
            )}
          </Box>

          {/* Step 3 */}
          <Box>
            <Stack direction='row' alignItems='center' spacing={1.5}>
              <Chip size='small' label='3' />
              <Typography variant='subtitle2' sx={{ flex: 1 }}>Create namespace</Typography>
              <Button
                size='small'
                variant='contained'
                color='secondary'
                disabled={busy !== null || !connect?.cluster}
                onClick={runNamespace}
              >
                {busy === 'namespace' ? 'Creating…' : 'Create'}
              </Button>
            </Stack>
            <Typography variant='caption' color='text.secondary' sx={{ ml: 5 }}>
              Idempotent — safe to run repeatedly
            </Typography>
            {busy === 'namespace' && <LinearProgress sx={{ mt: 1 }} />}
            {ns?.ok && (
              <Alert severity='success' sx={{ mt: 1 }}>{ns.message}</Alert>
            )}
          </Box>

          {error && <Alert severity='error'>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
