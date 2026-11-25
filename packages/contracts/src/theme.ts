export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedThemeScheme = 'light' | 'dark'
export type ThemeDensity = 'comfortable' | 'compact'

export interface ThemeTokens {
  '--wb-sys-color-primary': string
  '--wb-sys-color-on-primary': string
  '--wb-sys-color-primary-container': string
  '--wb-sys-color-on-primary-container': string
  '--wb-sys-color-secondary': string
  '--wb-sys-color-on-secondary': string
  '--wb-sys-color-secondary-container': string
  '--wb-sys-color-on-secondary-container': string
  '--wb-sys-color-tertiary': string
  '--wb-sys-color-on-tertiary': string
  '--wb-sys-color-error': string
  '--wb-sys-color-on-error': string
  '--wb-sys-color-error-container': string
  '--wb-sys-color-on-error-container': string
  '--wb-sys-color-background': string
  '--wb-sys-color-on-background': string
  '--wb-sys-color-surface': string
  '--wb-sys-color-on-surface': string
  '--wb-sys-color-on-surface-variant': string
  '--wb-sys-color-surface-container-lowest': string
  '--wb-sys-color-surface-container-low': string
  '--wb-sys-color-surface-container': string
  '--wb-sys-color-surface-container-high': string
  '--wb-sys-color-surface-container-highest': string
  '--wb-sys-color-outline': string
  '--wb-sys-color-outline-variant': string
  '--wb-sys-radius-xs': string
  '--wb-sys-radius-sm': string
  '--wb-sys-radius-md': string
  '--wb-sys-radius-lg': string
  '--wb-sys-radius-full': string
  '--wb-sys-spacing-xs': string
  '--wb-sys-spacing-sm': string
  '--wb-sys-spacing-md': string
  '--wb-sys-spacing-lg': string
  '--wb-sys-font-sans': string
  '--wb-sys-font-mono': string
  '--wb-sys-layout-rail-width': string
  '--wb-sys-layout-tabbar-height': string
  '--wb-sys-layout-toolbar-height': string
  '--wb-sys-layout-sidebar-width': string
}

export interface ThemeManifest {
  id: string
  name: string
  description: string
  author: string
  defaultMode: ThemeMode
  defaultSeedColor: string
  density: ThemeDensity
  supportsDynamicWorkspaceColor: boolean
  tokenOverrides?: Partial<Record<ResolvedThemeScheme, Partial<ThemeTokens>>>
}
