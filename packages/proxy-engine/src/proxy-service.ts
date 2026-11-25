import { randomUUID } from 'node:crypto'
import { Socket } from 'node:net'
import {
  createServiceToken,
  type IKernelContext,
  type IKernelModule,
  type ImportProxySubscriptionInput,
  type IStorageRepository,
  type ProxyEngineStatus,
  type ProxyNode,
  type ProxySubscription,
  type Workspace,
  type WorkspaceId,
  type WorkspaceProxyBinding,
  type WorkspaceProxyStatus,
} from '@wb/contracts'
import { MihomoCoreAdapter } from './mihomo-adapter.js'
import { parseCustomProxyUrl, parseProxyImport } from './parsers.js'
import { PortAllocator } from './port-allocator.js'
import type { WorkspaceListenerMapping } from './config-generator.js'

export const ProxyServiceToken = createServiceToken<ProxyService>('ProxyService')

export interface SessionProxyConfig {
  mode: 'direct' | 'system' | 'fixed_servers'
  proxyRules?: string
  proxyBypassRules?: string
  auth?: { username: string; password: string }
}

export interface ISessionProxyApplier {
  applySessionProxy(workspace: Workspace, config: SessionProxyConfig): Promise<void> | void
}

export interface ProxyServiceOptions {
  runtimeDir: string
  resourcesPath?: string
  getWorkspaces(): Workspace[]
  getProxyBinaryPath(): string | undefined
  updateWorkspaceProxy(workspaceId: WorkspaceId, binding: WorkspaceProxyBinding): Promise<Workspace>
  applier: ISessionProxyApplier
}

async function measureTcpConnectLatency(host: string, port: number, timeoutMs = 3500): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new Socket()
    let settled = false
    const finish = (latency: number | null): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(latency)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(Date.now() - start))
    socket.once('timeout', () => finish(null))
    socket.once('error', () => finish(null))
    socket.connect(port, host)
  })
}

export class ProxyService implements IKernelModule {
  readonly id = 'proxy-engine'

  private ctx!: IKernelContext
  private subscriptions: ProxySubscription[] = []
  private nodes: ProxyNode[] = []
  private readonly portAllocator = new PortAllocator()
  private readonly core: MihomoCoreAdapter
  private readonly workspaceStatuses = new Map<WorkspaceId, WorkspaceProxyStatus>()

  constructor(
    private readonly storage: IStorageRepository,
    private readonly options: ProxyServiceOptions,
  ) {
    this.core = new MihomoCoreAdapter(options.runtimeDir)
  }

  async init(ctx: IKernelContext): Promise<void> {
    this.ctx = ctx
    const state = await this.storage.loadState()
    this.subscriptions = state.proxySubscriptions
    this.nodes = state.proxyNodes
    await this.core.findBinary(this.options.getProxyBinaryPath(), this.options.resourcesPath)

    ctx.events.on('workspace:created', ({ workspace }) => {
      void this.reconcileAllWorkspaces([workspace])
    })
    ctx.events.on('workspace:deleted', ({ workspaceId }) => {
      this.portAllocator.releaseWorkspace(workspaceId)
      this.workspaceStatuses.delete(workspaceId)
      void this.reconcileAllWorkspaces()
    })

    await this.reconcileAllWorkspaces()
    ctx.services.register(ProxyServiceToken, this)
  }

  async dispose(): Promise<void> {
    await this.core.stop()
  }

  listSubscriptions(): ProxySubscription[] {
    return this.subscriptions.map((s) => structuredClone(s))
  }

  listNodes(): ProxyNode[] {
    return this.nodes.map((n) => structuredClone(n))
  }

  getStatus(): ProxyEngineStatus {
    const coreStatus = this.core.getStatusSnapshot()
    const workspaceStatuses: Record<WorkspaceId, WorkspaceProxyStatus> = {}
    for (const [wsId, status] of this.workspaceStatuses.entries()) {
      workspaceStatuses[wsId] = structuredClone(status)
    }
    return {
      coreKind: 'mihomo',
      ...coreStatus,
      workspaceStatuses,
    }
  }

  async setBinaryPath(binaryPath: string): Promise<ProxyEngineStatus> {
    await this.core.findBinary(binaryPath || undefined, this.options.resourcesPath)
    await this.reconcileAllWorkspaces()
    return this.getStatus()
  }

  async importSubscription(input: ImportProxySubscriptionInput): Promise<{
    subscription: ProxySubscription
    nodes: ProxyNode[]
  }> {
    let rawContent = input.content?.trim() ?? ''
    if (!rawContent && input.url) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const res = await fetch(input.url.trim(), { signal: controller.signal })
        if (!res.ok) {
          throw new Error(`拉取订阅失败: HTTP ${res.status}`)
        }
        rawContent = await res.text()
      } finally {
        clearTimeout(timer)
      }
    }

    const subId = `sub_${randomUUID().slice(0, 8)}`
    const parsed = parseProxyImport(rawContent, subId)
    const subscription: ProxySubscription = {
      id: subId,
      name: input.name.trim() || '未命名订阅',
      url: input.url?.trim() || undefined,
      format: parsed.format,
      updatedAt: Date.now(),
      nodeCount: parsed.nodes.length,
    }

    this.subscriptions.push(subscription)
    this.nodes.push(...parsed.nodes)
    await this.storage.saveProxyData(this.subscriptions, this.nodes)
    this.emitUpdated()
    return { subscription: structuredClone(subscription), nodes: parsed.nodes.map((n) => structuredClone(n)) }
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== subscriptionId)
    this.nodes = this.nodes.filter((n) => n.subscriptionId !== subscriptionId)
    await this.storage.saveProxyData(this.subscriptions, this.nodes)
    await this.reconcileAllWorkspaces()
  }

  async testNodeLatency(nodeId: string): Promise<number | null> {
    const node = this.nodes.find((n) => n.id === nodeId)
    if (!node) return null

    let latency = await this.core.testNodeDelay(node.name)
    if (latency === null) {
      latency = await measureTcpConnectLatency(node.server, node.port)
    }

    node.latencyMs = latency
    await this.storage.saveProxyData(this.subscriptions, this.nodes)
    for (const status of this.workspaceStatuses.values()) {
      if (status.nodeId === nodeId) {
        status.latencyMs = latency
      }
    }
    this.emitUpdated()
    return latency
  }

  async setWorkspaceProxy(workspaceId: WorkspaceId, binding: WorkspaceProxyBinding): Promise<ProxyEngineStatus> {
    await this.options.updateWorkspaceProxy(workspaceId, binding)
    await this.reconcileAllWorkspaces()
    return this.getStatus()
  }

  async reconcileAllWorkspaces(extraWorkspaces: Workspace[] = []): Promise<void> {
    const byId = new Map<WorkspaceId, Workspace>()
    for (const ws of this.options.getWorkspaces()) byId.set(ws.id, ws)
    for (const ws of extraWorkspaces) byId.set(ws.id, ws)

    const managedMappings: WorkspaceListenerMapping[] = []
    const pendingSessionApplies: Array<{ ws: Workspace; cfg: SessionProxyConfig }> = []

    for (const ws of byId.values()) {
      const binding = ws.proxy
      if (binding.mode === 'direct') {
        this.portAllocator.releaseWorkspace(ws.id)
        this.workspaceStatuses.set(ws.id, {
          workspaceId: ws.id,
          mode: 'direct',
          localProxyUrl: null,
        })
        pendingSessionApplies.push({ ws, cfg: { mode: 'direct' } })
      } else if (binding.mode === 'system') {
        this.portAllocator.releaseWorkspace(ws.id)
        this.workspaceStatuses.set(ws.id, {
          workspaceId: ws.id,
          mode: 'system',
          localProxyUrl: null,
        })
        pendingSessionApplies.push({ ws, cfg: { mode: 'system' } })
      } else if (binding.mode === 'custom' && binding.customUrl) {
        this.portAllocator.releaseWorkspace(ws.id)
        try {
          const parsed = parseCustomProxyUrl(binding.customUrl)
          this.workspaceStatuses.set(ws.id, {
            workspaceId: ws.id,
            mode: 'custom',
            localProxyUrl: parsed.proxyRules,
          })
          pendingSessionApplies.push({
            ws,
            cfg: {
              mode: 'fixed_servers',
              proxyRules: parsed.proxyRules,
              proxyBypassRules: 'localhost,127.0.0.1,::1',
              auth:
                parsed.username !== undefined
                  ? { username: parsed.username, password: parsed.password ?? '' }
                  : undefined,
            },
          })
        } catch (err) {
          this.workspaceStatuses.set(ws.id, {
            workspaceId: ws.id,
            mode: 'custom',
            localProxyUrl: null,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      } else if (binding.mode === 'managed-node' && binding.nodeId) {
        const node = this.nodes.find((n) => n.id === binding.nodeId)
        if (!node) {
          this.portAllocator.releaseWorkspace(ws.id)
          this.workspaceStatuses.set(ws.id, {
            workspaceId: ws.id,
            mode: 'managed-node',
            localProxyUrl: null,
            error: '绑定的节点已不存在，请重新选择',
          })
          pendingSessionApplies.push({ ws, cfg: { mode: 'direct' } })
        } else {
          const port = await this.portAllocator.allocateForWorkspace(ws.id)
          const localProxyUrl = `http://127.0.0.1:${port}`
          managedMappings.push({ workspaceId: ws.id, port, node })
          this.workspaceStatuses.set(ws.id, {
            workspaceId: ws.id,
            mode: 'managed-node',
            localProxyUrl,
            nodeId: node.id,
            nodeName: node.name,
            latencyMs: node.latencyMs ?? null,
          })
          pendingSessionApplies.push({
            ws,
            cfg: {
              mode: 'fixed_servers',
              proxyRules: localProxyUrl,
              proxyBypassRules: 'localhost,127.0.0.1,::1',
            },
          })
        }
      } else {
        this.portAllocator.releaseWorkspace(ws.id)
        this.workspaceStatuses.set(ws.id, {
          workspaceId: ws.id,
          mode: binding.mode,
          localProxyUrl: null,
        })
        pendingSessionApplies.push({ ws, cfg: { mode: 'direct' } })
      }
    }

    await this.core.applyConfig(
      this.nodes,
      managedMappings,
      this.options.getProxyBinaryPath(),
      this.options.resourcesPath,
    )

    const coreSnap = this.core.getStatusSnapshot()
    if (managedMappings.length > 0 && !coreSnap.binaryFound) {
      for (const m of managedMappings) {
        const prev = this.workspaceStatuses.get(m.workspaceId)
        if (prev) {
          prev.error = coreSnap.lastError
        }
      }
    }

    for (const item of pendingSessionApplies) {
      // Only enforce managed-node proxy when core binary is actually available, else keep direct so pages still load safely
      if (item.ws.proxy.mode === 'managed-node' && !coreSnap.binaryFound) {
        await this.options.applier.applySessionProxy(item.ws, { mode: 'direct' })
      } else {
        await this.options.applier.applySessionProxy(item.ws, item.cfg)
      }
    }

    this.emitUpdated()
  }

  private emitUpdated(): void {
    this.ctx?.events.emit('proxy:updated', { status: this.getStatus() })
  }
}
