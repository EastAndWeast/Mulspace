import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { BrowserKernel } from '@wb/kernel'
import { JsonStorageRepository } from '@wb/storage'
import { WorkspaceService } from '@wb/workspace-core'
import {
  assertSafeArchiveRelativePath,
  ExtensionService,
  readExtensionManifest,
  unpackCrxBuffer,
} from '../index.js'

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'wb-ext-test-'))
  tempDirs.push(dir)
  return dir
}

function buildSyntheticCrx3(files: Record<string, string>): Buffer {
  const zipData = zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  )
  const fakeHeader = Buffer.from('mock-crx3-proto-header')
  const prefix = Buffer.alloc(12)
  prefix.write('Cr24', 0, 'ascii')
  prefix.writeUInt32LE(3, 4)
  prefix.writeUInt32LE(fakeHeader.length, 8)
  return Buffer.concat([prefix, fakeHeader, Buffer.from(zipData)])
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('extension-host', () => {
  it('unpacks CRX3 archives safely and rejects Zip Slip traversal paths', async () => {
    expect(() => assertSafeArchiveRelativePath('../../etc/passwd')).toThrow(/Zip Slip/)
    expect(() => assertSafeArchiveRelativePath('/abs/path')).toThrow(/不安全/)

    const dir = await makeTempDir()
    const crx = buildSyntheticCrx3({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'Cookie Helper',
        version: '1.2.0',
        description: 'MV3 test extension',
        action: { default_popup: 'popup.html' },
      }),
      'popup.html': '<h1>Popup</h1>',
    })

    await unpackCrxBuffer(crx, dir)
    const manifest = await readExtensionManifest(dir)
    expect(manifest).toMatchObject({
      name: 'Cookie Helper',
      version: '1.2.0',
      manifestVersion: 3,
      popupPath: 'popup.html',
    })
    expect(await readFile(join(dir, 'popup.html'), 'utf8')).toBe('<h1>Popup</h1>')
  })

  it('installs extensions and isolates enable/disable per workspace partition', async () => {
    const dir = await makeTempDir()
    const sampleExtDir = join(dir, 'sample-ext')
    await mkdir(sampleExtDir, { recursive: true })
    await writeFile(
      join(sampleExtDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Workspace Ext',
        version: '0.1.0',
        action: { default_popup: 'index.html' },
      }),
    )

    const storage = new JsonStorageRepository(join(dir, 'data'))
    const kernel = new BrowserKernel()
    const wsService = new WorkspaceService(storage)

    const loadedByPartition = new Map<string, Set<string>>()
    let seq = 0
    const extService = new ExtensionService(storage, {
      extensionsDir: join(dir, 'extensions'),
      getWorkspaces: () => wsService.list(),
      adapter: {
        loadIntoSession(partition) {
          const id = `chrome_ext_${++seq}`
          const set = loadedByPartition.get(partition) ?? new Set<string>()
          set.add(id)
          loadedByPartition.set(partition, set)
          return id
        },
        removeFromSession(partition, runtimeId) {
          loadedByPartition.get(partition)?.delete(runtimeId)
        },
      },
    })

    kernel.use(wsService).use(extService)
    await kernel.start()

    const [ws1, ws2] = wsService.list()
    const installed = await extService.installFromFolder(sampleExtDir)

    // Initially loaded in both workspaces
    expect(loadedByPartition.get(ws1!.partition)?.size).toBe(1)
    expect(loadedByPartition.get(ws2!.partition)?.size).toBe(1)

    // Disable only in workspace 2
    await extService.toggleForWorkspace(installed.id, ws2!.id, false)
    expect(loadedByPartition.get(ws1!.partition)?.size).toBe(1)
    expect(loadedByPartition.get(ws2!.partition)?.size).toBe(0)

    await kernel.stop()
  })
})
