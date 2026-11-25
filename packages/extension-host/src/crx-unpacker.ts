import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { unzipSync } from 'fflate'

export function extractZipOffsetFromCrx(buf: Buffer): number {
  if (buf.length < 16 || buf.subarray(0, 4).toString('ascii') !== 'Cr24') {
    throw new Error('无效的 CRX 文件：缺少 Cr24 文件头')
  }

  const version = buf.readUInt32LE(4)
  if (version === 3) {
    const headerLength = buf.readUInt32LE(8)
    const zipOffset = 12 + headerLength
    if (zipOffset >= buf.length) {
      throw new Error('无效的 CRX3 文件：头部长度越界')
    }
    return zipOffset
  }

  if (version === 2) {
    const pubKeyLen = buf.readUInt32LE(8)
    const sigLen = buf.readUInt32LE(12)
    const zipOffset = 16 + pubKeyLen + sigLen
    if (zipOffset >= buf.length) {
      throw new Error('无效的 CRX2 文件：签名长度越界')
    }
    return zipOffset
  }

  throw new Error(`不支持的 CRX 版本: v${version}`)
}

export function assertSafeArchiveRelativePath(entryPath: string): string {
  const cleaned = entryPath.replace(/\\/g, '/')
  if (!cleaned || isAbsolute(cleaned) || cleaned.startsWith('/')) {
    throw new Error(`检测到不安全的压缩包路径: ${entryPath}`)
  }
  const normalized = normalize(cleaned)
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('..\\')) {
    throw new Error(`检测到路径穿越 (Zip Slip): ${entryPath}`)
  }
  return normalized
}

export async function unpackCrxBuffer(crxBuffer: Buffer, targetDir: string): Promise<string[]> {
  const zipOffset = extractZipOffsetFromCrx(crxBuffer)
  const zipBytes = new Uint8Array(crxBuffer.subarray(zipOffset))
  const entries = unzipSync(zipBytes)

  const rootResolved = resolve(targetDir)
  await mkdir(rootResolved, { recursive: true })

  const written: string[] = []
  for (const [entryName, data] of Object.entries(entries)) {
    if (entryName.endsWith('/')) continue
    const safeRel = assertSafeArchiveRelativePath(entryName)
    const outPath = resolve(join(rootResolved, safeRel))
    if (!outPath.startsWith(rootResolved)) {
      throw new Error(`路径越界拒绝写入: ${entryName}`)
    }
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, data)
    written.push(outPath)
  }

  return written
}
