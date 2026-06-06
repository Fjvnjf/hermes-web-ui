import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { intelligenceStateRoutes } from '../../packages/server/src/routes/hermes/intelligence-state'
import {
  readDashboardIntelligenceState,
  sanitizeDashboardIntelligenceState,
} from '../../packages/server/src/services/hermes/intelligence-state'
import { DASHBOARD_AUTOPILOT_IMPORTER_VERSION } from '../../packages/server/src/services/hermes/dashboard-autopilot-ingest'

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

function createCtx(method: string, body: Record<string, unknown> | null = null, path = '/api/hermes/intelligence-state') {
  return {
    method,
    path,
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
      rawMaterialSignals: [{ material: 'Stearic Acid', authorization: 'do-not-store' }],
      supplierScorecards: [{ supplier: 'Wilmar', material: 'Stearic Acid' }],
      regulatoryFindings: [{ label: 'DMS regulatory check' }],
      financialEvidence: [{ label: 'Investment model source' }],
      suggestedTasks: [{ title: 'Review supplier quote' }],
      investorMaterialCandidates: [{ section: 'Risk register' }],
      randomKey: [{ should: 'drop' }],
    })

    expect(sanitized).toMatchObject({
      marketClaims: [{ label: 'China demand', apiKey: '[REDACTED]', safe: 'visible' }],
      rawMaterialSignals: [{ material: 'Stearic Acid', authorization: '[REDACTED]' }],
      supplierScorecards: [{ supplier: 'Wilmar', material: 'Stearic Acid' }],
      regulatoryFindings: [{ label: 'DMS regulatory check' }],
      financialEvidence: [{ label: 'Investment model source' }],
      suggestedTasks: [{ title: 'Review supplier quote' }],
      investorMaterialCandidates: [{ section: 'Risk register' }],
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

  it('normalizes old flat competitor metric review targets to clean company names on read', async () => {
    const putLayer = intelligenceStateRoutes.stack.find((entry: any) =>
      entry.path === '/api/hermes/intelligence-state' && entry.methods.includes('PUT'),
    )
    const putCtx = createCtx('PUT', {
      state: {
        researchFindings: [{
          keyClaim: 'Metrics DOW Market: Market-share reference identified',
          evidenceStatus: 'To Verify',
          source: {
            title: 'Mordor Intelligence: Surfactants Market Companies',
            url: 'https://www.mordorintelligence.com/industry-reports/surfactants-market/companies',
          },
          dashboardTarget: {
            group: 'competitorRecords',
            fieldKey: 'competitor_metrics.dow.market_share',
            field: 'Metrics DOW Market',
            proposedDashboardField: 'Metrics DOW Market',
            companyName: 'Metrics DOW Market',
            marketShare: 'Market-share reference identified; exact textile-softener share not approved.',
          },
        }],
      },
    })

    await runRouteLayer(putLayer, putCtx)

    const direct = await readDashboardIntelligenceState('default')
    expect(direct?.state.researchFindings).toEqual([
      expect.objectContaining({
        dashboardTarget: expect.objectContaining({
          fieldKey: 'competitor_metrics.dow.market_share',
          field: 'Dow - Market share',
          proposedDashboardField: 'Dow - Market share',
          companyName: 'Dow',
          marketShare: 'Market-share reference identified; exact textile-softener share not approved.',
        }),
      }),
    ])
  })

  it('deduplicates repeated research findings before writing durable state', async () => {
    const sanitized = sanitizeDashboardIntelligenceState({
      researchFindings: [
        {
          id: 'old-copy',
          status: 'Pending Review',
          keyClaim: 'Dashboard update: Missing proof',
          summary: 'Imported by Full Dashboard Trusted Source Autopilot from Financial evidence.',
          evidenceStatus: 'To Verify',
          source: { title: 'Workspace evidence search', url: 'https://example.com/source' },
          dashboardTarget: {
            group: 'financialEvidence',
            fieldKey: 'investment.irr',
            proposedDashboardField: 'Projected IRR',
            value: 'Missing / To Verify',
          },
        },
        {
          id: 'latest-copy',
          status: 'Pending Review',
          keyClaim: 'Dashboard update: Missing proof',
          summary: 'Imported by Full Dashboard Trusted Source Autopilot from Financial evidence.',
          evidenceStatus: 'To Verify',
          source: { title: 'Workspace evidence search', url: 'https://example.com/source' },
          dashboardTarget: {
            group: 'financialEvidence',
            fieldKey: 'investment.irr',
            proposedDashboardField: 'Projected IRR',
            value: 'Missing / To Verify',
          },
        },
        {
          id: 'different-status-copy',
          status: 'Approved',
          keyClaim: 'Dashboard update: Missing proof',
          summary: 'Imported by Full Dashboard Trusted Source Autopilot from Financial evidence.',
          evidenceStatus: 'Source-backed',
          source: { title: 'Workspace evidence search', url: 'https://example.com/source' },
          dashboardTarget: {
            group: 'financialEvidence',
            fieldKey: 'investment.irr',
            proposedDashboardField: 'Projected IRR',
            value: 'Missing / To Verify',
          },
        },
      ],
    })

    expect(sanitized.researchFindings).toEqual([
      expect.objectContaining({ id: 'latest-copy' }),
      expect.objectContaining({ id: 'different-status-copy' }),
    ])
  })

  it('stores a large trusted-source review backlog without rejecting legitimate dashboard state', async () => {
    const putLayer = intelligenceStateRoutes.stack.find((entry: any) =>
      entry.path === '/api/hermes/intelligence-state' && entry.methods.includes('PUT'),
    )
    const largeSummary = 'Source-backed dashboard review item. '.repeat(24)
    const researchFindings = Array.from({ length: 3_000 }, (_, index) => ({
      id: `finding-${index}`,
      summary: `${largeSummary}${index}`,
      keyClaim: `Competitor metric review item ${index}`,
      evidenceStatus: 'To Verify',
      source: { title: 'Trusted-source autopilot output', url: `https://example.com/source/${index}` },
      dashboardTarget: {
        group: 'competitorRecords',
        companyName: 'Evonik Industries',
        proposedDashboardField: 'Evonik Industries - Market share',
        marketShare: 'Review required',
      },
    }))
    const putCtx = createCtx('PUT', {
      state: {
        marketClaims: [],
        competitors: [],
        researchFindings,
      },
    })

    await runRouteLayer(putLayer, putCtx)

    expect(putCtx.status).toBe(200)
    expect(putCtx.body).toMatchObject({ ok: true, profile: 'default' })
    const savedFile = readFileSync(join(hermesHome, 'dashboard-intelligence', 'state.json'), 'utf-8')
    expect(Buffer.byteLength(savedFile, 'utf-8')).toBeGreaterThan(2_000_000)
    const direct = await readDashboardIntelligenceState('default')
    expect((direct?.state.researchFindings as unknown[])).toHaveLength(3_000)
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
      importerVersion: DASHBOARD_AUTOPILOT_IMPORTER_VERSION,
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
        latestOutputParseStatus: 'imported',
        latestOutputCandidateCount: 0,
        latestOutputParseError: '',
        latestImportedRunKey: 'job-full-dashboard/2026-06-03T19-00-00.md',
        registryUpdatedAt: '2026-06-03T19:02:00.000Z',
      },
    })
    expect(JSON.stringify(getCtx.body)).not.toContain('# output')
  })

  it('returns autopilot import status through the lightweight jobs-scoped endpoint', async () => {
    const cronDir = join(hermesHome, 'cron')
    const outputDir = join(cronDir, 'output', 'job-full-dashboard')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(cronDir, 'jobs.json'), JSON.stringify({
      jobs: [{
        id: 'job-full-dashboard',
        job_id: 'job-full-dashboard',
        name: 'Full Dashboard Trusted Source Autopilot',
        prompt: 'Return dashboard_updates for the full dashboard.',
      }],
    }))
    writeFileSync(join(outputDir, '2026-06-03T19-00-00.md'), [
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Market Intelligence',
      '',
      '| Field | Value | Source | Source Tier | Confidence | Evidence Status | Review Required |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| Target provinces | Zhejiang textile cluster source-backed | [Zhejiang official](https://www.zhejiang.gov.cn/) | Tier 1 | high | Official Data | no |',
    ].join('\n'))

    const getLayer = intelligenceStateRoutes.stack.find((entry: any) =>
      entry.path === '/api/hermes/intelligence-state/autopilot-import-status' && entry.methods.includes('GET'),
    )
    const getCtx = createCtx('GET', null, '/api/hermes/intelligence-state/autopilot-import-status')

    await runRouteLayer(getLayer, getCtx)

    expect(getCtx.body).toMatchObject({
      ok: true,
      profile: 'default',
      autopilotImport: {
        profile: 'default',
        jobCount: 1,
        outputCount: 1,
        importedRunCount: 0,
        latestOutputFile: '2026-06-03T19-00-00.md',
        latestOutputImported: false,
        latestOutputParseStatus: 'ready',
        latestOutputCandidateCount: 1,
      },
    })
    expect(JSON.stringify(getCtx.body)).not.toContain('Zhejiang textile cluster source-backed')
  })

  it('imports ready full-dashboard autopilot output through the owner import endpoint', async () => {
    const cronDir = join(hermesHome, 'cron')
    const outputDir = join(cronDir, 'output', 'job-full-dashboard')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(cronDir, 'jobs.json'), JSON.stringify({
      jobs: [{
        id: 'job-full-dashboard',
        job_id: 'job-full-dashboard',
        name: 'Full Dashboard Trusted Source Autopilot',
        prompt: 'Return dashboard_updates for the full dashboard.',
      }],
    }))
    writeFileSync(join(outputDir, '2026-06-03T19-00-00.md'), [
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Market Intelligence',
      '',
      '| Field | Value | Source | Source Tier | Confidence | Evidence Status | Review Required |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| Target provinces | Zhejiang textile cluster source-backed | [Zhejiang official](https://www.zhejiang.gov.cn/) | Tier 1 | high | Official Data | no |',
    ].join('\n'))

    const postLayer = intelligenceStateRoutes.stack.find((entry: any) =>
      entry.path === '/api/hermes/intelligence-state/autopilot-import-now' && entry.methods.includes('POST'),
    )
    const postCtx = createCtx('POST', null, '/api/hermes/intelligence-state/autopilot-import-now')

    await runRouteLayer(postLayer, postCtx)

    expect(postCtx.body).toMatchObject({
      ok: true,
      profile: 'default',
      importResult: {
        importedRuns: 1,
        autoFilledCount: 1,
      },
      autopilotImport: {
        latestOutputImported: true,
        latestOutputParseStatus: 'imported',
      },
    })
    expect(JSON.stringify(postCtx.body)).not.toContain('Zhejiang textile cluster source-backed')

    const direct = await readDashboardIntelligenceState('default')
    expect(direct?.state.marketClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Target provinces',
        value: 'Zhejiang textile cluster source-backed',
        source: expect.objectContaining({
          title: 'Zhejiang official',
          url: 'https://www.zhejiang.gov.cn/',
        }),
      }),
    ]))
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
