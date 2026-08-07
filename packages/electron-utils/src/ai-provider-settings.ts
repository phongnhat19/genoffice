import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  defaultAiSettings,
  CLAUDE_MODELS,
  OPENAI_CODEX_MODELS,
  OPENROUTER_MODELS,
  type AiConnectionStatus,
  type AiProviderConfig,
  type AiProviderConnectionView,
  type AiProviderId,
  type AiSettings,
} from '@genoffice/ai-provider'

const OPENAI_API_MODELS = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1'] as const
const OPENROUTER_API_MODELS = OPENROUTER_MODELS
const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
// Codex CLI's public OAuth client/loopback redirect, mirrored from 9router's Codex provider.
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CLAUDE_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const CLAUDE_TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token'
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CLAUDE_REFRESH_LEAD_MS = 4 * 60 * 60 * 1000
type OAuthConnectionId = 'openai-oauth' | 'claude-oauth'

type Credential = {
  apiKey?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}
type PersistedConnection = Omit<AiProviderConnectionView, 'status'> & {
  status: AiConnectionStatus
  credential?: string | undefined
}
interface PersistedStore {
  version: 2
  selectedConnectionId: string
  connections: PersistedConnection[]
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface ProviderSettingsOptions {
  path: () => string
  safeStorage: SafeStorageLike
  openExternal(url: string): Promise<void> | void
}

function defaultStore(): PersistedStore {
  return {
    version: 2,
    selectedConnectionId: 'openai-oauth',
    connections: [
      {
        id: 'claude-oauth',
        providerId: 'anthropic',
        authType: 'oauth',
        enabled: false,
        model: CLAUDE_MODELS[0],
        status: 'disconnected',
      },
      {
        id: 'openai-oauth',
        providerId: 'openai',
        authType: 'oauth',
        enabled: false,
        model: OPENAI_CODEX_MODELS[0],
        status: 'disconnected',
      },
      {
        id: 'openai-api-key',
        providerId: 'openai',
        authType: 'api-key',
        enabled: false,
        model: OPENAI_API_MODELS[0],
        status: 'disconnected',
      },
      {
        id: 'openrouter-api-key',
        providerId: 'openrouter',
        authType: 'api-key',
        enabled: false,
        model: OPENROUTER_API_MODELS[0],
        status: 'disconnected',
      },
    ],
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}
function b64(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}
function validConnectionId(
  value: unknown,
): value is 'claude-oauth' | 'openai-oauth' | 'openai-api-key' | 'openrouter-api-key' {
  return value === 'claude-oauth' || value === 'openai-oauth' || value === 'openai-api-key' || value === 'openrouter-api-key'
}

/** Pure OAuth URL builder so the protocol can be verified without opening a loopback listener. */
export function buildCodexAuthorizeUrl(
  state: string,
  verifier: string,
  redirectUri: string,
): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    state,
    code_challenge: hash(verifier),
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  })
  return `${CODEX_AUTHORIZE_URL}?${query}`
}

/** Claude Code-compatible PKCE URL; token exchange is JSON rather than form encoded. */
export function buildClaudeAuthorizeUrl(state: string, verifier: string, redirectUri: string): string {
  const query = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'org:create_api_key user:profile user:inference',
    state,
    code_challenge: hash(verifier),
    code_challenge_method: 'S256',
  })
  return `${CLAUDE_AUTHORIZE_URL}?${query}`
}

/** Suite-wide, encrypted connection metadata store. Credentials never leave this class. */
export class AiProviderSettingsService {
  private oauth:
    | { server: Server; connectionId: OAuthConnectionId; state: string; verifier: string; redirectUri: string; expiresAt: number }
    | undefined
  constructor(private readonly options: ProviderSettingsOptions) {}

  private read(): PersistedStore {
    try {
      const path = this.options.path()
      if (!existsSync(path)) return defaultStore()
      const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<PersistedStore> & {
        provider?: AiProviderId
        providers?: Record<string, AiProviderConfig>
      }
      if (
        value.version === 2 &&
        Array.isArray(value.connections) &&
        validConnectionId(value.selectedConnectionId)
      ) {
        const defaults = defaultStore()
        return {
          version: 2,
          selectedConnectionId: value.selectedConnectionId,
          connections: defaults.connections.map((fallback) => {
            const saved = value.connections!.find((item) => item?.id === fallback.id)
            return saved && validConnectionId(saved.id) ? { ...fallback, ...saved } : fallback
          }),
        }
      }
      // Legacy files may contain an OpenAI key in the old provider map. Immediately migrate it into an encrypted blob.
      const next = defaultStore()
      const legacyOpenAiKey = value.providers?.openai?.apiKey
      if (typeof legacyOpenAiKey === 'string' && legacyOpenAiKey.trim()) {
        const connection = next.connections.find((item) => item.id === 'openai-api-key')!
        connection.enabled = true
        connection.status = 'connected'
        connection.credential = this.encrypt({ apiKey: legacyOpenAiKey.trim() })
        next.selectedConnectionId =
          value.provider === 'openai' ? 'openai-api-key' : next.selectedConnectionId
      }
      const legacyOpenRouterKey = value.providers?.openrouter?.apiKey
      if (typeof legacyOpenRouterKey === 'string' && legacyOpenRouterKey.trim()) {
        const connection = next.connections.find((item) => item.id === 'openrouter-api-key')!
        connection.enabled = true
        connection.status = 'connected'
        connection.credential = this.encrypt({ apiKey: legacyOpenRouterKey.trim() })
        next.selectedConnectionId =
          value.provider === 'openrouter' ? 'openrouter-api-key' : next.selectedConnectionId
      }
      this.write(next)
      return next
    } catch {
      return defaultStore()
    }
  }

  private write(store: PersistedStore): void {
    const path = this.options.path()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(store, null, 2), 'utf8')
  }
  private encrypt(credential: Credential): string {
    if (!this.options.safeStorage.isEncryptionAvailable())
      throw new Error('Secure credential storage is unavailable on this device.')
    return this.options.safeStorage.encryptString(JSON.stringify(credential)).toString('base64')
  }
  private decrypt(connection: PersistedConnection): Credential {
    if (!connection.credential || !this.options.safeStorage.isEncryptionAvailable()) return {}
    try {
      return JSON.parse(
        this.options.safeStorage.decryptString(Buffer.from(connection.credential, 'base64')),
      ) as Credential
    } catch {
      return {}
    }
  }
  private connection(store: PersistedStore, id: string): PersistedConnection {
    const found = store.connections.find((item) => item.id === id)
    if (!found) throw new Error('Unknown AI connection.')
    return found
  }
  async view(): Promise<AiSettings> {
    const store = this.read()
    const selected = this.connection(store, store.selectedConnectionId)
    const settings = defaultAiSettings()
    settings.provider = selected.providerId
    settings.selectedConnectionId = selected.id
    settings.connections = store.connections.map(
      ({ credential: _credential, ...connection }) => connection,
    )
    settings.providers[selected.providerId] = {
      apiKey: '',
      model: selected.model,
      authType: selected.authType,
    }
    return settings
  }

  async select(id: unknown, model: unknown): Promise<AiSettings> {
    if (!validConnectionId(id) || typeof model !== 'string')
      throw new Error('Invalid AI connection selection.')
    const store = this.read()
    const connection = this.connection(store, id)
    const allowed =
      connection.id === 'claude-oauth'
        ? CLAUDE_MODELS
        : connection.id === 'openai-oauth'
        ? OPENAI_CODEX_MODELS
        : connection.id === 'openrouter-api-key'
          ? OPENROUTER_API_MODELS
          : OPENAI_API_MODELS
    if (!allowed.includes(model as never))
      throw new Error('This model is not available for the selected connection.')
    connection.model = model
    store.selectedConnectionId = id
    this.write(store)
    return this.view()
  }

  async saveApiKey(id: unknown, apiKey: unknown, model?: unknown): Promise<AiSettings> {
    if (id !== 'openai-api-key' && id !== 'openrouter-api-key')
      throw new Error('This connection does not use an API key.')
    if (typeof apiKey !== 'string' || !apiKey.trim())
      throw new Error(`Enter an ${id === 'openrouter-api-key' ? 'OpenRouter' : 'OpenAI'} API key.`)
    const store = this.read()
    const connection = this.connection(store, id)
    const allowed = id === 'openrouter-api-key' ? OPENROUTER_API_MODELS : OPENAI_API_MODELS
    if (typeof model === 'string' && allowed.includes(model as never)) connection.model = model
    connection.credential = this.encrypt({ apiKey: apiKey.trim() })
    connection.enabled = true
    connection.status = 'connected'
    store.selectedConnectionId = connection.id
    this.write(store)
    return this.view()
  }

  async disconnect(id: unknown): Promise<AiSettings> {
    if (!validConnectionId(id)) throw new Error('Unknown AI connection.')
    const store = this.read()
    const connection = this.connection(store, id)
    connection.credential = undefined
    connection.enabled = false
    connection.status = 'disconnected'
    delete connection.email
    if (store.selectedConnectionId === id) store.selectedConnectionId = 'openai-oauth'
    this.write(store)
    return this.view()
  }

  async startOAuth(connectionId: unknown, acknowledgedRisk = false): Promise<void> {
    if (connectionId !== 'openai-oauth' && connectionId !== 'claude-oauth')
      throw new Error('This connection does not use OAuth.')
    if (connectionId === 'claude-oauth' && acknowledgedRisk !== true)
      throw new Error('Confirm the Claude Code OAuth risk notice before signing in.')
    if (this.oauth && this.oauth.expiresAt > Date.now()) return
    const state = b64(32),
      verifier = b64(64)
    const server = createServer(
      (request, response) => void this.handleCallback(request.url ?? '', response),
    )
    await new Promise<void>((resolve, reject) =>
      server.once('error', reject).listen(connectionId === 'openai-oauth' ? 1455 : 0, '127.0.0.1', () => resolve()),
    )
    const port = (server.address() as { port: number }).port
    const redirectUri = connectionId === 'openai-oauth'
      ? 'http://localhost:1455/auth/callback'
      : `http://127.0.0.1:${port}/callback`
    this.oauth = { server, connectionId, state, verifier, redirectUri, expiresAt: Date.now() + 5 * 60_000 }
    const store = this.read()
    const connection = this.connection(store, connectionId)
    connection.status = 'connecting'
    this.write(store)
    const expiry = setTimeout(() => {
      if (this.oauth?.state !== state) return
      this.oauth.server.close()
      this.oauth = undefined
      const expired = this.read()
      this.connection(expired, connectionId).status = 'expired'
      this.write(expired)
    }, 5 * 60_000)
    expiry.unref()
    try {
      await this.options.openExternal(
        connectionId === 'openai-oauth'
          ? buildCodexAuthorizeUrl(state, verifier, redirectUri)
          : buildClaudeAuthorizeUrl(state, verifier, redirectUri),
      )
    } catch (error) {
      clearTimeout(expiry)
      server.close()
      this.oauth = undefined
      connection.status = 'needs-auth'
      this.write(store)
      throw error
    }
  }

  private async handleCallback(
    url: string,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const oauth = this.oauth
    const params = new URL(url, 'http://127.0.0.1').searchParams
    const finish = (ok: boolean, message: string) => {
      response.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<h2>${message}</h2><p>You can return to Smart Office.</p>`)
      oauth?.server.close()
      this.oauth = undefined
    }
    if (
      !oauth ||
      oauth.expiresAt < Date.now() ||
      params.get('state') !== oauth.state ||
      params.get('error') ||
      !params.get('code')
    ) {
      finish(false, 'Sign-in could not be completed.')
      return
    }
    try {
      const token = await this.exchange(oauth.connectionId, {
        grant_type: 'authorization_code',
        code: params.get('code')!,
        redirect_uri: oauth.redirectUri,
        code_verifier: oauth.verifier,
        ...(oauth.connectionId === 'claude-oauth' ? { state: oauth.state } : {}),
      })
      const store = this.read()
      const connection = this.connection(store, oauth.connectionId)
      connection.credential = this.encrypt(token)
      connection.enabled = true
      connection.status = 'connected'
      store.selectedConnectionId = connection.id
      this.write(store)
      finish(true, oauth.connectionId === 'claude-oauth' ? 'Claude is connected.' : 'OpenAI is connected.')
    } catch {
      const store = this.read()
      this.connection(store, oauth.connectionId).status = 'expired'
      this.write(store)
      finish(false, 'Sign-in failed. Please try again.')
    }
  }

  private async exchange(
    connectionId: OAuthConnectionId,
    body: Record<string, string>,
    previousRefreshToken?: string,
  ): Promise<Credential> {
    const isClaude = connectionId === 'claude-oauth'
    const code = body.code
    const [authCode = '', hashState = ''] = code?.split('#') ?? []
    const payload = isClaude && code
      ? { ...body, code: authCode, state: hashState || body.state || '' }
      : body
    const response = await fetch(isClaude ? CLAUDE_TOKEN_URL : CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': isClaude ? 'application/json' : 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: isClaude
        ? JSON.stringify({ client_id: CLAUDE_CLIENT_ID, ...payload })
        : new URLSearchParams({ client_id: CODEX_CLIENT_ID, ...payload }),
    })
    if (!response.ok) throw new Error(`${isClaude ? 'Claude' : 'OpenAI'} token exchange failed.`)
    const value = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    const refreshToken = value.refresh_token ?? previousRefreshToken
    if (!value.access_token || !refreshToken)
      throw new Error(`${isClaude ? 'Claude' : 'OpenAI'} did not return a renewable credential.`)
    return {
      accessToken: value.access_token,
      refreshToken,
      expiresAt: Date.now() + Math.max(60, value.expires_in ?? 3600) * 1000,
    }
  }

  async oauthStatus(): Promise<AiSettings> {
    return this.view()
  }
  async refreshOAuthConnection(connectionId: unknown): Promise<boolean> {
    if (connectionId !== 'openai-oauth' && connectionId !== 'claude-oauth') return false
    const store = this.read()
    const connection = this.connection(store, connectionId)
    const credential = this.decrypt(connection)
    if (!credential.refreshToken) return false
    try {
      connection.credential = this.encrypt(
        await this.exchange(
          connectionId,
          { grant_type: 'refresh_token', refresh_token: credential.refreshToken },
          credential.refreshToken,
        ),
      )
      connection.status = 'connected'
      connection.enabled = true
      this.write(store)
      return true
    } catch {
      connection.status = 'expired'
      this.write(store)
      return false
    }
  }
  async refreshSelectedOAuth(): Promise<boolean> {
    const store = this.read()
    return this.refreshOAuthConnection(store.selectedConnectionId)
  }
  async config(): Promise<{
    provider: AiProviderId
    config?: AiProviderConfig
    connectionId: string
  }> {
    const store = this.read()
    const connection = this.connection(store, store.selectedConnectionId)
    if (!connection.enabled || connection.status !== 'connected')
      return { provider: connection.providerId, connectionId: connection.id }
    const credential = this.decrypt(connection)
    if (
      (connection.id === 'openai-oauth' || connection.id === 'claude-oauth') &&
      credential.refreshToken &&
      (!credential.expiresAt || credential.expiresAt < Date.now() + (connection.id === 'claude-oauth' ? CLAUDE_REFRESH_LEAD_MS : 60_000))
    ) {
      if (!(await this.refreshOAuthConnection(connection.id)))
        return { provider: connection.providerId, connectionId: connection.id }
      return this.config()
    }
    const current = this.decrypt(connection)
    return {
      provider: connection.providerId,
      connectionId: connection.id,
      config: {
        apiKey:
          connection.authType === 'oauth' ? (current.accessToken ?? '') : (current.apiKey ?? ''),
        model: connection.model,
        authType: connection.authType,
        connectionId: connection.id,
      },
    }
  }
}
