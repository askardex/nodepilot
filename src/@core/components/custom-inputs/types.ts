import type { ReactNode } from 'react'

export type CustomInputHorizontalProps = {
  title: string
  value: string
  content?: ReactNode
  meta?: ReactNode
  isSelected?: boolean
  asset?: string
  type?: 'radio' | 'checkbox'
}

export type CustomInputVerticalProps = {
  title: string
  value: string
  content?: ReactNode
  asset?: string
  isSelected?: boolean
  type?: 'radio' | 'checkbox'
}

export type CustomInputImgProps = {
  value: string
  img: string
  alt?: string
  isSelected?: boolean
  type?: 'radio' | 'checkbox'
}
