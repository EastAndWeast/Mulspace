import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AppSettings,
  InstalledExtension,
  IStorageRepository,
  McpServerConfig,
  PersistedBrowserState,
  ProxyNode,
  ProxySubscription,
  SkillDefinition,
  Tab,
  ThemeManifest,
  Workspace,
  WorkspaceId,
} from '@wb/contracts'

export function createDefaultAppSettings(): AppSettings {
  return {
    themeId: 'material-you',
    themeMode: 'system',
    followWorkspaceColor: true,
    freezeAfterMs: 5 * 60 * 1000,
    discardAfterMs: 20 * 60 * 1000,
    maxLiveTabs: 12,
    autoCheckUpdates: true,
    mcpHost: {
      enabled: true,
      port: 19789,
      authToken: `wb_${randomUUID().replace(/-/g, '')}`,
      allowedWorkspaceIds: 'all',
    },
    llmProviders: [
      {
        id: 'openai-default',
        name: 'OpenAI / DeepSeek / 兼容接口',
        kind: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
        enabled: true,
      },
      {
        id: 'ollama-local',
        name: 'Ollama 本地模型',
        kind: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen2.5:7b',
        enabled: true,
      },
    ],
    activeLlmProviderId: 'openai-default',
  }
}

export const DEFAULT_APP_SETTINGS: AppSettings = createDefaultAppSettings()

function createInitialSeedState(now = Date.now()): PersistedBrowserState {
  const ws1: Workspace = {
    id: 'ws_default_1',
    name: '默认空间',
    icon: '🧭',
    seedColor: '#3B82F6',
    partition: 'persist:ws-ws_default_1',
    isolation: {
      webrtcPolicy: 'disable_non_proxied_udp',
    },
    proxy: {
      mode: 'system',
    },
    agentPolicy: {
      enabled: true,
      isolatedMemory: true,
      allowCrossWorkspaceRead: false,
      enabledSkillIds: [],
      enabledMcpServerIds: [],
    },
    pinnedTabIds: [],
    activeTabId: 'tab_seed_1',
    createdAt: now,
    updatedAt: now,
  }

  const ws2: Workspace = {
    id: 'ws_account_2',
    name: '账号空间 2',
    icon: '🔐',
    seedColor: '#8B5CF6',
    partition: 'persist:ws-ws_account_2',
    isolation: {
      webrtcPolicy: 'disable_non_proxied_udp',
    },
    proxy: {
      mode: 'system',
    },
    agentPolicy: {
      enabled: true,
      isolatedMemory: true,
      allowCrossWorkspaceRead: false,
      enabledSkillIds: [],
      enabledMcpServerIds: [],
    },
    pinnedTabIds: [],
    activeTabId: 'tab_seed_2',
    createdAt: now,
    updatedAt: now,
  }

  return {
    schemaVersion: 1,
    workspaces: [ws1, ws2],
    tabsByWorkspace: {
      [ws1.id]: [
        {
          id: 'tab_seed_1',
          workspaceId: ws1.id,
          url: 'https://www.bing.com',
          title: 'Bing',
          state: 'discarded',
          pinned: false,
          muted: false,
          audible: false,
          loading: false,
          canGoBack: false,
          canGoForward: false,
          aiBusy: false,
          lockedFromDiscard: false,
          lastActiveAt: now,
        },
      ],
      [ws2.id]: [
        {
          id: 'tab_seed_2',
          workspaceId: ws2.id,
          url: 'https://www.bing.com',
          title: 'Bing (独立账号环境)',
          state: 'discarded',
          pinned: false,
          muted: false,
          audible: false,
          loading: false,
          canGoBack: false,
          canGoForward: false,
          aiBusy: false,
          lockedFromDiscard: false,
          lastActiveAt: now,
        },
      ],
    },
    lastActiveWorkspaceId: ws1.id,
    settings: createDefaultAppSettings(),
    proxySubscriptions: [],
    proxyNodes: [],
    skills: [],
    mcpServers: [],
    extensions: [],
    customThemes: [],
  }
}

const ENC_PREFIX = 'enc:v1:'

export interface StorageSecretCipher {
  encrypt(plain: string): string
  decrypt(ciphertext: string): string
}

export class JsonStorageRepository implements IStorageRepository {
  private readonly filePath: string
  private state: PersistedBrowserState | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    dataDir: string,
    fileName = 'browser-state.json',
    private readonly cipher?: StorageSecretCipher,
  ) {
    this.filePath = join(dataDir, fileName)
  }

  private encryptSecret(plain: string): string {
    if (!this.cipher || !plain || plain.startsWith(ENC_PREFIX)) return plain
    try {
      return `${ENC_PREFIX}${this.cipher.encrypt(plain)}`
    } catch {
      return plain
    }
  }

  private decryptSecret(value: string): string {
    if (!this.cipher || !value.startsWith(ENC_PREFIX)) return value
    try {
      return this.cipher.decrypt(value.slice(ENC_PREFIX.length))
    } catch {
      return value
    }
  }

  private transformSecretsForDisk(state: PersistedBrowserState): PersistedBrowserState {
    const copy = structuredClone(state)
    copy.workspaces = copy.workspaces.map((ws) => {
      if (ws.proxy?.customUrl && ws.proxy.customUrl.includes('@')) {
        return {
          ...ws,
          proxy: { ...ws.proxy, customUrl: this.encryptSecret(ws.proxy.customUrl) },
        }
      }
      return ws
    })
    if (copy.settings?.mcpHost?.authToken) {
      copy.settings.mcpHost.authToken = this.encryptSecret(copy.settings.mcpHost.authToken)
    }
    if (Array.isArray(copy.settings?.llmProviders)) {
      copy.settings.llmProviders = copy.settings.llmProviders.map((p) =>
        p.apiKey ? { ...p, apiKey: this.encryptSecret(p.apiKey) } : p,
      )
    }
    return copy
  }

  private decryptSecretsFromDisk(state: PersistedBrowserState): PersistedBrowserState {
    state.workspaces = state.workspaces.map((ws) => {
      if (ws.proxy?.customUrl?.startsWith(ENC_PREFIX)) {
        return {
          ...ws,
          proxy: { ...ws.proxy, customUrl: this.decryptSecret(ws.proxy.customUrl) },
        }
      }
      return ws
    })
    if (state.settings?.mcpHost?.authToken?.startsWith(ENC_PREFIX)) {
      state.settings.mcpHost.authToken = this.decryptSecret(state.settings.mcpHost.authToken)
    }
    if (Array.isArray(state.settings?.llmProviders)) {
      state.settings.llmProviders = state.settings.llmProviders.map((p) =>
        p.apiKey?.startsWith(ENC_PREFIX) ? { ...p, apiKey: this.decryptSecret(p.apiKey) } : p,
      )
    }
    return state
  }

  async loadState(): Promise<PersistedBrowserState> {
    if (this.state) {
      return structuredClone(this.state)
    }

    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedBrowserState>
      if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
        const defaults = createDefaultAppSettings()
        this.state = this.decryptSecretsFromDisk({
          schemaVersion: 1,
          workspaces: parsed.workspaces,
          tabsByWorkspace: parsed.tabsByWorkspace ?? {},
          lastActiveWorkspaceId: parsed.lastActiveWorkspaceId ?? parsed.workspaces[0]!.id,
          settings: {
            ...defaults,
            ...(parsed.settings ?? {}),
            mcpHost: {
              ...defaults.mcpHost,
              ...(parsed.settings?.mcpHost ?? {}),
            },
            llmProviders:
              Array.isArray(parsed.settings?.llmProviders) && parsed.settings.llmProviders.length > 0
                ? parsed.settings.llmProviders
                : defaults.llmProviders,
          },
          proxySubscriptions: parsed.proxySubscriptions ?? [],
          proxyNodes: parsed.proxyNodes ?? [],
          skills: parsed.skills ?? [],
          mcpServers: parsed.mcpServers ?? [],
          extensions: parsed.extensions ?? [],
          customThemes: parsed.customThemes ?? [],
        })
        return structuredClone(this.state)
      }
    } catch {
      // File missing or corrupted -> fall back to seed state.
    }

    this.state = createInitialSeedState()
    await this.flush(this.state)
    return structuredClone(this.state)
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    const state = await this.ensureState()
    const idx = state.workspaces.findIndex((w) => w.id === workspace.id)
    if (idx >= 0) {
      state.workspaces[idx] = structuredClone(workspace)
    } else {
      state.workspaces.push(structuredClone(workspace))
      state.tabsByWorkspace[workspace.id] ??= []
    }
    await this.flush(state)
  }

  async deleteWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const state = await this.ensureState()
    state.workspaces = state.workspaces.filter((w) => w.id !== workspaceId)
    delete state.tabsByWorkspace[workspaceId]
    if (state.lastActiveWorkspaceId === workspaceId) {
      state.lastActiveWorkspaceId = state.workspaces[0]?.id ?? null
    }
    await this.flush(state)
  }

  async saveTabsForWorkspace(workspaceId: WorkspaceId, tabs: Tab[]): Promise<void> {
    const state = await this.ensureState()
    state.tabsByWorkspace[workspaceId] = structuredClone(tabs)
    await this.flush(state)
  }

  async saveLastActiveWorkspaceId(workspaceId: WorkspaceId | null): Promise<void> {
    const state = await this.ensureState()
    state.lastActiveWorkspaceId = workspaceId
    await this.flush(state)
  }

  async getSettings(): Promise<AppSettings> {
    const state = await this.ensureState()
    return structuredClone(state.settings)
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const state = await this.ensureState()
    state.settings = structuredClone(settings)
    await this.flush(state)
  }

  async saveProxyData(subscriptions: ProxySubscription[], nodes: ProxyNode[]): Promise<void> {
    const state = await this.ensureState()
    state.proxySubscriptions = structuredClone(subscriptions)
    state.proxyNodes = structuredClone(nodes)
    await this.flush(state)
  }

  async saveSkills(skills: SkillDefinition[]): Promise<void> {
    const state = await this.ensureState()
    state.skills = structuredClone(skills)
    await this.flush(state)
  }

  async saveMcpServers(servers: McpServerConfig[]): Promise<void> {
    const state = await this.ensureState()
    state.mcpServers = structuredClone(servers)
    await this.flush(state)
  }

  async saveExtensions(extensions: InstalledExtension[]): Promise<void> {
    const state = await this.ensureState()
    state.extensions = structuredClone(extensions)
    await this.flush(state)
  }

  async saveCustomThemes(themes: ThemeManifest[]): Promise<void> {
    const state = await this.ensureState()
    state.customThemes = structuredClone(themes)
    await this.flush(state)
  }

  private async ensureState(): Promise<PersistedBrowserState> {
    if (!this.state) {
      await this.loadState()
    }
    return this.state!
  }

  private flush(snapshotSource: PersistedBrowserState): Promise<void> {
    const diskState = this.transformSecretsForDisk(snapshotSource)
    const payload = JSON.stringify(diskState, null, 2)
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmpPath, payload, { encoding: 'utf8', mode: 0o600 })
      await chmod(tmpPath, 0o600).catch(() => undefined)
      await rename(tmpPath, this.filePath)
    })
    return this.writeChain
  }
}
