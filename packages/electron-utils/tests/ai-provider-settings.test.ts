import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AiProviderSettingsService, buildCodexAuthorizeUrl } from '../src/ai-provider-settings'

const directories: string[] = []
function service(initial?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-ai-settings-'))
  directories.push(dir)
  const path = join(dir, 'ai-settings.json')
  if (initial) writeFileSync(path, JSON.stringify(initial))
  return {
    path,
    service: new AiProviderSettingsService({
      path: () => path,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
      },
      openExternal: () => undefined,
    }),
  }
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('AiProviderSettingsService', () => {
  it('migrates a legacy OpenAI key into an encrypted blob and never returns it', async () => {
    const { path, service: settings } = service({
      provider: 'openai',
      providers: { openai: { apiKey: 'sk-secret', model: 'gpt-4.1' } },
    })
    const view = await settings.view()
    expect(view.selectedConnectionId).toBe('openai-api-key')
    expect(JSON.stringify(view)).not.toContain('sk-secret')
    const stored = readFileSync(path, 'utf8')
    expect(stored).toContain('credential')
    expect(stored).not.toContain('"apiKey": "sk-secret"')
  })

  it('persists a selected OAuth model and disconnect clears its credential', async () => {
    const { path, service: settings } = service()
    await settings.saveApiKey('openai-api-key', 'sk-secret', 'gpt-5.4-mini')
    const selected = await settings.select('openai-oauth', 'gpt-5.6-terra')
    expect(selected.selectedConnectionId).toBe('openai-oauth')
    expect(selected.connections?.find((item) => item.id === 'openai-oauth')?.model).toBe(
      'gpt-5.6-terra',
    )
    await settings.disconnect('openai-api-key')
    const stored = JSON.parse(readFileSync(path, 'utf8')) as {
      connections: Array<{ id: string; credential?: string }>
    }
    expect(
      stored.connections.find((item) => item.id === 'openai-api-key')?.credential,
    ).toBeUndefined()
  })

  it('builds the registered Codex PKCE OAuth URL', () => {
    const url = new URL(
      buildCodexAuthorizeUrl('state', 'verifier', 'http://localhost:1455/auth/callback'),
    )
    expect(url.origin).toBe('https://auth.openai.com')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state')
    expect(url.searchParams.get('code_challenge')).not.toBe('verifier')
  })

  it('stores an OpenRouter key encrypted and resolves its selected model without exposing the key', async () => {
    const { path, service: settings } = service()
    const view = await settings.saveApiKey(
      'openrouter-api-key',
      'sk-or-secret',
      '~openai/gpt-latest',
    )
    expect(view.provider).toBe('openrouter')
    expect(view.selectedConnectionId).toBe('openrouter-api-key')
    expect(view.providers.openrouter).toMatchObject({
      apiKey: '',
      model: '~openai/gpt-latest',
      authType: 'api-key',
    })
    expect(JSON.stringify(view)).not.toContain('sk-or-secret')
    const persisted = readFileSync(path, 'utf8')
    expect(persisted).toContain('credential')
    expect(persisted).not.toContain('"apiKey": "sk-or-secret"')
    await expect(settings.select('openrouter-api-key', 'not-a-curated-model')).rejects.toThrow(
      'not available',
    )
    expect(await settings.config()).toMatchObject({
      provider: 'openrouter',
      connectionId: 'openrouter-api-key',
      config: { apiKey: 'sk-or-secret', model: '~openai/gpt-latest', authType: 'api-key' },
    })
  })
})
