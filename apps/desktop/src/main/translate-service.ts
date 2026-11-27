import type { TranslatePageMode } from '@wb/contracts'

export interface FetchResponseLike {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>

const SEGMENT_SEP = '\n[[WB_SEG_9482]]\n'

export async function translateSingleText(
  text: string,
  targetLang: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return text

  try {
    const googleUrl =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`
    const res = await fetchFn(googleUrl, {
      headers: { Accept: 'application/json' },
    })
    if (res.ok) {
      const data = (await res.json()) as unknown
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translated = (data[0] as unknown[])
          .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
          .join('')
        if (translated) return translated
      }
    }
  } catch {
    // Fall back to MyMemory below
  }

  try {
    const myMemoryUrl =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(`autodetect|${targetLang}`)}`
    const res = await fetchFn(myMemoryUrl, {
      headers: { Accept: 'application/json' },
    })
    if (res.ok) {
      const data = (await res.json()) as {
        responseData?: { translatedText?: string }
      }
      const translated = data?.responseData?.translatedText?.trim()
      if (translated) return translated
    }
  } catch {
    // Throw unified Chinese error below
  }

  throw new Error('翻译服务连接失败，请检查网络或当前工作区代理配置')
}

export async function translateTexts(
  texts: string[],
  targetLang: string,
  fetchFn: FetchLike = fetch,
): Promise<string[]> {
  if (texts.length === 0) return []

  const uniqueTexts: string[] = []
  const indexByText = new Map<string, number>()
  const mapping: number[] = []

  for (const raw of texts) {
    const key = raw.trim()
    if (!key) {
      mapping.push(-1)
      continue
    }
    let idx = indexByText.get(key)
    if (idx === undefined) {
      idx = uniqueTexts.length
      indexByText.set(key, idx)
      uniqueTexts.push(key)
    }
    mapping.push(idx)
  }

  const translatedUnique = new Array<string>(uniqueTexts.length)
  const chunks: number[][] = []
  let currentChunk: number[] = []
  let currentLen = 0

  for (let i = 0; i < uniqueTexts.length; i++) {
    const t = uniqueTexts[i]!
    const addLen = t.length + SEGMENT_SEP.length
    if (currentChunk.length > 0 && (currentLen + addLen > 1200 || currentChunk.length >= 25)) {
      chunks.push(currentChunk)
      currentChunk = [i]
      currentLen = t.length
    } else {
      currentChunk.push(i)
      currentLen += addLen
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  for (const chunk of chunks) {
    if (chunk.length === 1) {
      const idx = chunk[0]!
      translatedUnique[idx] = await translateSingleText(uniqueTexts[idx]!, targetLang, fetchFn)
      continue
    }

    const joined = chunk.map((idx) => uniqueTexts[idx]!).join(SEGMENT_SEP)
    const batchOut = await translateSingleText(joined, targetLang, fetchFn)
    const parts = batchOut.split(/\n?\[\[WB_SEG_9482\]\]\n?/g)
    if (parts.length === chunk.length) {
      chunk.forEach((idx, pos) => {
        translatedUnique[idx] = parts[pos]!.trim() || uniqueTexts[idx]!
      })
    } else {
      for (const idx of chunk) {
        translatedUnique[idx] = await translateSingleText(uniqueTexts[idx]!, targetLang, fetchFn)
      }
    }
  }

  return texts.map((orig, i) => {
    const uIdx = mapping[i]!
    return uIdx >= 0 ? (translatedUnique[uIdx] ?? orig) : orig
  })
}

export const EXTRACT_PAGE_TEXTS_SCRIPT = `(() => {
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SVG', 'SELECT']);
  if (!window.__mulspaceTranslateNodes) window.__mulspaceTranslateNodes = [];
  if (!window.__mulspaceTranslateOrig) window.__mulspaceTranslateOrig = [];

  if (window.__mulspaceTranslateNodes.length > 0 && window.__mulspaceTranslateOrig.length === window.__mulspaceTranslateNodes.length) {
    const existing = [];
    for (let i = 0; i < window.__mulspaceTranslateNodes.length; i++) {
      const n = window.__mulspaceTranslateNodes[i];
      const orig = window.__mulspaceTranslateOrig[i];
      if (n && n.isConnected && typeof orig === 'string') {
        existing.push({ id: i, text: orig });
      }
    }
    if (existing.length > 0) return existing;
  }

  const nodes = [];
  const orig = [];
  const results = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let cur;
  while ((cur = walker.nextNode())) {
    if (results.length >= 220) break;
    const parent = cur.parentElement;
    if (!parent) continue;
    if (parent.closest('[data-mulspace-tr="1"]')) continue;
    if (SKIP_TAGS.has(parent.tagName)) continue;
    if (parent.isContentEditable) continue;
    const style = window.getComputedStyle(parent);
    if (!style || style.display === 'none' || style.visibility === 'hidden') continue;
    const raw = cur.nodeValue || '';
    const trimmed = raw.trim();
    if (trimmed.length < 2) continue;
    if (/^[\\d\\s.,:%+\\-–—/|\\\\()\\[\\]{}!@#$^&*_=~<>?]+$/.test(trimmed)) continue;
    const id = nodes.length;
    nodes.push(cur);
    orig.push(raw);
    results.push({ id, text: trimmed });
  }
  window.__mulspaceTranslateNodes = nodes;
  window.__mulspaceTranslateOrig = orig;
  return results;
})()`

export function buildApplyTranslationsScript(
  entries: Array<{ id: number; translated: string }>,
  mode: TranslatePageMode,
): string {
  const serialized = JSON.stringify(entries)
  return `(() => {
    const entries = ${serialized};
    const mode = ${JSON.stringify(mode)};
    const nodes = window.__mulspaceTranslateNodes || [];
    const orig = window.__mulspaceTranslateOrig || [];
    document.querySelectorAll('[data-mulspace-tr="1"]').forEach((el) => el.remove());
    let applied = 0;
    for (const item of entries) {
      const node = nodes[item.id];
      const originalRaw = orig[item.id];
      if (!node || !node.isConnected || typeof originalRaw !== 'string') continue;
      if (mode === 'replace') {
        const leading = originalRaw.match(/^\\s*/)?.[0] || '';
        const trailing = originalRaw.match(/\\s*$/)?.[0] || '';
        node.nodeValue = leading + item.translated + trailing;
        applied++;
      } else {
        node.nodeValue = originalRaw;
        if (item.translated && item.translated.trim() !== originalRaw.trim()) {
          const span = document.createElement('span');
          span.setAttribute('data-mulspace-tr', '1');
          span.style.cssText = 'display:block;font-size:0.92em;opacity:0.82;margin-top:2px;line-height:1.45;';
          span.textContent = item.translated;
          node.parentNode?.insertBefore(span, node.nextSibling);
          applied++;
        }
      }
    }
    return applied;
  })()`
}

export const RESTORE_PAGE_TRANSLATIONS_SCRIPT = `(() => {
  document.querySelectorAll('[data-mulspace-tr="1"]').forEach((el) => el.remove());
  const nodes = window.__mulspaceTranslateNodes || [];
  const orig = window.__mulspaceTranslateOrig || [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const o = orig[i];
    if (n && n.isConnected && typeof o === 'string') {
      n.nodeValue = o;
    }
  }
})()`
