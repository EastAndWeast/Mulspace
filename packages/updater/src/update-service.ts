import {
  createServiceToken,
  type IKernelContext,
  type IKernelModule,
  type UpdateAsset,
  type UpdateState,
} from '@wb/contracts'
import { matchReleaseAsset } from './asset-matcher.js'
import { isNewerVersion } from './semver.js'

export const UpdateServiceToken = createServiceToken<UpdateService>('UpdateService')

export const DEFAULT_GITHUB_REPO = 'EastAndWeast/Mulspace'

interface GitHubReleasePayload {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  assets?: Array<{
    name?: string
    browser_download_url?: string
    size?: number
  }>
}

export interface UpdateServiceOptions {
  currentVersion: string
  repoSlug?: string
  getAutoCheckEnabled?: () => boolean
  disableScheduler?: boolean
  fetchFn?: typeof fetch
  platform?: NodeJS.Platform
  arch?: string
}

export class UpdateService implements IKernelModule {
  readonly id = 'updater'

  private ctx?: IKernelContext
  private readonly repoSlug: string
  private readonly fetchFn: typeof fetch
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private state: UpdateState

  constructor(private readonly options: UpdateServiceOptions) {
    this.repoSlug = options.repoSlug ?? DEFAULT_GITHUB_REPO
    this.fetchFn = options.fetchFn ?? fetch
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.state = {
      status: 'idle',
      currentVersion: options.currentVersion,
      latestVersion: null,
      releaseUrl: `https://github.com/${this.repoSlug}/releases`,
      repoSlug: this.repoSlug,
    }
  }

  init(ctx: IKernelContext): void {
    this.ctx = ctx
    ctx.services.register(UpdateServiceToken, this)

    if (!this.options.disableScheduler) {
      this.startupTimer = setTimeout(() => {
        if (this.options.getAutoCheckEnabled?.() ?? true) {
          void this.checkForUpdates()
        }
      }, 8_000)

      this.intervalTimer = setInterval(() => {
        if (this.options.getAutoCheckEnabled?.() ?? true) {
          void this.checkForUpdates()
        }
      }, 6 * 60 * 60 * 1000)
    }
  }

  dispose(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
  }

  getState(): UpdateState {
    return structuredClone(this.state)
  }

  async checkForUpdates(): Promise<UpdateState> {
    this.setState({
      ...this.state,
      status: 'checking',
      error: undefined,
    })

    const apiUrl = `https://api.github.com/repos/${this.repoSlug}/releases/latest`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)

    try {
      const res = await this.fetchFn(apiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Mulspace/${this.options.currentVersion}`,
        },
        signal: controller.signal,
      })

      if (res.status === 404) {
        this.setState({
          status: 'up-to-date',
          currentVersion: this.options.currentVersion,
          latestVersion: this.options.currentVersion,
          releaseUrl: `https://github.com/${this.repoSlug}/releases`,
          matchedAsset: null,
          checkedAt: Date.now(),
          repoSlug: this.repoSlug,
        })
        return this.getState()
      }

      if (!res.ok) {
        throw new Error(`GitHub Releases 查询失败 (HTTP ${res.status})`)
      }

      const payload = (await res.json()) as GitHubReleasePayload
      const latestRaw = (payload.tag_name ?? '').replace(/^v/i, '') || this.options.currentVersion
      const assets: UpdateAsset[] = (payload.assets ?? [])
        .filter((a) => a.name && a.browser_download_url)
        .map((a) => ({
          name: a.name!,
          downloadUrl: a.browser_download_url!,
          sizeBytes: a.size ?? 0,
        }))

      const hasUpdate = isNewerVersion(this.options.currentVersion, latestRaw)
      const matchedAsset = hasUpdate ? matchReleaseAsset(assets, this.platform, this.arch) : null

      this.setState({
        status: hasUpdate ? 'available' : 'up-to-date',
        currentVersion: this.options.currentVersion,
        latestVersion: latestRaw,
        releaseName: payload.name ?? `v${latestRaw}`,
        releaseNotes: payload.body?.slice(0, 1500),
        releaseUrl: payload.html_url ?? `https://github.com/${this.repoSlug}/releases`,
        matchedAsset,
        publishedAt: payload.published_at,
        checkedAt: Date.now(),
        repoSlug: this.repoSlug,
      })
    } catch (err) {
      this.setState({
        ...this.state,
        status: 'error',
        checkedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      clearTimeout(timeout)
    }

    return this.getState()
  }

  private setState(next: UpdateState): void {
    this.state = next
    this.ctx?.events.emit('update:state-changed', { state: structuredClone(this.state) })
  }
}
