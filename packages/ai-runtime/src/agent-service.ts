import { randomUUID } from 'node:crypto'
import {
  createServiceToken,
  type AgentA2UICard,
  type AgentMessage,
  type BatchJob,
  type IAgentRuntime,
  type IKernelContext,
  type IKernelModule,
  type IStorageRepository,
  type LLMProviderConfig,
  type McpHostConfig,
  type McpHostStatus,
  type McpServerConfig,
  type RunBatchJobInput,
  type SkillDefinition,
  type Workspace,
  type WorkspaceId,
} from '@wb/contracts'
import { detectHumanTakeoverNeeded, type ICdpAutomationBridge } from './cdp-automation.js'
import { LLMClient, type LLMChatMessage, type LLMToolDeclaration } from './llm-client.js'
import { McpClientManager } from './mcp-client.js'
import { BrowserMcpServer } from './mcp-server.js'
import { WorkspaceBoundaryGuard } from './security-guard.js'
import { SkillRegistry } from './skill-registry.js'

export const AgentServiceToken = createServiceToken<AgentService>('AgentService')

export interface AgentServiceOptions {
  skillsDir?: string
  getWorkspaces(): Workspace[]
  getWorkspace(workspaceId: WorkspaceId): Workspace | undefined
  getActiveLlmProvider(): LLMProviderConfig | undefined
  getMcpHostConfig(): McpHostConfig
  updateMcpHostConfig(patch: Partial<McpHostConfig>): Promise<McpHostConfig>
  bridge: ICdpAutomationBridge
}

const BUILTIN_BROWSER_TOOLS: LLMToolDeclaration[] = [
  {
    name: 'get_page_snapshot',
    description: '获取当前工作区激活标签页的 URL、标题、可交互元素列表和文本摘要',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_workspace_env',
    description: '获取当前工作区的隔离分区、代理模式与标签页状态',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'navigate',
    description: '在当前工作区激活标签页打开指定网址',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'click_element',
    description: '点击页面快照中指定 ref 的元素',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'type_text',
    description: '向页面快照中指定 ref 输入框输入文本',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
      },
      required: ['ref', 'text'],
    },
  },
]

export class AgentService implements IKernelModule, IAgentRuntime {
  readonly id = 'ai-runtime'

  private ctx!: IKernelContext
  private readonly messagesByWorkspace = new Map<WorkspaceId, AgentMessage[]>()
  private readonly batchJobs: BatchJob[] = []
  private readonly guard = new WorkspaceBoundaryGuard()
  private readonly llm = new LLMClient()
  private readonly skillRegistry: SkillRegistry
  private readonly mcpClient = new McpClientManager()
  private readonly mcpServer: BrowserMcpServer
  private readonly cancelledTasks = new Set<string>()

  constructor(
    private readonly storage: IStorageRepository,
    private readonly options: AgentServiceOptions,
  ) {
    this.skillRegistry = new SkillRegistry(options.skillsDir)
    this.mcpServer = new BrowserMcpServer({
      getConfig: () => this.options.getMcpHostConfig(),
      listWorkspaces: () => this.options.getWorkspaces(),
      bridge: this.options.bridge,
      guard: this.guard,
    })
  }

  async init(ctx: IKernelContext): Promise<void> {
    this.ctx = ctx
    const state = await this.storage.loadState()
    this.skillRegistry.setCustomSkills(state.skills)
    await this.skillRegistry.reloadFromDisk()
    this.mcpClient.setServers(state.mcpServers)
    await this.mcpServer.start()

    ctx.events.on('workspace:deleted', ({ workspaceId }) => {
      this.messagesByWorkspace.delete(workspaceId)
    })

    ctx.services.register(AgentServiceToken, this)
  }

  async dispose(): Promise<void> {
    await this.mcpServer.stop()
  }

  getMessages(workspaceId: WorkspaceId): AgentMessage[] {
    return (this.messagesByWorkspace.get(workspaceId) ?? []).map((m) => structuredClone(m))
  }

  clearMessages(workspaceId: WorkspaceId): void {
    this.messagesByWorkspace.delete(workspaceId)
    this.ctx.events.emit('ai:message', { workspaceId })
  }

  listSkills(workspaceId?: WorkspaceId): SkillDefinition[] {
    return this.skillRegistry.list(workspaceId)
  }

  async saveSkill(skill: SkillDefinition): Promise<SkillDefinition[]> {
    const state = await this.storage.loadState()
    const next = state.skills.filter((s) => s.id !== skill.id)
    next.push({ ...skill, builtIn: false })
    await this.storage.saveSkills(next)
    this.skillRegistry.setCustomSkills(next)
    return this.listSkills()
  }

  async deleteSkill(skillId: string): Promise<SkillDefinition[]> {
    const state = await this.storage.loadState()
    const next = state.skills.filter((s) => s.id !== skillId)
    await this.storage.saveSkills(next)
    this.skillRegistry.setCustomSkills(next)
    return this.listSkills()
  }

  listMcpServers(workspaceId?: WorkspaceId): McpServerConfig[] {
    return this.mcpClient.listServers(workspaceId)
  }

  async saveMcpServer(server: McpServerConfig): Promise<McpServerConfig[]> {
    const state = await this.storage.loadState()
    const next = state.mcpServers.filter((s) => s.id !== server.id)
    next.push(server)
    await this.storage.saveMcpServers(next)
    this.mcpClient.setServers(next)
    return this.listMcpServers()
  }

  async deleteMcpServer(serverId: string): Promise<McpServerConfig[]> {
    const state = await this.storage.loadState()
    const next = state.mcpServers.filter((s) => s.id !== serverId)
    await this.storage.saveMcpServers(next)
    this.mcpClient.setServers(next)
    return this.listMcpServers()
  }

  getMcpHostStatus(): McpHostStatus {
    return this.mcpServer.getStatus()
  }

  async updateMcpHostConfig(patch: Partial<McpHostConfig>): Promise<McpHostStatus> {
    await this.options.updateMcpHostConfig(patch)
    await this.mcpServer.start()
    return this.mcpServer.getStatus()
  }

  async runTask(workspaceId: WorkspaceId, prompt: string): Promise<{ taskId: string }> {
    const taskId = `task_${randomUUID().slice(0, 8)}`
    await this.sendMessage(workspaceId, prompt, taskId)
    return { taskId }
  }

  async cancelTask(taskId: string): Promise<void> {
    this.cancelledTasks.add(taskId)
  }

  async runSkill(workspaceId: WorkspaceId, skillId: string): Promise<AgentMessage[]> {
    const skill = this.skillRegistry.get(skillId)
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }
    return this.sendMessage(workspaceId, `[Skill: ${skill.name}]\n${skill.promptTemplate}`)
  }

  async sendMessage(workspaceId: WorkspaceId, prompt: string, taskId?: string): Promise<AgentMessage[]> {
    const ws = this.options.getWorkspace(workspaceId)
    if (!ws) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }

    const history = this.messagesByWorkspace.get(workspaceId) ?? []
    history.push({
      id: `msg_${randomUUID().slice(0, 8)}`,
      workspaceId,
      role: 'user',
      content: prompt,
      createdAt: Date.now(),
    })
    this.messagesByWorkspace.set(workspaceId, history)
    this.ctx.events.emit('ai:message', { workspaceId })

    const activeTabId = this.options.bridge.getActiveTabId(workspaceId)
    if (activeTabId) {
      await this.options.bridge.setTabAiBusy(workspaceId, activeTabId, true)
    }

    try {
      const provider = this.options.getActiveLlmProvider()
      // If user hasn't configured an API key for cloud LLM, still perform local snapshot + A2UI diagnostic!
      if (!provider || !provider.enabled || (provider.kind !== 'ollama' && !provider.apiKey?.trim())) {
        const snap = activeTabId ? await this.options.bridge.getAccessibilitySnapshot(activeTabId) : null
        const takeoverCard = snap ? detectHumanTakeoverNeeded(`${snap.title}\n${snap.textExcerpt}`) : null
        const assistantCard: AgentA2UICard =
          takeoverCard ?? {
            surfaceId: `a2ui_${Date.now()}`,
            title: '工作区环境 & 页面本地快照（离线模式）',
            badge: ws.name,
            nodes: [
              {
                type: 'text',
                id: 'hint',
                tone: 'muted',
                text: '尚未配置云端模型 API Key（或使用本地 Ollama）。以下已通过 CDP 安全读取当前隔离工作区快照：',
              },
              {
                type: 'kv-list',
                id: 'kv',
                items: [
                  { label: '当前页面', value: snap?.title || '无活动页面' },
                  { label: '可交互元素', value: `${snap?.elements.length ?? 0} 个` },
                  { label: '存储分区', value: ws.partition, badge: '严格隔离' },
                  { label: '代理模式', value: ws.proxy.mode },
                ],
              },
              {
                type: 'action-row',
                id: 'acts',
                actions: [{ id: 'open-ai-hub', label: '配置模型 / Skill / MCP', variant: 'filled' }],
              },
            ],
          }

        history.push({
          id: `msg_${randomUUID().slice(0, 8)}`,
          workspaceId,
          role: 'assistant',
          content: snap
            ? `已读取「${snap.title}」(${snap.elements.length} 个交互控件)。配置 LLM API Key 或本地 Ollama 后可自动执行完整推理与操作。`
            : '请先配置 LLM API Key 或启动本地 Ollama，即可在该工作区内执行 AI 自动化任务。',
          a2uiCard: assistantCard,
          createdAt: Date.now(),
        })
        this.ctx.events.emit('ai:message', { workspaceId })
        return this.getMessages(workspaceId)
      }

      const remoteTools = await this.mcpClient.discoverTools(workspaceId)
      const allToolDecls: LLMToolDeclaration[] = [
        ...BUILTIN_BROWSER_TOOLS,
        ...remoteTools.map((rt) => ({
          name: rt.name,
          description: rt.description,
          parameters: rt.inputSchema,
        })),
      ]

      const llmMessages: LLMChatMessage[] = [
        {
          role: 'system',
          content: `你是 WorkspaceBrowser 的工作区隔离 AI 助手。当前所在工作区为「${ws.name}」(${ws.id})，存储分区 ${ws.partition}，代理模式 ${ws.proxy.mode}。你只能操作当前工作区内的标签页。遇到验证码、人机校验或二次登录验证时请立即停止并提醒人工接管。`,
        },
        ...history.slice(-10).map((m) => ({
          role: (m.role === 'tool' ? 'assistant' : m.role) as 'user' | 'assistant',
          content: m.content,
        })),
      ]

      let finalReply = ''
      let detectedCard: AgentA2UICard | undefined

      for (let step = 0; step < 5; step++) {
        if (taskId && this.cancelledTasks.has(taskId)) {
          finalReply = '任务已被用户取消。'
          break
        }
        const res = await this.llm.chat(provider, llmMessages, allToolDecls)
        if (res.toolCalls.length === 0) {
          finalReply = res.content
          break
        }

        llmMessages.push({
          role: 'assistant',
          content: res.content,
          toolCalls: res.toolCalls,
        })

        for (const call of res.toolCalls) {
          const toolResult = await this.executeAgentTool(workspaceId, call.name, call.arguments)
          if (call.name === 'get_page_snapshot') {
            const card = detectHumanTakeoverNeeded(toolResult)
            if (card) detectedCard = card
          }
          llmMessages.push({
            role: 'tool',
            toolCallId: call.id,
            content: toolResult,
          })
          if (detectedCard) break
        }

        if (detectedCard) {
          finalReply = '检测到页面需要人工完成安全验证，已暂停自动操作。'
          break
        }
      }

      history.push({
        id: `msg_${randomUUID().slice(0, 8)}`,
        workspaceId,
        role: 'assistant',
        content: finalReply || '已完成当前工作区任务。',
        a2uiCard: detectedCard,
        createdAt: Date.now(),
      })
    } catch (err) {
      history.push({
        id: `msg_${randomUUID().slice(0, 8)}`,
        workspaceId,
        role: 'assistant',
        content: `执行出错：${err instanceof Error ? err.message : String(err)}`,
        createdAt: Date.now(),
      })
    } finally {
      if (activeTabId) {
        await this.options.bridge.setTabAiBusy(workspaceId, activeTabId, false)
      }
      this.ctx.events.emit('ai:message', { workspaceId })
    }

    return this.getMessages(workspaceId)
  }

  async runBatchJob(input: RunBatchJobInput): Promise<BatchJob> {
    const uniqueWorkspaceIds = [...new Set(input.workspaceIds)]
    const job: BatchJob = {
      id: `batch_${randomUUID().slice(0, 8)}`,
      name: input.name.trim() || '多工作区批量任务',
      prompt: input.prompt,
      skillId: input.skillId,
      workspaceIds: uniqueWorkspaceIds,
      status: 'running',
      results: {},
      createdAt: Date.now(),
    }

    for (const wsId of uniqueWorkspaceIds) {
      job.results[wsId] = { workspaceId: wsId, status: 'pending' }
    }
    this.batchJobs.unshift(job)
    this.ctx.events.emit('ai:batch-updated', { job: structuredClone(job) })

    // Run isolated per-workspace tasks with bounded concurrency (max 3)
    const queue = [...uniqueWorkspaceIds]
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0) {
        const wsId = queue.shift()!
        job.results[wsId] = { workspaceId: wsId, status: 'running' }
        this.ctx.events.emit('ai:batch-updated', { job: structuredClone(job) })
        try {
          const msgs = input.skillId
            ? await this.runSkill(wsId, input.skillId)
            : await this.sendMessage(wsId, input.prompt)
          const last = msgs[msgs.length - 1]
          job.results[wsId] = {
            workspaceId: wsId,
            status: 'completed',
            summary: last?.content ?? '完成',
          }
        } catch (err) {
          job.results[wsId] = {
            workspaceId: wsId,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          }
        }
        this.ctx.events.emit('ai:batch-updated', { job: structuredClone(job) })
      }
    })

    await Promise.all(workers)
    const anyFailed = Object.values(job.results).some((r) => r.status === 'failed')
    job.status = anyFailed ? 'failed' : 'completed'
    job.completedAt = Date.now()
    this.ctx.events.emit('ai:batch-updated', { job: structuredClone(job) })
    return structuredClone(job)
  }

  listBatchJobs(): BatchJob[] {
    return this.batchJobs.map((j) => structuredClone(j))
  }

  private async executeAgentTool(
    agentWorkspaceId: WorkspaceId,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (name === 'get_workspace_env') {
      const ws = this.options.getWorkspace(agentWorkspaceId)
      if (!ws) throw new Error(`Workspace not found: ${agentWorkspaceId}`)
      const tabs = this.options.bridge.listWorkspaceTabs(agentWorkspaceId)
      return JSON.stringify({
        id: ws.id,
        name: ws.name,
        partition: ws.partition,
        webrtcPolicy: ws.isolation.webrtcPolicy,
        proxyMode: ws.proxy.mode,
        tabCount: tabs.length,
      })
    }

    if (name.startsWith('mcp__')) {
      return this.mcpClient.callRemoteTool(agentWorkspaceId, name, args)
    }

    const tabId = this.options.bridge.getActiveTabId(agentWorkspaceId)
    if (!tabId) {
      return '当前工作区暂无活动标签页'
    }
    const ownerWs = this.options.bridge.getTabWorkspaceId(tabId)
    if (ownerWs) {
      this.guard.assertSameWorkspace(agentWorkspaceId, ownerWs)
    }

    if (name === 'get_page_snapshot') {
      const snap = await this.options.bridge.getAccessibilitySnapshot(tabId)
      return JSON.stringify(snap)
    }
    if (name === 'navigate') {
      const safeUrl = this.guard.assertSafeNavigationUrl(String(args.url ?? ''))
      return this.options.bridge.navigate(tabId, safeUrl)
    }
    if (name === 'click_element') {
      return this.options.bridge.clickRef(tabId, String(args.ref ?? ''))
    }
    if (name === 'type_text') {
      return this.options.bridge.typeRef(
        tabId,
        String(args.ref ?? ''),
        String(args.text ?? ''),
        Boolean(args.submit),
      )
    }

    return `未知工具: ${name}`
  }
}
