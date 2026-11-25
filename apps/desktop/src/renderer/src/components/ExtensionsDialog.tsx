import { useState } from 'react'
import type { InstalledExtension, Workspace } from '@wb/contracts'
import { Badge, Button, Dialog } from '@wb/ui-kit'
import { formatIpcError } from '../utils/format-error.js'

export interface ExtensionsDialogProps {
  open: boolean
  workspace: Workspace
  extensions: InstalledExtension[]
  onClose: () => void
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
  onClose,
  onInstallFolder,
  onInstallCrx,
  onToggleForWorkspace,
  onOpenPopup,
  onRemove,
}: ExtensionsDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={`Chrome 扩展管理 — ${workspace.icon} ${workspace.name}`}
      onClose={onClose}
      footer={
        <Button variant="filled" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div style={{ fontSize: 12, color: 'var(--wb-sys-color-on-surface-variant)' }}>
        扩展按工作区 Partition 独立加载与存储数据（MV2 / MV3）。在工作区 A 登录的插件账号不会覆盖工作区 B。
      </div>

      {error ? (
        <div
          style={{
            padding: 10,
            borderRadius: 'var(--wb-sys-radius-sm)',
            backgroundColor: 'var(--wb-sys-color-error-container)',
            color: 'var(--wb-sys-color-on-error-container)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="filled" disabled={busy} onClick={() => void run(onInstallFolder)}>
          加载已解压扩展目录
        </Button>
        <Button variant="tonal" disabled={busy} onClick={() => void run(onInstallCrx)}>
          安装 .crx 扩展包
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
