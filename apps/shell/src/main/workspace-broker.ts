import { randomUUID } from 'node:crypto'
import { readdirSync, realpathSync, statSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { parseFileToText } from '@genoffice/file-parse'
import type { AgentMessage, AgentToolCall, AgentToolResult } from '@genoffice/agent-core'
import type { AiStreamChunk } from '@genoffice/ai-provider'
import type { OrioAiService } from '@genoffice/electron-utils'
import type {
  ProjectStore,
  WorkspaceCitation,
  WorkspaceTask,
  WorkspaceTaskActivity,
  WorkspaceTaskStatus,
} from '@genoffice/project-store'
import type { ProjectContextService } from '@genoffice/project-context'

const OFFICE_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx', 'pdf'])
const MAX_FILE_LIST = 500
const MAX_FILE_DEPTH = 8
const MAX_READ_CHARS = 24_000

export interface WorkspaceBrokerOptions {
  store: ProjectStore
  ai: OrioAiService
  /** Opens a supported file in a regular editor tab. The broker validates root membership first. */
  openPath(path: string): boolean
  onTaskChanged(task: WorkspaceTask): void
  context?: ProjectContextService
}

/**
 * Privileged coordinator for the shell Agent tab. It deliberately exposes a
 * tiny local tool surface: the model never receives an absolute path and no
 * operation can escape the configured project root. Mutating editor bridges
 * will register here in a follow-up without widening this filesystem boundary.
 */
export class WorkspaceBroker {
  private readonly active = new Map<string, AbortController>()

  constructor(private readonly options: WorkspaceBrokerOptions) {}

  list(projectId: string): WorkspaceTask[] {
    return this.options.store.listWorkspaceTasks(projectId)
  }

  start(projectId: string, instruction: string): WorkspaceTask {
    const text = instruction.trim()
    if (!text) throw new Error('Enter a task for the Workspace Agent.')
    if (this.active.has(projectId))
      throw new Error('A workspace task is already running for this project.')
    this.projectRoot(projectId)
    const now = new Date().toISOString()
    const task: WorkspaceTask = {
      id: randomUUID(),
      projectId,
      title: text.replace(/\s+/g, ' ').slice(0, 90),
      status: 'running',
      createdAt: now,
      updatedAt: now,
      messages: [{ id: randomUUID(), role: 'user', text, ts: now }],
      activity: [],
      citations: [],
      stagedFiles: [],
    }
    this.save(task)
    const controller = new AbortController()
    this.active.set(projectId, controller)
    void this.run(task, [{ role: 'user', text }], controller).finally(() => {
      if (this.active.get(projectId) === controller) this.active.delete(projectId)
    })
    return task
  }

  cancel(projectId: string, taskId: string): void {
    const task = this.mustTask(projectId, taskId)
    this.active.get(projectId)?.abort()
    task.status = 'cancelled'
    task.updatedAt = new Date().toISOString()
    this.save(task)
  }

  decide(projectId: string, taskId: string, decision: 'approve' | 'reject'): WorkspaceTask {
    const task = this.mustTask(projectId, taskId)
    if (task.status !== 'review') throw new Error('This task has no pending changes to review.')
    // Staged mutations are deliberately unavailable until every editor provides
    // the same commit/rollback bridge. Keeping this check here makes approval
    // fail closed if a future server emits a mutation before that bridge lands.
    if (task.stagedFiles.length === 0)
      throw new Error('This task has no staged office-file changes.')
    task.status = decision === 'approve' ? 'approved' : 'rejected'
    task.updatedAt = new Date().toISOString()
    this.save(task)
    return task
  }

  private async run(
    task: WorkspaceTask,
    messages: AgentMessage[],
    controller: AbortController,
  ): Promise<void> {
    if (controller.signal.aborted) return
    const toolCalls: AgentToolCall[] = []
    let responseText = ''
    try {
      const instruction = task.messages.find((message) => message.role === 'user')?.text ?? ''
      let system = ''
      try { system = (await this.options.context?.retrieve(task.projectId, instruction))?.systemContext ?? '' } catch { /* context must never block a workspace task */ }
      await this.options.ai.stream(
        {
          requestId: randomUUID(),
          system,
          messages,
          remoteSurface: 'workspace',
          remoteSessionId: task.id,
        },
        (chunk) => {
          if (controller.signal.aborted || task.status !== 'running') return
          if (chunk.type === 'delta' && chunk.text) {
            responseText += chunk.text
            this.upsertAssistantText(task, responseText)
          } else if (chunk.type === 'tool-call' && chunk.toolCall) {
            toolCalls.push(chunk.toolCall)
          } else if (chunk.type === 'tool-activity' && chunk.activity) {
            this.recordRemoteActivity(task, chunk.activity)
          } else if (chunk.type === 'citation' && chunk.citation) {
            this.recordCitation(task, chunk.citation)
          }
        },
        controller.signal,
      )
      if (controller.signal.aborted || task.status !== 'running') return
      if (toolCalls.length > 0) {
        const results: AgentToolResult[] = []
        for (const call of toolCalls) results.push(await this.executeTool(task, call))
        await this.run(task, [{ role: 'tool', results }], controller)
        return
      }
      if (!responseText) this.upsertAssistantText(task, 'Workspace task completed.')
      this.transition(task, task.stagedFiles.length > 0 ? 'review' : 'completed')
    } catch (error) {
      if (controller.signal.aborted || task.status === 'cancelled') return
      task.error = error instanceof Error ? error.message : 'Workspace Agent failed.'
      this.recordActivity(task, {
        id: randomUUID(),
        name: 'workspace_agent',
        summary: task.error,
        state: 'error',
        source: 'local',
        ts: new Date().toISOString(),
        isError: true,
      })
      this.transition(task, 'error')
    }
  }

  private async executeTool(task: WorkspaceTask, call: AgentToolCall): Promise<AgentToolResult> {
    const name = call.name
    this.recordActivity(task, {
      id: call.id || randomUUID(),
      name,
      summary: this.toolSummary(name),
      state: 'running',
      source: 'local',
      ts: new Date().toISOString(),
    })
    try {
      let output: string
      if (name === 'list_workspace_files') output = this.listFiles(task.projectId)
      else if (name === 'read_workspace_file')
        output = await this.readFile(task.projectId, call.input)
      else if (name === 'open_workspace_file') output = this.openFile(task.projectId, call.input)
      else {
        output = `Tool ${name} is not available in the desktop workspace bridge. Only project-root reads and opening an existing office file are permitted until a reversible editor adapter is registered.`
        this.finishActivity(task, call.id, true, output)
        return { id: call.id, name, output, isError: true }
      }
      this.finishActivity(task, call.id, false, this.toolSummary(name))
      return { id: call.id, name, output }
    } catch (error) {
      const output = error instanceof Error ? error.message : 'Workspace tool failed.'
      this.finishActivity(task, call.id, true, output)
      return { id: call.id, name, output, isError: true }
    }
  }

  private projectRoot(projectId: string): string {
    const configured = this.options.store.getProject(projectId)?.rootPath
    if (!configured) throw new Error('Choose a project folder before using the Workspace Agent.')
    const root = realpathSync(configured)
    if (!statSync(root).isDirectory())
      throw new Error('The configured project folder is unavailable.')
    return root
  }

  private safePath(projectId: string, candidate: unknown): string {
    if (typeof candidate !== 'string' || !candidate || candidate.includes('\0'))
      throw new Error('A root-relative file path is required.')
    const root = this.projectRoot(projectId)
    const attempted = resolve(root, candidate)
    const rel = relative(root, attempted)
    if (!rel || rel.startsWith('..') || resolve(root, rel) !== attempted)
      throw new Error('The requested file is outside the project folder.')
    const actual = realpathSync(attempted)
    const actualRel = relative(root, actual)
    if (!actualRel || actualRel.startsWith('..'))
      throw new Error('The requested file is outside the project folder.')
    if (!statSync(actual).isFile()) throw new Error('The requested path is not a file.')
    return actual
  }

  private listFiles(projectId: string): string {
    const root = this.projectRoot(projectId)
    const files: string[] = []
    const walk = (directory: string, depth: number) => {
      if (depth > MAX_FILE_DEPTH || files.length >= MAX_FILE_LIST) return
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const candidate = resolve(directory, entry.name)
        let actual: string
        try {
          actual = realpathSync(candidate)
        } catch {
          continue
        }
        const rel = relative(root, actual)
        if (!rel || rel.startsWith('..')) continue
        if (entry.isDirectory()) walk(actual, depth + 1)
        else if (entry.isFile() && OFFICE_EXTENSIONS.has(extname(actual).slice(1).toLowerCase())) {
          files.push(rel)
          if (files.length >= MAX_FILE_LIST) return
        }
      }
    }
    walk(root, 0)
    return `Project office files (${files.length}${files.length === MAX_FILE_LIST ? '+' : ''}):\n${files.join('\n') || '(none found)'}`
  }

  private async readFile(projectId: string, input: Record<string, unknown>): Promise<string> {
    const path = this.safePath(projectId, input.path)
    if (!OFFICE_EXTENSIONS.has(extname(path).slice(1).toLowerCase()))
      throw new Error('Only supported office files can be read by the Workspace Agent.')
    const parsed = await parseFileToText(path)
    if (!parsed.ok || parsed.kind !== 'text')
      throw new Error(parsed.error ?? 'Could not extract text from this file.')
    const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
    const text = parsed.text ?? ''
    const slice = text.slice(offset, offset + MAX_READ_CHARS)
    const end = offset + slice.length
    const root = this.projectRoot(projectId)
    return `File ${relative(root, path)}, characters ${offset}-${end} of ${text.length}${end < text.length ? `; continue with offset=${end}` : ''}\n---\n${slice}`
  }

  private openFile(projectId: string, input: Record<string, unknown>): string {
    const path = this.safePath(projectId, input.path)
    if (!OFFICE_EXTENSIONS.has(extname(path).slice(1).toLowerCase()))
      throw new Error('Only supported office files can be opened by the Workspace Agent.')
    if (!this.options.openPath(path)) throw new Error('Could not open that office file.')
    return `Opened ${relative(this.projectRoot(projectId), path)} in an editor tab.`
  }

  private mustTask(projectId: string, taskId: string): WorkspaceTask {
    const task = this.options.store.getWorkspaceTask(projectId, taskId)
    if (!task) throw new Error('Workspace task was not found.')
    return task
  }

  private transition(task: WorkspaceTask, status: WorkspaceTaskStatus): void {
    task.status = status
    task.updatedAt = new Date().toISOString()
    this.save(task)
  }

  private upsertAssistantText(task: WorkspaceTask, text: string): void {
    const last = task.messages.at(-1)
    if (last?.role === 'assistant') last.text = text
    else
      task.messages.push({
        id: randomUUID(),
        role: 'assistant',
        text,
        ts: new Date().toISOString(),
      })
    task.updatedAt = new Date().toISOString()
    this.save(task)
  }

  private recordRemoteActivity(
    task: WorkspaceTask,
    activity: NonNullable<AiStreamChunk['activity']>,
  ): void {
    const existing = task.activity.find((item) => item.id === activity.id)
    const next: WorkspaceTaskActivity = {
      id: activity.id,
      name: activity.name,
      summary: activity.summary,
      state: activity.state,
      source: 'research',
      ts: new Date().toISOString(),
      ...(activity.isError ? { isError: true } : {}),
    }
    if (existing) Object.assign(existing, next)
    else task.activity.push(next)
    task.updatedAt = new Date().toISOString()
    this.save(task)
  }

  private recordCitation(
    task: WorkspaceTask,
    citation: NonNullable<AiStreamChunk['citation']>,
  ): void {
    if (!citation.url.startsWith('https://') && !citation.url.startsWith('http://')) return
    const next: WorkspaceCitation = {
      id: citation.id,
      title: citation.title,
      url: citation.url,
      ...(citation.snippet ? { snippet: citation.snippet } : {}),
    }
    const index = task.citations.findIndex((item) => item.id === next.id || item.url === next.url)
    if (index >= 0) task.citations[index] = next
    else task.citations.push(next)
    task.updatedAt = new Date().toISOString()
    this.save(task)
  }

  private recordActivity(task: WorkspaceTask, activity: WorkspaceTaskActivity): void {
    task.activity.push(activity)
    task.updatedAt = new Date().toISOString()
    this.save(task)
  }

  private finishActivity(task: WorkspaceTask, id: string, isError: boolean, summary: string): void {
    const activity = task.activity.find((item) => item.id === id)
    if (activity) {
      activity.state = isError ? 'error' : 'completed'
      activity.summary = summary
      if (isError) activity.isError = true
    }
    task.updatedAt = new Date().toISOString()
    this.save(task)
  }

  private toolSummary(name: string): string {
    if (name === 'list_workspace_files') return 'List project files'
    if (name === 'read_workspace_file') return 'Read project file'
    if (name === 'open_workspace_file') return 'Open office file'
    return name
  }

  private save(task: WorkspaceTask): void {
    this.options.store.saveWorkspaceTask(task)
    this.options.onTaskChanged(task)
  }
}
