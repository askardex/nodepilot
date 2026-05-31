// React Imports
import type { ReactNode } from 'react'

export type Skin = 'default' | 'bordered'

export type Mode = 'light' | 'dark' | 'system'

export type SystemMode = 'light' | 'dark'

export type Direction = 'ltr' | 'rtl'

export type Layout = 'vertical' | 'horizontal'

export type LayoutComponentPosition = 'fixed' | 'static'

export type LayoutComponentWidth = 'compact' | 'wide'

export type ChildrenType = {
  children: ReactNode
}

export type ThemeColor = 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success'
