import { expect, test, type Page } from '@playwright/test'
import { authenticate, mockHermesApi } from './fixtures'

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
  const api = await mockHermesApi(page)
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto('/#/hermes/chat')

  await expect(page.getByText('Private Command Center')).toBeVisible()
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
