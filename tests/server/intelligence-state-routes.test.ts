import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { intelligenceStateRoutes } from '../../packages/server/src/routes/hermes/intelligence-state'
import {
  readDashboardIntelligenceState,
  sanitizeDashboardIntelligenceState,
} from '../../packages/server/src/services/hermes/intelligence-state'

async function runRouteLayer(layer: any, ctx: any) {
  let index = -1
  async function dispatch(nextIndex: number): Promise<void> {
    if (nextIndex <= index) throw new Error('next called multiple times')
    index = nextIndex
    const fn = layer.stack[nextIndex]
    if (!fn) return
    await fn(ctx, () => dispatch(nextIndex + 1))
  }
  await dispatch(0)
}

function createCtx(method: string, body: Record<string, unknown> | null = null) {
  return {
    method,
    path: '/api/hermes/intelligence-state',
    request: { body },
    state: {
      user: { id: 1, username: 'owner', role: 'super_admin' },
      profile: { name: 'default' },
    },
    get: vi.fn(() => ''),
    ip: '127.0.0.1',
    status: 200,
    body: null,
  } as any
}

describe('dashboard intelligence state routes', () => {
  const originalHermesHome = process.env.HERMES_HOME
  let hermesHome = ''

  beforeEach(() => {
    hermesHome = mkdtempSync(join(tmpdir(), 'hermes-intelligence-state-'))
    process.env.HERMES_HOME = hermesHome
  })

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = originalHermesHome
    rmSync(hermesHome, { recursive: true, force: true })
  })

  it('sanitizes dashboard intelligence state to known arrays and redacts secret-looking keys', () => {
    const sanitized = sanitizeDashboardIntelligenceState({
      marketClaims: [{ label: 'China demand', apiKey: 'do-not-store', safe: 'visible' }],
      randomKey: [{ should: 'drop' }],
    })

    expect(sanitized).toMatchObject({
      marketClaims: [{ label: 'China demand', apiKey: '[REDACTED]', safe: 'visible' }],
      competitors: [],
      financialModels: [],
    })
    expect(sanitized).not.toHaveProperty('randomKey')
  })

  it('stores and reads owner dashboard intelligence state from the active profile', async () => {
    const putLayer = intelligenceStateRoutes.stack.find((entry: any) =>
      entry.path === '/api/hermes/intelligence-state' && entry.methods.includes('PUT'),
    )
    const getLayer = intelligenceStateRoutes.stack.find((entry: any) =>
      entry.path === '/api/hermes/intelligence-state' && entry.methods.includes('GET'),
    )
    const putCtx = createCtx('PUT', {
      state: {
        marketClaims: [{
          label: 'Country-wise consumption growth - China',
          value: 'Trade Proxy / To Verify',
          accessToken: 'should-redact',
        }],
        researchFindings: [{
          keyClaim: 'Supplier scorecard needs quote evidence',
          evidenceStatus: 'To Verify',
        }],
      },
    })

    await runRouteLayer(putLayer, putCtx)

    expect(putCtx.body).toMatchObject({ ok: true, profile: 'default' })
    const savedFile = readFileSync(join(hermesHome, 'dashboard-intelligence', 'state.json'), 'utf-8')
    expect(savedFile).toContain('Country-wise consumption growth - China')
    expect(savedFile).not.toContain('should-redact')
    expect(savedFile).toContain('[REDACTED]')

    const direct = await readDashboardIntelligenceState('default')
    expect(direct?.state.marketClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Country-wise consumption growth - China' }),
    ]))

    const getCtx = createCtx('GET')
    await runRouteLayer(getLayer, getCtx)

    expect(getCtx.body).toMatchObject({
      ok: true,
      profile: 'default',
      state: {
        marketClaims: expect.arrayContaining([
          expect.objectContaining({ value: 'Trade Proxy / To Verify' }),
        ]),
      },
      autopilotImport: expect.objectContaining({
        profile: 'default',
        jobCount: 0,
        outputCount: 0,
        importedRunCount: 0,
      }),
    })
  })

  it('returns sanitized full-dashboard autopilot import status from the server registry', async () => {
    const cronDir = join(hermesHome, 'cron')
    const outputDir = join(cronDir, 'output', 'job-full-dashboard')
    const registryDir = join(hermesHome, 'dashboard-intelligence')
    mkdirSync(outputDir, { recursive: true })
    mkdirSync(registryDir, { recursive: true })
    writeFileSync(join(cronDir, 'jobs.json'), JSON.stringify({
      jobs: [{
        id: 'job-full-dashboard',
        job_id: 'job-full-dashboard',
        name: 'Full Dashboard Trusted Source Autopilot',
        prompt: 'Return dashboard_updates for the full dashboard.',
      }],
    }))
    writeFileSync(join(outputDir, '2026-06-03T07-00-00.md'), '# output')
    writeFileSync(join(outputDir, '2026-06-03T19-00-00.md'), '# output')
    writeFileSync(join(registryDir, 'imported-runs.json'), JSON.stringify({
      version: 1,
      importedRunKeys: ['job-full-dashboard/2026-06-03T19-00-00.md'],
      updatedAt: '2026-06-03T19:02:00.000Z',
    }))

    const getLayer = intelligenceStateRoutes.stack.find((entry: any) =>
      entry.path === '/api/hermes/intelligence-state' && entry.methods.includes('GET'),
    )
    const getCtx = createCtx('GET')

    await runRouteLayer(getLayer, getCtx)

    expect(getCtx.body).toMatchObject({
      ok: true,
      autopilotImport: {
        profile: 'default',
        jobCount: 1,
        outputCount: 2,
        importedRunCount: 1,
        pendingOutputCount: 1,
        latestOutputRunKey: 'job-full-dashboard/2026-06-03T19-00-00.md',
        latestOutputFile: '2026-06-03T19-00-00.md',
        latestOutputImported: true,
        latestImportedRunKey: 'job-full-dashboard/2026-06-03T19-00-00.md',
        registryUpdatedAt: '2026-06-03T19:02:00.000Z',
      },
    })
    expect(JSON.stringify(getCtx.body)).not.toContain('# output')
  })

  it('rejects non-object dashboard intelligence payloads', async () => {
    const putLayer = intelligenceStateRoutes.stack.find((entry: any) =>
      entry.path === '/api/hermes/intelligence-state' && entry.methods.includes('PUT'),
    )
    const ctx = createCtx('PUT', { state: null })

    await runRouteLayer(putLayer, ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toMatchObject({ code: 'invalid_state' })
  })
})
