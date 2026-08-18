import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  defaultAiSettings,
  type AiChatResponse,
  type AiSettings,
  type AiStreamChunk,
  type AiStreamRequest,
} from '@genoffice/ai-provider'
import type { SafeStorageLike } from './ai-provider-settings'

type Credential = { accessToken: string; refreshToken: string; expiresAt: number }
type PersistedStore = {
  version: 1
  credential?: string
  status: 'connected' | 'connecting' | 'disconnected' | 'expired'
}
type OAuthConfig = { authUrl: string; appUrl: string; clientId: string; redirectUri: string }
type OrioStreamRequest = {
  requestId: string
  system: string
  messages: AiStreamRequest['messages']
  tools?: AiStreamRequest['tools'] | undefined
  maxTokens?: number | undefined
  remoteSurface?: 'docs' | 'sheets' | 'slides' | 'slides_qc' | 'pdf' | undefined
  remoteSessionId?: string | undefined
}

export interface OrioAiOptions {
  path: () => string
  safeStorage: SafeStorageLike
  openExternal: (url: string) => Promise<void> | void
  env?: NodeJS.ProcessEnv
}

function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`Missing ${name} desktop configuration.`)
  return value
}
function random(size: number) {
  return randomBytes(size).toString('base64url')
}
function challenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url')
}

export class OrioAiService {
  private oauth:
    | {
        server: Server
        state: string
        verifier: string
        expiresAt: number
        callbackPath: string
        timeout: NodeJS.Timeout
      }
    | undefined
  constructor(private readonly options: OrioAiOptions) {}
  private readonly remoteSessions = new Map<string, string>()

  private config(): OAuthConfig {
    const env = this.options.env ?? process.env
    const authUrl = required('ORIO_AUTH_URL', env.ORIO_AUTH_URL).replace(/\/$/, '')
    const appUrl = required('ORIO_WEB_URL', env.ORIO_WEB_URL).replace(/\/$/, '')
    const clientId = required('ORIO_DESKTOP_OAUTH_CLIENT_ID', env.ORIO_DESKTOP_OAUTH_CLIENT_ID)
    const redirectUri = required(
      'ORIO_DESKTOP_OAUTH_REDIRECT_URI',
      env.ORIO_DESKTOP_OAUTH_REDIRECT_URI,
    )
    const callback = new URL(redirectUri)
    if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1')
      throw new Error(
        'ORIO_DESKTOP_OAUTH_REDIRECT_URI must be an exact http://127.0.0.1 callback URL.',
      )
    if (!callback.port)
      throw new Error('ORIO_DESKTOP_OAUTH_REDIRECT_URI must include its fixed loopback port.')
    return { authUrl, appUrl, clientId, redirectUri }
  }

  private empty(): PersistedStore {
    return { version: 1, status: 'disconnected' }
  }
  private read(): PersistedStore {
    try {
      const path = this.options.path()
      if (!existsSync(path)) return this.empty()
      const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<PersistedStore>
      if (
        value.version === 1 &&
        ['connected', 'connecting', 'disconnected', 'expired'].includes(String(value.status))
      )
        return {
          version: 1,
          status: value.status!,
          ...(value.credential ? { credential: value.credential } : {}),
        }
      // Replacing the legacy settings file intentionally removes direct-provider credentials.
      const migrated = this.empty()
      this.write(migrated)
      return migrated
    } catch {
      // A malformed legacy file must not retain an unknown direct-provider blob.
      const migrated = this.empty()
      try {
        this.write(migrated)
      } catch {
        // The caller will surface normal credential-storage errors if the path remains unusable.
      }
      return migrated
    }
  }
  private write(value: PersistedStore) {
    const path = this.options.path()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
  }
  private encrypt(value: Credential) {
    if (!this.options.safeStorage.isEncryptionAvailable())
      throw new Error('Secure credential storage is unavailable on this device.')
    return this.options.safeStorage.encryptString(JSON.stringify(value)).toString('base64')
  }
  private decrypt(store: PersistedStore): Credential | undefined {
    if (!store.credential || !this.options.safeStorage.isEncryptionAvailable()) return undefined
    try {
      return JSON.parse(
        this.options.safeStorage.decryptString(Buffer.from(store.credential, 'base64')),
      ) as Credential
    } catch {
      return undefined
    }
  }

  async view(): Promise<AiSettings> {
    const store = this.read()
    const settings = defaultAiSettings()
    const connected = store.status === 'connected' && Boolean(this.decrypt(store))
    settings.provider = 'orio'
    settings.selectedConnectionId = 'orio-oauth'
    settings.providers.orio = {
      apiKey: '',
      model: 'ORIO managed',
      authType: 'oauth',
      connectionId: 'orio-oauth',
    }
    settings.connections = [
      {
        id: 'orio-oauth',
        providerId: 'orio',
        authType: 'oauth',
        enabled: connected,
        model: 'ORIO managed',
        status: connected
          ? 'connected'
          : store.status === 'connecting'
            ? 'connecting'
            : store.status === 'expired'
              ? 'expired'
              : 'disconnected',
      },
    ]
    return settings
  }

  async startAuthorization(): Promise<void> {
    if (this.oauth?.expiresAt && this.oauth.expiresAt > Date.now()) return
    const config = this.config()
    const callback = new URL(config.redirectUri)
    const state = random(32)
    const verifier = random(64)
    const server = createServer(
      (request, response) => void this.handleCallback(request.url ?? '/', response),
    )
    await new Promise<void>((resolve, reject) =>
      server
        .once('error', reject)
        .listen(Number(callback.port), callback.hostname, () => resolve()),
    )
    const expiresAt = Date.now() + 5 * 60_000
    const timeout = setTimeout(() => {
      if (this.oauth?.server === server) {
        server.close()
        this.oauth = undefined
        this.write({ version: 1, status: 'expired' })
      }
    }, 5 * 60_000)
    this.oauth = { server, state, verifier, expiresAt, callbackPath: callback.pathname, timeout }
    this.write({ version: 1, status: 'connecting' })
    const url = new URL(`${config.authUrl}/oauth/authorize`)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
      scope: 'email',
      code_challenge: challenge(verifier),
      code_challenge_method: 'S256',
    }).toString()
    try {
      await this.options.openExternal(url.toString())
    } catch (error) {
      clearTimeout(timeout)
      server.close()
      this.oauth = undefined
      this.write(this.empty())
      throw error
    }
  }

  private async handleCallback(path: string, response: import('node:http').ServerResponse) {
    const oauth = this.oauth
    const callback = new URL(path, 'http://127.0.0.1')
    const params = callback.searchParams
    const finish = (ok: boolean, message: string) => {
      response.writeHead(ok ? 200 : 400, {
        connection: 'close',
        'content-type': 'text/html; charset=utf-8',
      })
      response.end(`<h2>${message}</h2><p>You can return to ORIO.</p>`)
      if (oauth) clearTimeout(oauth.timeout)
      oauth?.server.close()
      this.oauth = undefined
    }

    // Browsers may request /favicon.ico or revisit the callback after a
    // successful redirect. Those requests are unrelated to the OAuth result
    // and must never overwrite a valid token set with an expired state.
    if (!oauth || callback.pathname !== oauth.callbackPath) {
      response.writeHead(404, { connection: 'close', 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }

    if (
      oauth.expiresAt < Date.now() ||
      params.get('state') !== oauth.state ||
      params.get('error') ||
      !params.get('code')
    ) {
      this.write({ version: 1, status: 'expired' })
      finish(false, 'Authorization could not be completed.')
      return
    }
    try {
      const config = this.config()
      const token = await fetch(`${config.authUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.get('code')!,
          client_id: config.clientId,
          redirect_uri: config.redirectUri,
          code_verifier: oauth.verifier,
        }),
      })
      const value = (await token.json()) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
      }
      if (!token.ok || !value.access_token || !value.refresh_token)
        throw new Error('Token exchange failed.')
      this.write({
        version: 1,
        status: 'connected',
        credential: this.encrypt({
          accessToken: value.access_token,
          refreshToken: value.refresh_token,
          expiresAt: Date.now() + Math.max(60, value.expires_in ?? 3600) * 1000,
        }),
      })
      finish(true, 'ORIO Desktop is authorized.')
    } catch {
      this.write({ version: 1, status: 'expired' })
      finish(false, 'Authorization could not be completed.')
    }
  }

  async disconnect() {
    this.write(this.empty())
    return this.view()
  }
  private async token(): Promise<string> {
    const store = this.read()
    const credential = this.decrypt(store)
    if (!credential) throw new Error('Authorize ORIO Desktop before using AI.')
    if (credential.expiresAt > Date.now() + 60_000) return credential.accessToken
    const config = this.config()
    const response = await fetch(`${config.authUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credential.refreshToken,
        client_id: config.clientId,
      }),
    })
    const value = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!response.ok || !value.access_token) {
      this.write({ version: 1, status: 'expired' })
      throw new Error('ORIO authorization expired. Authorize again to continue.')
    }
    this.write({
      version: 1,
      status: 'connected',
      credential: this.encrypt({
        accessToken: value.access_token,
        refreshToken: value.refresh_token ?? credential.refreshToken,
        expiresAt: Date.now() + Math.max(60, value.expires_in ?? 3600) * 1000,
      }),
    })
    return value.access_token
  }
  private async request(path: string, body: unknown, signal?: AbortSignal) {
    const config = this.config()
    const response = await fetch(`${config.appUrl}${path}`, {
      method: 'POST',
      ...(signal ? { signal } : {}),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await this.token()}`,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as {
        error?: { message?: string }
      } | null
      if (response.status === 401 || response.status === 403)
        this.write({ version: 1, status: 'expired' })
      throw new Error(detail?.error?.message ?? 'ORIO AI request failed.')
    }
    return response
  }
  async chat(request: {
    requestId: string
    system: string
    user: string
  }): Promise<AiChatResponse> {
    const response = await this.request('/api/v1/ai/chat', request)
    return (await response.json()) as AiChatResponse
  }
  async stream(
    request: OrioStreamRequest,
    onChunk: (chunk: AiStreamChunk) => void,
    signal: AbortSignal,
  ) {
    const remote = request.remoteSurface && request.remoteSessionId
    const lastMessage = request.messages.at(-1)
    const remoteSession = remote ? this.remoteSessions.get(request.remoteSessionId!) : undefined
    const endpoint = remote
      ? remoteSession && lastMessage?.role === 'tool'
        ? '/api/v1/ai/agent/continue'
        : remoteSession && lastMessage?.role === 'user'
          ? '/api/v1/ai/agent/message'
          : '/api/v1/ai/agent/start'
      : '/api/v1/ai/stream'
    const body = remote
      ? remoteSession && lastMessage?.role === 'tool'
        ? { requestId: request.requestId, sessionId: remoteSession, toolResults: lastMessage.results }
        : remoteSession && lastMessage?.role === 'user'
          ? { requestId: request.requestId, sessionId: remoteSession, instruction: lastMessage.text, images: lastMessage.images }
          : { requestId: request.requestId, surface: request.remoteSurface, instruction: lastMessage?.role === 'user' ? lastMessage.text : '', images: lastMessage?.role === 'user' ? lastMessage.images : undefined }
      : request
    const response = await this.request(endpoint, body, signal)
    if (!response.body) throw new Error('ORIO AI stream is unavailable.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const chunk = JSON.parse(line.slice(5).trim()) as { type: AiStreamChunk['type'] | 'session'; sessionId?: string; requestId?: string; text?: string; toolCall?: AiStreamChunk['toolCall']; error?: string; errorCode?: AiStreamChunk['errorCode']; stopReason?: string }
          if (remote && chunk.type === 'session' && chunk.sessionId) {
            this.remoteSessions.set(request.remoteSessionId!, chunk.sessionId)
            continue
          }
          onChunk({ ...chunk, requestId: request.requestId } as AiStreamChunk)
        } catch {
          /* ignore malformed keepalive */
        }
      }
    }
  }
}
