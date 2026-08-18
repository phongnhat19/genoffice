import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'

export type AiProviderId =
  'anthropic' | 'gemini' | 'deepseek' | 'openai' | 'openrouter' | 'custom' | 'orio'
export type AiAuthType = 'oauth' | 'api-key'
export type AiConnectionStatus =
  'connected' | 'needs-auth' | 'expired' | 'connecting' | 'disconnected'

/** Non-secret connection metadata which may be exposed to a renderer. */
export interface AiProviderConnectionView {
  id: string
  providerId: AiProviderId
  authType: AiAuthType
  enabled: boolean
  model: string
  status: AiConnectionStatus
  email?: string
}

export interface AiProviderConfig {
  apiKey: string
  model: string
  /** only used by the custom (OpenAI-compatible) provider */
  baseUrl?: string | undefined
  /** Main-process-only credential mode. Renderers never receive its credential. */
  authType?: AiAuthType | undefined
  /** Main-process-only stable connection key for provider session affinity. */
  connectionId?: string | undefined
}

export interface AiProviderMeta {
  id: AiProviderId
  label: string
  models: string[]
  defaultModel: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
}

export interface AiSettings {
  provider: AiProviderId
  providers: Record<AiProviderId, AiProviderConfig>
  selectedConnectionId?: string | undefined
  connections?: AiProviderConnectionView[] | undefined
}

/** pre-provider settings shape (single OpenAI-compatible endpoint); migrated into "custom" */
export interface LegacyAiSettings {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface AiChatRequest {
  settings: AiSettings
  system: string
  user: string
}

export interface AiChatResponse {
  ok: boolean
  content?: string
  error?: string
}

export interface AiStreamRequest {
  requestId: string
  settings: AiSettings
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
  /** Server-owned ORIO agent protocol. System and tool schema fields are empty when this is present. */
  remoteSurface?: 'docs' | 'sheets' | 'slides' | 'slides_qc' | 'pdf' | undefined
  /** Stable renderer-local handle mapped to an opaque ORIO server session. */
  remoteSessionId?: string | undefined
}

export interface AiStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive so the renderer can tell a live stream from a dead one */
  type: 'delta' | 'tool-call' | 'done' | 'error' | 'ping'
  text?: string
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  error?: string
  /** machine-readable error cause ('timeout', exhausted 'credits'); lets the renderer localize the message */
  errorCode?: 'timeout' | 'credits' | 'update_required'
  /** normalized stop reason carried on 'done' ('max_tokens' = output cut off by the token limit) */
  stopReason?: string
}
