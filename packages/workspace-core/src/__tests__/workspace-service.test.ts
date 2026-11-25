import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserKernel } from '@wb/kernel'
import { JsonStorageRepository } from '@wb/storage'
import { WorkspaceService } from '../workspace-service.js'

const tempDirs: string[] = []

async function createService() {
  const dir = await mkdtemp(join(tmpdir(), 'wb-ws-test-'))
  tempDirs.push(dir)
  const storage = new JsonStorageRepository(dir)
  const kernel = new BrowserKernel()
  const service = new WorkspaceService(storage)
  kernel.use(service)
  await kernel.start()
  return { service, kernel }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('WorkspaceService', () => {
  it('creates isolated partitions with safe WebRTC defaults and prevents deleting last workspace', async () => {
    const { service } = await createService()
    const initial = service.list()
    expect(initial).toHaveLength(2)

    const wsA = await service.create({ name: 'Twitter 运营号 A', icon: '🐦', seedColor: '#1DA1F2' })
    const wsB = await service.create({ name: 'Twitter 运营号 B', icon: '🦉', seedColor: '#10B981' })

    expect(wsA.partition).toBe(`persist:ws-${wsA.id}`)
    expect(wsB.partition).toBe(`persist:ws-${wsB.id}`)
    expect(wsA.partition).not.toBe(wsB.partition)
    expect(wsA.isolation.webrtcPolicy).toBe('disable_non_proxied_udp')
    expect(wsA.proxy.mode).toBe('system')
    expect(wsA.agentPolicy.allowCrossWorkspaceRead).toBe(false)

    // Delete down to 1 workspace, then deleting the last one must throw
    for (const ws of service.list().slice(1)) {
      await service.delete(ws.id)
    }
    expect(service.list()).toHaveLength(1)
    await expect(service.delete(service.list()[0]!.id)).rejects.toThrow(/至少需要保留一个工作区/)
  })

  it('tracks independent active workspaces per window', async () => {
    const { service } = await createService()
    const [first, second] = service.list()
    expect(first).toBeDefined()
    expect(second).toBeDefined()

    await service.bindWindowToWorkspace('win_1', first!.id)
    await service.bindWindowToWorkspace('win_2', second!.id)

    expect(service.getActiveWorkspaceForWindow('win_1')).toBe(first!.id)
    expect(service.getActiveWorkspaceForWindow('win_2')).toBe(second!.id)
  })
})
