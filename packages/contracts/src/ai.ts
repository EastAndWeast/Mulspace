import type { WorkspaceId } from './workspace.js'

export type LLMProviderKind = 'openai-compatible' | 'anthropic' | 'gemini' | 'ollama'

export interface LLMProviderConfig {
  id: string
  name: string
  kind: LLMProviderKind
  baseUrl: string
  apiKey?: string
  model: string
  enabled: boolean
}

export interface SkillDefinition {
  id: string
  name: string
  description: string
  promptTemplate: string
  allowedTools: string[]
  scope: 'global' | WorkspaceId
  sourcePath?: string
  builtIn?: boolean
}

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  scope: 'global' | WorkspaceId
}

export interface McpHostConfig {
  enabled: boolean
  port: number
  authToken: string
  allowedWorkspaceIds: WorkspaceId[] | 'all'
}

export interface McpHostStatus {
  running: boolean
  endpointUrl: string | null
  config: McpHostConfig
  clientSnippet: string
  lastError?: string
}

export type AgentA2UINode =
  | { type: 'text'; id: string; text: string; tone?: 'title' | 'body' | 'muted' }
  | { type: 'kv-list'; id: string; items: Array<{ label: string; value: string; badge?: string }> }
  | {
      type: 'action-row'
      id: string
      actions: Array<{ id: string; label: string; variant?: 'filled' | 'tonal' | 'outlined' }>
    }

export interface AgentA2UICard {
  surfaceId: string
  title: string
  badge?: string
  nodes: AgentA2UINode[]
}

export interface AgentMessage {
  id: string
  workspaceId: WorkspaceId
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  a2uiCard?: AgentA2UICard
  createdAt: number
}

export interface BatchJobResult {
  workspaceId: WorkspaceId
  status: 'pending' | 'running' | 'completed' | 'failed'
  summary?: string
  error?: string
}

export interface BatchJob {
  id: string
  name: string
  prompt: string
  skillId?: string
  workspaceIds: WorkspaceId[]
  status: 'pending' | 'running' | 'completed' | 'failed'
  results: Record<WorkspaceId, BatchJobResult>
  createdAt: number
  completedAt?: number
}

export interface RunBatchJobInput {
  name: string
  prompt: string
  skillId?: string
  workspaceIds: WorkspaceId[]
}
