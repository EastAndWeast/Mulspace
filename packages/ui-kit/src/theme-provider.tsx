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

function getSystemScheme(): ResolvedThemeScheme {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function ThemeProvider({ themeId, mode, themes, seedColorOverride, children }: ThemeProviderProps) {
  const [systemScheme, setSystemScheme] = useState<ResolvedThemeScheme>(getSystemScheme)
  const appliedKeysRef = useRef<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSystemScheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolvedScheme: ResolvedThemeScheme = mode === 'system' ? systemScheme : mode

  const activeManifest = useMemo(
    () => themes?.find((t) => t.id === themeId) ?? defaultThemeRegistry.get(themeId),
    [themes, themeId],
  )

  const tokens: ThemeTokens = useMemo(
    () => resolveThemeTokensFromManifest(activeManifest, resolvedScheme, seedColorOverride),
    [activeManifest, resolvedScheme, seedColorOverride],
  )

  useEffect(() => {
    const root = document.documentElement
    for (const oldKey of appliedKeysRef.current) {
      if (!(oldKey in tokens)) {
        root.style.removeProperty(oldKey)
      }
    }
    root.dataset.themeId = themeId
    root.dataset.themeScheme = resolvedScheme
    const nextKeys = Object.keys(tokens)
    for (const [key, value] of Object.entries(tokens)) {
      root.style.setProperty(key, value)
    }
    appliedKeysRef.current = nextKeys
  }, [tokens, themeId, resolvedScheme])

  return <>{children}</>
}
