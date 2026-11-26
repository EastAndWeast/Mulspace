import type { TabId, WorkspaceId } from './workspace.js'

export const NEW_TAB_URL = 'about:blank#mulspace-new-tab'

export type TabLifecycleState = 'active' | 'frozen' | 'discarded'

export interface TabSnapshot {
  url: string
  title: string
  faviconUrl?: string
  scrollX?: number
  scrollY?: number
  capturedAt: number
}

export interface Tab {
  id: TabId
  workspaceId: WorkspaceId
  url: string
  title: string
  faviconUrl?: string
  state: TabLifecycleState
  pinned: boolean
  muted: boolean
  audible: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  aiBusy: boolean
  lockedFromDiscard: boolean
  lastActiveAt: number
  snapshot?: TabSnapshot
}

export interface CreateTabInput {
  workspaceId: WorkspaceId
  url?: string
  title?: string
  pinned?: boolean
  activate?: boolean
}

export interface TabMemorySummary {
  totalTabs: number
  activeTabs: number
  frozenTabs: number
  discardedTabs: number
  byWorkspace: Record<
    WorkspaceId,
    {
      total: number
      active: number
      frozen: number
      discarded: number
    }
  >
}
