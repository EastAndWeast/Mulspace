import { Badge } from './Badge.js'
import { Button } from './Button.js'

export type A2UINode =
  | { type: 'text'; id: string; text: string; tone?: 'title' | 'body' | 'muted' }
  | { type: 'kv-list'; id: string; items: Array<{ label: string; value: string; badge?: string }> }
  | {
      type: 'action-row'
      id: string
      actions: Array<{ id: string; label: string; variant?: 'filled' | 'tonal' | 'outlined' }>
    }

export interface A2UISurfaceSchema {
  surfaceId: string
  title: string
  badge?: string
  nodes: A2UINode[]
}

export interface A2UISurfaceProps {
  schema: A2UISurfaceSchema
  onAction?: (actionId: string) => void
}

/**
 * Declarative Agent-to-UI (Google A2UI) surface renderer.
 * Renders strictly with MD3 theme tokens so Agent cards automatically match any active theme.
 */
export function A2UISurface({ schema, onAction }: A2UISurfaceProps) {
  return (
    <div
      style={{
        borderRadius: 'var(--wb-sys-radius-md)',
        border: '1px solid var(--wb-sys-color-outline-variant)',
        backgroundColor: 'var(--wb-sys-color-surface-container)',
        padding: 'var(--wb-sys-spacing-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-sys-spacing-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--wb-sys-color-on-surface)' }}>
          {schema.title}
        </span>
        {schema.badge ? <Badge tone="primary">{schema.badge}</Badge> : null}
      </div>

      {schema.nodes.map((node) => {
        if (node.type === 'text') {
          const color =
            node.tone === 'muted'
              ? 'var(--wb-sys-color-on-surface-variant)'
              : 'var(--wb-sys-color-on-surface)'
          return (
            <div
              key={node.id}
              style={{
                fontSize: node.tone === 'title' ? 13 : 12,
                fontWeight: node.tone === 'title' ? 600 : 400,
                lineHeight: 1.5,
                color,
              }}
            >
              {node.text}
            </div>
          )
        }

        if (node.type === 'kv-list') {
          return (
            <div
              key={node.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 'var(--wb-sys-spacing-sm)',
                borderRadius: 'var(--wb-sys-radius-sm)',
                backgroundColor: 'var(--wb-sys-color-surface-container-low)',
              }}
            >
              {node.items.map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: 'var(--wb-sys-color-on-surface-variant)' }}>{item.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--wb-sys-color-on-surface)', fontWeight: 500 }}>
                      {item.value}
                    </span>
                    {item.badge ? <Badge>{item.badge}</Badge> : null}
                  </div>
                </div>
              ))}
            </div>
          )
        }

        return (
          <div key={node.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
            {node.actions.map((action) => (
              <Button
                key={action.id}
                variant={action.variant ?? 'tonal'}
                onClick={() => onAction?.(action.id)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
