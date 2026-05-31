'use client'

import Typography from '@mui/material/Typography'

type CheckItem = { name: string; value: string; status: string }

type Props = {
  history?: CheckItem[]
  label?: string
}

const ITEM_HEIGHT = 64
const VISIBLE_ROWS = 3

/**
 * Vertical roller loader. The strip translates up smoothly so the latest
 * item slides into the center "spotlight" slot. Items above/below are
 * blurred — like a slot-machine reel. Network animation surrounds it.
 */
export default function RollerLoader({ history = [], label = 'Connecting...' }: Props) {
  const centerIdx = history.length - 1

  return (
    <div className='flex flex-col items-center justify-center gap-4 py-4'>
      {/* Compact network animation */}
      <div className='relative' style={{ inlineSize: 120, blockSize: 120 }}>
        <svg
          viewBox='0 0 200 200'
          width='120'
          height='120'
          xmlns='http://www.w3.org/2000/svg'
          style={{ overflow: 'visible' }}
        >
          <circle
            cx='100'
            cy='100'
            r='80'
            fill='none'
            stroke='var(--mui-palette-primary-main)'
            strokeWidth='1'
            strokeDasharray='4 8'
            opacity='0.3'
            style={{ transformOrigin: '100px 100px', animation: 'bcRotate 8s linear infinite' }}
          />

          {[
            [100, 30, 165, 65],
            [165, 65, 165, 135],
            [165, 135, 100, 170],
            [100, 170, 35, 135],
            [35, 135, 35, 65],
            [35, 65, 100, 30],
            [100, 30, 100, 100],
            [165, 65, 100, 100],
            [165, 135, 100, 100],
            [100, 170, 100, 100],
            [35, 135, 100, 100],
            [35, 65, 100, 100]
          ].map(([x1, y1, x2, y2], i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke='var(--mui-palette-primary-main)'
              strokeWidth='1'
              opacity='0.25'
              strokeDasharray='3 3'
              style={{ animation: `bcDash ${2 + (i % 3)}s linear infinite` }}
            />
          ))}

          {[
            { cx: 100, cy: 30, delay: 0 },
            { cx: 165, cy: 65, delay: 0.2 },
            { cx: 165, cy: 135, delay: 0.4 },
            { cx: 100, cy: 170, delay: 0.6 },
            { cx: 35, cy: 135, delay: 0.8 },
            { cx: 35, cy: 65, delay: 1.0 }
          ].map((node, i) => (
            <g key={i}>
              <circle
                cx={node.cx}
                cy={node.cy}
                r='8'
                fill='var(--mui-palette-primary-main)'
                opacity='0.3'
                style={{
                  transformOrigin: `${node.cx}px ${node.cy}px`,
                  animation: 'bcPulse 2s ease-in-out infinite',
                  animationDelay: `${node.delay}s`
                }}
              />
              <circle
                cx={node.cx}
                cy={node.cy}
                r='5'
                fill='var(--mui-palette-primary-main)'
                style={{
                  animation: 'bcNodeBlink 2s ease-in-out infinite',
                  animationDelay: `${node.delay}s`
                }}
              />
            </g>
          ))}

          <g>
            <circle
              cx='100'
              cy='100'
              r='14'
              fill='var(--mui-palette-primary-main)'
              opacity='0.2'
              style={{ transformOrigin: '100px 100px', animation: 'bcCenterPulse 1.5s ease-in-out infinite' }}
            />
            <circle cx='100' cy='100' r='8' fill='var(--mui-palette-primary-main)' />
            <circle cx='97' cy='97' r='2' fill='white' opacity='0.6' />
          </g>
        </svg>
      </div>

      {/* Roller window */}
      <div
        className='relative w-full max-w-md overflow-hidden'
        style={{ blockSize: ITEM_HEIGHT * VISIBLE_ROWS }}
      >
        {/* Center spotlight border */}
        <div
          className='absolute left-0 right-0 z-20 pointer-events-none border-y border-divider'
          style={{ insetBlockStart: ITEM_HEIGHT, blockSize: ITEM_HEIGHT, backgroundColor: 'rgb(var(--mui-palette-primary-mainChannel) / 0.04)' }}
        />

        {/* Top fade overlay */}
        <div
          className='absolute top-0 left-0 right-0 z-30 pointer-events-none'
          style={{
            blockSize: ITEM_HEIGHT,
            background: 'linear-gradient(to bottom, var(--mui-palette-background-paper) 20%, transparent 100%)'
          }}
        />
        {/* Bottom fade overlay */}
        <div
          className='absolute bottom-0 left-0 right-0 z-30 pointer-events-none'
          style={{
            blockSize: ITEM_HEIGHT,
            background: 'linear-gradient(to top, var(--mui-palette-background-paper) 20%, transparent 100%)'
          }}
        />

        {/* The translating strip */}
        {history.length === 0 ? (
          <div className='absolute inset-0 flex items-center justify-center'>
            <Typography variant='body2' color='text.secondary'>{label}</Typography>
          </div>
        ) : (
          <div
            style={{
              transform: `translateY(${-(centerIdx) * ITEM_HEIGHT}px)`,
              transition: 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)'
            }}
          >
            {/* Spacer so the first item lands in the center slot */}
            <div style={{ blockSize: ITEM_HEIGHT }} />

            {history.map((item, i) => {
              const isCenter = i === centerIdx

              return (
                <div
                  key={i}
                  className='flex items-center gap-3 px-5'
                  style={{
                    blockSize: ITEM_HEIGHT,
                    filter: isCenter ? 'blur(0px)' : 'blur(3px)',
                    opacity: isCenter ? 1 : 0.4,
                    transform: isCenter ? 'scale(1)' : 'scale(0.92)',
                    transition: 'filter 0.6s ease-out, opacity 0.6s ease-out, transform 0.6s ease-out'
                  }}
                >
                  <i className={`text-2xl ${
                    item.status === 'pass' ? 'tabler-circle-check text-success' :
                    item.status === 'fail' ? 'tabler-circle-x text-error' :
                    item.status === 'warn' ? 'tabler-alert-triangle text-warning' :
                    'tabler-info-circle text-info'
                  }`} />
                  <div className='flex flex-col items-start min-w-0 flex-1'>
                    <Typography
                      variant='caption'
                      color='text.secondary'
                      className='uppercase tracking-wider'
                      fontSize='0.65rem'
                    >
                      {item.name.startsWith('↳') ? 'SV NODE' : 'CHECK'}
                    </Typography>
                    <Typography
                      variant='body2'
                      fontWeight={isCenter ? 600 : 500}
                      className='truncate w-full'
                    >
                      {item.name.startsWith('↳') ? item.name.slice(2) : item.name}
                    </Typography>
                  </div>
                  <Typography
                    variant='caption'
                    color={isCenter ? 'primary.main' : 'text.secondary'}
                    className='font-mono whitespace-nowrap'
                    fontWeight={isCenter ? 600 : 500}
                  >
                    {item.value.length > 28 ? item.value.slice(0, 26) + '...' : item.value}
                  </Typography>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
