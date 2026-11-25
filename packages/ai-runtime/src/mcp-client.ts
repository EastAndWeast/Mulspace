import type { McpServerConfig, WorkspaceId } from '@wb/contracts'

export interface RemoteMcpTool {
  serverId: string
  serverName: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export class McpClientManager {
  private servers: McpServerConfig[] = []

  setServers(servers: McpServerConfig[]): void {
    this.servers = servers.map((s) => structuredClone(s))
  }

  listServers(workspaceId?: WorkspaceId): McpServerConfig[] {
    if (!workspaceId) return this.servers.map((s) => structuredClone(s))
    return this.servers
      .filter((s) => s.scope === 'global' || s.scope === workspaceId)
      .map((s) => structuredClone(s))
  }

  async discoverTools(workspaceId: WorkspaceId): Promise<RemoteMcpTool[]> {
    const activeHttpServers = this.listServers(workspaceId).filter(
      (s) => s.enabled && s.transport === 'http' && s.url,
    )

    const tools: RemoteMcpTool[] = []
    for (const srv of activeHttpServers) {
      try {
        const res = await fetch(srv.url!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(srv.headers ?? {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
        if (!res.ok) continue
        const json = (await res.json()) as {
          result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }
        }
        for (const t of json.result?.tools ?? []) {
          tools.push({
            serverId: srv.id,
            serverName: srv.name,
            name: `mcp__${srv.id}__${t.name}`,
            description: `[MCP:${srv.name}] ${t.description ?? t.name}`,
            inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
          })
        }
      } catch {
        // Ignore unreachable external server during discovery
      }
    }
    return tools
  }

  async callRemoteTool(
    workspaceId: WorkspaceId,
    prefixedName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const match = prefixedName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/)
    if (!match) {
      throw new Error(`Invalid remote MCP tool name: ${prefixedName}`)
    }
    const serverId = match[1]!
    const toolName = match[2]!
    const server = this.listServers(workspaceId).find((s) => s.id === serverId && s.enabled)
    if (!server || !server.url) {
      throw new Error(`工作区未授权或找不到 MCP 服务器: ${serverId}`)
    }

    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(server.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    })

    if (!res.ok) {
      throw new Error(`MCP 调用失败: HTTP ${res.status}`)
    }
    const json = (await res.json()) as {
      result?: { content?: Array<{ text?: string }> }
      error?: { message?: string }
    }
    if (json.error) {
      throw new Error(json.error.message ?? 'MCP tool error')
    }
    return json.result?.content?.map((c) => c.text ?? '').join('\n') || JSON.stringify(json.result ?? {})
  }
}
