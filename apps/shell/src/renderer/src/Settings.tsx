import { useEffect, useState } from 'react'
import { useI18n } from './locale'

type Category = 'general' | 'account' | 'about'
type ConnectionStatus = 'connected' | 'connecting' | 'expired' | 'disconnected'

const languages = [
  ['zh', '简体中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'],
  ['de', 'Deutsch'], ['es', 'Español'], ['th', 'ไทย'], ['id', 'Bahasa Indonesia'], ['ru', 'Русский'],
  ['ar', 'العربية'], ['pt', 'Português'], ['it', 'Italiano'], ['pl', 'Polski'], ['nl', 'Nederlands'],
  ['ms', 'Bahasa Melayu'], ['he', 'עברית'], ['hi', 'हिन्दी'], ['zh-TW', '繁體中文'],
] as const

export function Settings() {
  const { lang, setLang } = useI18n()
  const [category, setCategory] = useState<Category>('general')
  const [saveDirectory, setSaveDirectory] = useState('')
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [version, setVersion] = useState('')
  const [connection, setConnection] = useState<ConnectionStatus>('disconnected')
  const [pendingAuth, setPendingAuth] = useState(false)
  const [error, setError] = useState('')

  const refreshConnection = () =>
    window.aiOffice.getOrioConnectionStatus().then(setConnection).catch(() => setConnection('disconnected'))

  useEffect(() => {
    void Promise.all([
      window.aiOffice.getDefaultSaveDirectory().then(setSaveDirectory),
      window.aiOffice.getUpdateChannel().then(setChannel),
      window.aiOffice.getAppVersion().then(setVersion),
      refreshConnection(),
    ])
  }, [])

  useEffect(() => {
    if (connection !== 'connecting') return
    const timer = window.setInterval(() => void refreshConnection(), 1500)
    return () => window.clearInterval(timer)
  }, [connection])

  const chooseFolder = async () => {
    setError('')
    try {
      const selected = await window.aiOffice.chooseDefaultSaveDirectory()
      if (selected) setSaveDirectory(selected)
    } catch {
      setError('Could not update the default save folder.')
    }
  }
  const authorize = async () => {
    setError('')
    setPendingAuth(true)
    try {
      await window.aiOffice.authorizeOrio()
      await refreshConnection()
    } catch {
      setError('Could not start ORIO authorization.')
    } finally {
      setPendingAuth(false)
    }
  }
  const disconnect = async () => {
    setError('')
    try {
      await window.aiOffice.disconnectOrio()
      await refreshConnection()
    } catch {
      setError('Could not disconnect ORIO.')
    }
  }

  return (
    <main className="settings-page">
      <aside className="settings-sidebar" aria-label="Settings categories">
        <div><div className="settings-kicker">ORIO</div><h1>Settings</h1></div>
        {([
          ['general', 'General', 'Language and save location'],
          ['account', 'Account & Cloud', 'ORIO connection'],
          ['about', 'Updates & About', 'Version and release channel'],
        ] as const).map(([id, label, detail]) => (
          <button key={id} className={category === id ? 'settings-nav active' : 'settings-nav'} onClick={() => setCategory(id)}>
            <span>{label}</span><small>{detail}</small>
          </button>
        ))}
      </aside>
      <section className="settings-content">
        {category === 'general' && <>
          <header><h2>General</h2><p>Choose how ORIO looks and where new files are stored.</p></header>
          <div className="settings-card"><h3>Language</h3><p>Changes the app menus and desktop interface.</p>
            <select value={lang} onChange={(event) => setLang(event.target.value as typeof lang)}>
              {languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="settings-card"><h3>Default save folder</h3><p>New Docs, Sheets, and Slides save here unless they are created in a project.</p>
            <div className="settings-path"><code>{saveDirectory || 'Loading…'}</code><button className="settings-button" onClick={() => void chooseFolder()}>Choose folder</button></div>
          </div>
        </>}
        {category === 'account' && <>
          <header><h2>Account & Cloud</h2><p>Manage the ORIO account used by AI and cloud project sync.</p></header>
          <div className="settings-card"><h3>ORIO connection</h3><p><span className={`settings-status ${connection}`} />{connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Waiting for browser authorization…' : connection === 'expired' ? 'Authorization expired' : 'Not connected'}</p>
            <div className="settings-actions">
              {connection === 'connected' ? <button className="settings-button secondary" onClick={() => void disconnect()}>Disconnect</button> : <button className="settings-button" disabled={pendingAuth} onClick={() => void authorize()}>{pendingAuth || connection === 'connecting' ? 'Opening browser…' : connection === 'expired' ? 'Reconnect ORIO' : 'Connect ORIO'}</button>}
            </div>
          </div>
          <p className="settings-note">Project folders, cloud sync, and conflict resolution stay in each project’s dedicated page.</p>
        </>}
        {category === 'about' && <>
          <header><h2>Updates & About</h2><p>Control your release channel and view this installed app version.</p></header>
          <div className="settings-card"><h3>Update channel</h3><p>Beta builds receive new features before the stable release.</p>
            <select value={channel} onChange={(event) => { const next = event.target.value as 'stable' | 'beta'; setChannel(next); void window.aiOffice.setUpdateChannel(next) }}><option value="stable">Stable</option><option value="beta">Beta</option></select>
          </div>
          <div className="settings-card"><h3>ORIO</h3><p>Version {version || 'Loading…'}</p></div>
        </>}
        {error && <p className="settings-error" role="alert">{error}</p>}
      </section>
    </main>
  )
}
