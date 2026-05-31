// Type Imports
import type { ChildrenType } from '@core/types'

const LayoutContent = ({ children }: ChildrenType) => {
  return (
    <main className='flex flex-col flex-auto p-6'>
      {children}
    </main>
  )
}

export default LayoutContent
