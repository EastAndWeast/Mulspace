import { is } from '@electron-toolkit/utils'
import {
  IPC_CHANNELS,
  NEW_TAB_URL,
  type AppSettings,
  type BrowserWindowSnapshot,
  type Tab,
  type TabId,
  type TabSnapshot,
  type ViewportBounds,
  type WindowId,
  type Workspace,
  type WorkspaceId,
} from '@wb/contracts'
import type { AgentService } from '@wb/ai-runtime'
import type { ExtensionService, ISessionExtensionAdapter } from '@wb/extension-host'
import type { BrowserKernel } from '@wb/kernel'
import type { ISessionProxyApplier, ProxyService, SessionProxyConfig } from '@wb/proxy-engine'
import type { ITabViewAdapter, TabLifecycleManager } from '@wb/tab-lifecycle'
import { defaultThemeRegistry } from '@wb/themes'
import type { UpdateService } from '@wb/updater'
import type { WorkspaceService } from '@wb/workspace-core'
import {
  app,
  BaseWindow,
  Menu,
  WebContentsView,
  clipboard,
  dialog,
  session,
  type WebContents,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildChromeContextMenuTemplate,
  buildPageContextMenuTemplate,
  buildReloadMenuTemplate,
  buildTabContextMenuTemplate,
} from './context-menu.js'
import { buildLoadErrorHtml } from './error-page.js'

const AUTO_ALLOWED_PERMISSIONS = new Set<string>([
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
])

const PROMPTABLE_PERMISSIONS = new Set<string>([
  'notifications',
  'media',
  'audioCapture',
  'clipboard-read',
  'geolocation',
])

const PERMISSION_LABELS: Record<string, string> = {
  notifications: '桌面通知',
  media: '摄像头 / 麦克风',
  audioCapture: '麦克风音频录制',
  'clipboard-read': '读取剪贴板内容',
  geolocation: '获取地理位置',
}

interface ManagedWindow {
  id: WindowId
  baseWindow: BaseWindow
  chromeView: WebContentsView
  viewportBounds: ViewportBounds
  attachedTabId: TabId | null
  mountedTabIds: Set<TabId>
  lastBoundsByTab: Map<TabId, ViewportBounds>
  overlayOpen: boolean
  initialBoundsSynced: boolean
}

export function normalizeNavigationInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'https://www.bing.com'
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return trimmed
  }
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `http://${trimmed}`
  }
  if (!trimmed.includes(' ') && trimmed.includes('.')) {
    return `https://${trimmed}`
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`
}

export class BrowserWindowManager
  implements ITabViewAdapter, ISessionProxyApplier, ISessionExtensionAdapter
{
  private readonly windows = new Map<WindowId, ManagedWindow>()
  private readonly chromeWebContentsToWindowId = new Map<number, WindowId>()
  private readonly tabViews = new Map<TabId, WebContentsView>()
  private readonly tabIdToWorkspaceId = new Map<TabId, WorkspaceId>()
  private readonly proxyAuthByPartition = new Map<string, { username: string; password: string }>()
  private readonly allowedInsecureCertHosts = new Map<WorkspaceId, Set<string>>()
  private readonly configuredSessionPartitions = new Set<string>()
  private readonly pendingCertErrors = new Map<
    TabId,
    { hostname: string; url: string; error: string; subject?: string; issuer?: string; token: string }
  >()
  private readonly pendingLoadUrls = new Map<TabId, string>()
  private readonly failedTabUrls = new Map<TabId, string>()
  private readonly grantedPermissions = new Map<WorkspaceId, Set<string>>()
  private readonly deniedPermissions = new Map<WorkspaceId, Set<string>>()
  private readonly pendingPermissionPrompts = new Map<string, Promise<boolean>>()
  private readonly lastAppliedIsolation = new Map<WorkspaceId, string>()
  private readonly appliedProxySigByPartition = new Map<string, string>()
  private readonly appliedUaByPartition = new Map<string, string>()
  private readonly pendingSnapshotWindows = new Set<WindowId>()
  private readonly deferredSnapshotTimers = new Map<WindowId, ReturnType<typeof setTimeout>>()

  private cachedWorkspaces: Workspace[] | null = null
  private cachedThemes: ReturnType<typeof defaultThemeRegistry.list> | null = null
  private cachedExtensions: NonNullable<BrowserWindowSnapshot['extensions']> | null = null
  private cachedProxyStatus: BrowserWindowSnapshot['proxyStatus'] | null = null
  private cachedMcpHostStatus: BrowserWindowSnapshot['mcpHostStatus'] | null = null
  private cachedUpdateState: BrowserWindowSnapshot['updateState'] | null = null

  private windowSeq = 0
  private aiMessageSeq = 0
  private tabLifecycle!: TabLifecycleManager
  private proxyService?: ProxyService
  private extensionService?: ExtensionService
  private agentService?: AgentService
  private updateService?: UpdateService

  constructor(
    private readonly kernel: BrowserKernel,
    private readonly workspaceService: WorkspaceService,
    private readonly getSettings: () => AppSettings,
  ) {}

  attachServices(deps: {
    tabLifecycle: TabLifecycleManager
    proxyService: ProxyService
    extensionService: ExtensionService
    agentService: AgentService
    updateService: UpdateService
  }): void {
    this.tabLifecycle = deps.tabLifecycle
    this.proxyService = deps.proxyService
    this.extensionService = deps.extensionService
    this.agentService = deps.agentService
    this.updateService = deps.updateService

    const broadcastAll = (immediate = true): void => {
      for (const winId of this.windows.keys()) {
        this.pushSnapshotToWindow(winId, immediate)
      }
    }

    this.kernel.events.on('workspace:created', () => {
      this.cachedWorkspaces = null
      broadcastAll(true)
    })
    this.kernel.events.on('workspace:updated', ({ workspace }) => {
      this.cachedWorkspaces = null
      const ua = workspace.isolation.userAgent?.trim() || this.getDefaultUserAgent()
      const isolationSig = `${ua}|${workspace.isolation.webrtcPolicy}`
      if (this.lastAppliedIsolation.get(workspace.id) !== isolationSig) {
        this.lastAppliedIsolation.set(workspace.id, isolationSig)
        const ses = session.fromPartition(workspace.partition, { cache: true })
        if (this.appliedUaByPartition.get(workspace.partition) !== ua) {
          ses.setUserAgent(ua)
          this.appliedUaByPartition.set(workspace.partition, ua)
        }
        for (const [tabId, wsId] of this.tabIdToWorkspaceId.entries()) {
          if (wsId !== workspace.id) continue
          const view = this.tabViews.get(tabId)
          if (view && !view.webContents.isDestroyed()) {
            view.webContents.setUserAgent(ua)
            view.webContents.setWebRTCIPHandlingPolicy(workspace.isolation.webrtcPolicy)
          }
        }
      }
      broadcastAll(true)
    })
    this.kernel.events.on('workspace:deleted', ({ workspaceId, partition }) => {
      this.cachedWorkspaces = null
      this.allowedInsecureCertHosts.delete(workspaceId)
      this.grantedPermissions.delete(workspaceId)
      this.deniedPermissions.delete(workspaceId)
      this.lastAppliedIsolation.delete(workspaceId)

      const resolvedPartition = partition ?? `persist:ws-${workspaceId}`
      this.proxyAuthByPartition.delete(resolvedPartition)
      this.appliedProxySigByPartition.delete(resolvedPartition)
      this.appliedUaByPartition.delete(resolvedPartition)
      this.configuredSessionPartitions.delete(resolvedPartition)

      // Detach any window that was displaying a view from the deleted workspace
      for (const win of this.windows.values()) {
        if (win.attachedTabId && this.tabIdToWorkspaceId.get(win.attachedTabId) === workspaceId) {
          this.detachView(win.attachedTabId, win.id)
          const fallbackWsId = this.workspaceService.getActiveWorkspaceForWindow(win.id)
          void this.ensureActiveTabForWorkspace(fallbackWsId, win.id).then(() => {
            this.pushSnapshotToWindow(win.id)
          })
        }
      }

      // Clean session storage and disk Partition directory after view teardown settles
      const partDirName = resolvedPartition.replace(/^persist:/, '')
      if (partDirName) {
        const ses = session.fromPartition(resolvedPartition, { cache: true })
        setTimeout(() => {
          void Promise.allSettled([
            ses.closeAllConnections(),
            ses.clearStorageData(),
            ses.clearCache(),
            ses.clearAuthCache(),
          ]).then(() =>
            rm(join(app.getPath('userData'), 'Partitions', partDirName), {
              recursive: true,
              force: true,
            }).catch(() => undefined),
          )
        }, 150)
      }

      broadcastAll(true)
    })
    this.kernel.events.on('workspace:switched', ({ windowId }) => {
      this.pushSnapshotToWindow(windowId, true)
    })
    this.kernel.events.on('tab:created', () => broadcastAll(true))
    this.kernel.events.on('tab:updated', () => broadcastAll(false))
    this.kernel.events.on('tab:closed', () => broadcastAll(true))
    this.kernel.events.on('tab:reordered', () => broadcastAll(true))
    this.kernel.events.on('tab:lifecycle-changed', () => broadcastAll(true))
    this.kernel.events.on('settings:updated', () => {
      this.cachedMcpHostStatus = null
      broadcastAll(true)
    })
    this.kernel.events.on('proxy:updated', () => {
      this.cachedProxyStatus = null
      broadcastAll(true)
    })
    this.kernel.events.on('extensions:updated', () => {
      this.cachedExtensions = null
      broadcastAll(true)
    })
    this.kernel.events.on('themes:updated', () => {
      this.cachedThemes = null
      broadcastAll(true)
    })
    this.kernel.events.on('update:state-changed', () => {
      this.cachedUpdateState = null
      broadcastAll(true)
    })
    this.kernel.events.on('ai:message', () => {
      this.aiMessageSeq++
      broadcastAll(true)
    })
  }

  getProxyAuthForPartition(partition: string): { username: string; password: string } | undefined {
    return this.proxyAuthByPartition.get(partition)
  }

  getWorkspaceIdForTab(tabId: TabId): WorkspaceId | undefined {
    return this.tabIdToWorkspaceId.get(tabId)
  }

  getTabWebContents(tabId: TabId): WebContents | undefined {
    return this.tabViews.get(tabId)?.webContents
  }

  async applySessionProxy(workspace: Workspace, config: SessionProxyConfig): Promise<void> {
    const sig =
      config.mode === 'fixed_servers'
        ? `${config.mode}|${config.proxyRules ?? ''}|${config.proxyBypassRules ?? ''}|${config.auth?.username ?? ''}:${config.auth?.password ?? ''}`
        : config.mode

    const prevSig = this.appliedProxySigByPartition.get(workspace.partition)
    if (!prevSig && config.mode === 'system') {
      // Fresh Electron sessions default to system proxy; avoid redundant cache/connection tear-down at startup
      this.appliedProxySigByPartition.set(workspace.partition, sig)
      return
    }
    if (prevSig === sig) {
      return
    }
    this.appliedProxySigByPartition.set(workspace.partition, sig)

    const ses = session.fromPartition(workspace.partition, { cache: true })
    if (config.auth) {
      this.proxyAuthByPartition.set(workspace.partition, config.auth)
    } else {
      this.proxyAuthByPartition.delete(workspace.partition)
    }

    await ses.clearAuthCache()
    await ses.closeAllConnections()

    if (config.mode === 'direct') {
      await ses.setProxy({ mode: 'direct' })
    } else if (config.mode === 'system') {
      await ses.setProxy({ mode: 'system' })
    } else {
      await ses.setProxy({
        mode: 'fixed_servers',
        proxyRules: config.proxyRules,
        proxyBypassRules: config.proxyBypassRules ?? 'localhost,127.0.0.1,::1',
      })
    }
  }

  async loadIntoSession(partition: string, dirPath: string): Promise<string | null> {
    const ses = session.fromPartition(partition, { cache: true })
    const ext = await ses.loadExtension(dirPath, { allowFileAccess: true })
    return ext.id
  }

  async removeFromSession(partition: string, runtimeExtensionId: string): Promise<void> {
    const ses = session.fromPartition(partition, { cache: true })
    ses.removeExtension(runtimeExtensionId)
  }

  async openExtensionPopup(workspaceId: WorkspaceId, extensionId: string): Promise<void> {
    const ws = this.workspaceService.get(workspaceId)
    const ext = this.extensionService?.list().find((e) => e.id === extensionId)
    const runtimeId = this.extensionService?.getRuntimeExtensionId(workspaceId, extensionId)
    if (!ws || !ext || !runtimeId || !ext.popupPath) {
      throw new Error('该扩展未在当前工作区启用或没有 Popup 页面')
    }

    const ses = session.fromPartition(ws.partition, { cache: true })
    const popupWin = new BaseWindow({
      width: 400,
      height: 540,
      title: `${ext.name} — ${ws.name}`,
      resizable: true,
    })
    const popupView = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    popupWin.contentView.addChildView(popupView)
    const syncSize = (): void => {
      const [w, h] = popupWin.getContentSize()
      popupView.setBounds({ x: 0, y: 0, width: w ?? 400, height: h ?? 540 })
    }
    popupWin.on('resize', syncSize)
    syncSize()
    await popupView.webContents.loadURL(`chrome-extension://${runtimeId}/${ext.popupPath.replace(/^\/+/, '')}`)
  }

  async createBrowserWindow(
    targetWorkspaceId?: WorkspaceId,
    waitBeforeAttachTab?: Promise<void>,
  ): Promise<WindowId> {
    const windowId = `win_${++this.windowSeq}`
    const workspaceId = targetWorkspaceId ?? this.workspaceService.getDefaultWorkspaceId()

    const baseWindow = new BaseWindow({
      width: 1380,
      height: 880,
      minWidth: 940,
      minHeight: 620,
      show: false,
      title: 'Mulspace',
    })

    const chromeView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    baseWindow.contentView.addChildView(chromeView)
    const [initW, initH] = baseWindow.getContentSize()
    const managed: ManagedWindow = {
      id: windowId,
      baseWindow,
      chromeView,
      viewportBounds: {
        x: 64,
        y: 88,
        width: Math.max(300, (initW ?? 1380) - 64),
        height: Math.max(200, (initH ?? 880) - 88),
      },
      attachedTabId: null,
      mountedTabIds: new Set<TabId>(),
      lastBoundsByTab: new Map<TabId, ViewportBounds>(),
      overlayOpen: false,
      initialBoundsSynced: false,
    }

    this.windows.set(windowId, managed)
    this.chromeWebContentsToWindowId.set(chromeView.webContents.id, windowId)

    chromeView.webContents.on('context-menu', (_event, params) => {
      const items = buildChromeContextMenuTemplate(
        {
          isEditable: params.isEditable,
          selectionText: params.selectionText,
          editFlags: params.editFlags,
        },
        {
          undo: () => chromeView.webContents.undo(),
          redo: () => chromeView.webContents.redo(),
          cut: () => chromeView.webContents.cut(),
          copy: () => chromeView.webContents.copy(),
          paste: () => chromeView.webContents.paste(),
          selectAll: () => chromeView.webContents.selectAll(),
        },
      )
      if (items.length > 0 && !baseWindow.isDestroyed()) {
        Menu.buildFromTemplate(items).popup({ window: baseWindow })
      }
    })

    chromeView.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F5') {
        event.preventDefault()
        this.reloadFocusedTab(Boolean(input.control || input.shift || input.meta))
      } else if (input.key === 'F12') {
        event.preventDefault()
        this.openDevToolsFocusedTab()
      }
    })

    const syncChromeSize = (): void => {
      const [w, h] = baseWindow.getContentSize()
      chromeView.setBounds({ x: 0, y: 0, width: w ?? 1380, height: h ?? 880 })
    }

    baseWindow.on('resize', syncChromeSize)
    baseWindow.on('focus', () => {
      if (!managed.attachedTabId || managed.overlayOpen) return
      const view = this.tabViews.get(managed.attachedTabId)
      if (view && !view.webContents.isDestroyed()) {
        this.revealActiveView(managed.attachedTabId, view)
        view.webContents.setBackgroundThrottling(false)
        view.webContents.invalidate()
      }
    })
    baseWindow.on('closed', () => {
      const attachedTabId = managed.attachedTabId
      const attachedTabWsId = attachedTabId ? this.tabIdToWorkspaceId.get(attachedTabId) : undefined
      for (const mountedTabId of [...managed.mountedTabIds]) {
        const v = this.tabViews.get(mountedTabId)
        if (v) {
          try {
            baseWindow.contentView.removeChildView(v)
          } catch {
            // Ignore
          }
        }
      }
      managed.mountedTabIds.clear()
      managed.lastBoundsByTab.clear()
      this.pendingSnapshotWindows.delete(windowId)
      const deferred = this.deferredSnapshotTimers.get(windowId)
      if (deferred) {
        clearTimeout(deferred)
        this.deferredSnapshotTimers.delete(windowId)
      }
      this.chromeWebContentsToWindowId.delete(chromeView.webContents.id)
      this.windows.delete(windowId)
      this.workspaceService.unbindWindow(windowId)

      if (!chromeView.webContents.isDestroyed()) {
        chromeView.webContents.close({ waitForBeforeUnload: false })
      }
      if (attachedTabId && !this.isTabAttachedElsewhere(attachedTabId, windowId)) {
        if (attachedTabWsId) {
          void this.tabLifecycle.discardTab(attachedTabWsId, attachedTabId, true)
        } else {
          this.destroyView(attachedTabId)
        }
      }
    })

    syncChromeSize()
    await this.workspaceService.bindWindowToWorkspace(windowId, workspaceId)

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      await chromeView.webContents.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      await chromeView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
    }

    if (waitBeforeAttachTab) {
      await waitBeforeAttachTab
      this.cachedProxyStatus = null
      this.cachedExtensions = null
      this.cachedMcpHostStatus = null
    }

    // Show BaseWindow before creating/attaching workspace WebContentsView so macOS attaches an active, unthrottled surface
    baseWindow.show()
    await this.ensureActiveTabForWorkspace(workspaceId, windowId)

    this.pushSnapshotToWindow(windowId, true)
    return windowId
  }

  getWindowCount(): number {
    return this.windows.size
  }

  getPrimaryBaseWindow(): BaseWindow | undefined {
    return this.windows.values().next().value?.baseWindow
  }

  resolveWindowIdFromSender(webContentsId: number): WindowId {
    const winId = this.chromeWebContentsToWindowId.get(webContentsId)
    if (!winId) {
      const first = this.windows.keys().next().value
      if (!first) throw new Error('No active browser windows')
      return first
    }
    return winId
  }

  async switchWorkspace(windowId: WindowId, workspaceId: WorkspaceId): Promise<void> {
    const currentWsId = this.workspaceService.getActiveWorkspaceForWindow(windowId)
    if (currentWsId === workspaceId) return

    await this.workspaceService.bindWindowToWorkspace(windowId, workspaceId)
    await this.ensureActiveTabForWorkspace(workspaceId, windowId)
    await this.tabLifecycle.freezeWorkspaceViews(currentWsId, windowId)
    this.pushSnapshotToWindow(windowId)
  }

  setViewportBounds(windowId: WindowId, bounds: ViewportBounds): void {
    const win = this.windows.get(windowId)
    if (!win) return

    win.viewportBounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(100, Math.round(bounds.width)),
      height: Math.max(100, Math.round(bounds.height)),
    }

    if (win.attachedTabId && !win.overlayOpen) {
      const view = this.tabViews.get(win.attachedTabId)
      if (view) {
        view.setBounds(win.viewportBounds)
        win.lastBoundsByTab.set(win.attachedTabId, { ...win.viewportBounds })
        if (!win.initialBoundsSynced) {
          win.initialBoundsSynced = true
          this.revealActiveView(win.attachedTabId, view)
          view.webContents.setBackgroundThrottling(false)
          view.webContents.invalidate()
        }
      }
    }
  }

  setOverlayOpen(windowId: WindowId, open: boolean): void {
    const win = this.windows.get(windowId)
    if (!win || win.overlayOpen === open) return
    win.overlayOpen = open

    if (!win.attachedTabId) return
    const view = this.tabViews.get(win.attachedTabId)
    if (!view) return

    if (open) {
      view.setVisible(false)
    } else {
      const changed = this.mountViewInWindow(win, win.attachedTabId, view)
      this.revealActiveView(win.attachedTabId, view)
      view.webContents.setBackgroundThrottling(false)
      if (changed) {
        view.webContents.invalidate()
      }
    }
  }

  getSnapshot(windowId: WindowId): BrowserWindowSnapshot {
    const win = this.windows.get(windowId)
    const activeWorkspaceId = this.workspaceService.getActiveWorkspaceForWindow(windowId)

    this.cachedWorkspaces ??= this.workspaceService.list()
    this.cachedThemes ??= defaultThemeRegistry.list()
    this.cachedExtensions ??= this.extensionService?.list() ?? []
    this.cachedProxyStatus ??= this.proxyService?.getStatus() ?? {
      coreKind: 'mihomo',
      binaryFound: false,
      binaryPath: null,
      running: false,
      controllerUrl: null,
      workspaceStatuses: {},
    }
    this.cachedMcpHostStatus ??= this.agentService?.getMcpHostStatus() ?? {
      running: false,
      endpointUrl: null,
      config: this.getSettings().mcpHost,
      clientSnippet: '{}',
    }
    this.cachedUpdateState ??= this.updateService?.getState() ?? {
      status: 'idle',
      currentVersion: '0.1.0',
      latestVersion: null,
      repoSlug: 'EastAndWeast/Mulspace',
    }

    return {
      windowId,
      activeWorkspaceId,
      activeTabId: win?.attachedTabId ?? this.tabLifecycle.getActiveTabId(activeWorkspaceId),
      workspaces: this.cachedWorkspaces,
      tabsByWorkspace: this.tabLifecycle.getAllTabsByWorkspace(),
      settings: this.getSettings(),
      themes: this.cachedThemes,
      memorySummary: this.tabLifecycle.getMemorySummary(),
      proxyStatus: this.cachedProxyStatus,
      // Loaded on demand in ProxyManagerDialog via IPC_CHANNELS.PROXY_GET_DATA to avoid bloating frequent snapshots
      proxySubscriptions: [],
      proxyNodes: [],
      extensions: this.cachedExtensions,
      mcpHostStatus: this.cachedMcpHostStatus,
      updateState: this.cachedUpdateState,
      aiMessageSeq: this.aiMessageSeq,
    }
  }

  pushSnapshotToWindow(windowId: WindowId, immediate = true): void {
    if (!immediate) {
      if (this.pendingSnapshotWindows.has(windowId) || this.deferredSnapshotTimers.has(windowId)) {
        return
      }
      const timer = setTimeout(() => {
        this.deferredSnapshotTimers.delete(windowId)
        this.pushSnapshotToWindow(windowId, true)
      }, 16)
      this.deferredSnapshotTimers.set(windowId, timer)
      return
    }

    const deferred = this.deferredSnapshotTimers.get(windowId)
    if (deferred) {
      clearTimeout(deferred)
      this.deferredSnapshotTimers.delete(windowId)
    }

    if (this.pendingSnapshotWindows.has(windowId)) return
    this.pendingSnapshotWindows.add(windowId)
    queueMicrotask(() => {
      this.pendingSnapshotWindows.delete(windowId)
      const win = this.windows.get(windowId)
      if (!win || win.chromeView.webContents.isDestroyed()) return
      win.chromeView.webContents.send(IPC_CHANNELS.STATE_UPDATED, this.getSnapshot(windowId))
    })
  }

  // ---- ITabViewAdapter Implementation ----

  private getDefaultUserAgent(): string {
    return app.userAgentFallback
  }

  async createView(tab: Tab, workspace: Workspace): Promise<void> {
    if (this.tabViews.has(tab.id)) return

    const ses = session.fromPartition(workspace.partition, { cache: true })
    this.ensureSessionPolicies(workspace.id, workspace.partition, ses)
    const effectiveUa = workspace.isolation.userAgent?.trim() || this.getDefaultUserAgent()
    if (this.appliedUaByPartition.get(workspace.partition) !== effectiveUa) {
      ses.setUserAgent(effectiveUa)
      this.appliedUaByPartition.set(workspace.partition, effectiveUa)
    }

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })

    view.webContents.setWebRTCIPHandlingPolicy(workspace.isolation.webrtcPolicy)
    view.webContents.setAudioMuted(Boolean(tab.muted))
    view.webContents.setUserAgent(effectiveUa)

    this.tabViews.set(tab.id, view)
    this.tabIdToWorkspaceId.set(tab.id, workspace.id)
    this.wireWebContentsEvents(tab.id, workspace.id, view)

    const targetUrl = tab.snapshot?.url ?? tab.url
    this.pendingLoadUrls.set(tab.id, normalizeNavigationInput(targetUrl))
  }

  private mountViewInWindow(win: ManagedWindow, tabId: TabId, view: WebContentsView): boolean {
    let changed = false
    for (const [otherWinId, otherWin] of this.windows.entries()) {
      if (otherWinId !== win.id && otherWin.mountedTabIds.has(tabId)) {
        try {
          otherWin.baseWindow.contentView.removeChildView(view)
        } catch {
          // Ignore
        }
        otherWin.mountedTabIds.delete(tabId)
        otherWin.lastBoundsByTab.delete(tabId)
        if (otherWin.attachedTabId === tabId) {
          otherWin.attachedTabId = null
        }
      }
    }
    if (!win.mountedTabIds.has(tabId)) {
      win.baseWindow.contentView.addChildView(view)
      win.mountedTabIds.add(tabId)
      changed = true
    }
    const prevBounds = win.lastBoundsByTab.get(tabId)
    const cur = win.viewportBounds
    if (
      !prevBounds ||
      prevBounds.x !== cur.x ||
      prevBounds.y !== cur.y ||
      prevBounds.width !== cur.width ||
      prevBounds.height !== cur.height
    ) {
      view.setBounds(cur)
      win.lastBoundsByTab.set(tabId, { ...cur })
      changed = true
    }
    return changed
  }

  private shouldShowTabView(tabId: TabId, view: WebContentsView): boolean {
    if (this.pendingLoadUrls.has(tabId)) {
      return this.pendingLoadUrls.get(tabId) !== NEW_TAB_URL
    }
    const wcUrl = view.webContents.getURL()
    if (wcUrl) {
      return wcUrl !== NEW_TAB_URL
    }
    const workspaceId = this.tabIdToWorkspaceId.get(tabId)
    const tab = workspaceId ? this.tabLifecycle.getTab(workspaceId, tabId) : undefined
    return Boolean(tab?.url && tab.url !== NEW_TAB_URL)
  }

  private revealActiveView(tabId: TabId, view: WebContentsView): void {
    view.setVisible(this.shouldShowTabView(tabId, view))
  }

  attachView(tabId: TabId, windowId: WindowId): void {
    const win = this.windows.get(windowId)
    const view = this.tabViews.get(tabId)
    if (!win || !view) return

    const prevTabId = win.attachedTabId
    win.attachedTabId = tabId
    if (!win.overlayOpen) {
      const changed = this.mountViewInWindow(win, tabId, view)
      this.revealActiveView(tabId, view)
      view.webContents.setBackgroundThrottling(false)
      if (prevTabId && prevTabId !== tabId) {
        const oldView = this.tabViews.get(prevTabId)
        oldView?.setVisible(false)
      }
      if (changed) {
        view.webContents.invalidate()
      }
    }

    const pendingUrl = this.pendingLoadUrls.get(tabId)
    if (pendingUrl) {
      this.pendingLoadUrls.delete(tabId)
      void view.webContents.loadURL(pendingUrl).catch(() => {
        // Ignore ERR_ABORTED during rapid redirects/closes
      })
    }
  }

  hideView(tabId: TabId, windowId: WindowId): void {
    const win = this.windows.get(windowId)
    const view = this.tabViews.get(tabId)
    if (!win || !view) return
    view.setVisible(false)
    if (win.attachedTabId === tabId) {
      win.attachedTabId = null
    }
  }

  detachView(tabId: TabId, windowId?: WindowId): void {
    const view = this.tabViews.get(tabId)
    if (!view) return

    const targets = windowId ? [this.windows.get(windowId)].filter(Boolean) : [...this.windows.values()]
    for (const win of targets) {
      if (!win) continue
      if (win.attachedTabId === tabId) {
        win.attachedTabId = null
      }
      win.mountedTabIds.delete(tabId)
      win.lastBoundsByTab.delete(tabId)
      try {
        win.baseWindow.contentView.removeChildView(view)
      } catch {
        // Ignore
      }
    }
  }

  destroyView(tabId: TabId): void {
    this.detachView(tabId)
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false })
    }
    this.tabViews.delete(tabId)
    this.tabIdToWorkspaceId.delete(tabId)
    this.pendingCertErrors.delete(tabId)
    this.pendingLoadUrls.delete(tabId)
    this.failedTabUrls.delete(tabId)
  }

  private isPermissionGranted(workspaceId: WorkspaceId, origin: string, permission: string): boolean {
    if (AUTO_ALLOWED_PERMISSIONS.has(permission)) return true
    const key = `${origin}|${permission}`
    return Boolean(this.grantedPermissions.get(workspaceId)?.has(key))
  }

  private async promptWorkspacePermission(
    workspaceId: WorkspaceId,
    origin: string,
    permission: string,
  ): Promise<boolean> {
    const cacheKey = `${workspaceId}|${origin}|${permission}`
    const existing = this.pendingPermissionPrompts.get(cacheKey)
    if (existing) return existing

    const task = (async () => {
      const ws = this.workspaceService.get(workspaceId)
      const label = PERMISSION_LABELS[permission] ?? permission
      const host = (() => {
        try {
          return new URL(origin).host || origin
        } catch {
          return origin
        }
      })()
      const win = this.getFocusedManagedWindow()?.baseWindow
      const options = {
        type: 'question' as const,
        title: '网页权限请求',
        message: `工作区「${ws?.name ?? workspaceId}」中的网站 ${host} 请求「${label}」权限`,
        detail: '权限策略按工作区独立隔离，不会影响其他工作区。',
        buttons: ['拒绝', '仅本次允许', '在本工作区允许'],
        defaultId: 0,
        cancelId: 0,
      }
      const res = win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options)

      const key = `${origin}|${permission}`
      if (res.response === 2) {
        let set = this.grantedPermissions.get(workspaceId)
        if (!set) {
          set = new Set<string>()
          this.grantedPermissions.set(workspaceId, set)
        }
        set.add(key)
        this.deniedPermissions.get(workspaceId)?.delete(key)
        return true
      }
      if (res.response === 1) {
        return true
      }
      let denied = this.deniedPermissions.get(workspaceId)
      if (!denied) {
        denied = new Set<string>()
        this.deniedPermissions.set(workspaceId, denied)
      }
      denied.add(key)
      return false
    })().finally(() => {
      this.pendingPermissionPrompts.delete(cacheKey)
    })

    this.pendingPermissionPrompts.set(cacheKey, task)
    return task
  }

  private ensureSessionPolicies(
    workspaceId: WorkspaceId,
    partition: string,
    ses: Electron.Session,
  ): void {
    if (this.configuredSessionPartitions.has(partition)) return
    this.configuredSessionPartitions.add(partition)

    ses.setCertificateVerifyProc((request, callback) => {
      const allowed = this.allowedInsecureCertHosts.get(workspaceId)
      if (allowed && allowed.has(request.hostname.toLowerCase())) {
        callback(0)
        return
      }
      callback(-3)
    })

    ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
      this.isPermissionGranted(workspaceId, requestingOrigin, permission),
    )

    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      if (AUTO_ALLOWED_PERMISSIONS.has(permission)) {
        callback(true)
        return
      }
      if (!PROMPTABLE_PERMISSIONS.has(permission)) {
        callback(false)
        return
      }
      const rawUrl = details?.requestingUrl || webContents.getURL()
      let origin = rawUrl
      try {
        origin = new URL(rawUrl).origin
      } catch {
        // Keep rawUrl
      }
      const key = `${origin}|${permission}`
      if (this.grantedPermissions.get(workspaceId)?.has(key)) {
        callback(true)
        return
      }
      if (this.deniedPermissions.get(workspaceId)?.has(key)) {
        callback(false)
        return
      }
      void this.promptWorkspacePermission(workspaceId, origin, permission).then(callback)
    })
  }

  setBackgroundThrottling(tabId: TabId, enabled: boolean): void {
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setBackgroundThrottling(enabled)
    }
  }

  showProxyAuthFailedError(wc: WebContents, targetUrl: string, host: string, port: number): void {
    if (wc.isDestroyed()) return
    let matchedTabId: TabId | undefined
    for (const [tId, view] of this.tabViews.entries()) {
      if (view.webContents === wc) {
        matchedTabId = tId
        break
      }
    }
    if (!matchedTabId) return

    const currentUrl = wc.getURL()
    if (currentUrl.startsWith('data:text/html')) return

    const resolvedUrl = targetUrl || currentUrl || `http://${host}:${port}/`
    const workspaceId = this.tabIdToWorkspaceId.get(matchedTabId)
    const ws = workspaceId ? this.workspaceService.get(workspaceId) : undefined
    this.failedTabUrls.set(matchedTabId, resolvedUrl)

    const html = buildLoadErrorHtml({
      url: resolvedUrl,
      errorCode: -127,
      errorDescription: `ERR_PROXY_AUTH_FAILED (HTTP 407 代理账号或密码错误: ${host}:${port})`,
      workspaceName: ws?.name ?? workspaceId ?? '',
      proxyMode: ws?.proxy.mode ?? 'custom',
    })

    if (workspaceId) {
      void this.tabLifecycle.updateTabMeta(workspaceId, matchedTabId, {
        loading: false,
        url: resolvedUrl,
        title: '代理服务器认证失败（HTTP 407）',
      })
    }

    setImmediate(() => {
      if (wc.isDestroyed()) return
      wc.stop()
      void wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => undefined)
    })
  }

  async captureSnapshot(tabId: TabId): Promise<Partial<TabSnapshot> | null> {
    const view = this.tabViews.get(tabId)
    if (!view || view.webContents.isDestroyed()) return null
    if (view.webContents.isLoadingMainFrame() || view.webContents.isLoading()) {
      return {
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const scroll = await Promise.race([
        view.webContents.executeJavaScript(
          '({ x: window.scrollX || 0, y: window.scrollY || 0 })',
        ) as Promise<{ x?: number; y?: number }>,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 500)
        }),
      ])
      return {
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
        scrollX: scroll?.x ?? 0,
        scrollY: scroll?.y ?? 0,
      }
    } catch {
      return {
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  navigate(tabId: TabId, urlOrQuery: string): void {
    const view = this.tabViews.get(tabId)
    if (!view || view.webContents.isDestroyed()) return
    void view.webContents.loadURL(normalizeNavigationInput(urlOrQuery)).catch(() => undefined)
  }

  goBack(tabId: TabId): void {
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed() && view.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack()
    }
  }

  goForward(tabId: TabId): void {
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed() && view.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward()
    }
  }

  reload(tabId: TabId, ignoreCache = false): void {
    const view = this.tabViews.get(tabId)
    if (!view || view.webContents.isDestroyed()) return
    const failedUrl = this.failedTabUrls.get(tabId)
    if (failedUrl && view.webContents.getURL().startsWith('data:text/html')) {
      void view.webContents
        .loadURL(
          failedUrl,
          ignoreCache
            ? { extraHeaders: 'Cache-Control: no-cache\nPragma: no-cache\n' }
            : undefined,
        )
        .catch(() => undefined)
      return
    }
    if (ignoreCache) {
      view.webContents.reloadIgnoringCache()
    } else {
      view.webContents.reload()
    }
  }

  async clearCacheAndReload(workspaceId: WorkspaceId, tabId: TabId): Promise<void> {
    const ws = this.workspaceService.get(workspaceId)
    if (ws) {
      await session.fromPartition(ws.partition, { cache: true }).clearCache()
    }
    this.reload(tabId, true)
  }

  async toggleMute(workspaceId: WorkspaceId, tabId: TabId): Promise<void> {
    const tab = this.tabLifecycle.getTab(workspaceId, tabId)
    if (!tab) return
    const nextMuted = !tab.muted
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setAudioMuted(nextMuted)
    }
    await this.tabLifecycle.updateTabMeta(workspaceId, tabId, { muted: nextMuted })
  }

  showTabContextMenu(windowId: WindowId, workspaceId: WorkspaceId, tabId: TabId): void {
    const win = this.windows.get(windowId)
    const tab = this.tabLifecycle.getTab(workspaceId, tabId)
    if (!win || win.baseWindow.isDestroyed() || !tab) return
    const tabs = this.tabLifecycle.getTabs(workspaceId)
    const items = buildTabContextMenuTemplate(
      {
        pinned: tab.pinned,
        muted: tab.muted,
        canClose: tabs.length > 1,
      },
      {
        reload: () => this.reload(tabId, false),
        hardReload: () => this.reload(tabId, true),
        clearCacheAndReload: () => void this.clearCacheAndReload(workspaceId, tabId),
        duplicate: () =>
          void this.tabLifecycle.createTab({ workspaceId, url: tab.url, activate: true }, windowId),
        togglePin: () =>
          void this.tabLifecycle.updateTabMeta(workspaceId, tabId, { pinned: !tab.pinned }),
        toggleMute: () => void this.toggleMute(workspaceId, tabId),
        openDevTools: () => this.openDevTools(tabId),
        close: () => {
          void this.tabLifecycle.closeTab(workspaceId, tabId, windowId).then((next) => {
            if (!next) {
              return this.tabLifecycle.createTab({ workspaceId, activate: true }, windowId)
            }
            return undefined
          })
        },
      },
    )
    Menu.buildFromTemplate(items).popup({ window: win.baseWindow })
  }

  showReloadMenu(windowId: WindowId, workspaceId: WorkspaceId, tabId: TabId): void {
    const win = this.windows.get(windowId)
    if (!win || win.baseWindow.isDestroyed()) return
    const items = buildReloadMenuTemplate({
      reload: () => this.reload(tabId, false),
      hardReload: () => this.reload(tabId, true),
      clearCacheAndReload: () => void this.clearCacheAndReload(workspaceId, tabId),
    })
    Menu.buildFromTemplate(items).popup({ window: win.baseWindow })
  }

  private getFocusedManagedWindow(): ManagedWindow | undefined {
    return (
      [...this.windows.values()].find((w) => !w.baseWindow.isDestroyed() && w.baseWindow.isFocused()) ??
      this.windows.values().next().value
    )
  }

  private getFocusedContext(): { win: ManagedWindow; workspaceId: WorkspaceId; tab: Tab | undefined } | null {
    const win = this.getFocusedManagedWindow()
    if (!win || win.baseWindow.isDestroyed()) return null
    const workspaceId = this.workspaceService.getActiveWorkspaceForWindow(win.id)
    const activeTabId = this.tabLifecycle.getActiveTabId(workspaceId)
    const tab = activeTabId ? this.tabLifecycle.getTab(workspaceId, activeTabId) : undefined
    return { win, workspaceId, tab }
  }

  async createTabInFocusedWindow(): Promise<void> {
    const ctx = this.getFocusedContext()
    if (!ctx) return
    await this.tabLifecycle.createTab({ workspaceId: ctx.workspaceId, activate: true }, ctx.win.id)
  }

  async closeFocusedTab(): Promise<void> {
    const ctx = this.getFocusedContext()
    if (!ctx?.tab) return
    const next = await this.tabLifecycle.closeTab(ctx.workspaceId, ctx.tab.id, ctx.win.id)
    if (!next) {
      await this.tabLifecycle.createTab({ workspaceId: ctx.workspaceId, activate: true }, ctx.win.id)
    }
  }

  reloadFocusedTab(ignoreCache = false): void {
    const ctx = this.getFocusedContext()
    if (ctx?.tab) this.reload(ctx.tab.id, ignoreCache)
  }

  async clearCacheAndReloadFocusedTab(): Promise<void> {
    const ctx = this.getFocusedContext()
    if (ctx?.tab) await this.clearCacheAndReload(ctx.workspaceId, ctx.tab.id)
  }

  goBackFocusedTab(): void {
    const ctx = this.getFocusedContext()
    if (ctx?.tab) this.goBack(ctx.tab.id)
  }

  goForwardFocusedTab(): void {
    const ctx = this.getFocusedContext()
    if (ctx?.tab) this.goForward(ctx.tab.id)
  }

  openDevToolsFocusedTab(): void {
    const ctx = this.getFocusedContext()
    if (ctx?.tab) this.openDevTools(ctx.tab.id)
  }

  async toggleMuteFocusedTab(): Promise<void> {
    const ctx = this.getFocusedContext()
    if (ctx?.tab) await this.toggleMute(ctx.workspaceId, ctx.tab.id)
  }

  adjustZoomFocusedTab(mode: 'reset' | 'in' | 'out'): void {
    const ctx = this.getFocusedContext()
    if (!ctx?.tab) return
    const view = this.tabViews.get(ctx.tab.id)
    if (!view || view.webContents.isDestroyed()) return
    if (mode === 'reset') {
      view.webContents.setZoomLevel(0)
      return
    }
    const cur = view.webContents.getZoomLevel()
    view.webContents.setZoomLevel(mode === 'in' ? Math.min(cur + 0.5, 5) : Math.max(cur - 0.5, -5))
  }

  focusFocusedOmnibox(): void {
    const win = this.getFocusedManagedWindow()
    if (!win || win.chromeView.webContents.isDestroyed()) return
    win.chromeView.webContents.focus()
    win.chromeView.webContents.send(IPC_CHANNELS.CHROME_FOCUS_OMNIBOX)
  }

  openDevTools(tabId: TabId): void {
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.openDevTools({ mode: 'detach' })
    }
  }

  private isTabAttachedElsewhere(tabId: TabId, targetWindowId: WindowId): boolean {
    for (const [winId, win] of this.windows.entries()) {
      if (winId !== targetWindowId && win.attachedTabId === tabId) {
        return true
      }
    }
    return false
  }

  private async ensureActiveTabForWorkspace(workspaceId: WorkspaceId, windowId: WindowId): Promise<void> {
    const tabs = this.tabLifecycle.getTabs(workspaceId)
    if (tabs.length === 0) {
      await this.tabLifecycle.createTab({ workspaceId, activate: true }, windowId)
      return
    }
    const activeId = this.tabLifecycle.getActiveTabId(workspaceId) ?? tabs[0]!.id
    if (this.isTabAttachedElsewhere(activeId, windowId)) {
      const sourceTab = tabs.find((t) => t.id === activeId)
      const fallbackUrl =
        sourceTab?.url && /^https?:\/\//i.test(sourceTab.url) ? sourceTab.url : undefined
      await this.tabLifecycle.createTab({ workspaceId, url: fallbackUrl, activate: true }, windowId)
      return
    }
    await this.tabLifecycle.activateTab(workspaceId, activeId, windowId)
  }

  private wireWebContentsEvents(tabId: TabId, workspaceId: WorkspaceId, view: WebContentsView): void {
    const wc = view.webContents

    wc.setWindowOpenHandler(({ url }) => {
      const targetWinId =
        [...this.windows.values()].find((w) => w.attachedTabId === tabId)?.id ??
        this.windows.keys().next().value
      void this.tabLifecycle.createTab({ workspaceId, url, activate: true }, targetWinId)
      return { action: 'deny' }
    })

    const syncNav = (): void => {
      if (wc.isDestroyed()) return
      const currentUrl = wc.getURL()
      if (currentUrl.startsWith('data:text/html')) return
      if ([...this.windows.values()].some((win) => win.attachedTabId === tabId && !win.overlayOpen)) {
        this.revealActiveView(tabId, view)
      }
      this.pendingCertErrors.delete(tabId)
      this.failedTabUrls.delete(tabId)
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, {
        url: currentUrl,
        title: currentUrl === NEW_TAB_URL ? '新标签页' : wc.getTitle() || currentUrl,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      })
    }

    wc.on('dom-ready', () => {
      if (wc.isDestroyed()) return
      const attachedWin = [...this.windows.values()].find(
        (w) => !w.baseWindow.isDestroyed() && w.attachedTabId === tabId && !w.overlayOpen,
      )
      if (attachedWin) {
        this.revealActiveView(tabId, view)
        view.setBounds(attachedWin.viewportBounds)
        wc.setBackgroundThrottling(false)
        wc.invalidate()
      }
    })

    wc.on('certificate-error', (event, url, error, certificate, callback) => {
      let hostname = ''
      try {
        hostname = new URL(url).hostname.toLowerCase()
      } catch {
        hostname = ''
      }
      if (hostname && this.allowedInsecureCertHosts.get(workspaceId)?.has(hostname)) {
        event.preventDefault()
        callback(true)
        return
      }
      if (hostname) {
        this.pendingCertErrors.set(tabId, {
          hostname,
          url,
          error,
          subject: certificate?.subjectName,
          issuer: certificate?.issuerName,
          token: randomUUID(),
        })
      }
      callback(false)
    })

    wc.on('will-navigate', (event, navUrl) => {
      if (!navUrl.startsWith('http://mulspace.internal/proceed-unsafe')) return
      event.preventDefault()
      let token = ''
      try {
        token = new URL(navUrl).searchParams.get('token') ?? ''
      } catch {
        return
      }
      const pending = this.pendingCertErrors.get(tabId)
      if (!pending || !token || pending.token !== token) return

      let allowed = this.allowedInsecureCertHosts.get(workspaceId)
      if (!allowed) {
        allowed = new Set<string>()
        this.allowedInsecureCertHosts.set(workspaceId, allowed)
      }
      allowed.add(pending.hostname)
      this.pendingCertErrors.delete(tabId)
      void wc.loadURL(pending.url).catch(() => undefined)
    })

    wc.on('did-navigate', syncNav)
    wc.on('did-navigate-in-page', syncNav)
    wc.on('page-title-updated', (_e, title) => {
      if (wc.getURL() === NEW_TAB_URL) return
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, { title })
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      if (favicons[0]) {
        void this.tabLifecycle.updateTabMeta(workspaceId, tabId, { faviconUrl: favicons[0] })
      }
    })
    wc.on('did-start-loading', () => {
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, { loading: true })
    })
    wc.on('did-stop-loading', () => {
      if (wc.isDestroyed()) return
      const currentUrl = wc.getURL()
      if ([...this.windows.values()].some((win) => win.attachedTabId === tabId && !win.overlayOpen)) {
        this.revealActiveView(tabId, view)
      }
      if (!currentUrl || currentUrl.startsWith('data:text/html')) {
        void this.tabLifecycle.updateTabMeta(workspaceId, tabId, { loading: false })
        return
      }
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, {
        loading: false,
        url: currentUrl,
        title: currentUrl === NEW_TAB_URL ? '新标签页' : wc.getTitle() || currentUrl,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      })
    })
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (wc.isDestroyed() || !isMainFrame) return
      if (errorCode === -3 || !validatedURL || validatedURL.startsWith('data:')) return
      const ws = this.workspaceService.get(workspaceId)

      let pendingCert = this.pendingCertErrors.get(tabId)
      if (!pendingCert && errorCode <= -200 && errorCode >= -217) {
        try {
          const hostname = new URL(validatedURL).hostname.toLowerCase()
          pendingCert = {
            hostname,
            url: validatedURL,
            error: errorDescription,
            token: randomUUID(),
          }
          this.pendingCertErrors.set(tabId, pendingCert)
        } catch {
          // Ignore malformed URL
        }
      }

      this.failedTabUrls.set(tabId, validatedURL)
      const html = buildLoadErrorHtml({
        url: validatedURL,
        errorCode,
        errorDescription,
        workspaceName: ws?.name ?? workspaceId,
        proxyMode: ws?.proxy.mode ?? 'system',
        proceedUnsafeUrl: pendingCert
          ? `http://mulspace.internal/proceed-unsafe?token=${encodeURIComponent(pendingCert.token)}`
          : undefined,
        hostname: pendingCert?.hostname,
        certSubject: pendingCert?.subject,
        certIssuer: pendingCert?.issuer,
      })
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, {
        loading: false,
        url: validatedURL,
        title: '无法访问此网站',
      })
      void wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => undefined)
    })
    wc.on('media-started-playing', () => {
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, { audible: true })
    })
    wc.on('media-paused', () => {
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, { audible: false })
    })
    wc.on('audio-state-changed', (event) => {
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, { audible: event.audible })
    })

    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F5') {
        event.preventDefault()
        this.reload(tabId, Boolean(input.control || input.shift || input.meta))
      } else if (input.key === 'F12') {
        event.preventDefault()
        this.openDevTools(tabId)
      }
    })

    wc.on('context-menu', (_event, params) => {
      if (wc.isDestroyed()) return
      const targetWin =
        [...this.windows.values()].find((w) => w.attachedTabId === tabId) ??
        this.windows.values().next().value
      if (!targetWin || targetWin.baseWindow.isDestroyed()) return

      const currentTab = this.tabLifecycle.getTab(workspaceId, tabId)
      const pageUrl = wc.getURL()
      const items = buildPageContextMenuTemplate(
        {
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          pageUrl,
          linkURL: params.linkURL,
          srcURL: params.srcURL,
          mediaType: params.mediaType,
          selectionText: params.selectionText,
          isEditable: params.isEditable,
          muted: Boolean(currentTab?.muted),
          editFlags: params.editFlags,
        },
        {
          goBack: () => this.goBack(tabId),
          goForward: () => this.goForward(tabId),
          reload: () => this.reload(tabId, false),
          hardReload: () => this.reload(tabId, true),
          clearCacheAndReload: () => void this.clearCacheAndReload(workspaceId, tabId),
          openLinkInNewTab: (url) =>
            void this.tabLifecycle.createTab({ workspaceId, url, activate: true }, targetWin.id),
          copyText: (text) => clipboard.writeText(text),
          copyImageAt: () => wc.copyImageAt(params.x, params.y),
          downloadUrl: (url) => wc.downloadURL(url),
          searchSelection: (text) =>
            void this.tabLifecycle.createTab(
              {
                workspaceId,
                url: `https://www.bing.com/search?q=${encodeURIComponent(text)}`,
                activate: true,
              },
              targetWin.id,
            ),
          undo: () => wc.undo(),
          redo: () => wc.redo(),
          cut: () => wc.cut(),
          copy: () => wc.copy(),
          paste: () => wc.paste(),
          pasteAndMatchStyle: () => wc.pasteAndMatchStyle(),
          deleteSelection: () => wc.delete(),
          selectAll: () => wc.selectAll(),
          toggleMute: () => void this.toggleMute(workspaceId, tabId),
          print: () => wc.print(),
          viewSource: (url) =>
            void this.tabLifecycle.createTab(
              { workspaceId, url: `view-source:${url}`, activate: true },
              targetWin.id,
            ),
          inspectElement: () => wc.inspectElement(params.x, params.y),
        },
      )
      Menu.buildFromTemplate(items).popup({ window: targetWin.baseWindow })
    })
  }
}
