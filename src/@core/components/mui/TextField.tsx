'use client'

import MuiTextField from '@mui/material/TextField'
import type { TextFieldProps } from '@mui/material/TextField'

const CustomTextField = (props: TextFieldProps) => {
  return <MuiTextField size='small' {...props} />
}

export default CustomTextField
