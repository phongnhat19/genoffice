import type { WorkspaceTask } from '@genoffice/project-store'

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
  /** Sent for deltas, activities, and state transitions. */
  onChanged(handler: (task: WorkspaceTask) => void): () => void
}

export const WORKSPACE_CHANNELS = {
  list: 'workspace:list',
  start: 'workspace:start',
  cancel: 'workspace:cancel',
  decide: 'workspace:decide',
  changed: 'workspace:changed',
} as const
