import type { ButtonHTMLAttributes } from 'react'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function IconButton({ active, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      className={`wb-icon-btn ${className}`.trim()}
      aria-pressed={active}
      {...rest}
    />
  )
}
