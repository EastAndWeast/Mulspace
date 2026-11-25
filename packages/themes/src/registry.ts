import type { ResolvedThemeScheme, ThemeManifest, ThemeTokens } from '@wb/contracts'
import { generateMd3Tokens } from './md3-generator.js'
import { materialYouTheme } from './presets/material-you.js'
import { obsidianProTheme } from './presets/obsidian-pro.js'
import { vivaldiCompactTheme } from './presets/vivaldi-compact.js'
import { zenGlassTheme } from './presets/zen-glass.js'

export const OFFICIAL_THEMES: ThemeManifest[] = [
  materialYouTheme,
  zenGlassTheme,
  vivaldiCompactTheme,
  obsidianProTheme,
]

export function validateThemeManifest(raw: unknown): ThemeManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('主题 JSON 格式无效')
  }
  const obj = raw as Record<string, unknown>
  const id = String(obj.id ?? '').trim()
  const name = String(obj.name ?? '').trim()
  if (!id || !name) {
    throw new Error('主题清单必须包含 id 和 name 字段')
  }
  const density = obj.density === 'compact' ? 'compact' : 'comfortable'
  const defaultMode =
    obj.defaultMode === 'light' || obj.defaultMode === 'dark' || obj.defaultMode === 'system'
      ? obj.defaultMode
      : 'system'
  const defaultSeedColor =
    typeof obj.defaultSeedColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(obj.defaultSeedColor)
      ? obj.defaultSeedColor
      : '#3B82F6'

  return {
    id,
    name,
    description: String(obj.description ?? ''),
    author: String(obj.author ?? 'Custom'),
    defaultMode,
    defaultSeedColor,
    density,
    supportsDynamicWorkspaceColor: obj.supportsDynamicWorkspaceColor !== false,
    tokenOverrides:
      obj.tokenOverrides && typeof obj.tokenOverrides === 'object'
        ? (obj.tokenOverrides as ThemeManifest['tokenOverrides'])
        : undefined,
  }
}

export class ThemeRegistry {
  private readonly themes = new Map<string, ThemeManifest>()

  constructor(presets: ThemeManifest[] = OFFICIAL_THEMES) {
    for (const preset of presets) {
      this.register(preset)
    }
  }

  register(manifest: ThemeManifest): void {
    this.themes.set(manifest.id, manifest)
  }

  loadCustomThemes(customThemes: ThemeManifest[]): void {
    for (const id of [...this.themes.keys()]) {
      if (!OFFICIAL_THEMES.some((o) => o.id === id)) {
        this.themes.delete(id)
      }
    }
    for (const t of customThemes) {
      this.register(t)
    }
  }

  importFromJson(jsonText: string): ThemeManifest {
    const parsed = JSON.parse(jsonText) as unknown
    const manifest = validateThemeManifest(parsed)
    this.register(manifest)
    return manifest
  }

  exportToJson(themeId: string): string {
    return JSON.stringify(this.get(themeId), null, 2)
  }

  remove(themeId: string): boolean {
    if (OFFICIAL_THEMES.some((o) => o.id === themeId)) {
      return false
    }
    return this.themes.delete(themeId)
  }

  list(): ThemeManifest[] {
    return [...this.themes.values()]
  }

  get(themeId: string): ThemeManifest {
    return this.themes.get(themeId) ?? materialYouTheme
  }

  resolveTokens(
    themeId: string,
    scheme: ResolvedThemeScheme,
    seedColorOverride?: string,
  ): ThemeTokens {
    const manifest = this.get(themeId)
    const effectiveSeed =
      manifest.supportsDynamicWorkspaceColor && seedColorOverride
        ? seedColorOverride
        : manifest.defaultSeedColor
    return generateMd3Tokens(effectiveSeed, scheme, manifest.density, manifest.tokenOverrides)
  }

  tokensToCssText(tokens: ThemeTokens, selector = ':root'): string {
    const entries = Object.entries(tokens)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n')
    return `${selector} {\n${entries}\n}`
  }
}

export const defaultThemeRegistry = new ThemeRegistry()
