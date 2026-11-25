import type { LLMProviderConfig, McpHostConfig, McpServerConfig, SkillDefinition } from './ai.js'
import type { InstalledExtension } from './extension.js'
import type { ProxyNode, ProxySubscription } from './proxy.js'
import type { Tab } from './tab.js'
import type { ThemeManifest, ThemeMode } from './theme.js'
import type { Workspace, WorkspaceId } from './workspace.js'

export interface AppSettings {
  themeId: string
  themeMode: ThemeMode
  customSeedColor?: string
  followWorkspaceColor: boolean
  freezeAfterMs: number
  discardAfterMs: number
  maxLiveTabs: number
  proxyCoreBinaryPath?: string
  autoCheckUpdates: boolean
  mcpHost: McpHostConfig
  llmProviders: LLMProviderConfig[]
  activeLlmProviderId?: string
}

export interface PersistedBrowserState {
  schemaVersion: 1
  workspaces: Workspace[]
  tabsByWorkspace: Record<WorkspaceId, Tab[]>
  lastActiveWorkspaceId: WorkspaceId | null
  settings: AppSettings
  proxySubscriptions: ProxySubscription[]
  proxyNodes: ProxyNode[]
  skills: SkillDefinition[]
  mcpServers: McpServerConfig[]
  extensions: InstalledExtension[]
  customThemes: ThemeManifest[]
}

export interface IStorageRepository {
  loadState(): Promise<PersistedBrowserState>
  saveWorkspace(workspace: Workspace): Promise<void>
  deleteWorkspace(workspaceId: WorkspaceId): Promise<void>
  saveTabsForWorkspace(workspaceId: WorkspaceId, tabs: Tab[]): Promise<void>
  saveLastActiveWorkspaceId(workspaceId: WorkspaceId | null): Promise<void>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>
  saveProxyData(subscriptions: ProxySubscription[], nodes: ProxyNode[]): Promise<void>
  saveSkills(skills: SkillDefinition[]): Promise<void>
  saveMcpServers(servers: McpServerConfig[]): Promise<void>
  saveExtensions(extensions: InstalledExtension[]): Promise<void>
  saveCustomThemes(themes: ThemeManifest[]): Promise<void>
}
