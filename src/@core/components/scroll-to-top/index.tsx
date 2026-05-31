'use client'

// React Imports
import { useEffect, useState } from 'react'

// MUI Imports
import Zoom from '@mui/material/Zoom'
import { styled } from '@mui/material/styles'

// Type Imports
import type { ChildrenType } from '@core/types'

const ScrollToTopStyled = styled('div')(({ theme }) => ({
  zIndex: theme.zIndex.speedDial,
  position: 'fixed',
  right: theme.spacing(6),
  bottom: theme.spacing(10)
}))

const ScrollToTop = ({ children, className }: ChildrenType & { className?: string }) => {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      if (window.pageYOffset > 400) {
        setShow(true)
      } else {
        setShow(false)
      }
    }

    window.addEventListener('scroll', handleScroll)

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <Zoom in={show}>
      <ScrollToTopStyled className={className} onClick={scrollToTop} role='presentation'>
        {children}
      </ScrollToTopStyled>
    </Zoom>
  )
}

export default ScrollToTop
