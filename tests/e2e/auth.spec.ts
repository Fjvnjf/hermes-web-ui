import { expect, test } from '@playwright/test'
import { mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

test('opens the secure-link gate from the root route without a login page', async ({ page }) => {
  const api = await mockHermesApi(page)

  await page.goto('/')

  await expect(page).toHaveURL(/#\/hermes\/dashboard$/)
  await expect(page.locator('.auth-gate')).toBeVisible()
  await expect(page.getByText('Secure Link Required')).toBeVisible()
  await expect(page.getByText('Hermes Command Center')).toBeVisible()
  await expect(page.locator('.dashboard-view')).toHaveCount(0)
  await expect(page.getByPlaceholder('Username')).toHaveCount(0)
  await expect(page.getByPlaceholder('Password')).toHaveCount(0)
  expect(api.unexpectedRequests).toEqual([])
})

test('stores an auto-login token from the URL before entering the dashboard', async ({ page }) => {
  await mockHermesApi(page)

  await page.goto(`/?token=${TEST_ACCESS_KEY}`)

  await expect(page).toHaveURL(/#\/hermes\/dashboard$/)
  await expect(page.evaluate(() => window.localStorage.getItem('hermes_api_key'))).resolves.toBe(TEST_ACCESS_KEY)
})
