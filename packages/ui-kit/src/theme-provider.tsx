import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ResolvedThemeScheme, ThemeManifest, ThemeMode, ThemeTokens } from '@wb/contracts'
import { defaultThemeRegistry, resolveThemeTokensFromManifest } from '@wb/themes'

export interface ThemeProviderProps {
  themeId: string
  mode: ThemeMode
  themes?: ThemeManifest[]
  seedColorOverride?: string
  children: ReactNode
}

const TOKEN_CACHE_MAX = 32
const resolvedTokensCache = new Map<string, ThemeTokens>()

function buildManifestSignature(manifest: ThemeManifest): string {
  const overridesKey = manifest.tokenOverrides ? JSON.stringify(manifest.tokenOverrides) : ''
  return `${manifest.id}|${manifest.density}|${manifest.defaultSeedColor}|${manifest.supportsDynamicWorkspaceColor ? 1 : 0}|${overridesKey}`
}

function getCachedResolvedTokens(
  manifest: ThemeManifest,
  manifestSig: string,
  scheme: ResolvedThemeScheme,
  seedColorOverride?: string,
): ThemeTokens {
  const effectiveSeed = manifest.supportsDynamicWorkspaceColor ? (seedColorOverride ?? '') : ''
  const cacheKey = `${manifestSig}::${scheme}::${effectiveSeed}`
  const hit = resolvedTokensCache.get(cacheKey)
  if (hit) return hit

  const computed = resolveThemeTokensFromManifest(manifest, scheme, seedColorOverride)
  if (resolvedTokensCache.size >= TOKEN_CACHE_MAX) {
    const oldestKey = resolvedTokensCache.keys().next().value
    if (oldestKey !== undefined) {
      resolvedTokensCache.delete(oldestKey)
    }
  }
  resolvedTokensCache.set(cacheKey, computed)
  return computed
}

function getSystemScheme(): ResolvedThemeScheme {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function ThemeProvider({ themeId, mode, themes, seedColorOverride, children }: ThemeProviderProps) {
  const [systemScheme, setSystemScheme] = useState<ResolvedThemeScheme>(getSystemScheme)
  const appliedValuesRef = useRef<Record<string, string>>({})

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSystemScheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolvedScheme: ResolvedThemeScheme = mode === 'system' ? systemScheme : mode

  const activeManifest = themes?.find((t) => t.id === themeId) ?? defaultThemeRegistry.get(themeId)
  const manifestSig = useMemo(
    () => buildManifestSignature(activeManifest),
    [
      activeManifest.id,
      activeManifest.density,
      activeManifest.defaultSeedColor,
      activeManifest.supportsDynamicWorkspaceColor,
      activeManifest.tokenOverrides,
    ],
  )

  const tokens: ThemeTokens = useMemo(
    () => getCachedResolvedTokens(activeManifest, manifestSig, resolvedScheme, seedColorOverride),
    // manifestSig captures all value changes of activeManifest even across IPC-cloned references
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manifestSig, resolvedScheme, seedColorOverride],
  )

  useEffect(() => {
    const root = document.documentElement
    const applied = appliedValuesRef.current

    for (const oldKey of Object.keys(applied)) {
      if (!(oldKey in tokens)) {
        root.style.removeProperty(oldKey)
        delete applied[oldKey]
      }
    }

    if (root.dataset.themeId !== themeId) {
      root.dataset.themeId = themeId
    }
    if (root.dataset.themeScheme !== resolvedScheme) {
      root.dataset.themeScheme = resolvedScheme
    }

    for (const [key, value] of Object.entries(tokens)) {
      if (applied[key] !== value) {
        root.style.setProperty(key, value)
        applied[key] = value
      }
    }
  }, [tokens, themeId, resolvedScheme])

  return <>{children}</>
}
