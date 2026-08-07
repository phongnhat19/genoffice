import type { AgentMessage, AgentToolDef } from '@genoffice/agent-core'
import { streamAnthropic, type StreamCallbacks } from './stream'
import type { AiProviderConfig } from './types'

const TOOL_SUFFIX = '_ide'
const CLAUDE_CODE_VERSION = '2.1.92'

const DECOY_TOOL_NAMES = [
  'Task', 'TaskOutput', 'TaskStop', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList',
  'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'NotebookEdit', 'WebFetch',
  'WebSearch', 'AskUserQuestion', 'Skill', 'EnterPlanMode', 'ExitPlanMode',
]

function stableUuid(seed: string): string {
  const hash = stableHash(seed)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${((Number.parseInt(hash[16]!, 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

/** Stable, non-secret identifier material. Keeping it browser-safe prevents this adapter leaking Node built-ins into renderers. */
function stableHash(value: string): string {
  const part = (seed: number) => {
    let hash = seed
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }
  return `${part(0x811c9dc5)}${part(0x811c9dc6)}${part(0x811c9dc7)}${part(0x811c9dc8)}`
}

function sessionId(config: AiProviderConfig): string {
  return stableUuid(`claude-session:${config.connectionId ?? 'default'}`)
}

function billingHeader(body: Record<string, unknown>): string {
  const contentHash = stableHash(JSON.stringify(body)).slice(0, 5)
  const build = stableHash(`${Date.now()}:${Math.random()}`).slice(0, 3)
  return `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${build}; cc_entrypoint=sdk-cli; cch=${contentHash};`
}

function renameHistory(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((message) => {
    if (!message || typeof message !== 'object') return message
    const record = message as Record<string, unknown>
    if (!Array.isArray(record.content)) return record
    return {
      ...record,
      content: record.content.map((block) => {
        if (!block || typeof block !== 'object') return block
        const item = block as Record<string, unknown>
        return item.type === 'tool_use' && typeof item.name === 'string'
          ? { ...item, name: `${item.name}${TOOL_SUFFIX}` }
          : item
      }),
    }
  })
}

function cloakBody(body: Record<string, unknown>, config: AiProviderConfig): Record<string, unknown> {
  const sid = sessionId(config)
  const userId = JSON.stringify({
    device_id: stableHash(`device:${config.connectionId ?? 'default'}`),
    account_uuid: stableUuid(`account:${config.connectionId ?? 'default'}`),
    session_id: sid,
  })
  const tools = Array.isArray(body.tools) ? body.tools : []
  const clientTools = tools.map((tool) => {
    if (!tool || typeof tool !== 'object') return tool
    const item = tool as Record<string, unknown>
    return item.type ? item : { ...item, name: `${String(item.name ?? '')}${TOOL_SUFFIX}` }
  })
  const decoys = DECOY_TOOL_NAMES.map((name) => ({
    name,
    description: 'This tool is currently unavailable.',
    input_schema: { type: 'object', properties: {} },
  }))
  const system = Array.isArray(body.system)
    ? [{ type: 'text', text: billingHeader(body) }, ...body.system]
    : [{ type: 'text', text: billingHeader(body) }, { type: 'text', text: String(body.system ?? '') }]
  return {
    ...body,
    system,
    messages: renameHistory(body.messages),
    ...(clientTools.length > 0 ? { tools: [...clientTools, ...decoys] } : {}),
    metadata: { ...(body.metadata as Record<string, unknown> | undefined), user_id: userId },
  }
}

/** Claude Code-compatible OAuth Messages adapter, including 9router-style request cloaking. */
export async function streamClaudeOAuth(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
): Promise<void> {
  const known = new Set(tools.map((tool) => tool.name))
  return streamAnthropic(config, system, messages, tools, maxTokens, cb, 'https://api.anthropic.com', {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28',
      'anthropic-dangerous-direct-browser-access': 'true',
      'user-agent': `claude-cli/${CLAUDE_CODE_VERSION} (external, sdk-cli)`,
      'x-app': 'cli',
      'x-claude-code-session-id': sessionId(config),
      'x-stainless-helper-method': 'stream',
      'x-stainless-retry-count': '0',
      'x-stainless-runtime': 'node',
      'x-stainless-lang': 'js',
      'x-stainless-timeout': '600',
    },
    transformBody: (body) => cloakBody(body, config),
    mapToolName: (name) => {
      if (!name.endsWith(TOOL_SUFFIX)) throw new Error(`Claude Code requested unavailable tool: ${name}`)
      const original = name.slice(0, -TOOL_SUFFIX.length)
      if (!known.has(original)) throw new Error(`Claude Code requested unavailable tool: ${name}`)
      return original
    },
  })
}
