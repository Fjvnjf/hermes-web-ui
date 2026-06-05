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
  comtradeImportPayloadToMarketClaimUpdate,
  extractDashboardResearchUpdates,
  ingestFullDashboardAutopilotOutputs,
  officialCompanyPageToCompetitorFinancialUpdate,
  officialCompetitorProductPageToUpdate,
  readFullDashboardAutopilotImportStatus,
  runDueFullDashboardAutopilot,
  secCompanyfactsToCompetitorFinancialUpdate,
} from '../../packages/server/src/services/hermes/dashboard-autopilot-ingest'
import { readDashboardIntelligenceState } from '../../packages/server/src/services/hermes/intelligence-state'

function companyfactsPayload(entityName: string, concept: string, rows: Array<{ year: number; value: number; filed: string; accession: string }>) {
  return {
    entityName,
    facts: {
      'us-gaap': {
        [concept]: {
          units: {
            USD: rows.map(row => ({
              form: '10-K',
              frame: `CY${row.year}`,
              val: row.value,
              filed: row.filed,
              accn: row.accession,
            })),
          },
        },
      },
    },
  }
}

function comtradePayload(rows: Array<{ year: number; primaryValue: number; netWeightKg: number; isReported?: boolean }>) {
  return {
    data: rows.map(row => ({
      refYear: row.year,
      primaryValue: row.primaryValue,
      netWgt: row.netWeightKg,
      qty: row.netWeightKg,
      isReported: row.isReported ?? false,
      isAggregate: true,
    })),
  }
}

const officialCompanySources = {
  basf: {
    companyName: 'BASF',
    fieldKeySlug: 'basf',
    countryRegion: 'Germany / global',
    sourceTitle: 'BASF Report 2025 - Results of Operations',
    sourceUrl: 'https://report.basf.com/2025/en/combined-managements-report/basf-groups-business-year/results-of-operations.html',
    parser: 'basf-report-2025' as const,
  },
  evonik: {
    companyName: 'Evonik Industries',
    fieldKeySlug: 'evonik_industries',
    countryRegion: 'Germany / global',
    sourceTitle: 'Evonik 2025 results release',
    sourceUrl: 'https://www.evonik.com/en/news/press-releases/2026/03/Q4-reporting-2025.html',
    parser: 'evonik-results-2025' as const,
  },
  wacker: {
    companyName: 'WACKER',
    fieldKeySlug: 'wacker',
    countryRegion: 'Germany / global',
    sourceTitle: 'WACKER Annual Report 2025 - Regions',
    sourceUrl: 'https://reports.wacker.com/2025/annual-report/management-report/segments/regions.html',
    parser: 'wacker-report-2025' as const,
  },
  kao: {
    companyName: 'Kao Corporation',
    fieldKeySlug: 'kao_corporation',
    countryRegion: 'Japan / global',
    sourceTitle: 'Kao at a Glance',
    sourceUrl: 'https://www.kao.com/global/en/corporate/data/',
    parser: 'kao-glance-2025' as const,
  },
}

const officialProductSources = {
  stepan: {
    companyName: 'Stepan Company',
    fieldKeySlug: 'stepan_company',
    countryRegion: 'United States / global',
    productLabel: 'STEPANTEX SP-90',
    productEquivalent: 'STEPANTEX SP-90 esterquat softener product reference',
    activeContent: 'Dialkylester fabric-softener chemistry; official page source confirms STEPANTEX SP-90 product identity.',
    distributionPresence: 'Official Stepan product page.',
    sourceTitle: 'Stepan STEPANTEX SP-90 official product page',
    sourceUrl: 'https://pt.stepan.com/content/stepan-dot-com/pt_br/products-markets/product/STEPANTEXSP90.html',
    requiredTerms: ['STEPANTEX', 'SP-90'],
  },
  wacker: {
    companyName: 'WACKER',
    fieldKeySlug: 'wacker',
    countryRegion: 'Germany / global',
    productLabel: 'WACKER FINISH WR 1200',
    productEquivalent: 'WACKER FINISH WR 1200 functional silicone fluid for textile finishing context',
    activeContent: 'Reactive aminoethyl-aminopropyl functional polydimethylsiloxane.',
    distributionPresence: 'Official WACKER product page states global production, sales, and distributor network context.',
    sourceTitle: 'WACKER FINISH WR 1200 official product page',
    sourceUrl: 'https://www.wacker.com/h/en-jo/c/wacker-finish-wr-1200/p/000010891',
    requiredTerms: ['FINISH WR 1200', 'polydimethylsiloxane'],
  },
}

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
    vi.unstubAllGlobals()
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

  it('converts SEC companyfacts revenue into source-backed competitor financial metrics', () => {
    const update = secCompanyfactsToCompetitorFinancialUpdate({
      companyName: 'Stepan Company',
      cik: '0000094049',
      fieldKeySlug: 'stepan_company',
      aliases: ['stepan'],
    }, companyfactsPayload('STEPAN COMPANY', 'RevenueFromContractWithCustomerExcludingAssessedTax', [
      { year: 2024, value: 2180274000, filed: '2025-02-27', accession: '0000950170-25-029079' },
      { year: 2025, value: 2332114000, filed: '2026-02-26', accession: '0001193125-26-074976' },
    ]), '2026-06-06')

    expect(update).toEqual(expect.objectContaining({
      companyName: 'Stepan Company',
      fieldKey: 'competitor_metrics.stepan_company.official_financials',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
    }))
    expect(update?.revenue).toEqual(expect.objectContaining({
      value: expect.stringContaining('FY2025 company-wide revenue: US$2.332B'),
      sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000094049.json',
      confidence: 'high',
      reviewRequired: false,
    }))
    expect(update?.yearlyGrowth).toEqual(expect.objectContaining({
      value: expect.stringContaining('+6.96%'),
      evidenceStatus: 'Official Company Evidence',
    }))
  })

  it('converts UN Comtrade imports into review-gated country market proxy claims', () => {
    const update = comtradeImportPayloadToMarketClaimUpdate({
      country: 'China',
      reporterCode: '156',
      fieldKeySlug: 'china',
    }, comtradePayload([
      { year: 2023, primaryValue: 195169270, netWeightKg: 51660671.263 },
      { year: 2024, primaryValue: 236608417, netWeightKg: 65408986.289 },
    ]), '2026-06-06')

    expect(update).toEqual(expect.objectContaining({
      fieldKey: 'market.country_consumption_growth.china.hs_380991',
      label: 'Country-wise consumption growth - China',
      evidenceStatus: 'Trade Proxy',
      reviewRequired: true,
      sourceTitle: 'UN Comtrade API: China HS 380991 imports',
      sourceUrl: 'https://comtradeapi.un.org/public/v1/preview/C/A/HS?cmdCode=380991&flowCode=M&reporterCode=156&period=2023,2024&partnerCode=0&max=100000',
    }))
    expect(update?.value).toContain('FY2024 official HS 380991 import proxy')
    expect(update?.value).toContain('US$236.608M')
    expect(update?.value).toContain('65,409 MT')
    expect(update?.value).toContain('YoY value +21.23%')
    expect(update?.riskReason).toContain('not direct textile-softener consumption')
  })

  it('converts official company financial pages into source-backed competitor metrics', () => {
    const basf = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.basf,
      '<p>In the 2025 business year, sales stood at €59,657 million, compared with €61,444 million in the previous year.</p>',
      '2026-06-06',
    )
    const evonik = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.evonik,
      '<p>Sales in 2025 decreased by 7 percent to €14.1 billion compared to the previous year.</p>',
      '2026-06-06',
    )
    const wacker = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.wacker,
      '<p>WACKER’s operations are highly international. Of the Group’s €5.49 billion in sales in 2025, (2024: €5.72 billion), 83.2 percent came from international business.</p>',
      '2026-06-06',
    )
    const kao = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.kao,
      '<h3>Consolidated net sales</h3><p>1,688.6 billion yen</p><p>FY2025 ended December 31</p>',
      '2026-06-06',
    )

    expect(basf).toEqual(expect.objectContaining({
      companyName: 'BASF',
      fieldKey: 'competitor_metrics.basf.official_financials',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
    }))
    expect(basf?.revenue).toEqual(expect.objectContaining({
      value: expect.stringContaining('FY2025 company-wide sales: €59.657B'),
      sourceUrl: officialCompanySources.basf.sourceUrl,
    }))
    expect(basf?.yearlyGrowth).toEqual(expect.objectContaining({
      value: expect.stringContaining('-2.91%'),
    }))
    expect(evonik?.revenue).toEqual(expect.objectContaining({
      value: 'FY2025 company-wide sales: €14.1B',
      sourceUrl: officialCompanySources.evonik.sourceUrl,
    }))
    expect(evonik?.yearlyGrowth).toEqual(expect.objectContaining({
      value: expect.stringContaining('-7%'),
    }))
    expect(wacker?.revenue).toEqual(expect.objectContaining({
      value: expect.stringContaining('FY2025 company-wide sales: €5.49B'),
      sourceUrl: officialCompanySources.wacker.sourceUrl,
    }))
    expect(kao?.revenue).toEqual(expect.objectContaining({
      value: expect.stringContaining('FY2025 company-wide net sales: ¥1,688.6B'),
      sourceUrl: officialCompanySources.kao.sourceUrl,
    }))
    expect(kao?.yearlyGrowth).toBeUndefined()
  })

  it('converts official competitor product pages into source-backed product context only', () => {
    const stepan = officialCompetitorProductPageToUpdate(
      officialProductSources.stepan,
      '<title>STEPANTEX® SP-90</title><meta name="description" content="STEPANTEX® SP-90"/>',
      '2026-06-06',
    )
    const wacker = officialCompetitorProductPageToUpdate(
      officialProductSources.wacker,
      '<h1>WACKER® FINISH WR 1200</h1><p>Reactive aminoethyl-aminopropyl functional polydimethylsiloxane.</p>',
      '2026-06-06',
    )

    expect(stepan).toEqual(expect.objectContaining({
      companyName: 'Stepan Company',
      fieldKey: 'competitor_products.stepan_company.stepantex-sp-90',
      productEquivalent: expect.stringContaining('STEPANTEX SP-90'),
      activeContent: expect.stringContaining('official page source confirms'),
      evidenceStatus: 'Source-backed',
      sourceUrl: officialProductSources.stepan.sourceUrl,
      reviewRequired: false,
      dataType: 'competitor_data',
    }))
    expect(wacker).toEqual(expect.objectContaining({
      companyName: 'WACKER',
      fieldKey: 'competitor_products.wacker.wacker-finish-wr-1200',
      productEquivalent: expect.stringContaining('WACKER FINISH WR 1200'),
      activeContent: expect.stringContaining('polydimethylsiloxane'),
      sourceUrl: officialProductSources.wacker.sourceUrl,
    }))
    expect(stepan?.pricingEvidence).toBeUndefined()
    expect(stepan?.marketShare).toBeUndefined()
    expect(stepan?.revenue).toBeUndefined()
    expect(stepan?.yearlyGrowth).toBeUndefined()
    expect(stepan?.traffic).toBeUndefined()
    expect(stepan?.rating).toBeUndefined()
  })

  it('rejects official competitor product pages when required product terms are missing', () => {
    expect(officialCompetitorProductPageToUpdate(
      officialProductSources.wacker,
      '<h1>General company page</h1><p>No matching product chemistry here.</p>',
      '2026-06-06',
    )).toBeNull()
  })

  it('extracts flat dashboard_updates arrays and classifies competitor metric candidates', () => {
    const payload = extractDashboardResearchUpdates([
      'Hermes result',
      '```json',
      JSON.stringify({
        dashboard_updates: [
          {
            fieldKey: 'competitor_metrics.stepan_company.traffic',
            value: 'Traffic estimate source identified; numeric traffic not imported pending owner review.',
            sourceTitle: 'SitePrice website-worth traffic/rating estimate page',
            sourceUrl: 'https://www.siteprice.org/website-worth/stepan.com',
            sourceTier: 'Tier 4/5 traffic analytics estimate',
            confidence: 'Low',
            evidenceStatus: 'Reference Only / To Verify',
            reviewRequired: true,
          },
          {
            fieldKey: 'competitor_metrics.dow.market_share',
            companyName: 'Metrics DOW Market',
            value: 'Market-share reference identified; exact textile-softener share not approved.',
            sourceTitle: 'Mordor Intelligence: Surfactants Market Companies',
            sourceUrl: 'https://www.mordorintelligence.com/industry-reports/surfactants-market/companies',
            sourceTier: 'Tier 4 - Market reference',
            confidence: 'Low',
            evidenceStatus: 'Reference Only / To Verify',
            reviewRequired: true,
          },
          {
            fieldKey: 'competitor_metrics.syensqo_solvay.rating',
            companyName: 'Metrics Syensqo Solvay',
            value: 'Rating reference identified; exact product/customer rating not approved.',
            sourceTitle: 'Glassdoor company reviews search: Syensqo',
            sourceUrl: 'https://www.glassdoor.com/Reviews/Syensqo-Reviews-E100000.htm',
            sourceTier: 'Tier 5 - Public listing / review source',
            confidence: 'Low',
            evidenceStatus: 'Reference Only / To Verify',
            reviewRequired: true,
          },
        ],
      }),
      '```',
    ].join('\n'))

    expect(payload?.competitorRecords).toEqual([
      expect.objectContaining({
        companyName: 'Stepan Company',
        field: 'Stepan Company - Traffic',
        traffic: expect.objectContaining({
          value: 'Traffic estimate source identified; numeric traffic not imported pending owner review.',
          sourceTitle: 'SitePrice website-worth traffic/rating estimate page',
        }),
      }),
      expect.objectContaining({
        companyName: 'Dow',
        field: 'Dow - Market share',
        marketShare: expect.objectContaining({
          value: 'Market-share reference identified; exact textile-softener share not approved.',
          sourceTitle: 'Mordor Intelligence: Surfactants Market Companies',
        }),
      }),
      expect.objectContaining({
        companyName: 'Syensqo / Solvay',
        field: 'Syensqo / Solvay - Rating',
        rating: expect.objectContaining({
          value: 'Rating reference identified; exact product/customer rating not approved.',
          sourceTitle: 'Glassdoor company reviews search: Syensqo',
        }),
      }),
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

  it('extracts raw dashboard_updates JSON after the saved cron response heading', () => {
    const payload = extractDashboardResearchUpdates([
      '# Cron Job: Full Dashboard Missing Coverage Follow-up',
      '',
      '## Prompt',
      'Return only structured dashboard_updates JSON compatible with the importer.',
      '',
      '## Response',
      JSON.stringify({
        dashboard_updates: {
          competitorRecords: [{
            companyName: 'Stepan Company',
            productEquivalent: 'Official annual report source identified',
            revenue: {
              value: 'FY2024 company-wide net sales: US$2,180,274,000',
              sourceTitle: 'Stepan Company 2024 Form 10-K',
              sourceUrl: 'https://www.sec.gov/Archives/edgar/data/94049/000095017025029079/scl-20241231.htm',
              confidence: 'high',
              evidenceStatus: 'Official Company Evidence',
              reviewRequired: false,
            },
          }],
        },
      }),
    ].join('\n'))

    expect(payload?.competitorRecords).toEqual([
      expect.objectContaining({
        companyName: 'Stepan Company',
        productEquivalent: 'Official annual report source identified',
        revenue: expect.objectContaining({
          value: 'FY2024 company-wide net sales: US$2,180,274,000',
        }),
      }),
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
      '| Company | Product Equivalent | Market Share | Revenue | Yearly Growth | Link | Source Tier | Evidence Status | Confidence | Review Required |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| Evonik Industries | VARISOFT official esterquat product family | To Verify | FY2024 revenue source-backed | +5% YoY source-backed | [2] | Tier 2 - Official company / product source | To Verify | medium | yes |',
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
        revenue: 'FY2024 revenue source-backed',
        yearlyGrowth: '+5% YoY source-backed',
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
      '- Company: Evonik Industries | Product Equivalent: VARISOFT official esterquat product family | Market Share: To Verify | Revenue: FY2024 revenue source-backed | Yearly Growth: +5% YoY source-backed | Source: [Evonik official product page](https://www.evonik.com/) | Source Tier: Tier 2 - Official company / product source | Evidence Status: To Verify | Confidence: medium | Review Required: yes',
      '',
      '## Market Intelligence',
      '1. Field: Country-wise consumption growth - Bangladesh | Value: Trade proxy signal found | Source Title: WITS / World Bank Comtrade | Source URL: https://wits.worldbank.org/ | Source Tier: Tier 1 - Official / regulator / trade source | Evidence Status: Official Data | Confidence: high | Data Type: trade_data | Review Required: yes',
    ].join('\n'))

    expect(payload?.competitorRecords).toEqual([
      expect.objectContaining({
        companyName: 'Evonik Industries',
        productEquivalent: 'VARISOFT official esterquat product family',
        marketShare: 'To Verify',
        revenue: 'FY2024 revenue source-backed',
        yearlyGrowth: '+5% YoY source-backed',
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
            fieldKey: 'market.officialTextileSectorReference',
            field: 'Official textile sector reference',
            label: 'Official textile sector reference',
            value: 'China textile sector policy page identified',
            sourceTitle: 'Ministry textile policy page',
            sourceUrl: 'https://example.gov.cn/textile-policy',
            sourceTier: 'Tier 1 - Official / regulator / trade source',
            confidence: 'High',
            evidenceStatus: 'Official Data',
            dataType: 'company_data',
          },
          {
            fieldKey: 'market.marketSizeScope',
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
            fieldKey: 'investment.projectIrr',
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
            fieldKey: 'rawMaterial.supplierScorecardWilmar',
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
            fieldKey: 'competitor.transfarMarketShare',
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
        fieldKey: 'market.officialTextileSectorReference',
        dashboardGroup: 'marketClaims',
        proposedDashboardField: 'Official textile sector reference',
        sourceTier: 'tier1-official',
        dataType: 'company_data',
        evidenceStatus: 'Official Data',
        reviewRequired: false,
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
          fieldKey: 'market.marketSizeScope',
          proposedDashboardField: 'Market Size / Scope',
          value: '$3.2B',
          sourceTier: 'tier5-public-listing',
          dataType: 'market_size',
        }),
      }),
      expect.objectContaining({
        keyClaim: expect.stringContaining('Project IRR'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'financialEvidence',
          screen: 'investment',
          fieldKey: 'investment.projectIrr',
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
          fieldKey: 'rawMaterial.supplierScorecardWilmar',
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
          fieldKey: 'competitor.transfarMarketShare',
          companyName: 'Transfar',
          marketShare: '12%',
        }),
      }),
    ]))
    expect(envelope?.state.dataRoomSources).toEqual([
      expect.objectContaining({
        checklistLabel: 'Supplier scorecard - Wilmar',
        fieldKey: 'rawMaterial.supplierScorecardWilmar',
        dashboardGroup: 'supplierScorecards',
        proposedDashboardField: 'Supplier scorecard - Wilmar',
        supplier: 'Wilmar',
        material: 'Stearic Acid TP',
        proposedValue: '$1,180/t',
        sourceTier: 'tier3-supplier-evidence',
        dataType: 'supplier_quote',
        evidenceStatus: 'To Verify',
        reviewRequired: true,
        riskReason: expect.stringContaining('Hermes marked this finding review-required'),
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
        competitorRecords: [{
          fieldKey: 'competitor_metrics.evonik_industries.market_share',
          companyName: 'Metrics Evonik Industries Market',
          value: 'Market-share reference identified; exact textile-softener share not approved.',
          sourceTitle: 'Mordor Intelligence: Surfactants Market Companies',
          sourceUrl: 'https://www.mordorintelligence.com/industry-reports/surfactants-market/companies',
          sourceTier: 'Tier 4 - Market reference',
          confidence: 'low',
          evidenceStatus: 'Reference Only / To Verify',
          reviewRequired: true,
          riskReason: 'Market-reference company list does not state Evonik textile-softener market share by geography/year.',
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 0,
      stagedReviewCount: 2,
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
    expect(prompt).toContain('Competitor Metric Columns')
    expect(prompt).toContain('Evonik Industries - Price evidence')
    expect(prompt).toContain('Evonik Industries - Market share')
    expect(prompt).toContain('Evonik Industries - Revenue')
    expect(prompt).toContain('official annual reports')
    expect(prompt).toContain('Keep companyName clean')
    expect(prompt).toContain('competitor_metrics.dow.market_share')
    expect(prompt).toContain('companyName must be the actual company only')
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

  it('imports source-backed outputs from missing coverage follow-up jobs', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    writeMissingCoverageJob(hermesHome, 'job-missing-coverage-1', [
      'Full Dashboard Missing Coverage Follow-up',
      'Missing coverage signature: missing-coverage-stepan',
      'Return dashboard_updates JSON.',
    ].join('\n'))
    writeRunOutput(hermesHome, 'job-missing-coverage-1', '2026-06-03T08-00-00.md', {
      dashboard_updates: {
        competitorRecords: [{
          fieldKey: 'competitor.stepanOfficialProductPortfolio',
          companyName: 'Stepan Company',
          countryRegion: 'United States',
          value: 'Official product portfolio source identified',
          productEquivalent: 'Official esterquat / fabric softener product reference',
          activeContent: 'Official source identified',
          pricingEvidence: '',
          certifications: 'Official company source identified',
          distributionPresence: 'Global / To Verify',
          marketShare: '',
          sourceTitle: 'Stepan official product reference',
          sourceUrl: 'https://www.stepan.com/',
          sourceTier: 'Tier 2 - Official company / product source',
          confidence: 'high',
          evidenceStatus: 'Source-backed',
          dataType: 'competitor_data',
          reviewRequired: false,
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      jobsChecked: 2,
      importedRuns: 1,
      autoFilledCount: 1,
    })
    expect(envelope?.state.competitors).toEqual([
      expect.objectContaining({
        companyName: 'Stepan Company',
        fieldKey: 'competitor.stepanOfficialProductPortfolio',
        dashboardGroup: 'competitorRecords',
        proposedDashboardField: 'Stepan Company',
        countryRegion: 'United States',
        productEquivalent: 'Official esterquat / fabric softener product reference',
        marketShare: '',
        sourceTier: 'tier2-company-official',
        dataType: 'competitor_data',
        confidence: 'high',
        reviewRequired: false,
        source: expect.objectContaining({
          title: 'Stepan official product reference',
          url: 'https://www.stepan.com/',
        }),
      }),
    ])
    expect(envelope?.state.researchFindings).toEqual([])
  })

  it('imports structured dashboard outputs even when a one-shot follow-up job record was removed', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    writeRunOutput(hermesHome, 'orphan-missing-coverage-job', '2026-06-03T08-30-00.md', {
      dashboard_updates: {
        competitorRecords: [{
          fieldKey: 'competitor.stepan.revenue.officialAnnualReport',
          companyName: 'Stepan Company',
          countryRegion: 'United States',
          value: 'Official annual report source identified for company revenue',
          productEquivalent: 'Esterquat / surfactant portfolio source identified',
          activeContent: 'Official source identified',
          pricingEvidence: '',
          marketShare: '',
          revenue: 'Company revenue available from official annual report',
          yearlyGrowth: '',
          traffic: '',
          rating: '',
          certifications: 'Official company source identified',
          distributionPresence: 'Global / To Verify',
          sourceTitle: 'Stepan official annual report',
          sourceUrl: 'https://www.stepan.com/investors/annual-reports',
          sourceTier: 'Tier 2 - Official company / product source',
          confidence: 'high',
          evidenceStatus: 'Source-backed',
          dataType: 'competitor_data',
          reviewRequired: false,
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')
    const status = await readFullDashboardAutopilotImportStatus('default')

    expect(result).toMatchObject({
      jobsChecked: 2,
      filesChecked: 1,
      importedRuns: 1,
      autoFilledCount: 1,
    })
    expect(envelope?.state.competitors).toEqual([
      expect.objectContaining({
        companyName: 'Stepan Company',
        fieldKey: 'competitor.stepan.revenue.officialAnnualReport',
        dashboardGroup: 'competitorRecords',
        proposedDashboardField: 'Stepan Company',
        revenue: 'Company revenue available from official annual report',
        sourceTier: 'tier2-company-official',
        source: expect.objectContaining({
          title: 'Stepan official annual report',
          url: 'https://www.stepan.com/investors/annual-reports',
        }),
      }),
    ])
    expect(status.outputCount).toBe(1)
    expect(status.importedRunCount).toBe(1)
    expect(status.latestOutputRunKey).toBe('orphan-missing-coverage-job/2026-06-03T08-30-00.md')
  })

  it('hydrates safe nested competitor revenue metrics while keeping weak metric fields review-gated', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-06T00-01-12.000000+00-00.md', {
      dashboard_updates: {
        competitorRecords: [{
          fieldKey: 'Competitor Metric Columns: Stepan Company',
          companyName: 'Stepan Company',
          countryRegion: 'United States',
          productEquivalent: 'Surfactants/fabric-softener ingredient candidate; exact textile-softener product equivalence not verified.',
          pricingEvidence: {
            fieldKey: 'Stepan Company - Price evidence',
            value: 'Official product page/distributor supplier lead found; no public numeric price verified.',
            sourceTitle: 'Stepan BIO-TERGE 804 official product page',
            sourceUrl: 'https://www.stepan.com/content/stepan-dot-com/en/products-markets/product/BIOTERGE804.html',
            sourceTier: 'Tier 2 official company + distributor lead',
            lastChecked: '2026-06-05',
            confidence: 'medium',
            evidenceStatus: 'Reference Only / To Verify',
            reviewRequired: true,
            riskReason: 'Official page validates product presence only; price requires RFQ/quote or distributor invoice.',
          },
          marketShare: {
            fieldKey: 'Stepan Company - Market share',
            value: 'Missing / To Verify',
            sourceTitle: 'No source found that explicitly states textile-softener market, geography, year, and share basis',
            sourceTier: 'Not sourced',
            lastChecked: '2026-06-05',
            confidence: 'low',
            evidenceStatus: 'Missing / To Verify',
            reviewRequired: true,
          },
          revenue: {
            fieldKey: 'Stepan Company - Revenue',
            value: 'FY2024 company-wide net sales: US$2,180,274,000',
            sourceTitle: 'Stepan Company 2024 Form 10-K',
            sourceUrl: 'https://www.sec.gov/Archives/edgar/data/94049/000095017025029079/scl-20241231.htm',
            sourceTier: 'Tier 2 official company/filing',
            lastChecked: '2026-06-05',
            sourceDate: '2025-02-27',
            confidence: 'High',
            evidenceStatus: 'Official Company Evidence',
            reviewRequired: false,
            riskReason: 'Company-wide revenue from contracts; not textile-softener product-line revenue.',
          },
          yearlyGrowth: {
            fieldKey: 'Stepan Company - YoY growth',
            value: 'FY2024 net sales YoY: -6.26% vs FY2023 US$2,325,768,000',
            sourceTitle: 'Stepan Company 2024 Form 10-K',
            sourceUrl: 'https://www.sec.gov/Archives/edgar/data/94049/000095017025029079/scl-20241231.htm',
            sourceTier: 'Tier 2 official company/filing',
            lastChecked: '2026-06-05',
            sourceDate: '2025-02-27',
            confidence: 'high',
            evidenceStatus: 'Official Company Evidence',
            reviewRequired: false,
            riskReason: 'Calculated from SEC-reported company-wide revenue values.',
          },
          traffic: {
            fieldKey: 'Stepan Company - Traffic',
            value: 'Traffic estimate source identified; numeric traffic not imported pending owner review.',
            sourceTitle: 'SitePrice website-worth traffic/rating estimate page',
            sourceUrl: 'https://www.siteprice.org/website-worth/stepan.com',
            sourceTier: 'Tier 4/5 traffic analytics estimate',
            lastChecked: '2026-06-05',
            confidence: 'low',
            evidenceStatus: 'Reference Only / To Verify',
            reviewRequired: true,
          },
          rating: {
            fieldKey: 'Stepan Company - Rating',
            value: 'Missing / To Verify',
            sourceTitle: 'No reliable exact company/product review-rating source found during this run',
            sourceTier: 'Not sourced',
            lastChecked: '2026-06-05',
            confidence: 'low',
            evidenceStatus: 'Missing / To Verify',
            reviewRequired: true,
          },
          sourceTitle: 'Stepan Company 2024 Form 10-K',
          sourceUrl: 'https://www.sec.gov/Archives/edgar/data/94049/000095017025029079/scl-20241231.htm',
          confidence: 'high',
          evidenceStatus: 'Official Company Evidence',
          reviewRequired: true,
          recommendedAction: 'Use revenue/YoY as company-wide context only; keep pricing, market share, traffic, and rating review-gated.',
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 1,
      stagedReviewCount: 1,
    })
    expect(envelope?.state.competitors).toEqual([
      expect.objectContaining({
        companyName: 'Stepan Company',
        revenue: 'FY2024 company-wide net sales: US$2,180,274,000',
        yearlyGrowth: 'FY2024 net sales YoY: -6.26% vs FY2023 US$2,325,768,000',
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
        rating: '',
        evidenceStatus: 'Official Data',
        sourceTier: 'tier1-official',
        confidence: 'high',
        reviewRequired: false,
        source: expect.objectContaining({
          title: 'Stepan Company 2024 Form 10-K',
          url: expect.stringContaining('sec.gov'),
        }),
      }),
    ])
    expect(envelope?.state.researchFindings).toEqual([
      expect.objectContaining({
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          companyName: 'Stepan Company',
        }),
      }),
    ])
  })

  it('hydrates official SEC competitor revenue metrics when no Hermes output file is ready', async () => {
    writeFullDashboardJob(hermesHome)
    const fetchMock = vi.fn(async (url: string) => {
      const payload = url.includes('0000094049')
        ? companyfactsPayload('STEPAN COMPANY', 'RevenueFromContractWithCustomerExcludingAssessedTax', [
          { year: 2024, value: 2180274000, filed: '2025-02-27', accession: '0000950170-25-029079' },
          { year: 2025, value: 2332114000, filed: '2026-02-26', accession: '0001193125-26-074976' },
        ])
        : companyfactsPayload('Dow Inc.', 'Revenues', [
          { year: 2024, value: 42964000000, filed: '2025-02-04', accession: '0001751788-25-000012' },
          { year: 2025, value: 39968000000, filed: '2026-02-03', accession: '0001751788-26-000018' },
        ])
      return {
        ok: true,
        json: async () => payload,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: true,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialTradeConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 2,
      stagedReviewCount: 0,
    })
    expect(envelope?.state.competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'Stepan Company',
        revenue: expect.stringContaining('FY2025 company-wide revenue: US$2.332B'),
        yearlyGrowth: expect.stringContaining('+6.96%'),
        evidenceStatus: 'Official Data',
        sourceTier: 'tier1-official',
        confidence: 'high',
        reviewRequired: false,
        source: expect.objectContaining({
          title: 'SEC Companyfacts: STEPAN COMPANY RevenueFromContractWithCustomerExcludingAssessedTax',
          url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000094049.json',
        }),
      }),
      expect.objectContaining({
        companyName: 'Dow',
        revenue: expect.stringContaining('FY2025 company-wide revenue: US$39.968B'),
        yearlyGrowth: expect.stringContaining('-6.97%'),
        evidenceStatus: 'Official Data',
        sourceTier: 'tier1-official',
        confidence: 'high',
        reviewRequired: false,
      }),
    ]))
  })

  it('hydrates official company-page financial metrics when no Hermes output file is ready', async () => {
    writeFullDashboardJob(hermesHome)
    const htmlByCompany = new Map([
      ['BASF', '<p>In the 2025 business year, sales stood at €59,657 million, compared with €61,444 million in the previous year.</p>'],
      ['Evonik', '<p>Sales in 2025 decreased by 7 percent to €14.1 billion compared to the previous year.</p>'],
      ['WACKER', '<p>WACKER’s operations are highly international. Of the Group’s €5.49 billion in sales in 2025, (2024: €5.72 billion), 83.2 percent came from international business.</p>'],
      ['Kao', '<h3>Consolidated net sales</h3><p>1,688.6 billion yen</p><p>FY2025 ended December 31</p>'],
    ])
    const fetchMock = vi.fn(async (url: string) => {
      const key = Array.from(htmlByCompany.keys()).find(company => url.includes(company.toLowerCase().split(' ')[0]) || (company === 'WACKER' && url.includes('wacker')))
      return {
        ok: true,
        text: async () => htmlByCompany.get(key || 'BASF') || '',
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: true,
      includeOfficialProductConnectors: false,
      includeOfficialTradeConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 4,
      stagedReviewCount: 0,
    })
    expect(envelope?.state.competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'BASF',
        revenue: expect.stringContaining('FY2025 company-wide sales: €59.657B'),
        yearlyGrowth: expect.stringContaining('-2.91%'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
        rating: '',
        evidenceStatus: 'Official Data',
        sourceTier: 'tier2-company-official',
        confidence: 'high',
        reviewRequired: false,
      }),
      expect.objectContaining({
        companyName: 'Evonik Industries',
        revenue: 'FY2025 company-wide sales: €14.1B',
        yearlyGrowth: expect.stringContaining('-7%'),
      }),
      expect.objectContaining({
        companyName: 'WACKER',
        revenue: expect.stringContaining('FY2025 company-wide sales: €5.49B'),
        yearlyGrowth: expect.stringContaining('-4.02%'),
      }),
      expect.objectContaining({
        companyName: 'Kao Corporation',
        revenue: expect.stringContaining('FY2025 company-wide net sales: ¥1,688.6B'),
        yearlyGrowth: '',
      }),
    ]))
  })

  it('hydrates official competitor product evidence when no Hermes output file is ready', async () => {
    writeFullDashboardJob(hermesHome)
    const htmlByProduct = new Map([
      ['STEPANTEXSP90', '<title>STEPANTEX® SP-90</title><meta name="description" content="STEPANTEX® SP-90"/>'],
      ['wacker-finish-wr-1200', '<h1>WACKER® FINISH WR 1200</h1><p>Reactive aminoethyl-aminopropyl functional polydimethylsiloxane.</p>'],
      ['tetranyl-l9-90', '<h1>TETRANYL L9-90</h1><p>Esterquat based on European Vegetable Sources for the softener market.</p>'],
      ['siligen-d2w-liq-c', '<h1>SILIGEN D2W LIQ C</h1><p>Durable silicone softener engineered for cotton with a cross-linkable emulsion.</p>'],
      ['li_tubingal-gep-textile-softener', '<h1>TUBINGAL GEP</h1><p>Innovative silicone-based softener for textile finishing.</p>'],
    ])
    const fetchMock = vi.fn(async (url: string) => {
      const key = Array.from(htmlByProduct.keys()).find(fragment => url.includes(fragment))
      return {
        ok: Boolean(key),
        status: key ? 200 : 404,
        text: async () => htmlByProduct.get(key || '') || '',
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: true,
      includeOfficialTradeConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 5,
      stagedReviewCount: 0,
    })
    expect(envelope?.state.competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'Stepan Company',
        productEquivalent: expect.stringContaining('STEPANTEX SP-90'),
        pricingEvidence: '',
        marketShare: '',
        revenue: '',
        yearlyGrowth: '',
        traffic: '',
        rating: '',
        evidenceStatus: 'Source-backed',
        sourceTier: 'tier2-company-official',
        confidence: 'high',
        reviewRequired: false,
        source: expect.objectContaining({
          title: 'Stepan STEPANTEX SP-90 official product page',
          url: expect.stringContaining('STEPANTEXSP90.html'),
        }),
      }),
      expect.objectContaining({
        companyName: 'Kao Corporation',
        productEquivalent: expect.stringContaining('TETRANYL L9-90'),
        activeContent: expect.stringContaining('Esterquat'),
      }),
      expect.objectContaining({
        companyName: 'CHT Group',
        productEquivalent: expect.stringContaining('TUBINGAL GEP'),
        activeContent: expect.stringContaining('Silicone-based softener'),
      }),
    ]))
  })

  it('hydrates official UN Comtrade country import proxies when no Hermes output file is ready', async () => {
    writeFullDashboardJob(hermesHome)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => comtradePayload([
        { year: 2023, primaryValue: 195169270, netWeightKg: 51660671.263 },
        { year: 2024, primaryValue: 236608417, netWeightKg: 65408986.289 },
      ]),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialTradeConnectors: true,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 0,
      stagedReviewCount: 10,
    })
    expect(envelope?.state.marketClaims).toHaveLength(10)
    expect(envelope?.state.marketClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Country-wise consumption growth - China',
        value: expect.stringContaining('FY2024 official HS 380991 import proxy: US$236.608M'),
        evidenceStatus: 'Trade Proxy',
        reviewRequired: true,
        source: expect.objectContaining({
          title: 'UN Comtrade API: China HS 380991 imports',
          url: expect.stringContaining('comtradeapi.un.org'),
        }),
      }),
    ]))
    expect(envelope?.state.researchFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyClaim: expect.stringContaining('Country-wise consumption growth - China'),
        dashboardTarget: expect.objectContaining({
          group: 'marketClaims',
          fieldKey: 'market.country_consumption_growth.china.hs_380991',
          value: expect.stringContaining('FY2024 official HS 380991 import proxy'),
        }),
      }),
    ]))
  })

  it('imports flat competitor metric arrays by hydrating official metrics and staging weak candidates', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-06T01-21-23.000000+00-00.md', {
      dashboard_updates: [
        {
          fieldKey: 'competitor_metrics.stepan_company.revenue',
          value: 'FY2024 company-wide net sales: US$2,180,274,000',
          sourceTitle: 'Stepan Company 2024 Form 10-K',
          sourceUrl: 'https://www.sec.gov/Archives/edgar/data/94049/000095017025029079/scl-20241231.htm',
          sourceTier: 'Tier 2 official company/filing',
          lastChecked: '2026-06-05',
          sourceDate: '2025-02-27',
          confidence: 'High',
          evidenceStatus: 'Official Company Evidence',
          reviewRequired: false,
          riskReason: 'Company-wide revenue from contracts; not textile-softener product-line revenue.',
        },
        {
          fieldKey: 'competitor_metrics.stepan_company.traffic',
          value: 'Traffic estimate source identified; numeric traffic not imported pending owner review.',
          sourceTitle: 'SitePrice website-worth traffic/rating estimate page',
          sourceUrl: 'https://www.siteprice.org/website-worth/stepan.com',
          sourceTier: 'Tier 4/5 traffic analytics estimate',
          lastChecked: '2026-06-05',
          confidence: 'Low',
          evidenceStatus: 'Reference Only / To Verify',
          reviewRequired: true,
          riskReason: 'Third-party website traffic estimate is not official and may be dated/inaccurate.',
        },
      ],
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 1,
      stagedReviewCount: 1,
    })
    expect(envelope?.state.competitors).toEqual([
      expect.objectContaining({
        companyName: 'Stepan Company',
        revenue: 'FY2024 company-wide net sales: US$2,180,274,000',
        traffic: '',
        evidenceStatus: 'Official Data',
        source: expect.objectContaining({
          title: 'Stepan Company 2024 Form 10-K',
          url: expect.stringContaining('sec.gov'),
        }),
      }),
    ])
    expect(envelope?.state.researchFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyClaim: expect.stringContaining('Traffic estimate source identified'),
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          companyName: 'Stepan Company',
          traffic: 'Traffic estimate source identified; numeric traffic not imported pending owner review.',
        }),
      }),
    ]))
  })

  it('keeps flat competitor metric review targets attached to clean company names', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-06T02-00-00.000000+00-00.md', {
      dashboard_updates: [
        {
          fieldKey: 'competitor_metrics.dow.market_share',
          companyName: 'Metrics DOW Market',
          value: 'Market-share reference identified; exact textile-softener share not approved.',
          sourceTitle: 'Mordor Intelligence: Surfactants Market Companies',
          sourceUrl: 'https://www.mordorintelligence.com/industry-reports/surfactants-market/companies',
          sourceTier: 'Tier 4 - Market reference',
          lastChecked: '2026-06-06',
          confidence: 'Low',
          evidenceStatus: 'Reference Only / To Verify',
          reviewRequired: true,
          riskReason: 'Market-reference company list does not state Dow textile-softener market share by geography/year.',
        },
        {
          fieldKey: 'competitor_metrics.basf.rating',
          companyName: 'Metrics BASF',
          value: 'Rating reference identified; exact product/customer rating not approved.',
          sourceTitle: 'Glassdoor company reviews search: BASF',
          sourceUrl: 'https://www.glassdoor.com/Reviews/BASF-Reviews-E4231.htm',
          sourceTier: 'Tier 5 - Public listing / review source',
          lastChecked: '2026-06-06',
          confidence: 'Low',
          evidenceStatus: 'Reference Only / To Verify',
          reviewRequired: true,
          riskReason: 'Public employer review signal is not product/customer rating evidence.',
        },
      ],
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 0,
      stagedReviewCount: 2,
    })
    expect(envelope?.state.competitors).toEqual([])
    expect(envelope?.state.researchFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          fieldKey: 'competitor_metrics.dow.market_share',
          companyName: 'Dow',
          marketShare: 'Market-share reference identified; exact textile-softener share not approved.',
        }),
      }),
      expect.objectContaining({
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          fieldKey: 'competitor_metrics.basf.rating',
          companyName: 'BASF',
          rating: 'Rating reference identified; exact product/customer rating not approved.',
        }),
      }),
    ]))
    expect(envelope?.state.researchFindings.map(item => item.dashboardTarget?.companyName)).not.toContain('Metrics DOW Market')
    expect(envelope?.state.researchFindings.map(item => item.dashboardTarget?.companyName)).not.toContain('Metrics BASF')
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
      autoFilledCount: 1,
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

  it('preserves dashboard field identity metadata in durable records and review targets', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-02T09-15-00.000000+00-00.md', {
      dashboard_updates: {
        marketClaims: [{
          fieldKey: 'market.officialTextilePolicy',
          proposedDashboardField: 'Official textile sector reference',
          field: 'Official textile sector reference',
          label: 'Official textile sector reference',
          value: 'China textile sector policy page identified',
          sourceTitle: 'Ministry textile policy page',
          sourceUrl: 'https://example.gov.cn/textile-policy',
          sourceTier: 'Tier 1 - Official / regulator / trade source',
          confidence: 'high',
          evidenceStatus: 'Official Data',
          dataType: 'company_data',
          reviewRequired: false,
        }],
        competitorRecords: [{
          fieldKey: 'competitors.stepan.productEquivalent',
          proposedDashboardField: 'Competitor product equivalent - Stepan',
          companyName: 'Stepan Company',
          countryRegion: 'United States',
          productEquivalent: 'Official esterquat product reference',
          activeContent: 'Official source identified',
          pricingEvidence: 'Official source does not publish pricing',
          certifications: 'Product documentation available',
          distributionPresence: 'Global distribution page identified',
          sourceTitle: 'Stepan official product reference',
          sourceUrl: 'https://www.stepan.com/',
          sourceTier: 'Tier 2 - Official company / product source',
          confidence: 'high',
          evidenceStatus: 'Source-backed',
          dataType: 'competitor_data',
          reviewRequired: false,
        }],
        supplierScorecards: [{
          fieldKey: 'supplier.wilmar.stearicPrice',
          proposedDashboardField: 'Supplier scorecard - Wilmar price benchmark',
          field: 'Supplier scorecard - Wilmar price benchmark',
          supplier: 'Wilmar',
          material: 'Stearic Acid TP',
          value: 'USD 1,180/t dated supplier quote',
          sourceTitle: 'Uploaded Wilmar quote',
          sourceUrl: 'file://documents/wilmar-stearic-quote.pdf',
          sourceTier: 'Tier 3 - Uploaded supplier evidence',
          confidence: 'medium',
          evidenceStatus: 'Supplier Evidence',
          dataType: 'supplier_quote',
          reviewRequired: true,
          riskReason: 'Supplier quote needs owner price validation.',
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 2,
      stagedReviewCount: 1,
    })
    expect(envelope?.state.marketClaims).toEqual([
      expect.objectContaining({
        fieldKey: 'market.officialTextilePolicy',
        dashboardGroup: 'marketClaims',
        group: 'marketClaims',
        proposedDashboardField: 'Official textile sector reference',
        sourceTier: 'tier1-official',
        reportedSourceTier: 'Tier 1 - Official / regulator / trade source',
        dataType: 'company_data',
        reviewRequired: false,
        reportedReviewRequired: false,
      }),
    ])
    expect(envelope?.state.competitors).toEqual([
      expect.objectContaining({
        fieldKey: 'competitors.stepan.productEquivalent',
        dashboardGroup: 'competitorRecords',
        group: 'competitorRecords',
        proposedDashboardField: 'Competitor product equivalent - Stepan',
        sourceTier: 'tier2-company-official',
        reportedSourceTier: 'Tier 2 - Official company / product source',
        dataType: 'competitor_data',
        reviewRequired: false,
        reportedReviewRequired: false,
      }),
    ])
    expect(envelope?.state.dataRoomSources).toEqual([
      expect.objectContaining({
        fieldKey: 'supplier.wilmar.stearicPrice',
        dashboardGroup: 'supplierScorecards',
        group: 'supplierScorecards',
        proposedDashboardField: 'Supplier scorecard - Wilmar price benchmark',
        sourceTier: 'tier3-supplier-evidence',
        reportedSourceTier: 'Tier 3 - Uploaded supplier evidence',
        dataType: 'supplier_quote',
        reviewRequired: true,
        reportedReviewRequired: true,
        riskReason: 'Supplier quote needs owner price validation.',
      }),
    ])
    expect(envelope?.state.researchFindings).toEqual([
      expect.objectContaining({
        dashboardGroup: 'supplierScorecards',
        sourceTier: 'tier3-supplier-evidence',
        dataType: 'supplier_quote',
        reviewRequired: true,
        riskReason: 'Supplier quote needs owner price validation.',
        dashboardTarget: expect.objectContaining({
          fieldKey: 'supplier.wilmar.stearicPrice',
          dashboardGroup: 'supplierScorecards',
          group: 'supplierScorecards',
          proposedDashboardField: 'Supplier scorecard - Wilmar price benchmark',
          sourceTier: 'tier3-supplier-evidence',
          reportedSourceTier: 'Tier 3 - Uploaded supplier evidence',
          dataType: 'supplier_quote',
          reviewRequired: true,
          reportedReviewRequired: true,
          riskReason: 'Supplier quote needs owner price validation.',
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

  it('replays previously imported outputs when the importer schema changes so richer source fields can hydrate dashboards', async () => {
    writeFullDashboardJob(hermesHome)
    const runFile = '2026-06-05T19-00-00.000000+00-00.md'
    const runKey = `job-full-dashboard/${runFile}`
    writeRunOutput(hermesHome, 'job-full-dashboard', runFile, {
      dashboard_updates: {
        marketClaims: [{
          fieldKey: 'market.countryGrowth.china',
          field: 'Country-wise consumption growth - China',
          label: 'Country-wise consumption growth - China',
          value: '2024 HS 3402 import proxy: USD 1,538,811,127; net weight 467,139,584 kg',
          sourceTitle: 'UN Comtrade API Preview',
          sourceUrl: 'https://comtradeapi.un.org/public/v1/preview/C/A/HS?cmdCode=3402&flowCode=M&reporterCode=156&period=2024&partnerCode=0&max=100000',
          sourceTier: 'Tier 1 - Official / regulator / trade source',
          confidence: 'high',
          evidenceStatus: 'Official Data',
          dataType: 'trade_data',
          reviewRequired: true,
          riskReason: 'HS 3402 is a broad trade proxy, not approved textile-softener consumption.',
        }],
        competitorRecords: [{
          fieldKey: 'competitor.stepanOfficialProductPortfolio',
          companyName: 'Stepan Company',
          countryRegion: 'United States / global',
          productEquivalent: 'STEPANTEX SP-90 official product page describes a textile softening additive.',
          activeContent: 'Solids 90% shown on official page; exact active chemistry requires TDS/SDS review.',
          pricingEvidence: '',
          certifications: 'Official company source identified',
          distributionPresence: 'Global / To Verify',
          marketShare: '',
          revenue: 'FY2025 net sales available from official annual report',
          yearlyGrowth: 'Year-over-year change available from official annual report',
          traffic: '',
          rating: '',
          sourceTitle: 'STEPANTEX SP-90',
          sourceUrl: 'https://www.stepan.com/content/stepan-dot-com/en/products-markets/product/STEPANTEXSP90.html',
          sourceTier: 'Tier 2 - Official company / product source',
          confidence: 'high',
          evidenceStatus: 'Source-backed',
          dataType: 'competitor_data',
          reviewRequired: false,
        }],
      },
    })
    const registryDir = join(hermesHome, 'dashboard-intelligence')
    mkdirSync(registryDir, { recursive: true })
    writeFileSync(join(registryDir, 'imported-runs.json'), JSON.stringify({
      version: 1,
      importerVersion: 'older-importer-without-company-metrics',
      importedRunKeys: [runKey],
      skippedRunKeys: [],
      updatedAt: '2026-06-05T00:00:00.000Z',
    }, null, 2))

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')
    const registry = JSON.parse(readFileSync(join(registryDir, 'imported-runs.json'), 'utf-8'))
    const second = await ingestFullDashboardAutopilotOutputs('default')

    expect(result.importedRuns).toBe(1)
    expect(result.stagedReviewCount).toBe(1)
    expect(envelope?.state.marketClaims).toEqual([
      expect.objectContaining({
        fieldKey: 'market.countryGrowth.china',
        value: expect.stringContaining('USD 1,538,811,127'),
        source: expect.objectContaining({
          title: 'UN Comtrade API Preview',
          url: expect.stringContaining('comtradeapi.un.org'),
        }),
        reviewRequired: true,
      }),
    ])
    expect(envelope?.state.competitors).toEqual([
      expect.objectContaining({
        companyName: 'Stepan Company',
        productEquivalent: expect.stringContaining('STEPANTEX SP-90'),
        revenue: 'FY2025 net sales available from official annual report',
        yearlyGrowth: 'Year-over-year change available from official annual report',
        sourceTier: 'tier2-company-official',
        reviewRequired: false,
      }),
    ])
    expect(registry.importerVersion).toContain('official-product-evidence')
    expect(registry.importedRunKeys).toContain(runKey)
    expect(second.importedRuns).toBe(0)
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
    expect(prompt).toContain('revenue, yearlyGrowth')
    expect(prompt).toContain('traffic, rating')
    expect(prompt).toContain('lastChecked')
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
