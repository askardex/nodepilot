'use client'

import type { ReactNode } from 'react'

import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

export type AccentColor = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
export type ChipStatusColor = 'success' | 'warning' | 'error' | 'info' | 'default'

export type ActionCardProps = {
  icon: string                        // tabler icon name, e.g. 'tabler-cpu'
  title: string
  caption: ReactNode
  chipLabel?: string
  chipColor?: ChipStatusColor
  accentColor?: AccentColor           // default 'primary'
  canClick?: boolean                  // default true
  blockedReason?: string | null
  iconAnimation?: 'spin' | 'pulse'
  trailingIcon?: string               // overrides chevron-right when canClick
  onClick?: () => void
  customAccentBar?: string            // override accent bar gradient
  showBackgroundPattern?: boolean     // optional decorative radial pattern (System Check)
  extra?: ReactNode                   // extra row beneath caption (counters, etc.)
  /** When true, treat the card as visually "active/busy" (full opacity) even if not canClick */
  forceActive?: boolean
}

/**
 * Reusable action card used on the validator detail page.
 * Encapsulates the gradient accent bar, gradient icon container, chip,
 * caption, and lock/chevron trailing icon shared across all stage cards.
 */
export function ActionCard({
  icon,
  title,
  caption,
  chipLabel,
  chipColor = 'default',
  accentColor = 'primary',
  canClick = true,
  blockedReason,
  iconAnimation,
  trailingIcon,
  onClick,
  customAccentBar,
  showBackgroundPattern = false,
  extra,
  forceActive = false
}: ActionCardProps) {
  const active = canClick || forceActive
  const effectiveAccent: AccentColor = canClick ? accentColor : 'default'

  const accentBar = customAccentBar
    ?? (active
      ? `linear-gradient(90deg, var(--mui-palette-${effectiveAccent}-main), transparent)`
      : 'linear-gradient(90deg, var(--mui-palette-divider), transparent)')

  const iconBg = active
    ? `linear-gradient(135deg, rgb(var(--mui-palette-${effectiveAccent}-mainChannel) / 0.15), rgb(var(--mui-palette-${effectiveAccent}-mainChannel) / 0.05))`
    : 'rgb(var(--mui-palette-action-disabledChannel) / 0.08)'

  const iconBorder = active
    ? `1px solid rgb(var(--mui-palette-${effectiveAccent}-mainChannel) / 0.2)`
    : '1px solid var(--mui-palette-divider)'

  const iconColor = active
    ? `var(--mui-palette-${effectiveAccent}-main)`
    : 'var(--mui-palette-text-disabled)'

  const card = (
    <Card
      className={`group relative overflow-hidden transition-all duration-300 ${canClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg' : 'cursor-not-allowed'}`}
      onClick={canClick ? onClick : undefined}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        blockSize: '100%',
        minBlockSize: 104,
        opacity: active ? 1 : 0.55,
        '&:hover': canClick ? { borderColor: effectiveAccent === 'default' ? 'divider' : `${effectiveAccent}.main` } : {}
      }}
    >
      {/* Accent bar */}
      <div
        className='absolute top-0 left-0 right-0'
        style={{ blockSize: 3, background: accentBar }}
      />

      {showBackgroundPattern && (
        <div
          className='absolute pointer-events-none opacity-[0.04]'
          style={{
            insetBlockStart: -30,
            insetInlineEnd: -30,
            inlineSize: 140,
            blockSize: 140,
            background: 'radial-gradient(circle, var(--mui-palette-primary-main) 0%, transparent 70%)'
          }}
        />
      )}

      <CardContent className='relative flex items-center gap-4 py-5'>
        {/* Icon container */}
        <div
          className='flex items-center justify-center rounded-xl shrink-0 transition-transform duration-300 group-hover:scale-110'
          style={{
            inlineSize: 48,
            blockSize: 48,
            background: iconBg,
            border: iconBorder
          }}
        >
          <i
            className={`${canClick ? icon : 'tabler-lock'} text-2xl ${iconAnimation === 'spin' ? 'animate-spin' : iconAnimation === 'pulse' ? 'animate-pulse' : ''}`}
            style={{ color: iconColor }}
          />
        </div>

        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2'>
            <Typography variant='subtitle1' fontWeight={600}>{title}</Typography>
            {chipLabel && (
              <Chip
                size='small'
                label={chipLabel}
                color={chipColor}
                sx={{ blockSize: 18, fontSize: '0.65rem', '& .MuiChip-label': { paddingInline: 0.75 } }}
              />
            )}
          </div>
          <Typography variant='caption' color='text.secondary' className='block truncate'>
            {caption}
          </Typography>
          {extra}
        </div>

        <i
          className={`${canClick ? (trailingIcon ?? 'tabler-chevron-right') : 'tabler-lock'} text-textSecondary text-lg transition-transform duration-300 ${canClick ? 'group-hover:translate-x-1' : ''}`}
        />
      </CardContent>
    </Card>
  )

  if (blockedReason !== undefined) {
    return (
      <Tooltip title={blockedReason ?? ''} placement='top' arrow disableHoverListener={canClick}>
        {card}
      </Tooltip>
    )
  }

  return card
}
