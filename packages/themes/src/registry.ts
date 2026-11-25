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

function sanitizeSchemeOverrides(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^--wb-[a-z0-9-]+$/i.test(key)) continue
    if (typeof val !== 'string') continue
    const trimmed = val.trim()
    if (!trimmed || trimmed.length > 120) continue
    if (/[;{}]|url\s*\(|expression\s*\(/i.test(trimmed)) continue
    out[key] = trimmed
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeTokenOverrides(raw: unknown): ThemeManifest['tokenOverrides'] {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const light = sanitizeSchemeOverrides(rec.light)
  const dark = sanitizeSchemeOverrides(rec.dark)
  if (!light && !dark) return undefined
  const out: NonNullable<ThemeManifest['tokenOverrides']> = {}
  if (light) out.light = light as NonNullable<ThemeManifest['tokenOverrides']>['light']
  if (dark) out.dark = dark as NonNullable<ThemeManifest['tokenOverrides']>['dark']
  return out
}

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
    tokenOverrides: sanitizeTokenOverrides(obj.tokenOverrides),
  }
}

export function resolveThemeTokensFromManifest(
  manifest: ThemeManifest,
  scheme: ResolvedThemeScheme,
  seedColorOverride?: string,
): ThemeTokens {
  const effectiveSeed =
    manifest.supportsDynamicWorkspaceColor && seedColorOverride
      ? seedColorOverride
      : manifest.defaultSeedColor
  const sanitizedOverrides = sanitizeTokenOverrides(manifest.tokenOverrides)
  return generateMd3Tokens(effectiveSeed, scheme, manifest.density, sanitizedOverrides)
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
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText) as unknown
    } catch {
      throw new Error('主题 JSON 语法无效，请检查格式后重试')
    }
    const manifest = validateThemeManifest(parsed)
    if (OFFICIAL_THEMES.some((o) => o.id === manifest.id)) {
      throw new Error(`不允许覆盖内置官方主题 "${manifest.id}"，请修改 id 后重新导入`)
    }
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

  resolveManifestTokens(
    manifest: ThemeManifest,
    scheme: ResolvedThemeScheme,
    seedColorOverride?: string,
  ): ThemeTokens {
    return resolveThemeTokensFromManifest(manifest, scheme, seedColorOverride)
  }

  resolveTokens(
    themeId: string,
    scheme: ResolvedThemeScheme,
    seedColorOverride?: string,
  ): ThemeTokens {
    return resolveThemeTokensFromManifest(this.get(themeId), scheme, seedColorOverride)
  }

  tokensToCssText(tokens: ThemeTokens, selector = ':root'): string {
    const entries = Object.entries(tokens)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n')
    return `${selector} {\n${entries}\n}`
  }
}

export const defaultThemeRegistry = new ThemeRegistry()
