import type { UpdateAsset } from '@wb/contracts'

export function matchReleaseAsset(
  assets: UpdateAsset[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): UpdateAsset | null {
  if (assets.length === 0) return null

  const byLower = assets.map((a) => ({ asset: a, name: a.name.toLowerCase() }))

  if (platform === 'darwin') {
    const archTag = arch === 'arm64' ? 'arm64' : 'x64'
    const exactDmg = byLower.find((a) => a.name.endsWith('.dmg') && a.name.includes(archTag))
    if (exactDmg) return exactDmg.asset

    const exactZip = byLower.find((a) => a.name.endsWith('.zip') && a.name.includes(archTag))
    if (exactZip) return exactZip.asset

    const anyDmg = byLower.find((a) => a.name.endsWith('.dmg'))
    if (anyDmg) return anyDmg.asset
  }

  if (platform === 'win32') {
    const exe = byLower.find((a) => a.name.endsWith('.exe'))
    if (exe) return exe.asset

    const winZip = byLower.find((a) => a.name.endsWith('.zip') && a.name.includes('win'))
    if (winZip) return winZip.asset
  }

  if (platform === 'linux') {
    const appImage = byLower.find((a) => a.name.endsWith('.appimage'))
    if (appImage) return appImage.asset

    const tarGz = byLower.find((a) => a.name.endsWith('.tar.gz'))
    if (tarGz) return tarGz.asset
  }

  return null
}
