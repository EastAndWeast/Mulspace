import { type CSSProperties, memo, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MultabCategory,
  MultabItem,
  MultabPrefsPatch,
  MultabSearchEngineId,
  MultabState,
  MultabViewMode,
  SaveMultabCategoryInput,
  Workspace,
} from '@wb/contracts'
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  BriefcaseBusiness,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FolderPlus,
  Home,
  Image,
  LayoutGrid,
  List,
  Maximize2,
  Minimize2,
  NotebookPen,
  PanelTopClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import nightWallpaper from '../assets/multab-night-wallpaper.jpg'
import { MultabCategoryIcon, multabCategoryPickerIcons } from './MultabCategoryIcon.js'
import { WorkspaceGlyph } from './WorkspaceGlyph.js'

const SEARCH_ENGINES: Array<{ id: MultabSearchEngineId; label: string; template: string }> = [
  { id: 'bing', label: 'Bing', template: 'https://www.bing.com/search?q=' },
  { id: 'google', label: 'Google', template: 'https://www.google.com/search?q=' },
  { id: 'baidu', label: '百度', template: 'https://www.baidu.com/s?wd=' },
  { id: 'github', label: 'GitHub', template: 'https://github.com/search?q=' },
]

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']

function formatClockParts(date: Date): { time: string; dateLabel: string } {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekday = WEEKDAYS_ZH[date.getDay()] ?? '一'
  return {
    time: `${hh}:${mm}`,
    dateLabel: `${month}月${day}日 · 星期${weekday}`,
  }
}

function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim()
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return true
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return true
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed)) return true
  return !trimmed.includes(' ') && trimmed.includes('.')
}

function getDisplayHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '')
  } catch {
    return rawUrl
  }
}

function getMonogram(title: string, url: string): string {
  const cleanTitle = title.trim()
  if (cleanTitle) return cleanTitle.slice(0, 1).toUpperCase()
  return getDisplayHost(url).slice(0, 1).toUpperCase() || 'W'
}

interface MultabEntryProps {
  item: MultabItem
  viewMode: MultabViewMode
  isDragging: boolean
  onOpenCurrent: (url: string) => void
  onOpenNewTab: (url: string) => void
  onEdit: (item: MultabItem) => void
  onDelete: (itemId: string) => void
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>, item: MultabItem) => void
  onPointerStart: (e: React.PointerEvent<HTMLDivElement>, item: MultabItem) => void
  registerRef: (id: string, node: HTMLDivElement | null) => void
}

function MultabEntry({
  item,
  viewMode,
  isDragging,
  onOpenCurrent,
  onOpenNewTab,
  onEdit,
  onDelete,
  onContextMenu,
  onPointerStart,
  registerRef,
}: MultabEntryProps) {
  const [iconLoaded, setIconLoaded] = useState(false)
  const [iconFailed, setIconFailed] = useState(false)
  useEffect(() => {
    setIconLoaded(false)
    setIconFailed(false)
  }, [item.iconUrl])

  const host = getDisplayHost(item.url)
  const canTryFavicon = Boolean(item.iconUrl && !iconFailed)
  const showFavicon = canTryFavicon && iconLoaded

  const commonProps = {
    ref: (node: HTMLDivElement | null) => registerRef(item.id, node),
    'data-multab-item-id': item.id,
    role: 'button' as const,
    tabIndex: 0,
    draggable: false,
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => e.preventDefault(),
    title: `${item.title}\n${item.url}`,
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => onPointerStart(e, item),
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      onContextMenu(e, item)
    },
    onClick: (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.metaKey || e.ctrlKey) {
        onOpenNewTab(item.url)
      } else {
        onOpenCurrent(item.url)
      }
    },
    onAuxClick: (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button === 1) {
        e.preventDefault()
        onOpenNewTab(item.url)
      }
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onOpenCurrent(item.url)
      }
    },
  }

  const quickActions = (
    <div className="wb-multab__card-actions">
      <button
        type="button"
        className="wb-multab__card-btn"
        title="编辑"
        aria-label={`编辑 ${item.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onEdit(item)
        }}
      >
        <Pencil size={11} />
      </button>
      <button
        type="button"
        className="wb-multab__card-btn"
        title="移除"
        aria-label={`移除 ${item.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onDelete(item.id)
        }}
      >
        <X size={11} />
      </button>
    </div>
  )

  if (viewMode === 'icons') {
    return (
      <div
        {...commonProps}
        className={`wb-multab__tile ${isDragging ? 'wb-multab__card--dragging' : ''}`}
      >
        <div
          className={`wb-multab__tile-box ${showFavicon ? 'wb-multab__tile-box--favicon' : ''}`}
          style={{ backgroundColor: showFavicon ? undefined : item.iconBg || '#1F5AE0' }}
        >
          {quickActions}
          {!showFavicon ? (
            <span className="wb-multab__tile-mono">{getMonogram(item.title, item.url)}</span>
          ) : null}
          {canTryFavicon ? (
            <img
              src={item.iconUrl}
              alt=""
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              style={showFavicon ? undefined : { position: 'absolute', opacity: 0, pointerEvents: 'none' }}
              onLoad={(e) => {
                if (e.currentTarget.naturalWidth > 1) setIconLoaded(true)
                else setIconFailed(true)
              }}
              onError={() => setIconFailed(true)}
            />
          ) : null}
        </div>
        <span className="wb-multab__tile-title">{item.title}</span>
      </div>
    )
  }

  return (
    <div
      {...commonProps}
      className={`wb-multab__card ${isDragging ? 'wb-multab__card--dragging' : ''}`}
    >
      {quickActions}
      <span
        className={`wb-multab__card-icon ${showFavicon ? 'wb-multab__card-icon--favicon' : ''}`}
        style={!showFavicon ? { backgroundColor: item.iconBg || '#1F5AE0' } : undefined}
      >
        {!showFavicon ? <span>{getMonogram(item.title, item.url)}</span> : null}
        {canTryFavicon ? (
          <img
            src={item.iconUrl}
            alt=""
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            style={showFavicon ? undefined : { position: 'absolute', opacity: 0, pointerEvents: 'none' }}
            onLoad={(e) => {
              if (e.currentTarget.naturalWidth > 1) setIconLoaded(true)
              else setIconFailed(true)
            }}
            onError={() => setIconFailed(true)}
          />
        ) : null}
      </span>

      <span className="wb-multab__card-meta">
        <span className="wb-multab__card-title">{item.title}</span>
        <span className="wb-multab__card-host">{host}</span>
      </span>
    </div>
  )
}

function RecentItemBadge({ item }: { item: MultabItem }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [item.iconUrl])
  const canTryFavicon = Boolean(item.iconUrl && !failed)
  const showFavicon = canTryFavicon && loaded
  return (
    <span
      className="wb-multab__recent-badge"
      style={!showFavicon ? { backgroundColor: item.iconBg || '#1F5AE0' } : undefined}
    >
      {!showFavicon ? <span>{getMonogram(item.title, item.url)}</span> : null}
      {canTryFavicon ? (
        <img
          src={item.iconUrl}
          alt=""
          style={showFavicon ? undefined : { position: 'absolute', opacity: 0, pointerEvents: 'none' }}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth > 1) setLoaded(true)
            else setFailed(true)
          }}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  )
}

type MultabContextMenuState =
  | { x: number; y: number; kind: 'item'; item: MultabItem }
  | { x: number; y: number; kind: 'category'; category: MultabCategory }
  | { x: number; y: number; kind: 'canvas' }

interface NewTabPageProps {
  workspace: Workspace
  workspaces: Workspace[]
  tabCountsByWorkspace: Record<string, number>
  proxyLabel: string
  multabState: MultabState
  onNavigate: (input: string) => void
  onOpenInNewTab: (url: string) => void
  onSwitchWorkspace: (id: string) => void
  onCreateWorkspace: () => void
  onOpenAddItem: (categoryId?: string) => void
  onEditItem: (item: MultabItem) => void
  onDeleteItem: (itemId: string) => void
  onReorderItems: (categoryId: string, orderedIds: string[]) => void
  onMoveItemToCategory: (item: MultabItem, targetCategoryId: string) => Promise<void>
  onTogglePinItem: (item: MultabItem) => Promise<void>
  onReorderCategories: (orderedIds: string[]) => void
  onSaveCategory: (input: SaveMultabCategoryInput) => Promise<MultabState>
  onDeleteCategory: (categoryId: string) => Promise<void>
  onChangeSearchEngine: (engine: MultabSearchEngineId) => void
  onChangeViewMode: (mode: MultabViewMode) => void
  onUpdatePrefs: (patch: MultabPrefsPatch) => void
  onOpenSyncDialog: () => void
}

export const NewTabPage = memo(function NewTabPage({
  workspace,
  workspaces,
  tabCountsByWorkspace,
  proxyLabel,
  multabState,
  onNavigate,
  onOpenInNewTab,
  onSwitchWorkspace,
  onCreateWorkspace,
  onOpenAddItem,
  onEditItem,
  onDeleteItem,
  onReorderItems,
  onMoveItemToCategory,
  onTogglePinItem,
  onReorderCategories,
  onSaveCategory,
  onDeleteCategory,
  onChangeSearchEngine,
  onChangeViewMode,
  onUpdatePrefs,
  onOpenSyncDialog,
}: NewTabPageProps) {
  const [clockNow, setClockNow] = useState(() => new Date())
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'bookmarks' | 'web'>('bookmarks')
  const [searchFocused, setSearchFocused] = useState(false)
  const [activeMatchIdx, setActiveMatchIdx] = useState(-1)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('home')
  const [focusMode, setFocusMode] = useState(false)

  // Anchored New Group Popover
  const [newGroupPopOpen, setNewGroupPopOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupIcon, setNewGroupIcon] = useState('layers')

  // Inline Category Rename
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null)
  const [renameCatName, setRenameCatName] = useState('')

  // Bookmark Library Modal
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryFilter, setLibraryFilter] = useState('')

  // Notes synced with debounce
  const [notesDraft, setNotesDraft] = useState(multabState.notes ?? '')
  const notesDirtyRef = useRef(false)
  const notesTimerRef = useRef<number | null>(null)

  const [dragOrderedIds, setDragOrderedIds] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetCatId, setDropTargetCatId] = useState<string | null>(null)
  const [dragOrderedCatIds, setDragOrderedCatIds] = useState<string[] | null>(null)
  const [draggingCatId, setDraggingCatId] = useState<string | null>(null)

  const [contextMenu, setContextMenu] = useState<MultabContextMenuState | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const catRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)
  const suppressCatClickRef = useRef(false)
  const toastTimerRef = useRef<number | null>(null)

  const viewMode: MultabViewMode = multabState.viewMode ?? 'icons'
  const widgetsHidden = Boolean(multabState.widgetsHidden)
  const wallpaperEnabled = multabState.wallpaperEnabled ?? true

  useEffect(() => {
    const id = window.setInterval(() => setClockNow(new Date()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!notesDirtyRef.current) {
      setNotesDraft(multabState.notes ?? '')
    }
  }, [multabState.notes])

  useEffect(() => {
    if (selectedCategoryId !== 'home' && !multabState.categories.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId('home')
    }
  }, [multabState.categories, selectedCategoryId])

  useEffect(() => () => {
    dragCleanupRef.current?.()
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    if (notesTimerRef.current) window.clearTimeout(notesTimerRef.current)
  }, [])

  useEffect(() => {
    setActiveMatchIdx(-1)
  }, [query])

  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setContextMenu(null)
        setNewGroupPopOpen(false)
        setLibraryOpen(false)
        if (focusMode) setFocusMode(false)
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  }, [focusMode])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', close)
    }
  }, [contextMenu])

  const showToast = (message: string): void => {
    setToast(message)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200)
  }

  const commitNotes = (value: string): void => {
    if (notesTimerRef.current) window.clearTimeout(notesTimerRef.current)
    notesDirtyRef.current = false
    if (value !== (multabState.notes ?? '')) {
      onUpdatePrefs({ notes: value })
    }
  }

  const handleNotesChange = (value: string): void => {
    setNotesDraft(value)
    notesDirtyRef.current = true
    if (notesTimerRef.current) window.clearTimeout(notesTimerRef.current)
    notesTimerRef.current = window.setTimeout(() => commitNotes(value), 450)
  }

  const categoryById = useMemo(
    () => new Map(multabState.categories.map((c) => [c.id, c])),
    [multabState.categories],
  )

  const orderedCategories = useMemo(() => {
    if (!dragOrderedCatIds || dragOrderedCatIds.length !== multabState.categories.length) {
      return multabState.categories
    }
    const ordered: MultabCategory[] = []
    for (const id of dragOrderedCatIds) {
      const found = categoryById.get(id)
      if (!found) return multabState.categories
      ordered.push(found)
    }
    return ordered
  }, [multabState.categories, dragOrderedCatIds, categoryById])

  const activeCategory = useMemo(
    () => (selectedCategoryId === 'home' ? null : categoryById.get(selectedCategoryId) ?? null),
    [categoryById, selectedCategoryId],
  )

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of multabState.items) {
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1)
    }
    return counts
  }, [multabState.items])

  const pinnedItems = useMemo(() => {
    const pinned = multabState.items.filter((i) => i.pinned)
    const base = pinned.length > 0 ? [...pinned] : multabState.items.slice(0, 6)
    return base.sort(
      (a, b) =>
        (a.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (b.pinnedOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.order - b.order,
    )
  }, [multabState.items])

  const recentItems = useMemo(() => {
    return [...multabState.items]
      .sort((a, b) => Math.max(b.updatedAt, b.createdAt) - Math.max(a.updatedAt, a.createdAt))
      .slice(0, 3)
  }, [multabState.items])

  const visibleItems = useMemo(() => {
    const base =
      selectedCategoryId === 'home'
        ? pinnedItems
        : multabState.items.filter((i) => i.categoryId === selectedCategoryId)
    if (!dragOrderedIds || dragOrderedIds.length !== base.length) {
      return base
    }
    const byId = new Map(base.map((i) => [i.id, i]))
    const ordered: MultabItem[] = []
    for (const id of dragOrderedIds) {
      const m = byId.get(id)
      if (!m) return base
      ordered.push(m)
    }
    return ordered
  }, [multabState.items, pinnedItems, selectedCategoryId, dragOrderedIds])

  const matchedBookmarks = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const pool =
      selectedCategoryId !== 'home' && searchMode === 'bookmarks'
        ? multabState.items.filter((i) => i.categoryId === selectedCategoryId)
        : multabState.items
    const scored: Array<{ item: MultabItem; score: number }> = []
    for (const item of pool) {
      const titleLower = item.title.toLowerCase()
      const hostLower = getDisplayHost(item.url).toLowerCase()
      const catNameLower = (categoryById.get(item.categoryId)?.name ?? '').toLowerCase()
      let score = 0
      if (titleLower.startsWith(q)) score = 4
      else if (titleLower.includes(q)) score = 3
      else if (hostLower.includes(q)) score = 2
      else if (catNameLower.includes(q) || item.url.toLowerCase().includes(q)) score = 1
      if (score > 0) scored.push({ item, score })
    }
    scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    return scored.slice(0, 6).map((s) => s.item)
  }, [query, multabState.items, selectedCategoryId, searchMode, categoryById])

  const libraryItems = useMemo(() => {
    const q = libraryFilter.trim().toLowerCase()
    if (!q) return multabState.items
    return multabState.items.filter((item) => {
      const cat = categoryById.get(item.categoryId)?.name ?? ''
      return (
        item.title.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q)
      )
    })
  }, [multabState.items, libraryFilter, categoryById])

  const clampMenuPos = (x: number, y: number, estHeight = 250): { x: number; y: number } => ({
    x: Math.max(8, Math.min(x, window.innerWidth - 224)),
    y: Math.max(8, Math.min(y, window.innerHeight - estHeight)),
  })

  const handleCardPointerStart = (e: React.PointerEvent<HTMLDivElement>, item: MultabItem): void => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return

    const sourceItems =
      selectedCategoryId === 'home'
        ? pinnedItems
        : multabState.items.filter((i) => i.categoryId === selectedCategoryId)
    dragCleanupRef.current?.()
    const startX = e.clientX
    const startY = e.clientY
    let order = sourceItems.map((i) => i.id)
    let orderChanged = false
    let hoveredCatId: string | null = null
    let active = false

    const handleMove = (ev: PointerEvent): void => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) {
        return
      }
      if (!active) {
        active = true
        suppressClickRef.current = true
        setDraggingId(item.id)
        if (order.length >= 2) {
          setDragOrderedIds(order)
        }
      }

      // Drop target hit-test against left rail categories
      let foundCat: string | null = null
      for (const cat of multabState.categories) {
        if (cat.id === item.categoryId) continue
        const catNode = catRefs.current.get(cat.id)
        if (!catNode) continue
        const r = catNode.getBoundingClientRect()
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          foundCat = cat.id
          break
        }
      }
      if (foundCat !== hoveredCatId) {
        hoveredCatId = foundCat
        setDropTargetCatId(foundCat)
      }

      if (!hoveredCatId && order.length >= 2) {
        for (const candidateId of order) {
          if (candidateId === item.id) continue
          const node = cardRefs.current.get(candidateId)
          if (!node) continue
          const r = node.getBoundingClientRect()
          if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
            const fromIdx = order.indexOf(item.id)
            const toIdx = order.indexOf(candidateId)
            if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
              const next = [...order]
              next.splice(fromIdx, 1)
              next.splice(toIdx, 0, item.id)
              order = next
              orderChanged = true
              setDragOrderedIds(next)
            }
            break
          }
        }
      }
    }

    const finish = (): void => {
      cleanup()
      setDraggingId(null)
      setDropTargetCatId(null)
      if (active) {
        if (hoveredCatId) {
          const targetCat = categoryById.get(hoveredCatId)
          void onMoveItemToCategory(item, hoveredCatId).then(() => {
            if (targetCat) showToast(`已移动到「${targetCat.name}」`)
          })
          setDragOrderedIds(null)
        } else if (orderChanged) {
          onReorderItems(selectedCategoryId, order)
        } else {
          setDragOrderedIds(null)
        }
        setTimeout(() => {
          suppressClickRef.current = false
          setDragOrderedIds(null)
        }, 120)
      } else {
        setDragOrderedIds(null)
      }
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      dragCleanupRef.current = null
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const handleCategoryPointerStart = (e: React.PointerEvent<HTMLButtonElement>, cat: MultabCategory): void => {
    if (e.button !== 0 || multabState.categories.length < 2) return
    dragCleanupRef.current?.()
    const startX = e.clientX
    const startY = e.clientY
    let order = multabState.categories.map((c) => c.id)
    let orderChanged = false
    let active = false

    const handleMove = (ev: PointerEvent): void => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) {
        return
      }
      if (!active) {
        active = true
        suppressCatClickRef.current = true
        setDraggingCatId(cat.id)
        setDragOrderedCatIds(order)
      }
      for (const candidateId of order) {
        if (candidateId === cat.id) continue
        const node = catRefs.current.get(candidateId)
        if (!node) continue
        const r = node.getBoundingClientRect()
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          const fromIdx = order.indexOf(cat.id)
          const toIdx = order.indexOf(candidateId)
          if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
            const next = [...order]
            next.splice(fromIdx, 1)
            next.splice(toIdx, 0, cat.id)
            order = next
            orderChanged = true
            setDragOrderedCatIds(next)
          }
          break
        }
      }
    }

    const finish = (): void => {
      cleanup()
      setDraggingCatId(null)
      if (active) {
        if (orderChanged) {
          onReorderCategories(order)
        }
        setTimeout(() => {
          suppressCatClickRef.current = false
          setDragOrderedCatIds(null)
        }, 120)
      } else {
        setDragOrderedCatIds(null)
      }
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      dragCleanupRef.current = null
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const handleCreateGroupSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const cleanName = newGroupName.trim()
    if (!cleanName) return
    const updated = await onSaveCategory({ name: cleanName, icon: newGroupIcon })
    const created = updated.categories.find((c) => c.name === cleanName)
    if (created) {
      setSelectedCategoryId(created.id)
    }
    setNewGroupName('')
    setNewGroupPopOpen(false)
    showToast(`已创建分组「${cleanName}」`)
  }

  const currentEngine =
    SEARCH_ENGINES.find((e) => e.id === multabState.searchEngine) ?? SEARCH_ENGINES[0]!

  const handleSearchSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (activeMatchIdx >= 0 && matchedBookmarks[activeMatchIdx]) {
      onNavigate(matchedBookmarks[activeMatchIdx]!.url)
      return
    }
    const trimmed = query.trim()
    if (!trimmed) return
    if (searchMode === 'bookmarks' && matchedBookmarks.length > 0) {
      onNavigate(matchedBookmarks[0]!.url)
      return
    }
    if (looksLikeUrl(trimmed)) {
      onNavigate(trimmed)
    } else {
      onNavigate(`${currentEngine.template}${encodeURIComponent(trimmed)}`)
    }
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const showDropdown = searchFocused && query.trim().length > 0 && matchedBookmarks.length > 0
    if (event.key === 'Escape') {
      setSearchFocused(false)
      setActiveMatchIdx(-1)
      return
    }
    if (!showDropdown) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveMatchIdx((prev) => (prev + 1 < matchedBookmarks.length ? prev + 1 : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveMatchIdx((prev) => (prev > 0 ? prev - 1 : -1))
    } else if (event.key === 'Enter' && activeMatchIdx >= 0 && matchedBookmarks[activeMatchIdx]) {
      event.preventDefault()
      const chosen = matchedBookmarks[activeMatchIdx]!
      if (event.metaKey || event.ctrlKey) {
        onOpenInNewTab(chosen.url)
        setSearchFocused(false)
      } else {
        onNavigate(chosen.url)
      }
    }
  }

  const { time: clockTime, dateLabel: clockDate } = formatClockParts(clockNow)
  const dropdownVisible = searchFocused && query.trim().length > 0 && matchedBookmarks.length > 0

  return (
    <section
      className={`wb-start ${wallpaperEnabled ? 'wb-start--wallpaper' : 'wb-start--plain'}`}
      aria-label="Multab 个人网站工作台"
      onContextMenu={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('input, textarea, select')) return
        e.preventDefault()
        setContextMenu({ ...clampMenuPos(e.clientX, e.clientY, 210), kind: 'canvas' })
      }}
    >
      {wallpaperEnabled ? (
        <div
          className="wb-start__bg"
          style={{ backgroundImage: `url(${nightWallpaper})` }}
          aria-hidden="true"
        />
      ) : null}

      {/* Left Narrow Bookmark Group Rail */}
      <aside className="wb-multab-rail" aria-label="Multab 书签分组栏">
        <div className="wb-multab-rail__list" role="tablist" aria-orientation="vertical" aria-label="网站子分类">
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategoryId === 'home'}
            data-multab-cat-id="home"
            className={`wb-multab-rail__btn ${
              selectedCategoryId === 'home' && !newGroupPopOpen ? 'wb-multab-rail__btn--active' : ''
            }`}
            onClick={() => {
              setSelectedCategoryId('home')
              setNewGroupPopOpen(false)
            }}
            title="主页"
          >
            <Home size={18} strokeWidth={1.75} />
            <span>主页</span>
          </button>

          {orderedCategories.map((cat) => {
            const active = selectedCategoryId === cat.id
            const isDropTarget = dropTargetCatId === cat.id
            const isCatDragging = draggingCatId === cat.id
            return (
              <button
                key={cat.id}
                ref={(node) => {
                  if (node) catRefs.current.set(cat.id, node)
                  else catRefs.current.delete(cat.id)
                }}
                type="button"
                role="tab"
                data-multab-cat-id={cat.id}
                aria-selected={active}
                className={`wb-multab-rail__btn wb-multab__cat ${active ? 'wb-multab-rail__btn--active wb-multab__cat--active' : ''} ${
                  isDropTarget ? 'wb-multab__cat--drop-target' : ''
                } ${isCatDragging ? 'wb-multab__cat--dragging' : ''}`}
                onPointerDown={(e) => handleCategoryPointerStart(e, cat)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setContextMenu({ ...clampMenuPos(e.clientX, e.clientY, 150), kind: 'category', category: cat })
                }}
                onClick={() => {
                  if (!suppressCatClickRef.current) {
                    setSelectedCategoryId(cat.id)
                    setNewGroupPopOpen(false)
                  }
                }}
                title={`${cat.name}（${categoryCounts.get(cat.id) ?? 0} 个书签）`}
              >
                <MultabCategoryIcon name={cat.icon} size={18} />
                <span>{cat.name}</span>
              </button>
            )
          })}

          <button
            type="button"
            data-multab-rail-add="true"
            className={`wb-multab-rail__btn wb-multab-rail__btn--add ${
              newGroupPopOpen ? 'wb-multab-rail__btn--active' : ''
            }`}
            onClick={() => {
              setNewGroupName('')
              setNewGroupPopOpen((prev) => !prev)
            }}
            title="新建分组"
          >
            <Plus size={18} strokeWidth={1.85} />
            <span>新建分组</span>
          </button>
        </div>

        <div className="wb-multab-rail__bottom">
          <button
            type="button"
            className={`wb-multab-rail__btn ${libraryOpen ? 'wb-multab-rail__btn--active' : ''}`}
            onClick={() => setLibraryOpen((prev) => !prev)}
            title="书签库"
          >
            <Bookmark size={17} strokeWidth={1.75} />
            <span>书签库</span>
          </button>
          <button
            type="button"
            className="wb-multab-rail__btn"
            onClick={onOpenSyncDialog}
            title="6 位码跨设备同步 / 导入导出"
          >
            <RefreshCw size={16} strokeWidth={1.75} />
            <span>同步</span>
          </button>
        </div>
      </aside>

      {/* Main Content Stage */}
      <div className="wb-start__scroll">
        <div className="wb-start__inner">
          {/* Top Bar */}
          <header className="wb-multab__topbar">
            <div
              className="wb-start__context"
              style={{ '--ws-accent': workspace.seedColor } as CSSProperties}
            >
              <span className="wb-start__context-dot" />
              <span>{workspace.name}</span>
              <span className="wb-start__context-sep">·</span>
              <span>{proxyLabel}</span>
            </div>

            <div className="wb-multab__top-actions">
              {selectedCategoryId === 'home' && !focusMode ? (
                <button
                  type="button"
                  data-multab-toggle-widgets="true"
                  className={`wb-multab__pill-btn ${widgetsHidden ? 'wb-multab__pill-btn--active' : ''}`}
                  onClick={() => onUpdatePrefs({ widgetsHidden: !widgetsHidden })}
                >
                  <PanelTopClose size={13} strokeWidth={1.8} />
                  <span>{widgetsHidden ? '显示组件' : '隐藏组件'}</span>
                </button>
              ) : null}

              <div className="wb-multab__view-switch" role="group" aria-label="视图模式">
                <button
                  type="button"
                  className={`wb-multab__view-btn ${viewMode === 'icons' ? 'wb-multab__view-btn--active' : ''}`}
                  aria-pressed={viewMode === 'icons'}
                  data-multab-view="icons"
                  title="图标网格视图"
                  onClick={() => onChangeViewMode('icons')}
                >
                  <LayoutGrid size={13} />
                  <span>图标</span>
                </button>
                <button
                  type="button"
                  className={`wb-multab__view-btn ${viewMode === 'cards' ? 'wb-multab__view-btn--active' : ''}`}
                  aria-pressed={viewMode === 'cards'}
                  data-multab-view="cards"
                  title="详细卡片视图"
                  onClick={() => onChangeViewMode('cards')}
                >
                  <List size={13} />
                  <span>卡片</span>
                </button>
              </div>

              <button
                type="button"
                className={`wb-multab__pill-btn ${focusMode ? 'wb-multab__pill-btn--active' : ''}`}
                onClick={() => setFocusMode((prev) => !prev)}
                title="专注模式（Esc 退出）"
              >
                {focusMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                <span>{focusMode ? '退出专注' : '专注模式'}</span>
              </button>
            </div>
          </header>

          {/* Hero Clock & Date */}
          <div className={`wb-multab__hero ${focusMode ? 'wb-multab__hero--focus' : ''}`}>
            <div className="wb-multab__clock">{clockTime}</div>
            <div className="wb-multab__date">{clockDate}</div>

            {/* Translucent Search Pill */}
            <div
              className="wb-start__search-wrap"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setSearchFocused(false)
                }
              }}
            >
              <form className="wb-start__search" onSubmit={handleSearchSubmit}>
                <Search size={16} strokeWidth={1.8} aria-hidden="true" />
                <input
                  autoFocus
                  aria-label="搜索或输入网址"
                  placeholder={
                    selectedCategoryId !== 'home' && searchMode === 'bookmarks'
                      ? `在「${activeCategory?.name ?? ''}」中搜索书签名称或网址…`
                      : searchMode === 'bookmarks'
                        ? '搜索已收藏书签名称、网址或客户分组…'
                        : `使用 ${currentEngine.label} 搜索，或直接输入网址…`
                  }
                  value={query}
                  onFocus={() => setSearchFocused(true)}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setSearchFocused(true)
                  }}
                  onKeyDown={handleSearchKeyDown}
                  spellCheck={false}
                />

                {searchMode === 'web' ? (
                  <select
                    className="wb-multab__engine"
                    aria-label="搜索引擎"
                    value={currentEngine.id}
                    onChange={(e) => onChangeSearchEngine(e.target.value as MultabSearchEngineId)}
                  >
                    {SEARCH_ENGINES.map((engine) => (
                      <option key={engine.id} value={engine.id}>
                        {engine.label}
                      </option>
                    ))}
                  </select>
                ) : null}

                <div className="wb-multab__search-switch" role="group" aria-label="搜索范围">
                  <button
                    type="button"
                    className={searchMode === 'bookmarks' ? 'is-active' : ''}
                    onClick={() => setSearchMode('bookmarks')}
                  >
                    {selectedCategoryId === 'home' ? '搜书签' : '搜当前分组'}
                  </button>
                  <button
                    type="button"
                    className={searchMode === 'web' ? 'is-active' : ''}
                    onClick={() => setSearchMode('web')}
                  >
                    搜网页
                  </button>
                </div>

                <button type="submit" className="wb-multab__search-go" aria-label="前往" disabled={!query.trim()}>
                  <ArrowRight size={15} strokeWidth={1.9} />
                </button>
              </form>

              {dropdownVisible ? (
                <div className="wb-multab__search-pop" role="listbox" aria-label="匹配的 Multab 书签">
                  <div className="wb-multab__search-pop-label">匹配的书签（↑↓ 选择，Enter 直达）</div>
                  {matchedBookmarks.map((item, idx) => {
                    const catName = categoryById.get(item.categoryId)?.name
                    const selected = idx === activeMatchIdx
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`wb-multab__search-item ${selected ? 'wb-multab__search-item--active' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveMatchIdx(idx)}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey) {
                            onOpenInNewTab(item.url)
                            setSearchFocused(false)
                          } else {
                            onNavigate(item.url)
                          }
                        }}
                      >
                        <RecentItemBadge item={item} />
                        <span className="wb-multab__search-item-title">{item.title}</span>
                        <span className="wb-multab__search-item-host">{getDisplayHost(item.url)}</span>
                        {catName ? <span className="wb-multab__search-item-cat">{catName}</span> : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {!focusMode ? (
            <>
              {/* Home Widgets Row */}
              {selectedCategoryId === 'home' && !widgetsHidden ? (
                <div className="wb-multab__widgets" data-multab-widgets="true">
                  {/* Widget 1: Client / Group Quick Switch */}
                  <section className="wb-multab__widget">
                    <div className="wb-multab__widget-head">
                      <span className="wb-multab__widget-title">
                        <BriefcaseBusiness size={14} /> 客户分组
                      </span>
                      <button
                        type="button"
                        className="wb-multab__widget-btn"
                        title="新建分组"
                        onClick={() => {
                          setNewGroupName('')
                          setNewGroupPopOpen(true)
                        }}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <div className="wb-multab__widget-groups">
                      {orderedCategories.slice(0, 4).map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          className="wb-multab__mini-group"
                          data-multab-widget-group={cat.id}
                          onClick={() => setSelectedCategoryId(cat.id)}
                        >
                          <div className="wb-multab__mini-group-top">
                            <MultabCategoryIcon name={cat.icon} size={15} />
                            <ChevronRight size={13} />
                          </div>
                          <div>
                            <div className="wb-multab__mini-group-name">{cat.name}</div>
                            <div className="wb-multab__mini-group-count">
                              {categoryCounts.get(cat.id) ?? 0} 个书签
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Widget 2: Recent Bookmarks */}
                  <section className="wb-multab__widget">
                    <div className="wb-multab__widget-head">
                      <span className="wb-multab__widget-title">
                        <Clock size={14} /> 最近收藏
                      </span>
                      <button
                        type="button"
                        className="wb-multab__widget-btn"
                        title="打开书签库"
                        onClick={() => setLibraryOpen(true)}
                      >
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                    <div className="wb-multab__recent-list">
                      {recentItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="wb-multab__recent-row"
                          onClick={() => onNavigate(item.url)}
                        >
                          <RecentItemBadge item={item} />
                          <span className="wb-multab__recent-title">{item.title}</span>
                          <span className="wb-multab__recent-host">{getDisplayHost(item.url)}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Widget 3: Local Quick Note */}
                  <section className="wb-multab__widget">
                    <div className="wb-multab__widget-head">
                      <span className="wb-multab__widget-title">
                        <NotebookPen size={14} /> 速记
                      </span>
                      <span className="wb-multab__widget-hint">本地保存</span>
                    </div>
                    <textarea
                      className="wb-multab__notes"
                      aria-label="Multab 速记"
                      placeholder="记录当前客户需求、评审时间或临时链接…"
                      value={notesDraft}
                      onChange={(e) => handleNotesChange(e.target.value)}
                      onBlur={() => commitNotes(notesDraft)}
                    />
                  </section>
                </div>
              ) : null}

              {/* Category Header Banner when inside a group */}
              {activeCategory ? (
                <div className="wb-multab__group-banner">
                  {renamingCatId === activeCategory.id ? (
                    <form
                      className="wb-multab__cat-rename"
                      onSubmit={async (e) => {
                        e.preventDefault()
                        if (!renameCatName.trim()) return
                        await onSaveCategory({
                          id: activeCategory.id,
                          name: renameCatName.trim(),
                          icon: activeCategory.icon,
                        })
                        setRenamingCatId(null)
                      }}
                    >
                      <input
                        autoFocus
                        value={renameCatName}
                        onChange={(e) => setRenameCatName(e.target.value)}
                        aria-label="重命名分类"
                      />
                      <button type="submit">保存</button>
                      <button type="button" onClick={() => setRenamingCatId(null)}>
                        取消
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="wb-multab__group-banner-left">
                        <span className="wb-multab__group-badge">
                          <MultabCategoryIcon name={activeCategory.icon} size={18} />
                        </span>
                        <div>
                          <div className="wb-multab__group-name">{activeCategory.name}</div>
                          <div className="wb-multab__group-meta">
                            {visibleItems.length} 个书签 · 拖动可排序，或拖到左侧分组归类
                          </div>
                        </div>
                      </div>
                      <div className="wb-multab__cat-ops">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingCatId(activeCategory.id)
                            setRenameCatName(activeCategory.name)
                          }}
                        >
                          <Pencil size={12} /> 重命名
                        </button>
                        {multabState.categories.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => void onDeleteCategory(activeCategory.id)}
                          >
                            <Trash2 size={12} /> 删除分组
                          </button>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="wb-multab__section-head">
                  <span className="wb-multab__section-title">
                    <Pin size={13} /> 置顶书签
                  </span>
                  <button
                    type="button"
                    className="wb-multab__section-action"
                    onClick={() => setLibraryOpen(true)}
                  >
                    管理全部 {multabState.items.length} 个书签
                  </button>
                </div>
              )}

              {/* Site Grid (iTab Rounded-Square Icons OR Detailed Cards) */}
              <div
                className={`wb-multab__grid ${
                  viewMode === 'icons' ? 'wb-multab__grid--icons' : 'wb-multab__grid--cards'
                }`}
              >
                {visibleItems.map((item) => (
                  <MultabEntry
                    key={item.id}
                    item={item}
                    viewMode={viewMode}
                    isDragging={draggingId === item.id}
                    onOpenCurrent={(url) => {
                      if (!suppressClickRef.current) onNavigate(url)
                    }}
                    onOpenNewTab={(url) => {
                      if (!suppressClickRef.current) onOpenInNewTab(url)
                    }}
                    onEdit={onEditItem}
                    onDelete={onDeleteItem}
                    onContextMenu={(e, targetItem) => {
                      const otherCatCount = multabState.categories.filter((c) => c.id !== targetItem.categoryId).length
                      setContextMenu({
                        ...clampMenuPos(e.clientX, e.clientY, 240 + otherCatCount * 28),
                        kind: 'item',
                        item: targetItem,
                      })
                    }}
                    onPointerStart={handleCardPointerStart}
                    registerRef={(id, node) => {
                      if (node) cardRefs.current.set(id, node)
                      else cardRefs.current.delete(id)
                    }}
                  />
                ))}

                {viewMode === 'icons' ? (
                  <button
                    type="button"
                    className="wb-multab__tile wb-multab__tile--add"
                    onClick={() =>
                      onOpenAddItem(
                        selectedCategoryId === 'home' ? multabState.categories[0]?.id : selectedCategoryId,
                      )
                    }
                  >
                    <span className="wb-multab__tile-box wb-multab__tile-box--add">
                      <Plus size={20} strokeWidth={1.7} />
                    </span>
                    <span className="wb-multab__tile-title">添加网址</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="wb-multab__card wb-multab__card--add"
                    onClick={() =>
                      onOpenAddItem(
                        selectedCategoryId === 'home' ? multabState.categories[0]?.id : selectedCategoryId,
                      )
                    }
                  >
                    <span className="wb-multab__card-add-icon">
                      <Plus size={16} strokeWidth={1.8} />
                    </span>
                    <span className="wb-multab__card-meta">
                      <span className="wb-multab__card-title">添加网址</span>
                      <span className="wb-multab__card-host">加入当前工作台</span>
                    </span>
                  </button>
                )}
              </div>

              {/* Compact Frosted Workspace Switcher Strip */}
              <footer className="wb-multab__ws-footer">
                <span className="wb-multab__ws-label">工作区</span>
                <div className="wb-multab__ws-pills">
                  {workspaces.slice(0, 6).map((item) => {
                    const active = item.id === workspace.id
                    const tabCount = tabCountsByWorkspace[item.id] ?? 0
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={active}
                        aria-current={active ? true : undefined}
                        style={{ '--ws-accent': item.seedColor } as CSSProperties}
                        className={`wb-multab__ws-pill ${active ? 'wb-multab__ws-pill--active' : ''}`}
                        onClick={() => onSwitchWorkspace(item.id)}
                        title={`${item.name}（${tabCount} 个标签）`}
                      >
                        <WorkspaceGlyph value={item.icon} size={13} />
                        <span>{item.name}</span>
                        <span className="wb-multab__ws-count">{tabCount}</span>
                      </button>
                    )
                  })}
                  <button type="button" className="wb-multab__ws-add" onClick={onCreateWorkspace}>
                    <Plus size={13} /> 新建
                  </button>
                </div>
              </footer>
            </>
          ) : null}
        </div>
      </div>

      {/* Screen 3: Anchored New Group Popover */}
      {newGroupPopOpen ? (
        <div
          className="wb-multab__new-group-pop"
          role="dialog"
          aria-label="新建分组"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="wb-multab__pop-head">
            <span>
              <FolderPlus size={15} /> 新建分组
            </span>
            <button
              type="button"
              className="wb-multab__pop-close"
              aria-label="关闭新建分组"
              onClick={() => setNewGroupPopOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <form onSubmit={(e) => void handleCreateGroupSubmit(e)}>
            <label className="wb-multab__pop-field">
              <span>分组名称</span>
              <input
                autoFocus
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="例如：北岸品牌 / 客户工作台"
              />
            </label>
            <div className="wb-multab__pop-field">
              <span>图标选择</span>
              <div className="wb-multab__icon-picker">
                {multabCategoryPickerIcons.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    title={label}
                    aria-label={`图标 ${label}`}
                    className={newGroupIcon === id ? 'is-selected' : ''}
                    onClick={() => setNewGroupIcon(id)}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                  </button>
                ))}
              </div>
            </div>
            <div className="wb-multab__pop-actions">
              <button type="button" className="wb-multab__pop-cancel" onClick={() => setNewGroupPopOpen(false)}>
                取消
              </button>
              <button type="submit" className="wb-multab__pop-submit" disabled={!newGroupName.trim()}>
                创建分组
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Bookmark Library Modal */}
      {libraryOpen ? (
        <div
          className="wb-multab__library-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLibraryOpen(false)
          }}
        >
          <div className="wb-multab__library-sheet" role="dialog" aria-label="书签库">
            <div className="wb-multab__pop-head">
              <span>
                <Bookmark size={15} /> 书签库 · 共 {multabState.items.length} 项
              </span>
              <button
                type="button"
                className="wb-multab__pop-close"
                aria-label="关闭书签库"
                onClick={() => setLibraryOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="wb-multab__library-tools">
              <input
                autoFocus
                value={libraryFilter}
                onChange={(e) => setLibraryFilter(e.target.value)}
                placeholder="筛选书签名称、网址或分组…"
              />
              <button
                type="button"
                className="wb-multab__pop-submit"
                onClick={() => {
                  setLibraryOpen(false)
                  onOpenAddItem(selectedCategoryId === 'home' ? multabState.categories[0]?.id : selectedCategoryId)
                }}
              >
                + 添加网址
              </button>
            </div>
            <div className="wb-multab__library-grid">
              {libraryItems.map((item) => {
                const catName = categoryById.get(item.categoryId)?.name ?? ''
                return (
                  <div
                    key={item.id}
                    className="wb-multab__library-row"
                    onClick={() => onNavigate(item.url)}
                  >
                    <RecentItemBadge item={item} />
                    <div className="wb-multab__library-meta">
                      <div>{item.title}</div>
                      <span>
                        {catName} · {getDisplayHost(item.url)}
                      </span>
                    </div>
                    <button
                      type="button"
                      title={item.pinned ? '取消置顶到主页' : '置顶到主页'}
                      onClick={(e) => {
                        e.stopPropagation()
                        void onTogglePinItem(item)
                      }}
                    >
                      {item.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                    <button
                      type="button"
                      title="编辑"
                      onClick={(e) => {
                        e.stopPropagation()
                        setLibraryOpen(false)
                        onEditItem(item)
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* Custom In-Page Right-Click Context Menu */}
      {contextMenu ? (
        <div
          className="wb-multab__ctx-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.kind === 'item' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const targetUrl = contextMenu.item.url
                  setContextMenu(null)
                  onNavigate(targetUrl)
                }}
              >
                <ArrowRight size={13} /> 当前标签页打开
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const targetUrl = contextMenu.item.url
                  setContextMenu(null)
                  onOpenInNewTab(targetUrl)
                }}
              >
                <ExternalLink size={13} /> 新标签页打开
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const target = contextMenu.item
                  setContextMenu(null)
                  void onTogglePinItem(target).then(() => {
                    showToast(target.pinned ? '已从主页取消置顶' : '已置顶到主页')
                  })
                }}
              >
                {contextMenu.item.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                <span>{contextMenu.item.pinned ? '取消置顶主页' : '置顶到主页'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void navigator.clipboard?.writeText(contextMenu.item.url)
                  setContextMenu(null)
                  showToast('已复制网址')
                }}
              >
                <Copy size={13} /> 复制网址
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const target = contextMenu.item
                  setContextMenu(null)
                  onEditItem(target)
                }}
              >
                <Pencil size={13} /> 编辑书签…
              </button>

              {multabState.categories.some((c) => c.id !== contextMenu.item.categoryId) ? (
                <>
                  <div className="wb-multab__ctx-sep" />
                  <div className="wb-multab__ctx-heading">移动到分组</div>
                  {multabState.categories
                    .filter((c) => c.id !== contextMenu.item.categoryId)
                    .map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const targetItem = contextMenu.item
                          setContextMenu(null)
                          void onMoveItemToCategory(targetItem, cat.id).then(() => {
                            showToast(`已移动到「${cat.name}」`)
                          })
                        }}
                      >
                        <MultabCategoryIcon name={cat.icon} size={13} />
                        <span>{cat.name}</span>
                      </button>
                    ))}
                </>
              ) : null}

              <div className="wb-multab__ctx-sep" />
              <button
                type="button"
                role="menuitem"
                className="wb-multab__ctx-danger"
                onClick={() => {
                  const targetId = contextMenu.item.id
                  setContextMenu(null)
                  onDeleteItem(targetId)
                }}
              >
                <Trash2 size={13} /> 移除收藏
              </button>
            </>
          ) : null}

          {contextMenu.kind === 'category' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const catId = contextMenu.category.id
                  setContextMenu(null)
                  onOpenAddItem(catId)
                }}
              >
                <Plus size={13} /> 在此分组添加网址
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const cat = contextMenu.category
                  setContextMenu(null)
                  setSelectedCategoryId(cat.id)
                  setRenamingCatId(cat.id)
                  setRenameCatName(cat.name)
                }}
              >
                <Pencil size={13} /> 重命名分组
              </button>
              {multabState.categories.length > 1 ? (
                <button
                  type="button"
                  role="menuitem"
                  className="wb-multab__ctx-danger"
                  onClick={() => {
                    const catId = contextMenu.category.id
                    setContextMenu(null)
                    void onDeleteCategory(catId)
                  }}
                >
                  <Trash2 size={13} /> 删除分组
                </button>
              ) : null}
            </>
          ) : null}

          {contextMenu.kind === 'canvas' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null)
                  onOpenAddItem(selectedCategoryId === 'home' ? multabState.categories[0]?.id : selectedCategoryId)
                }}
              >
                <Plus size={13} /> 添加网址…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null)
                  setNewGroupName('')
                  setNewGroupPopOpen(true)
                }}
              >
                <FolderPlus size={13} /> 新建分组
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null)
                  onChangeViewMode(viewMode === 'icons' ? 'cards' : 'icons')
                }}
              >
                {viewMode === 'icons' ? <List size={13} /> : <LayoutGrid size={13} />}
                <span>{viewMode === 'icons' ? '切换为详细卡片视图' : '切换为图标网格视图'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null)
                  onUpdatePrefs({ wallpaperEnabled: !wallpaperEnabled })
                }}
              >
                <Image size={13} />
                <span>{wallpaperEnabled ? '切换为纯色简洁背景' : '开启夜港城市壁纸'}</span>
              </button>
              <div className="wb-multab__ctx-sep" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null)
                  onOpenSyncDialog()
                }}
              >
                <RefreshCw size={13} /> 6 位码同步 / 导入
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {toast ? <div className="wb-multab__toast">{toast}</div> : null}
    </section>
  )
})
