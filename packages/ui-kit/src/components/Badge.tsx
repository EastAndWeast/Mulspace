import type { HTMLAttributes } from 'react'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'primary'
}

export function Badge({ tone = 'neutral', className = '', ...rest }: BadgeProps) {
  const toneClass = tone === 'primary' ? 'wb-badge--primary' : ''
  return <span className={`wb-badge ${toneClass} ${className}`.trim()} {...rest} />
}
