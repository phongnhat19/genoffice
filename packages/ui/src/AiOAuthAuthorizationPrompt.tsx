import type { AiSettings } from '@genoffice/ai-provider'
import { AiProviderControls } from './AiProviderControls'

/** True only after the ORIO OAuth connection can safely accept AI requests. */
export function isAiOAuthAuthorized(settings: AiSettings | null | undefined): boolean {
  return (
    settings?.connections?.some(
      (connection) => connection.id === 'orio-oauth' && connection.status === 'connected',
    ) ?? false
  )
}

/**
 * Empty state used in place of a chat composer until ORIO OAuth is authorized.
 * Keeping the authorization action here ensures every desktop editor has the
 * same safe, deliberate first-run experience.
 */
export function AiOAuthAuthorizationPrompt({
  settings,
  onSettings,
}: {
  settings: AiSettings | null | undefined
  onSettings(settings: AiSettings): void
}): React.JSX.Element {
  return (
    <section className="ai-oauth-gate" aria-live="polite">
      <svg className="ai-oauth-gate-illustration" viewBox="0 0 96 72" fill="none" aria-hidden>
        <rect x="19" y="18" width="58" height="39" rx="10" fill="currentColor" opacity=".12" />
        <path
          d="M37 35.5a11 11 0 0 1 22 0v4.5h3.5a4.5 4.5 0 0 1 4.5 4.5v7a4.5 4.5 0 0 1-4.5 4.5h-29a4.5 4.5 0 0 1-4.5-4.5v-7a4.5 4.5 0 0 1 4.5-4.5H37v-4.5Z"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <circle cx="48" cy="47" r="2.5" fill="currentColor" />
        <path d="M48 49.5v2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path
          d="m72 14 2.2 4.8L79 21l-4.8 2.2L72 28l-2.2-4.8L65 21l4.8-2.2L72 14Z"
          fill="currentColor"
        />
      </svg>
      <strong>Authorize ORIO AI</strong>
      <p>Sign in with OAuth to start using the AI assistant.</p>
      {settings ? (
        <AiProviderControls settings={settings} onSettings={onSettings} />
      ) : (
        <span className="ai-oauth-gate-loading">Checking authorization…</span>
      )}
    </section>
  )
}
