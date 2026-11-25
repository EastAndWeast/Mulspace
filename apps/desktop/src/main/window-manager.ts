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
import { BaseWindow, Menu, WebContentsView, clipboard, session, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  buildChromeContextMenuTemplate,
  buildPageContextMenuTemplate,
  buildReloadMenuTemplate,
  buildTabContextMenuTemplate,
} from './context-menu.js'
import { buildLoadErrorHtml } from './error-page.js'

const ALLOWED_SESSION_PERMISSIONS = new Set<string>([
  'notifications',
  'media',
  'audioCapture',
  'speaker-selection',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
])

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
  private readonly allowedInsecureCertHosts = new Map<WorkspaceId, Set<string>>()
  private readonly configuredSessionPartitions = new Set<string>()
  private readonly pendingCertErrors = new Map<
    TabId,
    { hostname: string; url: string; error: string; subject?: string; issuer?: string; token: string }
  >()

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
    this.kernel.events.on('workspace:deleted', ({ workspaceId }) => {
      this.allowedInsecureCertHosts.delete(workspaceId)
      broadcastAll()
    })
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
    this.ensureSessionPolicies(workspace.id, workspace.partition, ses)
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
    view.webContents.setAudioMuted(Boolean(tab.muted))
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
    this.pendingCertErrors.delete(tabId)
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

    ses.setPermissionCheckHandler((_webContents, permission) =>
      ALLOWED_SESSION_PERMISSIONS.has(permission),
    )
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(ALLOWED_SESSION_PERMISSIONS.has(permission))
    })
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

  reload(tabId: TabId, ignoreCache = false): void {
    const view = this.tabViews.get(tabId)
    if (view && !view.webContents.isDestroyed()) {
      if (ignoreCache) {
        view.webContents.reloadIgnoringCache()
      } else {
        view.webContents.reload()
      }
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
      this.pendingCertErrors.delete(tabId)
      void this.tabLifecycle.updateTabMeta(workspaceId, tabId, {
        url: currentUrl,
        title: wc.getTitle() || currentUrl,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      })
    }

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
