export type ProjectContextState =
  | 'disabled'
  | 'paused'
  | 'indexing'
  | 'ready'
  | 'needs_rebuild'
  | 'error'

export interface ProjectContextSettings {
  enabled: boolean
  /** Bumped whenever the cloud-content consent text changes. */
  consentVersion?: number
  /** Context inference is always performed by ORIO Cloud. */
  provider: 'orio' | 'legacy'
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
  embed(
    projectId: string,
    input: string[],
    inputType: 'search_document' | 'search_query',
  ): Promise<number[][]>
  extractGraph?(
    projectId: string,
    chunks: Array<{ id: string; text: string }>,
  ): Promise<{ entities: ProjectContextEntity[]; relations: ProjectContextRelation[] }>
}
