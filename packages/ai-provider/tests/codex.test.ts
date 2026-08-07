import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamForProvider } from '../src/stream'
import { okResponse, sseStream } from './test-utils'

afterEach(() => vi.unstubAllGlobals())

describe('Codex subscription Responses adapter', () => {
  it('uses Codex-specific request fields instead of public Responses token limits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseStream([
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Hi"}',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed"}}',
    ])))
    vi.stubGlobal('fetch', fetchMock)
    const deltas: string[] = []
    await streamForProvider('openai', { apiKey: 'oauth-token', model: 'gpt-5.6-sol', authType: 'oauth' }, 'System instruction', [{ role: 'user', text: 'Hello' }], [], 8192, {
      signal: new AbortController().signal, onDelta: (text) => { deltas.push(text) }, onToolCall: () => undefined,
    })
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'gpt-5.6-sol', instructions: 'System instruction', stream: true, store: false })
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(body).not.toHaveProperty('parallel_tool_calls')
    expect(body).toMatchObject({ reasoning: { effort: 'low', summary: 'auto' }, include: ['reasoning.encrypted_content'] })
    expect(deltas).toEqual(['Hi'])
  })

  it('uses terminal message content when the backend omits text deltas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(sseStream([
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","content":[{"type":"output_text","text":"Final text"}]}}',
    ]))))
    const deltas: string[] = []
    await streamForProvider('openai', { apiKey: 'oauth-token', model: 'gpt-5.6-sol', authType: 'oauth' }, 'System instruction', [{ role: 'user', text: 'Hello' }], [], 8192, {
      signal: new AbortController().signal, onDelta: (text) => { deltas.push(text) }, onToolCall: () => undefined,
    })
    expect(deltas).toEqual(['Final text'])
  })

  it('replays Codex function calls before their tool output on the next agent turn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseStream([
      'data: {"type":"response.output_text.delta","delta":"Done"}',
    ])))
    vi.stubGlobal('fetch', fetchMock)
    await streamForProvider(
      'openai',
      { apiKey: 'oauth-token', model: 'gpt-5.6-sol', authType: 'oauth' },
      'System instruction',
      [
        { role: 'user', text: 'Update the document' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'call_1', name: 'edit_document', input: { text: 'Updated' } }] },
        { role: 'tool', results: [{ id: 'call_1', name: 'edit_document', output: 'Applied', isError: false }] },
      ],
      [],
      8192,
      { signal: new AbortController().signal, onDelta: () => undefined, onToolCall: () => undefined },
    )
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { input: Array<Record<string, unknown>> }
    expect(body.input).toContainEqual({ type: 'function_call', call_id: 'call_1', name: 'edit_document', arguments: '{"text":"Updated"}' })
    expect(body.input).toContainEqual({ type: 'function_call_output', call_id: 'call_1', output: 'Applied' })
  })

  it('uses the completed response payload when individual output events are omitted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(sseStream([
      'data: {"type":"response.completed","response":{"status":"completed","output":[{"id":"msg_1","type":"message","content":[{"type":"output_text","text":"Complete fallback"}]}]}}',
    ]))))
    const deltas: string[] = []
    await streamForProvider(
      'openai', { apiKey: 'oauth-token', model: 'gpt-5.6-sol', authType: 'oauth' }, 'System instruction', [{ role: 'user', text: 'Hello' }], [], 8192,
      { signal: new AbortController().signal, onDelta: (text) => { deltas.push(text) }, onToolCall: () => undefined },
    )
    expect(deltas).toEqual(['Complete fallback'])
  })

  it('surfaces a failed terminal response instead of completing an empty turn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(sseStream([
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"failed","error":{"message":"Selected model is at capacity."}}}',
    ]))))
    await expect(streamForProvider(
      'openai', { apiKey: 'oauth-token', model: 'gpt-5.6-sol', authType: 'oauth' }, 'System instruction', [{ role: 'user', text: 'Hello' }], [], 8192,
      { signal: new AbortController().signal, onDelta: () => undefined, onToolCall: () => undefined },
    )).rejects.toThrow('Selected model is at capacity.')
  })

  it('accepts a backend event wrapped in a data object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(sseStream([
      'data: {"data":{"type":"response.output_text.delta","delta":"Wrapped"}}',
    ]))))
    const deltas: string[] = []
    await streamForProvider(
      'openai', { apiKey: 'oauth-token', model: 'gpt-5.6-sol', authType: 'oauth' }, 'System instruction', [{ role: 'user', text: 'Hello' }], [], 8192,
      { signal: new AbortController().signal, onDelta: (text) => { deltas.push(text) }, onToolCall: () => undefined },
    )
    expect(deltas).toEqual(['Wrapped'])
  })
})
