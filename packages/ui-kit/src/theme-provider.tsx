import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ResolvedThemeScheme, ThemeMode, ThemeTokens } from '@wb/contracts'
import { defaultThemeRegistry } from '@wb/themes'

export interface ThemeProviderProps {
  themeId: string
  mode: ThemeMode
  seedColorOverride?: string
  children: ReactNode
}

function getSystemScheme(): ResolvedThemeScheme {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function ThemeProvider({ themeId, mode, seedColorOverride, children }: ThemeProviderProps) {
  const [systemScheme, setSystemScheme] = useState<ResolvedThemeScheme>(getSystemScheme)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSystemScheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolvedScheme: ResolvedThemeScheme = mode === 'system' ? systemScheme : mode

  const tokens: ThemeTokens = useMemo(
    () => defaultThemeRegistry.resolveTokens(themeId, resolvedScheme, seedColorOverride),
    [themeId, resolvedScheme, seedColorOverride],
  )

  useEffect(() => {
    const root = document.documentElement
    root.dataset.themeId = themeId
    root.dataset.themeScheme = resolvedScheme
    for (const [key, value] of Object.entries(tokens)) {
      root.style.setProperty(key, value)
    }
  }, [tokens, themeId, resolvedScheme])

  return <>{children}</>
}
