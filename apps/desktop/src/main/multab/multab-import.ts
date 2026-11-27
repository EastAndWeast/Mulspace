export interface ParsedChromeBookmarkEntry {
  folder: string
  title: string
  url: string
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTags(htmlFragment: string): string {
  return decodeHtmlEntities(htmlFragment.replace(/<[^>]*>/g, ''))
}

/**
 * Parses standard Netscape/Chrome/Edge exported bookmarks.html into folder + title + http(s) URL records.
 */
export function parseChromeBookmarksHtml(html: string): ParsedChromeBookmarkEntry[] {
  const entries: ParsedChromeBookmarkEntry[] = []
  const folderStack: string[] = []
  let pendingFolder: string | null = null

  const tokenRegex = /<H3\b[^>]*>([\s\S]*?)<\/H3>|<DL\b[^>]*>|<\/DL>|<A\b([^>]*)>([\s\S]*?)<\/A>/gi
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(html)) !== null) {
    const token = match[0]
    if (match[1] !== undefined) {
      const folderName = stripTags(match[1])
      if (folderName && folderName !== '书签栏' && folderName.toLowerCase() !== 'bookmarks bar') {
        pendingFolder = folderName
      } else {
        pendingFolder = null
      }
      continue
    }

    if (/^<DL\b/i.test(token)) {
      folderStack.push(pendingFolder ?? folderStack[folderStack.length - 1] ?? '导入书签')
      pendingFolder = null
      continue
    }

    if (/^<\/DL>/i.test(token)) {
      if (folderStack.length > 0) {
        folderStack.pop()
      }
      pendingFolder = null
      continue
    }

    if (match[2] !== undefined && match[3] !== undefined) {
      const attrs = match[2]
      const hrefMatch = /\bHREF\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i.exec(attrs)
      const rawUrl = decodeHtmlEntities(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '')
      if (!/^https?:\/\//i.test(rawUrl)) continue

      const title = stripTags(match[3]) || rawUrl
      const folder = folderStack[folderStack.length - 1] ?? '导入书签'
      entries.push({ folder, title, url: rawUrl })
    }
  }

  return entries
}
