import { useEffect, useRef, useState } from 'react'
import type { MultabCategory, MultabItem, SaveMultabItemInput } from '@wb/contracts'
import { Button, Dialog, Input } from '@wb/ui-kit'
import { Check, Plus, Sparkles } from 'lucide-react'
import { formatIpcError } from '../utils/format-error.js'
import { workspaceColors } from './WorkspaceGlyph.js'

export interface MultabItemDraft {
  title: string
  url: string
  iconUrl?: string
  categoryId?: string
}

export interface MultabItemDialogProps {
  open: boolean
  categories: MultabCategory[]
  editingItem: MultabItem | null
  initialDraft?: MultabItemDraft | null
  defaultCategoryId?: string
  anchorTopRight?: boolean
  onClose: () => void
  onSave: (input: SaveMultabItemInput) => Promise<void>
  onDelete?: (itemId: string) => Promise<void>
  onCreateCategory: (name: string) => Promise<string | undefined>
}

function getPreviewMonogram(title: string, url: string): string {
  const cleanTitle = title.trim()
  if (cleanTitle) return cleanTitle.slice(0, 1).toUpperCase()
  try {
    return new URL(/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url) ? url : `https://${url}`).hostname
      .replace(/^www\./, '')
      .slice(0, 1)
      .toUpperCase() || 'W'
  } catch {
    return 'W'
  }
}

export function MultabItemDialog({
  open,
  categories,
  editingItem,
  initialDraft,
  defaultCategoryId,
  anchorTopRight = false,
  onClose,
  onSave,
  onDelete,
  onCreateCategory,
}: MultabItemDialogProps) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [iconUrl, setIconUrl] = useState('')
  const [iconPreviewFailed, setIconPreviewFailed] = useState(false)
  const [fetchingMeta, setFetchingMeta] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  const [iconBg, setIconBg] = useState('#1F5AE0')
  const [pinned, setPinned] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [showNewCat, setShowNewCat] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const metaRequestSeqRef = useRef(0)

  useEffect(() => {
    if (!open) return
    metaRequestSeqRef.current += 1
    setError(null)
    setShowNewCat(false)
    setNewCategoryName('')
    setFetchingMeta(false)
    setIconPreviewFailed(false)
    if (editingItem) {
      setTitle(editingItem.title)
      setUrl(editingItem.url)
      setIconUrl(editingItem.iconUrl ?? '')
      setCategoryId(editingItem.categoryId)
      setIconBg(editingItem.iconBg || '#1F5AE0')
      setPinned(Boolean(editingItem.pinned))
    } else {
      setTitle(initialDraft?.title ?? '')
      setUrl(initialDraft?.url ?? '')
      setIconUrl(initialDraft?.iconUrl ?? '')
      setCategoryId(initialDraft?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '')
      setIconBg('#1F5AE0')
      setPinned(Boolean(initialDraft))
    }
    // Intentionally omit `categories` so creating a new category inline doesn't reset the selected categoryId or form inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingItem, initialDraft, defaultCategoryId])

  useEffect(() => {
    if (open && !categoryId && categories[0]?.id) {
      setCategoryId(categories[0].id)
    }
  }, [open, categoryId, categories])

  const handleFetchMeta = async (targetUrl: string, forceOverwrite: boolean): Promise<void> => {
    const candidate = targetUrl.trim()
    if (!candidate) return
    const seq = ++metaRequestSeqRef.current
    setFetchingMeta(true)
    if (forceOverwrite) {
      setError(null)
    }
    try {
      const meta = await window.browserApi.fetchMultabSiteMeta(candidate)
      if (metaRequestSeqRef.current !== seq) return
      if (meta.url && url.trim() === candidate && !candidate.includes('://')) {
        setUrl(meta.url)
      }
      if (meta.title && (forceOverwrite || !title.trim())) {
        setTitle(meta.title)
      }
      if (meta.iconUrl && (forceOverwrite || !iconUrl.trim())) {
        setIconUrl(meta.iconUrl)
        setIconPreviewFailed(false)
      }
    } catch (err) {
      if (forceOverwrite && metaRequestSeqRef.current === seq) {
        setError(formatIpcError(err))
      }
    } finally {
      if (metaRequestSeqRef.current === seq) {
        setFetchingMeta(false)
      }
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!title.trim() || !url.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSave({
        id: editingItem?.id,
        categoryId: categoryId || categories[0]?.id || '',
        title: title.trim(),
        url: url.trim(),
        iconUrl: iconUrl.trim(),
        iconBg,
        pinned,
      })
      onClose()
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleCreateQuickCategory = async (): Promise<void> => {
    if (!newCategoryName.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const createdId = await onCreateCategory(newCategoryName.trim())
      if (createdId) {
        setCategoryId(createdId)
      }
      setNewCategoryName('')
      setShowNewCat(false)
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={editingItem ? '编辑 Multab 书签' : initialDraft ? '收藏当前网页' : '添加网站到 Multab'}
      backdropClassName={anchorTopRight ? 'wb-dialog-backdrop--anchor-top-right' : undefined}
      onClose={onClose}
      footer={
        <>
          {editingItem && onDelete ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onDelete(editingItem.id)
                  onClose()
                } finally {
                  setBusy(false)
                }
              }}
            >
              移除收藏
            </Button>
          ) : null}
          <Button variant="text" onClick={onClose}>
            取消
          </Button>
          <Button variant="filled" disabled={!title.trim() || !url.trim() || busy} onClick={handleSave}>
            保存书签
          </Button>
        </>
      }
    >
      {error ? <div className="wb-multab-error">{error}</div> : null}

      <div className="wb-field-label">
        <span>网址</span>
        <div className="wb-multab-cat-select-row">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              if (url.trim() && (!title.trim() || !iconUrl.trim())) {
                void handleFetchMeta(url, false)
              }
            }}
            placeholder="https://example.com"
          />
          <Button
            variant="outlined"
            disabled={!url.trim() || fetchingMeta || busy}
            onClick={() => void handleFetchMeta(url, true)}
            title="自动抓取网页标题与图标"
          >
            <Sparkles size={14} /> {fetchingMeta ? '识别中…' : '自动识别'}
          </Button>
        </div>
      </div>

      <label className="wb-field-label">
        名称
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：GitHub / 后台控制台（支持填网址后自动识别）"
          autoFocus
        />
      </label>

      <div className="wb-field-label">
        <span>站点图标（自动抓取或留空显示首字母）</span>
        <div className="wb-multab-cat-select-row">
          <span
            className="wb-multab-icon-preview"
            style={!iconUrl.trim() || iconPreviewFailed ? { backgroundColor: iconBg } : undefined}
          >
            {iconUrl.trim() && !iconPreviewFailed ? (
              <img
                src={iconUrl.trim()}
                alt=""
                onError={() => setIconPreviewFailed(true)}
              />
            ) : (
              <span>{getPreviewMonogram(title, url)}</span>
            )}
          </span>
          <Input
            value={iconUrl}
            onChange={(e) => {
              setIconUrl(e.target.value)
              setIconPreviewFailed(false)
            }}
            placeholder="图标链接（留空使用首字母图标）"
          />
        </div>
      </div>

      <div className="wb-field-label">
        <span>保存到</span>
        <div className="wb-multab-cat-select-row">
          <select
            className="wb-input"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <Button
            variant="outlined"
            onClick={() => setShowNewCat((prev) => !prev)}
            title="新建子分类"
          >
            <Plus size={14} /> 新建
          </Button>
        </div>

        {showNewCat ? (
          <div className="wb-multab-cat-select-row">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="输入新子分类名称"
            />
            <Button variant="tonal" disabled={!newCategoryName.trim() || busy} onClick={handleCreateQuickCategory}>
              创建
            </Button>
          </div>
        ) : null}
      </div>

      <div
        className="wb-multab-pin-toggle"
        role="switch"
        tabIndex={0}
        aria-checked={pinned}
        onClick={() => setPinned((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setPinned((prev) => !prev)
          }
        }}
      >
        <span>置顶到主页</span>
        <span className={`wb-multab-switch ${pinned ? 'wb-multab-switch--on' : ''}`} />
      </div>

      <div className="wb-field-label">
        <span>图标底色（无站点图标时显示）</span>
        <div className="wb-color-swatches">
          {workspaceColors.map((hex) => {
            const selected = iconBg === hex
            return (
              <button
                key={hex}
                type="button"
                className={`wb-swatch ${selected ? 'wb-swatch--selected' : ''}`}
                style={{ backgroundColor: hex }}
                onClick={() => setIconBg(hex)}
                aria-pressed={selected}
                aria-label={`选择底色 ${hex}`}
              >
                {selected ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
