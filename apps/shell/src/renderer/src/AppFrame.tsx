import { useEffect, useState } from 'react'
import { Home } from './Home'
import { Onboarding } from './Onboarding'
import { TabBar } from './TabBar'
import { WorkspaceAgent } from './WorkspaceAgent'
import { Settings } from './Settings'

interface AppFrameProps {
  /** resolved before first paint (main.tsx) so home never flashes under the overlay */
  initialOnboardingSeen: boolean
}

export function AppFrame({ initialOnboardingSeen }: AppFrameProps) {
  const [activeKind, setActiveKind] = useState<'home' | 'agent' | 'settings' | 'editor'>('home')
  const [showOnboarding, setShowOnboarding] = useState(!initialOnboardingSeen)

  useEffect(() => {
    const applyTabs = (tabs: Awaited<ReturnType<typeof window.aiOfficeTabs.list>>) => {
      const active = tabs.find((tab) => tab.active)
      setActiveKind(
        !active || active.kind === 'home' ? 'home' : active.kind === 'agent' ? 'agent' : active.kind === 'settings' ? 'settings' : 'editor',
      )
    }
    void window.aiOfficeTabs.list().then(applyTabs)
    return window.aiOfficeTabs.onChanged(applyTabs)
  }, [])

  const finishOnboarding = () => {
    setShowOnboarding(false)
    void window.aiOffice.setOnboardingSeen().catch(() => {})
  }

  return (
    <div className="app-frame">
      <TabBar />
      {/* docs/sheets tabs render as WebContentsView children of this window, positioned
       * by the main process to cover this area — only Home paints its own content here. */}
      <div
        className="app-frame-content"
        style={{ visibility: activeKind === 'editor' ? 'hidden' : 'visible' }}
      >
        {activeKind === 'agent' ? <WorkspaceAgent /> : activeKind === 'settings' ? <Settings /> : <Home />}
      </div>
      {/* editor WebContentsViews paint above ALL shell DOM, so the overlay only
       * renders while the home tab is active — it comes back when home does */}
      {showOnboarding && activeKind === 'home' && <Onboarding onDone={finishOnboarding} />}
    </div>
  )
}
