import { createHash } from 'node:crypto'
import type { ProxyImportFormat, ProxyNode, ProxyProtocol } from '@wb/contracts'
import { parse as parseYaml } from 'yaml'

export interface ParsedProxyImport {
  format: ProxyImportFormat
  nodes: ProxyNode[]
}

export interface ParsedCustomProxyUrl {
  proxyRules: string
  username?: string
  password?: string
}

function makeNodeId(
  name: string,
  server: string,
  port: number,
  index: number,
  subscriptionId?: string,
): string {
  const digest = createHash('sha1')
    .update(`${subscriptionId ?? ''}|${name}|${server}|${port}|${index}`)
    .digest('hex')
    .slice(0, 10)
  return `node_${digest}`
}

function mapClashType(rawType: string): ProxyProtocol | null {
  const lower = rawType.toLowerCase()
  switch (lower) {
    case 'vmess':
    case 'vless':
    case 'trojan':
    case 'ss':
    case 'hysteria2':
    case 'tuic':
    case 'socks5':
    case 'http':
      return lower
    case 'shadowsocks':
      return 'ss'
    case 'hy2':
      return 'hysteria2'
    default:
      return null
  }
}

function decodeBase64Flexible(input: string): string {
  const normalized = input.trim().replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function parseSingleUri(uri: string, index: number, subscriptionId?: string): ProxyNode | null {
  const trimmed = uri.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('vmess://')) {
    try {
      const json = JSON.parse(decodeBase64Flexible(trimmed.slice('vmess://'.length))) as Record<string, unknown>
      const server = String(json.add ?? '')
      const port = Number(json.port ?? 443)
      if (!server || !Number.isFinite(port)) return null
      const name = String(json.ps ?? `vmess-${server}:${port}`)
      const rawConfig: Record<string, unknown> = {
        name,
        type: 'vmess',
        server,
        port,
        uuid: String(json.id ?? ''),
        alterId: Number(json.aid ?? 0),
        cipher: String(json.scy ?? 'auto'),
        tls: json.tls === 'tls' || json.tls === true,
        servername: json.sni ? String(json.sni) : undefined,
        network: json.net ? String(json.net) : 'tcp',
      }
      if (json.net === 'ws') {
        rawConfig['ws-opts'] = {
          path: String(json.path ?? '/'),
          headers: json.host ? { Host: String(json.host) } : undefined,
        }
      }
      return {
        id: makeNodeId(name, server, port, index, subscriptionId),
        name,
        protocol: 'vmess',
        server,
        port,
        rawConfig,
        subscriptionId,
      }
    } catch {
      return null
    }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmed)
  } catch {
    return null
  }

  const scheme = parsedUrl.protocol.replace(/:$/, '').toLowerCase()
  const fragmentName = parsedUrl.hash ? decodeURIComponent(parsedUrl.hash.slice(1)) : ''

  if (scheme === 'ss') {
    let method = ''
    let password = ''
    if (parsedUrl.username && parsedUrl.password) {
      method = decodeURIComponent(parsedUrl.username)
      password = decodeURIComponent(parsedUrl.password)
    } else if (parsedUrl.username) {
      const decoded = decodeBase64Flexible(decodeURIComponent(parsedUrl.username))
      const colonIdx = decoded.indexOf(':')
      if (colonIdx > 0) {
        method = decoded.slice(0, colonIdx)
        password = decoded.slice(colonIdx + 1)
      }
    }
    const server = parsedUrl.hostname
    const port = Number(parsedUrl.port || 8388)
    if (!server || !method || !Number.isFinite(port)) return null
    const name = fragmentName || `ss-${server}:${port}`
    return {
      id: makeNodeId(name, server, port, index, subscriptionId),
      name,
      protocol: 'ss',
      server,
      port,
      rawConfig: {
        name,
        type: 'ss',
        server,
        port,
        cipher: method,
        password,
      },
      subscriptionId,
    }
  }

  if (scheme === 'vless' || scheme === 'trojan' || scheme === 'hysteria2' || scheme === 'hy2' || scheme === 'tuic') {
    const protocol = mapClashType(scheme)
    if (!protocol) return null
    const server = parsedUrl.hostname
    const port = Number(parsedUrl.port || 443)
    if (!server || !Number.isFinite(port)) return null
    const name = fragmentName || `${protocol}-${server}:${port}`
    const params = parsedUrl.searchParams
    const rawConfig: Record<string, unknown> = {
      name,
      type: protocol,
      server,
      port,
      sni: params.get('sni') ?? params.get('peer') ?? undefined,
      'skip-cert-verify': params.get('allowInsecure') === '1' || params.get('insecure') === '1',
    }
    if (protocol === 'vless') {
      rawConfig.uuid = decodeURIComponent(parsedUrl.username)
      rawConfig.tls = params.get('security') === 'tls' || params.get('security') === 'reality'
      if (params.get('flow')) rawConfig.flow = params.get('flow')
      if (params.get('type')) rawConfig.network = params.get('type')
    } else if (protocol === 'trojan') {
      rawConfig.password = decodeURIComponent(parsedUrl.username)
      if (params.get('type')) rawConfig.network = params.get('type')
    } else if (protocol === 'hysteria2') {
      rawConfig.password = decodeURIComponent(parsedUrl.username)
    } else if (protocol === 'tuic') {
      rawConfig.uuid = decodeURIComponent(parsedUrl.username)
      rawConfig.password = decodeURIComponent(parsedUrl.password)
    }
    return {
      id: makeNodeId(name, server, port, index, subscriptionId),
      name,
      protocol,
      server,
      port,
      rawConfig,
      subscriptionId,
    }
  }

  if (scheme === 'socks5' || scheme === 'socks' || scheme === 'http' || scheme === 'https') {
    const protocol: ProxyProtocol = scheme.startsWith('socks') ? 'socks5' : 'http'
    const server = parsedUrl.hostname
    const port = Number(parsedUrl.port || (protocol === 'socks5' ? 1080 : 8080))
    if (!server || !Number.isFinite(port)) return null
    const name = fragmentName || `${protocol}-${server}:${port}`
    return {
      id: makeNodeId(name, server, port, index, subscriptionId),
      name,
      protocol,
      server,
      port,
      rawConfig: {
        name,
        type: protocol,
        server,
        port,
        username: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
        password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
        tls: scheme === 'https',
      },
      subscriptionId,
    }
  }

  return null
}

function parseUriLines(lines: string[], subscriptionId?: string): ProxyNode[] {
  const nodes: ProxyNode[] = []
  const usedNames = new Set<string>()
  lines.forEach((line, idx) => {
    const node = parseSingleUri(line, idx, subscriptionId)
    if (!node) return
    let uniqueName = node.name
    let suffix = 2
    while (usedNames.has(uniqueName)) {
      uniqueName = `${node.name} (${suffix++})`
    }
    usedNames.add(uniqueName)
    nodes.push({
      ...node,
      name: uniqueName,
      rawConfig: { ...node.rawConfig, name: uniqueName },
    })
  })
  return nodes
}

export function parseProxyImport(content: string, subscriptionId?: string): ParsedProxyImport {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error('订阅或节点内容不能为空')
  }

  // 1. Try Clash YAML when proxies: exists
  if (/^\s*proxies\s*:/m.test(trimmed)) {
    let doc: { proxies?: unknown } | null = null
    try {
      doc = parseYaml(trimmed) as { proxies?: unknown } | null
    } catch {
      throw new Error('Clash YAML 语法格式无效，请检查缩进与字段后重试')
    }
    if (doc && Array.isArray(doc.proxies)) {
      const nodes: ProxyNode[] = []
      const usedNames = new Set<string>()
      doc.proxies.forEach((item, idx) => {
        if (!item || typeof item !== 'object') return
        const rec = item as Record<string, unknown>
        const protocol = mapClashType(String(rec.type ?? ''))
        const server = String(rec.server ?? '')
        const port = Number(rec.port ?? 0)
        if (!protocol || !server || !Number.isFinite(port) || port <= 0) return
        let name = String(rec.name ?? `${protocol}-${server}:${port}`)
        let suffix = 2
        while (usedNames.has(name)) {
          name = `${String(rec.name ?? protocol)} (${suffix++})`
        }
        usedNames.add(name)
        nodes.push({
          id: makeNodeId(name, server, port, idx, subscriptionId),
          name,
          protocol,
          server,
          port,
          rawConfig: { ...rec, name, type: protocol, server, port },
          subscriptionId,
        })
      })
      if (nodes.length > 0) {
        return { format: 'clash-yaml', nodes }
      }
    }
  }

  // 2. Try raw URI lines
  const rawLines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (rawLines.some((l) => /^[a-z0-9]+:\/\//i.test(l))) {
    const nodes = parseUriLines(rawLines, subscriptionId)
    if (nodes.length > 0) {
      return { format: 'uri-list', nodes }
    }
  }

  // 3. Try base64-encoded V2Ray subscription
  try {
    const decoded = decodeBase64Flexible(trimmed)
    const decodedLines = decoded
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const nodes = parseUriLines(decodedLines, subscriptionId)
    if (nodes.length > 0) {
      return { format: 'v2ray-base64', nodes }
    }
  } catch {
    // Fall through
  }

  throw new Error('未能识别的代理配置格式：支持 Clash YAML、V2Ray Base64 订阅或节点分享链接')
}

export function parseCustomProxyUrl(rawUrl: string): ParsedCustomProxyUrl {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    throw new Error('自定义代理地址不能为空')
  }
  const withScheme = /^[a-z0-9]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const parsed = new URL(withScheme)
  if (!parsed.hostname) {
    throw new Error(`无效的代理主机名: ${rawUrl}`)
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
  const port = parsed.port || (scheme.startsWith('socks') ? '1080' : '8080')
  const normalizedScheme = scheme === 'socks' ? 'socks5' : scheme
  return {
    proxyRules: `${normalizedScheme}://${parsed.hostname}:${port}`,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  }
}
