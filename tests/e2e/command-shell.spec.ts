import { expect, test, type Page } from '@playwright/test'
import { authenticate, mockChatSocket, mockHermesApi, mockTerminalWebSocket } from './fixtures'

const requiredSidebarItems = [
  'Chat',
  'History',
  'Group Chat',
  'Jobs',
  'Kanban',
  'Channels',
  'Skills',
  'Plugins',
  'Memory',
  'Models',
  'Logs',
  'Usage',
  'Performance',
  'Skills Usage',
  'Files',
  'Terminal',
  'Version Preview',
  'Profiles',
  'Settings',
]
const shellLoadTimeout = 15_000

const requiredTopbarActions = ['Search', 'Chat', 'Files', 'Terminal', 'Settings']
const requiredSessionActions = [
  'Open files drawer',
  'Open terminal drawer',
  'Copy session link',
  'Open settings',
  'Refresh runtime',
]
const requiredEmptyShortcuts = [
  { label: 'Files', href: '#/hermes/files' },
  { label: 'Terminal', href: '#/hermes/terminal' },
  { label: 'Models', href: '#/hermes/models' },
  { label: 'Jobs', href: '#/hermes/jobs' },
]
const commandRoutes = [
  { path: '/#/hermes/chat', selector: '.chat-view' },
  { path: '/#/hermes/history', selector: '.history-panel' },
  { path: '/#/hermes/jobs', selector: '.jobs-view' },
  { path: '/#/hermes/kanban', selector: '.kanban-view' },
  { path: '/#/hermes/models', selector: '.models-view' },
  { path: '/#/hermes/profiles', selector: '.profiles-view' },
  { path: '/#/hermes/logs', selector: '.logs-view' },
  { path: '/#/hermes/usage', selector: '.usage-view' },
  { path: '/#/hermes/performance', selector: '.performance-view' },
  { path: '/#/hermes/skills-usage', selector: '.skills-usage-view' },
  { path: '/#/hermes/skills', selector: '.skills-view' },
  { path: '/#/hermes/plugins', selector: '.plugins-view' },
  { path: '/#/hermes/memory', selector: '.memory-view' },
  { path: '/#/hermes/settings', selector: '.settings-view' },
  { path: '/#/hermes/channels', selector: '.channels-view' },
  { path: '/#/hermes/terminal', selector: '.terminal-panel' },
  { path: '/#/hermes/group-chat', selector: '.group-chat-view' },
  { path: '/#/hermes/files', selector: '.files-view' },
  { path: '/#/hermes/version-preview', selector: '.version-preview-view' },
]

async function expectNoHorizontalViewportOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(Math.max(metrics.bodyScrollWidth, metrics.documentScrollWidth)).toBeLessThanOrEqual(metrics.innerWidth + 1)
}

async function sidebarNavTexts(page: Page): Promise<string[]> {
  return page.locator('.sidebar .nav-item').evaluateAll(elements =>
    elements.map(element => (element.textContent || '').replace(/\s+/g, ' ').trim()),
  )
}

test('desktop command shell exposes the complete Hermes feature surface', async ({ page }) => {
  await authenticate(page)
  await mockTerminalWebSocket(page)
  const api = await mockHermesApi(page)
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto('/#/hermes/chat')

  await expect(page.locator('.topbar-brand')).toHaveText('Hermes Command Center', { timeout: shellLoadTimeout })
  const topbarActions = page.locator('.topbar-actions')
  for (const action of requiredTopbarActions) {
    await expect(topbarActions.getByRole('button', { name: action })).toBeVisible()
  }
  await topbarActions.getByRole('button', { name: 'Files' }).click()
  await expect(page).toHaveURL(/#\/hermes\/files$/)
  await topbarActions.getByRole('button', { name: 'Chat' }).click()
  await expect(page).toHaveURL(/#\/hermes\/chat$/)
  const sessionActions = page.locator('.command-strip-actions')
  for (const action of requiredSessionActions) {
    await expect(sessionActions.getByRole('button', { name: action })).toBeVisible()
  }
  const emptyShortcuts = page.locator('.empty-actions')
  for (const shortcut of requiredEmptyShortcuts) {
    await expect(emptyShortcuts.getByRole('link', { name: shortcut.label })).toHaveAttribute('href', shortcut.href)
  }
  await sessionActions.getByRole('button', { name: 'Open files drawer' }).click()
  await expect(page.locator('.drawer-panel.show')).toBeVisible()
  await expect(page.locator('.drawer-panel.show .tab-button.active')).toHaveText('Workspace')
  await page.locator('.drawer-panel.show .close-button').click()
  await expect(page.locator('.drawer-panel.show')).toHaveCount(0)
  await sessionActions.getByRole('button', { name: 'Open terminal drawer' }).click()
  await expect(page.locator('.drawer-panel.show .tab-button.active')).toHaveText('Terminal')
  await page.locator('.drawer-panel.show .close-button').click()
  const navTexts = await sidebarNavTexts(page)
  for (const item of requiredSidebarItems) {
    expect(navTexts.some(text => text === item || text.startsWith(`${item}(`))).toBe(true)
  }
  await expectNoHorizontalViewportOverflow(page)
  expect(api.unexpectedRequests).toEqual([])
})

test('mobile command shell uses the drawer and keeps navigation usable', async ({ page }) => {
  await authenticate(page)
  await mockHermesApi(page)
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto('/#/hermes/chat')

  await expect(page.locator('.sidebar')).not.toHaveClass(/open/)
  await page.locator('.hamburger-btn').click()
  await expect(page.locator('.sidebar')).toHaveClass(/open/)
  const navTexts = await sidebarNavTexts(page)
  expect(navTexts).toContain('Files')
  expect(navTexts).toContain('Terminal')
  await expectNoHorizontalViewportOverflow(page)
})

test('all command center routes mount inside the redesigned shell on desktop and mobile', async ({ page }) => {
  await authenticate(page)
  await mockChatSocket(page)
  await mockTerminalWebSocket(page)
  const api = await mockHermesApi(page)

  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)

    for (const route of commandRoutes) {
      await page.goto(route.path)
      await expect(page.locator('.topbar-brand')).toHaveText('Hermes Command Center', { timeout: shellLoadTimeout })
      await expect(page.locator(route.selector)).toBeVisible()
      await expect(page.getByText('Private Command Center')).toHaveCount(0)
      await expect(page.getByPlaceholder('Username')).toHaveCount(0)
      await expect(page.getByPlaceholder('Password')).toHaveCount(0)
      await expectNoHorizontalViewportOverflow(page)
    }
  }

  expect(pageErrors).toEqual([])
  expect(api.unexpectedRequests).toEqual([])
})
