export type ProjectContextState = 'disabled' | 'paused' | 'indexing' | 'ready' | 'error'

export interface ProjectContextSettings {
  enabled: boolean
  /** Bumped whenever the cloud-content consent text changes. */
  consentVersion?: number
  embeddingModel: string
  entityModel?: string
}

export interface ProjectContextStatus extends ProjectContextSettings {
  state: ProjectContextState
  indexedFiles: number
  indexedChunks: number
  lastIndexedAt?: string
  error?: string
}

export interface ProjectContextSource {
  path: string
  anchor: string
  text: string
  score: number
  graphExpanded?: boolean
}

export interface ProjectContextResult {
  revision: number
  sources: ProjectContextSource[]
  systemContext: string
}

export interface ProjectContextEntity {
  id: string
  name: string
  type: string
  sourceChunkIds: string[]
}

export interface ProjectContextRelation {
  from: string
  to: string
  type: string
  confidence: number
  sourceChunkIds: string[]
}

export interface ProjectContextCloudClient {
  embed(input: string[], model: string, inputType: 'search_document' | 'search_query'): Promise<number[][]>
  extractGraph?(
    chunks: Array<{ id: string; text: string }>,
    model: string,
  ): Promise<{ entities: ProjectContextEntity[]; relations: ProjectContextRelation[] }>
}
