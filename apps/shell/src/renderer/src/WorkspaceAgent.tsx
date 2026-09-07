import { useEffect, useMemo, useState } from 'react'
import { AiComposer, ProjectMentionPicker, type ProjectMention } from '@genoffice/ui'
import type { ProjectSummaryEntry } from '../../shared/home-api'
import type { WorkspaceAgentApi } from '../../shared/workspace-api'
import type { WorkspaceTask } from '@genoffice/project-store'
import type { ProjectContextStatus } from '@genoffice/project-context'

declare global {
  interface Window {
    aiOfficeWorkspace: WorkspaceAgentApi
  }
}

function latestTask(tasks: readonly WorkspaceTask[]): WorkspaceTask | null {
  return tasks[0] ?? null
}

const LAST_PROJECT_KEY = 'orio.workspace-agent.project-id'

function rememberedProjectId(): string {
  try { return window.localStorage.getItem(LAST_PROJECT_KEY) ?? 'default' } catch { return 'default' }
}

function messageWithMentionChips(text: string): React.ReactNode {
  const parts = text.split(/(@\[[^\]]+\])/g)
  return parts.map((part, index) =>
    part.startsWith('@[') && part.endsWith(']') ? (
      <span key={index} className="workspace-mention-chip">{part.slice(2, -1)}</span>
    ) : (
      part
    ),
  )
}

export function WorkspaceAgent() {
  const [projects, setProjects] = useState<ProjectSummaryEntry[]>([])
  const [projectId, setProjectId] = useState(rememberedProjectId)
  const [tasks, setTasks] = useState<WorkspaceTask[]>([])
  const [instruction, setInstruction] = useState('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [context, setContext] = useState<ProjectContextStatus | null>(null)
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [projectLoading, setProjectLoading] = useState(false)

  useEffect(() => {
    void window.aiOfficeWorkspace.isAuthorized().then(setAuthorized).catch(() => setAuthorized(false))
  }, [])

  useEffect(() => {
    if (!authorizing) return
    const timer = window.setInterval(() => {
      void window.aiOfficeWorkspace.isAuthorized(true).then((next) => {
        if (!next) return
        window.clearInterval(timer)
        setAuthorized(true)
        setAuthorizing(false)
        setError('')
      }).catch((cause) => {
        setAuthorizing(false)
        setError(cause instanceof Error ? cause.message : 'Could not verify ORIO Cloud authorization.')
      })
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [authorizing])

  useEffect(() => {
    if (authorized !== true) return
    void window.aiOfficeProject?.listProjects().then((next = []) => {
      setProjects(next)
      if (next.length > 0 && !next.some((project) => project.id === projectId)) {
        const fallback = next[0]!.id
        setProjectId(fallback)
        try { window.localStorage.setItem(LAST_PROJECT_KEY, fallback) } catch { /* storage is optional */ }
      }
    })
  }, [authorized])

  useEffect(() => {
    if (authorized !== true) return
    let current = true
    setProjectLoading(true)
    setTasks([])
    void Promise.all([
      window.aiOfficeWorkspace.list(projectId),
      window.aiOfficeWorkspace.contextStatus(projectId).catch(() => null),
    ]).then(([nextTasks, nextContext]) => {
      if (!current) return
      setTasks(nextTasks)
      setContext(nextContext)
    }).finally(() => {
      if (current) setProjectLoading(false)
    })
    return () => { current = false }
  }, [authorized, projectId])

  // Indexing runs in the privileged main process. Poll only while it is active
  // so the user sees completion even when no workspace task is running.
  useEffect(() => {
    if (authorized !== true) return
    if (context?.state !== 'indexing') return
    const timer = window.setInterval(() => {
      void window.aiOfficeWorkspace.contextStatus(projectId).then(setContext).catch(() => undefined)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [authorized, context?.state, projectId])

  useEffect(
    () => {
      if (authorized !== true) return undefined
      return window.aiOfficeWorkspace.onChanged((task) => {
        if (task.projectId !== projectId) return
        setTasks((previous) => {
          const rest = previous.filter((item) => item.id !== task.id)
          return [task, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        })
      })
    },
    [authorized, projectId],
  )

  const task = useMemo(
    () => tasks.find((item) => item.id === selectedTaskId) ?? latestTask(tasks),
    [selectedTaskId, tasks],
  )
  const running = task?.status === 'running'

  const start = async () => {
    const text = instruction.trim()
    if (!text || running || projectLoading) return
    setError('')
    try {
      const created = await window.aiOfficeWorkspace.start({ projectId, instruction: text })
      setInstruction('')
      setSelectedTaskId(created.id)
      setTasks((previous) => [created, ...previous.filter((item) => item.id !== created.id)])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the workspace task.')
    }
  }

  const cancel = async () => {
    if (!task) return
    await window.aiOfficeWorkspace.cancel({ projectId, taskId: task.id })
  }

  const decide = async (decision: 'approve' | 'reject') => {
    if (!task) return
    try {
      await window.aiOfficeWorkspace.decide({ projectId, taskId: task.id, decision })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the review.')
    }
  }

  const contextLabel =
    context?.state === 'indexing'
      ? 'Indexing project…'
      : context?.state === 'ready'
        ? `Index complete · ${context.indexedFiles} files · ${context.indexedChunks} excerpts`
        : context?.state === 'error'
          ? `Index error · ${context.error ?? 'Try rebuilding the index.'}`
          : context?.state === 'needs_rebuild'
            ? 'Rebuilding project context with ORIO Cloud…'
          : 'Preparing project context…'

  const authorize = async () => {
    setError('')
    setAuthorizing(true)
    try {
      await window.aiOfficeWorkspace.authorize()
    } catch (cause) {
      setAuthorizing(false)
      setError(cause instanceof Error ? cause.message : 'Could not start ORIO Cloud authorization.')
    }
  }

  const chooseMention = (mention: ProjectMention) => {
    setInstruction((value) => value.replace(/@[^\s@]*$/, `@[${mention.path}] `))
    setMentionOpen(false)
  }

  if (authorized !== true) {
    return (
      <main className="workspace-agent-auth" aria-label="Authorize Workspace Agent">
        <section>
          <p className="workspace-eyebrow">ORIO Cloud</p>
          <h1>Authorize the Workspace Agent</h1>
          <p>Connect ORIO Cloud to use the agent. ORIO handles AI inference; this desktop app never stores a provider key.</p>
          {authorized === null ? (
            <p className="workspace-loading" aria-live="polite"><span aria-hidden="true" />Checking ORIO Cloud authorization…</p>
          ) : (
            <button onClick={() => void authorize()} disabled={authorizing}>
              {authorizing ? 'Waiting for authorization…' : 'Authorize ORIO Cloud'}
            </button>
          )}
          {authorizing && <p className="workspace-auth-wait" aria-live="polite">Finish authorization in your browser, then return here.</p>}
          {error && <p className="workspace-error" role="alert">{error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="workspace-agent" aria-label="Workspace Agent">
      <section className="workspace-agent-sidebar">
        <div>
          <p className="workspace-eyebrow">ORIO</p>
          <h1>Workspace Agent</h1>
          <p>Plan, research, and coordinate work across your project files.</p>
        </div>
        <label className="workspace-project-label">
          Project
          <select
            value={projectId}
            onChange={(event) => {
              const next = event.target.value
              setProjectId(next)
              try { window.localStorage.setItem(LAST_PROJECT_KEY, next) } catch { /* storage is optional */ }
            }}
            disabled={running || projectLoading}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <p className="workspace-policy">
          Reads stay within the selected project folder. Curated research sources are read-only and
          cited.
        </p>
        {tasks.length > 0 && (
          <label className="workspace-project-label">
            Conversation
            <select
              value={task?.id ?? ''}
              onChange={(event) => setSelectedTaskId(event.target.value || null)}
              disabled={projectLoading}
            >
              {tasks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <section className="workspace-context">
          <h3>Project Context</h3>
          <p className={`workspace-context-status ${context?.state ?? 'disabled'}`}>
            {context?.state === 'indexing' && <span className="workspace-loading-dot" aria-hidden="true" />}{contextLabel}
          </p>
          <p className="workspace-context-notice">Project Context is automatically built locally using ORIO Cloud inference.</p>
          <button className="workspace-secondary" disabled={running} onClick={() => void window.aiOfficeWorkspace.rebuildContext(projectId).then(setContext)}>
            Rebuild index
          </button>
        </section>
      </section>
      <section className="workspace-agent-main">
        <div className="workspace-heading">
          <div>
            <h2>{task?.title ?? 'New workspace task'}</h2>
            <span className={`workspace-status ${task?.status ?? 'idle'}`}>
              {task?.status ?? 'ready'}
            </span>
          </div>
        </div>

        <div className="workspace-transcript" aria-live="polite">
          {projectLoading ? (
            <p className="workspace-empty workspace-loading" aria-live="polite"><span aria-hidden="true" />Loading project…</p>
          ) : !task && (
            <p className="workspace-empty">
              Ask the agent to compare files, research a topic, or prepare an office deliverable.
            </p>
          )}
          {task?.messages.map((message) => (
            <article key={message.id} className={`workspace-message ${message.role}`}>
              <strong>
                {message.role === 'user'
                  ? 'You'
                  : message.role === 'assistant'
                    ? 'Agent'
                    : 'System'}
              </strong>
              <p>{messageWithMentionChips(message.text)}</p>
            </article>
          ))}
          {task?.error && <p className="workspace-error">{task.error}</p>}
        </div>

        {task && task.activity.length > 0 && (
          <section className="workspace-trace">
            <h3>Task activity</h3>
            {task.activity.map((activity) => (
              <div
                key={activity.id}
                className={activity.isError ? 'workspace-activity error' : 'workspace-activity'}
              >
                <span>{activity.source === 'research' ? 'Research' : 'Workspace'}</span>
                <span>{activity.summary}</span>
              </div>
            ))}
          </section>
        )}

        {task && task.citations.length > 0 && (
          <section className="workspace-trace">
            <h3>Sources</h3>
            {task.citations.map((citation) => (
              <a key={citation.id} href={citation.url} target="_blank" rel="noreferrer">
                {citation.title}
              </a>
            ))}
          </section>
        )}

        {task?.status === 'review' && (
          <section className="workspace-review">
            <h3>Review staged changes</h3>
            {task.stagedFiles.map((file) => (
              <p key={`${file.kind}-${file.path ?? file.title}`}>
                <strong>{file.title}</strong> — {file.summary}
              </p>
            ))}
            <div>
              <button className="workspace-secondary" onClick={() => void decide('reject')}>
                Reject changes
              </button>
              <button onClick={() => void decide('approve')}>Approve changes</button>
            </div>
          </section>
        )}

        <div className="workspace-composer">
          <AiComposer
            value={instruction}
            busy={running}
            placeholder="What should the Workspace Agent do?"
            hintIdle="Enter to run · Shift+Enter for a new line"
            hintBusy="Esc to stop"
            sendLabel="Run task"
            stopLabel="Stop"
            ariaLabel="Workspace Agent task instruction"
            onChange={(value) => {
              setInstruction(value)
              if (/@[^\s@]*$/.test(value)) setMentionOpen(true)
            }}
            onTextareaKeyDown={(event) => {
              if (event.key === '@') setMentionOpen(true)
              if (event.key === 'Escape' && mentionOpen) {
                event.preventDefault()
                setMentionOpen(false)
              }
            }}
            overlay={
              <ProjectMentionPicker
                projectId={projectId}
                open={mentionOpen}
                query={instruction.match(/@([^\s@]*)$/)?.[1] ?? ''}
                onSelect={chooseMention}
                onClose={() => setMentionOpen(false)}
              />
            }
            onSend={() => void start()}
            onStop={() => void cancel()}
          />
        </div>
        {error && <p className="workspace-error">{error}</p>}
      </section>
    </main>
  )
}
