import {
  type CSSProperties,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { NEW_TAB_URL } from '@wb/contracts'
import type {
  AgentMessage,
  BrowserWindowSnapshot,
  MultabItem,
  MultabPrefsPatch,
  MultabSearchEngineId,
  MultabState,
  MultabViewMode,
  SaveMultabCategoryInput,
  SkillDefinition,
  Tab,
  Workspace,
} from '@wb/contracts'
import { Button, IconButton, ThemeProvider } from '@wb/ui-kit'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Camera,
  Code2,
  Compass,
  ExternalLink,
  Globe,
  Languages,
  Moon,
  Network,
  PanelRight,
  Pin,
  Plus,
  Puzzle,
  RotateCw,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Snowflake,
  TerminalSquare,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { AddressBar } from './components/AddressBar.js'
import {
  CaptureCropOverlay,
  CaptureDialog,
  formatRecDuration,
} from './components/CaptureDialog.js'
import type { MultabItemDraft } from './components/MultabItemDialog.js'
import { NewTabPage } from './components/NewTabPage.js'
import { WorkspaceGlyph } from './components/WorkspaceGlyph.js'
import brandIcon from '../../../build/icon.svg'

const A2UISurface = lazy(() =>
  import('@wb/ui-kit').then((m) => ({ default: m.A2UISurface })),
)
const AiHubDialog = lazy(() =>
  import('./components/AiHubDialog.js').then((m) => ({ default: m.AiHubDialog })),
)
const ExtensionsDialog = lazy(() =>
  import('./components/ExtensionsDialog.js').then((m) => ({ default: m.ExtensionsDialog })),
)
const MultabItemDialog = lazy(() =>
  import('./components/MultabItemDialog.js').then((m) => ({ default: m.MultabItemDialog })),
)
const MultabSyncDialog = lazy(() =>
  import('./components/MultabSyncDialog.js').then((m) => ({ default: m.MultabSyncDialog })),
)
const ProxyManagerDialog = lazy(() =>
  import('./components/ProxyManagerDialog.js').then((m) => ({ default: m.ProxyManagerDialog })),
)
const SecurityGuardDialog = lazy(() =>
  import('./components/SecurityGuardDialog.js').then((m) => ({
    default: m.SecurityGuardDialog,
  })),
)
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog.js').then((m) => ({ default: m.SettingsDialog })),
)
const TranslateDialog = lazy(() =>
  import('./components/TranslateDialog.js').then((m) => ({ default: m.TranslateDialog })),
)
const WorkspaceEditorDialog = lazy(() =>
  import('./components/WorkspaceEditorDialog.js').then((m) => ({
    default: m.WorkspaceEditorDialog,
  })),
)

interface TabDragSession {
  workspaceId: string
  tabId: string
  initialIndex: number
  currentIndex: number
  pointerStartX: number
  layoutAnchorX: number
  grabOffsetFromCenter: number
  minOffset: number
  maxOffset: number
  active: boolean
  minEpoch: number
  orderedIds: string[]
}

interface TabDragVisualState {
  tabId: string
  offsetX: number
  orderedIds: string[]
}

function TabSymbol({ tab }: { tab: Tab }) {
  const [faviconFailedUrl, setFaviconFailedUrl] = useState<string | null>(null)

  if (tab.loading) {
    return <span className="wb-tab__spinner" />
  }
  if (tab.url === NEW_TAB_URL) {
    return <Compass size={13} strokeWidth={1.75} />
  }
  if (tab.faviconUrl && faviconFailedUrl !== tab.faviconUrl) {
    return (
      <img
        className="wb-tab__favicon"
        src={tab.faviconUrl}
        alt=""
        onError={() => setFaviconFailedUrl(tab.faviconUrl ?? null)}
      />
    )
  }
  return <Globe size={13} strokeWidth={1.75} />
}

export function App() {
  const [snapshot, setSnapshot] = useState<BrowserWindowSnapshot | null>(null)
  const [multabState, setMultabState] = useState<MultabState>({
    schemaVersion: 1,
    searchEngine: 'bing',
    categories: [],
    items: [],
  })
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false)
  const [wsDialogOpen, setWsDialogOpen] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false)
  const [securityDialogOpen, setSecurityDialogOpen] = useState(false)
  const [extDialogOpen, setExtDialogOpen] = useState(false)
  const [aiHubOpen, setAiHubOpen] = useState(false)
  const [captureDialogOpen, setCaptureDialogOpen] = useState(false)
  const [cropImageDataUrl, setCropImageDataUrl] = useState<string | null>(null)
  const [translateDialogOpen, setTranslateDialogOpen] = useState(false)
  const [translatedTabIds, setTranslatedTabIds] = useState<Record<string, boolean>>({})
  const [chromeToast, setChromeToast] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [multabItemDialogOpen, setMultabItemDialogOpen] = useState(false)
  const [editingMultabItem, setEditingMultabItem] = useState<MultabItem | null>(null)
  const [multabItemDraft, setMultabItemDraft] = useState<MultabItemDraft | null>(null)
  const [multabDefaultCatId, setMultabDefaultCatId] = useState<string | undefined>(undefined)
  const [multabDialogFromStar, setMultabDialogFromStar] = useState(false)
  const [multabSyncOpen, setMultabSyncOpen] = useState(false)

  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([])
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [chatPrompt, setChatPrompt] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)
  const [dragState, setDragState] = useState<TabDragVisualState | null>(null)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const tabbarRef = useRef<HTMLDivElement | null>(null)
  const tabElementsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const dragSessionRef = useRef<TabDragSession | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const renderEpochRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const recordChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    renderEpochRef.current += 1
  })

  useEffect(() => {
    void window.browserApi.getState().then(setSnapshot)
    void window.browserApi.getMultabState().then(setMultabState)
    const offSnapshot = window.browserApi.onStateUpdated(setSnapshot)
    const offMultab = window.browserApi.onMultabUpdated(setMultabState)
    return () => {
      offSnapshot()
      offMultab()
    }
  }, [])

  const activeWorkspace = useMemo(() => {
    if (!snapshot) return null
    return (
      snapshot.workspaces.find((w) => w.id === snapshot.activeWorkspaceId) ??
      snapshot.workspaces[0] ??
      null
    )
  }, [snapshot])

  const workspaceTabs: Tab[] = useMemo(() => {
    if (!snapshot || !activeWorkspace) return []
    return snapshot.tabsByWorkspace[activeWorkspace.id] ?? []
  }, [snapshot, activeWorkspace])

  const activeTab: Tab | null = useMemo(() => {
    if (!activeWorkspace || workspaceTabs.length === 0) return null
    return (
      (snapshot?.activeTabId ? workspaceTabs.find((t) => t.id === snapshot.activeTabId) : undefined) ??
      workspaceTabs.find((t) => t.state === 'active') ??
      workspaceTabs.find((t) => t.id === activeWorkspace.activeTabId) ??
      workspaceTabs[0] ??
      null
    )
  }, [activeWorkspace, workspaceTabs, snapshot?.activeTabId])

  useEffect(() => {
    if (!activeWorkspace || !aiSidebarOpen) return
    void window.browserApi.getAgentMessages(activeWorkspace.id).then(setAgentMessages)
    void window.browserApi.listSkills(activeWorkspace.id).then(setSkills)
  }, [activeWorkspace?.id, snapshot?.aiMessageSeq, aiSidebarOpen])

  const handleNavigate = useCallback(
    (input: string): void => {
      if (!activeWorkspace || !activeTab || !input.trim()) return
      void window.browserApi.navigateTab(activeWorkspace.id, activeTab.id, input)
    },
    [activeWorkspace?.id, activeTab?.id],
  )

  const handleSwitchWorkspace = useCallback((id: string): void => {
    void window.browserApi.switchWorkspace(id)
  }, [])

  const handleCreateWorkspace = useCallback((): void => {
    setEditingWorkspace(null)
    setWsDialogOpen(true)
  }, [])

  const tabCountsSignature = useMemo(() => {
    if (!snapshot) return ''
    return snapshot.workspaces
      .slice(0, 6)
      .map((w) => `${w.id}:${(snapshot.tabsByWorkspace[w.id] ?? []).length}`)
      .join('|')
  }, [snapshot])

  const tabCountsByWorkspace = useMemo(() => {
    const counts: Record<string, number> = {}
    if (!snapshot) return counts
    for (const w of snapshot.workspaces.slice(0, 6)) {
      counts[w.id] = (snapshot.tabsByWorkspace[w.id] ?? []).length
    }
    return counts
    // Only recompute when workspace list or tab counts change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabCountsSignature])

  const handleOpenInNewTab = useCallback(
    (url: string): void => {
      if (!activeWorkspace) return
      void window.browserApi.createTab(activeWorkspace.id, url, false)
    },
    [activeWorkspace?.id],
  )

  const handleOpenMultabAddItem = useCallback((categoryId?: string): void => {
    setEditingMultabItem(null)
    setMultabItemDraft(null)
    setMultabDefaultCatId(categoryId)
    setMultabDialogFromStar(false)
    setMultabItemDialogOpen(true)
  }, [])

  const handleEditMultabItem = useCallback((item: MultabItem): void => {
    setEditingMultabItem(item)
    setMultabItemDraft(null)
    setMultabDialogFromStar(false)
    setMultabItemDialogOpen(true)
  }, [])

  const handleDeleteMultabItem = useCallback((itemId: string): void => {
    void window.browserApi.deleteMultabItem(itemId)
  }, [])

  const handleReorderMultabItems = useCallback((categoryId: string, orderedIds: string[]): void => {
    void window.browserApi.reorderMultabItems(categoryId, orderedIds)
  }, [])

  const handleMoveMultabItem = useCallback(async (item: MultabItem, targetCategoryId: string): Promise<void> => {
    await window.browserApi.saveMultabItem({
      id: item.id,
      categoryId: targetCategoryId,
      title: item.title,
      url: item.url,
      iconUrl: item.iconUrl,
      iconBg: item.iconBg,
    })
  }, [])

  const handleToggleMultabPin = useCallback(async (item: MultabItem): Promise<void> => {
    await window.browserApi.saveMultabItem({
      id: item.id,
      categoryId: item.categoryId,
      title: item.title,
      url: item.url,
      iconUrl: item.iconUrl,
      iconBg: item.iconBg,
      pinned: !item.pinned,
    })
  }, [])

  const handleReorderMultabCategories = useCallback((orderedIds: string[]): void => {
    void window.browserApi.reorderMultabCategories(orderedIds)
  }, [])

  const handleSaveMultabCategory = useCallback((input: SaveMultabCategoryInput): Promise<MultabState> => {
    return window.browserApi.saveMultabCategory(input)
  }, [])

  const handleDeleteMultabCategory = useCallback(async (categoryId: string): Promise<void> => {
    await window.browserApi.deleteMultabCategory(categoryId)
  }, [])

  const handleChangeMultabEngine = useCallback((engine: MultabSearchEngineId): void => {
    void window.browserApi.updateMultabPrefs({ searchEngine: engine })
  }, [])

  const handleChangeMultabViewMode = useCallback((viewMode: MultabViewMode): void => {
    void window.browserApi.updateMultabPrefs({ viewMode })
  }, [])

  const handleUpdateMultabPrefs = useCallback((patch: MultabPrefsPatch): void => {
    void window.browserApi.updateMultabPrefs(patch)
  }, [])

  const handleOpenMultabSync = useCallback((): void => {
    setMultabSyncOpen(true)
  }, [])

  const syncViewportBounds = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    void window.browserApi.setViewportBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    syncViewportBounds()
    const observer = new ResizeObserver(() => syncViewportBounds())
    observer.observe(el)
    window.addEventListener('resize', syncViewportBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncViewportBounds)
    }
  }, [syncViewportBounds, aiSidebarOpen, snapshot?.settings.themeId])

  useEffect(() => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
    dragSessionRef.current = null
    setDragState(null)
  }, [activeWorkspace?.id])

  useEffect(() => () => {
    dragCleanupRef.current?.()
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current)
    recordStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  const showChromeToast = useCallback((message: string): void => {
    setChromeToast(message)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setChromeToast(null), 2600)
  }, [])

  const displayedTabs: Tab[] = useMemo(() => {
    if (!dragState || dragState.orderedIds.length !== workspaceTabs.length) {
      return workspaceTabs
    }
    const byId = new Map(workspaceTabs.map((t) => [t.id, t]))
    const ordered: Tab[] = []
    for (const id of dragState.orderedIds) {
      const match = byId.get(id)
      if (!match) return workspaceTabs
      ordered.push(match)
    }
    return ordered
  }, [workspaceTabs, dragState])

  const startTabDrag = (e: React.PointerEvent<HTMLDivElement>, tab: Tab, isTabActive: boolean): void => {
    if (e.button !== 0 || !activeWorkspace) return
    if ((e.target as HTMLElement).closest('button')) return

    if (!isTabActive) {
      void window.browserApi.activateTab(activeWorkspace.id, tab.id)
    }

    if (workspaceTabs.length < 2) return

    const el = tabElementsRef.current.get(tab.id)
    const tabbarEl = tabbarRef.current
    if (!el || !tabbarEl) return

    dragCleanupRef.current?.()

    const orderedIds = workspaceTabs.map((t) => t.id)
    const initialIndex = orderedIds.indexOf(tab.id)
    if (initialIndex < 0) return

    const tabRect = el.getBoundingClientRect()
    const firstEl = tabElementsRef.current.get(orderedIds[0]!)
    const lastEl = tabElementsRef.current.get(orderedIds[orderedIds.length - 1]!)
    const minLeft = firstEl ? firstEl.getBoundingClientRect().left : tabbarEl.getBoundingClientRect().left
    const maxRight = lastEl ? lastEl.getBoundingClientRect().right : tabbarEl.getBoundingClientRect().right
    const gap = Number.parseFloat(getComputedStyle(tabbarEl).columnGap || '2') || 2

    const session: TabDragSession = {
      workspaceId: activeWorkspace.id,
      tabId: tab.id,
      initialIndex,
      currentIndex: initialIndex,
      pointerStartX: e.clientX,
      layoutAnchorX: e.clientX,
      grabOffsetFromCenter: e.clientX - (tabRect.left + tabRect.width / 2),
      minOffset: minLeft - tabRect.left,
      maxOffset: maxRight - tabRect.right,
      active: false,
      minEpoch: renderEpochRef.current,
      orderedIds,
    }
    dragSessionRef.current = session

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const current = dragSessionRef.current
      if (!current) return

      if (!current.active && Math.abs(moveEvent.clientX - current.pointerStartX) < 5) {
        return
      }
      current.active = true

      if (renderEpochRef.current >= current.minEpoch) {
        const visualCenter = moveEvent.clientX - current.grabOffsetFromCenter
        let swapped = false

        if (current.currentIndex > 0) {
          const prevId = current.orderedIds[current.currentIndex - 1]!
          const prevRect = tabElementsRef.current.get(prevId)?.getBoundingClientRect()
          if (prevRect && visualCenter < prevRect.left + prevRect.width / 2) {
            const nextOrder = [...current.orderedIds]
            ;[nextOrder[current.currentIndex - 1], nextOrder[current.currentIndex]] = [
              nextOrder[current.currentIndex]!,
              nextOrder[current.currentIndex - 1]!,
            ]
            const step = prevRect.width + gap
            current.orderedIds = nextOrder
            current.currentIndex -= 1
            current.layoutAnchorX -= step
            current.minOffset += step
            current.maxOffset += step
            current.minEpoch = renderEpochRef.current + 1
            swapped = true
          }
        }

        if (!swapped && current.currentIndex < current.orderedIds.length - 1) {
          const nextId = current.orderedIds[current.currentIndex + 1]!
          const nextRect = tabElementsRef.current.get(nextId)?.getBoundingClientRect()
          if (nextRect && visualCenter > nextRect.left + nextRect.width / 2) {
            const nextOrder = [...current.orderedIds]
            ;[nextOrder[current.currentIndex], nextOrder[current.currentIndex + 1]] = [
              nextOrder[current.currentIndex + 1]!,
              nextOrder[current.currentIndex]!,
            ]
            const step = nextRect.width + gap
            current.orderedIds = nextOrder
            current.currentIndex += 1
            current.layoutAnchorX += step
            current.minOffset -= step
            current.maxOffset -= step
            current.minEpoch = renderEpochRef.current + 1
          }
        }
      }

      const rawOffset = moveEvent.clientX - current.layoutAnchorX
      const clampedOffset = Math.max(current.minOffset - 12, Math.min(current.maxOffset + 12, rawOffset))
      setDragState({
        tabId: current.tabId,
        offsetX: clampedOffset,
        orderedIds: [...current.orderedIds],
      })
    }

    const finishDrag = (): void => {
      cleanup()
      const current = dragSessionRef.current
      dragSessionRef.current = null
      if (!current || !current.active || current.currentIndex === current.initialIndex) {
        setDragState(null)
        return
      }
      setDragState({
        tabId: current.tabId,
        offsetX: 0,
        orderedIds: [...current.orderedIds],
      })
      void window.browserApi
        .reorderTab(current.workspaceId, current.tabId, current.currentIndex)
        .finally(() => setDragState(null))
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
      window.removeEventListener('blur', finishDrag)
      dragCleanupRef.current = null
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    window.addEventListener('blur', finishDrag)
  }

  const currentTabBookmark = useMemo(() => {
    const rawUrl = activeTab?.url
    if (!rawUrl || rawUrl === NEW_TAB_URL || !/^https?:\/\//i.test(rawUrl)) return null
    let normalized = rawUrl
    try {
      normalized = new URL(rawUrl).toString()
    } catch {
      // Keep rawUrl
    }
    return multabState.items.find((item) => {
      try {
        return new URL(item.url).toString() === normalized
      } catch {
        return item.url === rawUrl
      }
    }) ?? null
  }, [activeTab?.url, multabState.items])

  const openBookmarkModal = useCallback((): void => {
    if (!activeTab || activeTab.url === NEW_TAB_URL || !/^https?:\/\//i.test(activeTab.url)) return
    if (currentTabBookmark) {
      setEditingMultabItem(currentTabBookmark)
      setMultabItemDraft(null)
    } else {
      setEditingMultabItem(null)
      setMultabItemDraft({
        title: activeTab.title || activeTab.url,
        url: activeTab.url,
        iconUrl: activeTab.faviconUrl,
        categoryId: multabState.categories[0]?.id,
      })
    }
    setMultabDialogFromStar(true)
    setMultabItemDialogOpen(true)
  }, [activeTab, currentTabBookmark, multabState.categories])

  useEffect(() => {
    return window.browserApi.onToggleBookmark(() => {
      openBookmarkModal()
    })
  }, [openBookmarkModal])

  const anyModalOpen =
    wsDialogOpen ||
    settingsOpen ||
    proxyDialogOpen ||
    securityDialogOpen ||
    extDialogOpen ||
    aiHubOpen ||
    captureDialogOpen ||
    Boolean(cropImageDataUrl) ||
    translateDialogOpen ||
    multabItemDialogOpen ||
    multabSyncOpen
  useEffect(() => {
    void window.browserApi.setOverlayOpen(anyModalOpen)
  }, [anyModalOpen])

  const captureCurrentPageDataUrl = async (): Promise<string> => {
    if (!activeWorkspace || !activeTab) {
      throw new Error('没有可截图的活动标签页')
    }
    setCaptureDialogOpen(false)
    await window.browserApi.setOverlayOpen(false)
    await new Promise((resolve) => window.setTimeout(resolve, 130))
    const captured = await window.browserApi.capturePage(activeWorkspace.id, activeTab.id)
    return captured.dataUrl
  }

  const handleCaptureFullPage = async (): Promise<void> => {
    const dataUrl = await captureCurrentPageDataUrl()
    await window.browserApi.copyCapturedImage(dataUrl)
    showChromeToast('已复制当前页面整页截图到剪贴板')
  }

  const handleStartRegionCapture = async (): Promise<void> => {
    const dataUrl = await captureCurrentPageDataUrl()
    setCropImageDataUrl(dataUrl)
  }

  const cleanupRecordingStreams = (): void => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    recordStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    recordStreamRef.current = null
    micStreamRef.current = null
    recorderRef.current = null
    setRecording(false)
    setRecordingSeconds(0)
  }

  const handleStartRecording = async (sourceId: string, includeMic: boolean): Promise<void> => {
    if (recording) return
    const desktopStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      } as unknown as MediaTrackConstraints,
    })
    recordStreamRef.current = desktopStream

    const tracks: MediaStreamTrack[] = [...desktopStream.getVideoTracks()]
    if (includeMic) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        micStreamRef.current = micStream
        tracks.push(...micStream.getAudioTracks())
      } catch {
        showChromeToast('未授予麦克风权限，将以纯画面继续录屏')
      }
    }

    const combined = new MediaStream(tracks)
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
    const recorder = new MediaRecorder(combined, { mimeType })
    recordChunksRef.current = []

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        recordChunksRef.current.push(ev.data)
      }
    }

    recorder.onstop = () => {
      const chunks = [...recordChunksRef.current]
      recordChunksRef.current = []
      cleanupRecordingStreams()
      if (chunks.length === 0) return
      const blob = new Blob(chunks, { type: mimeType })
      void blob.arrayBuffer().then(async (buffer) => {
        const savedPath = await window.browserApi.saveRecordedVideo(new Uint8Array(buffer))
        if (savedPath) {
          showChromeToast('录屏视频已保存')
        }
      })
    }

    desktopStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (recorder.state !== 'inactive') {
        recorder.stop()
      }
    })

    recorderRef.current = recorder
    recorder.start(1000)
    setRecording(true)
    setRecordingSeconds(0)
    recordTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1)
    }, 1000)
    showChromeToast('已开始录屏，点击搜索栏右侧红色按钮可随时结束')
  }

  const handleStopRecording = async (): Promise<void> => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') {
      cleanupRecordingStreams()
      return
    }
    rec.stop()
  }

  if (!snapshot || !activeWorkspace) {
    return (
      <div className="wb-launch" role="status">
        <img src={brandIcon} width="32" height="32" alt="" />
        <span>正在启动 Mulspace…</span>
      </div>
    )
  }

  const dynamicSeed = snapshot.settings.followWorkspaceColor
    ? activeWorkspace.seedColor
    : snapshot.settings.customSeedColor

  const showNewTab = activeTab?.url === NEW_TAB_URL
  const openWorkspaceEditor = (workspace: Workspace | null): void => {
    setEditingWorkspace(workspace)
    setWsDialogOpen(true)
  }

  const wsProxyStatus = snapshot.proxyStatus.workspaceStatuses[activeWorkspace.id]
  const proxyLabel =
    wsProxyStatus?.mode === 'managed-node' && wsProxyStatus.nodeName
      ? `${wsProxyStatus.nodeName}${wsProxyStatus.latencyMs ? ` · ${wsProxyStatus.latencyMs}ms` : ''}`
      : wsProxyStatus?.mode === 'custom'
        ? '自定义代理'
        : wsProxyStatus?.mode === 'system'
          ? '系统代理'
          : '直连'

  const activeWorkspaceExtensions = snapshot.extensions.filter((ext) => {
    if (ext.disabledWorkspaces.includes(activeWorkspace.id)) return false
    if (ext.enabledWorkspaces.includes(activeWorkspace.id)) return true
    return ext.enabledGlobally
  })

  const handleSendChat = async (promptText: string): Promise<void> => {
    if (!promptText.trim() || agentBusy) return
    setAgentBusy(true)
    setChatPrompt('')
    try {
      const updated = await window.browserApi.sendAgentMessage(activeWorkspace.id, promptText.trim())
      setAgentMessages(updated)
    } finally {
      setAgentBusy(false)
    }
  }

  return (
    <ThemeProvider
      themeId={snapshot.settings.themeId}
      mode={snapshot.settings.themeMode}
      themes={snapshot.themes}
      seedColorOverride={dynamicSeed}
    >
      <div className="wb-shell">
        <aside className="wb-rail" aria-label="账号工作区栏">
          <button
            type="button"
            className="wb-rail__brand"
            title="Mulspace · 新建标签页"
            aria-label="打开 Mulspace 新标签页"
            onClick={() => void window.browserApi.createTab(activeWorkspace.id)}
          >
            <img src={brandIcon} width="32" height="32" alt="" />
          </button>

          <div className="wb-rail__list">
            {snapshot.workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspace.id
              const tabCount = (snapshot.tabsByWorkspace[ws.id] ?? []).length
              return (
                <div
                  key={ws.id}
                  className={`wb-rail__item-wrap ${isActive ? 'wb-rail__item-wrap--active' : ''}`}
                  style={{ '--ws-accent': ws.seedColor } as CSSProperties}
                >
                  <span className="wb-rail__indicator" aria-hidden="true" />
                  <button
                    type="button"
                    className={`wb-rail__item ${isActive ? 'wb-rail__item--active' : ''}`}
                    aria-current={isActive ? true : undefined}
                    aria-label={ws.name}
                    title={`${ws.name}（${tabCount} 个标签）· 右键编辑`}
                    onMouseDown={(e) => {
                      if (e.button === 0 && !isActive) {
                        void window.browserApi.switchWorkspace(ws.id)
                      }
                    }}
                    onClick={() => {
                      if (!isActive) {
                        void window.browserApi.switchWorkspace(ws.id)
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      openWorkspaceEditor(ws)
                    }}
                  >
                    <WorkspaceGlyph value={ws.icon} size={18} />
                  </button>
                  <span className="wb-rail__label">{ws.name}</span>
                </div>
              )
            })}

            <IconButton
              className="wb-rail__add"
              title="新建独立账号工作区"
              onClick={() => openWorkspaceEditor(null)}
            >
              <Plus size={17} />
            </IconButton>
          </div>

          <div className="wb-rail__tools">
            <IconButton
              title="在新窗口打开当前工作区"
              onClick={() => void window.browserApi.openWorkspaceInNewWindow(activeWorkspace.id)}
            >
              <ExternalLink size={16} />
            </IconButton>
            <IconButton title="网络代理配置" onClick={() => setProxyDialogOpen(true)}>
              <Network size={16} />
            </IconButton>
            <IconButton title="安全防控中心（指纹与隐私隔离）" onClick={() => setSecurityDialogOpen(true)}>
              <ShieldCheck size={16} />
            </IconButton>
            <IconButton title="扩展程序管理" onClick={() => setExtDialogOpen(true)}>
              <Puzzle size={16} />
            </IconButton>
            <IconButton title="AI 与 MCP 中心" onClick={() => setAiHubOpen(true)}>
              <TerminalSquare size={16} />
            </IconButton>
            <IconButton
              title="编辑当前工作区"
              onClick={() => openWorkspaceEditor(activeWorkspace)}
            >
              <SlidersHorizontal size={16} />
            </IconButton>
            <IconButton title="浏览器设置" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} />
            </IconButton>
          </div>
        </aside>

        {/* Main Browser Chrome & Viewport */}
        <div className="wb-main-column">
          <div
            ref={tabbarRef}
            className={`wb-tabbar ${dragState ? 'wb-tabbar--dragging' : ''}`}
            role="tablist"
            aria-label="当前工作区标签页"
          >
            {displayedTabs.map((tab) => {
              const isTabActive = activeTab?.id === tab.id
              const isDragging = dragState?.tabId === tab.id
              return (
                <div
                  key={tab.id}
                  ref={(node) => {
                    if (node) tabElementsRef.current.set(tab.id, node)
                    else tabElementsRef.current.delete(tab.id)
                  }}
                  role="tab"
                  tabIndex={0}
                  aria-selected={isTabActive}
                  className={`wb-tab ${isTabActive ? 'wb-tab--active' : ''} ${isDragging ? 'wb-tab--dragging' : ''}`}
                  style={isDragging ? { transform: `translateX(${dragState.offsetX}px)` } : undefined}
                  onPointerDown={(e) => startTabDrag(e, tab, isTabActive)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isTabActive) {
                      e.preventDefault()
                      void window.browserApi.activateTab(activeWorkspace.id, tab.id)
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    void window.browserApi.showTabContextMenu(activeWorkspace.id, tab.id)
                  }}
                >
                  <span className="wb-tab__symbol" aria-hidden="true">
                    <TabSymbol tab={tab} />
                  </span>
                  {tab.pinned ? <Pin size={11} className="wb-tab__meta-icon" /> : null}
                  {tab.aiBusy ? <Bot size={12} className="wb-tab__meta-icon" /> : null}
                  {tab.muted || tab.audible ? (
                    <button
                      type="button"
                      className="wb-tab__audio"
                      title={tab.muted ? '取消静音' : '静音此标签页'}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.browserApi.toggleMuteTab(activeWorkspace.id, tab.id)
                      }}
                    >
                      {tab.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    </button>
                  ) : null}
                  {tab.state === 'frozen' ? (
                    <span className="wb-tab__meta-icon" title="后台休眠中（保留状态）">
                      <Snowflake size={11} />
                    </span>
                  ) : null}
                  {tab.state === 'discarded' ? (
                    <span className="wb-tab__meta-icon" title="已释放内存（点击恢复）">
                      <Moon size={11} />
                    </span>
                  ) : null}
                  <span className="wb-tab__title">
                    {tab.url === NEW_TAB_URL ? '新标签页' : tab.title || tab.url}
                  </span>
                  <button
                    type="button"
                    className="wb-tab__close"
                    title="关闭标签"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      void window.browserApi.closeTab(activeWorkspace.id, tab.id)
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              )
            })}
            <IconButton
              className="wb-tabbar__add"
              title="新建标签页 (⌘T)"
              onClick={() => void window.browserApi.createTab(activeWorkspace.id)}
            >
              <Plus size={15} />
            </IconButton>
          </div>

          <div className="wb-toolbar">
            <div className="wb-toolbar__nav">
              <IconButton
                title="后退"
                disabled={!activeTab?.canGoBack}
                onClick={() =>
                  activeTab && void window.browserApi.goBack(activeWorkspace.id, activeTab.id)
                }
              >
                <ArrowLeft size={16} />
              </IconButton>
              <IconButton
                title="前进"
                disabled={!activeTab?.canGoForward}
                onClick={() =>
                  activeTab && void window.browserApi.goForward(activeWorkspace.id, activeTab.id)
                }
              >
                <ArrowRight size={16} />
              </IconButton>
              <IconButton
                title="刷新（Shift+点击或右键强制刷新）"
                disabled={!activeTab}
                onClick={(e) =>
                  activeTab && void window.browserApi.reloadTab(activeWorkspace.id, activeTab.id, e.shiftKey)
                }
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (activeTab) {
                    void window.browserApi.showReloadMenu(activeWorkspace.id, activeTab.id)
                  }
                }}
              >
                <RotateCw size={15} />
              </IconButton>
            </div>

            <AddressBar
              tabId={activeTab?.id}
              tabUrl={activeTab?.url}
              isBookmarked={Boolean(currentTabBookmark)}
              onToggleBookmark={openBookmarkModal}
              onNavigate={handleNavigate}
            />

            <div className="wb-toolbar__tools">
              {recording ? (
                <button
                  type="button"
                  className="wb-rec-pill"
                  title="点击停止录屏并保存视频"
                  onClick={() => void handleStopRecording()}
                >
                  <span className="wb-rec-pill__dot" aria-hidden="true" />
                  <span>{formatRecDuration(recordingSeconds)} 停止</span>
                </button>
              ) : (
                <IconButton
                  title="截图 / 录屏"
                  active={captureDialogOpen}
                  onClick={() => setCaptureDialogOpen(true)}
                >
                  <Camera size={15} />
                </IconButton>
              )}

              <IconButton
                title="网页翻译 / 划词快译"
                active={translateDialogOpen || Boolean(activeTab?.id && translatedTabIds[activeTab.id])}
                onClick={() => setTranslateDialogOpen(true)}
              >
                <Languages size={15} />
              </IconButton>
            </div>

            <div className="wb-toolbar__meta">
              <button
                type="button"
                className="wb-toolbar-chip wb-toolbar-chip--workspace"
                title={`当前工作区：${activeWorkspace.name}（分区 ${activeWorkspace.partition}）`}
                onClick={() => openWorkspaceEditor(activeWorkspace)}
              >
                <span className="wb-toolbar-chip__dot" style={{ backgroundColor: activeWorkspace.seedColor }} />
                <span>{activeWorkspace.name}</span>
              </button>

              <button
                type="button"
                className="wb-toolbar-chip wb-toolbar-chip--proxy"
                title={`当前代理：${proxyLabel} · 点击配置`}
                onClick={() => setProxyDialogOpen(true)}
              >
                <Network size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>{proxyLabel}</span>
              </button>

              {snapshot.updateState.status === 'available' ? (
                <button
                  type="button"
                  className="wb-toolbar-update"
                  title="查看新版本更新"
                  onClick={() => setSettingsOpen(true)}
                >
                  <span>v{snapshot.updateState.latestVersion}</span>
                  <ArrowUpRight size={12} strokeWidth={1.9} aria-hidden="true" />
                </button>
              ) : null}

              {activeWorkspaceExtensions.slice(0, 3).map((ext) => (
                <IconButton
                  key={ext.id}
                  title={ext.name}
                  onClick={() =>
                    ext.popupPath
                      ? void window.browserApi.openExtensionPopup(activeWorkspace.id, ext.id)
                      : setExtDialogOpen(true)
                  }
                >
                  <Puzzle size={14} />
                </IconButton>
              ))}

              <IconButton
                title={activeTab?.pinned ? '取消固定标签' : '固定当前标签'}
                active={activeTab?.pinned}
                disabled={!activeTab}
                onClick={() =>
                  activeTab && void window.browserApi.togglePinTab(activeWorkspace.id, activeTab.id)
                }
              >
                <Pin size={15} />
              </IconButton>

              <IconButton
                title="开发者工具"
                disabled={!activeTab}
                onClick={() =>
                  activeTab && void window.browserApi.openDevTools(activeWorkspace.id, activeTab.id)
                }
              >
                <Code2 size={15} />
              </IconButton>

              <IconButton
                title="AI 助手侧边栏"
                active={aiSidebarOpen}
                onClick={() => setAiSidebarOpen((prev) => !prev)}
              >
                <PanelRight size={16} />
              </IconButton>
            </div>
          </div>

          <div className="wb-content-row">
            <div ref={viewportRef} className="wb-viewport-slot">
              {showNewTab ? (
                <NewTabPage
                  workspace={activeWorkspace}
                  workspaces={snapshot.workspaces}
                  tabCountsByWorkspace={tabCountsByWorkspace}
                  proxyLabel={proxyLabel}
                  multabState={multabState}
                  onNavigate={handleNavigate}
                  onOpenInNewTab={handleOpenInNewTab}
                  onSwitchWorkspace={handleSwitchWorkspace}
                  onCreateWorkspace={handleCreateWorkspace}
                  onOpenAddItem={handleOpenMultabAddItem}
                  onEditItem={handleEditMultabItem}
                  onDeleteItem={handleDeleteMultabItem}
                  onReorderItems={handleReorderMultabItems}
                  onMoveItemToCategory={handleMoveMultabItem}
                  onTogglePinItem={handleToggleMultabPin}
                  onReorderCategories={handleReorderMultabCategories}
                  onSaveCategory={handleSaveMultabCategory}
                  onDeleteCategory={handleDeleteMultabCategory}
                  onChangeSearchEngine={handleChangeMultabEngine}
                  onChangeViewMode={handleChangeMultabViewMode}
                  onUpdatePrefs={handleUpdateMultabPrefs}
                  onOpenSyncDialog={handleOpenMultabSync}
                />
              ) : null}
            </div>

            {aiSidebarOpen ? (
              <aside className="wb-sidebar" aria-label="工作区 AI 助手侧边栏">
                <div className="wb-sidebar__header">
                  <div className="wb-sidebar__identity">
                    <strong>浏览助手</strong>
                    <span>
                      <i className="wb-sidebar__ws-dot" style={{ backgroundColor: activeWorkspace.seedColor }} />
                      {activeWorkspace.name}
                    </span>
                  </div>
                  <div className="wb-sidebar__actions">
                    <IconButton title="AI / MCP 配置" onClick={() => setAiHubOpen(true)}>
                      <SlidersHorizontal size={14} />
                    </IconButton>
                    <IconButton
                      title="清空对话"
                      onClick={() =>
                        void window.browserApi
                          .clearAgentMessages(activeWorkspace.id)
                          .then(() => setAgentMessages([]))
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                    <IconButton title="收起侧边栏" onClick={() => setAiSidebarOpen(false)}>
                      <X size={15} />
                    </IconButton>
                  </div>
                </div>

                {skills.length > 0 ? (
                  <div className="wb-sidebar__skills">
                    {skills.slice(0, 4).map((skill) => (
                      <Button
                        key={skill.id}
                        variant="outlined"
                        disabled={agentBusy}
                        onClick={async () => {
                          setAgentBusy(true)
                          try {
                            const updated = await window.browserApi.runSkill(activeWorkspace.id, skill.id)
                            setAgentMessages(updated)
                          } finally {
                            setAgentBusy(false)
                          }
                        }}
                      >
                        {skill.name}
                      </Button>
                    ))}
                  </div>
                ) : null}

                <div className="wb-sidebar__messages">
                  {agentMessages.length === 0 ? (
                    <div className="wb-sidebar__empty">
                      <strong>围绕当前页面提问</strong>
                      <p>对话与上下文仅限「{activeWorkspace.name}」工作区。</p>
                      <div className="wb-sidebar__empty-actions">
                        <Button
                          variant="tonal"
                          onClick={() => void handleSendChat('请读取并总结当前页面内容，检查工作区环境')}
                        >
                          总结当前页
                        </Button>
                        <Button variant="text" onClick={() => setAiHubOpen(true)}>
                          模型与 MCP
                        </Button>
                      </div>
                    </div>
                  ) : (
                    agentMessages.map((msg) => (
                      <div key={msg.id} className="wb-sidebar__msg-group">
                        <div
                          className={`wb-sidebar__msg ${
                            msg.role === 'user' ? 'wb-sidebar__msg--user' : 'wb-sidebar__msg--assistant'
                          }`}
                        >
                          {msg.content}
                        </div>
                        {msg.a2uiCard ? (
                          <Suspense fallback={null}>
                            <A2UISurface
                              schema={msg.a2uiCard}
                              onAction={(act) => {
                                if (act === 'open-ai-hub') setAiHubOpen(true)
                                if (act === 'resume-after-takeover') {
                                  void handleSendChat('我已完成人工验证，请继续读取当前页面。')
                                }
                              }}
                            />
                          </Suspense>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                <form
                  className="wb-sidebar__composer"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleSendChat(chatPrompt)
                  }}
                >
                  <input
                    className="wb-omnibox"
                    value={chatPrompt}
                    disabled={agentBusy}
                    onChange={(e) => setChatPrompt(e.target.value)}
                    aria-label="给浏览助手发消息"
                    placeholder={agentBusy ? '正在思考…' : '围绕当前页提问…'}
                  />
                  <IconButton type="submit" disabled={agentBusy || !chatPrompt.trim()} title="发送">
                    <Send size={14} />
                  </IconButton>
                </form>
              </aside>
            ) : null}
          </div>
        </div>
      </div>

      <Suspense fallback={null}>
        {wsDialogOpen ? (
          <WorkspaceEditorDialog
            open={wsDialogOpen}
            workspace={editingWorkspace}
            canDelete={snapshot.workspaces.length > 1}
            onClose={() => setWsDialogOpen(false)}
            onCreate={async (input) => {
              await window.browserApi.createWorkspace(input)
            }}
            onUpdate={async (wsId, input) => {
              await window.browserApi.updateWorkspace(wsId, input)
            }}
            onDelete={async (wsId) => {
              await window.browserApi.deleteWorkspace(wsId)
            }}
          />
        ) : null}

        {proxyDialogOpen ? (
          <ProxyManagerDialog
            open={proxyDialogOpen}
            workspace={activeWorkspace}
            proxyStatus={snapshot.proxyStatus}
            subscriptions={snapshot.proxySubscriptions}
            nodes={snapshot.proxyNodes}
            defaultBinaryPath={snapshot.settings.proxyCoreBinaryPath}
            onClose={() => setProxyDialogOpen(false)}
            onImport={async (input) => {
              await window.browserApi.importProxySubscription(input)
            }}
            onDeleteSubscription={async (subId) => {
              await window.browserApi.deleteProxySubscription(subId)
            }}
            onTestLatency={async (nodeId) => {
              await window.browserApi.testProxyNodeLatency(nodeId)
            }}
            onSetWorkspaceProxy={async (wsId, binding) => {
              await window.browserApi.setWorkspaceProxy(wsId, binding)
            }}
            onSetBinaryPath={async (p) => {
              await window.browserApi.setProxyBinaryPath(p)
            }}
          />
        ) : null}

        {extDialogOpen ? (
          <ExtensionsDialog
            open={extDialogOpen}
            workspace={activeWorkspace}
            extensions={snapshot.extensions}
            activeTabUrl={activeTab?.url}
            onClose={() => setExtDialogOpen(false)}
            onOpenChromeWebStore={() =>
              void window.browserApi.createTab(
                activeWorkspace.id,
                'https://chromewebstore.google.com/',
                true,
              )
            }
            onInstallFromStore={async (urlOrId) => {
              await window.browserApi.installExtensionFromStore(activeWorkspace.id, urlOrId)
            }}
            onInstallFolder={async () => {
              const folder = await window.browserApi.pickExtensionFolder()
              if (folder) await window.browserApi.installExtensionFromFolder(folder)
            }}
            onInstallCrx={async () => {
              const file = await window.browserApi.pickCrxFile()
              if (file) await window.browserApi.installExtensionFromCrx(file)
            }}
            onToggleForWorkspace={async (extId, wsId, enabled) => {
              await window.browserApi.toggleExtensionForWorkspace(extId, wsId, enabled)
            }}
            onOpenPopup={async (wsId, extId) => {
              await window.browserApi.openExtensionPopup(wsId, extId)
            }}
            onRemove={async (extId) => {
              await window.browserApi.removeExtension(extId)
            }}
          />
        ) : null}

        {securityDialogOpen ? (
          <SecurityGuardDialog
            open={securityDialogOpen}
            workspaces={snapshot.workspaces}
            activeWorkspace={activeWorkspace}
            onClose={() => setSecurityDialogOpen(false)}
            onUpdateIsolation={async (wsId, isolation) => {
              await window.browserApi.updateWorkspace(wsId, { isolation })
            }}
            onClearWorkspaceData={async (wsId) => {
              await window.browserApi.clearWorkspaceData(wsId)
            }}
          />
        ) : null}

        {aiHubOpen ? (
          <AiHubDialog
            open={aiHubOpen}
            workspaces={snapshot.workspaces}
            activeWorkspace={activeWorkspace}
            settings={snapshot.settings}
            mcpHostStatus={snapshot.mcpHostStatus}
            onClose={() => setAiHubOpen(false)}
            onUpdateSettings={async (patch) => {
              await window.browserApi.updateSettings(patch)
            }}
            onRunSkillInWorkspace={async (skillId) => {
              setAiSidebarOpen(true)
              const updated = await window.browserApi.runSkill(activeWorkspace.id, skillId)
              setAgentMessages(updated)
            }}
          />
        ) : null}

        {settingsOpen ? (
          <SettingsDialog
            open={settingsOpen}
            settings={snapshot.settings}
            themes={snapshot.themes}
            memorySummary={snapshot.memorySummary}
            updateState={snapshot.updateState}
            onClose={() => setSettingsOpen(false)}
            onUpdateSettings={async (patch) => {
              await window.browserApi.updateSettings(patch)
            }}
            onSweepMemory={async () => {
              await window.browserApi.sweepMemoryNow()
            }}
            onCheckForUpdates={async () => {
              await window.browserApi.checkForUpdates()
            }}
            onOpenUpdateDownload={async () => {
              await window.browserApi.openUpdateDownload()
            }}
            onOpenExtensions={() => setExtDialogOpen(true)}
            onOpenChromeWebStore={() =>
              void window.browserApi.createTab(
                activeWorkspace.id,
                'https://chromewebstore.google.com/',
                true,
              )
            }
          />
        ) : null}

        {translateDialogOpen ? (
          <TranslateDialog
            open={translateDialogOpen}
            workspaceId={activeWorkspace.id}
            tabId={activeTab?.id}
            hasWebPage={Boolean(activeTab && activeTab.url !== NEW_TAB_URL && /^https?:\/\//i.test(activeTab.url))}
            isPageTranslated={Boolean(activeTab?.id && translatedTabIds[activeTab.id])}
            onClose={() => setTranslateDialogOpen(false)}
            onPageTranslatedChange={(translated) => {
              if (!activeTab?.id) return
              setTranslatedTabIds((prev) => ({ ...prev, [activeTab.id]: translated }))
            }}
            onToast={showChromeToast}
          />
        ) : null}

        {multabItemDialogOpen ? (
          <MultabItemDialog
            open={multabItemDialogOpen}
            categories={multabState.categories}
            editingItem={editingMultabItem}
            initialDraft={multabItemDraft}
            defaultCategoryId={multabDefaultCatId}
            anchorTopRight={multabDialogFromStar}
            onClose={() => setMultabItemDialogOpen(false)}
            onSave={async (input) => {
              await window.browserApi.saveMultabItem(input)
            }}
            onDelete={async (itemId) => {
              await window.browserApi.deleteMultabItem(itemId)
            }}
            onCreateCategory={async (name) => {
              const updated = await window.browserApi.saveMultabCategory({ name, icon: 'folder' })
              return updated.categories.find((c) => c.name === name)?.id
            }}
          />
        ) : null}

        {multabSyncOpen ? (
          <MultabSyncDialog
            open={multabSyncOpen}
            multabState={multabState}
            onClose={() => setMultabSyncOpen(false)}
          />
        ) : null}
      </Suspense>

      <CaptureDialog
        open={captureDialogOpen}
        recording={recording}
        recordingSeconds={recordingSeconds}
        onClose={() => setCaptureDialogOpen(false)}
        onCaptureFullPage={handleCaptureFullPage}
        onStartRegionCapture={handleStartRegionCapture}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
      />

      <CaptureCropOverlay
        imageDataUrl={cropImageDataUrl}
        onClose={() => setCropImageDataUrl(null)}
        onCopyDataUrl={async (dataUrl) => {
          await window.browserApi.copyCapturedImage(dataUrl)
          showChromeToast('已复制选区截图到剪贴板')
        }}
        onSaveDataUrl={async (dataUrl) => {
          const saved = await window.browserApi.saveCapturedImage(dataUrl)
          if (saved) showChromeToast('选区截图已保存为 PNG')
        }}
      />

      {chromeToast ? <div className="wb-chrome-toast">{chromeToast}</div> : null}
    </ThemeProvider>
  )
}
