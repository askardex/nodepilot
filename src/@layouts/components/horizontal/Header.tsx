// React Imports
import type { ReactNode } from 'react'

// Type Imports
import type { ChildrenType } from '@core/types'

type HeaderProps = ChildrenType & {
  overrideStyles?: Record<string, unknown>
}

const Header = ({ children }: HeaderProps) => {
  return (
    <header className='flex items-center p-4'>
      {children}
    </header>
  )
}

export default Header
