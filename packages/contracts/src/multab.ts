export type MultabSearchEngineId = 'bing' | 'google' | 'baidu' | 'github'
export type MultabViewMode = 'icons' | 'cards'

export interface MultabCategory {
  id: string
  name: string
  icon: string
  order: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface MultabItem {
  id: string
  categoryId: string
  title: string
  url: string
  iconUrl?: string
  iconBg?: string
  pinned?: boolean
  order: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface MultabState {
  schemaVersion: 1
  searchEngine: MultabSearchEngineId
  viewMode?: MultabViewMode
  widgetsHidden?: boolean
  wallpaperEnabled?: boolean
  notes?: string
  syncRelayUrl?: string
  lastSyncedAt?: number
  categories: MultabCategory[]
  items: MultabItem[]
}

export interface SaveMultabCategoryInput {
  id?: string
  name: string
  icon?: string
}

export interface SaveMultabItemInput {
  id?: string
  categoryId: string
  title: string
  url: string
  iconUrl?: string
  iconBg?: string
  pinned?: boolean
}

export interface MultabPrefsPatch {
  searchEngine?: MultabSearchEngineId
  viewMode?: MultabViewMode
  widgetsHidden?: boolean
  wallpaperEnabled?: boolean
  notes?: string
  syncRelayUrl?: string
}

export interface MultabSiteMetadata {
  url: string
  title?: string
  iconUrl?: string
}

export interface MultabSyncPushResult {
  code: string
  expiresAt: number
  categoryCount: number
  itemCount: number
}

export interface MultabSyncPullResult {
  addedCategories: number
  updatedCategories: number
  addedItems: number
  updatedItems: number
  state: MultabState
}

export interface MultabImportResult {
  addedCategories: number
  addedItems: number
  state: MultabState
}
