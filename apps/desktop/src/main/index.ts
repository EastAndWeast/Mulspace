import { AgentService } from '@wb/ai-runtime'
import {
  IPC_CHANNELS,
  type AppSettings,
  type CreateWorkspaceInput,
  type ImportProxySubscriptionInput,
  type McpHostConfig,
  type McpServerConfig,
  type RunBatchJobInput,
  type SkillDefinition,
  type TabId,
  type UpdateWorkspaceInput,
  type ViewportBounds,
  type WorkspaceId,
  type WorkspaceProxyBinding,
} from '@wb/contracts'
import { ExtensionService } from '@wb/extension-host'
import { BrowserKernel } from '@wb/kernel'
import { ProxyService } from '@wb/proxy-engine'
import { createDefaultAppSettings, JsonStorageRepository } from '@wb/storage'
import { TabLifecycleManager } from '@wb/tab-lifecycle'
import { defaultThemeRegistry } from '@wb/themes'
import { UpdateService } from '@wb/updater'
import { WorkspaceService } from '@wb/workspace-core'
import { app, dialog, ipcMain, shell } from 'electron'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ElectronCdpAutomationBridge } from './cdp-bridge.js'
import { BrowserWindowManager, normalizeNavigationInput } from './window-manager.js'

let currentSettings: AppSettings = createDefaultAppSettings()
let maintenanceTimer: ReturnType<typeof setInterval> | null = null

async function bootstrap(): Promise<void> {
  const isSmokeTest = process.env.WB_SMOKE_TEST === '1'
  const smokeDir = isSmokeTest ? await mkdtemp(join(tmpdir(), 'wb-smoke-')) : null
  const dataDir = smokeDir ?? join(app.getPath('userData'), 'wb-data')

  const storage = new JsonStorageRepository(dataDir)
  const initialState = await storage.loadState()
  currentSettings = initialState.settings
  if (isSmokeTest) {
    // Use an ephemeral loopback port in smoke test to avoid conflicting with a live dev instance
    currentSettings.mcpHost = { ...currentSettings.mcpHost, port: 0 }
  }
  defaultThemeRegistry.loadCustomThemes(initialState.customThemes)

  const kernel = new BrowserKernel()
  const workspaceService = new WorkspaceService(storage)
  const windowManager = new BrowserWindowManager(kernel, workspaceService, () => currentSettings)

  const tabLifecycle = new TabLifecycleManager(storage, {
    getWorkspace: (id) => workspaceService.get(id),
    getSettings: () => currentSettings,
    adapter: windowManager,
  })

  const proxyService = new ProxyService(storage, {
    runtimeDir: join(dataDir, 'proxy-runtime'),
    resourcesPath: process.resourcesPath,
    getWorkspaces: () => workspaceService.list(),
    getProxyBinaryPath: () => currentSettings.proxyCoreBinaryPath,
    updateWorkspaceProxy: (wsId, binding) => workspaceService.update(wsId, { proxy: binding }),
    applier: windowManager,
  })

  const extensionService = new ExtensionService(storage, {
    extensionsDir: join(dataDir, 'extensions'),
    getWorkspaces: () => workspaceService.list(),
    adapter: windowManager,
  })

  const cdpBridge = new ElectronCdpAutomationBridge(tabLifecycle, windowManager)
  const agentService = new AgentService(storage, {
    skillsDir: join(dataDir, 'skills'),
    getWorkspaces: () => workspaceService.list(),
    getWorkspace: (id) => workspaceService.get(id),
    getActiveLlmProvider: () => {
      const providers = currentSettings.llmProviders ?? []
      return (
        providers.find((p) => p.id === currentSettings.activeLlmProviderId && p.enabled) ??
        providers.find((p) => p.enabled)
      )
    },
    getMcpHostConfig: () => currentSettings.mcpHost,
    updateMcpHostConfig: async (patch) => {
      currentSettings = {
        ...currentSettings,
        mcpHost: { ...currentSettings.mcpHost, ...patch },
      }
      await storage.saveSettings(currentSettings)
      kernel.events.emit('settings:updated', { settings: currentSettings })
      return currentSettings.mcpHost
    },
    bridge: cdpBridge,
  })

  const updateService = new UpdateService({
    currentVersion: app.getVersion() || '0.1.0',
    repoSlug: 'EastAndWeast/Mulspace',
    getAutoCheckEnabled: () => currentSettings.autoCheckUpdates,
    disableScheduler: isSmokeTest,
  })

  windowManager.attachServices({
    tabLifecycle,
    proxyService,
    extensionService,
    agentService,
    updateService,
  })
  kernel
    .use(workspaceService)
    .use(tabLifecycle)
    .use(proxyService)
    .use(extensionService)
    .use(agentService)
    .use(updateService)

  await kernel.start()

  // Inject proxy credentials per workspace partition when Electron challenges for proxy auth
  app.on('login', (event, webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return
    const allWorkspaces = workspaceService.list()
    for (const ws of allWorkspaces) {
      const creds = windowManager.getProxyAuthForPartition(ws.partition)
      if (creds && webContents.session.storagePath?.includes(ws.id)) {
        event.preventDefault()
        callback(creds.username, creds.password)
        return
      }
    }
  })

  if (isSmokeTest) {
    const mcpStatus = agentService.getMcpHostStatus()
    let mcpHealthOk = false
    if (mcpStatus.endpointUrl) {
      const healthUrl = mcpStatus.endpointUrl.replace(/\/mcp$/, '/health')
      const res = await fetch(healthUrl, {
        headers: { Authorization: `Bearer ${mcpStatus.config.authToken}` },
      })
      mcpHealthOk = res.ok
    }

    const report = {
      workspaces: workspaceService.list().length,
      themes: defaultThemeRegistry.list().length,
      proxyCoreKind: proxyService.getStatus().coreKind,
      mcpRunning: mcpStatus.running,
      mcpHealthOk,
      skillsCount: agentService.listSkills().length,
      updateRepo: updateService.getState().repoSlug,
    }

    await kernel.stop()
    if (smokeDir) {
      await rm(smokeDir, { recursive: true, force: true })
    }
    console.log(`[SMOKE_OK] ${JSON.stringify(report)}`)
    app.exit(0)
    return
  }

  registerIpcHandlers({
    storage,
    kernel,
    workspaceService,
    tabLifecycle,
    proxyService,
    extensionService,
    agentService,
    updateService,
    windowManager,
  })

  await windowManager.createBrowserWindow()

  maintenanceTimer = setInterval(() => {
    void tabLifecycle.runMaintenanceSweep()
  }, 30_000)

  app.on('activate', () => {
    if (windowManager.getWindowCount() === 0) {
      void windowManager.createBrowserWindow()
    }
  })

  app.on('before-quit', () => {
    if (maintenanceTimer) clearInterval(maintenanceTimer)
    void kernel.stop()
  })
}

function registerIpcHandlers(deps: {
  storage: JsonStorageRepository
  kernel: BrowserKernel
  workspaceService: WorkspaceService
  tabLifecycle: TabLifecycleManager
  proxyService: ProxyService
  extensionService: ExtensionService
  agentService: AgentService
  updateService: UpdateService
  windowManager: BrowserWindowManager
}): void {
  const {
    storage,
    kernel,
    workspaceService,
    tabLifecycle,
    proxyService,
    extensionService,
    agentService,
    updateService,
    windowManager,
  } = deps

  ipcMain.handle(IPC_CHANNELS.STATE_GET, (event) => {
    const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
    return windowManager.getSnapshot(winId)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CREATE, async (event, input: CreateWorkspaceInput) => {
    const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
    const ws = await workspaceService.create(input)
    await windowManager.switchWorkspace(winId, ws.id)
    return ws
  })

  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_UPDATE,
    async (_event, workspaceId: WorkspaceId, patch: UpdateWorkspaceInput) => {
      return workspaceService.update(workspaceId, patch)
    },
  )

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_DELETE, async (_event, workspaceId: WorkspaceId) => {
    await workspaceService.delete(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SWITCH, async (event, workspaceId: WorkspaceId) => {
    const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
    await windowManager.switchWorkspace(winId, workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN_WINDOW, async (_event, workspaceId: WorkspaceId) => {
    return windowManager.createBrowserWindow(workspaceId)
  })

  ipcMain.handle(
    IPC_CHANNELS.TAB_CREATE,
    async (event, workspaceId: WorkspaceId, url?: string, activate = true) => {
      const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
      return tabLifecycle.createTab(
        {
          workspaceId,
          url: url ? normalizeNavigationInput(url) : undefined,
          activate,
        },
        activate ? winId : undefined,
      )
    },
  )

  ipcMain.handle(IPC_CHANNELS.TAB_ACTIVATE, async (event, workspaceId: WorkspaceId, tabId: TabId) => {
    const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
    await tabLifecycle.activateTab(workspaceId, tabId, winId)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, async (event, workspaceId: WorkspaceId, tabId: TabId) => {
    const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
    const next = await tabLifecycle.closeTab(workspaceId, tabId, winId)
    if (!next) {
      await tabLifecycle.createTab({ workspaceId, activate: true }, winId)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.TAB_NAVIGATE,
    async (event, workspaceId: WorkspaceId, tabId: TabId, urlOrQuery: string) => {
      const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
      const tab = tabLifecycle.getTab(workspaceId, tabId)
      if (!tab) return
      const normalized = normalizeNavigationInput(urlOrQuery)
      if (tab.state === 'discarded') {
        await tabLifecycle.updateTabMeta(workspaceId, tabId, { url: normalized })
        await tabLifecycle.activateTab(workspaceId, tabId, winId)
        return
      }
      windowManager.navigate(tabId, normalized)
    },
  )

  ipcMain.handle(IPC_CHANNELS.TAB_BACK, (_event, _workspaceId: WorkspaceId, tabId: TabId) => {
    windowManager.goBack(tabId)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_FORWARD, (_event, _workspaceId: WorkspaceId, tabId: TabId) => {
    windowManager.goForward(tabId)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_RELOAD, (_event, _workspaceId: WorkspaceId, tabId: TabId) => {
    windowManager.reload(tabId)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_PIN, async (_event, workspaceId: WorkspaceId, tabId: TabId) => {
    const tab = tabLifecycle.getTab(workspaceId, tabId)
    if (!tab) return
    await tabLifecycle.updateTabMeta(workspaceId, tabId, { pinned: !tab.pinned })
  })

  ipcMain.handle(IPC_CHANNELS.TAB_DISCARD, async (_event, workspaceId: WorkspaceId, tabId: TabId) => {
    await tabLifecycle.discardTab(workspaceId, tabId, true)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_RESTORE, async (event, workspaceId: WorkspaceId, tabId: TabId) => {
    const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
    await tabLifecycle.activateTab(workspaceId, tabId, winId)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_OPEN_DEVTOOLS, (_event, _workspaceId: WorkspaceId, tabId: TabId) => {
    windowManager.openDevTools(tabId)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_SWEEP_MEMORY, async () => {
    return tabLifecycle.discardAllBackgroundTabs()
  })

  ipcMain.handle(IPC_CHANNELS.VIEWPORT_SET_BOUNDS, (event, bounds: ViewportBounds) => {
    const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
    windowManager.setViewportBounds(winId, bounds)
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_OVERLAY_OPEN, (event, open: boolean) => {
    const winId = windowManager.resolveWindowIdFromSender(event.sender.id)
    windowManager.setOverlayOpen(winId, open)
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => currentSettings)

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, patch: Partial<AppSettings>) => {
    currentSettings = { ...currentSettings, ...patch }
    await storage.saveSettings(currentSettings)
    kernel.events.emit('settings:updated', { settings: currentSettings })
    return currentSettings
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_SUMMARY_GET, () => tabLifecycle.getMemorySummary())

  // Phase 2: Proxy
  ipcMain.handle(IPC_CHANNELS.PROXY_IMPORT_SUBSCRIPTION, (_e, input: ImportProxySubscriptionInput) =>
    proxyService.importSubscription(input),
  )
  ipcMain.handle(IPC_CHANNELS.PROXY_DELETE_SUBSCRIPTION, (_e, subId: string) =>
    proxyService.deleteSubscription(subId),
  )
  ipcMain.handle(IPC_CHANNELS.PROXY_TEST_LATENCY, (_e, nodeId: string) =>
    proxyService.testNodeLatency(nodeId),
  )
  ipcMain.handle(
    IPC_CHANNELS.PROXY_SET_WORKSPACE,
    (_e, workspaceId: WorkspaceId, binding: WorkspaceProxyBinding) =>
      proxyService.setWorkspaceProxy(workspaceId, binding),
  )
  ipcMain.handle(IPC_CHANNELS.PROXY_GET_STATUS, () => proxyService.getStatus())
  ipcMain.handle(IPC_CHANNELS.PROXY_SET_BINARY_PATH, async (_e, binaryPath: string) => {
    currentSettings = { ...currentSettings, proxyCoreBinaryPath: binaryPath.trim() || undefined }
    await storage.saveSettings(currentSettings)
    kernel.events.emit('settings:updated', { settings: currentSettings })
    return proxyService.setBinaryPath(binaryPath.trim())
  })

  // Phase 3: AI / Skills / MCP / Batch
  ipcMain.handle(IPC_CHANNELS.AI_SEND_MESSAGE, (_e, workspaceId: WorkspaceId, prompt: string) =>
    agentService.sendMessage(workspaceId, prompt),
  )
  ipcMain.handle(IPC_CHANNELS.AI_GET_MESSAGES, (_e, workspaceId: WorkspaceId) =>
    agentService.getMessages(workspaceId),
  )
  ipcMain.handle(IPC_CHANNELS.AI_CLEAR_MESSAGES, (_e, workspaceId: WorkspaceId) =>
    agentService.clearMessages(workspaceId),
  )
  ipcMain.handle(IPC_CHANNELS.AI_LIST_SKILLS, (_e, workspaceId?: WorkspaceId) =>
    agentService.listSkills(workspaceId),
  )
  ipcMain.handle(IPC_CHANNELS.AI_SAVE_SKILL, (_e, skill: SkillDefinition) =>
    agentService.saveSkill(skill),
  )
  ipcMain.handle(IPC_CHANNELS.AI_DELETE_SKILL, (_e, skillId: string) =>
    agentService.deleteSkill(skillId),
  )
  ipcMain.handle(IPC_CHANNELS.AI_RUN_SKILL, (_e, workspaceId: WorkspaceId, skillId: string) =>
    agentService.runSkill(workspaceId, skillId),
  )
  ipcMain.handle(IPC_CHANNELS.AI_LIST_MCP_SERVERS, (_e, workspaceId?: WorkspaceId) =>
    agentService.listMcpServers(workspaceId),
  )
  ipcMain.handle(IPC_CHANNELS.AI_SAVE_MCP_SERVER, (_e, server: McpServerConfig) =>
    agentService.saveMcpServer(server),
  )
  ipcMain.handle(IPC_CHANNELS.AI_DELETE_MCP_SERVER, (_e, serverId: string) =>
    agentService.deleteMcpServer(serverId),
  )
  ipcMain.handle(IPC_CHANNELS.AI_GET_MCP_HOST_STATUS, () => agentService.getMcpHostStatus())
  ipcMain.handle(IPC_CHANNELS.AI_UPDATE_MCP_HOST_CONFIG, (_e, patch: Partial<McpHostConfig>) =>
    agentService.updateMcpHostConfig(patch),
  )
  ipcMain.handle(IPC_CHANNELS.AI_RUN_BATCH_JOB, (_e, input: RunBatchJobInput) =>
    agentService.runBatchJob(input),
  )
  ipcMain.handle(IPC_CHANNELS.AI_LIST_BATCH_JOBS, () => agentService.listBatchJobs())

  // Phase 4: Extensions
  ipcMain.handle(IPC_CHANNELS.EXT_LIST, () => extensionService.list())
  ipcMain.handle(IPC_CHANNELS.EXT_PICK_FOLDER, async () => {
    const win = windowManager.getPrimaryBaseWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.EXT_PICK_CRX, async () => {
    const win = windowManager.getPrimaryBaseWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'Chrome Extensions', extensions: ['crx'] }],
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.EXT_INSTALL_FOLDER, (_e, folderPath: string) =>
    extensionService.installFromFolder(folderPath),
  )
  ipcMain.handle(IPC_CHANNELS.EXT_INSTALL_CRX, (_e, crxPath: string) =>
    extensionService.installFromCrx(crxPath),
  )
  ipcMain.handle(
    IPC_CHANNELS.EXT_TOGGLE_WORKSPACE,
    (_e, extensionId: string, workspaceId: WorkspaceId, enabled: boolean) =>
      extensionService.toggleForWorkspace(extensionId, workspaceId, enabled),
  )
  ipcMain.handle(IPC_CHANNELS.EXT_REMOVE, (_e, extensionId: string) =>
    extensionService.remove(extensionId),
  )
  ipcMain.handle(IPC_CHANNELS.EXT_OPEN_POPUP, (_e, workspaceId: WorkspaceId, extensionId: string) =>
    windowManager.openExtensionPopup(workspaceId, extensionId),
  )

  // Phase 5: Custom Themes
  ipcMain.handle(IPC_CHANNELS.THEME_IMPORT_JSON, async (_e, jsonStr: string) => {
    const imported = defaultThemeRegistry.importFromJson(jsonStr)
    const state = await storage.loadState()
    const nextCustom = state.customThemes.filter((t) => t.id !== imported.id)
    nextCustom.push(imported)
    await storage.saveCustomThemes(nextCustom)
    const list = defaultThemeRegistry.list()
    kernel.events.emit('themes:updated', { themes: list })
    return list
  })
  ipcMain.handle(IPC_CHANNELS.THEME_EXPORT_JSON, (_e, themeId: string) =>
    defaultThemeRegistry.exportToJson(themeId),
  )
  ipcMain.handle(IPC_CHANNELS.THEME_DELETE_CUSTOM, async (_e, themeId: string) => {
    defaultThemeRegistry.remove(themeId)
    const state = await storage.loadState()
    const nextCustom = state.customThemes.filter((t) => t.id !== themeId)
    await storage.saveCustomThemes(nextCustom)
    const list = defaultThemeRegistry.list()
    kernel.events.emit('themes:updated', { themes: list })
    return list
  })

  // Phase 5: Auto-Update
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_STATE, () => updateService.getState())
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK_NOW, () => updateService.checkForUpdates())
  ipcMain.handle(IPC_CHANNELS.UPDATE_OPEN_DOWNLOAD, async () => {
    const st = updateService.getState()
    const targetUrl =
      st.matchedAsset?.downloadUrl ??
      st.releaseUrl ??
      'https://github.com/EastAndWeast/Mulspace/releases'
    await shell.openExternal(targetUrl)
  })
}

app.whenReady().then(() => {
  void bootstrap()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
