export type UpdateStatusKind = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error'

export interface UpdateAsset {
  name: string
  downloadUrl: string
  sizeBytes: number
}

export interface UpdateState {
  status: UpdateStatusKind
  currentVersion: string
  latestVersion: string | null
  releaseName?: string
  releaseNotes?: string
  releaseUrl?: string
  matchedAsset?: UpdateAsset | null
  publishedAt?: string
  checkedAt?: number
  error?: string
  repoSlug: string
}
