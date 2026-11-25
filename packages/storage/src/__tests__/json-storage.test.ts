import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonStorageRepository, type StorageSecretCipher } from '../json-storage.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-storage-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

describe('JsonStorageRepository', () => {
  it('seeds two isolated starter workspaces on first load and persists changes atomically', async () => {
    const dir = await createTempDir()
    const repo1 = new JsonStorageRepository(dir)
    const initial = await repo1.loadState()

    expect(initial.workspaces).toHaveLength(2)
    expect(initial.workspaces[0]?.partition).not.toBe(initial.workspaces[1]?.partition)

    const customWs = {
      ...initial.workspaces[0]!,
      id: 'ws_custom',
      name: '跨境店铺 A',
      partition: 'persist:ws-ws_custom',
    }
    await repo1.saveWorkspace(customWs)
    await repo1.saveTabsForWorkspace('ws_custom', [
      {
        id: 't_1',
        workspaceId: 'ws_custom',
        url: 'https://example.com',
        title: 'Example',
        state: 'discarded',
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
    ])

    const repo2 = new JsonStorageRepository(dir)
    const reloaded = await repo2.loadState()
    expect(reloaded.workspaces.map((w) => w.id)).toContain('ws_custom')
    expect(reloaded.tabsByWorkspace['ws_custom']).toHaveLength(1)

    await repo2.deleteWorkspace('ws_custom')
    const afterDelete = await new JsonStorageRepository(dir).loadState()
    expect(afterDelete.workspaces.map((w) => w.id)).not.toContain('ws_custom')
    expect(afterDelete.tabsByWorkspace['ws_custom']).toBeUndefined()
  })

  it('encrypts sensitive credentials on disk with 0600 permissions when cipher is provided', async () => {
    const dir = await createTempDir()
    const mockCipher: StorageSecretCipher = {
      encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
      decrypt: (ct) => Buffer.from(ct, 'base64').toString('utf8'),
    }
    const repo = new JsonStorageRepository(dir, 'browser-state.json', mockCipher)
    const state = await repo.loadState()
    const ws = state.workspaces[0]!
    await repo.saveWorkspace({
      ...ws,
      proxy: { mode: 'custom', customUrl: 'http://user_a:secret_pw@127.0.0.1:8888' },
    })

    const diskRaw = await readFile(join(dir, 'browser-state.json'), 'utf8')
    expect(diskRaw).not.toContain('secret_pw')
    expect(diskRaw).toContain('enc:v1:')
    const st = await stat(join(dir, 'browser-state.json'))
    expect(st.mode & 0o777).toBe(0o600)

    const reloaded = await new JsonStorageRepository(dir, 'browser-state.json', mockCipher).loadState()
    expect(reloaded.workspaces[0]?.proxy.customUrl).toBe('http://user_a:secret_pw@127.0.0.1:8888')
  })
})
