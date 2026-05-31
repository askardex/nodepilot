// MUI Imports
import type { Theme } from '@mui/material/styles'

// Type Imports
import type { SystemMode } from '@core/types'

const customShadows = (mode: SystemMode): Theme['customShadows'] => {
  return {
    xs: `0px 2px 4px rgb(var(--mui-mainColorChannels-${mode}Shadow) / ${mode === 'light' ? 0.16 : 0.2})`,
    sm: `0px 3px 6px rgb(var(--mui-mainColorChannels-${mode}Shadow) / ${mode === 'light' ? 0.18 : 0.22})`,
    md: `0px 4px 10px rgb(var(--mui-mainColorChannels-${mode}Shadow) / ${mode === 'light' ? 0.2 : 0.24})`,
    lg: `0px 6px 16px rgb(var(--mui-mainColorChannels-${mode}Shadow) / ${mode === 'light' ? 0.22 : 0.26})`,
    xl: `0px 8px 28px rgb(var(--mui-mainColorChannels-${mode}Shadow) / ${mode === 'light' ? 0.24 : 0.28})`,
    primary: {
      sm: `0px 2px 6px rgb(var(--mui-palette-primary-mainChannel) / 0.2)`,
      md: `0px 4px 12px rgb(var(--mui-palette-primary-mainChannel) / 0.3)`,
      lg: `0px 6px 18px rgb(var(--mui-palette-primary-mainChannel) / 0.4)`
    },
    secondary: {
      sm: `0px 2px 6px rgb(var(--mui-palette-secondary-mainChannel) / 0.2)`,
      md: `0px 4px 12px rgb(var(--mui-palette-secondary-mainChannel) / 0.3)`,
      lg: `0px 6px 18px rgb(var(--mui-palette-secondary-mainChannel) / 0.4)`
    },
    error: {
      sm: `0px 2px 6px rgb(var(--mui-palette-error-mainChannel) / 0.2)`,
      md: `0px 4px 12px rgb(var(--mui-palette-error-mainChannel) / 0.3)`,
      lg: `0px 6px 18px rgb(var(--mui-palette-error-mainChannel) / 0.4)`
    },
    warning: {
      sm: `0px 2px 6px rgb(var(--mui-palette-warning-mainChannel) / 0.2)`,
      md: `0px 4px 12px rgb(var(--mui-palette-warning-mainChannel) / 0.3)`,
      lg: `0px 6px 18px rgb(var(--mui-palette-warning-mainChannel) / 0.4)`
    },
    info: {
      sm: `0px 2px 6px rgb(var(--mui-palette-info-mainChannel) / 0.2)`,
      md: `0px 4px 12px rgb(var(--mui-palette-info-mainChannel) / 0.3)`,
      lg: `0px 6px 18px rgb(var(--mui-palette-info-mainChannel) / 0.4)`
    },
    success: {
      sm: `0px 2px 6px rgb(var(--mui-palette-success-mainChannel) / 0.2)`,
      md: `0px 4px 12px rgb(var(--mui-palette-success-mainChannel) / 0.3)`,
      lg: `0px 6px 18px rgb(var(--mui-palette-success-mainChannel) / 0.4)`
    }
  }
}

export default customShadows
