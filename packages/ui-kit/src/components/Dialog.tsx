import { useEffect, type ReactNode } from 'react'
import { IconButton } from './IconButton.js'

export interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  footer?: ReactNode
  backdropClassName?: string
  children: ReactNode
}

export function Dialog({ open, title, onClose, footer, backdropClassName, children }: DialogProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={backdropClassName ? `wb-dialog-backdrop ${backdropClassName}` : 'wb-dialog-backdrop'}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wb-dialog">
        <div className="wb-dialog__header">
          <span>{title}</span>
          <IconButton aria-label="关闭" onClick={onClose}>
            ✕
          </IconButton>
        </div>
        <div className="wb-dialog__body">{children}</div>
        {footer ? <div className="wb-dialog__footer">{footer}</div> : null}
      </div>
    </div>
  )
}
