import type { WorkspaceId, WorkspaceProxyMode } from './workspace.js'

export type ProxyProtocol =
  | 'vmess'
  | 'vless'
  | 'trojan'
  | 'ss'
  | 'hysteria2'
  | 'tuic'
  | 'socks5'
  | 'http'

export type ProxyImportFormat = 'clash-yaml' | 'v2ray-base64' | 'uri-list'

export interface ProxyNode {
  id: string
  name: string
  protocol: ProxyProtocol
  server: string
  port: number
  rawConfig: Record<string, unknown>
  latencyMs?: number | null
  subscriptionId?: string
}

export interface ProxySubscription {
  id: string
  name: string
  url?: string
  format: ProxyImportFormat
  updatedAt: number
  nodeCount: number
}

export interface WorkspaceProxyStatus {
  workspaceId: WorkspaceId
  mode: WorkspaceProxyMode
  localProxyUrl: string | null
  nodeId?: string
  nodeName?: string
  latencyMs?: number | null
  error?: string
}

export interface ProxyEngineStatus {
  coreKind: 'mihomo' | 'sing-box'
  binaryFound: boolean
  binaryPath: string | null
  running: boolean
  controllerUrl: string | null
  lastError?: string
  workspaceStatuses: Record<WorkspaceId, WorkspaceProxyStatus>
}

export interface ImportProxySubscriptionInput {
  name: string
  url?: string
  content?: string
}
