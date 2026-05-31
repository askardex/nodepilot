'use client'

import Alert from '@mui/material/Alert'
import IconButton from '@mui/material/IconButton'
import Skeleton from '@mui/material/Skeleton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import { StatCard, UptimeCard } from './StatCards'

import type { ServerStats } from './types'

export type ServerMonitorPanelProps = {
  serverStats: ServerStats | null
  statsError: string | null
  statsLoading: boolean
  statsHistory: { cpu: number[]; ram: number[]; disk: number[]; load: number[] }
  deploymentMode?: string
  onRefresh: () => void
  onOpenDetail: (metric: string, title: string, force?: boolean) => void
}

export function ServerMonitorPanel({
  serverStats, statsError, statsLoading, statsHistory, deploymentMode, onRefresh, onOpenDetail
}: ServerMonitorPanelProps) {
  const isK8s = deploymentMode === 'k8s'
  return (
    <>
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center gap-2'>
          <i className='tabler-activity text-xl text-primary' />
          <Typography variant='subtitle1' fontWeight={600}>Server Monitor</Typography>
          {serverStats && (
            <div className='flex items-center gap-1.5'>
              <div
                style={{
                  inlineSize: 7,
                  blockSize: 7,
                  borderRadius: '50%',
                  background: 'var(--mui-palette-success-main)'
                }}
              />
              <Typography variant='caption' color='success.main' fontWeight={500}>Live</Typography>
            </div>
          )}
        </div>
        <div className='flex items-center gap-2'>
          {serverStats && (
            <Typography variant='caption' color='text.secondary'>
              Refresh 30s
            </Typography>
          )}
          <Tooltip title='Refresh now'>
            <IconButton size='small' onClick={onRefresh} disabled={statsLoading}>
              <i className={`tabler-refresh text-lg ${statsLoading ? 'animate-spin' : ''}`} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {statsError && (
        <Alert severity='warning' sx={{ mb: 2 }}>{statsError}</Alert>
      )}

      {!serverStats && !statsError && (
        <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} variant='rounded' height={100} />
          ))}
        </div>
      )}

      {serverStats && (
        <div className='grid grid-cols-2 sm:grid-cols-4 gap-4'>
          <StatCard
            icon='tabler-cpu'
            label='CPU Usage'
            value={`${serverStats.cpuUsage}%`}
            percent={serverStats.cpuUsage}
            color={serverStats.cpuUsage > 90 ? 'error' : serverStats.cpuUsage > 70 ? 'warning' : 'success'}
            sparkline={statsHistory.cpu}
            onClick={() => onOpenDetail('cpu', 'Top Processes by CPU')}
          />
          <StatCard
            icon='tabler-database'
            label='RAM'
            value={`${(serverStats.ramUsed / 1024).toFixed(1)} / ${(serverStats.ramTotal / 1024).toFixed(1)} GB`}
            percent={Math.round((serverStats.ramUsed / serverStats.ramTotal) * 100)}
            color={(serverStats.ramUsed / serverStats.ramTotal) > 0.9 ? 'error' : (serverStats.ramUsed / serverStats.ramTotal) > 0.7 ? 'warning' : 'success'}
            sparkline={statsHistory.ram}
            onClick={() => onOpenDetail('ram', 'Memory Details')}
          />
          <StatCard
            icon='tabler-device-floppy'
            label='Disk'
            value={`${serverStats.diskUsed} / ${serverStats.diskTotal} GB`}
            percent={serverStats.diskPercent}
            color={serverStats.diskPercent > 90 ? 'error' : serverStats.diskPercent > 75 ? 'warning' : 'success'}
            sparkline={statsHistory.disk}
            onClick={() => onOpenDetail('disk', 'Disk Usage')}
          />
          {(() => {
            const [l1, l5, l15] = serverStats.loadAvg.split(' ')

            return (
              <StatCard
                icon='tabler-chart-line'
                label='Load Average'
                value={l1 ?? '—'}
                subtitle={`5m: ${l5 ?? '—'}  ·  15m: ${l15 ?? '—'}`}
                color='info'
                sparkline={statsHistory.load}
                onClick={() => onOpenDetail('load', 'System Load & Processes')}
              />
            )
          })()}
          <UptimeCard
            seconds={serverStats.uptimeSeconds}
            onClick={() => onOpenDetail('uptime', 'System Uptime & Users')}
          />
          <StatCard
            icon={isK8s ? 'tabler-ship' : 'tabler-brand-docker'}
            label={isK8s ? 'Pods' : 'Docker'}
            value={isK8s
              ? `${serverStats.podsRunning ?? 0} / ${serverStats.podsTotal ?? 0}`
              : `${serverStats.dockerRunning} / ${serverStats.dockerTotal}`}
            subtitle='running / total'
            color={isK8s
              ? ((serverStats.podsRunning ?? 0) === 0 ? 'warning' : 'success')
              : (serverStats.dockerRunning === 0 ? 'error' : 'success')}
            onClick={() => isK8s
              ? onOpenDetail('pods', 'Kubernetes Pods')
              : onOpenDetail('docker', 'Docker Containers')}
          />
          <StatCard
            icon='tabler-download'
            label='Network In'
            value={serverStats.networkRx}
            color='info'
            onClick={() => onOpenDetail('network', 'Network Interfaces')}
          />
          <StatCard
            icon='tabler-upload'
            label='Network Out'
            value={serverStats.networkTx}
            color='info'
            onClick={() => onOpenDetail('network', 'Network Interfaces')}
          />
        </div>
      )}
    </>
  )
}
