import { is } from '@electron-toolkit/utils'
import {
  IPC_CHANNELS,
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
import { BaseWindow, WebContentsView, session, type WebContents } from 'electron'
import { join } from 'node:path'
import { buildLoadErrorHtml } from './error-page.js'

interface ManagedWindow {
  id: WindowId
  baseWindow: BaseWindow
  chromeView: WebContentsView
  viewportBounds: ViewportBounds
  attachedTabId: TabId | null
  overlayOpen: boolean
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

    const broadcastAll = (): void => {
      for (const winId of this.windows.keys()) {
        this.pushSnapshotToWindow(winId)
      }
    }

    this.kernel.events.on('workspace:created', broadcastAll)
    this.kernel.events.on('workspace:updated', broadcastAll)
    this.kernel.events.on('workspace:deleted', broadcastAll)
    this.kernel.events.on('workspace:switched', ({ windowId }) => {
      this.pushSnapshotToWindow(windowId)
    })
    this.kernel.events.on('tab:created', broadcastAll)
    this.kernel.events.on('tab:updated', broadcastAll)
    this.kernel.events.on('tab:closed', broadcastAll)
    this.kernel.events.on('tab:lifecycle-changed', broadcastAll)
    this.kernel.events.on('settings:updated', broadcastAll)
    this.kernel.events.on('proxy:updated', broadcastAll)
    this.kernel.events.on('extensions:updated', broadcastAll)
    this.kernel.events.on('themes:updated', broadcastAll)
    this.kernel.events.on('update:state-changed', broadcastAll)
    this.kernel.events.on('ai:message', () => {
      this.aiMessageSeq++
      broadcastAll()
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
    const ses = session.fromPartition(workspace.partition, { cache: true })
    if (config.auth) {
      this.proxyAuthByPartition.set(workspace.partition, config.auth)
    } else {
      this.proxyAuthByPartition.delete(workspace.partition)
    }

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

  async createBrowserWindow(targetWorkspaceId?: WorkspaceId): Promise<WindowId> {
    const windowId = `win_${++this.windowSeq}`
    const workspaceId = targetWorkspaceId ?? this.workspaceService.getDefaultWorkspaceId()

    const baseWindow = new BaseWindow({
      width: 1380,
      height: 880,
      minWidth: 940,
      minHeight: 620,
      show: false,
      title: 'Mulspace — 多账号工作区 AI 浏览器',
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

    const managed: ManagedWindow = {
      id: windowId,
      baseWindow,
      chromeView,
      viewportBounds: { x: 64, y: 88, width: 1200, height: 740 },
      attachedTabId: null,
      overlayOpen: false,
    }

    this.windows.set(windowId, managed)
    this.chromeWebContentsToWindowId.set(chromeView.webContents.id, windowId)

    const syncChromeSize = (): void => {
      const [w, h] = baseWindow.getContentSize()
      chromeView.setBounds({ x: 0, y: 0, width: w ?? 1380, height: h ?? 880 })
    }

    baseWindow.on('resize', syncChromeSize)
    baseWindow.on('closed', () => {
      this.chromeWebContentsToWindowId.delete(chromeView.webContents.id)
      this.windows.delete(windowId)
      this.workspaceService.unbindWindow(windowId)
    })

    syncChromeSize()

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      await chromeView.webContents.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      await chromeView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
    }

    await this.workspaceService.bindWindowToWorkspace(windowId, workspaceId)
    await this.ensureActiveTabForWorkspace(workspaceId, windowId)

    baseWindow.show()
    this.pushSnapshotToWindow(windowId)
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

    await this.tabLifecycle.freezeWorkspaceViews(currentWsId, windowId)
    await this.workspaceService.bindWindowToWorkspace(windowId, workspaceId)
    await this.ensureActiveTabForWorkspace(workspaceId, windowId)
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
      view?.setBounds(win.viewportBounds)
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
      try {
        win.baseWindow.contentView.removeChildView(view)
      } catch {
        // Ignore
      }
    } else {
      win.baseWindow.contentView.addChildView(view)
      view.setBounds(win.viewportBounds)
    }
  }

  getSnapshot(windowId: WindowId): BrowserWindowSnapshot {
    const activeWorkspaceId = this.workspaceService.getActiveWorkspaceForWindow(windowId)
    return {
      windowId,
      activeWorkspaceId,
      workspaces: this.workspaceService.list(),
      tabsByWorkspace: this.tabLifecycle.getAllTabsByWorkspace(),
      settings: this.getSettings(),
      themes: defaultThemeRegistry.list(),
      memorySummary: this.tabLifecycle.getMemorySummary(),
      proxyStatus: this.proxyService?.getStatus() ?? {
        coreKind: 'mihomo',
        binaryFound: false,
        binaryPath: null,
        running: false,
        controllerUrl: null,
        workspaceStatuses: {},
      },
      proxySubscriptions: this.proxyService?.listSubscriptions() ?? [],
      proxyNodes: this.proxyService?.listNodes() ?? [],
      extensions: this.extensionService?.list() ?? [],
      mcpHostStatus: this.agentService?.getMcpHostStatus() ?? {
        running: false,
        endpointUrl: null,
        config: this.getSettings().mcpHost,
        clientSnippet: '{}',
      },
      updateState: this.updateService?.getState() ?? {
        status: 'idle',
        currentVersion: '0.1.0',
        latestVersion: null,
        repoSlug: 'EastAndWeast/Mulspace',
      },
      aiMessageSeq: this.aiMessageSeq,
    }
  }

  pushSnapshotToWindow(windowId: WindowId): void {
    const win = this.windows.get(windowId)
    if (!win || win.chromeView.webContents.isDestroyed()) return
    win.chromeView.webContents.send(IPC_CHANNELS.STATE_UPDATED, this.getSnapshot(windowId))
  }

  // ---- ITabViewAdapter Implementation ----

  async createView(tab: Tab, workspace: Workspace): Promise<void> {
    if (this.tabViews.has(tab.id)) return

    const ses = session.fromPartition(workspace.partition, { cache: true })
    if (workspace.isolation.userAgent) {
      ses.setUserAgent(workspace.isolation.userAgent)
    }

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    view.webContents.setWebRTCIPHandlingPolicy(workspace.isolation.webrtcPolicy)
    if (workspace.isolation.userAgent) {
      view.webContents.setUserAgent(workspace.isolation.userAgent)
    }

    this.tabViews.set(tab.id, view)
    this.tabIdToWorkspaceId.set(tab.id, workspace.id)
    this.wireWebContentsEvents(tab.id, workspace.id, view)

    const targetUrl = tab.snapshot?.url ?? tab.url
    void view.webContents.loadURL(normalizeNavigationInput(targetUrl)).catch(() => {
      // Ignore ERR_ABORTED during rapid redirects/closes
    })
  }

  attachView(tabId: TabId, windowId: WindowId): void {
    const win = this.windows.get(windowId)
    const view = this.tabViews.get(tabId)
    if (!win || !view) return

    if (win.attachedTabId && win.attachedTabId !== tabId) {
      const oldView = this.tabViews.get(win.attachedTabId)
      if (oldView) {
        try {
          win.baseWindow.contentView.removeChildView(oldView)
        } catch {
          // Ignore
        }
      }
    }

    win.attachedTabId = tabId
    if (!win.overlayOpen) {
      win.baseWindow.contentView.addChildView(view)
      view.setBounds(win.viewportBounds)
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
  }

  setBackgroundThrottling(tabId: TabId, enabled: boolean): void {
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setBackgroundThrottling(enabled)
    }
  }

  async captureSnapshot(tabId: TabId): Promise<Partial<TabSnapshot> | null> {
    const view = this.tabViews.get(tabId)
    if (!view || view.webContents.isDestroyed()) return null
    try {
      const scroll = (await view.webContents.executeJavaScript(
        '({ x: window.scrollX || 0, y: window.scrollY || 0 })',
      )) as { x?: number; y?: number }
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

  reload(tabId: TabId): void {
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload()
    }
  }

  openDevTools(tabId: TabId): void {
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.openDevTools({ mode: 'detach' })
    }
  }

  private async ensureActiveTabForWorkspace(workspaceId: WorkspaceId, windowId: WindowId): Promise<void> {
    const tabs = this.tabLifecycle.getTabs(workspaceId)
    if (tabs.length === 0) {
      await this.tabLifecycle.createTab({ workspaceId, activate: true }, windowId)
      return
    }
    const activeId = this.tabLifecycle.getActiveTabId(workspaceId) ?? tabs[0]!.id
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
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, {
        url: currentUrl,
        title: wc.getTitle() || currentUrl,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      })
    }

    wc.on('did-navigate', syncNav)
    wc.on('did-navigate-in-page', syncNav)
    wc.on('page-title-updated', (_e, title) => {
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
      if (currentUrl.startsWith('data:text/html')) {
        void this.tabLifecycle.updateTabMeta(workspaceId, tabId, { loading: false })
        return
      }
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, {
        loading: false,
        url: currentUrl,
        title: wc.getTitle() || currentUrl,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      })
    })
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (wc.isDestroyed() || !isMainFrame) return
      if (errorCode === -3 || !validatedURL || validatedURL.startsWith('data:')) return
      const ws = this.workspaceService.get(workspaceId)
      const html = buildLoadErrorHtml({
        url: validatedURL,
        errorCode,
        errorDescription,
        workspaceName: ws?.name ?? workspaceId,
        proxyMode: ws?.proxy.mode ?? 'system',
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
  }
}
