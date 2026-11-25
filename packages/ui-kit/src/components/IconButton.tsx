import type { ButtonHTMLAttributes } from 'react'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function IconButton({ active = false, className = '', style, ...rest }: IconButtonProps) {
  return (
    <button
      className={`wb-icon-btn ${className}`.trim()}
      style={{
        backgroundColor: active ? 'var(--wb-sys-color-primary-container)' : undefined,
        color: active ? 'var(--wb-sys-color-on-primary-container)' : undefined,
        ...style,
      }}
      {...rest}
    />
  )
}
