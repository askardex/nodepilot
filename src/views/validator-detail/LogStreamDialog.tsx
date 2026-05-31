'use client'

import { useEffect, useRef, useState } from 'react'

import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'

import type { SslLog, SslSummary } from './types'

type LogEntry = SslLog
type Status = 'idle' | 'running' | 'success' | 'failed'

// ─── helpers ───────────────────────────────────────────────────────

function isRaw(level: string) {
  return level === 'stdout' || level === 'stderr'
}

function isHighLevel(level: string) {
  return !isRaw(level)
}

type Block =
  | { kind: 'step'; entry: LogEntry }
  | { kind: 'raw'; lines: string[] }

/** Collapse consecutive stdout/stderr lines into a single collapsible block */
function buildBlocks(logs: LogEntry[]): Block[] {
  const blocks: Block[] = []

  for (const entry of logs) {
    if (isHighLevel(entry.level)) {
      blocks.push({ kind: 'step', entry })
    } else {
      const last = blocks[blocks.length - 1]

      if (last?.kind === 'raw') {
        last.lines.push(entry.message)
      } else {
        blocks.push({ kind: 'raw', lines: [entry.message] })
      }
    }
  }

  return blocks
}

// ─── sub-components ────────────────────────────────────────────────

function StepIcon({ level, active }: { level: string; active: boolean }) {
  if (active) {
    return (
      <span
        className='flex items-center justify-center rounded-full shrink-0'
        style={{
          width: 28, height: 28,
          background: 'rgb(var(--mui-palette-primary-mainChannel) / 0.12)',
          border: '2px solid var(--mui-palette-primary-main)'
        }}
      >
        <i className='tabler-loader-2 text-primary text-sm animate-spin' />
      </span>
    )
  }

  const map: Record<string, { icon: string; bg: string; color: string }> = {
    success: { icon: 'tabler-circle-check', bg: 'rgb(var(--mui-palette-success-mainChannel) / 0.12)', color: 'var(--mui-palette-success-main)' },
    error:   { icon: 'tabler-circle-x',     bg: 'rgb(var(--mui-palette-error-mainChannel) / 0.12)',   color: 'var(--mui-palette-error-main)' },
    stderr:  { icon: 'tabler-circle-x',     bg: 'rgb(var(--mui-palette-error-mainChannel) / 0.12)',   color: 'var(--mui-palette-error-main)' },
    warn:    { icon: 'tabler-alert-triangle', bg: 'rgb(var(--mui-palette-warning-mainChannel) / 0.12)', color: 'var(--mui-palette-warning-main)' },
    info:    { icon: 'tabler-info-circle',   bg: 'rgb(var(--mui-palette-info-mainChannel) / 0.10)',    color: 'var(--mui-palette-info-main)' },
  }

  const s = map[level] ?? map.info

  return (
    <span
      className='flex items-center justify-center rounded-full shrink-0'
      style={{ width: 28, height: 28, background: s.bg }}
    >
      <i className={`${s.icon} text-sm`} style={{ color: s.color }} />
    </span>
  )
}

function RawBlock({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className='ml-7 my-1'>
      <button
        onClick={() => setOpen(v => !v)}
        className='flex items-center gap-1.5 text-xs rounded px-2 py-0.5 transition-colors'
        style={{
          color: 'var(--mui-palette-text-secondary)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        <i className={open ? 'tabler-chevron-down text-xs' : 'tabler-chevron-right text-xs'} />
        {open ? 'Hide details' : `Show details (${lines.length} line${lines.length !== 1 ? 's' : ''})`}
      </button>
      <Collapse in={open}>
        <pre
          className='text-xs font-mono mt-1 rounded-md px-3 py-2 overflow-x-auto'
          style={{
            background: 'var(--mui-palette-action-hover)',
            color: 'var(--mui-palette-text-secondary)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 200,
            overflowY: 'auto',
            margin: 0
          }}
        >
          {lines.join('\n')}
        </pre>
      </Collapse>
    </div>
  )
}

// ─── summary card ──────────────────────────────────────────────────

function SummaryCard({ summary }: { summary: SslSummary }) {
  return (
    <div
      className='rounded-xl px-4 py-3 mt-2'
      style={{
        background: summary.ok
          ? 'rgb(var(--mui-palette-success-mainChannel) / 0.08)'
          : 'rgb(var(--mui-palette-error-mainChannel) / 0.08)',
        border: `1px solid ${summary.ok
          ? 'rgb(var(--mui-palette-success-mainChannel) / 0.3)'
          : 'rgb(var(--mui-palette-error-mainChannel) / 0.3)'}`
      }}
    >
      <div className='flex items-center gap-2 mb-2'>
        <i className={summary.ok
          ? 'tabler-circle-check text-success text-lg'
          : 'tabler-alert-triangle text-error text-lg'}
        />
        <Typography variant='body2' fontWeight={700} color={summary.ok ? 'success.main' : 'error.main'}>
          {summary.ok ? 'Deployment complete' : `Failed — ${summary.stage}`}
        </Typography>
      </div>

      {summary.stage === 'preflight' && (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1 }}>
          Splice-nginx is not listening on port <strong>{summary.spliceNginxPort}</strong>.
          Start the validator first (Stage 6), then retry here.
        </Typography>
      )}

      {summary.probes && summary.probes.length > 0 && (
        <div className='flex flex-col gap-1 mt-2'>
          <Typography variant='caption' color='text.secondary' fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5 }}>
            Smoke test
          </Typography>
          {summary.probes.map(p => (
            <div key={p.name} className='flex items-center gap-2'>
              <i className={p.ok ? 'tabler-check text-success text-sm' : 'tabler-x text-error text-sm'} />
              <Typography variant='caption' fontWeight={600} sx={{ minWidth: 70 }}>{p.name}</Typography>
              <Typography variant='caption' color='text.secondary' sx={{ fontFamily: 'monospace', fontSize: '0.68rem', flexGrow: 1 }} className='truncate'>
                {p.url}
              </Typography>
              <Chip
                label={p.code}
                size='small'
                color={p.ok ? 'success' : 'error'}
                sx={{ height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: '6px' } }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── main component ────────────────────────────────────────────────

export type LogStreamDialogProps = {
  open: boolean
  busy: boolean
  status: Status
  title: string
  iconClass: string
  logs: LogEntry[]
  error: string | null
  summary?: SslSummary | null
  onClose: () => void
  onRetry?: () => void
}

export function LogStreamDialog({
  open, busy, status, title, iconClass, logs, error, summary, onClose, onRetry
}: LogStreamDialogProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  const blocks = buildBlocks(logs)

  const statusChip = status === 'running'
    ? <Chip label='Running…' color='info' size='small' />
    : status === 'success'
      ? <Chip label='Done' color='success' size='small' />
      : status === 'failed'
        ? <Chip label='Failed' color='error' size='small' />
        : null

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      maxWidth='sm'
      fullWidth
      PaperProps={{ sx: { maxInlineSize: 560 } }}
    >
      <DialogTitle>
        <div className='flex items-center gap-2'>
          <i className={iconClass} />
          <span className='flex-1'>{title}</span>
          {statusChip}
        </div>
      </DialogTitle>

      {busy && <LinearProgress />}

      <DialogContent
        dividers
        className='custom-scroll'
        sx={{ maxHeight: 'calc(100vh - 240px)', minHeight: 260 }}
      >
        <div className='flex flex-col gap-0.5 py-1'>
          {logs.length === 0 && !error && (
            <div className='flex items-center gap-3 py-4 justify-center'>
              <i className='tabler-loader-2 text-primary animate-spin text-lg' />
              <Typography variant='body2' color='text.secondary'>Connecting…</Typography>
            </div>
          )}

          {error && (
            <div
              className='flex items-start gap-3 rounded-lg px-3 py-2.5 mb-2'
              style={{
                background: 'rgb(var(--mui-palette-error-mainChannel) / 0.08)',
                border: '1px solid rgb(var(--mui-palette-error-mainChannel) / 0.25)'
              }}
            >
              <i className='tabler-circle-x text-error text-base shrink-0 mt-0.5' />
              <Typography variant='caption' color='error.main'>{error}</Typography>
            </div>
          )}

          {blocks.map((block, idx) => {
            if (block.kind === 'raw') {
              return <RawBlock key={idx} lines={block.lines} />
            }

            const { entry } = block
            const isLast = idx === blocks.length - 1
            const isActive = isLast && busy

            const textColor = entry.level === 'error' || entry.level === 'stderr'
              ? 'error.main'
              : entry.level === 'warn'
                ? 'warning.main'
                : entry.level === 'success'
                  ? 'success.main'
                  : 'text.primary'

            return (
              <div key={idx} className='flex items-start gap-3 px-1 py-1'>
                {/* connector line */}
                <div className='flex flex-col items-center' style={{ minWidth: 28 }}>
                  <StepIcon level={entry.level} active={isActive} />
                  {idx < blocks.length - 1 && (
                    <div
                      style={{
                        width: 2,
                        flexGrow: 1,
                        minHeight: 12,
                        background: 'var(--mui-palette-divider)',
                        margin: '2px 0'
                      }}
                    />
                  )}
                </div>
                <div className='flex flex-col gap-0.5 pt-0.5 flex-1 min-w-0'>
                  <Typography variant='body2' color={textColor} sx={{ lineHeight: 1.5, wordBreak: 'break-word' }}>
                    {entry.message}
                  </Typography>
                  <Typography variant='caption' color='text.disabled' sx={{ fontSize: '0.65rem' }}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </Typography>
                </div>
              </div>
            )
          })}

          {summary && <SummaryCard summary={summary} />}

          <div ref={bottomRef} />
        </div>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={busy} color='inherit' size='small'>
          {status === 'success' ? 'Close' : 'Cancel'}
        </Button>
        {status === 'failed' && !busy && onRetry && (
          <Button
            variant='contained'
            size='small'
            startIcon={<i className='tabler-refresh text-base' />}
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
