// React Imports
import type { ReactNode } from 'react'

// Type Imports
import type { ChildrenType } from '@core/types'

type FooterProps = ChildrenType & {
  overrideStyles?: Record<string, unknown>
}

const Footer = ({ children }: FooterProps) => {
  return (
    <footer className='flex items-center justify-center p-4'>
      {children}
    </footer>
  )
}

export default Footer
