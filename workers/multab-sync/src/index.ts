interface KvNamespaceLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface Env {
  MULTAB_SYNC_KV: KvNamespaceLike
}

const SLOT_ID_RE = /^[a-f0-9]{64}$/
const MAX_PAYLOAD_BYTES = 512 * 1024
const DEFAULT_TTL_SECONDS = 300

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'multab-sync', version: 1 })
    }

    if (request.method === 'POST' && url.pathname === '/v1/sync/push') {
      const rawText = await request.text()
      if (rawText.length > MAX_PAYLOAD_BYTES) {
        return jsonResponse({ error: '同步数据包超出 512KB 限制' }, 413)
      }

      let body: { slotId?: unknown; envelope?: unknown; ttlSeconds?: unknown }
      try {
        body = JSON.parse(rawText) as typeof body
      } catch {
        return jsonResponse({ error: '请求体 JSON 格式无效' }, 400)
      }

      if (typeof body.slotId !== 'string' || !SLOT_ID_RE.test(body.slotId)) {
        return jsonResponse({ error: '无效的 slotId' }, 400)
      }
      if (!body.envelope || typeof body.envelope !== 'object') {
        return jsonResponse({ error: '缺少加密信封 envelope' }, 400)
      }

      const ttl =
        typeof body.ttlSeconds === 'number' && body.ttlSeconds >= 60 && body.ttlSeconds <= 600
          ? Math.trunc(body.ttlSeconds)
          : DEFAULT_TTL_SECONDS

      await env.MULTAB_SYNC_KV.put(`slot:${body.slotId}`, JSON.stringify(body.envelope), {
        expirationTtl: ttl,
      })

      return jsonResponse({ ok: true, expiresInSeconds: ttl })
    }

    if (request.method === 'POST' && url.pathname === '/v1/sync/pull') {
      let body: { slotId?: unknown }
      try {
        body = (await request.json()) as { slotId?: unknown }
      } catch {
        return jsonResponse({ error: '请求体 JSON 格式无效' }, 400)
      }

      if (typeof body.slotId !== 'string' || !SLOT_ID_RE.test(body.slotId)) {
        return jsonResponse({ error: '无效的 slotId' }, 400)
      }

      const stored = await env.MULTAB_SYNC_KV.get(`slot:${body.slotId}`)
      if (!stored) {
        return jsonResponse({ error: '同步码不存在或已过期' }, 404)
      }

      return jsonResponse({ ok: true, envelope: JSON.parse(stored) })
    }

    return jsonResponse({ error: 'Not Found' }, 404)
  },
}
