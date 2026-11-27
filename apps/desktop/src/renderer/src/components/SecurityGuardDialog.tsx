import { useEffect, useState } from 'react'
import type { WebRtcPolicy, Workspace, WorkspaceIsolationConfig } from '@wb/contracts'
import { Badge, Button, Dialog, Input } from '@wb/ui-kit'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { formatIpcError } from '../utils/format-error.js'

const UA_PRESETS: Array<{ label: string; value: string }> = [
  { label: '恢复默认', value: '' },
  {
    label: 'Chrome Win',
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  },
  {
    label: 'Chrome Mac',
    value:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  },
  {
    label: 'Edge Win',
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
  },
]

export interface SecurityGuardDialogProps {
  open: boolean
  workspaces: Workspace[]
  activeWorkspace: Workspace
  onClose: () => void
  onUpdateIsolation: (workspaceId: string, isolation: Partial<WorkspaceIsolationConfig>) => Promise<void>
  onClearWorkspaceData: (workspaceId: string) => Promise<void>
}

export function SecurityGuardDialog({
  open,
  workspaces,
  activeWorkspace,
  onClose,
  onUpdateIsolation,
  onClearWorkspaceData,
}: SecurityGuardDialogProps) {
  const [selectedWsId, setSelectedWsId] = useState(activeWorkspace.id)
  const [userAgent, setUserAgent] = useState('')
  const [acceptLanguage, setAcceptLanguage] = useState('')
  const [webrtcPolicy, setWebrtcPolicy] = useState<WebRtcPolicy>('disable_non_proxied_udp')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedWsId(activeWorkspace.id)
    setNotice(null)
    setError(null)
  }, [open, activeWorkspace.id])

  const selectedWs = workspaces.find((w) => w.id === selectedWsId) ?? activeWorkspace

  useEffect(() => {
    if (!open) return
    setUserAgent(selectedWs.isolation.userAgent ?? '')
    setAcceptLanguage(selectedWs.isolation.acceptLanguage ?? '')
    setWebrtcPolicy(selectedWs.isolation.webrtcPolicy)
  }, [open, selectedWs])

  const handleSave = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await onUpdateIsolation(selectedWs.id, {
        userAgent: userAgent.trim() || undefined,
        acceptLanguage: acceptLanguage.trim() || undefined,
        webrtcPolicy,
      })
      setNotice(`已保存「${selectedWs.name}」的安全防控策略`)
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleClearData = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await onClearWorkspaceData(selectedWs.id)
      setNotice(`已清空「${selectedWs.name}」的独立缓存与 Cookie`)
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title="安全防控中心"
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            关闭
          </Button>
          <Button variant="filled" disabled={busy} onClick={() => void handleSave()}>
            保存防控策略
          </Button>
        </>
      }
    >
      <div className="wb-field-label">
        <span>选择要配置的工作区</span>
        <div className="wb-color-swatches">
          {workspaces.map((ws) => (
            <Button
              key={ws.id}
              variant={ws.id === selectedWs.id ? 'filled' : 'outlined'}
              onClick={() => {
                setSelectedWsId(ws.id)
                setNotice(null)
                setError(null)
              }}
            >
              {ws.name}
            </Button>
          ))}
        </div>
      </div>

      {notice ? <div className="wb-multab-notice">{notice}</div> : null}
      {error ? <div className="wb-multab-error">{error}</div> : null}

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={15} />
              <span>账号隔离状态 · {selectedWs.name}</span>
            </div>
            <div className="wb-dialog-card__sub">
              Cookie、LocalStorage、IndexedDB 与缓存均与其它空间完全隔离
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={webrtcPolicy === 'disable_non_proxied_udp' ? 'primary' : 'neutral'}>
              {webrtcPolicy === 'disable_non_proxied_udp' ? 'WebRTC 已防泄露' : 'WebRTC 默认'}
            </Badge>
            <Badge>{userAgent.trim() ? '自定义 UA' : '默认 UA'}</Badge>
          </div>
        </div>

        <div className="wb-editor-partition">
          <span>存储隔离分区</span>
          <code>{selectedWs.partition}</code>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="danger" disabled={busy} onClick={() => void handleClearData()}>
            <Trash2 size={13} />
            清除该空间缓存与 Cookie
          </Button>
        </div>
      </div>

      <label className="wb-check-row">
        <input
          type="checkbox"
          checked={webrtcPolicy === 'disable_non_proxied_udp'}
          onChange={(e) =>
            setWebrtcPolicy(e.target.checked ? 'disable_non_proxied_udp' : 'default')
          }
        />
        <span>阻止 WebRTC 泄露真实 IP（disable_non_proxied_udp）</span>
      </label>

      <label className="wb-field-label">
        自定义 User-Agent（可选，留空使用默认浏览器标识）
        <Input
          value={userAgent}
          onChange={(e) => setUserAgent(e.target.value)}
          placeholder="Mozilla/5.0 ..."
          spellCheck={false}
        />
        <div className="wb-color-swatches">
          {UA_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="tonal"
              onClick={() => setUserAgent(preset.value)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </label>

      <label className="wb-field-label">
        自定义请求语言 Accept-Language（可选）
        <Input
          value={acceptLanguage}
          onChange={(e) => setAcceptLanguage(e.target.value)}
          placeholder="例如：zh-CN,zh;q=0.9,en;q=0.8 或 en-US,en;q=0.9"
          spellCheck={false}
        />
      </label>
    </Dialog>
  )
}
