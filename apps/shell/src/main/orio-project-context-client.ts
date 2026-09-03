import type {
  ProjectContextCloudClient,
  ProjectContextEntity,
  ProjectContextRelation,
} from '@genoffice/project-context'
import type { OrioAiService } from '@genoffice/electron-utils'

type GraphResponse = { entities?: unknown; relations?: unknown }

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

/** Project-context inference is always executed by authenticated ORIO Cloud. */
export function createOrioProjectContextClient(ai: OrioAiService): ProjectContextCloudClient {
  return {
    async embed(projectId, input, inputType) {
      const response = await ai.cloudRequest('/api/v1/ai/project-context/embed', {
        body: { requestId: crypto.randomUUID(), projectId, input, inputType },
      })
      const payload = (await response.json()) as { data?: Array<{ index?: unknown; embedding?: unknown }> }
      const output = new Array<number[]>(input.length)
      for (const item of payload.data ?? []) {
        if (
          typeof item.index === 'number' &&
          Number.isInteger(item.index) &&
          item.index >= 0 &&
          item.index < input.length &&
          Array.isArray(item.embedding) &&
          item.embedding.every((value) => typeof value === 'number')
        )
          output[item.index] = item.embedding as number[]
      }
      if (output.length !== input.length || Array.from({ length: input.length }, (_, index) => output[index]).some((vector) => !vector))
        throw new Error('ORIO Cloud returned an incomplete embedding batch.')
      return output
    },
    async extractGraph(projectId, chunks) {
      const response = await ai.cloudRequest('/api/v1/ai/project-context/graph', {
        body: { requestId: crypto.randomUUID(), projectId, chunks },
      })
      const parsed = (await response.json()) as GraphResponse
      const entities: ProjectContextEntity[] = (Array.isArray(parsed.entities) ? parsed.entities : []).flatMap((value) => {
        const item = value as Partial<ProjectContextEntity>
        return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.type === 'string'
          ? [{ id: item.id, name: item.name, type: item.type, sourceChunkIds: strings(item.sourceChunkIds) }]
          : []
      })
      const relations: ProjectContextRelation[] = (Array.isArray(parsed.relations) ? parsed.relations : []).flatMap((value) => {
        const item = value as Partial<ProjectContextRelation>
        return typeof item.from === 'string' && typeof item.to === 'string' && typeof item.type === 'string' && typeof item.confidence === 'number'
          ? [{ from: item.from, to: item.to, type: item.type, confidence: item.confidence, sourceChunkIds: strings(item.sourceChunkIds) }]
          : []
      })
      return { entities, relations }
    },
  }
}
