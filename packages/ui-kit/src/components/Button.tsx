import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({ variant = 'filled', className = '', ...rest }: ButtonProps) {
  return <button className={`wb-btn wb-btn--${variant} ${className}`.trim()} {...rest} />
}
