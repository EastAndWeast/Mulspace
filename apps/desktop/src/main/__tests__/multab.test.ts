import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserKernel } from '@wb/kernel'
import { JsonStorageRepository } from '@wb/storage'
import { decryptMultabPayload, deriveSyncSlotId, encryptMultabPayload, generateSixDigitCode } from '../multab/multab-crypto.js'
import { parseChromeBookmarksHtml } from '../multab/multab-import.js'
import { MultabService } from '../multab/multab-service.js'

const tempDirs: string[] = []
const closeCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
  while (closeCallbacks.length > 0) {
    await closeCallbacks.pop()!()
  }
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('Multab workbench, bookmarks & 6-digit E2E sync', () => {
  it('seeds categories/items, supports CRUD + reordering, and persists across restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-multab-crud-'))
    tempDirs.push(dir)

    const kernel1 = new BrowserKernel()
    const storage1 = new JsonStorageRepository(dir)
    const service1 = new MultabService(storage1)
    kernel1.use(service1)
    await kernel1.start()

    const initial = service1.getState()
    expect(initial.categories.length).toBeGreaterThanOrEqual(5)
    expect(initial.items.length).toBeGreaterThan(0)
    const hotelCat = initial.categories.find((c) => c.id === 'cat_hotel')
    expect(hotelCat?.name).toBe('酒店')
    const hotelUrls = initial.items.filter((i) => i.categoryId === 'cat_hotel').map((i) => i.url)
    expect(hotelUrls).toEqual([
      'https://life.douyin.com/',
      'https://eb.meituan.com/',
      'https://ebooking.fliggy.com/',
      'https://ebooking.ctrip.com/',
    ])

    const afterCat = await service1.saveCategory({ name: '客户工作台', icon: 'briefcase' })
    const customCat = afterCat.categories.find((c) => c.name === '客户工作台')!
    expect(customCat).toBeDefined()

    const afterItem = await service1.saveItem({
      categoryId: customCat.id,
      title: 'Aurellix Console',
      url: 'wallet.dev.aurellix.com',
      iconBg: '#147A6B',
    })
    const addedItem = afterItem.items.find((i) => i.categoryId === customCat.id)!
    expect(addedItem.url).toBe('https://wallet.dev.aurellix.com/')

    await service1.saveItem({
      categoryId: customCat.id,
      title: 'GitHub',
      url: 'https://github.com/EastAndWeast',
      pinned: true,
    })
    const twoItems = service1.getState().items.filter((i) => i.categoryId === customCat.id)
    const reordered = await service1.reorderItems(customCat.id, [twoItems[1]!.id, twoItems[0]!.id])
    const reorderedIds = reordered.items.filter((i) => i.categoryId === customCat.id).map((i) => i.id)
    expect(reorderedIds).toEqual([twoItems[1]!.id, twoItems[0]!.id])
    expect(reordered.viewMode).toBe('icons')

    await service1.updatePrefs({ viewMode: 'cards', widgetsHidden: true, notes: '北岸品牌周报跟进' })

    await storage1.flushNow()
    await kernel1.stop()

    // Reload from disk
    const kernel2 = new BrowserKernel()
    const service2 = new MultabService(new JsonStorageRepository(dir))
    kernel2.use(service2)
    await kernel2.start()

    const reloaded = service2.getState()
    expect(reloaded.viewMode).toBe('cards')
    expect(reloaded.widgetsHidden).toBe(true)
    expect(reloaded.notes).toBe('北岸品牌周报跟进')
    expect(reloaded.items.find((i) => i.id === twoItems[1]!.id)?.pinned).toBe(true)
    expect(reloaded.categories.some((c) => c.name === '客户工作台')).toBe(true)
    expect(reloaded.items.filter((i) => i.categoryId === customCat.id).map((i) => i.id)).toEqual(reorderedIds)
    await kernel2.stop()
  })

  it('fetches website title and best favicon URL cleanly with fallback on error', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><html><head>
          <title>Aurellix &amp; Ops Console</title>
          <link rel="shortcut icon" href="/old.ico">
          <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
        </head><body>ok</body></html>`)
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    closeCallbacks.push(() => new Promise((r) => server.close(() => r())))
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

    const dir = await mkdtemp(join(tmpdir(), 'wb-multab-meta-'))
    tempDirs.push(dir)
    const kernel = new BrowserKernel()
    const service = new MultabService(new JsonStorageRepository(dir))
    kernel.use(service)
    await kernel.start()

    const meta = await service.fetchSiteMeta(baseUrl)
    expect(meta.url).toBe(`${baseUrl}/`)
    expect(meta.title).toBe('Aurellix & Ops Console')
    expect(meta.iconUrl).toBe(`${baseUrl}/assets/apple-touch-icon.png`)

    const unreachable = await service.fetchSiteMeta('http://127.0.0.1:1/unreachable')
    expect(unreachable.iconUrl).toBe('http://127.0.0.1:1/favicon.ico')

    await kernel.stop()
  })

  it('parses Chrome bookmarks.html folders cleanly and ignores non-http links', () => {
    const sampleHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><H3>书签栏</H3>
        <DL><p>
          <DT><H3>跨境电商</H3>
          <DL><p>
            <DT><A HREF="https://seller.amazon.com">Amazon Seller &amp; Ops</A>
            <DT><A HREF="javascript:alert(1)">Unsafe JS</A>
          </DL><p>
          <DT><A HREF="https://example.org">Top Link</A>
        </DL><p>
      </DL><p>`

    const entries = parseChromeBookmarksHtml(sampleHtml)
    expect(entries).toEqual([
      { folder: '跨境电商', title: 'Amazon Seller & Ops', url: 'https://seller.amazon.com' },
      { folder: '导入书签', title: 'Top Link', url: 'https://example.org' },
    ])
  })

  it('encrypts/decrypts E2E with 6-digit code and syncs tombstones cleanly via relay', async () => {
    const kv = new Map<string, unknown>()
    const server = createServer((req, res) => {
      const url = req.url || '/'
      if (req.method === 'GET' && url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, service: 'multab-sync', version: 1 }))
        return
      }
      let raw = ''
      req.on('data', (d) => {
        raw += String(d)
      })
      req.on('end', () => {
        const body = JSON.parse(raw || '{}') as { slotId?: string; envelope?: unknown }
        if (req.method === 'POST' && url === '/v1/sync/push') {
          kv.set(body.slotId!, body.envelope)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, expiresInSeconds: 300 }))
          return
        }
        if (req.method === 'POST' && url === '/v1/sync/pull') {
          if (!kv.has(body.slotId!)) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: '同步码不存在或已过期' }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, envelope: kv.get(body.slotId!) }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    closeCallbacks.push(() => new Promise((r) => server.close(() => r())))
    const relayUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

    const dirA = await mkdtemp(join(tmpdir(), 'wb-multab-a-'))
    const dirB = await mkdtemp(join(tmpdir(), 'wb-multab-b-'))
    tempDirs.push(dirA, dirB)

    const kA = new BrowserKernel()
    const svcA = new MultabService(new JsonStorageRepository(dirA))
    kA.use(svcA)
    await kA.start()

    const kB = new BrowserKernel()
    const svcB = new MultabService(new JsonStorageRepository(dirB))
    kB.use(svcB)
    await kB.start()

    const health = await svcB.testSyncRelay(relayUrl)
    expect(health.ok).toBe(true)

    // Crypto negative check
    const testCode = generateSixDigitCode()
    const env = encryptMultabPayload(testCode, svcA.getState())
    expect(() => decryptMultabPayload('999999', env)).toThrow(/同步码错误/)
    expect(deriveSyncSlotId(testCode)).toMatch(/^[a-f0-9]{64}$/)

    // Device A creates a category + item and pushes 6-digit sync code
    await svcA.saveCategory({ name: 'Synced Space', icon: 'globe' })
    const catA = svcA.getState().categories.find((c) => c.name === 'Synced Space')!
    await svcA.saveItem({ categoryId: catA.id, title: 'Sync Target', url: 'https://sync.example.com' })

    // Device A also deletes one starter item to verify tombstone sync
    await svcA.deleteItem('item_x')

    const pushed = await svcA.pushSyncCode(relayUrl)
    expect(pushed.code).toMatch(/^\d{6}$/)

    // Device B pulls with wrong code first (fails gracefully), then pulls with real code
    await expect(svcB.pullSyncCode('000001', relayUrl)).rejects.toThrow(/不存在或已过期/)

    const pulled = await svcB.pullSyncCode(pushed.code, relayUrl)
    expect(pulled.addedCategories).toBeGreaterThanOrEqual(1)
    expect(pulled.addedItems).toBeGreaterThanOrEqual(1)

    const stateB = svcB.getState()
    expect(stateB.categories.some((c) => c.name === 'Synced Space')).toBe(true)
    expect(stateB.items.some((i) => i.title === 'Sync Target' && i.url === 'https://sync.example.com/')).toBe(true)
    expect(stateB.items.some((i) => i.id === 'item_x')).toBe(false)

    await kA.stop()
    await kB.stop()
  })
})
