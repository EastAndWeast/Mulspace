import { useEffect, useState } from 'react'
import type { CreateWorkspaceInput, WebRtcPolicy, Workspace } from '@wb/contracts'
import { Button, Dialog, Input } from '@wb/ui-kit'

const EMOJI_PRESETS = ['🧭', '🔐', '🛒', '🐦', '💼', '🧪', '🤖', '🌐', '🎬', '📊']
const COLOR_PRESETS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#EF4444', '#06B6D4']

export interface WorkspaceEditorDialogProps {
  open: boolean
  workspace: Workspace | null
  canDelete: boolean
  onClose: () => void
  onCreate: (input: CreateWorkspaceInput) => Promise<void>
  onUpdate: (workspaceId: string, input: CreateWorkspaceInput) => Promise<void>
  onDelete: (workspaceId: string) => Promise<void>
}

export function WorkspaceEditorDialog({
  open,
  workspace,
  canDelete,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: WorkspaceEditorDialogProps) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🌐')
  const [seedColor, setSeedColor] = useState('#3B82F6')
  const [userAgent, setUserAgent] = useState('')
  const [webrtcPolicy, setWebrtcPolicy] = useState<WebRtcPolicy>('disable_non_proxied_udp')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    if (workspace) {
      setName(workspace.name)
      setIcon(workspace.icon)
      setSeedColor(workspace.seedColor)
      setUserAgent(workspace.isolation.userAgent ?? '')
      setWebrtcPolicy(workspace.isolation.webrtcPolicy)
    } else {
      setName('')
      setIcon('🔐')
      setSeedColor('#8B5CF6')
      setUserAgent('')
      setWebrtcPolicy('disable_non_proxied_udp')
    }
  }, [open, workspace])

  const handleSave = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const payload: CreateWorkspaceInput = {
        name: name.trim(),
        icon,
        seedColor,
        isolation: {
          userAgent: userAgent.trim() || undefined,
          webrtcPolicy,
        },
      }
      if (workspace) {
        await onUpdate(workspace.id, payload)
      } else {
        await onCreate(payload)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={workspace ? `编辑工作区：${workspace.name}` : '新建独立账号工作区'}
      onClose={onClose}
      footer={
        <>
          {workspace && canDelete ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onDelete(workspace.id)
                  onClose()
                } finally {
                  setBusy(false)
                }
              }}
            >
              删除工作区
            </Button>
          ) : workspace ? (
            <span
              style={{ fontSize: 11, color: 'var(--wb-sys-color-on-surface-variant)', marginRight: 'auto' }}
            >
              至少需保留 1 个工作区
            </span>
          ) : null}
          <Button variant="text" onClick={onClose}>
            取消
          </Button>
          <Button variant="filled" disabled={!name.trim() || busy} onClick={handleSave}>
            {workspace ? '保存更改' : '创建工作区'}
          </Button>
        </>
      }
    >
      <label className="wb-field-label">
        工作区名称（例如：小红书-主号 / GitHub-工作）
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入工作区名称..."
          autoFocus
        />
      </label>

      <div className="wb-field-label">
        <span>图标标识</span>
        <div className="wb-color-swatches">
          {EMOJI_PRESETS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setIcon(emoji)}
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--wb-sys-radius-sm)',
                border:
                  icon === emoji
                    ? '2px solid var(--wb-sys-color-primary)'
                    : '1px solid var(--wb-sys-color-outline-variant)',
                backgroundColor:
                  icon === emoji
                    ? 'var(--wb-sys-color-primary-container)'
                    : 'var(--wb-sys-color-surface-container)',
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div className="wb-field-label">
        <span>Material 3 动态主题强调色（防串号视觉锚点）</span>
        <div className="wb-color-swatches">
          {COLOR_PRESETS.map((hex) => (
            <button
              key={hex}
              type="button"
              className={`wb-swatch ${seedColor === hex ? 'wb-swatch--selected' : ''}`}
              style={{ backgroundColor: hex }}
              onClick={() => setSeedColor(hex)}
              aria-label={`选择颜色 ${hex}`}
            />
          ))}
        </div>
      </div>

      <label className="wb-field-label">
        自定义 User-Agent（可选，留空使用默认 Chromium UA）
        <Input
          value={userAgent}
          onChange={(e) => setUserAgent(e.target.value)}
          placeholder="Mozilla/5.0 ..."
        />
      </label>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--wb-sys-color-on-surface)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={webrtcPolicy === 'disable_non_proxied_udp'}
          onChange={(e) =>
            setWebrtcPolicy(e.target.checked ? 'disable_non_proxied_udp' : 'default')
          }
        />
        <span>启用 WebRTC 防真实 IP 泄漏（推荐，Phase 2 配合代理节点生效）</span>
      </label>

      {workspace ? (
        <div style={{ fontSize: 11, color: 'var(--wb-sys-color-on-surface-variant)' }}>
          存储隔离分区：<code style={{ fontFamily: 'var(--wb-sys-font-mono)' }}>{workspace.partition}</code>
        </div>
      ) : null}
    </Dialog>
  )
}
