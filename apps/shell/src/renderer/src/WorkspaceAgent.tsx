import { useEffect, useMemo, useState } from 'react'
import type { ProjectSummaryEntry } from '../../shared/home-api'
import type { WorkspaceAgentApi } from '../../shared/workspace-api'
import type { WorkspaceTask } from '@genoffice/project-store'

declare global {
  interface Window {
    aiOfficeWorkspace: WorkspaceAgentApi
  }
}

function latestTask(tasks: readonly WorkspaceTask[]): WorkspaceTask | null {
  return tasks[0] ?? null
}

export function WorkspaceAgent() {
  const [projects, setProjects] = useState<ProjectSummaryEntry[]>([])
  const [projectId, setProjectId] = useState('default')
  const [tasks, setTasks] = useState<WorkspaceTask[]>([])
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void window.aiOfficeProject?.listProjects().then((next = []) => {
      setProjects(next)
      if (next.length > 0 && !next.some((project) => project.id === projectId))
        setProjectId(next[0]!.id)
    })
  }, [])

  useEffect(() => {
    void window.aiOfficeWorkspace.list(projectId).then(setTasks)
  }, [projectId])

  useEffect(
    () =>
      window.aiOfficeWorkspace.onChanged((task) => {
        if (task.projectId !== projectId) return
        setTasks((previous) => {
          const rest = previous.filter((item) => item.id !== task.id)
          return [task, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        })
      }),
    [projectId],
  )

  const task = useMemo(() => latestTask(tasks), [tasks])
  const running = task?.status === 'running'

  const start = async () => {
    const text = instruction.trim()
    if (!text || running) return
    setError('')
    try {
      const created = await window.aiOfficeWorkspace.start({ projectId, instruction: text })
      setInstruction('')
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
            onChange={(event) => setProjectId(event.target.value)}
            disabled={running}
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
      </section>
      <section className="workspace-agent-main">
        <div className="workspace-heading">
          <div>
            <h2>{task?.title ?? 'New workspace task'}</h2>
            <span className={`workspace-status ${task?.status ?? 'idle'}`}>
              {task?.status ?? 'ready'}
            </span>
          </div>
          {running && <button onClick={() => void cancel()}>Stop</button>}
        </div>

        <div className="workspace-transcript" aria-live="polite">
          {!task && (
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
              <p>{message.text}</p>
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

        <form
          className="workspace-composer"
          onSubmit={(event) => {
            event.preventDefault()
            void start()
          }}
        >
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="What should the Workspace Agent do?"
            disabled={running}
          />
          <button type="submit" disabled={!instruction.trim() || running}>
            Run task
          </button>
        </form>
        {error && <p className="workspace-error">{error}</p>}
      </section>
    </main>
  )
}
