import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamForProvider } from '../src/stream'
import { okResponse, sseStream } from './test-utils'

afterEach(() => vi.unstubAllGlobals())

const callbacks = (toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>, deltas: string[]) => ({
  signal: new AbortController().signal,
  onDelta: (text: string) => deltas.push(text),
  onToolCall: (call: { id: string; name: string; input: Record<string, unknown> }) => toolCalls.push(call),
})

describe('Claude Code OAuth Messages adapter', () => {
  it('uses Claude Code OAuth headers and cloaks client tools and prior tool calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseStream([
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    ])))
    vi.stubGlobal('fetch', fetchMock)
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
    const deltas: string[] = []
    await streamForProvider(
      'anthropic',
      { apiKey: 'oauth-token', model: 'claude-sonnet-5', authType: 'oauth', connectionId: 'claude-oauth' },
      'System instruction',
      [
        { role: 'user', text: 'Update it' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'call_1', name: 'edit_document', input: { text: 'New' } }] },
        { role: 'tool', results: [{ id: 'call_1', name: 'edit_document', output: 'Applied', isError: false }] },
      ],
      [{ name: 'edit_document', description: 'Edit the document', inputSchema: { type: 'object' } }],
      1024,
      callbacks(toolCalls, deltas),
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages?beta=true',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-token',
          'x-app': 'cli',
          'x-claude-code-session-id': expect.any(String),
        }),
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
      system: Array<{ text: string }>
      tools: Array<{ name: string }>
      messages: Array<{ content: Array<{ type: string; name?: string }> }>
      metadata: { user_id: string }
    }
    expect(body.system[0]!.text).toContain('x-anthropic-billing-header:')
    expect(body.tools.map((tool) => tool.name)).toContain('edit_document_ide')
    expect(body.tools.map((tool) => tool.name)).toContain('Read')
    expect(body.messages[1]!.content[0]!.name).toBe('edit_document_ide')
    expect(JSON.parse(body.metadata.user_id)).toMatchObject({ session_id: expect.any(String) })
    expect(deltas).toEqual(['Done'])
  })

  it('decloaks streamed client tool calls before exposing them to the agent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(sseStream([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_1","name":"edit_document_ide"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"text\\":\\"New\\"}"}}',
      'data: {"type":"content_block_stop","index":0}',
    ]))))
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
    await streamForProvider(
      'anthropic',
      { apiKey: 'oauth-token', model: 'claude-sonnet-5', authType: 'oauth' },
      'System',
      [{ role: 'user', text: 'Update it' }],
      [{ name: 'edit_document', description: 'Edit', inputSchema: { type: 'object' } }],
      1024,
      callbacks(toolCalls, []),
    )
    expect(toolCalls).toEqual([{ id: 'call_1', name: 'edit_document', input: { text: 'New' } }])
  })

  it('rejects Claude Code decoy-tool calls instead of exposing them to GenOffice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(sseStream([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_1","name":"Read"}}',
    ]))))
    await expect(streamForProvider(
      'anthropic',
      { apiKey: 'oauth-token', model: 'claude-sonnet-5', authType: 'oauth' },
      'System',
      [{ role: 'user', text: 'Read it' }],
      [],
      1024,
      callbacks([], []),
    )).rejects.toThrow('Claude Code requested unavailable tool: Read')
  })
})
