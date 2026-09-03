import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
  mkdirSync,
  writeFileSync,
  type FSWatcher,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type {
  CloudProjectManifest,
  CloudProjectManifestEntry,
  ProjectSyncConflict,
  ProjectSyncState,
} from '@genoffice/project-store'
import { ProjectStore } from '@genoffice/project-store'
import { OrioAiService } from '@genoffice/electron-utils'

const excluded = new Set(['.git', 'node_modules', '.orio', '.orio-state'])
const lockFile = (name: string) =>
  name.startsWith('~$') || name.endsWith('.tmp') || name.endsWith('.swp')
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const safeRelative = (path: string) => path.split(sep).join('/')
function walk(root: string, directory = root): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || lockFile(entry.name)) continue
    const full = join(directory, entry.name)
    try {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) files.push(...walk(root, full))
      else if (entry.isFile()) files.push(full)
    } catch {
      /* transient editor file */
    }
  }
  return files
}
export type SyncStatus = ProjectSyncState & { available: boolean }
type RequestError = Error & { status?: number }
const MAX_SYNC_ERROR_LENGTH = 240
const AUTHORIZATION_TTL_MS = 15 * 60_000
// Main-process shared state: Home, Agent, and a recreated shell window must
// all reuse one Cloud verification rather than each issuing a remote check.
let cloudAuthorizationCache: { authorized: boolean; expiresAt: number } | undefined
let cloudAuthorizationRequest: Promise<boolean> | undefined

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Project sync failed.'
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_SYNC_ERROR_LENGTH)
}

function uploadFailureDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown }
    if (typeof parsed.message === 'string') return parsed.message
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    // A plain-text response is still useful below.
  }
  return body
}

export class ProjectSyncService {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  /** Syncs in this process. A persisted `syncing` state is stale after restart. */
  private readonly activeSyncs = new Set<string>()
  constructor(
    private readonly store: ProjectStore,
    private readonly ai: OrioAiService,
  ) {}
  status(projectId: string): SyncStatus {
    const project = this.store.getProject(projectId)
    let state = this.store.getProjectSyncState(projectId)
    if (state.status === 'syncing' && !this.activeSyncs.has(projectId)) {
      state = this.store.setProjectSyncState(projectId, {
        status: 'error',
        pendingUploads: [],
        pendingDownloads: [],
        error: 'The previous sync was interrupted. Try syncing again.',
      })
    }
    return { ...state, available: Boolean(project) }
  }
  /** Refresh a near-expiry token and verify it still has cloud-project permission. */
  async refreshAuthorization(force = false): Promise<boolean> {
    if (!force && cloudAuthorizationCache && cloudAuthorizationCache.expiresAt > Date.now())
      return cloudAuthorizationCache.authorized
    if (cloudAuthorizationRequest) return cloudAuthorizationRequest
    cloudAuthorizationRequest = (async () => {
      let authorized = false
      if (await this.ai.ensureAuthorized()) {
        try {
          await this.ai.cloudRequest('/api/v1/projects', { method: 'GET' })
          authorized = true
        } catch (error) {
          // Connectivity/service failures should not sign a valid local session out.
          authorized = ![401, 403].includes((error as RequestError).status ?? 0)
        }
      }
      cloudAuthorizationCache = { authorized, expiresAt: Date.now() + AUTHORIZATION_TTL_MS }
      return authorized
    })()
    try { return await cloudAuthorizationRequest } finally { cloudAuthorizationRequest = undefined }
  }
  async authorizationStatus(force = false) {
    return this.refreshAuthorization(force)
  }
  async authorize() {
    cloudAuthorizationCache = undefined
    await this.ai.startAuthorization()
  }
  async listCloudProjects() {
    const response = await this.ai.cloudRequest('/api/v1/projects', { method: 'GET' })
    return ((await response.json()) as { projects: unknown[] }).projects
  }
  setAutoSync(projectId: string, enabled: boolean) {
    this.store.setProjectSyncState(projectId, {
      autoSync: enabled,
      status: 'idle',
      error: undefined,
    })
    this.watchers.get(projectId)?.close()
    this.watchers.delete(projectId)
    const root = this.store.getProject(projectId)?.rootPath
    if (!enabled || !root || !existsSync(root)) return this.status(projectId)
    try {
      const watcher = watch(root, { recursive: true }, () => this.debounce(projectId))
      this.watchers.set(projectId, watcher)
    } catch {
      this.store.setProjectSyncState(projectId, {
        status: 'error',
        error: 'Automatic sync is unavailable for this folder.',
      })
    }
    return this.status(projectId)
  }
  private debounce(projectId: string) {
    const current = this.timers.get(projectId)
    if (current) clearTimeout(current)
    this.timers.set(
      projectId,
      setTimeout(() => void this.syncNow(projectId).catch(() => undefined), 1_500),
    )
  }
  private localManifest(projectId: string): {
    manifest: CloudProjectManifest
    bytes: Map<string, Buffer>
  } {
    const project = this.store.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    const bytes = new Map<string, Buffer>()
    const entries: CloudProjectManifestEntry[] = []
    if (project.rootPath && existsSync(project.rootPath))
      for (const file of walk(project.rootPath)) {
        const path = `files/${safeRelative(relative(project.rootPath, file))}`
        const value = readFileSync(file)
        bytes.set(path, value)
        entries.push({ path, checksum: sha256(value), size: value.length, kind: 'file' })
      }
    // Metadata is portable: omit absolute roots, tracked absolute paths, and local sync cursors.
    const metadata = { ...project, files: [], rootPath: undefined, sync: undefined }
    const projectValue = Buffer.from(JSON.stringify(metadata, null, 2))
    bytes.set('metadata/project.json', projectValue)
    entries.push({
      path: 'metadata/project.json',
      checksum: sha256(projectValue),
      size: projectValue.length,
      kind: 'metadata',
    })
    for (const file of this.store.projectMetadataPaths(projectId)) {
      if (file.endsWith('project.json')) continue
      const kind = file.includes(`${sep}chats${sep}`) ? 'chats' : 'workspace-tasks'
      const path = `metadata/${kind}/${file.split(sep).at(-1)!}`
      const value = readFileSync(file)
      bytes.set(path, value)
      entries.push({ path, checksum: sha256(value), size: value.length, kind: 'metadata' })
    }
    const state = this.store.getProjectSyncState(projectId)
    return {
      bytes,
      manifest: {
        version: 1,
        projectId,
        name: project.name,
        revision: state.cloudRevision ?? 0,
        createdAt: project.createdAt,
        updatedAt: new Date().toISOString(),
        entries,
      },
    }
  }
  private async uploadEntry(
    projectId: string,
    entry: CloudProjectManifestEntry,
    payload: Buffer,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const prep = await this.ai.cloudRequest('/api/v1/projects/sync/prepare', {
        body: { projectId, entry },
      })
      const intent = (await prep.json()) as { signedUrl: string }
      const upload = await fetch(intent.signedUrl, {
        method: 'PUT',
        body: new Uint8Array(payload),
        headers: {
          'content-type':
            entry.kind === 'metadata' ? 'application/json' : 'application/octet-stream',
        },
      })
      if (upload.ok) return

      // A signed upload URL may have expired while a large project was being
      // prepared. Obtain one fresh URL before reporting a real failure.
      if (attempt === 0 && [401, 403].includes(upload.status)) continue

      const detail = uploadFailureDetail(await upload.text()).trim()
      throw new Error(
        detail
          ? `Cloud upload failed (${upload.status}): ${detail.slice(0, 160)}`
          : `Cloud upload failed (${upload.status}).`,
      )
    }
  }
  async syncNow(projectId: string) {
    const state = this.store.getProjectSyncState(projectId)
    if (state.conflicts?.length) return this.status(projectId)
    if (this.activeSyncs.has(projectId)) return this.status(projectId)
    this.activeSyncs.add(projectId)
    this.store.setProjectSyncState(projectId, { status: 'syncing', error: undefined })
    try {
      const local = this.localManifest(projectId)
      let cloud: CloudProjectManifest | undefined
      try {
        const response = await this.ai.cloudRequest(
          `/api/v1/projects/${encodeURIComponent(projectId)}/manifest`,
          { method: 'GET' },
        )
        cloud = (await response.json()) as CloudProjectManifest
      } catch (error) {
        if ((error as RequestError).status !== 404) throw error
      }
      const last = state.lastSyncedChecksums ?? {}
      const cloudByPath = new Map(cloud?.entries.map((entry) => [entry.path, entry]) ?? [])
      const conflicts: ProjectSyncConflict[] = []
      for (const entry of local.manifest.entries) {
        const remote = cloudByPath.get(entry.path)
        if (
          remote &&
          last[entry.path] &&
          last[entry.path] !== entry.checksum &&
          last[entry.path] !== remote.checksum &&
          entry.checksum !== remote.checksum
        )
          conflicts.push({
            path: entry.path,
            localChecksum: entry.checksum,
            cloudChecksum: remote.checksum,
            detectedAt: new Date().toISOString(),
          })
      }
      if (conflicts.length) {
        this.store.setProjectSyncState(projectId, { status: 'conflict', conflicts })
        return this.status(projectId)
      }
      const pending = local.manifest.entries.filter(
        (entry) => cloudByPath.get(entry.path)?.checksum !== entry.checksum,
      )
      this.store.setProjectSyncState(projectId, {
        pendingUploads: pending.map((entry) => entry.path),
      })
      for (const entry of pending) {
        const payload = local.bytes.get(entry.path)
        if (!payload) throw new Error(`Missing local file: ${entry.path}`)
        await this.uploadEntry(projectId, entry, payload)
      }
      const commit = await this.ai.cloudRequest('/api/v1/projects/sync/commit', {
        body: { manifest: local.manifest, expectedRevision: cloud?.revision ?? 0 },
      })
      const result = (await commit.json()) as { revision: number }
      const checksums = Object.fromEntries(
        local.manifest.entries.map((entry) => [entry.path, entry.checksum]),
      )
      this.store.setProjectSyncState(projectId, {
        cloudRevision: result.revision,
        lastSyncedChecksums: checksums,
        lastSyncedAt: new Date().toISOString(),
        pendingUploads: [],
        pendingDownloads: [],
        status: 'idle',
        conflicts: [],
        error: undefined,
      })
      return this.status(projectId)
    } catch (error) {
      this.store.setProjectSyncState(projectId, {
        status: 'error',
        pendingUploads: [],
        pendingDownloads: [],
        error: errorMessage(error),
      })
      return this.status(projectId)
    } finally {
      this.activeSyncs.delete(projectId)
    }
  }
  async resolveConflict(projectId: string, path: string, choice: 'local' | 'cloud' | 'both') {
    const state = this.store.getProjectSyncState(projectId)
    const conflicts = (state.conflicts ?? []).filter((item) => item.path !== path)
    // Keep local means allow next sync to upload it. Cloud / both download is deliberately
    // performed during Import today; never overwrite a working file behind the user's back.
    this.store.setProjectSyncState(projectId, {
      conflicts,
      status: conflicts.length ? 'conflict' : 'idle',
      ...(choice === 'local'
        ? { lastSyncedChecksums: { ...(state.lastSyncedChecksums ?? {}), [path]: '' } }
        : {}),
    })
    return this.status(projectId)
  }
  async deleteCloudProject(projectId: string) {
    await this.ai.cloudRequest('/api/v1/projects', {
      method: 'DELETE',
      body: { projectId, confirm: true },
    })
    this.store.setProjectSyncState(projectId, {
      cloudRevision: undefined,
      lastSyncedChecksums: {},
      lastSyncedAt: undefined,
      conflicts: [],
      status: 'idle',
    })
  }
  /** Downloads the cloud copy into this project's existing local folder. */
  async pullCloudProject(projectId: string) {
    const project = this.store.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    if (!project.rootPath) throw new Error('Set a project folder before pulling the cloud version.')
    try {
      if (!statSync(project.rootPath).isDirectory())
        throw new Error('Project folder is not available.')
    } catch (error) {
      if (error instanceof Error && error.message === 'Project folder is not available.')
        throw error
      throw new Error('Project folder is not available.')
    }
    return this.importCloudProject(projectId, project.rootPath)
  }
  async importCloudProject(projectId: string, rootPath: string) {
    const response = await this.ai.cloudRequest(
      `/api/v1/projects/${encodeURIComponent(projectId)}/manifest`,
      { method: 'GET' },
    )
    const manifest = (await response.json()) as CloudProjectManifest
    const metadata: { chats: Record<string, string>; tasks: Record<string, string> } = {
      chats: {},
      tasks: {},
    }
    const checksums: Record<string, string> = {}
    const importedFiles: string[] = []
    for (const entry of manifest.entries) {
      const intentResponse = await this.ai.cloudRequest(
        `/api/v1/projects/${encodeURIComponent(projectId)}/download-url`,
        { body: { path: entry.path } },
      )
      const { signedUrl } = (await intentResponse.json()) as { signedUrl: string }
      const bytes = Buffer.from(await (await fetch(signedUrl)).arrayBuffer())
      if (sha256(bytes) !== entry.checksum)
        throw new Error(`Downloaded file checksum did not match: ${entry.path}`)
      checksums[entry.path] = entry.checksum
      if (entry.path.startsWith('files/')) {
        const target = resolve(rootPath, entry.path.slice(6))
        if (!target.startsWith(resolve(rootPath) + sep)) throw new Error('Invalid cloud file path.')
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, bytes)
        importedFiles.push(target)
      } else if (entry.path.startsWith('metadata/chats/'))
        metadata.chats[entry.path.slice('metadata/chats/'.length).replace(/\.jsonl$/, '')] =
          bytes.toString('utf8')
      else if (entry.path.startsWith('metadata/workspace-tasks/'))
        metadata.tasks[
          entry.path.slice('metadata/workspace-tasks/'.length).replace(/\.json$/, '')
        ] = bytes.toString('utf8')
    }
    this.store.importPortableProject(projectId, manifest.name, rootPath, metadata)
    for (const filePath of importedFiles) this.store.registerProjectFile(projectId, filePath)
    this.store.setProjectSyncState(projectId, {
      cloudRevision: manifest.revision,
      lastSyncedChecksums: checksums,
      lastSyncedAt: new Date().toISOString(),
      status: 'idle',
      conflicts: [],
    })
    return this.status(projectId)
  }
  dispose() {
    for (const watcher of this.watchers.values()) watcher.close()
    for (const timer of this.timers.values()) clearTimeout(timer)
  }
}
