import type { BatchJob } from './ai.js'
import type { InstalledExtension } from './extension.js'
import type { ProxyEngineStatus } from './proxy.js'
import type { AppSettings } from './storage.js'
import type { Tab, TabLifecycleState } from './tab.js'
import type { ThemeManifest } from './theme.js'
import type { UpdateState } from './update.js'
import type { WindowId, Workspace, WorkspaceId, WorkspaceProxyBinding } from './workspace.js'

export interface KernelEventMap {
  'workspace:created': { workspace: Workspace }
  'workspace:updated': { workspace: Workspace }
  'workspace:deleted': { workspaceId: WorkspaceId }
  'workspace:switched': { windowId: WindowId; workspaceId: WorkspaceId }
  'tab:created': { tab: Tab }
  'tab:updated': { tab: Tab }
  'tab:closed': { workspaceId: WorkspaceId; tabId: string }
  'tab:lifecycle-changed': {
    workspaceId: WorkspaceId
    tabId: string
    from: TabLifecycleState
    to: TabLifecycleState
  }
  'settings:updated': { settings: AppSettings }
  'proxy:updated': { status: ProxyEngineStatus }
  'ai:message': { workspaceId: WorkspaceId }
  'ai:batch-updated': { job: BatchJob }
  'extensions:updated': { extensions: InstalledExtension[] }
  'themes:updated': { themes: ThemeManifest[] }
  'update:state-changed': { state: UpdateState }
}

export type Unsubscribe = () => void

export interface IEventBus<TMap extends object = KernelEventMap> {
  on<K extends keyof TMap>(event: K, handler: (payload: TMap[K]) => void): Unsubscribe
  once<K extends keyof TMap>(event: K, handler: (payload: TMap[K]) => void): Unsubscribe
  off<K extends keyof TMap>(event: K, handler: (payload: TMap[K]) => void): void
  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void
}

export interface ServiceToken<T> {
  readonly id: symbol
  readonly description: string
  readonly __type?: T
}

export function createServiceToken<T>(description: string): ServiceToken<T> {
  return { id: Symbol(description), description }
}

export interface IServiceRegistry {
  register<T>(token: ServiceToken<T>, instance: T): void
  resolve<T>(token: ServiceToken<T>): T
  has<T>(token: ServiceToken<T>): boolean
}

export interface IKernelContext {
  readonly events: IEventBus<KernelEventMap>
  readonly services: IServiceRegistry
}

export interface IKernelModule {
  readonly id: string
  init(ctx: IKernelContext): Promise<void> | void
  dispose?(): Promise<void> | void
}

export interface ProxyNodeSummary {
  id: string
  name: string
  protocol: string
  latencyMs?: number | null
}

export interface IProxyCore {
  readonly kind: 'mihomo' | 'sing-box'
  start(): Promise<void>
  stop(): Promise<void>
  bindWorkspace(workspaceId: WorkspaceId, binding: WorkspaceProxyBinding): Promise<{ localProxyUrl: string | null }>
  listNodes(): Promise<ProxyNodeSummary[]>
  testLatency(nodeId: string): Promise<number | null>
}

export interface IAgentRuntime {
  runTask(workspaceId: WorkspaceId, prompt: string): Promise<{ taskId: string }>
  cancelTask(taskId: string): Promise<void>
}
