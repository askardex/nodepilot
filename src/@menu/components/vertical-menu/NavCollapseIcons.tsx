'use client'

// React Imports
import type { ReactNode } from 'react'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'

type NavCollapseIconsProps = {
  lockedIcon?: ReactNode
  unlockedIcon?: ReactNode
  closeIcon?: ReactNode
  className?: string
  onClick?: () => void
}

const NavCollapseIcons = (props: NavCollapseIconsProps) => {
  const { lockedIcon, unlockedIcon, closeIcon, className } = props
  const { isCollapsed, isHovered, collapseVerticalNav, isBreakpointReached, toggleVerticalNav } = useVerticalNav()

  const handleClick = () => {
    if (isBreakpointReached) {
      toggleVerticalNav(false)
    } else {
      collapseVerticalNav(!isCollapsed)
    }
  }

  const getIcon = () => {
    if (isBreakpointReached) {
      return closeIcon || <i className='ri-close-line' />
    }

    if (isCollapsed) {
      return unlockedIcon || <i className='ri-circle-line text-xs' />
    }

    return lockedIcon || <i className='ri-radiobutton-line text-xs' />
  }

  return (
    <span className={className} onClick={handleClick} style={{ cursor: 'pointer', display: 'inline-flex' }}>
      {getIcon()}
    </span>
  )
}

export default NavCollapseIcons
