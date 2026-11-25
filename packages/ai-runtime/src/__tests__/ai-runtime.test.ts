import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { McpHostConfig, Tab } from '@wb/contracts'
import { BrowserKernel } from '@wb/kernel'
import { JsonStorageRepository } from '@wb/storage'
import { WorkspaceService } from '@wb/workspace-core'
import {
  AgentService,
  BrowserMcpServer,
  detectHumanTakeoverNeeded,
  parseSkillMarkdown,
  WorkspaceBoundaryGuard,
  WorkspaceBoundaryViolationError,
  type ICdpAutomationBridge,
} from '../index.js'

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'wb-ai-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

function createMockBridge(tabs: Tab[]): ICdpAutomationBridge {
  return {
    listWorkspaceTabs: (wsId) => tabs.filter((t) => t.workspaceId === wsId),
    getActiveTabId: (wsId) => tabs.find((t) => t.workspaceId === wsId)?.id ?? null,
    getTabWorkspaceId: (tabId) => tabs.find((t) => t.id === tabId)?.workspaceId,
    setTabAiBusy: () => undefined,
    getAccessibilitySnapshot: async (tabId) => {
      const tab = tabs.find((t) => t.id === tabId)!
      return {
        tabId,
        url: tab.url,
        title: tab.title,
        elements: [{ ref: 'e1', role: 'button', name: '提交' }],
        textExcerpt: `Content of ${tab.workspaceId}`,
      }
    },
    clickRef: async (_tabId, ref) => `clicked:${ref}`,
    typeRef: async (_tabId, ref, text) => `typed:${ref}:${text}`,
    scroll: async () => 'scrolled',
    navigate: async (_tabId, url) => `navigated:${url}`,
  }
}

describe('ai-runtime', () => {
  it('enforces strict workspace boundary and detects CAPTCHA/2FA human takeover', () => {
    const guard = new WorkspaceBoundaryGuard()
    expect(() => guard.assertSameWorkspace('ws_1', 'ws_1')).not.toThrow()
    expect(() => guard.assertSameWorkspace('ws_1', 'ws_2')).toThrow(WorkspaceBoundaryViolationError)

    expect(detectHumanTakeoverNeeded('Please complete reCAPTCHA to continue')?.badge).toBe('Human-in-the-loop')
    expect(detectHumanTakeoverNeeded('Normal article text')).toBeNull()
  })

  it('parses standard SKILL.md frontmatter + body', () => {
    const skill = parseSkillMarkdown(`---
name: 社媒周报整理
description: 汇总本周发帖数据
tools:
  - get_page_snapshot
scope: ws_1
---
请读取页面并提取浏览量、点赞数和评论数。`)

    expect(skill.name).toBe('社媒周报整理')
    expect(skill.scope).toBe('ws_1')
    expect(skill.allowedTools).toEqual(['get_page_snapshot'])
    expect(skill.promptTemplate).toContain('浏览量')
  })

  it('exposes authenticated BrowserMcpServer and rejects unauthorized / disallowed workspace requests', async () => {
    const tabs: Tab[] = [
      {
        id: 'tab_1',
        workspaceId: 'ws_a',
        url: 'https://a.example.com',
        title: 'Account A',
        state: 'active',
        pinned: false,
        muted: false,
        audible: false,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        aiBusy: false,
        lockedFromDiscard: false,
        lastActiveAt: Date.now(),
      },
      {
        id: 'tab_2',
        workspaceId: 'ws_b',
        url: 'https://b.example.com',
        title: 'Account B',
        state: 'active',
        pinned: false,
        muted: false,
        audible: false,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        aiBusy: false,
        lockedFromDiscard: false,
        lastActiveAt: Date.now(),
      },
    ]

    const cfg: McpHostConfig = {
      enabled: true,
      port: 0,
      authToken: 'secret-token-123',
      allowedWorkspaceIds: ['ws_a'],
    }

    const server = new BrowserMcpServer({
      getConfig: () => cfg,
      listWorkspaces: () => [
        {
          id: 'ws_a',
          name: 'A',
          icon: '🅰️',
          seedColor: '#3B82F6',
          partition: 'persist:ws-ws_a',
          isolation: { webrtcPolicy: 'disable_non_proxied_udp' },
          proxy: { mode: 'direct' },
          agentPolicy: {
            enabled: true,
            isolatedMemory: true,
            allowCrossWorkspaceRead: false,
            enabledSkillIds: [],
            enabledMcpServerIds: [],
          },
          pinnedTabIds: [],
          activeTabId: 'tab_1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      bridge: createMockBridge(tabs),
      guard: new WorkspaceBoundaryGuard(),
    })

    await server.start()
    const status = server.getStatus()
    expect(status.running).toBe(true)
    expect(status.endpointUrl).toBeTruthy()

    const unauth = await fetch(status.endpointUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(unauth.status).toBe(401)

    const toolsRes = await fetch(status.endpointUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-token-123',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    })
    const toolsJson = (await toolsRes.json()) as { result: { tools: Array<{ name: string }> } }
    expect(toolsJson.result.tools.map((t) => t.name)).toContain('get_page_snapshot')

    // Allowed workspace succeeds
    const snapRes = await fetch(status.endpointUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-token-123',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_page_snapshot', arguments: { workspaceId: 'ws_a' } },
      }),
    })
    const snapJson = (await snapRes.json()) as { result: { content: Array<{ text: string }> } }
    expect(snapJson.result.content[0]?.text).toContain('Account A')

    // Disallowed workspace is blocked
    const deniedRes = await fetch(status.endpointUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-token-123',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_page_snapshot', arguments: { workspaceId: 'ws_b' } },
      }),
    })
    const deniedJson = (await deniedRes.json()) as { error?: { message: string } }
    expect(deniedJson.error?.message).toContain('未授权')

    // Disallowed URL schemes (file://, javascript:, view-source:) are blocked in MCP navigate
    const guard = new WorkspaceBoundaryGuard()
    expect(() => guard.assertSafeNavigationUrl('file:///etc/passwd')).toThrow(/安全护栏拦截/)
    expect(() => guard.assertSafeNavigationUrl('javascript:alert(1)')).toThrow(/安全护栏拦截/)
    expect(() => guard.assertSafeNavigationUrl('view-source:https://example.com')).toThrow(/安全护栏拦截/)
    expect(guard.assertSafeNavigationUrl('https://example.com/ok')).toBe('https://example.com/ok')

    const fileNavRes = await fetch(status.endpointUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-token-123',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'navigate',
          arguments: { workspaceId: 'ws_a', url: 'file:///tmp/browser-state.json' },
        },
      }),
    })
    const fileNavJson = (await fileNavRes.json()) as { error?: { message: string } }
    expect(fileNavJson.error?.message).toContain('安全护栏拦截')

    // JSON-RPC `null` body returns 400 Invalid Request promptly instead of hanging
    const nullRes = await fetch(status.endpointUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-token-123',
      },
      body: 'null',
    })
    expect(nullRes.status).toBe(400)
    const nullJson = (await nullRes.json()) as { error?: { code: number } }
    expect(nullJson.error?.code).toBe(-32600)

    // Unknown POST path returns 404
    const badPathRes = await fetch(status.endpointUrl!.replace(/\/mcp$/, '/wrong'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-token-123',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'ping' }),
    })
    expect(badPathRes.status).toBe(404)

    await server.stop()
  })

  it('executes isolated multi-workspace batch jobs via AgentService', async () => {
    const dir = await makeTempDir()
    const storage = new JsonStorageRepository(dir)
    const kernel = new BrowserKernel()
    const wsService = new WorkspaceService(storage)
    const state = await storage.loadState()

    const tabs: Tab[] = state.workspaces.map((ws, i) => ({
      id: `t_${i}`,
      workspaceId: ws.id,
      url: `https://site${i}.example.com`,
      title: `Page ${ws.name}`,
      state: 'active',
      pinned: false,
      muted: false,
      audible: false,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      aiBusy: false,
      lockedFromDiscard: false,
      lastActiveAt: Date.now(),
    }))

    const agent = new AgentService(storage, {
      getWorkspaces: () => wsService.list(),
      getWorkspace: (id) => wsService.get(id),
      getActiveLlmProvider: () => undefined, // Offline A2UI snapshot mode
      getMcpHostConfig: () => ({
        enabled: false,
        port: 0,
        authToken: 'tok',
        allowedWorkspaceIds: 'all',
      }),
      updateMcpHostConfig: async () => ({
        enabled: false,
        port: 0,
        authToken: 'tok',
        allowedWorkspaceIds: 'all',
      }),
      bridge: createMockBridge(tabs),
    })

    kernel.use(wsService).use(agent)
    await kernel.start()

    const job = await agent.runBatchJob({
      name: '批量环境体检',
      prompt: '检查当前页',
      workspaceIds: state.workspaces.map((w) => w.id),
    })

    expect(job.status).toBe('completed')
    for (const ws of state.workspaces) {
      expect(job.results[ws.id]?.status).toBe('completed')
      expect(job.results[ws.id]?.summary).toContain(ws.name)
    }

    await kernel.stop()
  })
})
