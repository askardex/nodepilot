'use client'

// Third-party Imports
import classnames from 'classnames'

// Type Imports
import type { ChildrenType, SystemMode } from '@core/types'

// Util Imports
import { blankLayoutClasses } from './utils/layoutClasses'

type BlankLayoutProps = ChildrenType & {
  systemMode?: SystemMode
}

const BlankLayout = ({ children }: BlankLayoutProps) => {
  return <div className={classnames(blankLayoutClasses.root, 'is-full bs-full')}>{children}</div>
}

export default BlankLayout
