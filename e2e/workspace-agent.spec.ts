import { test, expect } from '@playwright/test'
import { closeAndSaveVideo, launchShell, screenshotPath } from './helpers'

test.describe('workspace agent', () => {
  test('keeps the Agent tab selectable and requires ORIO authorization before the workspace', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'workspace-agent' })
    const { page } = launched
    try {
      await page.getByTitle('Workspace Agent').click()

      await expect(page.getByRole('main', { name: 'Authorize Workspace Agent' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Authorize ORIO Cloud' })).toBeVisible()
      await expect(page.locator('.workspace-agent-sidebar')).toHaveCount(0)

      await page.screenshot({ path: screenshotPath('workspace-agent-desktop') })
      await page.setViewportSize({ width: 1024, height: 700 })
      await page.screenshot({ path: screenshotPath('workspace-agent-narrow') })
    } finally {
      await closeAndSaveVideo(launched, 'workspace-agent')
    }
  })
})
