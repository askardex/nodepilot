import { styled } from '@mui/material/styles'

type StyledHorizontalNavExpandIconProps = {
  open?: boolean
  level?: number
  transitionDuration?: number
}

const StyledHorizontalNavExpandIcon = styled('span')<StyledHorizontalNavExpandIconProps>(({ open, transitionDuration }) => ({
  display: 'inline-flex',
  transition: `transform ${transitionDuration || 300}ms ease-in-out`,
  transform: open ? 'rotate(90deg)' : 'rotate(0deg)'
}))

export default StyledHorizontalNavExpandIcon
