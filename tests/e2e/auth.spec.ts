import { expect, test } from '@playwright/test'
import { mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

test('opens the dashboard shell from the root route without a login page', async ({ page }) => {
  const api = await mockHermesApi(page)

  await page.goto('/')

  await expect(page).toHaveURL(/#\/hermes\/chat$/)
  await expect(page.getByText('Private Command Center')).toBeVisible()
  await expect(page.getByPlaceholder('Username')).toHaveCount(0)
  await expect(page.getByPlaceholder('Password')).toHaveCount(0)
  expect(api.unexpectedRequests).toEqual([])
})

test('stores an auto-login token from the URL before entering the dashboard', async ({ page }) => {
  await mockHermesApi(page)

  await page.goto(`/?token=${TEST_ACCESS_KEY}`)

  await expect(page).toHaveURL(/#\/hermes\/chat$/)
  await expect(page.evaluate(() => window.localStorage.getItem('hermes_api_key'))).resolves.toBe(TEST_ACCESS_KEY)
})
