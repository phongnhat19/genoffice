import { useState } from 'react'
import type { AiSettings } from '@genoffice/ai-provider'

/** Compact global connection/model picker used in every suite chat composer. */
export function AiProviderControls({
  settings,
  onSettings,
}: {
  settings: AiSettings
  onSettings(settings: AiSettings): void
}): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle')
  const connection = settings.connections?.find((item) => item.id === 'orio-oauth')
  const connect = async () => {
    if (!connection) return
    setState('loading')
    try {
      await windowProviderApi().oauth('orio-oauth', true)
      onSettings(await windowProviderApi().status())
      void pollOAuthStatus('orio-oauth')
      setState('idle')
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
  if (!connection) return <span className="ai-provider-status">ORIO AI unavailable</span>
  const busy = state === 'loading'
  const needsConnection = connection.status !== 'connected'
  const showConnectAction = needsConnection && connection.status !== 'connecting'
  const status =
    state === 'error'
      ? 'Could not save'
      : state === 'loading'
        ? 'Working…'
        : connection.status === 'connected'
          ? 'Connected'
          : connection.status === 'connecting'
            ? 'Connecting…'
            : connection.status === 'expired'
              ? 'Reconnect'
              : 'Sign-in required'
  return (
    <div className="ai-provider-controls" data-state={state}>
      <span className="ai-provider-field">
        <span className="ai-provider-label">AI service</span>
        <strong>ORIO Cloud AI</strong>
      </span>
      {showConnectAction ? (
        <button
          type="button"
          className="ai-provider-connect"
          disabled={busy}
          onClick={() => void connect()}
        >
          {connection.status === 'expired' ? 'Reauthorize' : 'Authorize'}
        </button>
      ) : (
        <>
          <span className="ai-provider-status" title={connection.email}>
            {status}
          </span>
          <button
            type="button"
            className="ai-provider-connect"
            disabled={busy}
            onClick={() =>
              void windowProviderApi()
                .disconnect()
                .then(onSettings)
                .catch(() => setState('error'))
            }
          >
            Disconnect
          </button>
        </>
      )}
    </div>
  )
}

type ProviderApi = {
  aiSelectConnection?: (id: string, model: string) => Promise<AiSettings>
  aiSaveApiKey?: (id: string, key: string, model?: string) => Promise<AiSettings>
  aiStartOAuth?: (connectionId: string, acknowledgedRisk: boolean) => Promise<void>
  aiOAuthStatus?: () => Promise<AiSettings>
  aiDisconnectConnection?: (id: string) => Promise<AiSettings>
}
function windowProviderApi(): {
  oauth(connectionId: string, acknowledgedRisk: boolean): Promise<void>
  status(): Promise<AiSettings>
  disconnect(): Promise<AiSettings>
} {
  const hosts = window as unknown as {
    desktop?: ProviderApi
    slidesApi?: ProviderApi
    desktopApi?: ProviderApi
    pdfApi?: ProviderApi
  }
  const api = hosts.desktop ?? hosts.slidesApi ?? hosts.desktopApi ?? hosts.pdfApi
  if (!api?.aiStartOAuth || !api.aiOAuthStatus || !api.aiDisconnectConnection)
    throw new Error('AI provider controls are unavailable.')
  return {
    oauth: api.aiStartOAuth,
    status: api.aiOAuthStatus,
    disconnect: () => api.aiDisconnectConnection!('orio-oauth'),
  }
}
