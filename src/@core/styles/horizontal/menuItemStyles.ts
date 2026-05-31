import type { Theme } from '@mui/material/styles'

const menuItemStyles = (theme: Theme, _iconClass?: string) => {
  return {
    root: {
      marginBlockStart: theme.spacing(1.5),
      color: 'var(--mui-palette-text-primary)'
    },
    button: {
      paddingInline: theme.spacing(4),
      borderRadius: 'var(--border-radius)',
      transition: 'padding-inline-start 0.25s ease-in-out',
      '&:hover': {
        backgroundColor: 'var(--mui-palette-action-hover)'
      }
    },
    icon: {
      marginInlineEnd: theme.spacing(2),
      '& > i, & > svg': {
        fontSize: '1.375rem'
      }
    },
    active: {
      '& .menu-item-button': {
        backgroundColor: 'var(--mui-palette-primary-main)',
        color: 'var(--mui-palette-primary-contrastText)',
        boxShadow: 'var(--mui-customShadows-primary-sm)'
      }
    }
  }
}

export default menuItemStyles
