import { describe, expect, it, vi } from 'vitest'
import type { OrioAiService } from '@genoffice/electron-utils'
import { createOrioProjectContextClient } from '../src/main/orio-project-context-client'

describe('ORIO project context client', () => {
  it('sends only context text to the ORIO embedding endpoint and preserves ordering', async () => {
    const cloudRequest = vi.fn(async () => Response.json({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] }))
    const client = createOrioProjectContextClient({ cloudRequest } as unknown as OrioAiService)
    await expect(client.embed('project-1', ['one', 'two'], 'search_document')).resolves.toEqual([[1], [2]])
    expect(cloudRequest).toHaveBeenCalledWith('/api/v1/ai/project-context/embed', expect.objectContaining({
      body: expect.objectContaining({ projectId: 'project-1', input: ['one', 'two'], inputType: 'search_document' }),
    }))
  })

  it('propagates malformed ORIO responses instead of accepting a partial index', async () => {
    const client = createOrioProjectContextClient({ cloudRequest: async () => Response.json({ data: [{ index: 0, embedding: [1] }] }) } as unknown as OrioAiService)
    await expect(client.embed('project-1', ['one', 'two'], 'search_document')).rejects.toThrow('incomplete embedding')
  })

  it('sends graph chunks through ORIO Cloud', async () => {
    const cloudRequest = vi.fn(async () => Response.json({ entities: [], relations: [] }))
    const client = createOrioProjectContextClient({ cloudRequest } as unknown as OrioAiService)
    await expect(client.extractGraph?.('project-1', [{ id: 'a', text: 'One' }])).resolves.toEqual({ entities: [], relations: [] })
    expect(cloudRequest).toHaveBeenCalledWith('/api/v1/ai/project-context/graph', expect.objectContaining({ body: expect.objectContaining({ projectId: 'project-1', chunks: [{ id: 'a', text: 'One' }] }) }))
  })
})
