'use client'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Skeleton from '@mui/material/Skeleton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

export type DetailModalState = {
  open: boolean
  metric: string
  title: string
  output: string
  loading: boolean
  /** When viewing docker logs, the container name */
  logContainer?: string
}

export type StatDetailDialogProps = {
  state: DetailModalState
  onClose: () => void
  onRefresh: () => void
  /** Called when user clicks "View Logs" on a container */
  onViewLogs?: (containerName: string) => void
  /** Called to go back from logs to container list */
  onBackToContainers?: () => void
}

// Containers that are designed to run once and exit (depends_on:
// service_completed_successfully). Exit code 0 is the desired outcome.
const initContainerHelp: Record<string, string> = {
  'chown-domain-upgrade-dump':
    'Init job — sets ownership on the domain-upgrade-dump volume so the validator (UID 1001) can write to it. Runs once at startup.'
}

const initKey = (name: string) => name.replace(/^splice-validator-/, '').replace(/-\d+$/, '')
const isInitContainer = (name: string) => initKey(name) in initContainerHelp

const niceName = (n: string) => {
  const s = n.replace(/^splice-validator-/, '').replace(/-\d+$/, '')

  return s.split('-').map((p, i) => i === 0 ? p[0]?.toUpperCase() + p.slice(1) : p).join('-')
}

const shortImage = (img: string) => {
  const i = img.lastIndexOf('/')

  return i >= 0 ? img.slice(i + 1) : img
}

const upDuration = (s: string) => {
  const m = s.match(/^up\s+([^()]+?)(?:\s*\(.*)?$/i)

  return m?.[1]?.trim() || ''
}

type ChipColor = 'success' | 'warning' | 'error' | 'info' | 'default'

const statusInfo = (s: string, name: string): { label: string; color: ChipColor; icon: string } => {
  const low = s.toLowerCase()
  const init = isInitContainer(name)

  if (low.includes('(healthy)')) return { label: 'Healthy', color: 'success', icon: 'tabler-circle-check' }
  if (low.includes('health: starting') || low.includes('starting')) return { label: 'Starting', color: 'info', icon: 'tabler-loader-2' }
  if (low.includes('(unhealthy)')) return { label: 'Unhealthy', color: 'error', icon: 'tabler-alert-triangle' }

  if (low.startsWith('exited (0)')) {
    return init
      ? { label: 'Init done', color: 'success', icon: 'tabler-checkbox' }
      : { label: 'Exited', color: 'default', icon: 'tabler-circle-dot' }
  }

  if (low.startsWith('exited')) return { label: 'Exited (error)', color: 'error', icon: 'tabler-circle-x' }
  if (low.startsWith('up')) return { label: 'Running', color: 'success', icon: 'tabler-circle-check' }
  if (low.startsWith('restarting')) return { label: 'Restarting', color: 'warning', icon: 'tabler-refresh' }
  if (low.startsWith('paused')) return { label: 'Paused', color: 'warning', icon: 'tabler-player-pause' }

  return { label: s, color: 'default', icon: 'tabler-help' }
}

function DockerList({ output, onViewLogs }: { output: string; onViewLogs?: (name: string) => void }) {
  const lines = output.split('\n').filter(l => l.trim().length > 0)

  if (lines.length === 0) {
    return <Alert severity='info' sx={{ m: 2 }}>No containers running</Alert>
  }

  // New format: one JSON object per line (`docker ps --format '{{json .}}'`).
  // Fall back to legacy column-aligned table format for older deployments.
  type Row = { name: string; status: string; image: string; ports: string }
  let rows: Row[] = []

  if (lines[0].startsWith('{')) {
    rows = lines.flatMap(line => {
      try {
        const o = JSON.parse(line) as { Names?: string; Status?: string; Image?: string; Ports?: string }

        return [{ name: o.Names ?? '', status: o.Status ?? '', image: o.Image ?? '', ports: o.Ports ?? '' }]
      } catch {
        return []
      }
    })
  } else if (lines.length >= 2) {
    const header = lines[0]
    const cols = ['NAMES', 'STATUS', 'IMAGE', 'PORTS']
    const positions = cols.map(c => header.indexOf(c)).filter(p => p >= 0)

    const slice = (line: string, i: number) => {
      const start = positions[i]
      const end = i + 1 < positions.length ? positions[i + 1] : line.length

      return line.slice(start, end).trim()
    }

    rows = lines.slice(1).map(line => ({
      name: slice(line, 0),
      status: slice(line, 1),
      image: slice(line, 2),
      ports: slice(line, 3)
    }))
  } else {
    return <Alert severity='info' sx={{ m: 2 }}>{lines[0] || 'No containers running'}</Alert>
  }

  return (
    <div className='flex flex-col p-3 gap-2'>
      {rows.map((r, idx) => {
        const st = statusInfo(r.status, r.name)
        const dur = upDuration(r.status)
        const isStarting = st.label === 'Starting'
        const initHelp = initContainerHelp[initKey(r.name)]

        return (
          <Card
            key={idx}
            variant='outlined'
            sx={{
              px: 2,
              py: 1.5,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 2,
              borderColor: st.color === 'success'
                ? 'success.main'
                : st.color === 'error'
                  ? 'error.main'
                  : st.color === 'warning' || st.color === 'info'
                    ? `${st.color}.main`
                    : 'divider',
              borderLeftWidth: 3,
              background: 'transparent'
            }}
          >
            <i
              className={`${st.icon} ${isStarting ? 'animate-spin' : ''}`}
              style={{
                fontSize: 20,
                marginTop: 2,
                flexShrink: 0,
                color: st.color === 'default'
                  ? 'var(--mui-palette-text-secondary)'
                  : `var(--mui-palette-${st.color}-main)`
              }}
            />
            <div className='flex-1 min-w-0'>
              <div className='flex items-center gap-1.5 flex-wrap'>
                <Typography variant='body2' fontWeight={600} noWrap>
                  {niceName(r.name)}
                </Typography>
                <Chip
                  size='small'
                  label={dur ? `${st.label} · ${dur}` : st.label}
                  color={st.color === 'default' ? undefined : st.color}
                  variant={st.color === 'success' ? 'filled' : 'outlined'}
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />
                {initHelp && (
                  <Tooltip title={initHelp} arrow>
                    <Chip
                      size='small'
                      label='init'
                      variant='outlined'
                      icon={<i className='tabler-info-circle' style={{ fontSize: 12 }} />}
                      sx={{ height: 20, fontSize: '0.6rem' }}
                    />
                  </Tooltip>
                )}
                {onViewLogs && (
                  <Chip
                    size='small'
                    label='Logs'
                    variant='outlined'
                    clickable
                    icon={<i className='tabler-file-text' style={{ fontSize: 12 }} />}
                    onClick={() => onViewLogs(r.name)}
                    sx={{ height: 20, fontSize: '0.6rem', ml: 'auto' }}
                  />
                )}
              </div>
              <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block', mt: 0.25, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                {shortImage(r.image)}{r.ports ? ` · ${r.ports}` : ''}
              </Typography>
              <Typography variant='caption' color='text.disabled' noWrap sx={{ display: 'block', fontSize: '0.63rem' }}>
                {r.name}
              </Typography>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

export function StatDetailDialog({ state, onClose, onRefresh, onViewLogs, onBackToContainers }: StatDetailDialogProps) {
  const isLogs = state.metric === 'dockerlogs'

  return (
    <Dialog open={state.open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle className='flex items-center gap-2'>
        {isLogs && onBackToContainers && (
          <i
            className='tabler-arrow-left cursor-pointer'
            style={{ fontSize: 20 }}
            onClick={onBackToContainers}
          />
        )}
        <i className='tabler-terminal-2 text-primary' />
        {isLogs ? `Logs: ${state.logContainer ?? ''}` : state.title}
      </DialogTitle>
      {state.loading && <LinearProgress />}
      <DialogContent dividers className='custom-scroll' sx={{ p: 0, maxHeight: 'calc(100vh - 240px)' }}>
        {state.loading ? (
          <div className='flex flex-col gap-2 p-4'>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} variant='text' height={22} width={`${80 - i * 8}%`} />
            ))}
          </div>
        ) : state.metric === 'docker' ? (
          <DockerList output={state.output} onViewLogs={onViewLogs} />
        ) : (
          <pre
            className='p-4 text-xs font-mono overflow-x-auto'
            style={{
              margin: 0,
              color: 'var(--mui-palette-text-primary)',
              background: 'var(--mui-palette-background-default)',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {state.output}
          </pre>
        )}
      </DialogContent>
      <DialogActions>
        {isLogs && onBackToContainers && (
          <Button onClick={onBackToContainers} startIcon={<i className='tabler-arrow-left' />}>
            Back
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
        <Button
          variant='outlined'
          size='small'
          startIcon={state.loading ? <CircularProgress size={14} /> : <i className='tabler-refresh' />}
          onClick={onRefresh}
          disabled={state.loading || !state.metric}
        >
          Refresh
        </Button>
      </DialogActions>
    </Dialog>
  )
}
