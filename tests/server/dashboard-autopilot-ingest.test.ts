import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
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
  FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
  FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION,
  FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
  dashboardSourceTierRank,
  ensureFullDashboardAutopilotScheduled,
  extractDashboardResearchUpdates,
  ingestFullDashboardAutopilotOutputs,
  readFullDashboardAutopilotImportStatus,
  runDueFullDashboardAutopilot,
} from '../../packages/server/src/services/hermes/dashboard-autopilot-ingest'
import { readDashboardIntelligenceState } from '../../packages/server/src/services/hermes/intelligence-state'

function writeFullDashboardJob(
  home: string,
  jobId = 'job-full-dashboard',
  options: { prompt?: string; scheduleDisplay?: string } = {},
) {
  const cronDir = join(home, 'cron')
  mkdirSync(cronDir, { recursive: true })
  writeFileSync(join(cronDir, 'jobs.json'), JSON.stringify({
    jobs: [{
      id: jobId,
      job_id: jobId,
      name: 'Full Dashboard Trusted Source Autopilot',
      prompt: options.prompt || [
        'Full Dashboard Trusted Source Autopilot',
        `Prompt version: ${FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION}`,
        'Research online trusted sources and return dashboard_updates for the full dashboard.',
      ].join('\n'),
      schedule_display: options.scheduleDisplay || FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    }],
  }, null, 2))
}

function writeMissingCoverageJob(home: string, jobId: string, prompt: string) {
  const cronDir = join(home, 'cron')
  mkdirSync(cronDir, { recursive: true })
  const jobsFile = join(cronDir, 'jobs.json')
  const current = JSON.parse(readFileSync(jobsFile, 'utf-8'))
  current.jobs = [
    ...(Array.isArray(current.jobs) ? current.jobs : []),
    {
      id: jobId,
      job_id: jobId,
      name: FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
      prompt,
      schedule_display: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      repeat: { times: 1, completed: 0 },
    },
  ]
  writeFileSync(jobsFile, JSON.stringify(current, null, 2))
}

function writeRunOutput(home: string, jobId: string, fileName: string, payload: unknown, mtime?: Date) {
  const outputDir = join(home, 'cron', 'output', jobId)
  mkdirSync(outputDir, { recursive: true })
  const filePath = join(outputDir, fileName)
  writeFileSync(filePath, [
    '# Full Dashboard Trusted Source Autopilot',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
  ].join('\n'))
  if (mtime) utimesSync(filePath, mtime, mtime)
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

  it('extracts conservative dashboard updates from source-backed markdown tables when JSON is missing', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Market Intelligence',
      '| Metric | Value | Source Title | Source URL | Source Tier | Confidence | Evidence Status | Data Type | Review Required |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| Country-wise consumption growth - China | Trade proxy signal found | WITS / World Bank Comtrade | https://wits.worldbank.org/ | Tier 1 - Official / regulator / trade source | high | Official Data | trade_data | yes |',
      '',
      '## Supplier Scorecards',
      '| Supplier | Material | Price | Source Title | Source Date | Evidence Status | Confidence | Review Required |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| Wilmar | Stearic Acid TP | To Verify | Uploaded supplier quote index | 2026-06-03 | To Verify | medium | yes |',
    ].join('\n'))

    expect(payload?.marketClaims).toEqual([
      expect.objectContaining({
        field: 'Country-wise consumption growth - China',
        value: 'Trade proxy signal found',
        sourceTitle: 'WITS / World Bank Comtrade',
        sourceUrl: 'https://wits.worldbank.org/',
        reviewRequired: true,
      }),
    ])
    expect(payload?.supplierScorecards).toEqual([
      expect.objectContaining({
        supplier: 'Wilmar',
        material: 'Stearic Acid TP',
        value: 'To Verify',
        sourceTitle: 'Uploaded supplier quote index',
      }),
    ])
  })

  it('resolves markdown table citation markers to source-backed dashboard updates', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Market Intelligence',
      '| Field | Value | Source | Source Tier | Evidence Status | Confidence | Review Required |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| Country-wise consumption growth - China | Trade proxy signal found | [1] | Tier 1 - Official / regulator / trade source | Official Data | high | yes |',
      '',
      '## Competitor Intelligence',
      '| Company | Product Equivalent | Market Share | Link | Source Tier | Evidence Status | Confidence | Review Required |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| Evonik Industries | VARISOFT official esterquat product family | To Verify | [2] | Tier 2 - Official company / product source | To Verify | medium | yes |',
      '',
      '## Sources',
      '- [1] [WITS / World Bank Comtrade](https://wits.worldbank.org/) accessed 2026-06-03',
      '2. Evonik official product page — https://www.evonik.com/',
    ].join('\n'))

    expect(payload?.marketClaims).toEqual([
      expect.objectContaining({
        field: 'Country-wise consumption growth - China',
        value: 'Trade proxy signal found',
        sourceTitle: 'WITS / World Bank Comtrade',
        sourceUrl: 'https://wits.worldbank.org/',
        sourceDate: 'accessed 2026-06-03',
        reviewRequired: true,
      }),
    ])
    expect(payload?.competitorRecords).toEqual([
      expect.objectContaining({
        companyName: 'Evonik Industries',
        productEquivalent: 'VARISOFT official esterquat product family',
        sourceTitle: 'Evonik official product page',
        sourceUrl: 'https://www.evonik.com/',
      }),
    ])
  })

  it('accepts reference-labeled markdown table sources from real research output', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Market Intelligence',
      '| Claim | Value | References | Source Type | Verification Status | Confidence Level | Needs Review |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| Market Size / Scope | To Verify | [1] | Tier 1 - Official / regulator / trade source | Official Data | high | yes |',
      '',
      '## Sources',
      '1. Official customs statistics — https://example.gov/customs accessed 2026-06-03',
    ].join('\n'))

    expect(payload?.marketClaims).toEqual([
      expect.objectContaining({
        field: 'Market Size / Scope',
        value: 'To Verify',
        sourceTitle: 'Official customs statistics',
        sourceUrl: 'https://example.gov/customs',
        sourceDate: 'accessed 2026-06-03',
        sourceTier: 'Tier 1 - Official / regulator / trade source',
        evidenceStatus: 'Official Data',
        confidence: 'high',
        reviewRequired: true,
      }),
    ])
  })

  it('accepts evidence-link supplier tables with source class and claim status labels', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Supplier Scorecards',
      '| Supplier | Material | Price | Evidence Link | Source Class | Claim Status | Source Confidence | Review Reason |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| Wilmar | Stearic Acid TP | To Verify | [1] | Tier 3 - Uploaded supplier evidence | To Verify | medium | Awaiting uploaded quote approval |',
      '',
      '## Sources',
      '- [1] Uploaded supplier quote index - file://supplier-quotes/wilmar-stearic-acid.md',
    ].join('\n'))

    expect(payload?.supplierScorecards).toEqual([
      expect.objectContaining({
        supplier: 'Wilmar',
        material: 'Stearic Acid TP',
        value: 'To Verify',
        sourceTitle: 'Uploaded supplier quote index',
        sourceUrl: 'file://supplier-quotes/wilmar-stearic-acid.md',
        sourceTier: 'Tier 3 - Uploaded supplier evidence',
        evidenceStatus: 'To Verify',
        confidence: 'medium',
        riskReason: 'Awaiting uploaded quote approval',
      }),
    ])
  })

  it('ignores decorative markdown tables that lack source metadata', () => {
    const payload = extractDashboardResearchUpdates([
      '| KPI | Value |',
      '| --- | --- |',
      '| Market Size | $3.2B |',
    ].join('\n'))

    expect(payload).toBeNull()
  })

  it('extracts source-backed delimited bullets when Hermes omits JSON and tables', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Competitor Intelligence',
      '- Company: Evonik Industries | Product Equivalent: VARISOFT official esterquat product family | Market Share: To Verify | Source: [Evonik official product page](https://www.evonik.com/) | Source Tier: Tier 2 - Official company / product source | Evidence Status: To Verify | Confidence: medium | Review Required: yes',
      '',
      '## Market Intelligence',
      '1. Field: Country-wise consumption growth - Bangladesh | Value: Trade proxy signal found | Source Title: WITS / World Bank Comtrade | Source URL: https://wits.worldbank.org/ | Source Tier: Tier 1 - Official / regulator / trade source | Evidence Status: Official Data | Confidence: high | Data Type: trade_data | Review Required: yes',
    ].join('\n'))

    expect(payload?.competitorRecords).toEqual([
      expect.objectContaining({
        companyName: 'Evonik Industries',
        productEquivalent: 'VARISOFT official esterquat product family',
        marketShare: 'To Verify',
        sourceTitle: 'Evonik official product page',
        sourceUrl: 'https://www.evonik.com/',
        reviewRequired: true,
      }),
    ])
    expect(payload?.marketClaims).toEqual([
      expect.objectContaining({
        field: 'Country-wise consumption growth - Bangladesh',
        value: 'Trade proxy signal found',
        sourceTitle: 'WITS / World Bank Comtrade',
        sourceUrl: 'https://wits.worldbank.org/',
      }),
    ])
  })

  it('accepts delimited bullets that use reference labels instead of source labels', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Market Intelligence',
      '- Field: Country-wise consumption growth - India | Value: Trade proxy signal found | Reference: [1] | Source Type: Tier 1 - Official / regulator / trade source | Claim Status: Official Data | Confidence Level: high | Needs Review: yes',
      '',
      '## Sources',
      '[1] WITS / World Bank Comtrade - https://wits.worldbank.org/ accessed 2026-06-03',
    ].join('\n'))

    expect(payload?.marketClaims).toEqual([
      expect.objectContaining({
        field: 'Country-wise consumption growth - India',
        value: 'Trade proxy signal found',
        sourceTitle: 'WITS / World Bank Comtrade',
        sourceUrl: 'https://wits.worldbank.org/',
        sourceDate: 'accessed 2026-06-03',
        sourceTier: 'Tier 1 - Official / regulator / trade source',
        evidenceStatus: 'Official Data',
        confidence: 'high',
        reviewRequired: true,
      }),
    ])
  })

  it('resolves delimited bullet citation markers before deciding whether output is sourced', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Supplier Scorecards',
      '- Supplier: Wilmar | Material: Stearic Acid TP | Price: To Verify | Source: [1] | Source Tier: Tier 3 - Uploaded supplier evidence | Evidence Status: To Verify | Confidence: medium | Review Required: yes',
      '',
      '## Sources',
      '[1] Uploaded Wilmar supplier quote index - file://supplier-quotes/wilmar-stearic-acid.md',
    ].join('\n'))

    expect(payload?.supplierScorecards).toEqual([
      expect.objectContaining({
        supplier: 'Wilmar',
        material: 'Stearic Acid TP',
        value: 'To Verify',
        sourceTitle: 'Uploaded Wilmar supplier quote index',
        sourceUrl: 'file://supplier-quotes/wilmar-stearic-acid.md',
        sourceDate: '',
        reviewRequired: true,
      }),
    ])
  })

  it('ignores delimited bullets that do not include explicit source metadata', () => {
    const payload = extractDashboardResearchUpdates([
      '- Field: Market Size / Scope | Value: $3.2B',
      '- Company: Example Competitor | Market Share: 12%',
    ].join('\n'))

    expect(payload).toBeNull()
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
            sourceUrl: 'https://example.com/wilmar-stearic-acid-quote',
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
    expect(envelope?.state.dataRoomSources).toEqual([
      expect.objectContaining({
        checklistLabel: 'Supplier scorecard - Wilmar',
        dashboardGroup: 'supplierScorecards',
        supplier: 'Wilmar',
        material: 'Stearic Acid TP',
        proposedValue: '$1,180/t',
        sourceTier: 'tier3-supplier-evidence',
        dataType: 'supplier_quote',
        evidenceStatus: 'To Verify',
        source: expect.objectContaining({
          title: 'Supplier quote needed',
          url: 'https://example.com/wilmar-stearic-acid-quote',
        }),
      }),
    ])

    const rawState = readFileSync(join(hermesHome, 'dashboard-intelligence', 'state.json'), 'utf-8')
    expect(rawState).not.toContain('"financialModels":[{"scenarioName"')
    expect(rawState).not.toContain('"marketShare":"12%"')
  })

  it('automatically starts a duplicate-safe missing coverage follow-up after partial imported intelligence', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    await ensureFullDashboardAutopilotScheduled('default')
    execFileMock.mockReset()
    execFileMock.mockImplementation((_bin, args: string[], _opts, cb) => {
      if (args[1] === 'create') {
        writeMissingCoverageJob(hermesHome, 'job-missing-coverage-1', String(args[args.length - 1] || ''))
      }
      cb(null, '', '')
    })
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-03T07-00-00.md', {
      dashboard_updates: {
        marketClaims: [{
          label: 'Country-wise consumption growth - China',
          value: 'Trade proxy signal found',
          sourceTitle: 'WITS / World Bank Comtrade',
          sourceUrl: 'https://wits.worldbank.org/',
          sourceTier: 'Tier 1 - Official / regulator / trade source',
          confidence: 'high',
          evidenceStatus: 'Official Data',
          dataType: 'trade_data',
          reviewRequired: false,
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 0,
      stagedReviewCount: 1,
      missingCoverageFollowUpStarted: true,
    })
    const createArgs = execFileMock.mock.calls.find(call => (call[1] as string[])[1] === 'create')?.[1] as string[]
    expect(createArgs).toEqual(expect.arrayContaining([
      'cron',
      'create',
      '--name',
      FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
      '--deliver',
      'local',
      '--repeat',
      '1',
      FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    ]))
    const prompt = createArgs[createArgs.length - 1]
    expect(prompt).toContain('Do the online research yourself')
    expect(prompt).toContain('Bangladesh')
    expect(prompt).toContain('Stepan Company')
    expect(prompt).toContain('Dimethyl sulfate / DMS')
    expect(prompt).toContain('dashboard_updates JSON')
    expect(execFileMock.mock.calls.some(call => (call[1] as string[]).join(' ') === 'cron run job-missing-coverage-1')).toBe(true)

    const envelope = await readDashboardIntelligenceState('default')
    expect(envelope?.state.researchJobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
        status: 'Scheduled Hermes Job',
        scheduledJobId: 'job-missing-coverage-1',
        scope: expect.stringContaining('Bangladesh'),
        sourceRequirements: expect.stringContaining('Missing coverage signature:'),
      }),
      expect.objectContaining({
        title: 'Full Dashboard Trusted Source Autopilot',
        scheduledJobId: 'job-full-dashboard',
      }),
    ]))

    execFileMock.mockClear()
    const second = await ingestFullDashboardAutopilotOutputs('default')
    expect(second).toMatchObject({
      importedRuns: 0,
      missingCoverageFollowUpStarted: false,
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('infers trusted official source tier from allowlisted domains without manual tier labels', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-03T09-00-00.000000+00-00.md', {
      dashboard_updates: {
        marketClaims: [{
          field: 'Official textile sector reference',
          label: 'Official textile sector reference',
          value: 'Official statistical source identified',
          sourceTitle: 'National Bureau of Statistics reference',
          sourceUrl: 'https://stats.gov.cn/english/statisticaldata/',
          confidence: 'high',
          evidenceStatus: 'Official Data',
          dataType: 'company_data',
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 1,
      stagedReviewCount: 0,
    })
    expect(envelope?.state.marketClaims).toEqual([
      expect.objectContaining({
        label: 'Official textile sector reference',
        value: 'Official statistical source identified',
        evidenceStatus: 'Official Data',
      }),
    ])
    expect(envelope?.state.researchFindings).toEqual([])
  })

  it('downgrades claimed official tiers when the URL is a weak public listing', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-03T10-00-00.000000+00-00.md', {
      dashboard_updates: {
        marketClaims: [{
          field: 'Official textile sector reference',
          label: 'Official textile sector reference',
          value: 'Supplier listing found',
          sourceTitle: 'Marketplace supplier listing',
          sourceUrl: 'https://www.alibaba.com/product-detail/esterquat-listing',
          sourceTier: 'Tier 1 - Official / regulator / trade source',
          confidence: 'high',
          evidenceStatus: 'Official Data',
          dataType: 'company_data',
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 0,
      stagedReviewCount: 1,
    })
    expect(envelope?.state.marketClaims).toEqual([])
    expect(envelope?.state.researchFindings).toEqual([
      expect.objectContaining({
        status: 'Pending Review',
        riskNote: expect.stringContaining('source URL/domain policy downgraded the claimed source tier'),
        dashboardTarget: expect.objectContaining({
          group: 'marketClaims',
          sourceTier: 'tier5-public-listing',
        }),
      }),
    ])
  })

  it('treats unknown HTTP domains as candidate sources even when Hermes claims Tier 1', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-03T10-30-00.000000+00-00.md', {
      dashboard_updates: {
        marketClaims: [{
          field: 'Official textile sector reference',
          label: 'Official textile sector reference',
          value: 'Unregistered source found',
          sourceTitle: 'Unknown industry blog',
          sourceUrl: 'https://industry-blog.example/market-note',
          sourceTier: 'Tier 1 - Official / regulator / trade source',
          confidence: 'high',
          evidenceStatus: 'Official Data',
          dataType: 'company_data',
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 0,
      stagedReviewCount: 1,
    })
    expect(envelope?.state.marketClaims).toEqual([])
    expect(envelope?.state.researchFindings).toEqual([
      expect.objectContaining({
        status: 'Pending Review',
        riskNote: expect.stringContaining('candidate source is not trusted yet'),
        dashboardTarget: expect.objectContaining({
          group: 'marketClaims',
          sourceTier: 'candidate-source',
        }),
      }),
    ])
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

  it('auto-stages trusted financial evidence into data room without creating a financial model', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-02T08-45-00.000000+00-00.md', {
      dashboard_updates: {
        financialEvidence: [{
          field: 'Process equipment quote benchmark',
          value: 'Vendor quote evidence found for reactor and mixer package; amount requires owner review before model use',
          sourceTitle: 'Uploaded vendor quote evidence',
          sourceUrl: 'file://documents/vendor-quote-evidence.pdf',
          sourceTier: 'Tier 3 - Uploaded supplier evidence',
          confidence: 'medium',
          evidenceStatus: 'To Verify',
          dataType: 'financial_data',
          riskReason: 'Financial model input requires owner review and must stay out of investor material until approved.',
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 0,
      stagedReviewCount: 1,
    })
    expect(envelope?.state.financialModels).toEqual([])
    expect(envelope?.state.dataRoomSources).toEqual([
      expect.objectContaining({
        checklistLabel: 'Process equipment quote benchmark',
        area: 'financial',
        dashboardGroup: 'financialEvidence',
        proposedValue: 'Vendor quote evidence found for reactor and mixer package; amount requires owner review before model use',
        sourceTier: 'tier3-supplier-evidence',
        dataType: 'financial_data',
        evidenceStatus: 'To Verify',
        source: expect.objectContaining({
          title: 'Uploaded vendor quote evidence',
          url: 'file://documents/vendor-quote-evidence.pdf',
        }),
      }),
    ])
    expect(envelope?.state.researchFindings).toEqual([
      expect.objectContaining({
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'financialEvidence',
          screen: 'investment',
          sourceTier: 'tier3-supplier-evidence',
          dataType: 'financial_data',
        }),
      }),
    ])
  })

  it('imports markdown-only trusted-source tables and keeps critical values review-gated', async () => {
    writeFullDashboardJob(hermesHome)
    const outputDir = join(hermesHome, 'cron', 'output', 'job-full-dashboard')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, '2026-06-03T08-00-00.000000+00-00.md'), [
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Market Intelligence',
      '| Metric | Value | Source Title | Source URL | Source Tier | Confidence | Evidence Status | Data Type |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| Country-wise consumption growth - China | Official trade proxy located | WITS / World Bank Comtrade | https://wits.worldbank.org/ | Tier 1 - Official / regulator / trade source | high | Official Data | trade_data |',
    ].join('\n'))

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 0,
      stagedReviewCount: 1,
    })
    expect(envelope?.state.researchFindings).toEqual([
      expect.objectContaining({
        keyClaim: expect.stringContaining('Country-wise consumption growth - China'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'marketClaims',
          screen: 'market',
          sourceTier: 'tier1-official',
          value: 'Official trade proxy located',
        }),
      }),
    ])
  })

  it('deduplicates imported run files with an import registry', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-02T09-00-00.000000+00-00.md', {
      dashboard_updates: {
        marketClaims: [{
          label: 'Official low-risk company fact',
          value: 'Official catalog page found',
          sourceTitle: 'Official company catalog',
          sourceUrl: 'https://evonik.com/catalog',
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

  it('tracks skipped non-parseable outputs without marking them imported or reprocessing them', async () => {
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
    expect(second).toMatchObject({ skippedRuns: 0, importedRuns: 0 })
    const parsedRegistry = JSON.parse(registry)
    expect(parsedRegistry.importedRunKeys).not.toContain('job-full-dashboard/2026-06-02T10-00-00.000000+00-00.md')
    expect(parsedRegistry.skippedRunKeys).toContain('job-full-dashboard/2026-06-02T10-00-00.000000+00-00.md')

    const status = await readFullDashboardAutopilotImportStatus('default')
    expect(status).toMatchObject({
      importedRunCount: 0,
      skippedRunCount: 1,
      pendingOutputCount: 0,
      latestOutputSkipped: true,
      latestOutputParseStatus: 'unparseable',
    })
  })

  it('reports whether the latest output is ready to import or unparseable without exposing content', async () => {
    writeFullDashboardJob(hermesHome)
    const outputDir = join(hermesHome, 'cron', 'output', 'job-full-dashboard')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, '2026-06-02T11-00-00.000000+00-00.md'), 'Plain prose without source-backed dashboard updates.')

    const unparseable = await readFullDashboardAutopilotImportStatus('default')
    expect(unparseable).toMatchObject({
      skippedRunCount: 0,
      latestOutputSkipped: false,
      latestOutputParseStatus: 'unparseable',
      latestOutputCandidateCount: 0,
      latestOutputParseError: '',
    })
    expect(JSON.stringify(unparseable)).not.toContain('Plain prose')

    writeFileSync(join(outputDir, '2026-06-02T12-00-00.000000+00-00.md'), [
      '## Market Intelligence',
      '- Field: Country-wise consumption growth - China | Value: Trade proxy signal found | Source: [WITS / World Bank Comtrade](https://wits.worldbank.org/) | Source Tier: Tier 1 - Official / regulator / trade source | Evidence Status: Official Data | Confidence: high | Review Required: yes',
    ].join('\n'))

    const ready = await readFullDashboardAutopilotImportStatus('default')
    expect(ready).toMatchObject({
      latestOutputParseStatus: 'ready',
      latestOutputCandidateCount: 1,
      latestOutputParseError: '',
    })
    expect(JSON.stringify(ready)).not.toContain('Trade proxy signal found')
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
    expect(prompt).toContain(FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION)
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
    expect(prompt).toContain('Required coverage checklist')
    expect(prompt).toContain('Do not omit a group silently')
    expect(prompt).toContain('China, Bangladesh, India, Vietnam, Pakistan, Turkey, Indonesia')
    expect(prompt).toContain('Evonik Industries, Stepan Company, Kao Corporation, WACKER')
    expect(prompt).toContain('triethanolamine / TEA, dimethyl sulfate / DMS')
    expect(prompt).toContain('Lean/Base/Conservative/Aggressive scenarios')
    expect(prompt).toContain('proposedDashboardField')
    expect(prompt).toContain('dashboard_updates')
    expect(prompt).toContain('source-backed Markdown tables')
    expect(prompt).toContain('source-backed delimited bullets')
    expect(prompt).toContain('unstructured or unsourced output will be ignored')
    expect(prompt).toContain('Do not invent market size')
  })

  it('sets a configured profile model before starting a newly created full dashboard run', async () => {
    writeFileSync(join(hermesHome, 'config.yaml'), [
      'terminal:',
      '  backend: local',
      'custom_providers:',
      '  - name: Corp Proxy',
      '    base_url: https://proxy.example.com/v1',
      '    model: research-model',
      '',
    ].join('\n'))
    execFileMock.mockImplementation((_bin, args: string[], _opts, cb) => {
      if (args[1] === 'create') writeFullDashboardJob(hermesHome, 'created-full-dashboard')
      if (args[1] === 'run') {
        const config = readFileSync(join(hermesHome, 'config.yaml'), 'utf-8')
        expect(config).toContain('default: research-model')
        expect(config).toContain('provider: custom:corp-proxy')
        expect(config).toContain('backend: local')
      }
      cb(null, '', '')
    })

    const result = await ensureFullDashboardAutopilotScheduled('default', { startFirstRun: true })

    expect(result).toMatchObject({
      jobId: 'created-full-dashboard',
      created: true,
      recordedResearchJob: true,
      firstRunStarted: true,
      firstRunError: '',
    })
    expect(execFileMock.mock.calls.map(call => call[1][1]).slice(0, 2)).toEqual(['create', 'run'])
    expect(execFileMock.mock.calls.map(call => call[1][1])).toContain('create')
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

  it('repairs an existing stale full dashboard schedule without creating a duplicate', async () => {
    writeFullDashboardJob(hermesHome, 'existing-stale-dashboard', {
      prompt: 'Research online trusted sources and return dashboard_updates for the full dashboard.',
      scheduleDisplay: '0 8,20 * * *',
    })
    execFileMock.mockImplementation((_bin, args: string[], _opts, cb) => {
      if (args[1] === 'edit') {
        expect(args).toEqual(expect.arrayContaining([
          'cron',
          'edit',
          'existing-stale-dashboard',
          '--name',
          'Full Dashboard Trusted Source Autopilot',
          '--schedule',
          FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
          '--deliver',
          'local',
          '--prompt',
        ]))
        expect(args[args.length - 1]).toContain(FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION)
      }
      cb(null, '', '')
    })

    const result = await ensureFullDashboardAutopilotScheduled('default', { startFirstRun: true })

    expect(result).toMatchObject({
      jobId: 'existing-stale-dashboard',
      created: false,
      repaired: true,
      recordedResearchJob: true,
      firstRunStarted: true,
    })
    expect(execFileMock.mock.calls.map(call => call[1][1])).toEqual(['edit', 'run'])
  })

  it('sets an env-backed provider default before an unattended due full dashboard run', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    writeFileSync(join(hermesHome, 'config.yaml'), 'terminal:\n  backend: local\n')
    writeFileSync(join(hermesHome, '.env'), 'DEEPSEEK_API_KEY=test-key\n')
    const now = new Date()
    now.setHours(20, 20, 0, 0)
    execFileMock.mockImplementation((_bin, args: string[], _opts, cb) => {
      expect(args[1]).toBe('run')
      const config = readFileSync(join(hermesHome, 'config.yaml'), 'utf-8')
      expect(config).toContain('default: deepseek-v4-pro')
      expect(config).toContain('provider: deepseek')
      expect(config).toContain('backend: local')
      cb(null, '', '')
    })

    const result = await runDueFullDashboardAutopilot('default', { now })

    expect(result).toMatchObject({
      jobId: 'job-full-dashboard',
      runStarted: true,
      runError: '',
    })
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('runs the due twice-daily full dashboard job when the latest slot has no output', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    const now = new Date()
    now.setHours(20, 20, 0, 0)
    execFileMock.mockImplementation((_bin, args: string[], _opts, cb) => {
      if (args[1] === 'run') {
        writeRunOutput(hermesHome, 'job-full-dashboard', 'due-run-output.md', {
          dashboard_updates: {
            marketClaims: [{
              label: 'Official due-run market source',
              value: 'Official source located',
              sourceTitle: 'Official due-run source',
              sourceUrl: 'https://example.gov/due-run',
              sourceTier: 'Tier 1 - Official / regulator / trade source',
              confidence: 'high',
              evidenceStatus: 'Official Data',
              dataType: 'company_data',
            }],
          },
        }, now)
      }
      cb(null, '', '')
    })

    const result = await runDueFullDashboardAutopilot('default', { now, graceMs: 0 })
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      jobId: 'job-full-dashboard',
      outputAlreadyPresent: false,
      skippedRecentAttempt: false,
      runStarted: true,
      runError: '',
      importedRuns: 1,
      autoFilledCount: 1,
    })
    expect(execFileMock.mock.calls[0][1]).toEqual(['cron', 'run', 'job-full-dashboard'])
    expect(envelope?.state.marketClaims).toEqual([
      expect.objectContaining({ label: 'Official due-run market source' }),
    ])
    const dueRegistry = readFileSync(join(hermesHome, 'dashboard-intelligence', 'autopilot-due-runs.json'), 'utf-8')
    expect(dueRegistry).toContain('job-full-dashboard')
    expect(dueRegistry).toContain('"outputSeen": true')
  })

  it('does not run the due full dashboard job when a readable output already satisfies the slot', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    const now = new Date()
    now.setHours(20, 20, 0, 0)
    const outputTime = new Date(now)
    outputTime.setHours(19, 5, 0, 0)
    writeRunOutput(hermesHome, 'job-full-dashboard', 'already-ran.md', {
      dashboard_updates: {
        marketClaims: [{ label: 'Already present', value: 'Already present' }],
      },
    }, outputTime)

    const result = await runDueFullDashboardAutopilot('default', { now, graceMs: 0 })

    expect(result).toMatchObject({
      jobId: 'job-full-dashboard',
      outputAlreadyPresent: true,
      skippedRecentAttempt: false,
      runStarted: false,
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('retries a due slot after the existing output was skipped as unparseable', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    const now = new Date()
    now.setHours(20, 20, 0, 0)
    const outputTime = new Date(now)
    outputTime.setHours(19, 5, 0, 0)
    const outputDir = join(hermesHome, 'cron', 'output', 'job-full-dashboard')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, 'unparseable-due-output.md'), 'Plain prose without source-backed dashboard updates.')
    utimesSync(join(outputDir, 'unparseable-due-output.md'), outputTime, outputTime)

    const skipped = await ingestFullDashboardAutopilotOutputs('default')
    expect(skipped).toMatchObject({ skippedRuns: 1, importedRuns: 0 })

    execFileMock.mockImplementation((_bin, args: string[], _opts, cb) => {
      if (args[1] === 'run') {
        writeRunOutput(hermesHome, 'job-full-dashboard', 'retry-structured-output.md', {
          dashboard_updates: {
            marketClaims: [{
              label: 'Retry official market source',
              value: 'Official source located after retry',
              sourceTitle: 'Retry official source',
              sourceUrl: 'https://example.gov/retry',
              sourceTier: 'Tier 1 - Official / regulator / trade source',
              confidence: 'high',
              evidenceStatus: 'Official Data',
              dataType: 'company_data',
            }],
          },
        }, now)
      }
      cb(null, '', '')
    })

    const result = await runDueFullDashboardAutopilot('default', { now, graceMs: 0 })
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      outputAlreadyPresent: false,
      skippedRecentAttempt: false,
      runStarted: true,
      importedRuns: 1,
      autoFilledCount: 1,
    })
    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(envelope?.state.marketClaims).toEqual([
      expect.objectContaining({ label: 'Retry official market source' }),
    ])
    const dueRegistry = readFileSync(join(hermesHome, 'dashboard-intelligence', 'autopilot-due-runs.json'), 'utf-8')
    expect(dueRegistry).toContain('"outputSeen": true')
  })

  it('does not hammer Hermes when a due full dashboard run recently produced no output', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    const now = new Date()
    now.setHours(20, 20, 0, 0)
    execFileMock.mockImplementation((_bin, _args: string[], _opts, cb) => cb(null, '', ''))

    const first = await runDueFullDashboardAutopilot('default', { now, graceMs: 0, retryAfterMs: 60 * 60_000 })
    const second = await runDueFullDashboardAutopilot('default', {
      now: new Date(now.getTime() + 10 * 60_000),
      graceMs: 0,
      retryAfterMs: 60 * 60_000,
    })

    expect(first).toMatchObject({
      runStarted: true,
      outputAlreadyPresent: false,
      importedRuns: 0,
    })
    expect(second).toMatchObject({
      runStarted: false,
      skippedRecentAttempt: true,
      importedRuns: 0,
    })
    expect(execFileMock).toHaveBeenCalledTimes(1)
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
    expect(execFileMock.mock.calls.map(call => call[1][1]).slice(0, 2)).toEqual(['create', 'run'])
    expect(execFileMock.mock.calls.map(call => call[1][1])).toContain('create')
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
