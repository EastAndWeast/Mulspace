import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes, randomInt } from 'node:crypto'
import type { MultabState } from '@wb/contracts'

export interface EncryptedSyncEnvelope {
  version: 1
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

const PBKDF2_ITERATIONS = 120_000
const KEY_BYTES = 32
const AUTH_TAG_BYTES = 16

export function normalizeSixDigitCode(raw: string): string {
  return raw.replace(/\s+/g, '').trim()
}

export function assertValidSixDigitCode(raw: string): string {
  const normalized = normalizeSixDigitCode(raw)
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error('请输入有效的 6 位数字同步码')
  }
  return normalized
}

export function generateSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function deriveSyncSlotId(rawCode: string): string {
  const code = assertValidSixDigitCode(rawCode)
  return createHash('sha256').update(`multab-slot-v1:${code}`).digest('hex')
}

function deriveKey(code: string, salt: Buffer): Buffer {
  return pbkdf2Sync(code, salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256')
}

export function encryptMultabPayload(rawCode: string, state: MultabState): EncryptedSyncEnvelope {
  const code = assertValidSixDigitCode(rawCode)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = deriveKey(code, salt)

  const plaintext = Buffer.from(
    JSON.stringify({
      schemaVersion: state.schemaVersion,
      searchEngine: state.searchEngine,
      categories: state.categories,
      items: state.items,
    }),
    'utf8',
  )

  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES })
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptMultabPayload(
  rawCode: string,
  envelope: unknown,
): Pick<MultabState, 'schemaVersion' | 'searchEngine' | 'categories' | 'items'> {
  const code = assertValidSixDigitCode(rawCode)
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('同步数据格式无效')
  }
  const env = envelope as Partial<EncryptedSyncEnvelope>
  if (
    env.version !== 1 ||
    typeof env.salt !== 'string' ||
    typeof env.iv !== 'string' ||
    typeof env.tag !== 'string' ||
    typeof env.ciphertext !== 'string'
  ) {
    throw new Error('同步加密信封版本不受支持或字段缺失')
  }

  try {
    const salt = Buffer.from(env.salt, 'base64')
    const iv = Buffer.from(env.iv, 'base64')
    const tag = Buffer.from(env.tag, 'base64')
    const ciphertext = Buffer.from(env.ciphertext, 'base64')
    const key = deriveKey(code, salt)

    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES })
    decipher.setAuthTag(tag)
    const plainBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const parsed = JSON.parse(plainBuf.toString('utf8')) as Partial<MultabState>

    if (
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.categories) ||
      !Array.isArray(parsed.items)
    ) {
      throw new Error('Invalid decrypted state')
    }
    return {
      schemaVersion: 1,
      searchEngine: parsed.searchEngine ?? 'bing',
      categories: parsed.categories,
      items: parsed.items,
    }
  } catch {
    throw new Error('同步码错误或云端数据已失效')
  }
}
