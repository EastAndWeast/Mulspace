import { randomUUID } from 'node:crypto'
import {
  createServiceToken,
  type IKernelContext,
  type IKernelModule,
  type IStorageRepository,
  type MultabCategory,
  type MultabImportResult,
  type MultabItem,
  type MultabPrefsPatch,
  type MultabSearchEngineId,
  type MultabSiteMetadata,
  type MultabState,
  type MultabSyncPullResult,
  type MultabSyncPushResult,
  type MultabViewMode,
  type SaveMultabCategoryInput,
  type SaveMultabItemInput,
} from '@wb/contracts'
import {
  decryptMultabPayload,
  deriveSyncSlotId,
  encryptMultabPayload,
  generateSixDigitCode,
} from './multab-crypto.js'
import { parseChromeBookmarksHtml } from './multab-import.js'
import { fetchSiteMetadata, normalizeHttpUrl } from './multab-metadata.js'

export const MultabServiceToken = createServiceToken<MultabService>('MultabService')

const VALID_SEARCH_ENGINES = new Set<MultabSearchEngineId>(['bing', 'google', 'baidu', 'github'])
const VALID_VIEW_MODES = new Set<MultabViewMode>(['icons', 'cards'])
const SYNC_TTL_SECONDS = 300

const STARTER_ICON_URLS: Record<string, string> = {
  item_hotel_douyin: 'https://life.douyin.com/favicon.ico',
  item_hotel_meituan: 'https://eb.meituan.com/favicon.ico',
  item_hotel_fliggy: 'https://ebooking.fliggy.com/favicon.ico',
  item_hotel_ctrip: 'https://ebooking.ctrip.com/favicon.ico',
  item_bing: 'https://www.bing.com/favicon.ico',
  item_bili: 'https://www.bilibili.com/favicon.ico',
  item_zhihu: 'https://static.zhihu.com/heifetz/favicon.ico',
  item_x: 'https://abs.twimg.com/favicons/twitter.3.ico',
  item_feishu: 'https://www.feishu.cn/favicon.ico',
  item_notion: 'https://www.notion.so/images/favicon.ico',
  item_gmail: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
  item_github: 'https://github.githubassets.com/favicons/favicon.svg',
  item_cf: 'https://dash.cloudflare.com/favicon.ico',
  item_juejin: 'https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png',
  item_deepseek: 'https://chat.deepseek.com/favicon.svg',
  item_chatgpt: 'https://chatgpt.com/favicon.ico',
  item_claude: 'https://claude.ai/favicon.ico',
}

function normalizeRelayUrl(raw?: string): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('请先配置同步中转服务地址（支持一键部署 Cloudflare Workers 免费服务）')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('同步服务地址格式无效，请输入完整的 https:// 链接')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('同步服务地址必须使用 http 或 https 协议')
  }
  return parsed.toString().replace(/\/+$/, '')
}

const STARTER_PINNED_IDS = new Set([
  'item_bing',
  'item_feishu',
  'item_notion',
  'item_github',
  'item_chatgpt',
  'item_deepseek',
])

function createHotelModuleSeed(
  now: number,
  order: number,
): { category: MultabCategory; items: MultabItem[] } {
  const category: MultabCategory = {
    id: 'cat_hotel',
    name: '酒店',
    icon: 'hotel',
    order,
    createdAt: now,
    updatedAt: now,
  }
  const makeHotelItem = (
    id: string,
    title: string,
    url: string,
    iconBg: string,
    itemOrder: number,
  ): MultabItem => ({
    id,
    categoryId: 'cat_hotel',
    title,
    url,
    iconUrl: STARTER_ICON_URLS[id],
    iconBg,
    pinned: false,
    order: itemOrder,
    createdAt: now,
    updatedAt: now,
  })

  return {
    category,
    items: [
      makeHotelItem('item_hotel_douyin', '抖音来客', 'https://life.douyin.com/', '#BE3B62', 0),
      makeHotelItem('item_hotel_meituan', '美团酒店后台', 'https://eb.meituan.com/', '#B45D12', 1),
      makeHotelItem('item_hotel_fliggy', '飞猪酒店后台', 'https://ebooking.fliggy.com/', '#C76A15', 2),
      makeHotelItem('item_hotel_ctrip', '携程酒店后台', 'https://ebooking.ctrip.com/', '#1F5AE0', 3),
    ],
  }
}

function createInitialMultabState(now = Date.now()): MultabState {
  const hotelSeed = createHotelModuleSeed(now, 0)
  const categories: MultabCategory[] = [
    hotelSeed.category,
    { id: 'cat_common', name: '常用导航', icon: 'compass', order: 1, createdAt: now, updatedAt: now },
    { id: 'cat_work', name: '工作效率', icon: 'briefcase', order: 2, createdAt: now, updatedAt: now },
    { id: 'cat_dev', name: '开发与工具', icon: 'code', order: 3, createdAt: now, updatedAt: now },
    { id: 'cat_ai', name: 'AI 工具', icon: 'bot', order: 4, createdAt: now, updatedAt: now },
  ]

  const seed = (
    id: string,
    categoryId: string,
    title: string,
    url: string,
    iconBg: string,
    order: number,
  ): MultabItem => ({
    id,
    categoryId,
    title,
    url,
    iconUrl: STARTER_ICON_URLS[id],
    iconBg,
    pinned: STARTER_PINNED_IDS.has(id),
    order,
    createdAt: now,
    updatedAt: now,
  })

  const items: MultabItem[] = [
    ...hotelSeed.items,
    seed('item_bing', 'cat_common', 'Bing', 'https://www.bing.com/', '#1F5AE0', 0),
    seed('item_bili', 'cat_common', 'Bilibili', 'https://www.bilibili.com/', '#BE3B62', 1),
    seed('item_zhihu', 'cat_common', '知乎', 'https://www.zhihu.com/', '#1F5AE0', 2),
    seed('item_x', 'cat_common', 'X', 'https://x.com/', '#3C6E8F', 3),
    seed('item_feishu', 'cat_work', '飞书', 'https://www.feishu.cn/', '#147A6B', 0),
    seed('item_notion', 'cat_work', 'Notion', 'https://www.notion.so/', '#3C6E8F', 1),
    seed('item_gmail', 'cat_work', 'Gmail', 'https://mail.google.com/', '#BE3B62', 2),
    seed('item_github', 'cat_dev', 'GitHub', 'https://github.com/', '#3C6E8F', 0),
    seed('item_cf', 'cat_dev', 'Cloudflare', 'https://dash.cloudflare.com/', '#B45D12', 1),
    seed('item_juejin', 'cat_dev', '稀土掘金', 'https://juejin.cn/', '#1F5AE0', 2),
    seed('item_deepseek', 'cat_ai', 'DeepSeek', 'https://chat.deepseek.com/', '#1F5AE0', 0),
    seed('item_chatgpt', 'cat_ai', 'ChatGPT', 'https://chatgpt.com/', '#147A6B', 1),
    seed('item_claude', 'cat_ai', 'Claude', 'https://claude.ai/', '#B45D12', 2),
  ]

  return {
    schemaVersion: 1,
    searchEngine: 'bing',
    viewMode: 'icons',
    widgetsHidden: false,
    wallpaperEnabled: true,
    notes: '',
    categories,
    items,
  }
}

export interface MultabServiceOptions {
  fetchFn?: typeof fetch
}

export class MultabService implements IKernelModule {
  readonly id = 'multab'

  private ctx?: IKernelContext
  private state: MultabState = createInitialMultabState()
  private readonly fetchFn: typeof fetch

  constructor(
    private readonly storage: IStorageRepository,
    options: MultabServiceOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch
  }

  async init(ctx: IKernelContext): Promise<void> {
    this.ctx = ctx
    const persisted = await this.storage.loadState()
    if (persisted.multab && persisted.multab.schemaVersion === 1) {
      let hydrated = false
      const items = Array.isArray(persisted.multab.items) ? persisted.multab.items : []
      for (const item of items) {
        if (!item.deletedAt && item.iconUrl === undefined && STARTER_ICON_URLS[item.id]) {
          item.iconUrl = STARTER_ICON_URLS[item.id]
          hydrated = true
        }
      }
      const activeItems = items.filter((item) => !item.deletedAt)
      if (activeItems.length > 0 && activeItems.every((item) => item.pinned === undefined)) {
        let pinnedCount = 0
        for (const item of activeItems) {
          if (STARTER_PINNED_IDS.has(item.id)) {
            item.pinned = true
            pinnedCount++
          }
        }
        if (pinnedCount === 0) {
          for (const item of activeItems.slice(0, 6)) {
            item.pinned = true
          }
        }
        hydrated = true
      }
      const categories = Array.isArray(persisted.multab.categories) ? persisted.multab.categories : []
      if (!categories.some((c) => c.id === 'cat_hotel')) {
        const now = Date.now()
        const hotelSeed = createHotelModuleSeed(now, 0)
        for (const cat of categories) {
          cat.order += 1
        }
        categories.unshift(hotelSeed.category)
        const existingItemIds = new Set(items.map((i) => i.id))
        for (const hotelItem of hotelSeed.items) {
          if (!existingItemIds.has(hotelItem.id)) {
            items.push(hotelItem)
          }
        }
        hydrated = true
      }
      this.state = {
        schemaVersion: 1,
        searchEngine: VALID_SEARCH_ENGINES.has(persisted.multab.searchEngine)
          ? persisted.multab.searchEngine
          : 'bing',
        viewMode:
          persisted.multab.viewMode && VALID_VIEW_MODES.has(persisted.multab.viewMode)
            ? persisted.multab.viewMode
            : 'icons',
        widgetsHidden: Boolean(persisted.multab.widgetsHidden),
        wallpaperEnabled: persisted.multab.wallpaperEnabled ?? true,
        notes: typeof persisted.multab.notes === 'string' ? persisted.multab.notes : '',
        syncRelayUrl: persisted.multab.syncRelayUrl,
        lastSyncedAt: persisted.multab.lastSyncedAt,
        categories,
        items,
      }
      if (hydrated) {
        await this.storage.saveMultab(this.state)
      }
    } else {
      this.state = createInitialMultabState()
      await this.storage.saveMultab(this.state)
    }
    ctx.services.register(MultabServiceToken, this)
  }

  getState(): MultabState {
    return {
      schemaVersion: 1,
      searchEngine: this.state.searchEngine,
      viewMode: this.state.viewMode ?? 'icons',
      widgetsHidden: Boolean(this.state.widgetsHidden),
      wallpaperEnabled: this.state.wallpaperEnabled ?? true,
      notes: this.state.notes ?? '',
      syncRelayUrl: this.state.syncRelayUrl,
      lastSyncedAt: this.state.lastSyncedAt,
      categories: this.state.categories
        .filter((c) => !c.deletedAt)
        .sort((a, b) => a.order - b.order)
        .map((c) => structuredClone(c)),
      items: this.state.items
        .filter((item) => !item.deletedAt)
        .sort((a, b) => a.order - b.order)
        .map((item) => structuredClone(item)),
    }
  }

  async saveCategory(input: SaveMultabCategoryInput): Promise<MultabState> {
    const name = input.name.trim()
    if (!name) {
      throw new Error('分组名称不能为空')
    }
    const now = Date.now()
    const icon = input.icon?.trim() || 'folder'

    if (input.id) {
      const existing = this.state.categories.find((c) => c.id === input.id && !c.deletedAt)
      if (!existing) {
        throw new Error('分组不存在')
      }
      existing.name = name
      existing.icon = icon
      existing.updatedAt = now
    } else {
      const activeCats = this.state.categories.filter((c) => !c.deletedAt)
      const nextOrder = activeCats.length > 0 ? Math.max(...activeCats.map((c) => c.order)) + 1 : 0
      this.state.categories.push({
        id: `cat_${randomUUID().slice(0, 8)}`,
        name,
        icon,
        order: nextOrder,
        createdAt: now,
        updatedAt: now,
      })
    }

    await this.persistAndEmit()
    return this.getState()
  }

  async deleteCategory(categoryId: string): Promise<MultabState> {
    const activeCats = this.state.categories.filter((c) => !c.deletedAt)
    if (activeCats.length <= 1) {
      throw new Error('至少保留 1 个分组')
    }
    const target = this.state.categories.find((c) => c.id === categoryId && !c.deletedAt)
    if (!target) {
      return this.getState()
    }

    const now = Date.now()
    target.deletedAt = now
    target.updatedAt = now

    for (const item of this.state.items) {
      if (item.categoryId === categoryId && !item.deletedAt) {
        item.deletedAt = now
        item.updatedAt = now
      }
    }

    await this.persistAndEmit()
    return this.getState()
  }

  async reorderCategories(orderedIds: string[]): Promise<MultabState> {
    const rank = new Map(orderedIds.map((id, idx) => [id, idx]))
    const now = Date.now()
    let changed = false

    const activeCats = this.state.categories
      .filter((c) => !c.deletedAt)
      .sort((a, b) => {
        const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
        return ra - rb || a.order - b.order
      })

    activeCats.forEach((cat, idx) => {
      if (cat.order !== idx) {
        cat.order = idx
        cat.updatedAt = now
        changed = true
      }
    })

    if (changed) {
      await this.persistAndEmit()
    }
    return this.getState()
  }

  async saveItem(input: SaveMultabItemInput): Promise<MultabState> {
    const title = input.title.trim()
    if (!title) {
      throw new Error('网站名称不能为空')
    }
    const url = normalizeHttpUrl(input.url)
    const now = Date.now()
    const defaultFavicon = `${new URL(url).origin}/favicon.ico`

    let categoryId = input.categoryId
    if (!this.state.categories.some((c) => c.id === categoryId && !c.deletedAt)) {
      const firstActive = this.state.categories.find((c) => !c.deletedAt)
      if (!firstActive) {
        throw new Error('没有可用的分组')
      }
      categoryId = firstActive.id
    }

    if (input.id) {
      const existing = this.state.items.find((i) => i.id === input.id && !i.deletedAt)
      if (!existing) {
        throw new Error('收藏项不存在')
      }
      const movedCategory = existing.categoryId !== categoryId
      existing.categoryId = categoryId
      existing.title = title
      existing.url = url
      if (input.iconUrl !== undefined) existing.iconUrl = input.iconUrl.trim() || undefined
      if (input.iconBg !== undefined) existing.iconBg = input.iconBg || undefined
      if (input.pinned !== undefined) {
        existing.pinned = Boolean(input.pinned)
        if (existing.pinned && existing.pinnedOrder === undefined) {
          const pinnedSibs = this.state.items.filter(
            (i) => !i.deletedAt && i.pinned && i.id !== existing.id && i.pinnedOrder !== undefined,
          )
          existing.pinnedOrder =
            pinnedSibs.length > 0 ? Math.max(...pinnedSibs.map((s) => s.pinnedOrder!)) + 1 : 0
        }
      }
      if (movedCategory) {
        const sibs = this.state.items.filter((i) => i.categoryId === categoryId && !i.deletedAt && i.id !== existing.id)
        existing.order = sibs.length > 0 ? Math.max(...sibs.map((s) => s.order)) + 1 : 0
      }
      existing.updatedAt = now
    } else {
      const sibs = this.state.items.filter((i) => i.categoryId === categoryId && !i.deletedAt)
      const nextOrder = sibs.length > 0 ? Math.max(...sibs.map((s) => s.order)) + 1 : 0
      const pinnedSibs = this.state.items.filter((i) => !i.deletedAt && i.pinned && i.pinnedOrder !== undefined)
      const isPinned = Boolean(input.pinned)
      this.state.items.push({
        id: `item_${randomUUID().slice(0, 8)}`,
        categoryId,
        title,
        url,
        iconUrl: input.iconUrl === undefined ? defaultFavicon : input.iconUrl.trim() || undefined,
        iconBg: input.iconBg || '#1F5AE0',
        pinned: isPinned,
        pinnedOrder: isPinned
          ? pinnedSibs.length > 0
            ? Math.max(...pinnedSibs.map((s) => s.pinnedOrder!)) + 1
            : 0
          : undefined,
        order: nextOrder,
        createdAt: now,
        updatedAt: now,
      })
    }

    await this.persistAndEmit()
    return this.getState()
  }

  async deleteItem(itemId: string): Promise<MultabState> {
    const existing = this.state.items.find((i) => i.id === itemId && !i.deletedAt)
    if (!existing) {
      return this.getState()
    }
    const now = Date.now()
    existing.deletedAt = now
    existing.updatedAt = now
    await this.persistAndEmit()
    return this.getState()
  }

  async reorderItems(categoryId: string, orderedIds: string[]): Promise<MultabState> {
    const rank = new Map(orderedIds.map((id, idx) => [id, idx]))
    const now = Date.now()
    let changed = false

    if (categoryId === 'home') {
      const homeItems = this.state.items
        .filter((i) => !i.deletedAt && (i.pinned || rank.has(i.id)))
        .sort((a, b) => {
          const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
          const pa = a.pinnedOrder ?? Number.MAX_SAFE_INTEGER
          const pb = b.pinnedOrder ?? Number.MAX_SAFE_INTEGER
          return ra - rb || pa - pb || a.order - b.order
        })

      homeItems.forEach((item, idx) => {
        if (rank.has(item.id) && !item.pinned) {
          item.pinned = true
          item.updatedAt = now
          changed = true
        }
        if (item.pinnedOrder !== idx) {
          item.pinnedOrder = idx
          item.updatedAt = now
          changed = true
        }
      })

      if (changed) {
        await this.persistAndEmit()
      }
      return this.getState()
    }

    const catItems = this.state.items
      .filter((i) => i.categoryId === categoryId && !i.deletedAt)
      .sort((a, b) => {
        const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
        return ra - rb || a.order - b.order
      })

    catItems.forEach((item, idx) => {
      if (item.order !== idx) {
        item.order = idx
        item.updatedAt = now
        changed = true
      }
    })

    if (changed) {
      await this.persistAndEmit()
    }
    return this.getState()
  }

  async updatePrefs(patch: MultabPrefsPatch): Promise<MultabState> {
    let changed = false
    if (patch.searchEngine && VALID_SEARCH_ENGINES.has(patch.searchEngine) && patch.searchEngine !== this.state.searchEngine) {
      this.state.searchEngine = patch.searchEngine
      changed = true
    }
    if (patch.viewMode && VALID_VIEW_MODES.has(patch.viewMode) && patch.viewMode !== (this.state.viewMode ?? 'icons')) {
      this.state.viewMode = patch.viewMode
      changed = true
    }
    if (patch.widgetsHidden !== undefined && Boolean(patch.widgetsHidden) !== Boolean(this.state.widgetsHidden)) {
      this.state.widgetsHidden = Boolean(patch.widgetsHidden)
      changed = true
    }
    if (patch.wallpaperEnabled !== undefined && Boolean(patch.wallpaperEnabled) !== (this.state.wallpaperEnabled ?? true)) {
      this.state.wallpaperEnabled = Boolean(patch.wallpaperEnabled)
      changed = true
    }
    if (patch.notes !== undefined && patch.notes !== (this.state.notes ?? '')) {
      this.state.notes = patch.notes
      changed = true
    }
    if (patch.syncRelayUrl !== undefined) {
      const cleaned = patch.syncRelayUrl.trim().replace(/\/+$/, '') || undefined
      if (cleaned !== this.state.syncRelayUrl) {
        this.state.syncRelayUrl = cleaned
        changed = true
      }
    }
    if (changed) {
      await this.persistAndEmit()
    }
    return this.getState()
  }

  fetchSiteMeta(rawUrl: string): Promise<MultabSiteMetadata> {
    return fetchSiteMetadata(rawUrl, this.fetchFn)
  }

  async testSyncRelay(relayUrl: string): Promise<{ ok: boolean; error?: string }> {
    let normalized: string
    try {
      normalized = normalizeRelayUrl(relayUrl)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const res = await this.fetchFn(`${normalized}/health`, { signal: controller.signal })
      if (!res.ok) {
        return { ok: false, error: `服务返回 HTTP ${res.status}` }
      }
      const data = (await res.json().catch(() => null)) as { ok?: boolean; service?: string } | null
      if (!data?.ok) {
        return { ok: false, error: '该地址未返回有效的 Multab 同步服务响应' }
      }
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? `无法连接：${err.message}` : '连接超时或网络不可用',
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async pushSyncCode(relayUrlInput?: string): Promise<MultabSyncPushResult> {
    const relayUrl = normalizeRelayUrl(relayUrlInput ?? this.state.syncRelayUrl)
    const code = generateSixDigitCode()
    const slotId = deriveSyncSlotId(code)
    const envelope = encryptMultabPayload(code, this.state)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await this.fetchFn(`${relayUrl}/v1/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, envelope, ttlSeconds: SYNC_TTL_SECONDS }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `上传同步包失败（HTTP ${res.status}）`)
      }
    } finally {
      clearTimeout(timer)
    }

    const now = Date.now()
    this.state.syncRelayUrl = relayUrl
    this.state.lastSyncedAt = now
    await this.persistAndEmit()

    return {
      code,
      expiresAt: now + SYNC_TTL_SECONDS * 1000,
      categoryCount: this.state.categories.filter((c) => !c.deletedAt).length,
      itemCount: this.state.items.filter((i) => !i.deletedAt).length,
    }
  }

  async pullSyncCode(rawCode: string, relayUrlInput?: string): Promise<MultabSyncPullResult> {
    const relayUrl = normalizeRelayUrl(relayUrlInput ?? this.state.syncRelayUrl)
    const slotId = deriveSyncSlotId(rawCode)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    let envelope: unknown
    try {
      const res = await this.fetchFn(`${relayUrl}/v1/sync/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || (res.status === 404 ? '同步码不存在或已过期' : `拉取失败（HTTP ${res.status}）`))
      }
      const data = (await res.json()) as { envelope?: unknown }
      envelope = data.envelope
    } finally {
      clearTimeout(timer)
    }

    const remote = decryptMultabPayload(rawCode, envelope)
    const stats = this.mergeRemoteState(remote)
    this.state.syncRelayUrl = relayUrl
    this.state.lastSyncedAt = Date.now()
    await this.persistAndEmit()

    return {
      ...stats,
      state: this.getState(),
    }
  }

  importChromeHtml(html: string): Promise<MultabImportResult> {
    const parsed = parseChromeBookmarksHtml(html)
    return this.applyImportedEntries(parsed)
  }

  exportJson(): string {
    return JSON.stringify(this.getState(), null, 2)
  }

  async importJson(jsonText: string): Promise<MultabImportResult> {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText) as unknown
    } catch {
      throw new Error('JSON 文件格式无效')
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('JSON 内容不是有效的 Multab 配置对象')
    }
    const rec = parsed as Partial<MultabState>
    if (!Array.isArray(rec.categories) || !Array.isArray(rec.items)) {
      throw new Error('JSON 缺少 categories 或 items 字段')
    }

    const stats = this.mergeRemoteState({
      schemaVersion: 1,
      searchEngine: VALID_SEARCH_ENGINES.has(rec.searchEngine as MultabSearchEngineId)
        ? (rec.searchEngine as MultabSearchEngineId)
        : this.state.searchEngine,
      viewMode: rec.viewMode && VALID_VIEW_MODES.has(rec.viewMode) ? rec.viewMode : this.state.viewMode,
      widgetsHidden: typeof rec.widgetsHidden === 'boolean' ? rec.widgetsHidden : this.state.widgetsHidden,
      notes: typeof rec.notes === 'string' ? rec.notes : undefined,
      categories: rec.categories,
      items: rec.items,
    })
    await this.persistAndEmit()

    return {
      addedCategories: stats.addedCategories,
      addedItems: stats.addedItems,
      state: this.getState(),
    }
  }

  private async applyImportedEntries(
    entries: Array<{ folder: string; title: string; url: string }>,
  ): Promise<MultabImportResult> {
    const now = Date.now()
    const catByName = new Map(
      this.state.categories
        .filter((c) => !c.deletedAt)
        .map((c) => [c.name.toLowerCase(), c]),
    )
    const existingKeys = new Set(
      this.state.items
        .filter((i) => !i.deletedAt)
        .map((i) => `${i.categoryId}|${i.url.toLowerCase()}`),
    )

    let nextCatOrder =
      this.state.categories.filter((c) => !c.deletedAt).reduce((m, c) => Math.max(m, c.order), -1) + 1
    let addedCategories = 0
    let addedItems = 0

    for (const entry of entries) {
      let cleanUrl: string
      try {
        cleanUrl = normalizeHttpUrl(entry.url)
      } catch {
        continue
      }

      const folderKey = entry.folder.trim().toLowerCase() || '导入书签'
      let cat = catByName.get(folderKey)
      if (!cat) {
        cat = {
          id: `cat_${randomUUID().slice(0, 8)}`,
          name: entry.folder.trim() || '导入书签',
          icon: 'folder',
          order: nextCatOrder++,
          createdAt: now,
          updatedAt: now,
        }
        this.state.categories.push(cat)
        catByName.set(folderKey, cat)
        addedCategories++
      }

      const dedupeKey = `${cat.id}|${cleanUrl.toLowerCase()}`
      if (existingKeys.has(dedupeKey)) continue
      existingKeys.add(dedupeKey)

      const sibCount = this.state.items.filter((i) => i.categoryId === cat!.id && !i.deletedAt).length
      this.state.items.push({
        id: `item_${randomUUID().slice(0, 8)}`,
        categoryId: cat.id,
        title: entry.title.trim() || cleanUrl,
        url: cleanUrl,
        iconBg: '#3C6E8F',
        order: sibCount,
        createdAt: now,
        updatedAt: now,
      })
      addedItems++
    }

    if (addedCategories > 0 || addedItems > 0) {
      await this.persistAndEmit()
    }

    return {
      addedCategories,
      addedItems,
      state: this.getState(),
    }
  }

  private mergeRemoteState(
    remote: Pick<MultabState, 'schemaVersion' | 'searchEngine' | 'viewMode' | 'widgetsHidden' | 'notes' | 'categories' | 'items'>,
  ): {
    addedCategories: number
    updatedCategories: number
    addedItems: number
    updatedItems: number
  } {
    const localCatsById = new Map(this.state.categories.map((c) => [c.id, c]))
    const localItemsById = new Map(this.state.items.map((i) => [i.id, i]))

    let addedCategories = 0
    let updatedCategories = 0
    let addedItems = 0
    let updatedItems = 0

    for (const rc of remote.categories) {
      if (!rc || typeof rc.id !== 'string' || typeof rc.name !== 'string') continue
      const lc = localCatsById.get(rc.id)
      if (!lc) {
        const clone = structuredClone(rc)
        this.state.categories.push(clone)
        localCatsById.set(clone.id, clone)
        if (!clone.deletedAt) addedCategories++
      } else if ((rc.updatedAt ?? 0) > (lc.updatedAt ?? 0)) {
        Object.assign(lc, structuredClone(rc))
        updatedCategories++
      }
    }

    for (const ri of remote.items) {
      if (!ri || typeof ri.id !== 'string' || typeof ri.url !== 'string') continue
      const li = localItemsById.get(ri.id)
      if (!li) {
        const clone = structuredClone(ri)
        this.state.items.push(clone)
        localItemsById.set(clone.id, clone)
        if (!clone.deletedAt) addedItems++
      } else if ((ri.updatedAt ?? 0) > (li.updatedAt ?? 0)) {
        Object.assign(li, structuredClone(ri))
        updatedItems++
      }
    }

    if (VALID_SEARCH_ENGINES.has(remote.searchEngine)) {
      this.state.searchEngine = remote.searchEngine
    }
    if (remote.viewMode && VALID_VIEW_MODES.has(remote.viewMode)) {
      this.state.viewMode = remote.viewMode
    }
    if (typeof remote.widgetsHidden === 'boolean') {
      this.state.widgetsHidden = remote.widgetsHidden
    }
    if (typeof remote.notes === 'string' && remote.notes.trim() && !(this.state.notes ?? '').trim()) {
      this.state.notes = remote.notes
    }

    return { addedCategories, updatedCategories, addedItems, updatedItems }
  }

  private async persistAndEmit(): Promise<void> {
    await this.storage.saveMultab(this.state)
    this.ctx?.events.emit('multab:updated', { state: this.getState() })
  }
}
