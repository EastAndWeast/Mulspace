export type WorkspaceId = string
export type TabId = string
export type WindowId = string

export type WebRtcPolicy = 'disable_non_proxied_udp' | 'default'

export interface WorkspaceIsolationConfig {
  userAgent?: string
  acceptLanguage?: string
  timezone?: string
  webrtcPolicy: WebRtcPolicy
}

export type WorkspaceProxyMode = 'direct' | 'system' | 'custom' | 'managed-node'

export interface WorkspaceProxyBinding {
  mode: WorkspaceProxyMode
  customUrl?: string
  nodeId?: string
  groupName?: string
}

export interface WorkspaceAgentPolicy {
  enabled: boolean
  isolatedMemory: boolean
  allowCrossWorkspaceRead: false
  enabledSkillIds: string[]
  enabledMcpServerIds: string[]
}

export interface Workspace {
  id: WorkspaceId
  name: string
  icon: string
  seedColor: string
  partition: string
  isolation: WorkspaceIsolationConfig
  proxy: WorkspaceProxyBinding
  agentPolicy: WorkspaceAgentPolicy
  pinnedTabIds: TabId[]
  activeTabId: TabId | null
  createdAt: number
  updatedAt: number
}

export interface CreateWorkspaceInput {
  name: string
  icon?: string
  seedColor?: string
  isolation?: Partial<WorkspaceIsolationConfig>
  proxy?: Partial<WorkspaceProxyBinding>
}

export interface UpdateWorkspaceInput {
  name?: string
  icon?: string
  seedColor?: string
  isolation?: Partial<WorkspaceIsolationConfig>
  proxy?: Partial<WorkspaceProxyBinding>
  agentPolicy?: Partial<Omit<WorkspaceAgentPolicy, 'allowCrossWorkspaceRead'>>
  pinnedTabIds?: TabId[]
  activeTabId?: TabId | null
}
