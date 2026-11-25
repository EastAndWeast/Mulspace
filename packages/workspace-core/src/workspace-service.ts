import { randomUUID } from 'node:crypto'
import {
  createServiceToken,
  type CreateWorkspaceInput,
  type IKernelContext,
  type IKernelModule,
  type IStorageRepository,
  type UpdateWorkspaceInput,
  type WindowId,
  type Workspace,
  type WorkspaceId,
} from '@wb/contracts'

export const WorkspaceServiceToken = createServiceToken<WorkspaceService>('WorkspaceService')

const DEFAULT_SEED_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4']

function sanitizeHexColor(input?: string): string {
  if (input && /^#[0-9a-fA-F]{6}$/.test(input)) {
    return input
  }
  return DEFAULT_SEED_COLORS[Math.floor(Math.random() * DEFAULT_SEED_COLORS.length)]!
}

export class WorkspaceService implements IKernelModule {
  readonly id = 'workspace-core'

  private ctx!: IKernelContext
  private workspaces: Workspace[] = []
  private readonly windowActiveWorkspace = new Map<WindowId, WorkspaceId>()
  private lastActiveWorkspaceId: WorkspaceId | null = null

  constructor(private readonly storage: IStorageRepository) {}

  async init(ctx: IKernelContext): Promise<void> {
    this.ctx = ctx
    const state = await this.storage.loadState()
    this.workspaces = state.workspaces
    this.lastActiveWorkspaceId = state.lastActiveWorkspaceId ?? this.workspaces[0]?.id ?? null
    ctx.services.register(WorkspaceServiceToken, this)
  }

  list(): Workspace[] {
    return this.workspaces.map((w) => structuredClone(w))
  }

  get(workspaceId: WorkspaceId): Workspace | undefined {
    const ws = this.workspaces.find((w) => w.id === workspaceId)
    return ws ? structuredClone(ws) : undefined
  }

  getDefaultWorkspaceId(): WorkspaceId {
    if (this.lastActiveWorkspaceId && this.workspaces.some((w) => w.id === this.lastActiveWorkspaceId)) {
      return this.lastActiveWorkspaceId
    }
    if (!this.workspaces[0]) {
      throw new Error('No workspaces available')
    }
    return this.workspaces[0].id
  }

  getActiveWorkspaceForWindow(windowId: WindowId): WorkspaceId {
    const active = this.windowActiveWorkspace.get(windowId)
    if (active && this.workspaces.some((w) => w.id === active)) {
      return active
    }
    const fallback = this.getDefaultWorkspaceId()
    this.windowActiveWorkspace.set(windowId, fallback)
    return fallback
  }

  async bindWindowToWorkspace(windowId: WindowId, workspaceId: WorkspaceId): Promise<Workspace> {
    const ws = this.workspaces.find((w) => w.id === workspaceId)
    if (!ws) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }
    this.windowActiveWorkspace.set(windowId, workspaceId)
    this.lastActiveWorkspaceId = workspaceId
    await this.storage.saveLastActiveWorkspaceId(workspaceId)
    this.ctx.events.emit('workspace:switched', { windowId, workspaceId })
    return structuredClone(ws)
  }

  unbindWindow(windowId: WindowId): void {
    this.windowActiveWorkspace.delete(windowId)
  }

  getWindowsForWorkspace(workspaceId: WorkspaceId): WindowId[] {
    const result: WindowId[] = []
    for (const [winId, wsId] of this.windowActiveWorkspace.entries()) {
      if (wsId === workspaceId) result.push(winId)
    }
    return result
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const trimmedName = input.name.trim()
    if (!trimmedName) {
      throw new Error('Workspace name cannot be empty')
    }

    const now = Date.now()
    const id = `ws_${randomUUID().slice(0, 8)}`
    const workspace: Workspace = {
      id,
      name: trimmedName,
      icon: input.icon?.trim() || '🌐',
      seedColor: sanitizeHexColor(input.seedColor),
      partition: `persist:ws-${id}`,
      isolation: {
        userAgent: input.isolation?.userAgent?.trim() || undefined,
        acceptLanguage: input.isolation?.acceptLanguage?.trim() || undefined,
        timezone: input.isolation?.timezone?.trim() || undefined,
        webrtcPolicy: input.isolation?.webrtcPolicy ?? 'disable_non_proxied_udp',
      },
      proxy: {
        mode: input.proxy?.mode ?? 'direct',
        customUrl: input.proxy?.customUrl,
        nodeId: input.proxy?.nodeId,
        groupName: input.proxy?.groupName,
      },
      agentPolicy: {
        enabled: true,
        isolatedMemory: true,
        allowCrossWorkspaceRead: false,
        enabledSkillIds: [],
        enabledMcpServerIds: [],
      },
      pinnedTabIds: [],
      activeTabId: null,
      createdAt: now,
      updatedAt: now,
    }

    this.workspaces.push(workspace)
    await this.storage.saveWorkspace(workspace)
    this.ctx.events.emit('workspace:created', { workspace: structuredClone(workspace) })
    return structuredClone(workspace)
  }

  async update(workspaceId: WorkspaceId, patch: UpdateWorkspaceInput): Promise<Workspace> {
    const idx = this.workspaces.findIndex((w) => w.id === workspaceId)
    if (idx < 0) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }

    const current = this.workspaces[idx]!
    const nextName = patch.name !== undefined ? patch.name.trim() : current.name
    if (!nextName) {
      throw new Error('Workspace name cannot be empty')
    }

    const updated: Workspace = {
      ...current,
      name: nextName,
      icon: patch.icon !== undefined ? patch.icon.trim() || current.icon : current.icon,
      seedColor: patch.seedColor !== undefined ? sanitizeHexColor(patch.seedColor) : current.seedColor,
      isolation: patch.isolation
        ? {
            ...current.isolation,
            ...patch.isolation,
          }
        : current.isolation,
      proxy: patch.proxy
        ? {
            ...current.proxy,
            ...patch.proxy,
          }
        : current.proxy,
      agentPolicy: patch.agentPolicy
        ? {
            ...current.agentPolicy,
            ...patch.agentPolicy,
            allowCrossWorkspaceRead: false,
          }
        : current.agentPolicy,
      pinnedTabIds: patch.pinnedTabIds ?? current.pinnedTabIds,
      activeTabId: patch.activeTabId !== undefined ? patch.activeTabId : current.activeTabId,
      updatedAt: Date.now(),
    }

    this.workspaces[idx] = updated
    await this.storage.saveWorkspace(updated)
    this.ctx.events.emit('workspace:updated', { workspace: structuredClone(updated) })
    return structuredClone(updated)
  }

  async delete(workspaceId: WorkspaceId): Promise<void> {
    if (this.workspaces.length <= 1) {
      throw new Error('Cannot delete the last remaining workspace')
    }
    const exists = this.workspaces.some((w) => w.id === workspaceId)
    if (!exists) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }

    this.workspaces = this.workspaces.filter((w) => w.id !== workspaceId)
    const fallbackId = this.workspaces[0]!.id
    if (this.lastActiveWorkspaceId === workspaceId) {
      this.lastActiveWorkspaceId = fallbackId
    }

    for (const [winId, activeWsId] of this.windowActiveWorkspace.entries()) {
      if (activeWsId === workspaceId) {
        this.windowActiveWorkspace.set(winId, fallbackId)
        this.ctx.events.emit('workspace:switched', { windowId: winId, workspaceId: fallbackId })
      }
    }

    await this.storage.deleteWorkspace(workspaceId)
    this.ctx.events.emit('workspace:deleted', { workspaceId })
  }
}
