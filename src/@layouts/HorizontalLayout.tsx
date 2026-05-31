// React Imports
import type { ReactNode } from 'react'

// Third-party Imports
import classnames from 'classnames'

// Type Imports
import type { ChildrenType } from '@core/types'

// Util Imports
import { horizontalLayoutClasses } from './utils/layoutClasses'

type HorizontalLayoutProps = ChildrenType & {
  header?: ReactNode
  footer?: ReactNode
}

const HorizontalLayout = (props: HorizontalLayoutProps) => {
  const { header, footer, children } = props

  return (
    <div className={classnames(horizontalLayoutClasses.root, 'flex flex-col flex-auto')}>
      {header || null}
      <div className={classnames(horizontalLayoutClasses.contentWrapper, 'flex flex-col flex-auto')}>
        <main className='flex flex-col flex-auto p-6'>{children}</main>
      </div>
      {footer || null}
    </div>
  )
}

export default HorizontalLayout
