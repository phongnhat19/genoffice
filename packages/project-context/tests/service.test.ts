import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectContextService } from '../src'

const dirs: string[] = []
function fixture(): { root: string; data: string } {
  const base = mkdtempSync(join(tmpdir(), 'orio-context-')); dirs.push(base)
  const root = join(base, 'project'); const data = join(base, 'data'); mkdirSync(root); mkdirSync(data)
  return { root, data }
}

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('ProjectContextService', () => {
  it('automatically activates, indexes supported files, and retrieves cited excerpts', async () => {
    const { root, data } = fixture()
    writeFileSync(join(root, 'brief.md'), '# Launch plan\n\nORIO ships the launch proposal in Bangkok.')
    writeFileSync(join(root, 'skip.exe'), 'not indexed')
    const service = new ProjectContextService(data, () => root, {
      embed: async (_projectId, input) => input.map((value) => [value.toLowerCase().includes('bangkok') ? 1 : 0, value.length]),
    })
    service.activate('p')
    await service.rebuild('p')
    expect(service.status('p')).toMatchObject({ state: 'ready', indexedFiles: 1 })
    const result = await service.retrieve('p', 'What happens in Bangkok?')
    expect(result.systemContext).toContain('[[brief.md#Launch plan]]')
    expect(result.sources[0]?.text).toContain('Bangkok')
    service.dispose()
  })

  it('removes old chunks when a file is deleted during reconciliation', async () => {
    const { root, data } = fixture(); const file = join(root, 'notes.txt')
    writeFileSync(file, 'alpha project note')
    const service = new ProjectContextService(data, () => root, { embed: async (_projectId, input) => input.map(() => [1]) })
    service.configure('p', { enabled: true, consentVersion: 1 }); await service.rebuild('p')
    unlinkSync(file); await service.rebuild('p')
    expect(service.status('p').indexedFiles).toBe(0)
    service.dispose()
  })

  it('marks legacy OpenRouter indexes for an ORIO rebuild before retrieval', async () => {
    const { root, data } = fixture()
    const index = join(data, 'project-context', 'p')
    mkdirSync(index, { recursive: true })
    writeFileSync(join(index, 'index.json'), JSON.stringify({
      version: 1,
      revision: 2,
      settings: { enabled: true, consentVersion: 1, embeddingModel: 'old-model' },
      files: {}, chunks: {}, entities: [], relations: [],
    }))
    const service = new ProjectContextService(data, () => root, { embed: async () => [[1]] })
    expect(service.status('p').state).toBe('needs_rebuild')
    expect((await service.retrieve('p', 'anything')).sources).toEqual([])
    service.dispose()
  })
})
