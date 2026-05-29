import { expect, test } from '@playwright/test'
import { mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

test('opens the command center login from the root route', async ({ page }) => {
  const api = await mockHermesApi(page)

  await page.goto('/')

  await expect(page).toHaveURL(/#\/hermes\/dashboard$/)
  await expect(page.locator('.auth-gate')).toBeVisible()
  await expect(page.getByText('Sign In')).toBeVisible()
  await expect(page.getByText('Hermes Command Center')).toBeVisible()
  await expect(page.locator('.dashboard-view')).toHaveCount(0)
  await expect(page.getByPlaceholder('Username')).toHaveValue('hermes')
  await expect(page.getByPlaceholder('Password')).toBeVisible()
  expect(api.unexpectedRequests).toEqual([])
})

test('logs in with command center credentials', async ({ page }) => {
  await mockHermesApi(page)

  await page.goto('/')
  await page.getByPlaceholder('Password').fill('4321')
  await page.getByRole('button', { name: 'Enter Command Center' }).click()

  await expect(page.evaluate(() => window.localStorage.getItem('hermes_api_key'))).resolves.toBe(TEST_ACCESS_KEY)
  await expect(page.locator('.dashboard-view')).toBeVisible()
})

test('stores an auto-login token from the URL before entering the dashboard', async ({ page }) => {
  await mockHermesApi(page)

  await page.goto(`/?token=${TEST_ACCESS_KEY}`)

  await expect(page).toHaveURL(/#\/hermes\/dashboard$/)
  await expect(page.evaluate(() => window.localStorage.getItem('hermes_api_key'))).resolves.toBe(TEST_ACCESS_KEY)
})
