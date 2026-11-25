export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

export function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = raw.trim().replace(/^v/i, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

export function isNewerVersion(currentRaw: string, candidateRaw: string): boolean {
  const cur = parseSemver(currentRaw)
  const cand = parseSemver(candidateRaw)
  if (!cur || !cand) return false

  if (cand.major !== cur.major) return cand.major > cur.major
  if (cand.minor !== cur.minor) return cand.minor > cur.minor
  if (cand.patch !== cur.patch) return cand.patch > cur.patch

  // Stable release is newer than prerelease of the same version
  if (cur.prerelease && !cand.prerelease) return true
  if (!cur.prerelease && cand.prerelease) return false
  if (cur.prerelease && cand.prerelease) {
    return cand.prerelease > cur.prerelease
  }
  return false
}
