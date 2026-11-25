import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ParsedExtensionManifest {
  name: string
  version: string
  description: string
  manifestVersion: 2 | 3
  popupPath?: string
  iconPath?: string
}

export async function readExtensionManifest(dirPath: string): Promise<ParsedExtensionManifest> {
  let raw: string
  try {
    raw = await readFile(join(dirPath, 'manifest.json'), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') {
      throw new Error('安装包内缺少 manifest.json')
    }
    throw new Error('读取扩展 manifest.json 失败')
  }

  let json: Record<string, unknown>
  try {
    json = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('扩展 manifest.json 格式无效')
  }

  const name = String(json.name ?? '').trim()
  const version = String(json.version ?? '1.0.0').trim()
  const manifestVersion = Number(json.manifest_version ?? 3)

  if (!name || name.startsWith('__MSG_')) {
    // Fallback cleanly if localized key wasn't resolved
  }
  if (manifestVersion !== 2 && manifestVersion !== 3) {
    throw new Error(`不支持的扩展 manifest_version: ${String(json.manifest_version)}`)
  }

  const action = (json.action ?? json.browser_action ?? json.page_action) as
    | Record<string, unknown>
    | undefined
  const popupPath = action?.default_popup ? String(action.default_popup) : undefined

  let iconPath: string | undefined
  if (json.icons && typeof json.icons === 'object') {
    const iconRecord = json.icons as Record<string, unknown>
    const candidate = iconRecord['128'] ?? iconRecord['64'] ?? iconRecord['48'] ?? Object.values(iconRecord)[0]
    if (candidate) iconPath = String(candidate)
  }

  return {
    name: name || '未命名扩展',
    version,
    description: String(json.description ?? ''),
    manifestVersion,
    popupPath,
    iconPath,
  }
}
