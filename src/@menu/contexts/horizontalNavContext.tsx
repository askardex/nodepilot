'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

type HorizontalNavContextProps = {
  isBreakpointReached: boolean
}

const HorizontalNavContext = createContext<HorizontalNavContextProps>({
  isBreakpointReached: false
})

export const HorizontalNavProvider = ({ children }: { children: ReactNode }) => {
  return (
    <HorizontalNavContext.Provider value={{ isBreakpointReached: false }}>
      {children}
    </HorizontalNavContext.Provider>
  )
}

export const useHorizontalNavContext = () => useContext(HorizontalNavContext)

export default HorizontalNavContext
