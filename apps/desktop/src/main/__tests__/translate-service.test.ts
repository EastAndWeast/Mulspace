import { describe, expect, it } from 'vitest'
import { translateSingleText, translateTexts } from '../translate-service.js'

describe('translate-service', () => {
  it('translates single text via Google endpoint and falls back to MyMemory on failure', async () => {
    const primaryRes = await translateSingleText('Hello world', 'zh-CN', async (url) => {
      expect(url).toContain('translate.googleapis.com')
      return {
        ok: true,
        status: 200,
        json: async () => [[['你好世界', 'Hello world']]],
      }
    })
    expect(primaryRes).toBe('你好世界')

    let calls = 0
    const fallbackRes = await translateSingleText('Good morning', 'zh-CN', async (url) => {
      calls++
      if (url.includes('translate.googleapis.com')) {
        throw new Error('network error')
      }
      expect(url).toContain('api.mymemory.translated.net')
      return {
        ok: true,
        status: 200,
        json: async () => ({ responseData: { translatedText: '早上好' } }),
      }
    })
    expect(calls).toBe(2)
    expect(fallbackRes).toBe('早上好')
  })

  it('batches and deduplicates page text arrays while preserving blank entries', async () => {
    let requestCount = 0
    const outputs = await translateTexts(
      ['Hello', '   ', 'World', 'Hello'],
      'zh-CN',
      async (url) => {
        requestCount++
        expect(url).toContain('translate.googleapis.com')
        return {
          ok: true,
          status: 200,
          json: async () => [[['你好\n[[WB_SEG_9482]]\n世界']]],
        }
      },
    )

    expect(requestCount).toBe(1)
    expect(outputs).toEqual(['你好', '   ', '世界', '你好'])
  })
})
