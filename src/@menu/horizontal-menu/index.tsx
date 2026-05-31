'use client'

import type { ReactNode } from 'react'
import classnames from 'classnames'

type HorizontalNavProps = {
  children: ReactNode
  className?: string
  customStyles?: Record<string, unknown>
  switchToVertical?: boolean
  verticalNavContent?: (props: { children: ReactNode }) => ReactNode
  verticalNavProps?: Record<string, unknown>
}

const HorizontalNav = ({ children, className }: HorizontalNavProps) => {
  return (
    <div className={classnames('flex items-center', className)}>
      {children}
    </div>
  )
}

export default HorizontalNav

// Re-exports for convenience
export { default as Menu } from '@menu/components/vertical-menu/Menu'
export { default as MenuItem } from '@menu/components/vertical-menu/MenuItem'
export { default as SubMenu } from '@menu/components/vertical-menu/SubMenu'

// Type re-exports
export type { MenuProps, MenuItemProps, SubMenuProps } from '@menu/vertical-menu'
