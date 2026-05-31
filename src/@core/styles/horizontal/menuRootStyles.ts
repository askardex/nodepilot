import type { Theme } from '@mui/material/styles'

const menuRootStyles = (theme: Theme) => {
  return {
    '& > ul': {
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1)
    }
  }
}

export default menuRootStyles
