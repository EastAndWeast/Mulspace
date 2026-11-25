import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserKernel } from '@wb/kernel'
import { JsonStorageRepository } from '@wb/storage'
import { WorkspaceService } from '@wb/workspace-core'
import { parse as parseYaml } from 'yaml'
import {
  generateMihomoConfig,
  generateSingBoxConfig,
  parseCustomProxyUrl,
  parseProxyImport,
  PortAllocator,
  ProxyService,
  type SessionProxyConfig,
} from '../index.js'

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'wb-proxy-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('proxy-engine', () => {
  it('parses Clash YAML, V2Ray base64, and individual protocol URIs', () => {
    const clashYaml = `
proxies:
  - name: "US-West-01"
    type: vless
    server: 1.2.3.4
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
  - name: "JP-Tokyo-01"
    type: trojan
    server: jp.example.com
    port: 443
    password: secret
`
    const parsedClash = parseProxyImport(clashYaml, 'sub_1')
    expect(parsedClash.format).toBe('clash-yaml')
    expect(parsedClash.nodes).toHaveLength(2)
    expect(parsedClash.nodes[0]?.protocol).toBe('vless')

    const vmessJson = Buffer.from(
      JSON.stringify({ add: 'hk.example.com', port: 443, id: 'uuid-1', ps: 'HK-VMess', net: 'ws', path: '/ws' }),
    ).toString('base64')
    const uriList = [
      `vmess://${vmessJson}`,
      'trojan://pass123@sg.example.com:443?sni=sg.example.com#SG-Trojan',
      `ss://${Buffer.from('aes-256-gcm:pw').toString('base64')}@de.example.com:8388#DE-SS`,
      'hysteria2://hyPass@uk.example.com:8443?insecure=1#UK-Hy2',
    ].join('\n')
    const b64Sub = Buffer.from(uriList).toString('base64')

    const parsedV2 = parseProxyImport(b64Sub, 'sub_2')
    expect(parsedV2.format).toBe('v2ray-base64')
    expect(parsedV2.nodes.map((n) => n.protocol)).toEqual(['vmess', 'trojan', 'ss', 'hysteria2'])

    const custom = parseCustomProxyUrl('socks5://alice:p%40ss@127.0.0.1:10808')
    expect(custom).toEqual({
      proxyRules: 'socks5://127.0.0.1:10808',
      username: 'alice',
      password: 'p@ss',
    })
  })

  it('generates multi-listener Mihomo YAML and multi-inbound Sing-box JSON for independent workspaces', () => {
    const parsed = parseProxyImport(
      'trojan://p1@us.example.com:443#US-Node\nss://YWVzLTI1Ni1nY206cDE=@jp.example.com:8388#JP-Node',
    )
    const [usNode, jpNode] = parsed.nodes
    const mappings = [
      { workspaceId: 'ws_a', port: 18100, node: usNode! },
      { workspaceId: 'ws_b', port: 18101, node: jpNode! },
    ]

    const mihomoYaml = generateMihomoConfig({
      nodes: parsed.nodes,
      workspaceMappings: mappings,
      controllerPort: 19100,
      controllerSecret: 'sec',
    })
    const mihomoObj = parseYaml(mihomoYaml) as { listeners: Array<{ port: number; proxy: string }> }
    expect(mihomoObj.listeners).toHaveLength(2)
    expect(mihomoObj.listeners[0]).toMatchObject({ port: 18100, proxy: 'US-Node' })
    expect(mihomoObj.listeners[1]).toMatchObject({ port: 18101, proxy: 'JP-Node' })

    const singboxJson = JSON.parse(
      generateSingBoxConfig({
        nodes: parsed.nodes,
        workspaceMappings: mappings,
        controllerPort: 19100,
        controllerSecret: 'sec',
      }),
    ) as { inbounds: Array<{ listen_port: number }>; route: { rules: Array<{ outbound: string }> } }
    expect(singboxJson.inbounds.map((i) => i.listen_port)).toEqual([18100, 18101])
    expect(singboxJson.route.rules.map((r) => r.outbound)).toEqual(['US-Node', 'JP-Node'])
  })

  it('allocates unique ports and applies per-workspace custom proxies via ProxyService', async () => {
    const dir = await makeTempDir()
    const storage = new JsonStorageRepository(dir)
    const kernel = new BrowserKernel()
    const wsService = new WorkspaceService(storage)

    const applied = new Map<string, SessionProxyConfig>()
    const proxyService = new ProxyService(storage, {
      runtimeDir: join(dir, 'proxy-runtime'),
      getWorkspaces: () => wsService.list(),
      getProxyBinaryPath: () => undefined,
      updateWorkspaceProxy: (wsId, binding) => wsService.update(wsId, { proxy: binding }),
      applier: {
        applySessionProxy(ws, cfg) {
          applied.set(ws.id, cfg)
        },
      },
    })

    kernel.use(wsService).use(proxyService)
    await kernel.start()

    const [ws1, ws2] = wsService.list()
    await proxyService.setWorkspaceProxy(ws1!.id, {
      mode: 'custom',
      customUrl: 'http://user1:pass1@10.0.0.2:8080',
    })
    await proxyService.setWorkspaceProxy(ws2!.id, { mode: 'direct' })

    expect(applied.get(ws1!.id)).toMatchObject({
      mode: 'fixed_servers',
      proxyRules: 'http://10.0.0.2:8080',
      auth: { username: 'user1', password: 'pass1' },
    })
    expect(applied.get(ws2!.id)).toEqual({ mode: 'direct' })

    const allocator = new PortAllocator(18200, 18210)
    const p1 = await allocator.allocateForWorkspace('a')
    const p2 = await allocator.allocateForWorkspace('b')
    expect(p1).not.toBe(p2)
    await kernel.stop()
  })
})
