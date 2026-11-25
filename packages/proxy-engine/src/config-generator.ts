import type { ProxyNode, WorkspaceId } from '@wb/contracts'
import { stringify as stringifyYaml } from 'yaml'

export interface WorkspaceListenerMapping {
  workspaceId: WorkspaceId
  port: number
  node: ProxyNode
}

export interface GenerateCoreConfigInput {
  nodes: ProxyNode[]
  workspaceMappings: WorkspaceListenerMapping[]
  controllerPort: number
  controllerSecret: string
}

export function generateMihomoConfig(input: GenerateCoreConfigInput): string {
  const uniqueNodesMap = new Map<string, ProxyNode>()
  for (const node of input.nodes) {
    uniqueNodesMap.set(node.name, node)
  }
  for (const mapping of input.workspaceMappings) {
    uniqueNodesMap.set(mapping.node.name, mapping.node)
  }

  const proxies = [...uniqueNodesMap.values()].map((n) => ({
    ...n.rawConfig,
    name: n.name,
  }))

  const listeners = input.workspaceMappings.map((m) => ({
    name: `ws-listener-${m.workspaceId}`,
    type: 'mixed',
    port: m.port,
    listen: '127.0.0.1',
    proxy: m.node.name,
  }))

  const configObj = {
    mode: 'rule',
    'log-level': 'warning',
    'allow-lan': false,
    'external-controller': `127.0.0.1:${input.controllerPort}`,
    secret: input.controllerSecret,
    proxies,
    'proxy-groups':
      proxies.length > 0
        ? [
            {
              name: 'WB-ALL',
              type: 'select',
              proxies: proxies.map((p) => p.name),
            },
          ]
        : [],
    listeners,
    rules: ['MATCH,DIRECT'],
  }

  return stringifyYaml(configObj)
}

export function generateSingBoxConfig(input: GenerateCoreConfigInput): string {
  const uniqueNodesMap = new Map<string, ProxyNode>()
  for (const node of input.nodes) {
    uniqueNodesMap.set(node.id, node)
  }
  for (const mapping of input.workspaceMappings) {
    uniqueNodesMap.set(mapping.node.id, mapping.node)
  }

  const outbounds: Array<Record<string, unknown>> = [{ type: 'direct', tag: 'direct' }]
  for (const node of uniqueNodesMap.values()) {
    const base: Record<string, unknown> = {
      type: node.protocol === 'ss' ? 'shadowsocks' : node.protocol,
      tag: node.name,
      server: node.server,
      server_port: node.port,
    }
    if (node.rawConfig.uuid) base.uuid = node.rawConfig.uuid
    if (node.rawConfig.password) base.password = node.rawConfig.password
    if (node.rawConfig.cipher) base.method = node.rawConfig.cipher
    outbounds.push(base)
  }

  const inbounds = input.workspaceMappings.map((m) => ({
    type: 'mixed',
    tag: `ws-in-${m.workspaceId}`,
    listen: '127.0.0.1',
    listen_port: m.port,
  }))

  const rules = input.workspaceMappings.map((m) => ({
    inbound: [`ws-in-${m.workspaceId}`],
    outbound: m.node.name,
  }))

  return JSON.stringify(
    {
      log: { level: 'warn' },
      experimental: {
        clash_api: {
          external_controller: `127.0.0.1:${input.controllerPort}`,
          secret: input.controllerSecret,
        },
      },
      inbounds,
      outbounds,
      route: {
        rules,
        final: 'direct',
      },
    },
    null,
    2,
  )
}
