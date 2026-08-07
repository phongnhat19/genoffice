import { useState } from 'react'
import { CLAUDE_MODELS, OPENROUTER_MODELS, type AiSettings } from '@genoffice/ai-provider'

const models = {
  'claude-oauth': CLAUDE_MODELS,
  'openai-oauth': ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  'openai-api-key': ['gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1'],
  'openrouter-api-key': OPENROUTER_MODELS,
} as const

/** Compact global connection/model picker used in every suite chat composer. */
export function AiProviderControls({
  settings,
  onSettings,
}: {
  settings: AiSettings
  onSettings(settings: AiSettings): void
}): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle')
  const connection =
    settings.connections?.find((item) => item.id === settings.selectedConnectionId) ??
    settings.connections?.[0]
  const choose = async (id: string, model: string) => {
    setState('loading')
    try {
      onSettings(await windowProviderApi().select(id, model))
      setState('success')
    } catch {
      setState('error')
    }
  }
  const connect = async () => {
    if (!connection) return
    setState('loading')
    try {
      if (connection.id === 'openai-oauth' || connection.id === 'claude-oauth') {
        const acknowledgedRisk =
          connection.id !== 'claude-oauth' ||
          window.confirm(
            'Claude Code OAuth is intended for the Claude Code client, not generic proxy or router use. Anthropic may restrict your account. Continue to sign in?',
          )
        if (!acknowledgedRisk) {
          setState('idle')
          return
        }
        await windowProviderApi().oauth(connection.id, acknowledgedRisk)
        void pollOAuthStatus(connection.id)
      } else {
        const key = window.prompt(
          `Enter your ${connection.id === 'openrouter-api-key' ? 'OpenRouter' : 'OpenAI'} API key`,
        )
        if (key) onSettings(await windowProviderApi().apiKey(connection.id, key, connection.model))
      }
      setState('success')
    } catch {
      setState('error')
    }
  }
  const pollOAuthStatus = async (connectionId: string) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 2_000))
      try {
        const next = await windowProviderApi().status()
        onSettings(next)
        const oauth = next.connections?.find((item) => item.id === connectionId)
        if (!oauth || oauth.status !== 'connecting') {
          setState(oauth?.status === 'connected' ? 'success' : 'idle')
          return
        }
      } catch {
        setState('error')
        return
      }
    }
    setState('idle')
  }
  if (!connection) return <span className="ai-provider-status">AI unavailable</span>
  const available = models[connection.id as keyof typeof models] ?? [connection.model]
  const busy = state === 'loading'
  const needsConnection = connection.status !== 'connected'
  const showConnectAction = needsConnection && connection.status !== 'connecting'
  const status =
    state === 'error'
      ? 'Could not save'
      : state === 'loading'
        ? 'Working…'
        : state === 'success'
          ? 'Saved'
          : connection.status === 'connected'
            ? 'Connected'
            : connection.status === 'connecting'
              ? 'Connecting…'
              : connection.status === 'expired'
                ? 'Reconnect'
                : 'Sign-in required'
  return (
    <div className="ai-provider-controls" data-state={state}>
      <label className="ai-provider-field">
        <span className="ai-provider-label">Provider</span>
        <select
          aria-label="AI provider"
          disabled={busy}
          value={connection.id}
          onChange={(event) =>
            void choose(
              event.target.value,
              (models[event.target.value as keyof typeof models] ?? [connection.model])[0],
            )
          }
        >
          <option value="claude-oauth">Claude · OAuth</option>
          <option value="openai-oauth">OpenAI · Codex OAuth</option>
          <option value="openai-api-key">OpenAI · API key</option>
          <option value="openrouter-api-key">OpenRouter · API key</option>
        </select>
      </label>
      <label className="ai-provider-field">
        <span className="ai-provider-label">Model</span>
        <select
          aria-label="AI model"
          disabled={busy}
          value={connection.model}
          onChange={(event) => void choose(connection.id, event.target.value)}
        >
          {available.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      {showConnectAction ? (
        <button
          type="button"
          className="ai-provider-connect"
          disabled={busy}
          onClick={() => void connect()}
        >
          {connection.status === 'expired'
            ? 'Reconnect'
            : connection.id === 'openai-oauth' || connection.id === 'claude-oauth'
              ? 'Sign in'
              : 'Add key'}
        </button>
      ) : (
        <span className="ai-provider-status" title={connection.email}>
          {status}
        </span>
      )}
    </div>
  )
}

type ProviderApi = {
  aiSelectConnection?: (id: string, model: string) => Promise<AiSettings>
  aiSaveApiKey?: (id: string, key: string, model?: string) => Promise<AiSettings>
  aiStartOAuth?: (connectionId: string, acknowledgedRisk: boolean) => Promise<void>
  aiOAuthStatus?: () => Promise<AiSettings>
}
function windowProviderApi(): {
  select(id: string, model: string): Promise<AiSettings>
  apiKey(id: string, key: string, model?: string): Promise<AiSettings>
  oauth(connectionId: string, acknowledgedRisk: boolean): Promise<void>
  status(): Promise<AiSettings>
} {
  const hosts = window as unknown as {
    desktop?: ProviderApi
    slidesApi?: ProviderApi
    desktopApi?: ProviderApi
  }
  const api = hosts.desktop ?? hosts.slidesApi ?? hosts.desktopApi
  if (!api?.aiSelectConnection || !api.aiSaveApiKey || !api.aiStartOAuth || !api.aiOAuthStatus)
    throw new Error('AI provider controls are unavailable.')
  return {
    select: api.aiSelectConnection,
    apiKey: api.aiSaveApiKey,
    oauth: api.aiStartOAuth,
    status: api.aiOAuthStatus,
  }
}
