import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppSettings,
  type BrowserApi,
  type BrowserWindowSnapshot,
  type CreateWorkspaceInput,
  type ImportProxySubscriptionInput,
  type McpHostConfig,
  type McpServerConfig,
  type MultabPrefsPatch,
  type MultabState,
  type RunBatchJobInput,
  type SaveMultabCategoryInput,
  type SaveMultabItemInput,
  type SkillDefinition,
  type TabId,
  type TranslatePageMode,
  type UpdateWorkspaceInput,
  type ViewportBounds,
  type WorkspaceId,
  type WorkspaceProxyBinding,
} from '@wb/contracts'

const api: BrowserApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.STATE_GET),
  onStateUpdated: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: BrowserWindowSnapshot): void => {
      listener(snapshot)
    }
    ipcRenderer.on(IPC_CHANNELS.STATE_UPDATED, wrapped)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.STATE_UPDATED, wrapped)
  },
  createWorkspace: (input: CreateWorkspaceInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CREATE, input),
  updateWorkspace: (workspaceId: WorkspaceId, patch: UpdateWorkspaceInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_UPDATE, workspaceId, patch),
  deleteWorkspace: (workspaceId: WorkspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_DELETE, workspaceId),
  switchWorkspace: (workspaceId: WorkspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SWITCH, workspaceId),
  openWorkspaceInNewWindow: (workspaceId: WorkspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN_WINDOW, workspaceId),
  clearWorkspaceData: (workspaceId: WorkspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CLEAR_DATA, workspaceId),
  createTab: (workspaceId: WorkspaceId, url?: string, activate?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE, workspaceId, url, activate),
  activateTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_ACTIVATE, workspaceId, tabId),
  closeTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_CLOSE, workspaceId, tabId),
  reorderTab: (workspaceId: WorkspaceId, tabId: TabId, toIndex: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_REORDER, workspaceId, tabId, toIndex),
  navigateTab: (workspaceId: WorkspaceId, tabId: TabId, urlOrQuery: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_NAVIGATE, workspaceId, tabId, urlOrQuery),
  goBack: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_BACK, workspaceId, tabId),
  goForward: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_FORWARD, workspaceId, tabId),
  reloadTab: (workspaceId: WorkspaceId, tabId: TabId, ignoreCache?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_RELOAD, workspaceId, tabId, ignoreCache),
  clearCacheAndReloadTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_CLEAR_CACHE_AND_RELOAD, workspaceId, tabId),
  toggleMuteTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_TOGGLE_MUTE, workspaceId, tabId),
  showTabContextMenu: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_SHOW_CONTEXT_MENU, workspaceId, tabId),
  showReloadMenu: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TOOLBAR_SHOW_RELOAD_MENU, workspaceId, tabId),
  onFocusOmnibox: (listener: () => void) => {
    const wrapped = (): void => listener()
    ipcRenderer.on(IPC_CHANNELS.CHROME_FOCUS_OMNIBOX, wrapped)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHROME_FOCUS_OMNIBOX, wrapped)
  },
  togglePinTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_PIN, workspaceId, tabId),
  discardTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_DISCARD, workspaceId, tabId),
  restoreTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_RESTORE, workspaceId, tabId),
  openDevTools: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_OPEN_DEVTOOLS, workspaceId, tabId),
  sweepMemoryNow: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_SWEEP_MEMORY),
  setViewportBounds: (bounds: ViewportBounds) =>
    ipcRenderer.invoke(IPC_CHANNELS.VIEWPORT_SET_BOUNDS, bounds),
  setOverlayOpen: (open: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_OVERLAY_OPEN, open),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, patch),
  getMemorySummary: () => ipcRenderer.invoke(IPC_CHANNELS.MEMORY_SUMMARY_GET),
  // Phase 2: Proxy
  importProxySubscription: (input: ImportProxySubscriptionInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROXY_IMPORT_SUBSCRIPTION, input),
  deleteProxySubscription: (subscriptionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROXY_DELETE_SUBSCRIPTION, subscriptionId),
  testProxyNodeLatency: (nodeId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROXY_TEST_LATENCY, nodeId),
  setWorkspaceProxy: (workspaceId: WorkspaceId, binding: WorkspaceProxyBinding) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROXY_SET_WORKSPACE, workspaceId, binding),
  getProxyStatus: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_GET_STATUS),
  getProxyData: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_GET_DATA),
  setProxyBinaryPath: (binaryPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROXY_SET_BINARY_PATH, binaryPath),
  // Phase 3: AI / Skills / MCP / Batch
  sendAgentMessage: (workspaceId: WorkspaceId, prompt: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_SEND_MESSAGE, workspaceId, prompt),
  getAgentMessages: (workspaceId: WorkspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_GET_MESSAGES, workspaceId),
  clearAgentMessages: (workspaceId: WorkspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_CLEAR_MESSAGES, workspaceId),
  listSkills: (workspaceId?: WorkspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_SKILLS, workspaceId),
  saveSkill: (skill: SkillDefinition) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_SAVE_SKILL, skill),
  deleteSkill: (skillId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_DELETE_SKILL, skillId),
  runSkill: (workspaceId: WorkspaceId, skillId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_RUN_SKILL, workspaceId, skillId),
  listMcpServers: (workspaceId?: WorkspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_MCP_SERVERS, workspaceId),
  saveMcpServer: (server: McpServerConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_SAVE_MCP_SERVER, server),
  deleteMcpServer: (serverId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_DELETE_MCP_SERVER, serverId),
  getMcpHostStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_MCP_HOST_STATUS),
  updateMcpHostConfig: (patch: Partial<McpHostConfig>) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_UPDATE_MCP_HOST_CONFIG, patch),
  runBatchJob: (input: RunBatchJobInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_RUN_BATCH_JOB, input),
  listBatchJobs: () => ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_BATCH_JOBS),
  // Phase 4: Extensions
  listExtensions: () => ipcRenderer.invoke(IPC_CHANNELS.EXT_LIST),
  pickExtensionFolder: () => ipcRenderer.invoke(IPC_CHANNELS.EXT_PICK_FOLDER),
  pickCrxFile: () => ipcRenderer.invoke(IPC_CHANNELS.EXT_PICK_CRX),
  installExtensionFromFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXT_INSTALL_FOLDER, folderPath),
  installExtensionFromCrx: (crxPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXT_INSTALL_CRX, crxPath),
  toggleExtensionForWorkspace: (extensionId: string, workspaceId: WorkspaceId, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXT_TOGGLE_WORKSPACE, extensionId, workspaceId, enabled),
  removeExtension: (extensionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXT_REMOVE, extensionId),
  openExtensionPopup: (workspaceId: WorkspaceId, extensionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXT_OPEN_POPUP, workspaceId, extensionId),
  installExtensionFromStore: (workspaceId: WorkspaceId, urlOrId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXT_INSTALL_FROM_STORE, workspaceId, urlOrId),
  // Capture & Translation
  capturePage: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_PAGE, workspaceId, tabId),
  copyCapturedImage: (dataUrl: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_COPY_IMAGE, dataUrl),
  saveCapturedImage: (dataUrl: string, suggestedName?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_SAVE_IMAGE, dataUrl, suggestedName),
  listCaptureSources: () => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_LIST_SOURCES),
  saveRecordedVideo: (bytes: Uint8Array, suggestedName?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_SAVE_VIDEO, bytes, suggestedName),
  translateText: (workspaceId: WorkspaceId, text: string, targetLang: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSLATE_TEXT, workspaceId, text, targetLang),
  translatePage: (workspaceId: WorkspaceId, tabId: TabId, targetLang: string, mode: TranslatePageMode) =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSLATE_PAGE, workspaceId, tabId, targetLang, mode),
  restoreTranslatedPage: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSLATE_RESTORE_PAGE, workspaceId, tabId),
  getTabSelectionText: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_GET_SELECTION, workspaceId, tabId),
  // Phase 5: Custom Themes & Auto-Update
  importThemeJson: (jsonStr: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THEME_IMPORT_JSON, jsonStr),
  exportThemeJson: (themeId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THEME_EXPORT_JSON, themeId),
  deleteCustomTheme: (themeId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.THEME_DELETE_CUSTOM, themeId),
  getUpdateState: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_GET_STATE),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK_NOW),
  openUpdateDownload: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_OPEN_DOWNLOAD),
  // Multab
  onToggleBookmark: (listener) => {
    const wrapped = (): void => listener()
    ipcRenderer.on(IPC_CHANNELS.CHROME_TOGGLE_BOOKMARK, wrapped)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHROME_TOGGLE_BOOKMARK, wrapped)
  },
  getMultabState: () => ipcRenderer.invoke(IPC_CHANNELS.MULTAB_GET_STATE),
  onMultabUpdated: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: MultabState): void => {
      listener(state)
    }
    ipcRenderer.on(IPC_CHANNELS.MULTAB_UPDATED, wrapped)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MULTAB_UPDATED, wrapped)
  },
  saveMultabCategory: (input: SaveMultabCategoryInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_SAVE_CATEGORY, input),
  deleteMultabCategory: (categoryId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_DELETE_CATEGORY, categoryId),
  reorderMultabCategories: (orderedIds: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_REORDER_CATEGORIES, orderedIds),
  saveMultabItem: (input: SaveMultabItemInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_SAVE_ITEM, input),
  deleteMultabItem: (itemId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_DELETE_ITEM, itemId),
  reorderMultabItems: (categoryId: string, orderedIds: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_REORDER_ITEMS, categoryId, orderedIds),
  updateMultabPrefs: (patch: MultabPrefsPatch) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_UPDATE_PREFS, patch),
  testMultabSyncRelay: (relayUrl: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_TEST_RELAY, relayUrl),
  pushMultabSyncCode: (relayUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_SYNC_PUSH, relayUrl),
  pullMultabSyncCode: (code: string, relayUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MULTAB_SYNC_PULL, code, relayUrl),
  importMultabBookmarksHtml: () => ipcRenderer.invoke(IPC_CHANNELS.MULTAB_IMPORT_HTML_FILE),
  importMultabJson: () => ipcRenderer.invoke(IPC_CHANNELS.MULTAB_IMPORT_JSON_FILE),
  exportMultabJson: () => ipcRenderer.invoke(IPC_CHANNELS.MULTAB_EXPORT_JSON_FILE),
  fetchMultabSiteMeta: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.MULTAB_FETCH_SITE_META, url),
}

contextBridge.exposeInMainWorld('browserApi', api)
