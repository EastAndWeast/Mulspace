import type {
  AgentMessage,
  BatchJob,
  McpHostConfig,
  McpHostStatus,
  McpServerConfig,
  RunBatchJobInput,
  SkillDefinition,
} from './ai.js'
import type { InstalledExtension } from './extension.js'
import type { ImportProxySubscriptionInput, ProxyEngineStatus, ProxyNode, ProxySubscription } from './proxy.js'
import type { AppSettings } from './storage.js'
import type { Tab, TabMemorySummary } from './tab.js'
import type { ThemeManifest } from './theme.js'
import type { UpdateState } from './update.js'
import type {
  CreateWorkspaceInput,
  TabId,
  UpdateWorkspaceInput,
  WindowId,
  Workspace,
  WorkspaceId,
  WorkspaceProxyBinding,
} from './workspace.js'

export interface ViewportBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserWindowSnapshot {
  windowId: WindowId
  activeWorkspaceId: WorkspaceId
  workspaces: Workspace[]
  tabsByWorkspace: Record<WorkspaceId, Tab[]>
  settings: AppSettings
  themes: ThemeManifest[]
  memorySummary: TabMemorySummary
  proxyStatus: ProxyEngineStatus
  proxySubscriptions: ProxySubscription[]
  proxyNodes: ProxyNode[]
  extensions: InstalledExtension[]
  mcpHostStatus: McpHostStatus
  updateState: UpdateState
  aiMessageSeq?: number
}

export const IPC_CHANNELS = {
  STATE_GET: 'wb:state:get',
  STATE_UPDATED: 'wb:state:updated',
  WORKSPACE_CREATE: 'wb:workspace:create',
  WORKSPACE_UPDATE: 'wb:workspace:update',
  WORKSPACE_DELETE: 'wb:workspace:delete',
  WORKSPACE_SWITCH: 'wb:workspace:switch',
  WORKSPACE_OPEN_WINDOW: 'wb:workspace:open-window',
  TAB_CREATE: 'wb:tab:create',
  TAB_ACTIVATE: 'wb:tab:activate',
  TAB_CLOSE: 'wb:tab:close',
  TAB_NAVIGATE: 'wb:tab:navigate',
  TAB_BACK: 'wb:tab:back',
  TAB_FORWARD: 'wb:tab:forward',
  TAB_RELOAD: 'wb:tab:reload',
  TAB_PIN: 'wb:tab:pin',
  TAB_DISCARD: 'wb:tab:discard',
  TAB_RESTORE: 'wb:tab:restore',
  TAB_OPEN_DEVTOOLS: 'wb:tab:open-devtools',
  TAB_SWEEP_MEMORY: 'wb:tab:sweep-memory',
  VIEWPORT_SET_BOUNDS: 'wb:viewport:set-bounds',
  WINDOW_SET_OVERLAY_OPEN: 'wb:window:set-overlay-open',
  SETTINGS_GET: 'wb:settings:get',
  SETTINGS_UPDATE: 'wb:settings:update',
  MEMORY_SUMMARY_GET: 'wb:memory:summary',
  // Phase 2: Proxy
  PROXY_IMPORT_SUBSCRIPTION: 'wb:proxy:import-subscription',
  PROXY_DELETE_SUBSCRIPTION: 'wb:proxy:delete-subscription',
  PROXY_TEST_LATENCY: 'wb:proxy:test-latency',
  PROXY_SET_WORKSPACE: 'wb:proxy:set-workspace',
  PROXY_GET_STATUS: 'wb:proxy:get-status',
  PROXY_SET_BINARY_PATH: 'wb:proxy:set-binary-path',
  // Phase 3: AI / Skills / MCP / Batch
  AI_SEND_MESSAGE: 'wb:ai:send-message',
  AI_GET_MESSAGES: 'wb:ai:get-messages',
  AI_CLEAR_MESSAGES: 'wb:ai:clear-messages',
  AI_LIST_SKILLS: 'wb:ai:list-skills',
  AI_SAVE_SKILL: 'wb:ai:save-skill',
  AI_DELETE_SKILL: 'wb:ai:delete-skill',
  AI_RUN_SKILL: 'wb:ai:run-skill',
  AI_LIST_MCP_SERVERS: 'wb:ai:list-mcp-servers',
  AI_SAVE_MCP_SERVER: 'wb:ai:save-mcp-server',
  AI_DELETE_MCP_SERVER: 'wb:ai:delete-mcp-server',
  AI_GET_MCP_HOST_STATUS: 'wb:ai:get-mcp-host-status',
  AI_UPDATE_MCP_HOST_CONFIG: 'wb:ai:update-mcp-host-config',
  AI_RUN_BATCH_JOB: 'wb:ai:run-batch-job',
  AI_LIST_BATCH_JOBS: 'wb:ai:list-batch-jobs',
  // Phase 4: Extensions
  EXT_LIST: 'wb:ext:list',
  EXT_PICK_FOLDER: 'wb:ext:pick-folder',
  EXT_PICK_CRX: 'wb:ext:pick-crx',
  EXT_INSTALL_FOLDER: 'wb:ext:install-folder',
  EXT_INSTALL_CRX: 'wb:ext:install-crx',
  EXT_TOGGLE_WORKSPACE: 'wb:ext:toggle-workspace',
  EXT_REMOVE: 'wb:ext:remove',
  EXT_OPEN_POPUP: 'wb:ext:open-popup',
  // Phase 5: Custom Themes & Auto-Update
  THEME_IMPORT_JSON: 'wb:theme:import-json',
  THEME_EXPORT_JSON: 'wb:theme:export-json',
  THEME_DELETE_CUSTOM: 'wb:theme:delete-custom',
  UPDATE_GET_STATE: 'wb:update:get-state',
  UPDATE_CHECK_NOW: 'wb:update:check-now',
  UPDATE_OPEN_DOWNLOAD: 'wb:update:open-download',
} as const

export interface BrowserApi {
  getState(): Promise<BrowserWindowSnapshot>
  onStateUpdated(listener: (snapshot: BrowserWindowSnapshot) => void): () => void
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>
  updateWorkspace(workspaceId: WorkspaceId, patch: UpdateWorkspaceInput): Promise<Workspace>
  deleteWorkspace(workspaceId: WorkspaceId): Promise<void>
  switchWorkspace(workspaceId: WorkspaceId): Promise<void>
  openWorkspaceInNewWindow(workspaceId: WorkspaceId): Promise<WindowId>
  createTab(workspaceId: WorkspaceId, url?: string, activate?: boolean): Promise<Tab>
  activateTab(workspaceId: WorkspaceId, tabId: TabId): Promise<void>
  closeTab(workspaceId: WorkspaceId, tabId: TabId): Promise<void>
  navigateTab(workspaceId: WorkspaceId, tabId: TabId, urlOrQuery: string): Promise<void>
  goBack(workspaceId: WorkspaceId, tabId: TabId): Promise<void>
  goForward(workspaceId: WorkspaceId, tabId: TabId): Promise<void>
  reloadTab(workspaceId: WorkspaceId, tabId: TabId): Promise<void>
  togglePinTab(workspaceId: WorkspaceId, tabId: TabId): Promise<void>
  discardTab(workspaceId: WorkspaceId, tabId: TabId): Promise<void>
  restoreTab(workspaceId: WorkspaceId, tabId: TabId): Promise<void>
  openDevTools(workspaceId: WorkspaceId, tabId: TabId): Promise<void>
  sweepMemoryNow(): Promise<TabMemorySummary>
  setViewportBounds(bounds: ViewportBounds): Promise<void>
  setOverlayOpen(open: boolean): Promise<void>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getMemorySummary(): Promise<TabMemorySummary>
  // Phase 2: Proxy
  importProxySubscription(input: ImportProxySubscriptionInput): Promise<{ subscription: ProxySubscription; nodes: ProxyNode[] }>
  deleteProxySubscription(subscriptionId: string): Promise<void>
  testProxyNodeLatency(nodeId: string): Promise<number | null>
  setWorkspaceProxy(workspaceId: WorkspaceId, binding: WorkspaceProxyBinding): Promise<ProxyEngineStatus>
  getProxyStatus(): Promise<ProxyEngineStatus>
  setProxyBinaryPath(binaryPath: string): Promise<ProxyEngineStatus>
  // Phase 3: AI / Skills / MCP / Batch
  sendAgentMessage(workspaceId: WorkspaceId, prompt: string): Promise<AgentMessage[]>
  getAgentMessages(workspaceId: WorkspaceId): Promise<AgentMessage[]>
  clearAgentMessages(workspaceId: WorkspaceId): Promise<void>
  listSkills(workspaceId?: WorkspaceId): Promise<SkillDefinition[]>
  saveSkill(skill: SkillDefinition): Promise<SkillDefinition[]>
  deleteSkill(skillId: string): Promise<SkillDefinition[]>
  runSkill(workspaceId: WorkspaceId, skillId: string): Promise<AgentMessage[]>
  listMcpServers(workspaceId?: WorkspaceId): Promise<McpServerConfig[]>
  saveMcpServer(server: McpServerConfig): Promise<McpServerConfig[]>
  deleteMcpServer(serverId: string): Promise<McpServerConfig[]>
  getMcpHostStatus(): Promise<McpHostStatus>
  updateMcpHostConfig(patch: Partial<McpHostConfig>): Promise<McpHostStatus>
  runBatchJob(input: RunBatchJobInput): Promise<BatchJob>
  listBatchJobs(): Promise<BatchJob[]>
  // Phase 4: Extensions
  listExtensions(): Promise<InstalledExtension[]>
  pickExtensionFolder(): Promise<string | null>
  pickCrxFile(): Promise<string | null>
  installExtensionFromFolder(folderPath: string): Promise<InstalledExtension>
  installExtensionFromCrx(crxPath: string): Promise<InstalledExtension>
  toggleExtensionForWorkspace(extensionId: string, workspaceId: WorkspaceId, enabled: boolean): Promise<InstalledExtension[]>
  removeExtension(extensionId: string): Promise<InstalledExtension[]>
  openExtensionPopup(workspaceId: WorkspaceId, extensionId: string): Promise<void>
  // Phase 5: Custom Themes & Auto-Update
  importThemeJson(jsonStr: string): Promise<ThemeManifest[]>
  exportThemeJson(themeId: string): Promise<string>
  deleteCustomTheme(themeId: string): Promise<ThemeManifest[]>
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  openUpdateDownload(): Promise<void>
}
