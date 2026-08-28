import { test, expect } from '@playwright/test'
import { closeAndSaveVideo, launchShell, screenshotPath } from './helpers'

test.describe('workspace agent', () => {
  test('keeps its standalone sidebar and renders the shared composer', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'workspace-agent' })
    const { page } = launched
    try {
      await page.getByTitle('Workspace Agent').click()

      await expect(page.getByRole('main', { name: 'Workspace Agent' })).toBeVisible()
      await expect(page.locator('.workspace-agent-sidebar')).toContainText('Project Context')
      await expect(page.locator('.workspace-composer .ai-input-box')).toBeVisible()

      const composer = page.getByRole('textbox', { name: 'Workspace Agent task instruction' })
      await composer.fill('Compare these files')
      await composer.press('Shift+Enter')
      await composer.type(' and summarize the differences')
      await expect(composer).toHaveValue('Compare these files\n and summarize the differences')
      await expect(page.getByRole('button', { name: 'Run task' })).toBeVisible()

      await page.screenshot({ path: screenshotPath('workspace-agent-desktop') })
      await page.setViewportSize({ width: 1024, height: 700 })
      await page.screenshot({ path: screenshotPath('workspace-agent-narrow') })
    } finally {
      await closeAndSaveVideo(launched, 'workspace-agent')
    }
  })
})
