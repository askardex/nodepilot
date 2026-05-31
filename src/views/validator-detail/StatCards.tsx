'use client'

import dynamic from 'next/dynamic'

import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'

const ApexChart = dynamic(() => import('react-apexcharts'), { ssr: false })

// Dedicated Uptime Card — shows days / hours / minutes as segments
export function UptimeCard({ seconds, onClick }: { seconds: number; onClick?: () => void }) {
  const days  = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins  = Math.floor((seconds % 3600) / 60)

  const segments = [
    { label: 'Days',    value: days },
    { label: 'Hours',   value: hours },
    { label: 'Minutes', value: mins }
  ]

  return (
    <Card
      className='group transition-all duration-200 hover:-translate-y-0.5'
      onClick={onClick}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: '-4px 0 0 0 rgba(40,199,111,0.4), var(--mui-shadows-1)',
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': { boxShadow: '-4px 0 0 0 rgba(40,199,111,0.4), var(--mui-shadows-4)' }
      }}
    >
      <CardContent sx={{ p: '20px !important' }}>
        <div className='flex items-center justify-between mb-3'>
          <Typography variant='body2' color='text.secondary' fontWeight={500}>
            Uptime
          </Typography>
          <div
            className='flex items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110'
            style={{
              inlineSize: 36,
              blockSize: 36,
              background: 'rgb(var(--mui-palette-success-mainChannel) / 0.12)'
            }}
          >
            <i className='tabler-clock text-xl' style={{ color: 'var(--mui-palette-success-main)' }} />
          </div>
        </div>

        <div className='flex items-end gap-3'>
          {segments.map(({ label, value }, i) => (
            <div key={label} className='flex items-end gap-1'>
              <Typography variant='h5' fontWeight={700} sx={{ lineHeight: 1 }}>
                {String(value).padStart(2, '0')}
              </Typography>
              <Typography variant='caption' color='text.disabled' sx={{ mb: '2px' }}>
                {label.toLowerCase()}
              </Typography>
              {i < segments.length - 1 && (
                <Typography variant='h6' color='text.disabled' sx={{ mb: '1px', mx: 0.5 }}>:</Typography>
              )}
            </div>
          ))}
        </div>

        {onClick && (
          <Typography variant='caption' color='text.disabled' className='opacity-0 group-hover:opacity-100 transition-opacity duration-200 block mt-1'>
            details
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

// Accent Stat Card with left color strip
export function StatCard({ icon, label, value, subtitle, color, onClick, sparkline }: {
  icon: string
  label: string
  value: string
  percent?: number
  subtitle?: string
  color: 'success' | 'warning' | 'error' | 'info' | 'primary'
  onClick?: () => void
  sparkline?: number[]
}) {
  // Left accent color by card status
  const shadowColor: Record<string, string> = {
    success: 'rgba(40,199,111,0.4)',
    warning: 'rgba(255,159,67,0.4)',
    error:   'rgba(234,84,85,0.4)',
    info:    'rgba(0,207,232,0.4)',
    primary: 'rgba(115,103,240,0.4)'
  }

  return (
    <Card
      className='group transition-all duration-200 hover:-translate-y-0.5'
      onClick={onClick}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: `-4px 0 0 0 ${shadowColor[color]}, var(--mui-shadows-1)`,
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': {
          boxShadow: `-4px 0 0 0 ${shadowColor[color]}, var(--mui-shadows-4)`
        }
      }}
    >
      <CardContent sx={{ p: '20px !important' }}>
        <div className='flex items-center justify-between'>
          {/* Left: value + label */}
          <div className='flex flex-col gap-1 min-w-0 mr-3'>
            <Typography variant='h5' fontWeight={600} className='truncate' sx={{ lineHeight: 1.3 }}>
              {value}
            </Typography>
            <Typography variant='body2' color='text.secondary'>
              {label}
            </Typography>
            {subtitle && (
              <Typography variant='caption' color='text.disabled'>
                {subtitle}
              </Typography>
            )}
          </div>

          {/* Right: icon badge */}
          <div className='flex flex-col items-end gap-1 shrink-0'>
            <div
              className='flex items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110'
              style={{
                inlineSize: 44,
                blockSize: 44,
                background: `rgb(var(--mui-palette-${color}-mainChannel) / 0.12)`
              }}
            >
              <i className={`${icon} text-2xl`} style={{ color: `var(--mui-palette-${color}-main)` }} />
            </div>
            {onClick && (
              <Typography variant='caption' color='text.disabled' className='opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
                details
              </Typography>
            )}
          </div>
        </div>

        {/* Sparkline chart */}
        {sparkline && sparkline.length > 1 && (
          <div style={{ marginInline: -8, marginBlockEnd: -12, marginBlockStart: 4 }}>
            <ApexChart
              type='area'
              height={60}
              series={[{ name: label, data: sparkline }]}
              options={{
                chart: {
                  sparkline: { enabled: true },
                  animations: { enabled: true, speed: 400 },
                  toolbar: { show: false }
                },
                stroke: { curve: 'smooth', width: 2 },
                fill: {
                  type: 'gradient',
                  gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.35,
                    opacityTo: 0.05,
                    stops: [0, 100]
                  }
                },
                colors: [`var(--mui-palette-${color}-main)`],
                tooltip: {
                  fixed: { enabled: false },
                  x: { show: false },
                  y: { formatter: (v: number) => `${v}` },
                  marker: { show: false },
                  style: { fontSize: '12px' },
                  custom: ({ series, seriesIndex, dataPointIndex }: { series: number[][], seriesIndex: number, dataPointIndex: number }) => {
                    const val = series[seriesIndex][dataPointIndex]

                    return `<div style="background:#1e1e2d;color:#e0e0e0;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,0.08);box-shadow:0 4px 12px rgba(0,0,0,0.4)">${val}</div>`
                  }
                }
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
