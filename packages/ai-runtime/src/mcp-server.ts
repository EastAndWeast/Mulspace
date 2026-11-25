import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { McpHostConfig, McpHostStatus, Workspace, WorkspaceId } from '@wb/contracts'
import type { ICdpAutomationBridge } from './cdp-automation.js'
import { WorkspaceBoundaryGuard } from './security-guard.js'

class McpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'McpRpcError'
  }
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface BrowserMcpServerDeps {
  getConfig(): McpHostConfig
  listWorkspaces(): Workspace[]
  bridge: ICdpAutomationBridge
  guard: WorkspaceBoundaryGuard
}

const MCP_TOOLS = [
  {
    name: 'list_workspaces',
    description: '列出当前允许外部 Agent 访问的工作区 ID 与名称',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_tabs',
    description: '列出指定工作区内的所有标签页',
    inputSchema: {
      type: 'object',
      properties: { workspaceId: { type: 'string' } },
      required: ['workspaceId'],
    },
  },
  {
    name: 'navigate',
    description: '控制指定工作区标签页导航到目标 URL',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        tabId: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['workspaceId', 'url'],
    },
  },
  {
    name: 'get_page_snapshot',
    description: '获取指定工作区标签页的精简 Accessibility Tree 与文本摘要',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        tabId: { type: 'string' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'click_element',
    description: '点击快照中的指定元素 ref',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        tabId: { type: 'string' },
        ref: { type: 'string' },
      },
      required: ['workspaceId', 'ref'],
    },
  },
  {
    name: 'type_text',
    description: '向快照中的指定输入框 ref 输入文本',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        tabId: { type: 'string' },
        ref: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
      },
      required: ['workspaceId', 'ref', 'text'],
    },
  },
]

export class BrowserMcpServer {
  private server: Server | null = null
  private listeningPort: number | null = null
  private lastError: string | undefined

  constructor(private readonly deps: BrowserMcpServerDeps) {}

  async start(): Promise<void> {
    const cfg = this.deps.getConfig()
    if (!cfg.enabled) {
      await this.stop()
      return
    }
    if (this.server && this.listeningPort === cfg.port) {
      return
    }
    await this.stop()

    this.server = createServer((req, res) => {
      void this.handleHttp(req, res)
    })

    await new Promise<void>((resolve) => {
      this.server!.once('error', (err) => {
        this.lastError = err.message
        resolve()
      })
      this.server!.listen(cfg.port, '127.0.0.1', () => {
        const addr = this.server?.address()
        this.listeningPort = typeof addr === 'object' && addr ? addr.port : cfg.port
        this.lastError = undefined
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    const srv = this.server
    this.server = null
    this.listeningPort = null
    await new Promise<void>((resolve) => srv.close(() => resolve()))
  }

  getStatus(): McpHostStatus {
    const config = this.deps.getConfig()
    const running = this.server !== null && this.listeningPort !== null
    const endpointUrl = running ? `http://127.0.0.1:${this.listeningPort}/mcp` : null
    const snippetObj = {
      mcpServers: {
        workspaceBrowser: {
          url: endpointUrl ?? `http://127.0.0.1:${config.port}/mcp`,
          headers: {
            Authorization: `Bearer ${config.authToken}`,
          },
        },
      },
    }
    return {
      running,
      endpointUrl,
      config,
      clientSnippet: JSON.stringify(snippetObj, null, 2),
      lastError: this.lastError,
    }
  }

  private assertWorkspaceAllowed(workspaceId: WorkspaceId): void {
    const cfg = this.deps.getConfig()
    if (cfg.allowedWorkspaceIds !== 'all' && !cfg.allowedWorkspaceIds.includes(workspaceId)) {
      throw new Error(`工作区 "${workspaceId}" 未授权给外部 MCP 客户端访问`)
    }
  }

  private resolveTargetTabId(workspaceId: WorkspaceId, tabId?: string): string {
    const resolved = tabId || this.deps.bridge.getActiveTabId(workspaceId)
    if (!resolved) {
      throw new Error(`工作区 "${workspaceId}" 当前没有可用标签页`)
    }
    const ownerWs = this.deps.bridge.getTabWorkspaceId(resolved)
    if (ownerWs) {
      this.deps.guard.assertSameWorkspace(workspaceId, ownerWs)
    }
    return resolved
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const cfg = this.deps.getConfig()
      const authHeader = req.headers.authorization ?? ''
      if (authHeader !== `Bearer ${cfg.authToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized: invalid MCP Bearer token' }))
        return
      }

      const pathname = (req.url ?? '/').split('?')[0] ?? '/'

      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, workspaces: this.deps.listWorkspaces().length }))
        return
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Method Not Allowed' }))
        return
      }

      if (pathname !== '/mcp' && pathname !== '/') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `Not Found: ${pathname}` }))
        return
      }

      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }),
        )
        return
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid Request' },
          }),
        )
        return
      }

      const rawObj = parsed as Record<string, unknown>
      const rpc = parsed as JsonRpcRequest
      if (
        ('jsonrpc' in rawObj && rawObj.jsonrpc !== '2.0') ||
        typeof rawObj.method !== 'string' ||
        !rawObj.method.trim()
      ) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id ?? null,
            error: { code: -32600, message: 'Invalid Request: missing method' },
          }),
        )
        return
      }

      try {
        const result = await this.dispatchRpc(rpc)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result }))
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id ?? null,
            error: {
              code: err instanceof McpRpcError ? err.code : -32000,
              message: err instanceof Error ? err.message : String(err),
            },
          }),
        )
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
      }
      if (!res.writableEnded) {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
          }),
        )
      }
    }
  }

  private async dispatchRpc(rpc: JsonRpcRequest): Promise<unknown> {
    if (rpc.method === 'initialize') {
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'workspace-browser-mcp', version: '0.1.0' },
      }
    }
    if (rpc.method === 'ping') {
      return {}
    }
    if (rpc.method === 'tools/list') {
      return { tools: MCP_TOOLS }
    }
    if (rpc.method === 'tools/call') {
      const name = String(rpc.params?.name ?? '')
      const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>
      const text = await this.executeTool(name, args)
      return { content: [{ type: 'text', text }] }
    }
    throw new McpRpcError(-32601, `Method not found: ${rpc.method}`)
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (name === 'list_workspaces') {
      const cfg = this.deps.getConfig()
      const list = this.deps
        .listWorkspaces()
        .filter((w) => cfg.allowedWorkspaceIds === 'all' || cfg.allowedWorkspaceIds.includes(w.id))
        .map((w) => ({ id: w.id, name: w.name, icon: w.icon, proxyMode: w.proxy.mode }))
      return JSON.stringify(list, null, 2)
    }

    const workspaceId = String(args.workspaceId ?? '')
    if (!workspaceId) throw new Error('workspaceId is required')
    this.assertWorkspaceAllowed(workspaceId)

    if (name === 'list_tabs') {
      const tabs = this.deps.bridge.listWorkspaceTabs(workspaceId).map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        state: t.state,
      }))
      return JSON.stringify(tabs, null, 2)
    }

    const tabId = this.resolveTargetTabId(workspaceId, args.tabId ? String(args.tabId) : undefined)
    if (name === 'navigate') {
      const safeUrl = this.deps.guard.assertSafeNavigationUrl(String(args.url ?? ''))
      return this.deps.bridge.navigate(tabId, safeUrl)
    }
    if (name === 'get_page_snapshot') {
      const snap = await this.deps.bridge.getAccessibilitySnapshot(tabId)
      return JSON.stringify(snap, null, 2)
    }
    if (name === 'click_element') {
      return this.deps.bridge.clickRef(tabId, String(args.ref ?? ''))
    }
    if (name === 'type_text') {
      return this.deps.bridge.typeRef(
        tabId,
        String(args.ref ?? ''),
        String(args.text ?? ''),
        Boolean(args.submit),
      )
    }

    throw new Error(`Unknown tool: ${name}`)
  }
}
