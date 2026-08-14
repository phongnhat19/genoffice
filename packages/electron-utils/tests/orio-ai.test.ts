import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrioAiService } from '../src/orio-ai'

const directories: string[] = []

function service(initial?: unknown) {
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
      openExternal: () => undefined,
      env: {},
    }),
  }
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
})
