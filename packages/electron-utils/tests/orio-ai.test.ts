import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrioAiService } from '../src/orio-ai'

const directories: string[] = []

function service(
  initial?: unknown,
  options: Partial<{
    env: NodeJS.ProcessEnv
    openExternal: (url: string) => Promise<void> | void
  }> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'orio-oauth-'))
  directories.push(directory)
  const path = join(directory, 'ai-settings.json')
  if (initial) writeFileSync(path, JSON.stringify(initial))
  return {
    path,
    service: new OrioAiService({
      path: () => path,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
      },
      openExternal: options.openExternal ?? (() => undefined),
      env: options.env ?? {},
    }),
  }
}

function responseStub() {
  return {
    end: () => undefined,
    writeHead: () => undefined,
  } as unknown as ServerResponse
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('OrioAiService', () => {
  it('erases a legacy direct-provider credential and exposes only the ORIO connection', async () => {
    const { path, service: orio } = service({
      version: 2,
      selectedConnectionId: 'openrouter-api-key',
      connections: [
        { id: 'openrouter-api-key', credential: 'encrypted:{"apiKey":"sk-or-secret"}' },
      ],
    })

    const view = await orio.view()

    expect(view.provider).toBe('orio')
    expect(view.connections).toEqual([
      expect.objectContaining({ id: 'orio-oauth', providerId: 'orio', status: 'disconnected' }),
    ])
    expect(readFileSync(path, 'utf8')).not.toContain('sk-or-secret')
  })

  it('fails closed when the required desktop OAuth configuration is absent', async () => {
    const { service: orio } = service()
    await expect(orio.startAuthorization()).rejects.toThrow('Missing ORIO_AUTH_URL')
  })

  it('keeps a completed OAuth credential when the browser requests an unrelated loopback path', async () => {
    const opened: string[] = []
    const port = 20_000 + Math.floor(Math.random() * 20_000)
    const { path, service: orio } = service(undefined, {
      env: {
        ORIO_AUTH_URL: 'http://auth.test/auth/v1',
        ORIO_WEB_URL: 'http://orio.test',
        ORIO_DESKTOP_OAUTH_CLIENT_ID: 'desktop-test-client',
        ORIO_DESKTOP_OAUTH_REDIRECT_URI: `http://127.0.0.1:${port}/oauth/callback`,
      },
      openExternal: (url) => {
        opened.push(url)
      },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
    try {
      await orio.startAuthorization()
      const authorizeUrl = new URL(opened[0]!)
      const callback = (orio as unknown as {
        handleCallback(path: string, response: ServerResponse): Promise<void>
      }).handleCallback.bind(orio)

      await callback(
        `/oauth/callback?state=${authorizeUrl.searchParams.get('state')}&code=authorization-code`,
        responseStub(),
      )
      await callback('/favicon.ico', responseStub())

      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
        status: 'connected',
        credential: expect.any(String),
      })
      expect((await orio.view()).connections?.[0]?.status).toBe('connected')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
