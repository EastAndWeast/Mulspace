import type { ThemeManifest } from '@wb/contracts'

export const zenGlassTheme: ThemeManifest = {
  id: 'zen-glass',
  name: 'Zen Glass',
  description: '冷色界面，更柔和的圆角。',
  author: 'WorkspaceBrowser Core',
  defaultMode: 'light',
  defaultSeedColor: '#0EA5E9',
  density: 'comfortable',
  supportsDynamicWorkspaceColor: true,
  tokenOverrides: {
    light: {
      '--wb-sys-radius-md': '16px',
      '--wb-sys-radius-lg': '24px',
      '--wb-sys-color-surface': '#F7FAFC',
      '--wb-sys-color-surface-container-low': '#F0F5FA',
      '--wb-sys-color-surface-container': '#E6EEF6',
    },
    dark: {
      '--wb-sys-radius-md': '16px',
      '--wb-sys-radius-lg': '24px',
      '--wb-sys-color-surface': '#10151C',
      '--wb-sys-color-surface-container-low': '#151C26',
      '--wb-sys-color-surface-container': '#1B2430',
    },
  },
}
