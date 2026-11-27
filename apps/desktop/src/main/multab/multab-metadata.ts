import type { MultabSiteMetadata } from '@wb/contracts'

const MAX_HTML_BYTES = 96 * 1024
const FETCH_TIMEOUT_MS = 4500

export function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('网址不能为空')
  }
  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error('请输入有效的 http/https 网址')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Multab 仅支持 http/https 网页链接')
  }
  return parsed.toString()
}

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
}

function parseAttr(tag: string, attrName: string): string | undefined {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = tag.match(re)
  const raw = match?.[1] ?? match?.[2] ?? match?.[3]
  return raw ? decodeBasicEntities(raw).trim() : undefined
}

function extractTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch?.[1]) {
    const cleaned = decodeBasicEntities(titleMatch[1]).replace(/\s+/g, ' ').trim()
    if (cleaned) return cleaned
  }
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of metaTags) {
    const prop = parseAttr(tag, 'property')?.toLowerCase() ?? parseAttr(tag, 'name')?.toLowerCase()
    if (prop === 'og:title' || prop === 'twitter:title') {
      const content = parseAttr(tag, 'content')
      if (content) return content.replace(/\s+/g, ' ').trim()
    }
  }
  return undefined
}

function scoreIconRel(rel: string): number {
  const lower = rel.toLowerCase()
  const tokens = lower.split(/\s+/).filter(Boolean)
  if (tokens.includes('apple-touch-icon') || tokens.includes('apple-touch-icon-precomposed')) return 3
  if (tokens.includes('icon')) return 2
  if (lower.includes('shortcut') && tokens.includes('icon')) return 1
  return 0
}

function extractBestIconUrl(html: string, baseUrl: string): string | undefined {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? []
  let bestScore = 0
  let bestHref: string | undefined

  for (const tag of linkTags) {
    const rel = parseAttr(tag, 'rel')
    if (!rel) continue
    const score = scoreIconRel(rel)
    if (score === 0) continue
    const href = parseAttr(tag, 'href')
    if (!href) continue
    try {
      const resolved = new URL(href, baseUrl)
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:' && resolved.protocol !== 'data:') {
        continue
      }
      if (score > bestScore) {
        bestScore = score
        bestHref = resolved.toString()
      }
    } catch {
      // Ignore malformed icon URLs
    }
  }
  return bestHref
}

async function readHeadHtml(res: Response): Promise<string> {
  if (!res.body) {
    const text = await res.text()
    return text.slice(0, MAX_HTML_BYTES)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let received = 0
  let result = ''
  try {
    while (received < MAX_HTML_BYTES) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        received += value.byteLength
        result += decoder.decode(value, { stream: true })
        if (result.includes('</head>')) break
      }
    }
    result += decoder.decode()
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return result
}

/**
 * Fetches page title and best favicon URL for a Multab bookmark candidate.
 * Never throws on network or parse errors — gracefully falls back to `/favicon.ico`.
 */
export async function fetchSiteMetadata(
  rawUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<MultabSiteMetadata> {
  const normalizedUrl = normalizeHttpUrl(rawUrl)
  const parsedInitial = new URL(normalizedUrl)
  const fallbackIcon = `${parsedInitial.origin}/favicon.ico`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetchFn(normalizedUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    })

    const finalUrl = res.url || normalizedUrl
    let finalOrigin = parsedInitial.origin
    try {
      finalOrigin = new URL(finalUrl).origin
    } catch {
      // keep initial origin
    }
    const contentType = res.headers.get('content-type')?.toLowerCase() ?? ''
    if (!res.ok || (contentType && !contentType.includes('html') && !contentType.includes('xml'))) {
      return { url: normalizedUrl, iconUrl: `${finalOrigin}/favicon.ico` }
    }

    const html = await readHeadHtml(res)
    const title = extractTitle(html)
    const iconUrl = extractBestIconUrl(html, finalUrl) ?? `${finalOrigin}/favicon.ico`
    return {
      url: normalizedUrl,
      title,
      iconUrl,
    }
  } catch {
    return {
      url: normalizedUrl,
      iconUrl: fallbackIcon,
    }
  } finally {
    clearTimeout(timer)
  }
}
