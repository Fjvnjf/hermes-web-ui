import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('../../packages/server/src/services/hermes/hermes-path', () => ({
  detectHermesRootHome: () => process.env.HERMES_HOME || '',
  getHermesBin: () => '/fake/bin/hermes',
}))

import {
  FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
  dashboardSourceTierRank,
  ensureFullDashboardAutopilotScheduled,
  extractDashboardResearchUpdates,
  ingestFullDashboardAutopilotOutputs,
} from '../../packages/server/src/services/hermes/dashboard-autopilot-ingest'
import { readDashboardIntelligenceState } from '../../packages/server/src/services/hermes/intelligence-state'

function writeFullDashboardJob(home: string, jobId = 'job-full-dashboard') {
  const cronDir = join(home, 'cron')
  mkdirSync(cronDir, { recursive: true })
  writeFileSync(join(cronDir, 'jobs.json'), JSON.stringify({
    jobs: [{
      id: jobId,
      job_id: jobId,
      name: 'Full Dashboard Trusted Source Autopilot',
      prompt: 'Research online trusted sources and return dashboard_updates for the full dashboard.',
      schedule_display: '0 8,20 * * *',
    }],
  }, null, 2))
}

function writeRunOutput(home: string, jobId: string, fileName: string, payload: unknown) {
  const outputDir = join(home, 'cron', 'output', jobId)
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, fileName), [
    '# Full Dashboard Trusted Source Autopilot',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
  ].join('\n'))
}

describe('dashboard autopilot output ingestion', () => {
  const originalHermesHome = process.env.HERMES_HOME
  let hermesHome = ''

  beforeEach(() => {
    execFileMock.mockReset()
    hermesHome = mkdtempSync(join(tmpdir(), 'hermes-dashboard-autopilot-'))
    process.env.HERMES_HOME = hermesHome
  })

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = originalHermesHome
    rmSync(hermesHome, { recursive: true, force: true })
  })

  it('ranks official sources ahead of weak public listings', () => {
    expect(dashboardSourceTierRank('tier1-official')).toBeLessThan(dashboardSourceTierRank('tier5-public-listing'))
    expect(dashboardSourceTierRank('tier2-company-official')).toBeLessThan(dashboardSourceTierRank('candidate-source'))
  })

  it('extracts dashboard_updates JSON from markdown output', () => {
    const payload = extractDashboardResearchUpdates([
      'Hermes result',
      '```dashboard_updates',
      JSON.stringify({
        dashboard_updates: {
          marketClaims: [{ label: 'Official policy source', value: 'Published' }],
        },
      }),
      '```',
    ].join('\n'))

    expect(payload?.marketClaims).toEqual([
      expect.objectContaining({ label: 'Official policy source', value: 'Published' }),
    ])
  })

  it('extracts the real output JSON when the saved cron prompt contains a fenced-json instruction', () => {
    const payload = extractDashboardResearchUpdates([
      '# Cron Job: Full Dashboard Trusted Source Autopilot',
      '',
      '## Prompt',
      'Put the appendix in one fenced ```json block.',
      'The top-level object must be: { "dashboard_updates": { ... } }.',
      '',
      '## Result',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '```json',
      JSON.stringify({
        dashboard_updates: {
          marketClaims: [{
            label: 'Official trade source',
            value: 'Source found',
            sourceTitle: 'Official source',
            sourceUrl: 'https://example.gov/trade',
            sourceTier: 'Tier 1 - Official / regulator / trade source',
            confidence: 'High',
            evidenceStatus: 'Official Data',
            dataType: 'company_data',
          }],
        },
      }, null, 2),
      '```',
    ].join('\n'))

    expect(payload?.marketClaims).toEqual([
      expect.objectContaining({ label: 'Official trade source', value: 'Source found' }),
    ])
  })

  it('auto-fills only low-risk official facts and stages critical findings for review', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-02T08-00-00.000000+00-00.md', {
      dashboard_updates: {
        marketClaims: [
          {
            field: 'Official textile sector reference',
            label: 'Official textile sector reference',
            value: 'China textile sector policy page identified',
            sourceTitle: 'Ministry textile policy page',
            sourceUrl: 'https://example.gov.cn/textile-policy',
            sourceTier: 'Tier 1 - Official / regulator / trade source',
            confidence: 'high',
            evidenceStatus: 'Official Data',
            dataType: 'company_data',
          },
          {
            field: 'Market Size / Scope',
            label: 'China market size',
            value: '$3.2B',
            sourceTitle: 'Weak marketplace summary',
            sourceUrl: 'https://example-marketplace.test/listing',
            sourceTier: 'Tier 5 - Public listing / weak reference',
            confidence: 'medium',
            evidenceStatus: 'Market Reference',
            dataType: 'market_size',
          },
        ],
        financialEvidence: [
          {
            field: 'Project IRR',
            value: '60%',
            sourceTitle: 'Unsourced screenshot template',
            sourceTier: 'candidate-source',
            confidence: 'low',
            evidenceStatus: 'Derived from Assumptions',
            dataType: 'financial_data',
          },
        ],
        supplierScorecards: [
          {
            field: 'Supplier scorecard - Wilmar',
            supplier: 'Wilmar',
            material: 'Stearic Acid TP',
            value: '$1,180/t',
            sourceTitle: 'Supplier quote needed',
            sourceTier: 'Tier 3 - Uploaded supplier evidence',
            confidence: 'medium',
            evidenceStatus: 'To Verify',
            dataType: 'supplier_quote',
            reviewRequired: true,
          },
        ],
        competitorRecords: [
          {
            companyName: 'Transfar',
            countryRegion: 'China',
            productEquivalent: 'Cationic softener',
            marketShare: '12%',
            sourceTitle: 'Public competitor note',
            sourceUrl: 'https://example.com/transfar',
            sourceTier: 'Tier 5 - Public listing / weak reference',
            confidence: 'medium',
            evidenceStatus: 'Market Reference',
            dataType: 'competitor_data',
          },
        ],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')

    expect(result).toMatchObject({
      jobsChecked: 1,
      importedRuns: 1,
      autoFilledCount: 1,
      stagedReviewCount: 4,
    })

    const envelope = await readDashboardIntelligenceState('default')
    expect(envelope?.state.marketClaims).toEqual([
      expect.objectContaining({
        label: 'Official textile sector reference',
        value: 'China textile sector policy page identified',
        evidenceStatus: 'Official Data',
        source: expect.objectContaining({
          title: 'Ministry textile policy page',
          url: 'https://example.gov.cn/textile-policy',
        }),
      }),
    ])
    expect(envelope?.state.financialModels).toEqual([])
    expect(envelope?.state.competitors).toEqual([])
    expect(envelope?.state.researchFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyClaim: expect.stringContaining('China market size'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'marketClaims',
          screen: 'market',
          proposedDashboardField: 'Market Size / Scope',
          value: '$3.2B',
          sourceTier: 'tier5-public-listing',
        }),
      }),
      expect.objectContaining({
        keyClaim: expect.stringContaining('Project IRR'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'financialEvidence',
          screen: 'investment',
          proposedDashboardField: 'Project IRR',
          value: '60%',
          dataType: 'financial_data',
        }),
      }),
      expect.objectContaining({
        keyClaim: expect.stringContaining('Supplier scorecard - Wilmar'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'supplierScorecards',
          screen: 'raw-material-sourcing',
          supplier: 'Wilmar',
          material: 'Stearic Acid TP',
          value: '$1,180/t',
        }),
      }),
      expect.objectContaining({
        keyClaim: expect.stringContaining('Transfar'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          screen: 'competitor',
          companyName: 'Transfar',
          marketShare: '12%',
        }),
      }),
    ]))

    const rawState = readFileSync(join(hermesHome, 'dashboard-intelligence', 'state.json'), 'utf-8')
    expect(rawState).not.toContain('"financialModels":[{"scenarioName"')
    expect(rawState).not.toContain('"marketShare":"12%"')
  })

  it('auto-stages trusted-source market and competitor candidates into dashboards without approving them', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-02T08-30-00.000000+00-00.md', {
      dashboard_updates: {
        marketClaims: [{
          field: 'Country-wise consumption growth - China',
          value: '2024 HS 380991 imports: $236,608.42K; quantity 65,409,000 kg',
          sourceTitle: 'WITS / World Bank Comtrade - China imports of HS 380991',
          sourceUrl: 'https://wits.worldbank.org/trade/comtrade/en/country/CHN/year/2024/tradeflow/Imports/partner/ALL/product/380991',
          confidence: 'medium',
          evidenceStatus: 'To Verify',
          dataType: 'market_size',
          riskReason: 'Broad HS-code proxy, not product-specific demand.',
        }],
        competitorRecords: [{
          companyName: 'Stepan',
          countryRegion: 'United States / global',
          productEquivalent: 'STEPANTEX SP-90 official product page describes a textile softening additive.',
          activeContent: 'Solids 90% shown on official page; exact active chemistry requires TDS/SDS review.',
          pricingEvidence: 'Missing / To Verify',
          certifications: 'Bio-Based / Naturally Derived / Plant Derived labels shown on page; documents To Verify.',
          distributionPresence: 'Missing / To Verify',
          marketShare: 'To Verify',
          sourceTitle: 'STEPANTEX SP-90',
          sourceUrl: 'https://www.stepan.com/content/stepan-dot-com/en/products-markets/product/STEPANTEXSP90.html',
          confidence: 'medium',
          evidenceStatus: 'To Verify',
          dataType: 'competitor_data',
          riskReason: 'No pricing, China distribution, market share, or Chemicon product equivalence proof.',
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 0,
      stagedReviewCount: 2,
    })
    expect(envelope?.state.marketClaims).toEqual([
      expect.objectContaining({
        label: 'Country-wise consumption growth - China',
        value: '2024 HS 380991 imports: $236,608.42K; quantity 65,409,000 kg',
        evidenceStatus: 'To Verify',
        source: expect.objectContaining({
          title: 'WITS / World Bank Comtrade - China imports of HS 380991',
          url: expect.stringContaining('wits.worldbank.org'),
        }),
      }),
    ])
    expect(envelope?.state.competitors).toEqual([
      expect.objectContaining({
        companyName: 'Stepan',
        productEquivalent: expect.stringContaining('STEPANTEX SP-90'),
        marketShare: '',
        evidenceStatus: 'To Verify',
        source: expect.objectContaining({
          title: 'STEPANTEX SP-90',
          url: expect.stringContaining('stepan.com'),
        }),
      }),
    ])
    expect(envelope?.state.researchFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyClaim: expect.stringContaining('Country-wise consumption growth - China'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'marketClaims',
          sourceTier: 'tier1-official',
        }),
      }),
      expect.objectContaining({
        keyClaim: expect.stringContaining('Stepan'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          sourceTier: 'tier2-company-official',
        }),
      }),
    ]))
  })

  it('deduplicates imported run files with an import registry', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-02T09-00-00.000000+00-00.md', {
      dashboard_updates: {
        marketClaims: [{
          label: 'Official low-risk company fact',
          value: 'Official catalog page found',
          sourceTitle: 'Official company catalog',
          sourceUrl: 'https://example.com/catalog',
          sourceTier: 'Tier 2 - Official company / product source',
          confidence: 'high',
          evidenceStatus: 'Source-backed',
          dataType: 'company_data',
        }],
      },
    })

    const first = await ingestFullDashboardAutopilotOutputs('default')
    const second = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(first.importedRuns).toBe(1)
    expect(second.importedRuns).toBe(0)
    expect(envelope?.state.marketClaims).toHaveLength(1)
    const registry = readFileSync(join(hermesHome, 'dashboard-intelligence', 'imported-runs.json'), 'utf-8')
    expect(registry).toContain('job-full-dashboard/2026-06-02T09-00-00.000000+00-00.md')
  })

  it('does not mark skipped non-parseable outputs as imported', async () => {
    writeFullDashboardJob(hermesHome)
    const outputDir = join(hermesHome, 'cron', 'output', 'job-full-dashboard')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, '2026-06-02T10-00-00.000000+00-00.md'), [
      '# Full Dashboard Trusted Source Autopilot',
      '',
      'The model did not return structured dashboard updates yet.',
    ].join('\n'))

    const first = await ingestFullDashboardAutopilotOutputs('default')
    const second = await ingestFullDashboardAutopilotOutputs('default')
    const registry = readFileSync(join(hermesHome, 'dashboard-intelligence', 'imported-runs.json'), 'utf-8')

    expect(first).toMatchObject({ skippedRuns: 1, importedRuns: 0 })
    expect(second).toMatchObject({ skippedRuns: 1, importedRuns: 0 })
    expect(registry).not.toContain('job-full-dashboard/2026-06-02T10-00-00.000000+00-00.md')
  })

  it('creates the twice-daily full dashboard schedule when no job exists', async () => {
    execFileMock.mockImplementation((_bin, args: string[], opts, cb) => {
      expect(opts.env.HERMES_HOME).toBe(hermesHome)
      expect(args[0]).toBe('cron')
      if (args[1] === 'create') writeFullDashboardJob(hermesHome, 'created-full-dashboard')
      cb(null, '', '')
    })

    const result = await ensureFullDashboardAutopilotScheduled('default')

    expect(result).toMatchObject({
      jobId: 'created-full-dashboard',
      created: true,
      recordedResearchJob: true,
      firstRunStarted: false,
    })
    const envelope = await readDashboardIntelligenceState('default')
    expect(envelope?.state.researchJobs).toEqual([
      expect.objectContaining({
        title: 'Full Dashboard Trusted Source Autopilot',
        scheduledJobId: 'created-full-dashboard',
        schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
        status: 'Scheduled Hermes Job',
      }),
    ])
    const createArgs = execFileMock.mock.calls[0][1] as string[]
    expect(createArgs.slice(0, 7)).toEqual([
      'cron',
      'create',
      '--name',
      'Full Dashboard Trusted Source Autopilot',
      '--deliver',
      'local',
      FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    ])
    const prompt = createArgs[7]
    expect(prompt).toContain('Do the online research yourself')
    expect(prompt).toContain('Executive Overview')
    expect(prompt).toContain('Market Intelligence')
    expect(prompt).toContain('Competitor Intelligence')
    expect(prompt).toContain('Investment Analysis')
    expect(prompt).toContain('Raw Material Sourcing')
    expect(prompt).toContain('Supplier Scorecards')
    expect(prompt).toContain('Export Market Opportunity')
    expect(prompt).toContain('Regulatory')
    expect(prompt).toContain('Investor Readiness')
    expect(prompt).toContain('Presentation Builder')
    expect(prompt).toContain('dashboard_updates')
    expect(prompt).toContain('Do not invent market size')
  })

  it('reuses an existing full dashboard schedule without creating a duplicate', async () => {
    writeFullDashboardJob(hermesHome, 'existing-full-dashboard')

    const result = await ensureFullDashboardAutopilotScheduled('default', { startFirstRun: true })

    expect(result).toMatchObject({
      jobId: 'existing-full-dashboard',
      created: false,
      recordedResearchJob: true,
      firstRunStarted: false,
    })
    expect(execFileMock).not.toHaveBeenCalled()
    const envelope = await readDashboardIntelligenceState('default')
    expect(envelope?.state.researchJobs).toEqual([
      expect.objectContaining({
        title: 'Full Dashboard Trusted Source Autopilot',
        scheduledJobId: 'existing-full-dashboard',
        schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
        status: 'Scheduled Hermes Job',
      }),
    ])
  })

  it('can start the first created run and import its review-gated output', async () => {
    execFileMock.mockImplementation((_bin, args: string[], _opts, cb) => {
      if (args[1] === 'create') {
        writeFullDashboardJob(hermesHome, 'created-full-dashboard')
      }
      if (args[1] === 'run') {
        writeRunOutput(hermesHome, 'created-full-dashboard', '2026-06-02T19-00-00.000000+00-00.md', {
          dashboard_updates: {
            marketClaims: [{
              label: 'Official low-risk textile reference',
              value: 'Official source located',
              sourceTitle: 'Official textile reference',
              sourceUrl: 'https://example.gov.cn/textile',
              sourceTier: 'Tier 1 - Official / regulator / trade source',
              confidence: 'high',
              evidenceStatus: 'Official Data',
              dataType: 'company_data',
            }],
            financialEvidence: [{
              field: 'NPV @ 12%',
              value: '$49.8M',
              sourceTitle: 'Screenshot placeholder',
              sourceTier: 'candidate-source',
              confidence: 'low',
              evidenceStatus: 'Derived from Assumptions',
              dataType: 'financial_data',
            }],
          },
        })
      }
      cb(null, '', '')
    })

    const result = await ensureFullDashboardAutopilotScheduled('default', { startFirstRun: true })
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      jobId: 'created-full-dashboard',
      created: true,
      recordedResearchJob: true,
      firstRunStarted: true,
      firstRunError: '',
    })
    expect(execFileMock.mock.calls.map(call => call[1][1])).toEqual(['create', 'run'])
    expect(envelope?.state.marketClaims).toEqual([
      expect.objectContaining({ label: 'Official low-risk textile reference' }),
    ])
    expect(envelope?.state.researchFindings).toEqual([
      expect.objectContaining({
        keyClaim: expect.stringContaining('NPV @ 12%'),
        status: 'Pending Review',
      }),
    ])
  })
})
