import { describe, expect, it } from 'vitest'
import { ThemeRegistry } from '../registry.js'

describe('ThemeRegistry & MD3 token generator', () => {
  it('includes 4 official decoupled themes and generates complete light/dark MD3 tokens', () => {
    const registry = new ThemeRegistry()
    expect(registry.list().map((t) => t.id)).toEqual([
      'material-you',
      'zen-glass',
      'vivaldi-compact',
      'obsidian-pro',
    ])

    const light = registry.resolveTokens('material-you', 'light', '#3B82F6')
    const dark = registry.resolveTokens('material-you', 'dark', '#3B82F6')

    expect(light['--wb-sys-color-primary']).toMatch(/^#[0-9a-f]{6}$/i)
    expect(dark['--wb-sys-color-surface']).not.toBe(light['--wb-sys-color-surface'])
    expect(light['--wb-sys-color-surface-container-lowest']).toBe('#ffffff')
    expect(dark['--wb-sys-color-surface-container-highest']).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('produces distinct primary tokens for different workspace seed colors and respects density', () => {
    const registry = new ThemeRegistry()
    const blue = registry.resolveTokens('material-you', 'light', '#2563EB')
    const purple = registry.resolveTokens('material-you', 'light', '#9333EA')
    const compact = registry.resolveTokens('vivaldi-compact', 'dark', '#EF4444')
    const obsidian = registry.resolveTokens('obsidian-pro', 'dark', '#6366F1')

    expect(blue['--wb-sys-color-primary']).not.toBe(purple['--wb-sys-color-primary'])
    expect(blue['--wb-sys-layout-rail-width']).toBe('62px')
    expect(compact['--wb-sys-layout-rail-width']).toBe('50px')
    expect(obsidian['--wb-sys-color-surface']).toBe('#090A0E')
  })

  it('supports JSON theme import/export and rejects malformed custom themes', () => {
    const registry = new ThemeRegistry()
    const exported = registry.exportToJson('zen-glass')
    const parsed = JSON.parse(exported) as Record<string, unknown>
    parsed.id = 'custom-mint'
    parsed.name = 'Custom Mint'
    parsed.defaultSeedColor = '#10B981'

    const imported = registry.importFromJson(JSON.stringify(parsed))
    expect(imported.id).toBe('custom-mint')
    expect(registry.list().some((t) => t.id === 'custom-mint')).toBe(true)

    expect(() => registry.importFromJson('{"name":"missing-id"}')).toThrow()
    expect(() => registry.importFromJson('{bad json')).toThrow(/语法无效/)
    expect(() =>
      registry.importFromJson('{"id":"vivaldi-compact","name":"Hijacked"}'),
    ).toThrow(/不允许覆盖内置官方主题/)

    const withInjection = registry.importFromJson(
      JSON.stringify({
        id: 'safe-custom',
        name: 'Safe Custom',
        density: 'compact',
        defaultSeedColor: '#ff0000',
        supportsDynamicWorkspaceColor: false,
        tokenOverrides: {
          light: {
            '--wb-sys-color-primary': '#ff0000',
            display: 'none',
            '--wb-evil': 'red; color: blue',
          },
          dark: {
            '--wb-sys-color-primary': '#ff0000',
          },
        },
      }),
    )
    expect(withInjection.tokenOverrides).toEqual({
      light: { '--wb-sys-color-primary': '#ff0000' },
      dark: { '--wb-sys-color-primary': '#ff0000' },
    })
    const customTokens = registry.resolveManifestTokens(withInjection, 'light', '#0000ff')
    expect(customTokens['--wb-sys-color-primary']).toBe('#ff0000')
    expect(customTokens['--wb-sys-layout-rail-width']).toBe('50px')

    expect(registry.remove('material-you')).toBe(false)
    expect(registry.remove('custom-mint')).toBe(true)
    expect(registry.remove('safe-custom')).toBe(true)
  })
})
