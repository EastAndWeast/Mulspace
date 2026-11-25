import { useEffect, useState } from 'react'
import type {
  ProxyEngineStatus,
  ProxyNode,
  ProxySubscription,
  Workspace,
  WorkspaceProxyBinding,
  WorkspaceProxyMode,
} from '@wb/contracts'
import { Badge, Button, Dialog, Input } from '@wb/ui-kit'
import { formatIpcError } from '../utils/format-error.js'

export interface ProxyManagerDialogProps {
  open: boolean
  workspace: Workspace
  proxyStatus: ProxyEngineStatus
  subscriptions: ProxySubscription[]
  nodes: ProxyNode[]
  defaultBinaryPath?: string
  onClose: () => void
  onImport: (input: { name: string; url?: string; content?: string }) => Promise<void>
  onDeleteSubscription: (subscriptionId: string) => Promise<void>
  onTestLatency: (nodeId: string) => Promise<void>
  onSetWorkspaceProxy: (workspaceId: string, binding: WorkspaceProxyBinding) => Promise<void>
  onSetBinaryPath: (binaryPath: string) => Promise<void>
}

export function ProxyManagerDialog({
  open,
  workspace,
  proxyStatus,
  subscriptions,
  nodes,
  defaultBinaryPath,
  onClose,
  onImport,
  onDeleteSubscription,
  onTestLatency,
  onSetWorkspaceProxy,
  onSetBinaryPath,
}: ProxyManagerDialogProps) {
  const [subName, setSubName] = useState('')
  const [subUrl, setSubUrl] = useState('')
  const [subContent, setSubContent] = useState('')
  const [customUrl, setCustomUrl] = useState(workspace.proxy.customUrl ?? '')
  const [showCustomUrl, setShowCustomUrl] = useState(false)
  const [binaryInput, setBinaryInput] = useState(defaultBinaryPath ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCustomUrl(workspace.proxy.customUrl ?? '')
    setShowCustomUrl(false)
    setError(null)
  }, [workspace.id, workspace.proxy.customUrl, open])

  const wsStatus = proxyStatus.workspaceStatuses[workspace.id]

  const runAction = async (fn: () => Promise<void>): Promise<void> => {
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
      title={`单核多路由网络代理 — ${workspace.icon} ${workspace.name}`}
      onClose={onClose}
      footer={
        <Button variant="filled" onClick={onClose}>
          完成
        </Button>
      }
    >
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

      {/* Current Workspace Proxy Mode */}
      <div
        style={{
          padding: 12,
          borderRadius: 'var(--wb-sys-radius-md)',
          backgroundColor: 'var(--wb-sys-color-surface-container)',
          border: '1px solid var(--wb-sys-color-outline-variant)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 13 }}>当前工作区出站模式</strong>
          <Badge tone="primary">
            {wsStatus?.mode === 'managed-node' && wsStatus.nodeName
              ? `${wsStatus.nodeName} (${wsStatus.localProxyUrl ?? '待启动'})`
              : wsStatus?.mode ?? workspace.proxy.mode}
          </Badge>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(
            [
              { id: 'direct', label: '直连' },
              { id: 'system', label: '跟随系统' },
              { id: 'custom', label: '自定义 HTTP/SOCKS5' },
            ] as Array<{ id: WorkspaceProxyMode; label: string }>
          ).map((item) => (
            <Button
              key={item.id}
              variant={workspace.proxy.mode === item.id ? 'filled' : 'outlined'}
              disabled={busy}
              onClick={() =>
                void runAction(async () => {
                  await onSetWorkspaceProxy(
                    workspace.id,
                    item.id === 'custom' ? { mode: 'custom', customUrl } : { mode: item.id },
                  )
                })
              }
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            type={!showCustomUrl && customUrl.includes('@') ? 'password' : 'text'}
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="socks5://user:pass@127.0.0.1:10808 或 http://127.0.0.1:7890"
          />
          {customUrl.includes('@') ? (
            <Button
              variant="text"
              onClick={() => setShowCustomUrl((prev) => !prev)}
            >
              {showCustomUrl ? '隐藏' : '显示'}
            </Button>
          ) : null}
          <Button
            variant="tonal"
            disabled={busy || !customUrl.trim()}
            onClick={() =>
              void runAction(async () => {
                await onSetWorkspaceProxy(workspace.id, { mode: 'custom', customUrl: customUrl.trim() })
              })
            }
          >
            应用自定义代理
          </Button>
        </div>
        {wsStatus?.error ? (
          <div style={{ fontSize: 11, color: 'var(--wb-sys-color-error)' }}>{wsStatus.error}</div>
        ) : null}
      </div>

      {/* Mihomo Core Status */}
      <div
        style={{
          padding: 12,
          borderRadius: 'var(--wb-sys-radius-md)',
          backgroundColor: 'var(--wb-sys-color-surface-container)',
          border: '1px solid var(--wb-sys-color-outline-variant)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 13 }}>内置代理内核（Mihomo / Clash Meta）</strong>
          <Badge tone={proxyStatus.binaryFound ? 'primary' : 'neutral'}>
            {proxyStatus.running
              ? '运行中（单核多端口）'
              : proxyStatus.binaryFound
                ? '已检测到内核（按需启动）'
                : '未检测到内核二进制'}
          </Badge>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            value={binaryInput}
            onChange={(e) => setBinaryInput(e.target.value)}
            placeholder="可选：手动指定 mihomo 可执行文件路径（默认查找 resources/bin 或 PATH）"
          />
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => void runAction(() => onSetBinaryPath(binaryInput))}
          >
            检测内核
          </Button>
        </div>
      </div>

      {/* Import Clash / V2Ray Subscription */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>导入 Clash YAML / V2Ray 订阅 / 节点链接</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            value={subName}
            onChange={(e) => setSubName(e.target.value)}
            placeholder="订阅名称（如：机场主线）"
          />
          <Input
            value={subUrl}
            onChange={(e) => setSubUrl(e.target.value)}
            placeholder="远程订阅 URL（可选）"
          />
        </div>
        <textarea
          className="wb-input"
          style={{ height: 74, padding: 8, resize: 'vertical', fontFamily: 'var(--wb-sys-font-mono)' }}
          value={subContent}
          onChange={(e) => setSubContent(e.target.value)}
          placeholder="或直接粘贴 Clash YAML (proxies: ...) / V2Ray Base64 / vless:// trojan:// vmess:// ss:// hysteria2:// 节点链接"
        />
        <Button
          variant="tonal"
          disabled={busy || (!subUrl.trim() && !subContent.trim())}
          onClick={() =>
            void runAction(async () => {
              await onImport({
                name: subName.trim() || '自定义节点组',
                url: subUrl.trim() || undefined,
                content: subContent.trim() || undefined,
              })
              setSubName('')
              setSubUrl('')
              setSubContent('')
            })
          }
        >
          解析并导入节点
        </Button>
      </div>

      {/* Subscriptions & Nodes */}
      {subscriptions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong style={{ fontSize: 12 }}>已导入订阅 ({subscriptions.length})</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {subscriptions.map((sub) => (
              <Badge key={sub.id}>
                <span>
                  {sub.name} ({sub.nodeCount} 节点)
                </span>
                <button
                  type="button"
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit' }}
                  onClick={() => void runAction(() => onDeleteSubscription(sub.id))}
                >
                  ✕
                </button>
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {nodes.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong style={{ fontSize: 12 }}>节点列表（为「{workspace.name}」绑定独立节点）</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {nodes.map((node) => {
              const bound =
                workspace.proxy.mode === 'managed-node' && workspace.proxy.nodeId === node.id
              return (
                <div
                  key={node.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 'var(--wb-sys-radius-sm)',
                    border: bound
                      ? '1px solid var(--wb-sys-color-primary)'
                      : '1px solid var(--wb-sys-color-outline-variant)',
                    backgroundColor: 'var(--wb-sys-color-surface-container-low)',
                    fontSize: 12,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--wb-sys-color-on-surface-variant)' }}>
                      {node.protocol.toUpperCase()} · {node.server}:{node.port}
                      {node.latencyMs !== undefined && node.latencyMs !== null ? ` · ${node.latencyMs}ms` : ''}
                    </div>
                  </div>
                  <Button variant="text" disabled={busy} onClick={() => void runAction(() => onTestLatency(node.id))}>
                    测速
                  </Button>
                  <Button
                    variant={bound ? 'filled' : 'tonal'}
                    disabled={busy}
                    onClick={() =>
                      void runAction(() =>
                        onSetWorkspaceProxy(workspace.id, { mode: 'managed-node', nodeId: node.id }),
                      )
                    }
                  >
                    {bound ? '当前已绑定' : '绑定到此空间'}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}
