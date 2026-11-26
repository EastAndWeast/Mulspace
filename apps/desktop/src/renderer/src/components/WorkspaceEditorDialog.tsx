import { useEffect, useState } from 'react'
import type { CreateWorkspaceInput, WebRtcPolicy, Workspace } from '@wb/contracts'
import { Button, Dialog, Input } from '@wb/ui-kit'
import { Check } from 'lucide-react'
import { WorkspaceGlyph, workspaceColors, workspaceGlyphs } from './WorkspaceGlyph.js'

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
  const [seedColor, setSeedColor] = useState('#1F5AE0')
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
      setSeedColor('#147A6B')
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
            <span className="wb-editor-note">至少保留 1 个工作区</span>
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
        工作区名称
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：个人主号 / 测试环境"
          autoFocus
        />
      </label>

      <div className="wb-field-label">
        <span>图标</span>
        <div className="wb-color-swatches">
          {workspaceGlyphs.map((glyph) => (
            <button
              key={glyph.value}
              type="button"
              className="wb-workspace-glyph"
              onClick={() => setIcon(glyph.value)}
              aria-label={glyph.label}
              aria-pressed={icon === glyph.value}
              title={glyph.label}
            >
              <WorkspaceGlyph value={glyph.value} size={16} />
            </button>
          ))}
          {!workspaceGlyphs.some((glyph) => glyph.value === icon) ? (
            <button type="button" className="wb-workspace-glyph" aria-pressed="true" aria-label="当前自定义图标">
              <WorkspaceGlyph value={icon} size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="wb-field-label">
        <span>强调色</span>
        <div className="wb-color-swatches">
          {(workspaceColors.includes(seedColor) ? workspaceColors : [...workspaceColors, seedColor]).map((hex) => {
            const selected = seedColor === hex
            return (
              <button
                key={hex}
                type="button"
                className={`wb-swatch ${selected ? 'wb-swatch--selected' : ''}`}
                style={{ backgroundColor: hex }}
                onClick={() => setSeedColor(hex)}
                aria-pressed={selected}
                aria-label={`选择颜色 ${hex}`}
              >
                {selected ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      </div>

      <label className="wb-field-label">
        自定义 User-Agent（可选）
        <Input
          value={userAgent}
          onChange={(e) => setUserAgent(e.target.value)}
          placeholder="留空则使用默认浏览器标识"
        />
      </label>

      <label className="wb-check-row">
        <input
          type="checkbox"
          checked={webrtcPolicy === 'disable_non_proxied_udp'}
          onChange={(e) =>
            setWebrtcPolicy(e.target.checked ? 'disable_non_proxied_udp' : 'default')
          }
        />
        <span>阻止 WebRTC 泄露真实 IP</span>
      </label>

      {workspace ? (
        <div className="wb-editor-partition">
          <span>存储隔离分区</span>
          <code>{workspace.partition}</code>
        </div>
      ) : null}
    </Dialog>
  )
}
