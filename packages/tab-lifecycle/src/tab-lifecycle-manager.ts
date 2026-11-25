import { randomUUID } from 'node:crypto'
import {
  createServiceToken,
  type AppSettings,
  type CreateTabInput,
  type IKernelContext,
  type IKernelModule,
  type IStorageRepository,
  type Tab,
  type TabId,
  type TabLifecycleState,
  type TabMemorySummary,
  type TabSnapshot,
  type WindowId,
  type Workspace,
  type WorkspaceId,
} from '@wb/contracts'

export const TabLifecycleToken = createServiceToken<TabLifecycleManager>('TabLifecycleManager')

export interface ITabViewAdapter {
  createView(tab: Tab, workspace: Workspace): Promise<void> | void
  attachView(tabId: TabId, windowId: WindowId): Promise<void> | void
  detachView(tabId: TabId, windowId?: WindowId): Promise<void> | void
  destroyView(tabId: TabId): Promise<void> | void
  setBackgroundThrottling(tabId: TabId, enabled: boolean): Promise<void> | void
  captureSnapshot(tabId: TabId): Promise<Partial<TabSnapshot> | null> | Partial<TabSnapshot> | null
  navigate?(tabId: TabId, url: string): Promise<void> | void
  goBack?(tabId: TabId): Promise<void> | void
  goForward?(tabId: TabId): Promise<void> | void
  reload?(tabId: TabId, ignoreCache?: boolean): Promise<void> | void
  openDevTools?(tabId: TabId): Promise<void> | void
}

export interface TabLifecycleOptions {
  getWorkspace(workspaceId: WorkspaceId): Workspace | undefined
  getSettings(): AppSettings
  adapter: ITabViewAdapter
}

export class TabLifecycleManager implements IKernelModule {
  readonly id = 'tab-lifecycle'

  private ctx!: IKernelContext
  private readonly tabsByWorkspace = new Map<WorkspaceId, Tab[]>()
  private readonly activeTabByWorkspace = new Map<WorkspaceId, TabId>()
  private readonly attachedWindowByTab = new Map<TabId, WindowId>()
  private readonly createdViews = new Set<TabId>()

  constructor(
    private readonly storage: IStorageRepository,
    private readonly options: TabLifecycleOptions,
  ) {}

  async init(ctx: IKernelContext): Promise<void> {
    this.ctx = ctx
    const state = await this.storage.loadState()
    for (const ws of state.workspaces) {
      const persistedTabs = (state.tabsByWorkspace[ws.id] ?? []).map((t) => ({
        ...t,
        state: 'discarded' as TabLifecycleState,
        loading: false,
        audible: false,
      }))
      this.tabsByWorkspace.set(ws.id, persistedTabs)
      if (ws.activeTabId && persistedTabs.some((t) => t.id === ws.activeTabId)) {
        this.activeTabByWorkspace.set(ws.id, ws.activeTabId)
      } else if (persistedTabs[0]) {
        this.activeTabByWorkspace.set(ws.id, persistedTabs[0].id)
      }
    }

    ctx.events.on('workspace:created', ({ workspace }) => {
      if (!this.tabsByWorkspace.has(workspace.id)) {
        this.tabsByWorkspace.set(workspace.id, [])
      }
    })

    ctx.events.on('workspace:deleted', async ({ workspaceId }) => {
      const tabs = this.tabsByWorkspace.get(workspaceId) ?? []
      for (const tab of tabs) {
        if (this.createdViews.has(tab.id)) {
          await this.options.adapter.destroyView(tab.id)
          this.createdViews.delete(tab.id)
          this.attachedWindowByTab.delete(tab.id)
        }
      }
      this.tabsByWorkspace.delete(workspaceId)
      this.activeTabByWorkspace.delete(workspaceId)
    })

    ctx.services.register(TabLifecycleToken, this)
  }

  getTabs(workspaceId: WorkspaceId): Tab[] {
    return (this.tabsByWorkspace.get(workspaceId) ?? []).map((t) => structuredClone(t))
  }

  getAllTabsByWorkspace(): Record<WorkspaceId, Tab[]> {
    const out: Record<WorkspaceId, Tab[]> = {}
    for (const [wsId, tabs] of this.tabsByWorkspace.entries()) {
      out[wsId] = tabs.map((t) => structuredClone(t))
    }
    return out
  }

  getTab(workspaceId: WorkspaceId, tabId: TabId): Tab | undefined {
    const tab = (this.tabsByWorkspace.get(workspaceId) ?? []).find((t) => t.id === tabId)
    return tab ? structuredClone(tab) : undefined
  }

  getActiveTabId(workspaceId: WorkspaceId): TabId | null {
    return this.activeTabByWorkspace.get(workspaceId) ?? null
  }

  async createTab(input: CreateTabInput, windowId?: WindowId, now = Date.now()): Promise<Tab> {
    const ws = this.options.getWorkspace(input.workspaceId)
    if (!ws) {
      throw new Error(`Workspace not found: ${input.workspaceId}`)
    }

    const tab: Tab = {
      id: `tab_${randomUUID().slice(0, 8)}`,
      workspaceId: input.workspaceId,
      url: input.url ?? 'https://www.bing.com',
      title: input.title ?? '新标签页',
      state: 'discarded',
      pinned: input.pinned ?? false,
      muted: false,
      audible: false,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      aiBusy: false,
      lockedFromDiscard: false,
      lastActiveAt: now,
    }

    const list = this.tabsByWorkspace.get(input.workspaceId) ?? []
    list.push(tab)
    this.tabsByWorkspace.set(input.workspaceId, list)

    const shouldActivate = input.activate ?? true
    if (shouldActivate && windowId) {
      await this.activateTab(input.workspaceId, tab.id, windowId, now)
    } else if (shouldActivate) {
      this.activeTabByWorkspace.set(input.workspaceId, tab.id)
    }

    await this.persistWorkspaceTabs(input.workspaceId)
    const latest = this.findTabMut(input.workspaceId, tab.id)!
    this.ctx.events.emit('tab:created', { tab: structuredClone(latest) })
    return structuredClone(latest)
  }

  async activateTab(
    workspaceId: WorkspaceId,
    tabId: TabId,
    windowId: WindowId,
    now = Date.now(),
  ): Promise<Tab> {
    const ws = this.options.getWorkspace(workspaceId)
    if (!ws) throw new Error(`Workspace not found: ${workspaceId}`)

    const tab = this.findTabMut(workspaceId, tabId)
    if (!tab) throw new Error(`Tab not found: ${tabId}`)

    // Freeze any other tab currently attached to this window.
    for (const [attachedTabId, attachedWinId] of [...this.attachedWindowByTab.entries()]) {
      if (attachedWinId === windowId && attachedTabId !== tabId) {
        const prev = this.findTabAcrossWorkspacesMut(attachedTabId)
        if (prev) {
          await this.transitionToFrozen(prev, windowId, now)
        }
      }
    }

    const prevState = tab.state
    if (!this.createdViews.has(tab.id) || tab.state === 'discarded') {
      await this.options.adapter.createView(structuredClone(tab), ws)
      this.createdViews.add(tab.id)
    }

    await this.options.adapter.setBackgroundThrottling(tab.id, false)
    await this.options.adapter.attachView(tab.id, windowId)
    this.attachedWindowByTab.set(tab.id, windowId)
    this.activeTabByWorkspace.set(workspaceId, tab.id)

    tab.state = 'active'
    tab.lastActiveAt = now
    if (prevState !== 'active') {
      this.ctx.events.emit('tab:lifecycle-changed', {
        workspaceId,
        tabId: tab.id,
        from: prevState,
        to: 'active',
      })
    }

    await this.enforceLiveTabCap(now)
    await this.persistWorkspaceTabs(workspaceId)
    this.ctx.events.emit('tab:updated', { tab: structuredClone(tab) })
    return structuredClone(tab)
  }

  async freezeWorkspaceViews(workspaceId: WorkspaceId, windowId: WindowId, now = Date.now()): Promise<void> {
    const tabs = this.tabsByWorkspace.get(workspaceId) ?? []
    for (const tab of tabs) {
      if (tab.state === 'active' && this.attachedWindowByTab.get(tab.id) === windowId) {
        await this.transitionToFrozen(tab, windowId, now)
      }
    }
    await this.persistWorkspaceTabs(workspaceId)
  }

  async closeTab(workspaceId: WorkspaceId, tabId: TabId, windowId?: WindowId): Promise<TabId | null> {
    const list = this.tabsByWorkspace.get(workspaceId) ?? []
    const idx = list.findIndex((t) => t.id === tabId)
    if (idx < 0) return this.activeTabByWorkspace.get(workspaceId) ?? null

    const [removed] = list.splice(idx, 1)
    if (removed && this.createdViews.has(removed.id)) {
      await this.options.adapter.destroyView(removed.id)
      this.createdViews.delete(removed.id)
      this.attachedWindowByTab.delete(removed.id)
    }

    let nextActiveId: TabId | null = this.activeTabByWorkspace.get(workspaceId) ?? null
    if (nextActiveId === tabId) {
      const candidate = list[idx] ?? list[idx - 1] ?? null
      nextActiveId = candidate?.id ?? null
      if (nextActiveId) {
        this.activeTabByWorkspace.set(workspaceId, nextActiveId)
        if (windowId) {
          await this.activateTab(workspaceId, nextActiveId, windowId)
        }
      } else {
        this.activeTabByWorkspace.delete(workspaceId)
      }
    }

    await this.persistWorkspaceTabs(workspaceId)
    this.ctx.events.emit('tab:closed', { workspaceId, tabId })
    return nextActiveId
  }

  async updateTabMeta(
    workspaceId: WorkspaceId,
    tabId: TabId,
    patch: Partial<
      Pick<
        Tab,
        | 'url'
        | 'title'
        | 'faviconUrl'
        | 'loading'
        | 'canGoBack'
        | 'canGoForward'
        | 'audible'
        | 'muted'
        | 'pinned'
        | 'aiBusy'
        | 'lockedFromDiscard'
      >
    >,
  ): Promise<Tab | undefined> {
    const tab = this.findTabMut(workspaceId, tabId)
    if (!tab) return undefined
    Object.assign(tab, patch)
    await this.persistWorkspaceTabs(workspaceId)
    this.ctx.events.emit('tab:updated', { tab: structuredClone(tab) })
    return structuredClone(tab)
  }

  async discardTab(workspaceId: WorkspaceId, tabId: TabId, force = false): Promise<boolean> {
    const tab = this.findTabMut(workspaceId, tabId)
    if (!tab) return false
    if (!force && !this.canDiscardTab(tab)) return false
    if (tab.state === 'discarded') return true

    const prev = tab.state
    const snapshotPatch = this.createdViews.has(tab.id)
      ? await this.options.adapter.captureSnapshot(tab.id)
      : null

    tab.snapshot = {
      url: snapshotPatch?.url ?? tab.url,
      title: snapshotPatch?.title ?? tab.title,
      faviconUrl: snapshotPatch?.faviconUrl ?? tab.faviconUrl,
      scrollX: snapshotPatch?.scrollX,
      scrollY: snapshotPatch?.scrollY,
      capturedAt: Date.now(),
    }

    if (this.createdViews.has(tab.id)) {
      await this.options.adapter.destroyView(tab.id)
      this.createdViews.delete(tab.id)
      this.attachedWindowByTab.delete(tab.id)
    }

    tab.state = 'discarded'
    tab.loading = false
    tab.audible = false

    this.ctx.events.emit('tab:lifecycle-changed', {
      workspaceId,
      tabId: tab.id,
      from: prev,
      to: 'discarded',
    })
    await this.persistWorkspaceTabs(workspaceId)
    this.ctx.events.emit('tab:updated', { tab: structuredClone(tab) })
    return true
  }

  async runMaintenanceSweep(now = Date.now()): Promise<TabMemorySummary> {
    const settings = this.options.getSettings()
    for (const [wsId, tabs] of this.tabsByWorkspace.entries()) {
      for (const tab of tabs) {
        if (tab.state === 'active' && !this.attachedWindowByTab.has(tab.id)) {
          await this.transitionToFrozen(tab, undefined, now)
        }
        const idleMs = now - tab.lastActiveAt
        if (tab.state === 'frozen' && idleMs >= settings.discardAfterMs && this.canDiscardTab(tab)) {
          await this.discardTab(wsId, tab.id)
        } else if (tab.state === 'active' && !this.attachedWindowByTab.has(tab.id) && idleMs >= settings.freezeAfterMs) {
          await this.transitionToFrozen(tab, undefined, now)
        }
      }
    }

    await this.enforceLiveTabCap(now)
    return this.getMemorySummary()
  }

  async discardAllBackgroundTabs(): Promise<TabMemorySummary> {
    for (const [wsId, tabs] of this.tabsByWorkspace.entries()) {
      for (const tab of tabs) {
        if (tab.state !== 'active' && this.canDiscardTab(tab)) {
          await this.discardTab(wsId, tab.id)
        }
      }
    }
    return this.getMemorySummary()
  }

  getMemorySummary(): TabMemorySummary {
    const byWorkspace: TabMemorySummary['byWorkspace'] = {}
    let totalTabs = 0
    let activeTabs = 0
    let frozenTabs = 0
    let discardedTabs = 0

    for (const [wsId, tabs] of this.tabsByWorkspace.entries()) {
      let active = 0
      let frozen = 0
      let discarded = 0
      for (const tab of tabs) {
        if (tab.state === 'active') active++
        else if (tab.state === 'frozen') frozen++
        else discarded++
      }
      byWorkspace[wsId] = { total: tabs.length, active, frozen, discarded }
      totalTabs += tabs.length
      activeTabs += active
      frozenTabs += frozen
      discardedTabs += discarded
    }

    return { totalTabs, activeTabs, frozenTabs, discardedTabs, byWorkspace }
  }

  private canDiscardTab(tab: Tab): boolean {
    if (tab.state === 'active') return false
    return !(tab.pinned || tab.audible || tab.aiBusy || tab.lockedFromDiscard)
  }

  private async transitionToFrozen(tab: Tab, windowId?: WindowId, _now = Date.now()): Promise<void> {
    const prev = tab.state
    if (this.createdViews.has(tab.id)) {
      await this.options.adapter.detachView(tab.id, windowId)
      await this.options.adapter.setBackgroundThrottling(tab.id, true)
    }
    this.attachedWindowByTab.delete(tab.id)
    tab.state = 'frozen'
    if (prev !== 'frozen') {
      this.ctx.events.emit('tab:lifecycle-changed', {
        workspaceId: tab.workspaceId,
        tabId: tab.id,
        from: prev,
        to: 'frozen',
      })
      this.ctx.events.emit('tab:updated', { tab: structuredClone(tab) })
    }
  }

  private async enforceLiveTabCap(_now: number): Promise<void> {
    const { maxLiveTabs } = this.options.getSettings()
    const liveCandidates: Tab[] = []

    for (const tabs of this.tabsByWorkspace.values()) {
      for (const tab of tabs) {
        if (tab.state !== 'discarded') {
          liveCandidates.push(tab)
        }
      }
    }

    if (liveCandidates.length <= maxLiveTabs) return

    const discardable = liveCandidates
      .filter((t) => this.canDiscardTab(t))
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)

    let excess = liveCandidates.length - maxLiveTabs
    for (const candidate of discardable) {
      if (excess <= 0) break
      const didDiscard = await this.discardTab(candidate.workspaceId, candidate.id)
      if (didDiscard) excess--
    }
  }

  private findTabMut(workspaceId: WorkspaceId, tabId: TabId): Tab | undefined {
    return (this.tabsByWorkspace.get(workspaceId) ?? []).find((t) => t.id === tabId)
  }

  private findTabAcrossWorkspacesMut(tabId: TabId): Tab | undefined {
    for (const tabs of this.tabsByWorkspace.values()) {
      const found = tabs.find((t) => t.id === tabId)
      if (found) return found
    }
    return undefined
  }

  private async persistWorkspaceTabs(workspaceId: WorkspaceId): Promise<void> {
    const tabs = this.tabsByWorkspace.get(workspaceId) ?? []
    await this.storage.saveTabsForWorkspace(workspaceId, tabs)
  }
}
