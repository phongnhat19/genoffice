import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OrioAiService } from '@genoffice/electron-utils'
import { ProjectStore } from '@genoffice/project-store'
import { WorkspaceBroker } from '../src/main/workspace-broker'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('WorkspaceBroker', () => {
  let dir: string
  let store: ProjectStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'workspace-broker-test-'))
    writeFileSync(join(dir, 'brief.docx'), '')
    writeFileSync(join(dir, 'outside.txt'), 'not an office file')
    store = new ProjectStore(join(dir, 'user-data'))
    store.ensureDefaultProject()
    store.setProjectRoot('default', dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('executes only a root-scoped local tool and continues the remote session with its result', async () => {
    let calls = 0
    const ai = {
      ensureAuthorized: async () => true,
      stream: async (_request: unknown, onChunk: (chunk: any) => void) => {
        calls++
        if (calls === 1) {
          onChunk({
            type: 'tool-call',
            toolCall: { id: 'files', name: 'list_workspace_files', input: {} },
          })
        } else {
          onChunk({ type: 'delta', text: 'I found one office file.' })
          onChunk({
            type: 'citation',
            citation: { id: 'source-1', title: 'Research source', url: 'https://example.com' },
          })
        }
      },
    } as unknown as OrioAiService
    const changes: string[] = []
    const broker = new WorkspaceBroker({
      store,
      ai,
      openPath: () => true,
      onTaskChanged: (task) => changes.push(task.status),
    })

    const task = await broker.start('default', 'List the files')
    await tick()
    await tick()

    const saved = store.getWorkspaceTask('default', task.id)
    expect(calls).toBe(2)
    expect(saved?.status).toBe('completed')
    expect(saved?.messages.at(-1)?.text).toBe('I found one office file.')
    expect(saved?.activity.some((entry) => entry.name === 'list_workspace_files')).toBe(true)
    expect(saved?.citations[0]?.url).toBe('https://example.com')
    expect(changes).toContain('completed')
  })

  it('does not persist or stream a task until ORIO Cloud is authorized', async () => {
    const stream = async () => { throw new Error('must not stream') }
    const broker = new WorkspaceBroker({
      store,
      ai: { ensureAuthorized: async () => false, stream } as unknown as OrioAiService,
      openPath: () => true,
      onTaskChanged: () => undefined,
    })

    await expect(broker.start('default', 'List the files')).rejects.toThrow('Authorize ORIO Cloud')
    expect(store.listWorkspaceTasks('default')).toEqual([])
  })
})
