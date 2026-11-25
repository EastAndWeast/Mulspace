import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities'
import type { ResolvedThemeScheme, ThemeDensity, ThemeManifest, ThemeTokens } from '@wb/contracts'

const DENSITY_TOKENS: Record<
  ThemeDensity,
  Pick<
    ThemeTokens,
    | '--wb-sys-radius-xs'
    | '--wb-sys-radius-sm'
    | '--wb-sys-radius-md'
    | '--wb-sys-radius-lg'
    | '--wb-sys-radius-full'
    | '--wb-sys-spacing-xs'
    | '--wb-sys-spacing-sm'
    | '--wb-sys-spacing-md'
    | '--wb-sys-spacing-lg'
    | '--wb-sys-layout-rail-width'
    | '--wb-sys-layout-tabbar-height'
    | '--wb-sys-layout-toolbar-height'
    | '--wb-sys-layout-sidebar-width'
  >
> = {
  comfortable: {
    '--wb-sys-radius-xs': '6px',
    '--wb-sys-radius-sm': '10px',
    '--wb-sys-radius-md': '14px',
    '--wb-sys-radius-lg': '20px',
    '--wb-sys-radius-full': '9999px',
    '--wb-sys-spacing-xs': '4px',
    '--wb-sys-spacing-sm': '8px',
    '--wb-sys-spacing-md': '12px',
    '--wb-sys-spacing-lg': '20px',
    '--wb-sys-layout-rail-width': '62px',
    '--wb-sys-layout-tabbar-height': '40px',
    '--wb-sys-layout-toolbar-height': '46px',
    '--wb-sys-layout-sidebar-width': '340px',
  },
  compact: {
    '--wb-sys-radius-xs': '4px',
    '--wb-sys-radius-sm': '6px',
    '--wb-sys-radius-md': '8px',
    '--wb-sys-radius-lg': '12px',
    '--wb-sys-radius-full': '9999px',
    '--wb-sys-spacing-xs': '3px',
    '--wb-sys-spacing-sm': '6px',
    '--wb-sys-spacing-md': '10px',
    '--wb-sys-spacing-lg': '16px',
    '--wb-sys-layout-rail-width': '50px',
    '--wb-sys-layout-tabbar-height': '34px',
    '--wb-sys-layout-toolbar-height': '40px',
    '--wb-sys-layout-sidebar-width': '320px',
  },
}

const FONT_TOKENS: Pick<ThemeTokens, '--wb-sys-font-sans' | '--wb-sys-font-mono'> = {
  '--wb-sys-font-sans':
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  '--wb-sys-font-mono': "'SF Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
}

function normalizeSeedHex(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#3B82F6'
}

export function generateMd3Tokens(
  seedHex: string,
  scheme: ResolvedThemeScheme,
  density: ThemeDensity,
  manifestOverrides?: ThemeManifest['tokenOverrides'],
): ThemeTokens {
  const mdTheme = themeFromSourceColor(argbFromHex(normalizeSeedHex(seedHex)))
  const palette = scheme === 'dark' ? mdTheme.schemes.dark : mdTheme.schemes.light
  const neutral = mdTheme.palettes.neutral

  const surfaceTones =
    scheme === 'dark'
      ? {
          surface: neutral.tone(6),
          lowest: neutral.tone(4),
          low: neutral.tone(10),
          base: neutral.tone(12),
          high: neutral.tone(17),
          highest: neutral.tone(22),
        }
      : {
          surface: neutral.tone(98),
          lowest: neutral.tone(100),
          low: neutral.tone(96),
          base: neutral.tone(94),
          high: neutral.tone(92),
          highest: neutral.tone(90),
        }

  const baseTokens: ThemeTokens = {
    '--wb-sys-color-primary': hexFromArgb(palette.primary),
    '--wb-sys-color-on-primary': hexFromArgb(palette.onPrimary),
    '--wb-sys-color-primary-container': hexFromArgb(palette.primaryContainer),
    '--wb-sys-color-on-primary-container': hexFromArgb(palette.onPrimaryContainer),
    '--wb-sys-color-secondary': hexFromArgb(palette.secondary),
    '--wb-sys-color-on-secondary': hexFromArgb(palette.onSecondary),
    '--wb-sys-color-secondary-container': hexFromArgb(palette.secondaryContainer),
    '--wb-sys-color-on-secondary-container': hexFromArgb(palette.onSecondaryContainer),
    '--wb-sys-color-tertiary': hexFromArgb(palette.tertiary),
    '--wb-sys-color-on-tertiary': hexFromArgb(palette.onTertiary),
    '--wb-sys-color-error': hexFromArgb(palette.error),
    '--wb-sys-color-on-error': hexFromArgb(palette.onError),
    '--wb-sys-color-error-container': hexFromArgb(palette.errorContainer),
    '--wb-sys-color-on-error-container': hexFromArgb(palette.onErrorContainer),
    '--wb-sys-color-background': hexFromArgb(palette.background),
    '--wb-sys-color-on-background': hexFromArgb(palette.onBackground),
    '--wb-sys-color-surface': hexFromArgb(surfaceTones.surface),
    '--wb-sys-color-on-surface': hexFromArgb(palette.onSurface),
    '--wb-sys-color-on-surface-variant': hexFromArgb(palette.onSurfaceVariant),
    '--wb-sys-color-surface-container-lowest': hexFromArgb(surfaceTones.lowest),
    '--wb-sys-color-surface-container-low': hexFromArgb(surfaceTones.low),
    '--wb-sys-color-surface-container': hexFromArgb(surfaceTones.base),
    '--wb-sys-color-surface-container-high': hexFromArgb(surfaceTones.high),
    '--wb-sys-color-surface-container-highest': hexFromArgb(surfaceTones.highest),
    '--wb-sys-color-outline': hexFromArgb(palette.outline),
    '--wb-sys-color-outline-variant': hexFromArgb(palette.outlineVariant),
    ...DENSITY_TOKENS[density],
    ...FONT_TOKENS,
  }

  const overrides = manifestOverrides?.[scheme]
  return overrides ? { ...baseTokens, ...overrides } : baseTokens
}
