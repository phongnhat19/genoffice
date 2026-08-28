import type { UpdateChannel } from './update-api'

/** UI language; kept self-contained here (mirrors Lang in @genoffice/i18n) */
export type UiLanguage =
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'th'
  | 'id'
  | 'ru'
  | 'ar'
  | 'pt'
  | 'it'
  | 'pl'
  | 'nl'
  | 'ms'
  | 'he'
  | 'hi'
  | 'zh-TW'

/** a recent file entry shown on the home screen; type derives from the extension */
export interface RecentEntry {
  path: string
  name: string
  /** lowercased extension without the dot ('docx' | 'xlsx' | 'pptx') */
  ext: string
  /** last-modified time, ms since epoch */
  mtimeMs: number
  /** file size in bytes */
  sizeBytes: number
  /** whether the user starred this file */
  starred: boolean
}

/** paged query for the home file lists */
export interface RecentQuery {
  /** number of entries to skip (default 0) */
  offset?: number
  /** page size; 0 returns no entries but still reports totals (default 50) */
  limit?: number
  /** restrict to one extension ('docx' | 'xlsx' | 'pptx'); omit for all */
  ext?: string
}

export interface RecentPage {
  entries: RecentEntry[]
  /** total matching the query's ext filter */
  total: number
  /** total ignoring the ext filter (for the sidebar counters) */
  totalAll: number
}

export interface HomeApi {
  /** unified recents across document types, newest first (paged) */
  recents(query?: RecentQuery): Promise<RecentPage>
  /** starred files (independent of the recent list), newest first (paged) */
  starred(query?: RecentQuery): Promise<RecentPage>
  /** stat a specific set of paths (project view); missing files are skipped */
  statPaths(paths: string[]): Promise<RecentEntry[]>
  /** star / unstar a file */
  toggleStar(path: string): Promise<void>
  /** open an existing file, routing to the right module by extension */
  openPath(path: string): Promise<void>
  /** file picker accepting every supported extension, then routes */
  browse(): Promise<void>
  /** open a docs window at its start screen */
  newDoc(opts?: { projectId?: string }): Promise<void>
  /** open a sheets window */
  newSheet(opts?: { projectId?: string }): Promise<void>
  /** open a slides tab at its start screen (open-a-pptx) */
  newSlide(opts?: { projectId?: string }): Promise<void>
  /** drop entries from the recent list (does not touch the files) */
  removeRecent(paths: string[]): Promise<void>
  /** reveal the file in Finder / Explorer */
  revealPath(path: string): Promise<void>
  /** rename the file on disk (same directory) and update the recent list */
  renameFile(path: string, newName: string): Promise<RenameResult>
  /** copy the file next to itself (localized "copy" suffix before .ext) and record it as recent */
  duplicateFile(path: string): Promise<void>
  /** move files to the trash and drop them from the recent list */
  deleteFiles(paths: string[]): Promise<void>
  /** open the OS trash, where deleted files can be restored */
  openTrash(): Promise<void>
  /** current UI language (persisted in userData/app-settings.json) */
  getLanguage(): Promise<UiLanguage>
  /** switch + persist the UI language; main rebuilds its menus to match */
  setLanguage(lang: UiLanguage): Promise<void>
  /** current update channel (persisted in userData/app-settings.json; default 'stable') */
  getUpdateChannel(): Promise<UpdateChannel>
  /** switch + persist the update channel; triggers an immediate update check */
  setUpdateChannel(channel: UpdateChannel): Promise<void>
  /** resolved global destination for new non-project Office files */
  getDefaultSaveDirectory(): Promise<string>
  /** opens a native folder picker and persists the selected folder */
  chooseDefaultSaveDirectory(): Promise<string | undefined>
  /** non-secret ORIO OAuth connection state for Settings */
  getOrioConnectionStatus(): Promise<'connected' | 'connecting' | 'expired' | 'disconnected'>
  authorizeOrio(): Promise<void>
  disconnectOrio(): Promise<void>
  /** app version (from package.json / electron app.getVersion) */
  getAppVersion(): Promise<string>
  /** whether the first-run onboarding has been completed or skipped (persisted in userData/app-settings.json) */
  onboardingSeen(): Promise<boolean>
  /** mark the first-run onboarding as done so it never shows again */
  setOnboardingSeen(): Promise<void>
}

export interface RenameResult {
  ok: boolean
  /** the new absolute path when ok */
  path?: string
  error?: string
}

// ── Project-related APIs (P1) ────────────────────────────────

export interface ProjectSummaryEntry {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  fileCount: number
  lastActiveAt: string
  isDefault: boolean
  rootPath?: string
}

export interface TimelineEntryItem {
  filePath: string
  fileName: string
  chatId: string
  ts: string
  role: 'user' | 'assistant'
  preview: string
  seq: number
}

export interface ProjectHomeApi {
  /** list all projects (with file count + last-active time) */
  listProjects(): Promise<ProjectSummaryEntry[]>
  /** list existing files currently belonging to a project */
  listFiles(projectId: string): Promise<string[]>
  /** Opens the native directory picker used by the new-project dialog. */
  chooseProjectFolder(): Promise<{ rootPath?: string }>
  /** create a project, optionally with its AI context root already configured */
  createProject(args: { name: string; rootPath?: string }): Promise<ProjectSummaryEntry>
  /** rename a project */
  renameProject(id: string, name: string): Promise<void>
  /** soft-delete a project */
  deleteProject(id: string): Promise<void>
  /** move a file into the given project */
  moveFile(filePath: string, projectId: string): Promise<void>
  /** fetch the project timeline */
  getTimeline(projectId: string, limit?: number): Promise<TimelineEntryItem[]>
  /** Opens the native directory picker and persists this project's AI context root. */
  setProjectRoot(projectId: string): Promise<{ rootPath?: string; available: boolean }>
  getSyncStatus(projectId: string): Promise<ProjectSyncStatusEntry>
  syncNow(projectId: string): Promise<ProjectSyncStatusEntry | undefined>
  setAutoSync(projectId: string, enabled: boolean): Promise<ProjectSyncStatusEntry | undefined>
  listCloudProjects(): Promise<CloudProjectEntry[]>
  /** Downloads the selected project's cloud copy into its configured local folder. */
  pullCloudProject(projectId: string): Promise<ProjectSyncStatusEntry | undefined>
  importCloudProject(projectId: string): Promise<ProjectSyncStatusEntry | undefined>
  resolveConflict(projectId: string, path: string, choice: 'local' | 'cloud' | 'both'): Promise<ProjectSyncStatusEntry | undefined>
  deleteCloudProject(projectId: string): Promise<void>
  isCloudAuthorized(): Promise<boolean>
  authorizeCloud(): Promise<void>
}
export interface ProjectSyncStatusEntry { available: boolean; status?: 'idle' | 'syncing' | 'error' | 'conflict' | 'offline'; lastSyncedAt?: string; autoSync?: boolean; conflicts?: Array<{ path: string }>; error?: string }
export interface CloudProjectEntry { id: string; name: string; revision: number; byteSize: number; updatedAt: string }

export const HOME_CHANNELS = {
  recents: 'home:recents',
  starred: 'home:starred',
  statPaths: 'home:stat-paths',
  toggleStar: 'home:toggle-star',
  openPath: 'home:open-path',
  browse: 'home:browse',
  newDoc: 'home:new-doc',
  newSheet: 'home:new-sheet',
  newSlide: 'home:new-slide',
  removeRecent: 'home:remove-recent',
  revealPath: 'home:reveal-path',
  renameFile: 'home:rename-file',
  duplicateFile: 'home:duplicate-file',
  deleteFiles: 'home:delete-files',
  openTrash: 'home:open-trash',
  getLanguage: 'home:get-language',
  setLanguage: 'home:set-language',
  getUpdateChannel: 'home:get-update-channel',
  setUpdateChannel: 'home:set-update-channel',
  getDefaultSaveDirectory: 'home:get-default-save-directory',
  chooseDefaultSaveDirectory: 'home:choose-default-save-directory',
  getOrioConnectionStatus: 'home:get-orio-connection-status',
  authorizeOrio: 'home:authorize-orio',
  disconnectOrio: 'home:disconnect-orio',
  getAppVersion: 'home:get-app-version',
  onboardingSeen: 'home:onboarding-seen',
  setOnboardingSeen: 'home:set-onboarding-seen',
} as const

export const PROJECT_CHANNELS = {
  list: 'project:list',
  files: 'project:files',
  create: 'project:create',
  chooseFolder: 'project:chooseFolder',
  rename: 'project:rename',
  delete: 'project:delete',
  moveFile: 'project:moveFile',
  timeline: 'project:timeline',
  setRoot: 'project:setRoot',
  syncStatus: 'project:syncStatus',
  syncNow: 'project:syncNow',
  setAutoSync: 'project:setAutoSync',
  listCloud: 'project:listCloud',
  pullCloud: 'project:pullCloud',
  importCloud: 'project:importCloud',
  resolveConflict: 'project:resolveConflict',
  deleteCloud: 'project:deleteCloud',
  cloudAuthorized: 'project:cloudAuthorized',
  cloudAuthorize: 'project:cloudAuthorize',
} as const
