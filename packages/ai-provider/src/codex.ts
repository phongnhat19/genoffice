import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'
import { httpBodyDetail } from './http-error'
import type { AiProviderConfig } from './types'
import { createStreamWatchdog } from './watchdog'

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

/** The backend sometimes nests a terminal event in `data`; accept both SSE shapes. */
function payloadFor(event: Record<string, unknown>): Record<string, unknown> {
  const data = event.data
  return data && typeof data === 'object' && !Array.isArray(data) ? { ...event, ...(data as Record<string, unknown>) } : event
}

/** Extract a useful server error without ever including request content or credentials. */
function nestedMessage(value: unknown, depth = 0): string | undefined {
  if (!value || depth > 5 || typeof value === 'string') return typeof value === 'string' && value.trim() ? value : undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = nestedMessage(item, depth + 1)
      if (found) return found
    }
    return undefined
  }
  if (typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  for (const child of Object.values(record)) {
    const found = nestedMessage(child, depth + 1)
    if (found) return found
  }
  return undefined
}

export interface CodexStreamCallbacks {
  signal?: AbortSignal
  onDelta(text: string): void
  onToolCall(call: AgentToolCall): void
  onActivity?(): void
  onStopReason?(reason: string): void
}

function responsesInput(messages: AgentMessage[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'user') {
      input.push({ type: 'message', role: 'user', content: [
        ...(message.text ? [{ type: 'input_text', text: message.text }] : []),
        ...(message.images ?? []).map((image) => ({ type: 'input_image', image_url: `data:${image.mime};base64,${image.base64}` })),
      ] })
    } else if (message.role === 'assistant') {
      // A Responses follow-up must replay the preceding function_call items before
      // function_call_output. Dropping them works for prose-only turns but makes a
      // tool result orphaned, which Codex can complete as an empty turn.
      if (message.text) {
        input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message.text }] })
      }
      for (const call of message.toolCalls ?? []) {
        input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.input) })
      }
    } else {
      for (const result of message.results) input.push({ type: 'function_call_output', call_id: result.id, output: result.output })
    }
  }
  return input
}

async function* lines(body: ReadableStream<Uint8Array>, onActivity: () => void): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      onActivity()
      buffer += decoder.decode(value, { stream: true })
      let at: number
      while ((at = buffer.indexOf('\n')) >= 0) {
        yield buffer.slice(0, at).replace(/\r$/, '')
        buffer = buffer.slice(at + 1)
      }
    }
    buffer += decoder.decode()
    if (buffer) yield buffer
  } finally {
    reader.releaseLock()
  }
}

/** Translates the Codex subscription Responses event stream into GenOffice agent events. */
export async function streamOpenAiCodex(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: CodexStreamCallbacks,
): Promise<void> {
  // Codex subscription responses rejects per-request output-budget fields; the plan enforces its own limit.
  void maxTokens
  const watchdog = createStreamWatchdog(cb.signal)
  return watchdog.guard(async () => {
    const response = await fetch(CODEX_RESPONSES_URL, {
      method: 'POST', signal: watchdog.signal,
      headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`,
        originator: 'codex_cli_rs', 'User-Agent': 'codex_cli_rs/0.136.0', Accept: 'text/event-stream',
        // Codex uses this for request/session affinity. It is an opaque local connection id,
        // not an account identifier and never leaves the Electron main process except as a header.
        session_id: config.connectionId ?? 'default',
      },
      body: JSON.stringify({
        model: config.model, instructions: system, input: responsesInput(messages), stream: true, store: false,
        // The Codex backend otherwise defaults to a much higher reasoning budget. Low keeps
        // ordinary office requests responsive while preserving tool-use capability.
        reasoning: { effort: 'low', summary: 'auto' },
        include: ['reasoning.encrypted_content'],
        tools: tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema })),
      }),
    })
    watchdog.touch(); cb.onActivity?.()
    if (!response.ok || !response.body) throw new Error(`Codex HTTP ${response.status}: ${httpBodyDetail(await response.text())}`)
    const calls = new Map<string, { name: string; arguments: string; callId?: string | undefined }>()
    const textByItem = new Map<string, string>()
    const emittedCalls = new Set<string>()
    const eventTypes = new Set<string>()
    let visibleText = 0
    const emitText = (text: string) => { if (text) { visibleText += text.length; cb.onDelta(text) } }
    const emitCall = (id: string, call: { name: string; arguments: string; callId?: string | undefined }) => {
      if (!id || !call.name || emittedCalls.has(id)) return
      let input: Record<string, unknown> = {}; let inputError: string | undefined
      try { input = JSON.parse(call.arguments || '{}') as Record<string, unknown> } catch { inputError = 'Invalid tool arguments' }
      emittedCalls.add(id); cb.onToolCall({ id, name: call.name, input, inputError })
    }
    let eventName = ''
    for await (const line of lines(response.body, () => { watchdog.touch(); cb.onActivity?.() })) {
      if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue }
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      let event: Record<string, unknown>
      try { event = JSON.parse(raw) as Record<string, unknown> } catch { continue }
      event = payloadFor(event)
      const type = String(event.type ?? eventName)
      eventTypes.add(type)
      if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        const id = String(event.item_id ?? '')
        if (id) textByItem.set(id, `${textByItem.get(id) ?? ''}${event.delta}`)
        emitText(event.delta)
      }
      // The Codex backend occasionally omits text deltas and provides the complete message only
      // in a terminal event. Use it as a fallback, without duplicating streamed text.
      if (type === 'response.output_text.done' && typeof event.text === 'string') {
        const id = String(event.item_id ?? '')
        if (!id || !textByItem.has(id)) emitText(event.text)
      }
      if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        const item = event.item as { id?: string; call_id?: string; type?: string; name?: string; arguments?: string; input?: string; content?: Array<{ type?: string; text?: string }> } | undefined
        if (item?.type === 'message') {
          const text = item.content?.filter((part) => part.type === 'output_text').map((part) => part.text ?? '').join('') ?? ''
          if (text && (!item.id || !textByItem.has(item.id))) emitText(text)
        }
        if ((item?.type === 'function_call' || item?.type === 'custom_tool_call') && item.name) {
          const id = item.call_id ?? item.id ?? ''
          const call = { name: item.name, arguments: item.arguments ?? item.input ?? '', callId: item.call_id }
          calls.set(item.id ?? id, call)
          if (type === 'response.output_item.done') emitCall(id, call)
        }
      }
      if (type === 'response.function_call_arguments.delta') {
        const id = String(event.item_id ?? event.call_id ?? '')
        if (!id) continue
        const call = calls.get(id) ?? { name: String(event.name ?? ''), arguments: '', callId: typeof event.call_id === 'string' ? event.call_id : undefined }
        if (!call.name && event.name) call.name = String(event.name)
        call.arguments += String(event.delta ?? '')
        calls.set(id, call)
      }
      if (type === 'response.function_call_arguments.done') {
        const id = String(event.item_id ?? event.call_id ?? '')
        const call = calls.get(id) ?? { name: String(event.name ?? ''), arguments: '', callId: typeof event.call_id === 'string' ? event.call_id : undefined }
        if (event.arguments) call.arguments = String(event.arguments)
        emitCall(call.callId ?? id, call)
        calls.delete(id)
      }
      if (type === 'response.custom_tool_call_input.delta') {
        const id = String(event.item_id ?? event.call_id ?? '')
        if (!id) continue
        const call = calls.get(id) ?? { name: String(event.name ?? ''), arguments: '', callId: typeof event.call_id === 'string' ? event.call_id : undefined }
        if (!call.name && event.name) call.name = String(event.name)
        call.arguments += String(event.delta ?? '')
        calls.set(id, call)
      }
      if (type === 'response.custom_tool_call_input.done') {
        const id = String(event.item_id ?? event.call_id ?? '')
        const call = calls.get(id) ?? { name: String(event.name ?? ''), arguments: '', callId: typeof event.call_id === 'string' ? event.call_id : undefined }
        if (event.input) call.arguments = String(event.input)
        emitCall(call.callId ?? id, call); calls.delete(id)
      }
      if (type === 'response.completed') {
        const completed = event.response as {
          status?: string
          error?: unknown
          incomplete_details?: { reason?: string }
          output?: Array<{ id?: string; type?: string; content?: Array<{ type?: string; text?: string }> }>
        } | undefined
        if (completed?.status === 'failed') {
          throw new Error(nestedMessage(completed.error) ?? nestedMessage(event) ?? 'Codex stream failed')
        }
        if (completed?.status === 'incomplete') {
          if (completed.incomplete_details?.reason === 'max_output_tokens') cb.onStopReason?.('max_tokens')
          else throw new Error(nestedMessage(completed.incomplete_details) ?? 'Codex response was incomplete')
        }
        // Defensive final fallback: a few Codex backend versions omit the
        // output_item events yet retain the completed response payload.
        for (const item of completed?.output ?? []) {
          if (item.type !== 'message') continue
          const text = item.content?.filter((part) => part.type === 'output_text').map((part) => part.text ?? '').join('') ?? ''
          if (text && (!item.id || !textByItem.has(item.id))) emitText(text)
        }
      }
      if (type === 'error' || type === 'response.failed') {
        throw new Error(nestedMessage(event.error) ?? nestedMessage(event.response) ?? 'Codex stream failed')
      }
    }
    if (visibleText === 0 && emittedCalls.size === 0) {
      // Deliberately logs protocol shape only; no prompt, token, response text, or credential reaches logs.
      const eventSummary = [...eventTypes].join(',') || 'none'
      console.warn(`[codex-stream] completed without visible output; events=${eventSummary}`)
      throw new Error(`Codex returned no usable output (events: ${eventSummary})`)
    }
  })
}
