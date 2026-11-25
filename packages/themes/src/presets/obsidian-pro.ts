import type { ThemeManifest } from '@wb/contracts'

export const obsidianProTheme: ThemeManifest = {
  id: 'obsidian-pro',
  name: 'Obsidian Pro',
  description: 'OLED 深黑高对比度极客风，长时间多号盯盘与 AI 自动化编排护眼首选',
  author: 'WorkspaceBrowser Core',
  defaultMode: 'dark',
  defaultSeedColor: '#6366F1',
  density: 'compact',
  supportsDynamicWorkspaceColor: true,
  tokenOverrides: {
    dark: {
      '--wb-sys-color-background': '#07080A',
      '--wb-sys-color-surface': '#090A0E',
      '--wb-sys-color-surface-container-lowest': '#050608',
      '--wb-sys-color-surface-container-low': '#0F1117',
      '--wb-sys-color-surface-container': '#161922',
      '--wb-sys-color-surface-container-high': '#1E222E',
      '--wb-sys-color-surface-container-highest': '#282D3D',
      '--wb-sys-color-outline-variant': '#2A2F3E',
    },
  },
}
