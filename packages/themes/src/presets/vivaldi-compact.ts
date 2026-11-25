import type { ThemeManifest } from '@wb/contracts'

export const vivaldiCompactTheme: ThemeManifest = {
  id: 'vivaldi-compact',
  name: 'Vivaldi Compact',
  description: '高信息密度效率主题，紧凑边栏与锐利边角，适合同时管理大量账号工作区',
  author: 'WorkspaceBrowser Core',
  defaultMode: 'dark',
  defaultSeedColor: '#EF4444',
  density: 'compact',
  supportsDynamicWorkspaceColor: true,
  tokenOverrides: {
    dark: {
      '--wb-sys-color-surface': '#111317',
      '--wb-sys-color-surface-container-low': '#171A21',
      '--wb-sys-color-surface-container': '#1E222B',
      '--wb-sys-color-surface-container-high': '#262B36',
    },
    light: {
      '--wb-sys-color-surface': '#F4F5F7',
      '--wb-sys-color-surface-container': '#E9ECEF',
    },
  },
}
