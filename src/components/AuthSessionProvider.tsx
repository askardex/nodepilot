'use client'

import { SessionProvider } from 'next-auth/react'

import type { ChildrenType } from '@core/types'

const AuthSessionProvider = ({ children }: ChildrenType) => {
  return <SessionProvider>{children}</SessionProvider>
}

export default AuthSessionProvider
