// MUI Imports
import { lighten } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

// Type Imports
import type { MenuItemStyles } from '@menu/types'

// Util Imports
import { menuClasses } from '@menu/utils/menuClasses'

const menuItemStyles = (verticalNavOptionsOrTheme: any, theme?: Theme): MenuItemStyles => {
  // Support both signatures: (theme) and (verticalNavOptions, theme)
  const _theme: Theme = theme || verticalNavOptionsOrTheme
  return {
    root: {
      marginBlockStart: _theme.spacing(1.5),
      [`&.${menuClasses.subMenuRoot}.${menuClasses.open} > .${menuClasses.button}, &.${menuClasses.subMenuRoot} > .${menuClasses.button}.${menuClasses.active}`]:
        {
          backgroundColor: 'var(--mui-palette-action-selected) !important'
        },
      [`&.${menuClasses.disabled} > .${menuClasses.button}`]: {
        color: 'var(--mui-palette-text-disabled)',
        [`& .${menuClasses.icon}`]: {
          color: 'inherit'
        }
      },
      [`&:not(.${menuClasses.subMenuRoot}) > .${menuClasses.button}.${menuClasses.active}`]: {
        color: 'var(--mui-palette-primary-contrastText)',
        background:
          _theme.direction === 'ltr'
            ? `linear-gradient(270deg, var(--mui-palette-primary-main), ${lighten(
                _theme.palette.primary.main,
                0.5
              )} 100%)`
            : `linear-gradient(270deg, ${lighten(
                _theme.palette.primary.main,
                0.5
              )}, var(--mui-palette-primary-main) 100%)`,
        [`& .${menuClasses.icon}`]: {
          color: 'inherit'
        }
      }
    },
    button: ({ active }) => ({
      paddingBlock: _theme.spacing(2),
      '&:has(.MuiChip-root)': {
        paddingBlock: _theme.spacing(1.75)
      },
      paddingInlineStart: _theme.spacing(5.5),
      paddingInlineEnd: _theme.spacing(3.5),
      borderStartEndRadius: 50,
      borderEndEndRadius: 50,
      ...(!active && {
        '&:hover, &:focus-visible': {
          backgroundColor: 'var(--mui-palette-action-hover)'
        },
        '&[aria-expanded="true"]': {
          backgroundColor: 'var(--mui-palette-action-selected)'
        }
      })
    }),
    icon: ({ level }) => ({
      ...(level === 0 && {
        fontSize: '1.375rem',
        marginInlineEnd: _theme.spacing(2)
      }),
      ...(level > 0 && {
        fontSize: '0.75rem',
        color: 'var(--mui-palette-text-secondary)',
        marginInlineEnd: _theme.spacing(3.5)
      }),
      ...(level === 1 && {
        marginInlineStart: _theme.spacing(1.5)
      }),
      ...(level > 1 && {
        marginInlineStart: _theme.spacing(1.5 + 2.5 * (level - 1))
      }),
      '& > i, & > svg': {
        fontSize: 'inherit'
      }
    }),
    prefix: {
      marginInlineEnd: _theme.spacing(2)
    },
    suffix: {
      marginInlineStart: _theme.spacing(2)
    },
    subMenuExpandIcon: {
      fontSize: '1.375rem',
      marginInlineStart: _theme.spacing(2),
      '& i, & svg': {
        fontSize: 'inherit'
      }
    },
    subMenuContent: {
      backgroundColor: 'transparent'
    }
  }
}

export default menuItemStyles
