'use client'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import classnames from 'classnames'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'

// Util Imports
import { verticalLayoutClasses } from '@layouts/utils/layoutClasses'

const FooterContent = () => {
  // Hooks
  const { isBreakpointReached } = useVerticalNav()

  return (
    <div
      className={classnames(verticalLayoutClasses.footerContent, 'flex items-center justify-between flex-wrap gap-4')}
    >
      <p>
        <span className='text-textSecondary'>{`© ${new Date().getFullYear()} `}</span>
        <Link href='https://askardex.com' target='_blank' className='text-primary'>
          AskarDex
        </Link>
        <span className='text-textSecondary'>. All rights reserved.</span>
      </p>
      {!isBreakpointReached && (
        <div className='flex items-center gap-4'>
          <Link href='https://askardex.com' target='_blank' className='text-primary'>
            Website
          </Link>
          <Link href='https://x.com/askardex_com' target='_blank' className='text-primary'>
            Twitter
          </Link>
        </div>
      )}
    </div>
  )
}

export default FooterContent
