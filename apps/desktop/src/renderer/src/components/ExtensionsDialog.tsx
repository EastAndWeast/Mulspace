import { useEffect, useState } from 'react'
import type { InstalledExtension, Workspace } from '@wb/contracts'
import { Badge, Button, Dialog, Input } from '@wb/ui-kit'
import { ExternalLink, Store } from 'lucide-react'
import { formatIpcError } from '../utils/format-error.js'

export interface ExtensionsDialogProps {
  open: boolean
  workspace: Workspace
  extensions: InstalledExtension[]
  activeTabUrl?: string
  onClose: () => void
  onOpenChromeWebStore: () => void
  onInstallFromStore: (urlOrId: string) => Promise<void>
  onInstallFolder: () => Promise<void>
  onInstallCrx: () => Promise<void>
  onToggleForWorkspace: (extensionId: string, workspaceId: string, enabled: boolean) => Promise<void>
  onOpenPopup: (workspaceId: string, extensionId: string) => Promise<void>
  onRemove: (extensionId: string) => Promise<void>
}

function isEnabled(ext: InstalledExtension, workspaceId: string): boolean {
  if (ext.disabledWorkspaces.includes(workspaceId)) return false
  if (ext.enabledWorkspaces.includes(workspaceId)) return true
  return ext.enabledGlobally
}

export function ExtensionsDialog({
  open,
  workspace,
  extensions,
  activeTabUrl,
  onClose,
  onOpenChromeWebStore,
  onInstallFromStore,
  onInstallFolder,
  onInstallCrx,
  onToggleForWorkspace,
  onOpenPopup,
  onRemove,
}: ExtensionsDialogProps) {
  const [storeInput, setStoreInput] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setNotice(null)
    if (activeTabUrl && /chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(activeTabUrl)) {
      setStoreInput(activeTabUrl)
    } else {
      setStoreInput('')
    }
  }, [open, activeTabUrl])

  const run = async (fn: () => Promise<void>, successMessage?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      if (successMessage) setNotice(successMessage)
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={`Chrome 扩展管理 — ${workspace.name}`}
      onClose={onClose}
      footer={
        <Button variant="filled" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div style={{ fontSize: 12, color: 'var(--wb-sys-color-on-surface-variant)' }}>
        兼容 Chrome MV2 / MV3 扩展，按工作区 Partition 独立加载与隔离存储。可直接跳转 Chrome 应用商店选好插件后复制链接或扩展 ID 一键安装。
      </div>

      {notice ? <div className="wb-multab-notice">{notice}</div> : null}
      {error ? <div className="wb-multab-error">{error}</div> : null}

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Store size={14} />
              <span>Chrome 应用商店在线兼容安装</span>
            </div>
            <div className="wb-dialog-card__sub">
              打开商店挑好插件，或粘贴商店详情页链接 / 32 位扩展 ID 直接下载安装
            </div>
          </div>
          <Button
            variant="tonal"
            onClick={() => {
              onOpenChromeWebStore()
              onClose()
            }}
          >
            <ExternalLink size={13} />
            前往 Chrome 应用商店
          </Button>
        </div>

        <div className="wb-multab-cat-select-row">
          <Input
            value={storeInput}
            onChange={(e) => setStoreInput(e.target.value)}
            placeholder="粘贴 https://chromewebstore.google.com/detail/... 或 32 位扩展 ID"
            spellCheck={false}
          />
          <Button
            variant="filled"
            disabled={busy || !storeInput.trim()}
            onClick={() =>
              void run(async () => {
                await onInstallFromStore(storeInput.trim())
                setStoreInput('')
              }, 'Chrome 扩展已安装并启用')
            }
          >
            在线安装
          </Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="outlined" disabled={busy} onClick={() => void run(onInstallFolder, '已从扩展目录安装')}>
          加载已解压扩展目录
        </Button>
        <Button variant="outlined" disabled={busy} onClick={() => void run(onInstallCrx, '已安装 .crx 扩展包')}>
          安装本地 .crx 包
        </Button>
      </div>

      {extensions.length === 0 ? (
        <div
          style={{
            padding: 16,
            borderRadius: 'var(--wb-sys-radius-md)',
            backgroundColor: 'var(--wb-sys-color-surface-container)',
            fontSize: 12,
            color: 'var(--wb-sys-color-on-surface-variant)',
            textAlign: 'center',
          }}
        >
          暂未安装任何 Chrome 扩展，可点击上方按钮选择本地扩展文件夹或 `.crx` 文件安装。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {extensions.map((ext) => {
            const enabled = isEnabled(ext, workspace.id)
            return (
              <div
                key={ext.id}
                style={{
                  padding: 10,
                  borderRadius: 'var(--wb-sys-radius-md)',
                  backgroundColor: 'var(--wb-sys-color-surface-container)',
                  border: '1px solid var(--wb-sys-color-outline-variant)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong style={{ fontSize: 13 }}>{ext.name}</strong>
                    <Badge>v{ext.version}</Badge>
                    <Badge tone="primary">MV{ext.manifestVersion}</Badge>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {enabled && ext.popupPath ? (
                      <Button
                        variant="outlined"
                        disabled={busy}
                        onClick={() => void run(() => onOpenPopup(workspace.id, ext.id))}
                      >
                        打开弹窗
                      </Button>
                    ) : null}
                    <Button
                      variant={enabled ? 'tonal' : 'outlined'}
                      disabled={busy}
                      onClick={() =>
                        void run(() => onToggleForWorkspace(ext.id, workspace.id, !enabled))
                      }
                    >
                      {enabled ? '当前工作区已启用' : '在当前工作区启用'}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void run(() => onRemove(ext.id))}
                    >
                      卸载
                    </Button>
                  </div>
                </div>
                {ext.description ? (
                  <div style={{ fontSize: 11, color: 'var(--wb-sys-color-on-surface-variant)' }}>
                    {ext.description}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}
