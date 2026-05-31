// Type Imports
import type { ChildrenType } from '@core/types'

const Navbar = ({ children }: ChildrenType) => {
  return (
    <nav className='flex items-center p-4'>
      {children}
    </nav>
  )
}

export default Navbar
