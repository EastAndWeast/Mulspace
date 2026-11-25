import { describe, expect, it } from 'vitest'
import { BrowserKernel } from '@wb/kernel'
import { isNewerVersion, matchReleaseAsset, UpdateService } from '../index.js'

describe('updater', () => {
  it('compares semantic versions accurately', () => {
    expect(isNewerVersion('0.1.0', 'v0.1.1')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(true)
    expect(isNewerVersion('0.1.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('0.2.0', '0.1.9')).toBe(false)
    expect(isNewerVersion('0.1.0', 'v0.1.0')).toBe(false)
    expect(isNewerVersion('0.1.0-beta.1', '0.1.0')).toBe(true)
  })

  it('matches platform and architecture installer assets cleanly', () => {
    const assets = [
      { name: 'Mulspace-0.2.0-mac-arm64.dmg', downloadUrl: 'https://example.com/mac-arm64.dmg', sizeBytes: 100 },
      { name: 'Mulspace-0.2.0-mac-x64.dmg', downloadUrl: 'https://example.com/mac-x64.dmg', sizeBytes: 100 },
      { name: 'Mulspace-0.2.0-win-x64.exe', downloadUrl: 'https://example.com/win.exe', sizeBytes: 100 },
    ]

    expect(matchReleaseAsset(assets, 'darwin', 'arm64')?.name).toBe('Mulspace-0.2.0-mac-arm64.dmg')
    expect(matchReleaseAsset(assets, 'darwin', 'x64')?.name).toBe('Mulspace-0.2.0-mac-x64.dmg')
    expect(matchReleaseAsset(assets, 'win32', 'x64')?.name).toBe('Mulspace-0.2.0-win-x64.exe')
  })

  it('detects new GitHub releases, 404 empty releases, and errors gracefully', async () => {
    const kernel = new BrowserKernel()
    let mode: 'available' | '404' | 'fail' = 'available'

    const service = new UpdateService({
      currentVersion: '0.1.0',
      repoSlug: 'EastAndWeast/Mulspace',
      disableScheduler: true,
      platform: 'darwin',
      arch: 'arm64',
      fetchFn: (async () => {
        if (mode === 'fail') throw new Error('network down')
        if (mode === '404') return new Response('{}', { status: 404 })
        return new Response(
          JSON.stringify({
            tag_name: 'v0.2.0',
            name: 'Mulspace v0.2.0',
            body: '新增更多功能',
            html_url: 'https://github.com/EastAndWeast/Mulspace/releases/tag/v0.2.0',
            assets: [
              {
                name: 'Mulspace-0.2.0-mac-arm64.dmg',
                browser_download_url: 'https://github.com/EastAndWeast/Mulspace/releases/download/v0.2.0/Mulspace-0.2.0-mac-arm64.dmg',
                size: 123456,
              },
            ],
          }),
          { status: 200 },
        )
      }) as typeof fetch,
    })

    kernel.use(service)
    await kernel.start()

    const available = await service.checkForUpdates()
    expect(available.status).toBe('available')
    expect(available.latestVersion).toBe('0.2.0')
    expect(available.matchedAsset?.name).toBe('Mulspace-0.2.0-mac-arm64.dmg')

    mode = '404'
    const none = await service.checkForUpdates()
    expect(none.status).toBe('up-to-date')

    mode = 'fail'
    const err = await service.checkForUpdates()
    expect(err.status).toBe('error')
    expect(err.error).toContain('network down')

    await kernel.stop()
  })
})
