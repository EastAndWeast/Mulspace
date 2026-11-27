import { useEffect, useState } from 'react'
import type { TranslatePageMode } from '@wb/contracts'
import { Button, Dialog } from '@wb/ui-kit'
import { Copy, Languages, RotateCcw } from 'lucide-react'
import { formatIpcError } from '../utils/format-error.js'

const TARGET_LANGUAGES = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English (英语)' },
  { code: 'ja', label: '日本語 (日语)' },
  { code: 'ko', label: '한국어 (韩语)' },
  { code: 'fr', label: 'Français (法语)' },
  { code: 'de', label: 'Deutsch (德语)' },
  { code: 'es', label: 'Español (西班牙语)' },
]

const LANG_STORAGE_KEY = 'mulspace:translate:target-lang'

export interface TranslateDialogProps {
  open: boolean
  workspaceId: string
  tabId?: string
  hasWebPage: boolean
  isPageTranslated: boolean
  onClose: () => void
  onPageTranslatedChange: (translated: boolean) => void
  onToast: (message: string) => void
}

export function TranslateDialog({
  open,
  workspaceId,
  tabId,
  hasWebPage,
  isPageTranslated,
  onClose,
  onPageTranslatedChange,
  onToast,
}: TranslateDialogProps) {
  const [targetLang, setTargetLang] = useState<string>(
    () => window.localStorage.getItem(LANG_STORAGE_KEY) || 'zh-CN',
  )
  const [sourceText, setSourceText] = useState('')
  const [translatedText, setTranslatedText] = useState('')
  const [pageStatus, setPageStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setPageStatus(null)
    if (hasWebPage && tabId) {
      void window.browserApi.getTabSelectionText(workspaceId, tabId).then((sel) => {
        if (sel) {
          setSourceText(sel)
        }
      })
    }
  }, [open, hasWebPage, workspaceId, tabId])

  const handleChangeLang = (lang: string): void => {
    setTargetLang(lang)
    window.localStorage.setItem(LANG_STORAGE_KEY, lang)
  }

  const handleTranslatePage = async (mode: TranslatePageMode): Promise<void> => {
    if (!tabId || !hasWebPage) return
    setBusy(true)
    setError(null)
    setPageStatus(null)
    try {
      const res = await window.browserApi.translatePage(workspaceId, tabId, targetLang, mode)
      onPageTranslatedChange(true)
      const msg = `已完成${mode === 'bilingual' ? '双语对照' : '整页'}翻译（共 ${res.translatedCount} 处文本）`
      setPageStatus(msg)
      onToast(msg)
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRestorePage = async (): Promise<void> => {
    if (!tabId) return
    setBusy(true)
    setError(null)
    try {
      await window.browserApi.restoreTranslatedPage(workspaceId, tabId)
      onPageTranslatedChange(false)
      setPageStatus('已恢复网页原文')
      onToast('已恢复网页原文')
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleTranslateText = async (): Promise<void> => {
    if (!sourceText.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.browserApi.translateText(workspaceId, sourceText, targetLang)
      setTranslatedText(res)
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title="智能翻译助手"
      onClose={onClose}
      footer={
        <Button variant="text" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <label className="wb-field-label">
        目标语言
        <select
          className="wb-input"
          value={targetLang}
          onChange={(e) => handleChangeLang(e.target.value)}
        >
          {TARGET_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </label>

      {error ? <div className="wb-multab-error">{error}</div> : null}
      {pageStatus ? <div className="wb-multab-notice">{pageStatus}</div> : null}

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Languages size={14} />
              <span>当前网页整页翻译</span>
            </div>
            <div className="wb-dialog-card__sub">
              {hasWebPage
                ? '使用当前工作区网络环境翻译网页文本（支持双语对照与一键还原）'
                : '当前为新标签页，打开任意网页后可一键整页翻译或双语对照'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="filled"
            disabled={busy || !hasWebPage}
            onClick={() => void handleTranslatePage('replace')}
          >
            整页翻译
          </Button>
          <Button
            variant="tonal"
            disabled={busy || !hasWebPage}
            onClick={() => void handleTranslatePage('bilingual')}
          >
            双语对照翻译
          </Button>
          {isPageTranslated || pageStatus ? (
            <Button variant="outlined" disabled={busy || !hasWebPage} onClick={() => void handleRestorePage()}>
              <RotateCcw size={13} />
              恢复原文
            </Button>
          ) : null}
        </div>
      </div>

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title">划词 / 文本快译</div>
            <div className="wb-dialog-card__sub">打开时会自动读取网页中选中的文字，也可直接粘贴任意文本</div>
          </div>
          <Button variant="filled" disabled={busy || !sourceText.trim()} onClick={() => void handleTranslateText()}>
            {busy ? '翻译中…' : '立即翻译'}
          </Button>
        </div>

        <textarea
          className="wb-input wb-details__textarea"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="输入或粘贴要翻译的内容（打开弹窗会自动带入网页当前划词）…"
        />

        {translatedText ? (
          <div className="wb-translate-result">
            <div className="wb-translate-result__text">{translatedText}</div>
            <Button
              variant="text"
              onClick={() => {
                void navigator.clipboard?.writeText(translatedText)
                onToast('已复制译文到剪贴板')
              }}
            >
              <Copy size={13} />
              复制译文
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
