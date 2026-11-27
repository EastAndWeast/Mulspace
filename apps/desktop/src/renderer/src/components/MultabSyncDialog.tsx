import { useEffect, useState } from 'react'
import type { MultabImportResult, MultabState, MultabSyncPullResult, MultabSyncPushResult } from '@wb/contracts'
import { Button, Dialog, Input } from '@wb/ui-kit'
import { Check, Copy, Download, RefreshCw, Upload } from 'lucide-react'
import { formatIpcError } from '../utils/format-error.js'

export interface MultabSyncDialogProps {
  open: boolean
  multabState: MultabState
  onClose: () => void
}

export function MultabSyncDialog({ open, multabState, onClose }: MultabSyncDialogProps) {
  const [relayUrl, setRelayUrl] = useState(multabState.syncRelayUrl ?? '')
  const [relayStatus, setRelayStatus] = useState<string | null>(null)
  const [pushResult, setPushResult] = useState<MultabSyncPushResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [pullCode, setPullCode] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setRelayUrl(multabState.syncRelayUrl ?? '')
    setRelayStatus(null)
    setError(null)
    setFeedback(null)
    // Only reset transient dialog banners when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleTestRelay = async (): Promise<void> => {
    setBusy(true)
    setRelayStatus(null)
    setError(null)
    try {
      await window.browserApi.updateMultabPrefs({ syncRelayUrl: relayUrl })
      const res = await window.browserApi.testMultabSyncRelay(relayUrl)
      if (res.ok) {
        setRelayStatus('中转服务连接正常，可使用 6 位验证码同步')
      } else {
        setRelayStatus(res.error ?? '无法连接中转服务')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleGenerateCode = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setFeedback(null)
    setCopied(false)
    try {
      const res = await window.browserApi.pushMultabSyncCode(relayUrl)
      setPushResult(res)
      setFeedback(`已加密上传 ${res.categoryCount} 个分组、${res.itemCount} 个网站（5 分钟内有效）`)
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const handlePullCode = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const res: MultabSyncPullResult = await window.browserApi.pullMultabSyncCode(pullCode, relayUrl)
      setFeedback(
        `同步完成：新增 ${res.addedCategories} 个分组 / ${res.addedItems} 个网站，更新 ${res.updatedCategories + res.updatedItems} 项`,
      )
      setPullCode('')
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleImportHtml = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const res: MultabImportResult | null = await window.browserApi.importMultabBookmarksHtml()
      if (res) {
        setFeedback(`已从书签 HTML 导入 ${res.addedCategories} 个分组、${res.addedItems} 个网站`)
      }
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleImportJson = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const res = await window.browserApi.importMultabJson()
      if (res) {
        setFeedback(`已导入 JSON：新增 ${res.addedCategories} 个分组、${res.addedItems} 个网站`)
      }
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleExportJson = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const ok = await window.browserApi.exportMultabJson()
      if (ok) {
        setFeedback('已导出 Multab 备份 JSON 文件')
      }
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const formattedCode = pushResult
    ? `${pushResult.code.slice(0, 3)} ${pushResult.code.slice(3)}`
    : null

  return (
    <Dialog
      open={open}
      title="Multab 跨设备同步与备份"
      onClose={onClose}
      footer={
        <Button variant="filled" onClick={onClose}>
          完成
        </Button>
      }
    >
      {error ? <div className="wb-multab-error">{error}</div> : null}
      {feedback ? <div className="wb-multab-notice">{feedback}</div> : null}

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title">无账号 6 位数字验证码同步（方案 C）</div>
            <div className="wb-dialog-card__sub">
              使用 6 位码在本地完成 AES-256-GCM 端到端加密后上传至 Cloudflare Worker，中转端 5 分钟后自动销毁
            </div>
          </div>
        </div>

        <div className="wb-multab-cat-select-row">
          <Input
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="https://multab-sync-relay.<你的子域>.workers.dev"
          />
          <Button variant="outlined" disabled={busy || !relayUrl.trim()} onClick={handleTestRelay}>
            测试连接
          </Button>
        </div>

        {relayStatus ? <div className="wb-details__msg">{relayStatus}</div> : null}

        <div className="wb-multab-sync-grid">
          <div className="wb-multab-sync-box">
            <strong>发送方：生成 6 位码</strong>
            {formattedCode ? (
              <div className="wb-multab-code-row">
                <code className="wb-multab-code">{formattedCode}</code>
                <Button
                  variant="text"
                  onClick={() => {
                    void navigator.clipboard?.writeText(pushResult!.code)
                    setCopied(true)
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </Button>
              </div>
            ) : (
              <span className="wb-dialog-card__sub">在另一台设备上输入生成的 6 位数字即可同步</span>
            )}
            <Button variant="tonal" disabled={busy || !relayUrl.trim()} onClick={handleGenerateCode}>
              <RefreshCw size={14} /> 生成 6 位同步码
            </Button>
          </div>

          <div className="wb-multab-sync-box">
            <strong>接收方：输入 6 位码合并</strong>
            <Input
              value={pullCode}
              onChange={(e) => setPullCode(e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
              placeholder="输入 6 位数字验证码"
            />
            <Button
              variant="filled"
              disabled={busy || !relayUrl.trim() || pullCode.replace(/\s+/g, '').length !== 6}
              onClick={handlePullCode}
            >
              拉取并合并
            </Button>
          </div>
        </div>

        <details className="wb-details">
          <summary>如何免费部署自己的 Cloudflare Worker 中转（3 步免服务器）</summary>
          <div className="wb-details__body wb-details__msg">
            <div>1. 进入仓库内 <code>workers/multab-sync</code> 目录，执行 <code>npx wrangler login</code> 登录 Cloudflare。</div>
            <div>2. 执行 <code>npx wrangler kv namespace create MULTAB_SYNC_KV</code> 并将生成的 id 填入 <code>wrangler.toml</code>。</div>
            <div>3. 执行 <code>npx wrangler deploy</code>，把得到的 <code>workers.dev</code> 地址填到上方输入框即可（每天免费 10 万次请求，零明文存储）。</div>
          </div>
        </details>
      </div>

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title">本地书签导入与离线备份</div>
            <div className="wb-dialog-card__sub">
              {multabState.lastSyncedAt
                ? `上次同步：${new Date(multabState.lastSyncedAt).toLocaleString()}`
                : '支持 Chrome / Edge 导出的 bookmarks.html 与 JSON 文件'}
            </div>
          </div>
        </div>

        <div className="wb-details__actions">
          <Button variant="tonal" disabled={busy} onClick={handleImportHtml}>
            <Upload size={14} /> 导入 Chrome 书签 HTML
          </Button>
          <Button variant="outlined" disabled={busy} onClick={handleImportJson}>
            导入 JSON
          </Button>
          <Button variant="outlined" disabled={busy} onClick={handleExportJson}>
            <Download size={14} /> 导出备份 JSON
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
