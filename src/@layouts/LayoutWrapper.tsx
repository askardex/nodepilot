'use client'

// React Imports
import type { ReactElement } from 'react'

// Type Imports
import type { SystemMode } from '@core/types'

type Props = {
  systemMode?: SystemMode
  verticalLayout: ReactElement
  horizontalLayout?: ReactElement
}

const LayoutWrapper = ({ verticalLayout }: Props) => {
  // Return the vertical layout (default for NodePilot)
  return <div className='flex flex-col flex-auto'>{verticalLayout}</div>
}

export default LayoutWrapper
