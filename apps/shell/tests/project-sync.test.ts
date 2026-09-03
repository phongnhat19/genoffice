import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ProjectStore } from '@genoffice/project-store'
import type { OrioAiService } from '@genoffice/electron-utils'
import { ProjectSyncService } from '../src/main/project-sync'

const checksum = (contents: Buffer) => createHash('sha256').update(contents).digest('hex')

describe('ProjectSyncService', () => {
  const tempDirectories: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('registers files pulled from cloud so they appear in the project file list', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-sync-test-'))
    tempDirectories.push(directory)
    const rootPath = join(directory, 'hang-quy')
    mkdirSync(rootPath)
    const store = new ProjectStore(join(directory, 'user-data'))
    const project = store.createProject('Hang quỷ', rootPath)
    const contents = Buffer.from('cloud document')
    const cloudRequest = vi.fn(async (path: string) => {
      if (path.endsWith('/manifest'))
        return new Response(
          JSON.stringify({
            name: 'Hang quỷ',
            revision: 1,
            entries: [{ path: 'files/brief.docx', checksum: checksum(contents), size: contents.length }],
          }),
        )
      return new Response(JSON.stringify({ signedUrl: 'https://example.test/brief.docx' }))
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(contents)))
    const service = new ProjectSyncService(
      store,
      { cloudRequest } as unknown as OrioAiService,
    )

    await service.pullCloudProject(project.id)

    expect(store.listProjectFiles(project.id)).toEqual([join(rootPath, 'brief.docx')])
  })

  it('caches a cloud authorization check for fifteen minutes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-sync-auth-test-'))
    tempDirectories.push(directory)
    const store = new ProjectStore(join(directory, 'user-data'))
    const ai = {
      ensureAuthorized: vi.fn(async () => true),
      cloudRequest: vi.fn(async () => new Response(JSON.stringify({ projects: [] }))),
    } as unknown as OrioAiService
    const service = new ProjectSyncService(store, ai)
    const recreatedService = new ProjectSyncService(store, ai)

    await expect(service.authorizationStatus()).resolves.toBe(true)
    await expect(recreatedService.authorizationStatus()).resolves.toBe(true)
    expect(ai.ensureAuthorized).toHaveBeenCalledTimes(1)
    expect(ai.cloudRequest).toHaveBeenCalledTimes(1)
  })
})
