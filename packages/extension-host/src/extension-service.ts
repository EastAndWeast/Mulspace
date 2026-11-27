import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createServiceToken,
  type IKernelContext,
  type IKernelModule,
  type InstalledExtension,
  type IStorageRepository,
  type Workspace,
  type WorkspaceId,
} from '@wb/contracts'
import { unpackCrxBuffer } from './crx-unpacker.js'
import { readExtensionManifest } from './manifest-parser.js'

export const ExtensionServiceToken = createServiceToken<ExtensionService>('ExtensionService')

export interface ISessionExtensionAdapter {
  loadIntoSession(partition: string, dirPath: string): Promise<string | null> | string | null
  removeFromSession(partition: string, runtimeExtensionId: string): Promise<void> | void
}

export interface ExtensionServiceOptions {
  extensionsDir: string
  getWorkspaces(): Workspace[]
  adapter: ISessionExtensionAdapter
}

export function isExtensionEnabledForWorkspace(
  ext: InstalledExtension,
  workspaceId: WorkspaceId,
): boolean {
  if (ext.disabledWorkspaces.includes(workspaceId)) return false
  if (ext.enabledWorkspaces.includes(workspaceId)) return true
  return ext.enabledGlobally
}

export class ExtensionService implements IKernelModule {
  readonly id = 'extension-host'

  private ctx!: IKernelContext
  private extensions: InstalledExtension[] = []
  // Map<`${workspaceId}:${installedExtId}`, electronRuntimeExtensionId>
  private readonly loadedRuntimeIds = new Map<string, string>()

  constructor(
    private readonly storage: IStorageRepository,
    private readonly options: ExtensionServiceOptions,
  ) {}

  async init(ctx: IKernelContext): Promise<void> {
    this.ctx = ctx
    const state = await this.storage.loadState()
    this.extensions = state.extensions

    ctx.events.on('workspace:created', ({ workspace }) => {
      void this.syncWorkspace(workspace)
    })
    ctx.events.on('workspace:deleted', ({ workspaceId }) => {
      for (const key of [...this.loadedRuntimeIds.keys()]) {
        if (key.startsWith(`${workspaceId}:`)) {
          this.loadedRuntimeIds.delete(key)
        }
      }
    })

    await this.syncAllWorkspaces()
    ctx.services.register(ExtensionServiceToken, this)
  }

  list(): InstalledExtension[] {
    return this.extensions.map((e) => structuredClone(e))
  }

  getRuntimeExtensionId(workspaceId: WorkspaceId, extensionId: string): string | undefined {
    return this.loadedRuntimeIds.get(`${workspaceId}:${extensionId}`)
  }

  async installFromFolder(folderPath: string): Promise<InstalledExtension> {
    const manifest = await readExtensionManifest(folderPath)
    const id = `ext_${randomUUID().slice(0, 8)}`
    const destDir = join(this.options.extensionsDir, id)
    await mkdir(destDir, { recursive: true })
    await cp(folderPath, destDir, { recursive: true })

    const installed: InstalledExtension = {
      id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      manifestVersion: manifest.manifestVersion,
      installPath: destDir,
      popupPath: manifest.popupPath,
      iconPath: manifest.iconPath,
      enabledGlobally: true,
      enabledWorkspaces: [],
      disabledWorkspaces: [],
      installedAt: Date.now(),
    }

    this.extensions.push(installed)
    await this.storage.saveExtensions(this.extensions)
    await this.syncAllWorkspaces()
    this.emitUpdated()
    return structuredClone(installed)
  }

  async installFromCrx(crxPath: string): Promise<InstalledExtension> {
    const buf = await readFile(crxPath)
    const id = `ext_${randomUUID().slice(0, 8)}`
    const destDir = join(this.options.extensionsDir, id)
    try {
      await unpackCrxBuffer(buf, destDir)
      const manifest = await readExtensionManifest(destDir)
      const installed: InstalledExtension = {
        id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        manifestVersion: manifest.manifestVersion,
        installPath: destDir,
        popupPath: manifest.popupPath,
        iconPath: manifest.iconPath,
        enabledGlobally: true,
        enabledWorkspaces: [],
        disabledWorkspaces: [],
        installedAt: Date.now(),
      }
      this.extensions.push(installed)
      await this.storage.saveExtensions(this.extensions)
      await this.syncAllWorkspaces()
      this.emitUpdated()
      return structuredClone(installed)
    } catch (err) {
      await rm(destDir, { recursive: true, force: true })
      throw err
    }
  }

  async toggleForWorkspace(
    extensionId: string,
    workspaceId: WorkspaceId,
    enabled: boolean,
  ): Promise<InstalledExtension[]> {
    const ext = this.extensions.find((e) => e.id === extensionId)
    if (!ext) {
      throw new Error(`Extension not found: ${extensionId}`)
    }

    ext.enabledWorkspaces = ext.enabledWorkspaces.filter((id) => id !== workspaceId)
    ext.disabledWorkspaces = ext.disabledWorkspaces.filter((id) => id !== workspaceId)

    if (enabled) {
      ext.enabledWorkspaces.push(workspaceId)
    } else {
      ext.disabledWorkspaces.push(workspaceId)
    }

    await this.storage.saveExtensions(this.extensions)
    const ws = this.options.getWorkspaces().find((w) => w.id === workspaceId)
    if (ws) {
      await this.syncWorkspace(ws)
    }
    this.emitUpdated()
    return this.list()
  }

  async remove(extensionId: string): Promise<InstalledExtension[]> {
    const ext = this.extensions.find((e) => e.id === extensionId)
    if (!ext) return this.list()

    for (const ws of this.options.getWorkspaces()) {
      const key = `${ws.id}:${ext.id}`
      const runtimeId = this.loadedRuntimeIds.get(key)
      if (runtimeId) {
        await this.options.adapter.removeFromSession(ws.partition, runtimeId)
        this.loadedRuntimeIds.delete(key)
      }
    }

    this.extensions = this.extensions.filter((e) => e.id !== extensionId)
    await this.storage.saveExtensions(this.extensions)
    await rm(ext.installPath, { recursive: true, force: true })
    this.emitUpdated()
    return this.list()
  }

  async syncAllWorkspaces(): Promise<void> {
    if (this.extensions.length === 0) return
    await Promise.all(this.options.getWorkspaces().map((ws) => this.syncWorkspace(ws)))
  }

  async syncWorkspace(workspace: Workspace): Promise<void> {
    for (const ext of this.extensions) {
      const key = `${workspace.id}:${ext.id}`
      const shouldEnable = isExtensionEnabledForWorkspace(ext, workspace.id)
      const existingRuntimeId = this.loadedRuntimeIds.get(key)

      if (shouldEnable && !existingRuntimeId) {
        try {
          const runtimeId = await this.options.adapter.loadIntoSession(workspace.partition, ext.installPath)
          if (runtimeId) {
            this.loadedRuntimeIds.set(key, runtimeId)
          }
        } catch {
          // Keep resilient if an unpacked extension directory is missing
        }
      } else if (!shouldEnable && existingRuntimeId) {
        await this.options.adapter.removeFromSession(workspace.partition, existingRuntimeId)
        this.loadedRuntimeIds.delete(key)
      }
    }
  }

  private emitUpdated(): void {
    this.ctx?.events.emit('extensions:updated', { extensions: this.list() })
  }
}
