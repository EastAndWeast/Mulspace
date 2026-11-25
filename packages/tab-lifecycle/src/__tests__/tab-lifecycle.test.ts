import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserKernel } from '@wb/kernel'
import { DEFAULT_APP_SETTINGS, JsonStorageRepository } from '@wb/storage'
import type { AppSettings, Tab, TabId, Workspace } from '@wb/contracts'
import { TabLifecycleManager, type ITabViewAdapter } from '../tab-lifecycle-manager.js'

const tempDirs: string[] = []

class FakeViewAdapter implements ITabViewAdapter {
  created = new Set<TabId>()
  attached = new Set<TabId>()
  throttled = new Set<TabId>()
  destroyedCount = 0

  createView(tab: Tab): void {
    this.created.add(tab.id)
  }
  attachView(tabId: TabId): void {
    this.attached.add(tabId)
  }
  detachView(tabId: TabId): void {
    this.attached.delete(tabId)
  }
  destroyView(tabId: TabId): void {
    this.attached.delete(tabId)
    this.created.delete(tabId)
    this.destroyedCount++
  }
  setBackgroundThrottling(tabId: TabId, enabled: boolean): void {
    if (enabled) this.throttled.add(tabId)
    else this.throttled.delete(tabId)
  }
  captureSnapshot(tabId: TabId) {
    return { scrollX: 0, scrollY: 420, title: `Snap-${tabId}` }
  }
}

async function setup(settingsPatch?: Partial<AppSettings>) {
  const dir = await mkdtemp(join(tmpdir(), 'wb-tab-test-'))
  tempDirs.push(dir)
  const storage = new JsonStorageRepository(dir)
  const state = await storage.loadState()
  const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...settingsPatch }
  const adapter = new FakeViewAdapter()
  const workspaces = new Map<string, Workspace>(state.workspaces.map((w) => [w.id, w]))

  const kernel = new BrowserKernel()
  const manager = new TabLifecycleManager(storage, {
    getWorkspace: (id) => workspaces.get(id),
    getSettings: () => settings,
    adapter,
  })
  kernel.use(manager)
  await kernel.start()
  return { manager, adapter, wsId: state.workspaces[0]!.id, ws2Id: state.workspaces[1]!.id }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('TabLifecycleManager', () => {
  it('transitions active -> frozen -> discarded and restores lazily on re-activation', async () => {
    const { manager, adapter, wsId } = await setup({ discardAfterMs: 1000 })
    const t1 = await manager.createTab({ workspaceId: wsId, url: 'https://a.com', title: 'A' }, 'win_1', 1000)
    const t2 = await manager.createTab({ workspaceId: wsId, url: 'https://b.com', title: 'B' }, 'win_1', 2000)

    expect(manager.getTab(wsId, t1.id)?.state).toBe('frozen')
    expect(manager.getTab(wsId, t2.id)?.state).toBe('active')
    expect(adapter.throttled.has(t1.id)).toBe(true)

    await manager.runMaintenanceSweep(5000)
    const discarded = manager.getTab(wsId, t1.id)
    expect(discarded?.state).toBe('discarded')
    expect(discarded?.snapshot?.scrollY).toBe(420)
    expect(adapter.created.has(t1.id)).toBe(false)

    // Re-activating discarded tab recreates the view cleanly
    await manager.activateTab(wsId, t1.id, 'win_1', 6000)
    expect(manager.getTab(wsId, t1.id)?.state).toBe('active')
    expect(adapter.created.has(t1.id)).toBe(true)
  })

  it('protects pinned, audible, and aiBusy tabs from discarding and enforces LRU cap', async () => {
    const { manager, wsId } = await setup({ maxLiveTabs: 2, discardAfterMs: 999_999 })
    const pinned = await manager.createTab({ workspaceId: wsId, pinned: true, url: 'https://pin.com' }, 'win_1', 100)
    const t2 = await manager.createTab({ workspaceId: wsId, url: 'https://old.com' }, 'win_1', 200)
    const aiTab = await manager.createTab({ workspaceId: wsId, url: 'https://ai.com' }, 'win_1', 300)
    await manager.updateTabMeta(wsId, aiTab.id, { aiBusy: true })
    const active = await manager.createTab({ workspaceId: wsId, url: 'https://now.com' }, 'win_1', 400)

    // Live tabs exceeded maxLiveTabs=2; only t2 is eligible to be discarded via LRU
    expect(manager.getTab(wsId, t2.id)?.state).toBe('discarded')
    expect(manager.getTab(wsId, pinned.id)?.state).toBe('frozen')
    expect(manager.getTab(wsId, aiTab.id)?.state).toBe('frozen')
    expect(manager.getTab(wsId, active.id)?.state).toBe('active')
  })
})
