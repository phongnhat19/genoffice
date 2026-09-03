import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  HomeApi,
  RecentEntry,
  RecentPage,
  RenameResult,
  ProjectHomeApi,
  ProjectSummaryEntry,
  TimelineEntryItem,
  UiLanguage,
} from '../shared/home-api'
import { HOME_CHANNELS, PROJECT_CHANNELS } from '../shared/home-api'
import type { TabsApi, TabSummary } from '../shared/tabs-api'
import { TABS_CHANNELS } from '../shared/tabs-api'
import type { WorkspaceAgentApi } from '../shared/workspace-api'
import { WORKSPACE_CHANNELS } from '../shared/workspace-api'
import type { WorkspaceTask } from '@genoffice/project-store'

const UI_LANGUAGES: readonly UiLanguage[] = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'th',
  'id',
  'ru',
  'ar',
  'pt',
  'it',
  'pl',
  'nl',
  'ms',
  'he',
  'hi',
  'zh-TW',
]

function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.includes(value as UiLanguage)
}

const EMPTY_PAGE: RecentPage = { entries: [], total: 0, totalAll: 0 }

function asRecentPage(result: unknown): RecentPage {
  if (result && typeof result === 'object' && Array.isArray((result as RecentPage).entries)) {
    return result as RecentPage
  }
  return EMPTY_PAGE
}

const homeApi: HomeApi = {
  async recents(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.recents, query))
  },
  async starred(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.starred, query))
  },
  async statPaths(paths) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.statPaths, paths)
    return Array.isArray(result) ? (result as RecentEntry[]) : []
  },
  async toggleStar(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.toggleStar, path)
  },
  async openPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.openPath, path)
  },
  async browse() {
    await ipcRenderer.invoke(HOME_CHANNELS.browse)
  },
  async newDoc(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newDoc, opts)
  },
  async newSheet(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSheet, opts)
  },
  async newSlide(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSlide, opts)
  },
  async removeRecent(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeRecent, paths)
  },
  async revealPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.revealPath, path)
  },
  async renameFile(path, newName) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.renameFile, path, newName)
    return (result ?? { ok: false, error: 'Rename failed' }) as RenameResult
  },
  async duplicateFile(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.duplicateFile, path)
  },
  async deleteFiles(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFiles, paths)
  },
  async openTrash() {
    await ipcRenderer.invoke(HOME_CHANNELS.openTrash)
  },
  async getLanguage() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getLanguage)
    return isUiLanguage(result) ? result : 'zh'
  },
  async setLanguage(lang) {
    if (!isUiLanguage(lang)) throw new Error('Invalid language.')
    await ipcRenderer.invoke(HOME_CHANNELS.setLanguage, lang)
  },
  async getUpdateChannel() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getUpdateChannel)
    return result === 'beta' ? 'beta' : 'stable'
  },
  async setUpdateChannel(channel) {
    // validated inline: a runtime import from ../shared/update-api would be
    // shared with the update.ts preload entry and get split into a chunk,
    // which sandboxed preload scripts cannot load (window.aiOffice would
    // silently disappear). Preload entries must stay single-file bundles.
    if (channel !== 'stable' && channel !== 'beta') throw new Error('Invalid update channel.')
    await ipcRenderer.invoke(HOME_CHANNELS.setUpdateChannel, channel)
  },
  async getDefaultSaveDirectory() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDefaultSaveDirectory)
    return typeof result === 'string' ? result : ''
  },
  async chooseDefaultSaveDirectory() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.chooseDefaultSaveDirectory)
    return typeof result === 'string' ? result : undefined
  },
  async getOrioConnectionStatus() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getOrioConnectionStatus)
    return result === 'connected' || result === 'connecting' || result === 'expired'
      ? result
      : 'disconnected'
  },
  async authorizeOrio() {
    await ipcRenderer.invoke(HOME_CHANNELS.authorizeOrio)
  },
  async disconnectOrio() {
    await ipcRenderer.invoke(HOME_CHANNELS.disconnectOrio)
  },
  async getAppVersion() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAppVersion)
    return typeof result === 'string' ? result : ''
  },
  async onboardingSeen() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.onboardingSeen)
    return result === true
  },
  async setOnboardingSeen() {
    await ipcRenderer.invoke(HOME_CHANNELS.setOnboardingSeen)
  },
}

contextBridge.exposeInMainWorld('aiOffice', homeApi)

const projectApi: ProjectHomeApi = {
  async listProjects() {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.list)
    return Array.isArray(result) ? (result as ProjectSummaryEntry[]) : []
  },
  async listFiles(projectId) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.files, { projectId })
    return Array.isArray(result)
      ? result.filter((path): path is string => typeof path === 'string')
      : []
  },
  async chooseProjectFolder() {
    return (await ipcRenderer.invoke(PROJECT_CHANNELS.chooseFolder)) as { rootPath?: string }
  },
  async createProject(args) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.create, args)
    return result as ProjectSummaryEntry
  },
  async renameProject(id, name) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.rename, { id, name })
  },
  async deleteProject(id) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.delete, { id })
  },
  async moveFile(filePath, projectId) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.moveFile, { filePath, projectId })
  },
  async getTimeline(projectId, limit) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.timeline, {
      projectId,
      limit,
    })
    return Array.isArray(result) ? (result as TimelineEntryItem[]) : []
  },
  async setProjectRoot(projectId) {
    return (await ipcRenderer.invoke(PROJECT_CHANNELS.setRoot, { projectId })) as {
      rootPath?: string
      available: boolean
    }
  },
  async getSyncStatus(projectId) { return (await ipcRenderer.invoke(PROJECT_CHANNELS.syncStatus, projectId)) as import('../shared/home-api').ProjectSyncStatusEntry },
  async syncNow(projectId) { return (await ipcRenderer.invoke(PROJECT_CHANNELS.syncNow, projectId)) as import('../shared/home-api').ProjectSyncStatusEntry | undefined },
  async setAutoSync(projectId, enabled) { return (await ipcRenderer.invoke(PROJECT_CHANNELS.setAutoSync, { projectId, enabled })) as import('../shared/home-api').ProjectSyncStatusEntry | undefined },
  async listCloudProjects() { const value = await ipcRenderer.invoke(PROJECT_CHANNELS.listCloud); return Array.isArray(value) ? value as import('../shared/home-api').CloudProjectEntry[] : [] },
  async pullCloudProject(projectId) { return (await ipcRenderer.invoke(PROJECT_CHANNELS.pullCloud, projectId)) as import('../shared/home-api').ProjectSyncStatusEntry | undefined },
  async importCloudProject(projectId) { return (await ipcRenderer.invoke(PROJECT_CHANNELS.importCloud, projectId)) as import('../shared/home-api').ProjectSyncStatusEntry | undefined },
  async resolveConflict(projectId, path, choice) { return (await ipcRenderer.invoke(PROJECT_CHANNELS.resolveConflict, { projectId, path, choice })) as import('../shared/home-api').ProjectSyncStatusEntry | undefined },
  async deleteCloudProject(projectId) { await ipcRenderer.invoke(PROJECT_CHANNELS.deleteCloud, projectId) },
  async isCloudAuthorized() { return (await ipcRenderer.invoke(PROJECT_CHANNELS.cloudAuthorized)) === true },
  async authorizeCloud() { await ipcRenderer.invoke(PROJECT_CHANNELS.cloudAuthorize) },
}

contextBridge.exposeInMainWorld('aiOfficeProject', projectApi)

const tabsApi: TabsApi = {
  async list() {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.list)
    return Array.isArray(result) ? (result as TabSummary[]) : []
  },
  async activate(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.activate, id)
  },
  async close(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.close, id)
  },
  async showMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showMenu, x, y)
  },
  async showNewMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showNewMenu, x, y)
  },
  async reorder(id, toIndex) {
    await ipcRenderer.invoke(TABS_CHANNELS.reorder, id, toIndex)
  },
  async openAgent() {
    await ipcRenderer.invoke(TABS_CHANNELS.openAgent)
  },
  async openSettings() {
    await ipcRenderer.invoke(TABS_CHANNELS.openSettings)
  },
  onChanged(handler) {
    const listener = (_event: IpcRendererEvent, tabs: TabSummary[]) => handler(tabs)
    ipcRenderer.on(TABS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.changed, listener)
  },
}

contextBridge.exposeInMainWorld('aiOfficeTabs', tabsApi)

const workspaceApi: WorkspaceAgentApi = {
  async list(projectId) {
    const result: unknown = await ipcRenderer.invoke(WORKSPACE_CHANNELS.list, projectId)
    return Array.isArray(result) ? (result as WorkspaceTask[]) : []
  },
  async start(args) {
    return (await ipcRenderer.invoke(WORKSPACE_CHANNELS.start, args)) as WorkspaceTask
  },
  async cancel(args) {
    await ipcRenderer.invoke(WORKSPACE_CHANNELS.cancel, args)
  },
  async decide(args) {
    return (await ipcRenderer.invoke(WORKSPACE_CHANNELS.decide, args)) as WorkspaceTask
  },
  async contextStatus(projectId) {
    return (await ipcRenderer.invoke(WORKSPACE_CHANNELS.contextStatus, projectId)) as import('@genoffice/project-context').ProjectContextStatus
  },
  async configureContext(projectId, settings) {
    return (await ipcRenderer.invoke(WORKSPACE_CHANNELS.configureContext, projectId, settings)) as import('@genoffice/project-context').ProjectContextStatus
  },
  async rebuildContext(projectId) {
    return (await ipcRenderer.invoke(WORKSPACE_CHANNELS.rebuildContext, projectId)) as import('@genoffice/project-context').ProjectContextStatus
  },
  async clearContext(projectId) {
    return (await ipcRenderer.invoke(WORKSPACE_CHANNELS.clearContext, projectId)) as import('@genoffice/project-context').ProjectContextStatus
  },
  async isAuthorized() {
    return (await ipcRenderer.invoke(WORKSPACE_CHANNELS.isAuthorized)) === true
  },
  async authorize() {
    await ipcRenderer.invoke(WORKSPACE_CHANNELS.authorize)
  },
  onChanged(handler) {
    const listener = (_event: IpcRendererEvent, task: WorkspaceTask) => handler(task)
    ipcRenderer.on(WORKSPACE_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(WORKSPACE_CHANNELS.changed, listener)
  },
}

contextBridge.exposeInMainWorld('aiOfficeWorkspace', workspaceApi)
