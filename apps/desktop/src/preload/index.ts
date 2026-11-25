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
  type RunBatchJobInput,
  type SkillDefinition,
  type TabId,
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
  createTab: (workspaceId: WorkspaceId, url?: string, activate?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE, workspaceId, url, activate),
  activateTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_ACTIVATE, workspaceId, tabId),
  closeTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_CLOSE, workspaceId, tabId),
  navigateTab: (workspaceId: WorkspaceId, tabId: TabId, urlOrQuery: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_NAVIGATE, workspaceId, tabId, urlOrQuery),
  goBack: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_BACK, workspaceId, tabId),
  goForward: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_FORWARD, workspaceId, tabId),
  reloadTab: (workspaceId: WorkspaceId, tabId: TabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_RELOAD, workspaceId, tabId),
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
}

contextBridge.exposeInMainWorld('browserApi', api)
