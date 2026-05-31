'use client'

// Next Imports
import Link from 'next/link'

// MUI Imports
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

// Type Imports
import type { SystemMode } from '@core/types'

const NotFound = ({ mode }: { mode: SystemMode }) => {
  const isDark = mode === 'dark'

  return (
    <div className='flex items-center justify-center min-bs-[100dvh] relative p-6 overflow-x-hidden'>
      <div
        aria-hidden='true'
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: -1,
          background: isDark
            ? 'radial-gradient(circle at 20% 20%, rgba(79, 70, 229, 0.22), transparent 45%), radial-gradient(circle at 80% 80%, rgba(16, 185, 129, 0.2), transparent 42%)'
            : 'radial-gradient(circle at 20% 20%, rgba(79, 70, 229, 0.14), transparent 45%), radial-gradient(circle at 80% 80%, rgba(16, 185, 129, 0.14), transparent 42%)'
        }}
      />
      <div className='flex items-center flex-col text-center'>
        <div className='flex flex-col gap-2 is-[90vw] sm:is-[unset] mbe-6'>
          <Typography className='font-medium text-8xl' color='text.primary'>
            404
          </Typography>
          <Typography variant='h4'>Page Not Found ⚠️</Typography>
          <Typography>we couldn&#39;t find the page you are looking for.</Typography>
        </div>
        <Button href='/' component={Link} variant='contained'>
          Back To Home
        </Button>
        <div
          className='mt-10 md:mt-14 lg:mt-20 rounded-full flex items-center justify-center'
          style={{
            width: 220,
            height: 220,
            background: isDark
              ? 'linear-gradient(135deg, rgba(79,70,229,0.25), rgba(16,185,129,0.2))'
              : 'linear-gradient(135deg, rgba(79,70,229,0.12), rgba(16,185,129,0.1))',
            border: isDark ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(15,23,42,0.12)'
          }}
        >
          <Typography variant='h2' sx={{ fontWeight: 700, letterSpacing: 1 }}>
            404
          </Typography>
        </div>
      </div>
    </div>
  )
}

export default NotFound
