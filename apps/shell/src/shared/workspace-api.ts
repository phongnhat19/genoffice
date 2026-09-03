import type { WorkspaceTask } from '@genoffice/project-store'
import type { ProjectContextSettings, ProjectContextStatus } from '@genoffice/project-context'

/** Shell-only IPC surface for the project-scoped Workspace Agent. */
export interface WorkspaceAgentApi {
  list(projectId: string): Promise<WorkspaceTask[]>
  start(args: { projectId: string; instruction: string }): Promise<WorkspaceTask>
  cancel(args: { projectId: string; taskId: string }): Promise<void>
  decide(args: {
    projectId: string
    taskId: string
    decision: 'approve' | 'reject'
  }): Promise<WorkspaceTask>
  contextStatus(projectId: string): Promise<ProjectContextStatus>
  configureContext(projectId: string, settings: Partial<ProjectContextSettings>): Promise<ProjectContextStatus>
  rebuildContext(projectId: string): Promise<ProjectContextStatus>
  clearContext(projectId: string): Promise<ProjectContextStatus>
  isAuthorized(force?: boolean): Promise<boolean>
  authorize(): Promise<void>
  /** Sent for deltas, activities, and state transitions. */
  onChanged(handler: (task: WorkspaceTask) => void): () => void
}

export const WORKSPACE_CHANNELS = {
  list: 'workspace:list',
  start: 'workspace:start',
  cancel: 'workspace:cancel',
  decide: 'workspace:decide',
  changed: 'workspace:changed',
  contextStatus: 'workspace:context-status',
  configureContext: 'workspace:context-configure',
  rebuildContext: 'workspace:context-rebuild',
  clearContext: 'workspace:context-clear',
  isAuthorized: 'workspace:is-authorized',
  authorize: 'workspace:authorize',
} as const
