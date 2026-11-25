import type { LLMProviderConfig } from '@wb/contracts'

export interface LLMToolDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
}

export interface LLMResponse {
  content: string
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export class LLMClient {
  async chat(
    provider: LLMProviderConfig,
    messages: LLMChatMessage[],
    tools: LLMToolDeclaration[],
  ): Promise<LLMResponse> {
    if (provider.kind === 'openai-compatible' || provider.kind === 'ollama') {
      return this.callOpenAICompatible(provider, messages, tools)
    }
    if (provider.kind === 'anthropic') {
      return this.callAnthropic(provider, messages, tools)
    }
    if (provider.kind === 'gemini') {
      return this.callGemini(provider, messages)
    }
    throw new Error(`Unsupported LLM provider kind: ${String(provider.kind)}`)
  }

  private async callOpenAICompatible(
    provider: LLMProviderConfig,
    messages: LLMChatMessage[],
    tools: LLMToolDeclaration[],
  ): Promise<LLMResponse> {
    const base = normalizeBaseUrl(provider.baseUrl)
    const endpoint =
      provider.kind === 'ollama' && !base.endsWith('/v1')
        ? `${base}/v1/chat/completions`
        : `${base}/chat/completions`

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`
    }

    const body: Record<string, unknown> = {
      model: provider.model,
      messages: messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          }
        }
        return { role: m.role, content: m.content }
      }),
    }

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`LLM API 错误 (${res.status}): ${errText.slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }

    const msg = json.choices?.[0]?.message
    const toolCalls = (msg?.tool_calls ?? []).map((tc, idx) => {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = tc.function?.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {}
      } catch {
        parsedArgs = {}
      }
      return {
        id: tc.id ?? `call_${idx}`,
        name: tc.function?.name ?? '',
        arguments: parsedArgs,
      }
    })

    return {
      content: msg?.content ?? '',
      toolCalls,
    }
  }

  private async callAnthropic(
    provider: LLMProviderConfig,
    messages: LLMChatMessage[],
    tools: LLMToolDeclaration[],
  ): Promise<LLMResponse> {
    const base = normalizeBaseUrl(provider.baseUrl || 'https://api.anthropic.com')
    const systemPrompt = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n')

    const nonSystem = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }))

    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 2048,
        system: systemPrompt || undefined,
        messages: nonSystem,
        tools:
          tools.length > 0
            ? tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              }))
            : undefined,
      }),
    })

    if (!res.ok) {
      throw new Error(`Anthropic API 错误 (${res.status}): ${(await res.text()).slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
    }

    const texts: string[] = []
    const toolCalls: LLMResponse['toolCalls'] = []
    for (const block of json.content ?? []) {
      if (block.type === 'text' && block.text) texts.push(block.text)
      if (block.type === 'tool_use' && block.name) {
        toolCalls.push({
          id: block.id ?? `anth_${toolCalls.length}`,
          name: block.name,
          arguments: block.input ?? {},
        })
      }
    }

    return { content: texts.join('\n'), toolCalls }
  }

  private async callGemini(provider: LLMProviderConfig, messages: LLMChatMessage[]): Promise<LLMResponse> {
    const base = normalizeBaseUrl(provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta')
    const url = `${base}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(
      provider.apiKey ?? '',
    )}`

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
    })

    if (!res.ok) {
      throw new Error(`Gemini API 错误 (${res.status}): ${(await res.text()).slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    return { content: text, toolCalls: [] }
  }
}
