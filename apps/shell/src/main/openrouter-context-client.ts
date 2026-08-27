import { AiProviderSettingsService, type SafeStorageLike } from '@genoffice/electron-utils'
import type { ProjectContextCloudClient, ProjectContextEntity, ProjectContextRelation } from '@genoffice/project-context'

type GraphResponse = { entities?: unknown; relations?: unknown }

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

/** Keeps the OpenRouter credential in the main process and never exposes it through IPC. */
export function createOpenRouterContextClient(path: () => string, safeStorage: SafeStorageLike): ProjectContextCloudClient {
  const settings = new AiProviderSettingsService({ path, safeStorage, openExternal: () => undefined })
  const key = async (): Promise<string> => {
    const config = await settings.config()
    if (config.provider !== 'openrouter' || !config.config?.apiKey)
      throw new Error('Connect and select OpenRouter before enabling Project Context.')
    return config.config.apiKey
  }
  const post = async <T>(url: string, body: unknown): Promise<T> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${await key()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`OpenRouter request failed (${response.status}).`)
    return (await response.json()) as T
  }
  return {
    async embed(input, model, inputType) {
      const response = await post<{ data?: Array<{ index?: number; embedding?: unknown }> }>(
        'https://openrouter.ai/api/v1/embeddings', { input, model, input_type: inputType },
      )
      const output = new Array<number[]>(input.length)
      for (const item of response.data ?? []) if (typeof item.index === 'number' && Array.isArray(item.embedding) && item.embedding.every((n) => typeof n === 'number')) output[item.index] = item.embedding as number[]
      if (output.some((vector) => !vector)) throw new Error('OpenRouter returned an incomplete embedding batch.')
      return output
    },
    async extractGraph(chunks, model) {
      const schema = {
        name: 'orio_project_graph', strict: true,
        schema: { type: 'object', additionalProperties: false, properties: {
          entities: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, sourceChunkIds: { type: 'array', items: { type: 'string' } } }, required: ['id', 'name', 'type', 'sourceChunkIds'] } },
          relations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { from: { type: 'string' }, to: { type: 'string' }, type: { type: 'string' }, confidence: { type: 'number' }, sourceChunkIds: { type: 'array', items: { type: 'string' } } }, required: ['from', 'to', 'type', 'confidence', 'sourceChunkIds'] } },
        }, required: ['entities', 'relations'] },
      }
      const response = await post<{ choices?: Array<{ message?: { content?: string } }> }>(
        'https://openrouter.ai/api/v1/chat/completions', {
          model, stream: false, response_format: { type: 'json_schema', json_schema: schema },
          provider: { require_parameters: true },
          messages: [{ role: 'system', content: 'Extract only entities and relations explicitly supported by supplied chunks. Every result must cite sourceChunkIds.' }, { role: 'user', content: JSON.stringify(chunks) }],
        },
      )
      let parsed: GraphResponse
      try { parsed = JSON.parse(response.choices?.[0]?.message?.content ?? '{}') as GraphResponse } catch { throw new Error('OpenRouter returned invalid graph JSON.') }
      const entities: ProjectContextEntity[] = (Array.isArray(parsed.entities) ? parsed.entities : []).flatMap((value) => {
        const item = value as Partial<ProjectContextEntity>
        return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.type === 'string' ? [{ id: item.id, name: item.name, type: item.type, sourceChunkIds: strings(item.sourceChunkIds) }] : []
      })
      const relations: ProjectContextRelation[] = (Array.isArray(parsed.relations) ? parsed.relations : []).flatMap((value) => {
        const item = value as Partial<ProjectContextRelation>
        return typeof item.from === 'string' && typeof item.to === 'string' && typeof item.type === 'string' && typeof item.confidence === 'number' ? [{ from: item.from, to: item.to, type: item.type, confidence: item.confidence, sourceChunkIds: strings(item.sourceChunkIds) }] : []
      })
      return { entities, relations }
    },
  }
}

export async function saveOpenRouterContextKey(path: () => string, safeStorage: SafeStorageLike, apiKey: string): Promise<void> {
  const settings = new AiProviderSettingsService({ path, safeStorage, openExternal: () => undefined })
  await settings.saveApiKey('openrouter-api-key', apiKey)
}
