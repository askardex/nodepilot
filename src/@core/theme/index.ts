// Next Imports
import { Inter } from 'next/font/google'

// MUI Imports
import type { Theme } from '@mui/material/styles'

// Type Imports
import type { SystemMode } from '@core/types'
import type { Settings } from '@core/contexts/settingsContext'

// Theme Options Imports
import overrides from './overrides'
import colorSchemes from './colorSchemes'
import spacing from './spacing'
import shadows from './shadows'
import customShadows from './customShadows'
import typography from './typography'

const inter = Inter({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700', '800', '900'] })

const theme = (settings: Settings | SystemMode, modeOrDirection?: SystemMode | Theme['direction'], direction?: Theme['direction']): Theme => {
  // Support both signatures: (settings, mode, direction) and (mode, direction)
  let _mode: SystemMode
  let _direction: Theme['direction']

  if (typeof settings === 'string') {
    _mode = settings as SystemMode
    _direction = (modeOrDirection as Theme['direction']) || 'ltr'
  } else {
    _mode = (modeOrDirection as SystemMode) || 'light'
    _direction = direction || 'ltr'
  }

  return {
    direction: _direction,
    components: overrides(),
    colorSchemes: colorSchemes(),
    ...spacing,
    shape: {
      borderRadius: 6,
      customBorderRadius: {
        xs: 2,
        sm: 4,
        md: 6,
        lg: 8,
        xl: 10
      }
    },
    shadows: shadows(_mode),
    typography: typography(inter.style.fontFamily),
    customShadows: customShadows(_mode),
    mainColorChannels: {
      light: '46 38 61',
      dark: '231 227 252',
      lightShadow: '46 38 61',
      darkShadow: '19 17 32'
    }
  } as Theme
}

export default theme
