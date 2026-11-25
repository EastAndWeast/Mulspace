import type { WorkspaceId } from './workspace.js'

export interface InstalledExtension {
  id: string
  name: string
  version: string
  description: string
  manifestVersion: 2 | 3
  installPath: string
  popupPath?: string
  iconPath?: string
  enabledGlobally: boolean
  enabledWorkspaces: WorkspaceId[]
  disabledWorkspaces: WorkspaceId[]
  installedAt: number
}
