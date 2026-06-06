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
  DASHBOARD_AUTOPILOT_IMPORTER_VERSION,
  FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
  FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION,
  FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
  dashboardSourceTierRank,
  ensureFullDashboardAutopilotScheduled,
  comtradeImportPayloadToMarketClaimUpdate,
  extractDashboardResearchUpdates,
  ingestFullDashboardAutopilotOutputs,
  marketReferencePageToCompetitorContextUpdates,
  marketReferenceFinancialPageToCompetitorUpdate,
  marketReferencePageToMarketClaimUpdates,
  marketReferenceTrafficPageToCompetitorUpdate,
  officialCompanyPageToCompetitorFinancialUpdate,
  officialCompetitorRecognitionPageToUpdate,
  officialCompetitorProductPageToUpdate,
  officialSupplierEvidencePageToUpdate,
  publicCompetitorPricePageToUpdate,
  readFullDashboardAutopilotImportStatus,
  runDueFullDashboardAutopilot,
  secCompanyfactsToCompetitorFinancialUpdate,
  trancoRanksPayloadToCompetitorUpdate,
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
  syensqo: {
    companyName: 'Syensqo / Solvay',
    fieldKeySlug: 'syensqo_solvay',
    countryRegion: 'Belgium / global',
    sourceTitle: 'Syensqo fourth quarter and full year 2025 results',
    sourceUrl: 'https://live.euronext.com/en/products/equities/company-news/2026-02-26-syensqo-fourth-quarter-and-full-year-2025-results',
    parser: 'syensqo-results-2025' as const,
  },
  cht: {
    companyName: 'CHT Group',
    fieldKeySlug: 'cht_group',
    countryRegion: 'Germany / global',
    sourceTitle: 'CHT Group expands Management Team and focuses on Sustainable Growth',
    sourceUrl: 'https://www.cht.com/en/news-media/article/cht-group-expands-management-team-and-focuses-on-sustainable-growth',
    parser: 'cht-growth-2024' as const,
  },
  zschimmer: {
    companyName: 'Zschimmer & Schwarz',
    fieldKeySlug: 'zschimmer_schwarz',
    countryRegion: 'Germany / global',
    sourceTitle: 'Zschimmer & Schwarz initiates management change',
    sourceUrl: 'https://www.zschimmer-schwarz.com/en/news/news-details/zschimmer-schwarz-initiates-management-change',
    parser: 'zschimmer-turnover-2023' as const,
  },
  pulcra: {
    companyName: 'Pulcra Chemicals',
    fieldKeySlug: 'pulcra_chemicals',
    countryRegion: 'Germany / group context',
    sourceTitle: 'Pulcra Germany GmbH Sustainability Statement 2023',
    sourceUrl: 'https://www.pulcra-chemicals.com/wp-content/uploads/PULCRA_CSRD_2023.pdf',
    parser: 'pulcra-csrd-2023' as const,
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

const officialRecognitionSources = {
  evonik: {
    companyName: 'Evonik Industries',
    fieldKeySlug: 'evonik_industries',
    countryRegion: 'Germany / global',
    ratingLabel: '2025 EcoVadis Gold rating; official Evonik page says top 5% placement among globally assessed companies.',
    sourceTitle: 'EcoVadis ranks Evonik among the world’s most sustainable companies',
    sourceUrl: 'https://corporate.evonik.cn/en/media/news/ecovadis-ranks-evonik-among-the-worlds-most-sustainable-companies-289380.html',
    requiredTerms: ['EcoVadis', 'Gold rating', 'top five percent'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  stepan: {
    companyName: 'Stepan Company',
    fieldKeySlug: 'stepan_company',
    countryRegion: 'United States / global',
    ratingLabel: '2026 EcoVadis Silver medal; official Stepan page says top 15% globally and 89th percentile among manufacturers of chemical products.',
    sourceTitle: 'Stepan Achieves a Silver Medal in 2026 EcoVadis Assessment',
    sourceUrl: 'https://www.stepan.com/content/stepan-dot-com/en/news-events/news---events/Stepan-Achieves-Silver-Medal-in-2026-EcoVadis-Assessment.html',
    requiredTerms: ['Silver medal', 'top 15%', '89th percentile'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  kao: {
    companyName: 'Kao Corporation',
    fieldKeySlug: 'kao_corporation',
    countryRegion: 'Japan / global',
    ratingLabel: 'Kao Sustainability Report 2025 release says Kao achieved CDP Triple-A in 2024 and World’s Most Ethical Companies 2025 recognition.',
    sourceTitle: 'Kao Releases Kao Sustainability Report 2025',
    sourceUrl: 'https://www.kao.com/global/en/newsroom/news/release/2025/20250613-002/',
    requiredTerms: ['Triple-A rating', 'World’s Most Ethical Companies', '2025'],
    recommendedAction: 'Use this as sustainability/ethics recognition evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  archroma: {
    companyName: 'Archroma',
    fieldKeySlug: 'archroma',
    countryRegion: 'Switzerland / global',
    ratingLabel: '2025 adidas adiFormulator Award: Champion status; official Archroma recognition page.',
    sourceTitle: 'Archroma recognized as top chemicals supplier for the second consecutive year',
    sourceUrl: 'https://www.archroma.com/news/archroma-recognized-as-top-chemicals-supplier-for-the-second-consecutive-year',
    requiredTerms: ['Champion status', '2025 adiFormulator Award', 'adidas'],
    recommendedAction: 'Use this as external-recognition evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  archromaSustainability: {
    companyName: 'Archroma',
    fieldKeySlug: 'archroma',
    countryRegion: 'Switzerland / global',
    ratingLabel: '2025 EcoVadis Gold rating; official Archroma sustainability page says top 5% in its industry.',
    sourceTitle: 'Archroma Sustainability',
    sourceUrl: 'https://www.archroma.com/sustainability',
    requiredTerms: ['EcoVadis', 'Gold', 'top 5%'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  cht: {
    companyName: 'CHT Group',
    fieldKeySlug: 'cht_group',
    countryRegion: 'Germany / global',
    ratingLabel: '2025 adidas adiFORMULATOR Award: Champion for the third time in a row; official CHT recognition page.',
    sourceTitle: 'CHT Group adiFORMULATOR AWARD 2025',
    sourceUrl: 'https://www.cht.com/en/news-media/article/adiformulator-award-2025',
    requiredTerms: ['champion', 'adiFORMULATOR AWARD', 'third time in a row'],
    recommendedAction: 'Use this as external-recognition evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  pulcra: {
    companyName: 'Pulcra Chemicals',
    fieldKeySlug: 'pulcra_chemicals',
    countryRegion: 'Germany / global',
    ratingLabel: '2025 EcoVadis Silver Medal; official Pulcra page says 92nd percentile / top 8% of chemical companies evaluated by EcoVadis.',
    sourceTitle: 'Pulcra Chemicals Awarded EcoVadis Silver Medal for the Second Time',
    sourceUrl: 'https://www.pulcra-chemicals.com/pulcra-chemicals-awarded-ecovadis-silver-medal-for-the-second-time/',
    requiredTerms: ['EcoVadis Silver Medal', '92%', 'top 8%'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  zschimmer: {
    companyName: 'Zschimmer & Schwarz',
    fieldKeySlug: 'zschimmer_schwarz',
    countryRegion: 'Germany / global',
    ratingLabel: 'EcoVadis Silver for ZSL; official Zschimmer & Schwarz page says top 15% of companies assessed worldwide last year.',
    sourceTitle: 'Outstanding sustainability: ZSL awarded Silver by EcoVadis',
    sourceUrl: 'https://www.zschimmer-schwarz.com/en/news/news-details/outstanding-sustainability-zsl-awarded-silver-by-ecovadis',
    requiredTerms: ['EcoVadis', 'Silver', 'top 15 %'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
}

const marketReferenceTrafficSources = {
  kao: {
    companyName: 'Kao Corporation',
    fieldKeySlug: 'kao_corporation',
    countryRegion: 'Japan / global',
    domain: 'kao.com',
    sourceTitle: 'Semrush website traffic overview - kao.com',
    sourceUrl: 'https://www.semrush.com/website/kao.com/overview/',
  },
  syensqo: {
    companyName: 'Syensqo / Solvay',
    fieldKeySlug: 'syensqo_solvay',
    countryRegion: 'Belgium / global',
    domain: 'syensqo.com',
    sourceTitle: 'Semrush website traffic overview - syensqo.com',
    sourceUrl: 'https://www.semrush.com/website/syensqo.com/overview/',
  },
}

const officialSupplierSources = {
  wilmar: {
    supplier: 'Wilmar Oleochemicals',
    material: 'Rubber grade stearic acid / WILFARIN fatty acids',
    fieldKeySlug: 'wilmar_stearic_acid',
    sourceTitle: 'Wilmar Rubber Grade Stearic Acid 1807 official product page',
    sourceUrl: 'https://www.wilmar-international.com/oleochemicals/products/home-care/rubber-grade-stearic-acid-1807',
    value: 'Official Wilmar product page confirms Rubber Grade Stearic Acid 1807 and WILFARIN fatty-acid product context.',
    requiredTerms: ['RUBBER GRADE STEARIC ACID 1807', 'Wilfarin fatty acids'],
    recommendedAction: 'Request current quote, TDS, SDS, COA, MOQ, lead time, delivery route, and payment terms before scoring Wilmar for Chemicon raw-material sourcing.',
  },
  basf: {
    supplier: 'BASF',
    material: 'Triethanolamine / TEOA',
    fieldKeySlug: 'basf_triethanolamine',
    sourceTitle: 'BASF Triethanolamine official product page',
    sourceUrl: 'https://products.basf.com/global/en/ci/triethanolamine',
    value: 'Official BASF product page confirms Triethanolamine CAS No. 102-71-6 and states TEOA forms quat salts with fatty acids used in fabric softener formulations.',
    requiredTerms: ['Triethanolamine', '102-71-6', 'fabric softener formulations'],
    recommendedAction: 'Request BASF TEA quote, TDS, SDS, COA, China/Bangladesh delivery route, and payment terms before using in cost or supplier scorecards.',
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
  const originalComtradeEnv = {
    UN_COMTRADE_SUBSCRIPTION_KEY: process.env.UN_COMTRADE_SUBSCRIPTION_KEY,
    COMTRADE_SUBSCRIPTION_KEY: process.env.COMTRADE_SUBSCRIPTION_KEY,
    UN_COMTRADE_API_KEY: process.env.UN_COMTRADE_API_KEY,
    COMTRADE_API_KEY: process.env.COMTRADE_API_KEY,
  }
  let hermesHome = ''

  beforeEach(() => {
    execFileMock.mockReset()
    hermesHome = mkdtempSync(join(tmpdir(), 'hermes-dashboard-autopilot-'))
    process.env.HERMES_HOME = hermesHome
    delete process.env.UN_COMTRADE_SUBSCRIPTION_KEY
    delete process.env.COMTRADE_SUBSCRIPTION_KEY
    delete process.env.UN_COMTRADE_API_KEY
    delete process.env.COMTRADE_API_KEY
  })

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = originalHermesHome
    for (const [key, value] of Object.entries(originalComtradeEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
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
      sourceUrl: 'https://comtradeapi.un.org/data/v1/get/C/A/HS?cmdCode=380991&flowCode=M&reporterCode=156&period=2023,2024&partnerCode=0&partner2Code=0&customsCode=C00&motCode=0&maxRecords=100000&includeDesc=true',
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
      '<p>In the 2025 business year, sales stood at €59,657 million , compared with €61,444 million in the previous year.</p>',
      '2026-06-06',
    )
    const evonik = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.evonik,
      '<p>Sales in 2025 decreased by 7 percent to €14.1 billion compared to the previous year.</p>',
      '2026-06-06',
    )
    const wacker = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.wacker,
      '<p>WACKER’s operations are highly international. Of the Group’s €5.49 billion in sales in 2025, (2024: €5.72 billion ), 83.2 percent came from international business.</p>',
      '2026-06-06',
    )
    const kao = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.kao,
      '<h3>Consolidated net sales</h3><p>1,688.6 billion yen</p><p>FY2025 ended December 31</p>',
      '2026-06-06',
    )
    const syensqo = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.syensqo,
      '<h2>FY 2025 Highlights</h2><p>Net sales of €6.14 billion, impacted by year-on-year foreign exchange movements.</p><p>Net sales 1,418 1,598 1,517-11.3%-5.6%-6.5% 6,140 6,563-6.5%-3.2%</p>',
      '2026-06-06',
    )
    const cht = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.cht,
      '<p>Despite volatile global conditions, the company recorded sales growth to EUR 614.3 million (+2%) and a significant increase in EBIT.</p>',
      '2026-06-06',
    )
    const zschimmer = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.zschimmer,
      '<p>Zschimmer & Schwarz has grown strongly over the last 15 years, with turnover increasing by 500 million to almost 700 million euros.</p>',
      '2026-06-06',
    )
    const pulcra = officialCompanyPageToCompetitorFinancialUpdate(
      officialCompanySources.pulcra,
      '<p>Our revenue for the year decreased by EUR 11.4 million (14.6%) to EUR 66.9 million (previous year: EUR 78.3 million).</p>',
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
    expect(basf?.lastUpdated).toEqual(expect.objectContaining({
      value: '2025',
      sourceUrl: officialCompanySources.basf.sourceUrl,
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
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
    expect(syensqo?.revenue).toEqual(expect.objectContaining({
      value: 'FY2025 company-wide net sales: €6.14B',
      sourceUrl: officialCompanySources.syensqo.sourceUrl,
    }))
    expect(syensqo?.yearlyGrowth).toEqual(expect.objectContaining({
      value: expect.stringContaining('-6.5%'),
    }))
    expect(cht?.revenue).toEqual(expect.objectContaining({
      value: 'FY2024 company-wide sales: €614.3M (official preliminary figure)',
      sourceUrl: officialCompanySources.cht.sourceUrl,
    }))
    expect(cht?.yearlyGrowth).toEqual(expect.objectContaining({
      value: expect.stringContaining('+2%'),
    }))
    expect(cht?.lastUpdated).toEqual(expect.objectContaining({
      value: '2024',
      sourceUrl: officialCompanySources.cht.sourceUrl,
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
    }))
    expect(zschimmer?.revenue).toEqual(expect.objectContaining({
      value: expect.stringContaining('turnover almost €700M'),
      sourceUrl: officialCompanySources.zschimmer.sourceUrl,
    }))
    expect(zschimmer?.yearlyGrowth).toBeUndefined()
    expect(pulcra?.revenue).toEqual(expect.objectContaining({
      value: 'FY2023 Pulcra Germany GmbH net revenue: €66.9M (CSRD statement; previous year €78.3M)',
      sourceUrl: officialCompanySources.pulcra.sourceUrl,
    }))
    expect(pulcra?.yearlyGrowth).toEqual(expect.objectContaining({
      value: expect.stringContaining('-14.6%'),
      sourceUrl: officialCompanySources.pulcra.sourceUrl,
    }))
  })

  it('converts reputable market-reference financial pages into competitor revenue context', () => {
    const archroma = marketReferenceFinancialPageToCompetitorUpdate({
      companyName: 'Archroma',
      fieldKeySlug: 'archroma',
      countryRegion: 'Switzerland / global',
      sourceTitle: 'S&P Global Ratings - Archroma research update',
      sourceUrl: 'https://www.spglobal.com/ratings/en/regulatory/article/-/view/type/HTML/id/3539926',
      parser: 'spglobal-archroma-2025',
    }, '<p>The company reported about $1.6 billion in sales in fiscal 2025, with about 48% of group revenue generated in Asia.</p>', '2026-06-06')

    const transfar = marketReferenceFinancialPageToCompetitorUpdate({
      companyName: 'Transfar',
      fieldKeySlug: 'transfar',
      countryRegion: 'China / global',
      sourceTitle: 'StockAnalysis / S&P Global Market Intelligence - Transfar Zhilian revenue by segment',
      sourceUrl: 'https://stockanalysis.com/quote/she/002010/financials/metrics/',
      parser: 'stockanalysis-transfar-2025',
    }, [
      'Textile Printing and Dyeing Auxiliaries 7.41B 7.07B 6.25B',
      'Textile Printing and Dyeing Auxiliaries Growth 4.79% 13.07% 46.20%',
      'Total 25.08B 26.70B 33.58B',
      'Total Growth -6.05% -20.49% -9.00%',
      'Last checked: May 18, 2026',
    ].join(' '), '2026-06-06')

    expect(archroma).toEqual(expect.objectContaining({
      companyName: 'Archroma',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
    }))
    expect(archroma?.revenue).toEqual(expect.objectContaining({
      value: expect.stringContaining('FY2025 company-wide sales: about US$1.6B'),
      sourceUrl: 'https://www.spglobal.com/ratings/en/regulatory/article/-/view/type/HTML/id/3539926',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
    }))
    expect(archroma?.lastUpdated).toEqual(expect.objectContaining({
      value: '2026-06-06',
      sourceUrl: 'https://www.spglobal.com/ratings/en/regulatory/article/-/view/type/HTML/id/3539926',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
    }))
    expect(transfar).toEqual(expect.objectContaining({
      companyName: 'Transfar',
      productEquivalent: expect.stringContaining('Textile Printing and Dyeing Auxiliaries segment: CNY 7.41B'),
      evidenceStatus: 'Market Reference',
    }))
    expect(transfar?.revenue).toEqual(expect.objectContaining({
      value: expect.stringContaining('FY2025 company-wide revenue: CNY 25.08B'),
      sourceUrl: 'https://stockanalysis.com/quote/she/002010/financials/metrics/',
    }))
    expect(transfar?.yearlyGrowth).toEqual(expect.objectContaining({
      value: expect.stringContaining('-6.05%'),
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
    }))
    expect(transfar?.lastUpdated).toEqual(expect.objectContaining({
      value: 'May 18, 2026',
      sourceUrl: 'https://stockanalysis.com/quote/she/002010/financials/metrics/',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
    }))
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

  it('converts official competitor recognition pages into rating-column evidence without inventing customer ratings', () => {
    const evonik = officialCompetitorRecognitionPageToUpdate(
      officialRecognitionSources.evonik,
      '<h1>EcoVadis ranks Evonik among the world’s most sustainable companies</h1><p>This year, sustainability rating agency EcoVadis has awarded Evonik a Gold rating and says it ranks among the top five percent of companies assessed worldwide.</p>',
      '2026-06-06',
    )
    const stepan = officialCompetitorRecognitionPageToUpdate(
      officialRecognitionSources.stepan,
      '<h1>Stepan Achieves a Silver Medal in 2026 EcoVadis Assessment</h1><p>Stepan achieved a Silver medal, placing the company in the top 15% globally and in the 89th percentile among manufacturers of chemical products.</p>',
      '2026-06-06',
    )
    const kao = officialCompetitorRecognitionPageToUpdate(
      officialRecognitionSources.kao,
      '<h1>Kao Releases Kao Sustainability Report 2025</h1><p>Kao was one of eight companies to achieve the CDP Triple-A rating and was selected as one of the World’s Most Ethical Companies 2025.</p>',
      '2026-06-06',
    )
    const archroma = officialCompetitorRecognitionPageToUpdate(
      officialRecognitionSources.archroma,
      '<h1>Archroma recognized as top chemicals supplier</h1><p>Archroma has been awarded Champion status at the 2025 adiFormulator Award by adidas.</p>',
      '2026-06-06',
    )
    const pulcra = officialCompetitorRecognitionPageToUpdate(
      officialRecognitionSources.pulcra,
      '<h1>Pulcra Chemicals Awarded EcoVadis Silver Medal</h1><p>Pulcra Chemicals has been awarded the EcoVadis Silver Medal, achieving a percentile rank of 92% and placing among the top 8% of chemical companies evaluated by EcoVadis.</p>',
      '2026-06-06',
    )
    const zschimmer = officialCompetitorRecognitionPageToUpdate(
      officialRecognitionSources.zschimmer,
      '<h1>Outstanding sustainability: ZSL awarded Silver by EcoVadis</h1><p>ZSL was awarded Silver by EcoVadis, placing it among the top 15 % of companies assessed worldwide last year.</p>',
      '2026-06-06',
    )
    const cht = officialCompetitorRecognitionPageToUpdate(
      officialRecognitionSources.cht,
      '<h1>adiFORMULATOR AWARD 2025</h1><p>For the third time in a row, the CHT Group has been recognized as champion of the adiFORMULATOR AWARD by adidas.</p>',
      '2026-06-06',
    )

    expect(evonik?.rating).toEqual(expect.objectContaining({
      value: expect.stringContaining('EcoVadis Gold'),
      sourceUrl: officialRecognitionSources.evonik.sourceUrl,
      riskReason: expect.stringContaining('not a customer review rating'),
    }))
    expect(stepan?.rating).toEqual(expect.objectContaining({
      value: expect.stringContaining('89th percentile'),
      sourceUrl: officialRecognitionSources.stepan.sourceUrl,
    }))
    expect(kao?.rating).toEqual(expect.objectContaining({
      value: expect.stringContaining('Triple-A'),
      sourceUrl: officialRecognitionSources.kao.sourceUrl,
    }))
    expect(archroma).toEqual(expect.objectContaining({
      companyName: 'Archroma',
      fieldKey: 'competitor_metrics.archroma.official_recognition_rating',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
      recommendedAction: expect.stringContaining('external-recognition evidence only'),
    }))
    expect(archroma?.rating).toEqual(expect.objectContaining({
      value: expect.stringContaining('Champion status'),
      sourceUrl: officialRecognitionSources.archroma.sourceUrl,
      riskReason: expect.stringContaining('not a customer review rating'),
    }))
    expect(cht?.rating).toEqual(expect.objectContaining({
      value: expect.stringContaining('third time in a row'),
      sourceUrl: officialRecognitionSources.cht.sourceUrl,
    }))
    expect(pulcra?.rating).toEqual(expect.objectContaining({
      value: expect.stringContaining('92nd percentile'),
      sourceUrl: officialRecognitionSources.pulcra.sourceUrl,
    }))
    expect(zschimmer?.rating).toEqual(expect.objectContaining({
      value: expect.stringContaining('top 15%'),
      sourceUrl: officialRecognitionSources.zschimmer.sourceUrl,
    }))
    for (const update of [evonik, stepan, kao, archroma, cht, pulcra, zschimmer]) {
      expect(update?.pricingEvidence).toBeUndefined()
      expect(update?.marketShare).toBeUndefined()
      expect(update?.traffic).toBeUndefined()
    }
    expect(officialCompetitorRecognitionPageToUpdate(
      officialRecognitionSources.archroma,
      '<p>Generic award page without the required source-backed terms.</p>',
      '2026-06-06',
    )).toBeNull()
  })

  it('converts public competitor price pages into review-gated price evidence only', () => {
    const stepan = publicCompetitorPricePageToUpdate(
      {
        companyName: 'Stepan Company',
        fieldKeySlug: 'stepan_company',
        countryRegion: 'United States / global',
        productEquivalent: 'STEPANTEX SP-90 public customs/import price reference; not a current industrial quote.',
        sourceTitle: 'Zauba - Stepantex Sp 90 imports under HS Code 29051490',
        sourceUrl: 'https://www.zauba.com/import-STEPANTEX%2BSP%2B90/hs-code-29051490-hs-code.html',
        parser: 'zauba-stepantex-sp90',
        requiredTerms: ['stepantex sp 90', 'average import price'],
        riskReason: 'Historical public import listing only.',
      },
      '<h1>Stepantex Sp 90 Imports Under HS Code 29051490</h1><p>Average import price for stepantex sp 90 under HS Code 29051490 was $71.30.</p><table><tr><td>Oct 22 2016</td></tr></table>',
      '2026-06-06',
    )
    const evonik = publicCompetitorPricePageToUpdate(
      {
        companyName: 'Evonik Industries',
        fieldKeySlug: 'evonik_industries',
        countryRegion: 'Germany / global',
        productEquivalent: 'VARISOFT EQ 65 public retail/sample price reference; not an industrial textile softener quote.',
        sourceTitle: 'Wholesale Supplies Plus - Varisoft EQ 65',
        sourceUrl: 'https://www.wholesalesuppliesplus.com/products/varisoft-eq-65',
        parser: 'wholesale-varisoft-eq65',
        requiredTerms: ['varisoft eq 65', 'regular price'],
        riskReason: 'Retail public listing only.',
      },
      '<h1>Varisoft EQ 65</h1><p>Regular price $3.95</p><p>Size: 2 oz ($30.38/lb)</p>',
      '2026-06-06',
    )

    expect(stepan?.pricingEvidence).toEqual(expect.objectContaining({
      value: expect.stringContaining('$71.30'),
      evidenceStatus: 'Reference Only',
      reviewRequired: true,
      dataType: 'price_data',
      sourceTier: 'Tier 5 - Public listing / weak price reference',
      riskReason: expect.stringContaining('Historical'),
    }))
    expect(evonik?.pricingEvidence).toEqual(expect.objectContaining({
      value: expect.stringContaining('$3.95'),
      evidenceStatus: 'Reference Only',
      reviewRequired: true,
      dataType: 'price_data',
      sourceTier: 'Tier 5 - Public listing / weak price reference',
      riskReason: expect.stringContaining('Retail'),
    }))
    expect(stepan?.marketShare).toBeUndefined()
    expect(evonik?.revenue).toBeUndefined()
  })

  it('hydrates public competitor price references as review-gated dashboard price cells', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const text = url.includes('zauba.com')
        ? '<h1>Stepantex Sp 90 Imports Under HS Code 29051490</h1><p>Average import price for stepantex sp 90 under HS Code 29051490 was $71.30.</p><p>Oct 22 2016</p>'
        : '<h1>Varisoft EQ 65</h1><p>Regular price $3.95</p><p>Size: 2 oz ($30.38/lb)</p>'
      return { ok: true, text: async () => text }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialRecognitionConnectors: false,
      includeOfficialSupplierConnectors: false,
      includePublicPriceEvidenceConnectors: true,
      includeOfficialTradeConnectors: false,
      includeMarketReferenceConnectors: false,
      includeMarketReferenceTrafficConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(result.autoFilledCount).toBeGreaterThanOrEqual(2)
    expect(envelope?.state.competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'Stepan Company',
        pricingEvidence: expect.stringContaining('$71.30'),
        metricEvidence: expect.objectContaining({
          pricingEvidence: expect.objectContaining({
            evidenceStatus: 'Reference Only',
            reviewRequired: true,
            sourceTier: 'tier5-public-listing',
          }),
        }),
      }),
      expect.objectContaining({
        companyName: 'Evonik Industries',
        pricingEvidence: expect.stringContaining('$3.95'),
        metricEvidence: expect.objectContaining({
          pricingEvidence: expect.objectContaining({
            evidenceStatus: 'Reference Only',
            reviewRequired: true,
            sourceTier: 'tier5-public-listing',
          }),
        }),
      }),
    ]))
  })

  it('converts market-reference traffic pages into competitor traffic and authority metrics only', () => {
    const update = marketReferenceTrafficPageToCompetitorUpdate(
      marketReferenceTrafficSources.kao,
      [
        '<title>kao.com Website Traffic, Ranking, Analytics [April 2026]</title>',
        '<p>In April kao.com received 1.17M visits with the average session duration 07:12. Compared to March traffic to kao.com has decreased by -6.34%.</p>',
        '&quot;authorityScore&quot;:[0,{&quot;value&quot;:[0,60],&quot;valueDiffPercent&quot;:[0,null]}]',
      ].join(''),
      '2026-06-06',
    )

    expect(update).toEqual(expect.objectContaining({
      companyName: 'Kao Corporation',
      fieldKey: 'competitor_metrics.kao_corporation.semrush_traffic_authority',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      sourceUrl: marketReferenceTrafficSources.kao.sourceUrl,
      recommendedAction: expect.stringContaining('directional market-interest evidence'),
    }))
    const traffic = update?.traffic as Record<string, unknown> | undefined
    expect(traffic).toEqual(expect.objectContaining({
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      riskReason: expect.stringContaining('third-party estimate'),
    }))
    expect(String(traffic?.value || '')).toContain('1.17M visits')
    expect(String(traffic?.value || '')).toContain('decreased by -6.34%')
    expect(update?.rating).toEqual(expect.objectContaining({
      value: expect.stringContaining('Authority Score: 60'),
      riskReason: expect.stringContaining('not a product/customer rating'),
    }))
    expect(update?.pricingEvidence).toBeUndefined()
    expect(update?.marketShare).toBeUndefined()
    expect(update?.revenue).toBeUndefined()
    expect(marketReferenceTrafficPageToCompetitorUpdate(
      marketReferenceTrafficSources.kao,
      '<title>We got lost</title><p>No traffic report.</p>',
      '2026-06-06',
    )).toBeNull()
  })

  it('converts Tranco rank payloads into source-backed competitor traffic-rank signals only', () => {
    const update = trancoRanksPayloadToCompetitorUpdate(
      {
        companyName: 'BASF',
        fieldKeySlug: 'basf',
        countryRegion: 'Germany / global',
        domain: 'basf.com',
      },
      {
        ranks: [
          { date: '2026-06-04', rank: 6273 },
          { date: '2026-06-05', rank: 6266 },
        ],
      },
      '2026-06-06',
    )

    expect(update).toEqual(expect.objectContaining({
      companyName: 'BASF',
      fieldKey: 'competitor_metrics.basf.tranco_traffic_rank',
      value: expect.stringContaining('Tranco daily traffic-rank signal: #6,266'),
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      sourceUrl: 'https://tranco-list.eu/api/ranks/domain/basf.com',
      recommendedAction: expect.stringContaining('web-presence rank'),
    }))
    expect(update?.traffic).toEqual(expect.objectContaining({
      value: expect.stringContaining('not monthly visit volume'),
      sourceTitle: 'Tranco daily domain rank - basf.com',
      sourceTier: 'Tier 4 - Reputable web ranking reference',
      sourceDate: '2026-06-05',
      confidence: 'high',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
    }))
    expect(update?.pricingEvidence).toBeUndefined()
    expect(update?.marketShare).toBeUndefined()
    expect(update?.revenue).toBeUndefined()
    expect(trancoRanksPayloadToCompetitorUpdate(
      {
        companyName: 'BASF',
        fieldKeySlug: 'basf',
        countryRegion: 'Germany / global',
        domain: 'basf.com',
      },
      { ranks: [{ date: 'not-a-date', rank: 'nope' }] },
      '2026-06-06',
    )).toBeNull()
  })

  it('converts official supplier product pages into review-gated supplier evidence without prices or scores', () => {
    const wilmar = officialSupplierEvidencePageToUpdate(
      officialSupplierSources.wilmar,
      '<h1>RUBBER GRADE STEARIC ACID 1807</h1><p>Wilfarin fatty acids are derived from palm oil and palm kernel oil.</p>',
      '2026-06-06',
    )
    const basf = officialSupplierEvidencePageToUpdate(
      officialSupplierSources.basf,
      '<h1>Triethanolamine | CAS No. 102-71-6</h1><p>TEOA forms quat salts with fatty acids which then find application in fabric softener formulations.</p>',
      '2026-06-06',
    )

    expect(wilmar).toEqual(expect.objectContaining({
      fieldKey: 'supplier_scorecards.wilmar_stearic_acid.official_product_evidence',
      supplier: 'Wilmar Oleochemicals',
      material: expect.stringContaining('stearic'),
      evidenceStatus: 'Source-backed',
      reviewRequired: true,
      dataType: 'document_evidence',
      sourceUrl: officialSupplierSources.wilmar.sourceUrl,
      value: expect.stringContaining('Official Wilmar product page confirms'),
    }))
    expect(basf).toEqual(expect.objectContaining({
      supplier: 'BASF',
      material: 'Triethanolamine / TEOA',
      value: expect.stringContaining('CAS No. 102-71-6'),
      sourceUrl: officialSupplierSources.basf.sourceUrl,
    }))
    expect(wilmar?.pricingEvidence).toBeUndefined()
    expect(wilmar?.marketShare).toBeUndefined()
    expect(wilmar?.revenue).toBeUndefined()
  })

  it('rejects official supplier evidence pages when required product terms are missing', () => {
    expect(officialSupplierEvidencePageToUpdate(
      officialSupplierSources.basf,
      '<h1>General BASF page</h1><p>No product-specific TEA sourcing evidence.</p>',
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
    expect(prompt).toContain('Investment / IRR')
    expect(prompt).toContain('Total investment')
    expect(prompt).toContain('Base scenario')
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

  it('starts missing coverage follow-up even when no new autopilot output file is ready', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    await ensureFullDashboardAutopilotScheduled('default')
    const intelligenceDir = join(hermesHome, 'dashboard-intelligence')
    mkdirSync(intelligenceDir, { recursive: true })
    writeFileSync(join(intelligenceDir, 'state.json'), JSON.stringify({
      version: 1,
      profile: 'default',
      state: {
        marketClaims: [{
          id: 'market-claim-official-proxy',
          label: 'Country-wise consumption growth - China',
          value: 'Trade proxy signal found',
          source: {
            title: 'WITS / World Bank Comtrade',
            url: 'https://wits.worldbank.org/',
            date: '2026-06-06',
          },
          sourceTier: 'tier1-official',
          confidence: 'high',
          evidenceStatus: 'Official Data',
          reviewRequired: false,
        }],
        competitors: [{
          id: 'competitor-evonik',
          companyName: 'Evonik Industries',
          revenue: {
            value: 'FY2025 company-wide sales source-backed',
            sourceTitle: 'Evonik 2025 results release',
            sourceUrl: 'https://www.evonik.com/en/news/press-releases/2026/03/Q4-reporting-2025.html',
            confidence: 'high',
            evidenceStatus: 'Official Company Evidence',
            lastChecked: '2026-06-06',
          },
          evidenceStatus: 'Official Company Evidence',
        }],
        dataRoomSources: [],
        researchFindings: [],
        financialModels: [],
        presentationMaterials: [],
        researchJobs: [{
          id: 'job-full-dashboard-record',
          title: 'Full Dashboard Trusted Source Autopilot',
          question: 'Refresh the full feasibility dashboard with trusted source evidence.',
          status: 'Scheduled Hermes Job',
          scheduledJobId: 'job-full-dashboard',
          sourceRequirements: 'Official-first trusted source dashboard refresh.',
        }],
      },
      savedAt: '2026-06-06T00:00:00.000Z',
      savedBy: { username: 'test', role: 'system' },
    }, null, 2))

    execFileMock.mockReset()
    execFileMock.mockImplementation((_bin, args: string[], _opts, cb) => {
      if (args[1] === 'create') {
        writeMissingCoverageJob(hermesHome, 'job-missing-coverage-1', String(args[args.length - 1] || ''))
      }
      cb(null, '', '')
    })

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialRecognitionConnectors: false,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: false,
      includeMarketReferenceConnectors: false,
      includeMarketReferenceTrafficConnectors: false,
    })

    expect(result).toMatchObject({
      importedRuns: 0,
      filesChecked: 0,
      missingCoverageFollowUpStarted: true,
    })
    const createArgs = execFileMock.mock.calls.find(call => (call[1] as string[])[1] === 'create')?.[1] as string[]
    expect(createArgs).toBeTruthy()
    const prompt = createArgs[createArgs.length - 1]
    expect(prompt).toContain('Do the online research yourself')
    expect(prompt).toContain('Competitor Metric Columns')
    expect(prompt).toContain('Investment / IRR')
    expect(prompt).toContain('Total investment')
    expect(prompt).toContain('Evonik Industries - Price evidence')
    expect(prompt).toContain('Evonik Industries - Market share')
    expect(prompt).toContain('official annual reports')
    expect(prompt).toContain('companyName must be the actual company only')

    const envelope = await readDashboardIntelligenceState('default')
    expect(envelope?.state.researchJobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
        status: 'Scheduled Hermes Job',
        scheduledJobId: 'job-missing-coverage-1',
        scope: expect.stringContaining('Investment / IRR'),
        sourceRequirements: expect.stringContaining('Missing coverage signature:'),
      }),
    ]))
    expect(execFileMock.mock.calls.some(call => (call[1] as string[]).join(' ') === 'cron run job-missing-coverage-1')).toBe(true)
  })

  it('reuses a stale missing coverage follow-up job instead of creating duplicates', async () => {
    writeFullDashboardJob(hermesHome, 'job-full-dashboard')
    await ensureFullDashboardAutopilotScheduled('default')
    writeMissingCoverageJob(hermesHome, 'job-missing-coverage-stale', [
      FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
      'Missing coverage signature: stale-old-signature',
      'Old missing coverage prompt.',
    ].join('\n'))
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

    execFileMock.mockReset()
    execFileMock.mockImplementation((_bin, _args: string[], _opts, cb) => {
      cb(null, '', '')
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')

    expect(result.missingCoverageFollowUpStarted).toBe(true)
    expect(execFileMock.mock.calls.some(call => (call[1] as string[])[1] === 'create')).toBe(false)
    expect(execFileMock.mock.calls.some(call => (call[1] as string[]).join(' ').startsWith('cron edit job-missing-coverage-stale'))).toBe(true)
    expect(execFileMock.mock.calls.some(call => (call[1] as string[]).join(' ') === 'cron run job-missing-coverage-stale')).toBe(true)

    const envelope = await readDashboardIntelligenceState('default')
    expect(envelope?.state.researchJobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
        scheduledJobId: 'job-missing-coverage-stale',
        sourceRequirements: expect.stringContaining('Missing coverage signature:'),
      }),
    ]))
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

  it('hydrates review-gated company-specific market-reference share without verifying it', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-06T00-02-12.000000+00-00.md', {
      dashboard_updates: {
        competitorRecords: [{
          fieldKey: 'competitor_metrics.stepan_company.market_share',
          companyName: 'Stepan Company',
          countryRegion: 'United States / global',
          productEquivalent: 'Global esterquat producer context; textile-softener and Chemicon-equivalent product relevance still requires separate product/TDS evidence.',
          marketShare: {
            fieldKey: 'competitor_metrics.stepan_company.market_share',
            value: '19% global esterquat share (market-reference estimate; not textile-softener-specific).',
            sourceTitle: '360 Research Reports - Esterquat Market',
            sourceUrl: 'https://www.360researchreports.com/market-reports/esterquat-market-204218',
            sourceTier: 'Tier 4 - Paid/reputable market reference',
            lastChecked: '2026-06-06T00:00:00.000Z',
            sourceDate: '23 February 2026',
            confidence: 'medium',
            evidenceStatus: 'Market Reference',
            reviewRequired: true,
            dataType: 'competitor_data',
            riskReason: 'Company-specific market-reference estimate; not official and not textile-softener-specific.',
          },
          sourceTitle: '360 Research Reports - Esterquat Market',
          sourceUrl: 'https://www.360researchreports.com/market-reports/esterquat-market-204218',
          sourceTier: 'Tier 4 - Paid/reputable market reference',
          confidence: 'medium',
          evidenceStatus: 'Market Reference',
          reviewRequired: true,
          recommendedAction: 'Use only as review-gated market-reference context until an owner approves methodology and product scope.',
        }],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default')
    const envelope = await readDashboardIntelligenceState('default')

    expect(result.importedRuns).toBe(1)
    expect(result.stagedReviewCount).toBeGreaterThanOrEqual(1)
    expect(envelope?.state.competitors).toEqual([
      expect.objectContaining({
        companyName: 'Stepan Company',
        marketShare: '19% global esterquat share (market-reference estimate; not textile-softener-specific).',
        evidenceStatus: 'Market Reference',
        reviewRequired: true,
        metricEvidence: expect.objectContaining({
          marketShare: expect.objectContaining({
            value: '19% global esterquat share (market-reference estimate; not textile-softener-specific).',
            evidenceStatus: 'Market Reference',
            reviewRequired: true,
            source: expect.objectContaining({
              title: '360 Research Reports - Esterquat Market',
              url: 'https://www.360researchreports.com/market-reports/esterquat-market-204218',
            }),
          }),
        }),
      }),
    ])
    expect(envelope?.state.competitors[0].evidenceStatus).not.toBe('Verified')
    expect(envelope?.state.researchFindings).toEqual([
      expect.objectContaining({
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          companyName: 'Stepan Company',
          marketShare: '19% global esterquat share (market-reference estimate; not textile-softener-specific).',
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
        : url.includes('0000080424')
          ? companyfactsPayload('PROCTER & GAMBLE Co', 'SalesRevenueNet', [
            { year: 2024, value: 84039000000, filed: '2024-08-06', accession: '0000080424-24-000081' },
            { year: 2025, value: 84063000000, filed: '2025-08-05', accession: '0000080424-25-000079' },
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
      includeOfficialRecognitionConnectors: false,
      includeOfficialSupplierConnectors: false,
      includePublicPriceEvidenceConnectors: false,
      includeOfficialTradeConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 3,
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
      expect.objectContaining({
        companyName: 'Procter & Gamble',
        revenue: expect.stringContaining('FY2025 company-wide revenue: US$84.063B'),
        yearlyGrowth: expect.stringContaining('+0.03%'),
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
      ['WACKER', '<p>WACKER’s operations are highly international. Of the Group’s €5.49 billion in sales in 2025, (2024: €5.72 billion ), 83.2 percent came from international business.</p>'],
      ['Kao', '<h3>Consolidated net sales</h3><p>1,688.6 billion yen</p><p>FY2025 ended December 31</p>'],
      ['Syensqo', '<h2>FY 2025 Highlights</h2><p>Net sales of €6.14 billion, impacted by year-on-year foreign exchange movements.</p><p>Net sales 1,418 1,598 1,517-11.3%-5.6%-6.5% 6,140 6,563-6.5%-3.2%</p>'],
      ['CHT', '<p>Despite volatile global conditions, the company recorded sales growth to EUR 614.3 million (+2%) and a significant increase in EBIT.</p>'],
      ['Zschimmer', '<p>Zschimmer & Schwarz has grown strongly over the last 15 years, with turnover increasing by 500 million to almost 700 million euros.</p>'],
      ['Pulcra', '<p>Our revenue for the year decreased by EUR 11.4 million (14.6%) to EUR 66.9 million (previous year: EUR 78.3 million).</p>'],
      ['AkzoNobel', '<p>Summary of financial results Revenue 2,613 2,386 (9%) Operating income 192 177 (8%)</p>'],
    ])
    const fetchMock = vi.fn(async (url: string) => {
      const key = Array.from(htmlByCompany.keys()).find(company => url.includes(company.toLowerCase().split(' ')[0]) || (company === 'WACKER' && url.includes('wacker')) || (company === 'CHT' && url.includes('cht.com')))
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
      includeOfficialRecognitionConnectors: false,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(9)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 9,
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
        companyName: 'AkzoNobel',
        revenue: 'Q1 2026 company-wide revenue: €2.386B (official reported €2,386 million)',
        yearlyGrowth: 'Q1 2026 company-wide revenue YoY: -9% vs Q1 2025 €2.613B',
        evidenceStatus: 'Official Data',
        reviewRequired: false,
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
      expect.objectContaining({
        companyName: 'Syensqo / Solvay',
        revenue: 'FY2025 company-wide net sales: €6.14B',
        yearlyGrowth: expect.stringContaining('-6.5%'),
      }),
      expect.objectContaining({
        companyName: 'CHT Group',
        revenue: 'FY2024 company-wide sales: €614.3M (official preliminary figure)',
        yearlyGrowth: expect.stringContaining('+2%'),
      }),
      expect.objectContaining({
        companyName: 'Zschimmer & Schwarz',
        revenue: expect.stringContaining('turnover almost €700M'),
        yearlyGrowth: '',
      }),
      expect.objectContaining({
        companyName: 'Pulcra Chemicals',
        revenue: 'FY2023 Pulcra Germany GmbH net revenue: €66.9M (CSRD statement; previous year €78.3M)',
        yearlyGrowth: expect.stringContaining('-14.6%'),
      }),
    ]))
  })

  it('hydrates official competitor product evidence when no Hermes output file is ready', async () => {
    writeFullDashboardJob(hermesHome)
    const htmlByProduct = new Map([
      ['STEPANTEXSP90', '<title>STEPANTEX® SP-90</title><meta name="description" content="STEPANTEX® SP-90"/>'],
      ['wacker-finish-wr-1200', '<h1>WACKER® FINISH WR 1200</h1><p>Reactive aminoethyl-aminopropyl functional polydimethylsiloxane.</p>'],
      ['tetranyl-l9-90', '<h1>TETRANYL L9-90</h1><p>Esterquat based on European Vegetable Sources for the softener market.</p>'],
      ['dowsil-2202a-textile-finish', '<h1>DOWSIL™ 2202A Textile Finish</h1><p>Water repellent finishing of fabrics with DOWSIL 2202A Textile Finish.</p>'],
      ['xiameter-ofx-8417-fluid', '<h1>XIAMETER™ OFX-8417 Fluid</h1><p>Premium amino softener suitable for formulation into microemulsion for textile softener uses.</p>'],
      ['siligen-d2w-liq-c', '<h1>SILIGEN D2W LIQ C</h1><p>Durable silicone softener engineered for cotton with a cross-linkable emulsion.</p>'],
      ['li_tubingal-gep-textile-softener', '<h1>TUBINGAL GEP</h1><p>Innovative silicone-based softener for textile finishing.</p>'],
      ['pa_tubingal-rise-softener', '<h1>TUBINGAL® RISE</h1><p>First textile softener based on recycled silicones.</p>'],
      ['productinfo/index/60/155.html', '<h1>TRANSOFT FLA TF-442</h1><p>TRANSOFT FLA TF-442 is a fatty acid ester compound softener flake for textile.</p>'],
      ['technologies/rucofin', '<h1>RUCOFIN</h1><p>High-performance silicone softeners for textile applications and premium softness.</p>'],
      ['kundenloesungen/textilindustrie', '<h1>Specialty Chemicals for the Textile Industry</h1><p>Softeners brand family includes ADALIN, ADASIL, AQUASOFT, BELFASIN, BELSOFT, SETILON for textile finishing.</p>'],
      ['fibre-textile-auxiliaries/textile-auxiliaries', '<h1>TEXTILE AUXILIARIES</h1><p>SOFTENERS are essential for textile finishing, soft handle, and improved physical properties.</p>'],
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
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(12)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 12,
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
        metricEvidence: expect.objectContaining({
          lastUpdated: expect.objectContaining({
            value: '2026-06-06',
            evidenceStatus: 'Source-backed',
            reviewRequired: false,
          }),
        }),
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
        productVariations: expect.stringContaining('TUBINGAL GEP'),
        productEquivalent: expect.stringContaining('TUBINGAL RISE'),
        activeContent: expect.stringContaining('recycled'),
        sourceCount: 2,
      }),
      expect.objectContaining({
        companyName: 'Dow',
        productVariations: expect.stringContaining('DOWSIL 2202A'),
        productEquivalent: expect.stringContaining('XIAMETER OFX-8417'),
        activeContent: expect.stringContaining('Premium amino softener'),
        sourceCount: 2,
      }),
      expect.objectContaining({
        companyName: 'Transfar',
        productEquivalent: expect.stringContaining('TRANSOFT FLA TF-442'),
        activeContent: expect.stringContaining('Fatty acid ester'),
      }),
      expect.objectContaining({
        companyName: 'Rudolf Group',
        productEquivalent: expect.stringContaining('RUCOFIN'),
        activeContent: expect.stringContaining('Polysiloxane'),
        pricingEvidence: '',
        marketShare: '',
        revenue: '',
      }),
      expect.objectContaining({
        companyName: 'Pulcra Chemicals',
        productEquivalent: expect.stringContaining('ADALIN'),
        activeContent: expect.stringContaining('Textile finishing softeners'),
        pricingEvidence: '',
        marketShare: '',
        revenue: '',
      }),
      expect.objectContaining({
        companyName: 'Zschimmer & Schwarz',
        productEquivalent: expect.stringContaining('Textile softeners'),
        activeContent: expect.stringContaining('Fatty acid condensate softeners'),
        pricingEvidence: '',
        marketShare: '',
        revenue: '',
      }),
    ]))
  })

  it('hydrates official competitor recognition evidence into the rating column when no Hermes output file is ready', async () => {
    writeFullDashboardJob(hermesHome)
    const htmlByRecognition = new Map([
      ['CDP-otorga-a-BASF-el-estatus-de-liderazgo', '<h1>CDP otorga a BASF el estatus de liderazgo</h1><p>BASF recibió la calificación “A” en las categorías de protección del clima y protección de los bosques, y la calificación “A-” en seguridad hídrica. Esto significa que BASF alcanzó el estatus de liderazgo en las tres categorías.</p>'],
      ['2025-goals.html', '<h1>Dow 2025 Sustainability Goals</h1><p>Dow aligned >89% of innovation portfolio to sustainability outcomes. Record-setting twelve Edison awards were earned in 2024.</p>'],
      ['ecovadis-ranks-evonik', '<h1>EcoVadis ranks Evonik among the world’s most sustainable companies</h1><p>This year, sustainability rating agency EcoVadis has awarded Evonik a Gold rating and says it ranks among the top five percent of companies assessed worldwide.</p>'],
      ['Stepan-Achieves-Silver-Medal-in-2026-EcoVadis-Assessment', '<h1>Stepan Achieves a Silver Medal in 2026 EcoVadis Assessment</h1><p>Stepan achieved a Silver medal, placing the company in the top 15% globally and in the 89th percentile among manufacturers of chemical products.</p>'],
      ['20250613-002', '<h1>Kao Releases Kao Sustainability Report 2025</h1><p>Kao was one of eight companies to achieve the CDP Triple-A rating and was selected as one of the World’s Most Ethical Companies 2025.</p>'],
      ['archroma-recognized-as-top-chemicals-supplier', '<h1>Archroma recognized as top chemicals supplier</h1><p>Archroma has been awarded Champion status at the 2025 adiFormulator Award by adidas.</p>'],
      ['archroma.com/sustainability', '<h1>Sustainability</h1><p>Archroma was awarded the EcoVadis Gold rating in 2025 and is within the top 5% in its industry.</p>'],
      ['adiformulator-award-2025', '<h1>adiFORMULATOR AWARD 2025</h1><p>For the third time in a row, the CHT Group has been recognized as champion of the adiFORMULATOR AWARD by adidas.</p>'],
      ['upstream-value-chain.html', '<h1>Upstream Value Chain</h1><p>The average EcoVadis score across all WACKER suppliers was 62 points.</p>'],
      ['energy-use-and-renewable-electricity', '<h1>Energy use and renewable electricity</h1><p>Our progress (2025): CDP A score, 69% renewable electricity in our own operations, and 84 locations are using 100% renewable electricity.</p>'],
      ['pulcra-chemicals-awarded-ecovadis-silver-medal', '<h1>Pulcra Chemicals Awarded EcoVadis Silver Medal</h1><p>Pulcra Chemicals has been awarded the EcoVadis Silver Medal, achieving a percentile rank of 92% and placing among the top 8% of chemical companies evaluated by EcoVadis.</p>'],
      ['pg-awards-and-recognitions', '<h1>P&G Awards and Recognitions</h1><p>P&G was recognized as one of Barron’s 100 Most Sustainable Companies, earning the #21 ranking in 2025. The 2024 Advantage Report Global Scorecard ranked P&G the #1 manufacturer for the 10th consecutive year.</p>'],
      ['rudolf-pcf-program-certified-under-pact-and-aligned-with-tfs', '<h1>RUDOLF PCF Program certified under PACT and aligned with TfS</h1><p>RUDOLF has received one of the first Product Carbon Footprint (PCF) Program certifications from TÜV SÜD based on the PACT Methodology V3 and aligned with TfS PCF Guideline V3.</p>'],
      ['supporting-key-sustainability-goals-in-chinas-textile-industry-at-ciie', '<h1>Supporting Key Sustainability Goals in China’s Textile Industry at CIIE</h1><p>SGS presented the first SGS green mark bio-based content certificate for a polyester FDY oil product in China to Transfar, along with several ZDHC MRSL Level 3 certifications.</p>'],
      ['outstanding-sustainability-zsl-awarded-silver-by-ecovadis', '<h1>Outstanding sustainability: ZSL awarded Silver by EcoVadis</h1><p>ZSL was awarded Silver by EcoVadis, placing it among the top 15 % of companies assessed worldwide last year.</p>'],
    ])
    const fetchMock = vi.fn(async (url: string) => {
      const key = Array.from(htmlByRecognition.keys()).find(fragment => url.includes(fragment))
      return {
        ok: Boolean(key),
        status: key ? 200 : 404,
        text: async () => htmlByRecognition.get(key || '') || '',
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialRecognitionConnectors: true,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(15)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 15,
      stagedReviewCount: 5,
    })
    expect(envelope?.state.competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'BASF',
        rating: expect.stringContaining('CDP leadership'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
        evidenceStatus: 'Official Data',
      }),
      expect.objectContaining({
        companyName: 'Dow',
        rating: expect.stringContaining('89%'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
        evidenceStatus: 'Official Data',
      }),
      expect.objectContaining({
        companyName: 'Evonik Industries',
        rating: expect.stringContaining('EcoVadis Gold'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
        evidenceStatus: 'Official Data',
      }),
      expect.objectContaining({
        companyName: 'Stepan Company',
        rating: expect.stringContaining('89th percentile'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
        evidenceStatus: 'Official Data',
      }),
      expect.objectContaining({
        companyName: 'Kao Corporation',
        rating: expect.stringContaining('Triple-A'),
        pricingEvidence: '',
        marketShare: '',
      }),
      expect.objectContaining({
        companyName: 'Archroma',
        rating: expect.stringContaining('EcoVadis Gold'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
        evidenceStatus: 'Official Data',
        sourceTier: 'tier2-company-official',
        reviewRequired: false,
        riskReason: expect.stringContaining('customer rating'),
      }),
      expect.objectContaining({
        companyName: 'CHT Group',
        rating: expect.stringContaining('third time in a row'),
        evidenceStatus: 'Official Data',
        source: expect.objectContaining({
          title: 'CHT Group adiFORMULATOR AWARD 2025',
        }),
      }),
      expect.objectContaining({
        companyName: 'WACKER',
        rating: expect.stringContaining('62 points'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
      }),
      expect.objectContaining({
        companyName: 'AkzoNobel',
        rating: expect.stringContaining('CDP A score'),
        pricingEvidence: '',
        marketShare: '',
        evidenceStatus: 'Official Data',
      }),
      expect.objectContaining({
        companyName: 'Pulcra Chemicals',
        rating: expect.stringContaining('92nd percentile'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
      }),
      expect.objectContaining({
        companyName: 'Procter & Gamble',
        rating: expect.stringContaining('#21'),
        pricingEvidence: '',
        marketShare: '',
        evidenceStatus: 'Official Data',
      }),
      expect.objectContaining({
        companyName: 'Rudolf Group',
        rating: expect.stringContaining('PCF Program certification'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
        evidenceStatus: 'Official Data',
      }),
      expect.objectContaining({
        companyName: 'Transfar',
        rating: expect.stringContaining('SGS Green Mark'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
        evidenceStatus: 'Official Data',
      }),
      expect.objectContaining({
        companyName: 'Zschimmer & Schwarz',
        rating: expect.stringContaining('top 15%'),
        pricingEvidence: '',
        marketShare: '',
        traffic: '',
      }),
    ]))
  })

  it('merges competitor company evidence into one row with product-wise variations and source list', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-06T03-00-00.000000+00-00.md', {
      dashboard_updates: {
        competitorRecords: [
          {
            fieldKey: 'competitor_products.stepan.stepantex-sp-90',
            companyName: 'Stepan Company',
            countryRegion: 'United States',
            productEquivalent: 'STEPANTEX SP-90 esterquat softener candidate / STEPANTEX SP-90 esterquat softener candidate / automated SSL verification failed',
            activeContent: 'Esterquat product identity from official product page',
            value: 'Official Stepan product page confirms STEPANTEX SP-90 product identity.',
            sourceTitle: 'Stepan STEPANTEX SP-90 official product page',
            sourceUrl: 'https://www.stepan.com/content/stepan-dot-com/en/products-and-markets/product/STEPANTEXSP90.html',
            sourceTier: 'Tier 2 - Official company / product source',
            sourceDate: '2026-06-06',
            confidence: 'high',
            evidenceStatus: 'Source-backed',
            reviewRequired: false,
          },
          {
            fieldKey: 'competitor_products.stepan.accosoft-501',
            companyName: 'Stepan Company',
            countryRegion: 'United States',
            productEquivalent: 'ACCOSOFT 501 fabric softener candidate',
            activeContent: 'Fabric softener product identity from official Stepan product page',
            value: 'Official Stepan product page confirms ACCOSOFT 501 product identity.',
            sourceTitle: 'Stepan ACCOSOFT 501 official product page',
            sourceUrl: 'https://www.stepan.com/content/stepan-dot-com/en/products-and-markets/product/ACCOSOFT501.html',
            sourceTier: 'Tier 2 - Official company / product source',
            sourceDate: '2026-06-06',
            confidence: 'high',
            evidenceStatus: 'Source-backed',
            reviewRequired: false,
          },
          {
            fieldKey: 'competitor_metrics.stepan_company.official_financials',
            companyName: 'Stepan Company',
            countryRegion: 'United States',
            productEquivalent: 'Company-wide financial context; not textile-softener product-line revenue.',
            value: 'FY2025 company-wide revenue: US$2.332B',
            revenue: 'FY2025 company-wide revenue: US$2.332B',
            yearlyGrowth: 'FY2025 company-wide revenue YoY: +6.96%',
            sourceTitle: 'SEC Companyfacts: STEPAN COMPANY RevenueFromContractWithCustomerExcludingAssessedTax',
            sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000094049.json',
            sourceTier: 'Tier 1 - Official filing / statistical source',
            sourceDate: '2026-06-06',
            confidence: 'high',
            evidenceStatus: 'Official Data',
            reviewRequired: false,
          },
        ],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')
    const competitors = envelope?.state.competitors || []

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 3,
      stagedReviewCount: 0,
    })
    expect(competitors).toHaveLength(1)
    expect(competitors[0]).toEqual(expect.objectContaining({
      companyName: 'Stepan Company',
      productEquivalent: expect.stringContaining('STEPANTEX SP-90'),
      productVariations: expect.stringContaining('ACCOSOFT 501'),
      revenue: expect.stringContaining('US$2.332B'),
      yearlyGrowth: expect.stringContaining('+6.96%'),
      sourceCount: 3,
      evidenceStatus: 'Official Data',
    }))
    expect(String(competitors[0].productEquivalent)).not.toContain('Company-wide financial context')
    expect(String(competitors[0].productVariations)).not.toMatch(/automated SSL/i)
    expect(String(competitors[0].productVariations).match(/STEPANTEX SP-90/g)).toHaveLength(1)
    expect(competitors[0].sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Stepan STEPANTEX SP-90 official product page' }),
      expect.objectContaining({ title: 'Stepan ACCOSOFT 501 official product page' }),
      expect.objectContaining({ title: expect.stringContaining('SEC Companyfacts') }),
    ]))
  })

  it('hydrates official supplier evidence as review-gated data room candidates when no Hermes output file is ready', async () => {
    writeFullDashboardJob(hermesHome)
    const htmlBySupplier = new Map([
      ['rubber-grade-stearic-acid-1807', '<h1>RUBBER GRADE STEARIC ACID 1807</h1><p>Wilfarin fatty acids are derived from palm oil and palm kernel oil.</p>'],
      ['products-banner', '<title>Products - KLK OLEO</title><p>Products include Fatty Acids, Fatty Alcohols, Glycerine, and Oleo Basics.</p>'],
      ['triethanolamine', '<h1>Triethanolamine | CAS No. 102-71-6</h1><p>TEOA forms quat salts with fatty acids which then find application in fabric softener formulations.</p>'],
      ['wacker-finish-wr-1200', '<h1>WACKER FINISH WR 1200</h1><p>Functional silicone fluid; reactive aminoethyl-aminopropyl functional polydimethylsiloxane.</p>'],
    ])
    const fetchMock = vi.fn(async (url: string) => {
      const key = Array.from(htmlBySupplier.keys()).find(fragment => url.includes(fragment))
      return {
        ok: Boolean(key),
        status: key ? 200 : 404,
        text: async () => htmlBySupplier.get(key || '') || '',
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialSupplierConnectors: true,
      includeOfficialTradeConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 0,
      stagedReviewCount: 4,
    })
    expect(envelope?.state.dataRoomSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dashboardGroup: 'supplierScorecards',
        supplier: 'Wilmar Oleochemicals',
        material: expect.stringMatching(/stearic/i),
        proposedValue: expect.stringContaining('Official Wilmar product page confirms'),
        evidenceStatus: 'Source-backed',
        reviewRequired: true,
        dataType: 'document_evidence',
        source: expect.objectContaining({
          title: 'Wilmar Rubber Grade Stearic Acid 1807 official product page',
          url: officialSupplierSources.wilmar.sourceUrl,
        }),
      }),
      expect.objectContaining({
        dashboardGroup: 'supplierScorecards',
        supplier: 'BASF',
        material: 'Triethanolamine / TEOA',
        proposedValue: expect.stringContaining('fabric softener formulations'),
      }),
    ]))
    expect(envelope?.state.supplierScorecards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dashboardGroup: 'supplierScorecards',
        supplier: 'Wilmar Oleochemicals',
        material: expect.stringMatching(/stearic/i),
        value: expect.stringContaining('Official Wilmar product page confirms'),
        pricePerTon: '',
        quality: 'Quote/TDS/SDS/COA review needed',
        reliability: 'Quote/TDS/SDS/COA review needed',
        payment: 'Quote/payment terms needed',
        score: 'Review needed',
        reviewRequired: true,
        dataType: 'document_evidence',
        source: expect.objectContaining({
          title: 'Wilmar Rubber Grade Stearic Acid 1807 official product page',
          url: officialSupplierSources.wilmar.sourceUrl,
        }),
      }),
      expect.objectContaining({
        dashboardGroup: 'supplierScorecards',
        supplier: 'BASF',
        material: 'Triethanolamine / TEOA',
        value: expect.stringContaining('fabric softener formulations'),
        pricePerTon: '',
      }),
    ]))
    expect(envelope?.state.dataRoomSources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        proposedValue: expect.stringMatching(/(?:\\$|usd|cny|rmb)\\s*\\d/i),
      }),
    ]))
    expect(envelope?.state.supplierScorecards).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        pricePerTon: expect.stringMatching(/(?:\\$|usd|cny|rmb)\\s*\\d/i),
      }),
    ]))
    expect(envelope?.state.researchFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dashboardGroup: 'supplierScorecards',
        keyClaim: expect.stringContaining('Wilmar Oleochemicals'),
        status: 'Pending Review',
      }),
    ]))
  })

  it('hydrates official raw-material identity evidence as review-gated dashboard signals', async () => {
    writeFullDashboardJob(hermesHome)
    writeRunOutput(hermesHome, 'job-full-dashboard', '2026-06-03T09-00-00.000000+00-00.md', {
      dashboard_updates: {
        rawMaterialSignals: [
          {
            fieldKey: 'raw.dms.cas',
            proposedDashboardField: 'DMS chemical identity',
            field: 'DMS CAS evidence',
            value: 'PubChem CID 6497; CAS signal 77-78-1; molecular formula C2H6O4S',
            sourceTitle: 'Dimethyl Sulfate | (CH3O)2SO2 | CID 6497 - PubChem',
            sourceUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/Dimethyl-sulfate',
            sourceTier: 'Tier 1 - Official / regulator / chemical database source',
            confidence: 'high',
            evidenceStatus: 'Official Data',
            dataType: 'regulatory_data',
            reviewRequired: true,
          },
          {
            fieldKey: 'raw.tea.cas',
            proposedDashboardField: 'TEA chemical identity',
            field: 'TEA CAS evidence',
            value: 'PubChem CID 7618; CAS signal 102-71-6; molecular formula C6H15NO3',
            sourceTitle: 'Triethanolamine | C6H15NO3 | CID 7618 - PubChem',
            sourceUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/Triethanolamine',
            sourceTier: 'Tier 1 - Official / regulator / chemical database source',
            confidence: 'high',
            evidenceStatus: 'Official Data',
            dataType: 'regulatory_data',
            reviewRequired: true,
          },
        ],
      },
    })

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: false,
      includeMarketReferenceConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(result).toMatchObject({
      importedRuns: 1,
      autoFilledCount: 0,
      stagedReviewCount: 2,
    })
    expect(envelope?.state.rawMaterialSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dashboardGroup: 'rawMaterialSignals',
        material: 'DMS / dimethyl sulfate',
        value: expect.stringContaining('PubChem CID 6497'),
        cas: '77-78-1',
        formula: 'C2H6O4S',
        pricePerTon: '',
        priceStatus: 'No approved price yet',
        dataType: 'regulatory_data',
        reviewRequired: true,
        source: expect.objectContaining({
          title: expect.stringContaining('Dimethyl Sulfate'),
          url: 'https://pubchem.ncbi.nlm.nih.gov/compound/Dimethyl-sulfate',
        }),
      }),
      expect.objectContaining({
        dashboardGroup: 'rawMaterialSignals',
        material: 'TEA',
        cas: '102-71-6',
        formula: 'C6H15NO3',
        pricePerTon: '',
      }),
    ]))
    expect(envelope?.state.rawMaterialSignals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        pricePerTon: expect.stringMatching(/(?:\$|usd|cny|rmb)\s*\d/i),
      }),
    ]))
    expect(envelope?.state.dataRoomSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dashboardGroup: 'rawMaterialSignals',
        proposedValue: expect.stringContaining('PubChem CID 6497'),
        reviewRequired: true,
      }),
    ]))
  })

  it('hydrates official UN Comtrade country import proxies when no Hermes output file is ready', async () => {
    writeFullDashboardJob(hermesHome)
    process.env.UN_COMTRADE_SUBSCRIPTION_KEY = 'test-comtrade-key'
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
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: true,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(String(fetchMock.mock.calls[0][0])).toContain('subscription-key=test-comtrade-key')
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
    expect(envelope?.state.marketClaims.every(claim =>
      !String((claim.source as Record<string, unknown> | undefined)?.url || '').includes('subscription-key='),
    )).toBe(true)
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

  it('does not call official UN Comtrade without a configured subscription key', async () => {
    writeFullDashboardJob(hermesHome)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: true,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.autoFilledCount).toBe(0)
    expect(result.stagedReviewCount).toBe(0)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('official Comtrade connector: subscription key not configured'),
    ]))
    expect(envelope?.state.marketClaims || []).toHaveLength(0)
  })

  it('falls back to the latest usable two-year UN Comtrade period when newer annual data is incomplete', async () => {
    writeFullDashboardJob(hermesHome)
    process.env.UN_COMTRADE_SUBSCRIPTION_KEY = 'test-comtrade-key'
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes('period=2023,2024')
        ? comtradePayload([
          { year: 2023, primaryValue: 195169270, netWeightKg: 51660671.263 },
          { year: 2024, primaryValue: 236608417, netWeightKg: 65408986.289 },
        ])
        : comtradePayload([
          { year: 2024, primaryValue: 236608417, netWeightKg: 65408986.289 },
        ]),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: true,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock.mock.calls.length).toBeGreaterThan(10)
    expect(fetchMock.mock.calls.every(call => String(call[0]).includes('subscription-key=test-comtrade-key'))).toBe(true)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 0,
      stagedReviewCount: 10,
    })
    expect(envelope?.state.marketClaims).toHaveLength(10)
    expect(envelope?.state.marketClaims.every(claim =>
      String((claim.source as Record<string, unknown> | undefined)?.url || '').includes('period=2023,2024'),
    )).toBe(true)
    expect(envelope?.state.marketClaims[0]).toEqual(expect.objectContaining({
      value: expect.stringContaining('FY2024 official HS 380991 import proxy'),
      reviewRequired: true,
    }))
  })

  it('hydrates reputable market-reference claims without silently approving them', async () => {
    writeFullDashboardJob(hermesHome)
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('futuremarketinsights.com')) {
        return {
          ok: true,
          text: async () => `
            <article>
              <p>Page last updated on: October 06, 2025</p>
              <p>The esterquats market is projected to grow from USD 2.8 billion in 2025 to USD 6.8 billion by 2035, at a CAGR of 9.2%.</p>
              <p>Insights into the TEA-Quats Product Type Segment The TEA-quats segment is projected to hold 42.9% of the esterquats market revenue share in 2025.</p>
              <p>Insights into the Liquid Form Segment The liquid form segment is anticipated to account for 61.3% of the esterquats market revenue share in 2025.</p>
              <p>Analysis of Esterquats Market By Key Countries Country CAGR China 12.4% India 11.5% Germany 10.6% France 9.7% UK 8.7% USA 7.8% Brazil 6.9%.</p>
              <p>Top Key Players in Esterquats Market: ABITEC Corporation, AkzoNobel, BASF, Clariant, Evonik Industries, Kao Corporation, Stepan Company, Solvay Esterquats Market Key Takeaways</p>
            </article>
          `,
        }
      }
      if (url.includes('persistencemarketresearch.com')) {
        return {
          ok: true,
          text: async () => `
            <article>
              <p>ID: PMRREP 23521 February 2026 212 Pages</p>
              <p>The global esterquats market is projected to reach US$ 7.1 billion in 2026 and US$ 14.3 billion by 2033, growing at a CAGR of 10.5% over the forecast period.</p>
              <p>North America is likely to maintain established dominance, holding 43% share.</p>
              <p>Asia Pacific experiences the fastest regional growth at 12.4% CAGR in China and 11.5% CAGR in India.</p>
              <p>Solid and paste esterquats account for approximately 25% of market share.</p>
              <p>Tallow-based esterquats continue to dominate the market with approximately 68% share.</p>
              <p>Vegetable oil-based esterquats are steadily gaining traction and currently account for around 32% of the market.</p>
              <p>Fabric care remains the largest application segment, accounting for approximately 50% of total esterquat demand.</p>
              <p>Personal care represents the fastest-growing application area, with estimated growth of 14% CAGR.</p>
              <p>Tier 1 companies such as BASF SE, Evonik Industries AG, Stepan Company, and Kao Corporation collectively account for approximately 50-60% of global market share.</p>
              <p>Companies Covered in Esterquats Market BASF SE Evonik Industries AG Stepan Company Kao Corporation Akzo Nobel N.V. Floerger GmbH Frequently Asked Questions</p>
            </article>
          `,
        }
      }
      if (url.includes('360researchreports.com')) {
        return {
          ok: true,
          text: async () => `
            <article>
              <p>Last Updated: 23 February 2026</p>
              <p>Global Esterquat market value is expected to rise from USD 535.392 million in 2026 to approximately USD 874.1568 million by 2035, progressing at a CAGR of 5.6% between 2026 and 2035.</p>
              <p>Asia-Pacific holds 41% of global esterquat consumption at 787,200 tons, Europe holds 28%, and North America holds 19%, with these three regions jointly representing 88% of global demand. Middle East & Africa consumes 134,400 tons, contributing 7% of global esterquat demand.</p>
              <p>The Esterquat Market is segmented by type into TEAQ, DEEDMAC, HEQ, and Others, representing 48%, 32%, 14%, and 6% of global volume respectively.</p>
              <p>The top 2 manufacturers hold 33% market share collectively, while the top 5 control 57%, and the largest producer alone represents 19%, shaping a consolidated Esterquat Competitive Landscape.</p>
              <p>China leads with 326,000 tons, India with 154,000 tons, Japan with 98,100 tons, South Korea with 67,000 tons, and Indonesia with 52,400 tons.</p>
              <p>List of Top Esterquat Companies * Stepan Company * Kao Chemicals * Evonik Industries * BASF SE * Clariant Chemicals Top Two Companies with Highest Share</p>
              <p>Stepan Company: Stepan Company holds 19% global esterquat share, operates 12 production plants, and manufactures over 410,000 tons annually for household and personal care industries.</p>
              <p>Evonik Industries: Evonik Industries controls 14% global esterquat share, manages 7 advanced facilities, and supplies more than 268,000 tons yearly to global detergent and cosmetic manufacturers.</p>
            </article>
          `,
        }
      }
      if (url.includes('fortunebusinessinsights.com')) {
        return {
          ok: true,
          text: async () => `
            <article>
              <p>Last Updated: May 18, 2026</p>
              <p>The global esterquats market size was valued at USD 2.19 billion in 2025.</p>
              <p>It is projected to grow from USD 2.34 billion in 2026 to USD 4.23 billion by 2034, exhibiting a CAGR of 7.7%.</p>
              <p>North America held 40.6% share in 2025.</p>
              <p>Canada captured 5.08% of the global market share in 2025.</p>
              <p>The triethanolamine (TEA) segment accounted for 33.6% in 2025.</p>
              <p>The liquid form segment held 85.6% share in 2025.</p>
              <p>The fabric softeners segment held 55% share in 2025.</p>
              <p>List of Top Esterquats Companies AkzoNobel Procter & Gamble Kao Chemicals BASF Stepan Company Evonik Industries Market Size by Form</p>
              <p>AkzoNobel: 17% Market Share</p>
              <p>Procter & Gamble: 14% Market Share</p>
            </article>
          `,
        }
      }
      if (url.includes('spglobal.com/ratings')) {
        return {
          ok: true,
          text: async () => `
            <article>
              <p>Archroma is a Switzerland-based specialty chemicals producer for the textile, paper, and emulsions sectors.</p>
              <p>The company reported about $1.6 billion in sales in fiscal 2025, with about 48% of group revenue generated in Asia.</p>
            </article>
          `,
        }
      }
      if (url.includes('stockanalysis.com/quote/she/002010/financials/metrics')) {
        return {
          ok: true,
          text: async () => `
            <article>
              <p>Textile Printing and Dyeing Auxiliaries 7.41B 7.07B 6.25B</p>
              <p>Textile Printing and Dyeing Auxiliaries Growth 4.79% 13.07% 46.20%</p>
              <p>Total 25.08B 26.70B 33.58B</p>
              <p>Total Growth -6.05% -20.49% -9.00%</p>
              <p>Last checked: May 18, 2026</p>
            </article>
          `,
        }
      }
      return {
        ok: true,
        text: async () => `
          <article>
            <p>Last Updated: September 2024</p>
            <p>The global esterquats market size was estimated at USD 2441.03 million in 2023 and is projected to grow at a CAGR of 10.3% from 2024 to 2030.</p>
            <p>The global esterquats market is expected to grow at a compound annual growth rate of 10.3% from 2024 to 2030 to reach USD 4,836.1 million by 2030.</p>
            <p>Fabric care dominated the esterquats market with a share of 90.8% in 2023.</p>
            <p>Some key players operating in the esterquats market include Stepan Company, Kao Chemicals Europe, Evonik Industries, AkzoNobel, Chemelco International B.V., ABITEC Corporation, BASF SE, Lubrizol, Italmatch Chemicals, and Clariant Chemicals.</p>
          </article>
        `,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: false,
      includeMarketReferenceConnectors: true,
      includeMarketReferenceTrafficConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(result.importedRuns).toBe(0)
    expect(result.autoFilledCount).toBeGreaterThanOrEqual(6)
    expect(result.stagedReviewCount).toBeGreaterThanOrEqual(30)
    expect(envelope?.state.marketClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Global esterquats market size',
        value: 'USD 2.8B in 2025 (market-reference estimate)',
        evidenceStatus: 'Market Reference',
        reviewRequired: true,
        source: expect.objectContaining({
          title: 'Future Market Insights - Esterquats Market',
          url: 'https://www.futuremarketinsights.com/reports/esterquats-market',
          date: 'October 06, 2025',
        }),
      }),
      expect.objectContaining({
        label: 'Global esterquats CAGR',
        value: '9.2% CAGR from 2025 to 2035 (market-reference forecast)',
      }),
      expect.objectContaining({
        label: 'Global esterquats market size',
        value: 'US$ 7.1B in 2026 (market-reference estimate)',
        source: expect.objectContaining({
          title: 'Persistence Market Research - Esterquats Market',
          date: 'February 2026',
        }),
      }),
      expect.objectContaining({
        label: 'Esterquats fabric-care segment share',
        value: '90.8% fabric-care share in 2023 (market-reference segment estimate)',
      }),
      expect.objectContaining({
        label: 'Global esterquats market size',
        value: 'USD 2.19B in 2025 (market-reference estimate)',
        source: expect.objectContaining({
          title: 'Fortune Business Insights - Esterquats Market',
          date: 'May 18, 2026',
        }),
      }),
      expect.objectContaining({
        label: 'Fabric-softener application share',
        value: '55% fabric-softener application share in 2025 (market-reference segment estimate)',
      }),
      expect.objectContaining({
        label: 'Esterquats key competitor set',
        value: 'BASF SE Evonik Industries AG Stepan Company Kao Corporation Akzo Nobel N.V. Floerger GmbH',
        source: expect.objectContaining({
          title: 'Persistence Market Research - Esterquats Market',
        }),
      }),
      expect.objectContaining({
        label: 'Global esterquat market size',
        value: 'USD 535.392M in 2026 (market-reference estimate)',
        source: expect.objectContaining({
          title: '360 Research Reports - Esterquat Market',
          date: '23 February 2026',
        }),
      }),
      expect.objectContaining({
        label: 'Country-wise esterquat consumption - China',
        value: '326,000 tons esterquat consumption (market-reference estimate)',
      }),
    ]))
    expect(envelope?.state.marketClaims.map(claim => String(claim.value))).not.toContain(
      'Review market-reference methodology and approve only if the source is acceptable for dashboard or investor use.',
    )
    expect(envelope?.state.marketClaims.map(claim => String(claim.value)).join('\n')).not.toContain('Frequently Asked Questions Related Reports')
    expect(envelope?.state.competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'BASF',
        marketShare: 'Collective Tier-1 esterquats share 50-60%; individual company share not published by this source. Review required before ranking or investor use.',
        evidenceStatus: 'Market Reference',
        reviewRequired: true,
        source: expect.objectContaining({
          title: 'Persistence Market Research - Esterquats Market',
          url: 'https://www.persistencemarketresearch.com/market-research/esterquats-market.asp',
          date: 'February 2026',
        }),
        riskReason: expect.stringContaining('collective Tier-1 market-share range'),
      }),
      expect.objectContaining({
        companyName: 'Kao Corporation',
        marketShare: expect.stringContaining('Review required before ranking'),
        reviewRequired: true,
      }),
      expect.objectContaining({
        companyName: 'Stepan Company',
        marketShare: '19% global esterquat share (market-reference estimate; not textile-softener-specific).',
        reviewRequired: true,
        metricEvidence: expect.objectContaining({
          marketShare: expect.objectContaining({
            value: '19% global esterquat share (market-reference estimate; not textile-softener-specific).',
            evidenceStatus: 'Market Reference',
            reviewRequired: true,
          }),
        }),
      }),
      expect.objectContaining({
        companyName: 'Evonik Industries',
        marketShare: '14% global esterquat share (market-reference estimate; not textile-softener-specific).',
        reviewRequired: true,
        metricEvidence: expect.objectContaining({
          marketShare: expect.objectContaining({
            value: '14% global esterquat share (market-reference estimate; not textile-softener-specific).',
            evidenceStatus: 'Market Reference',
            reviewRequired: true,
          }),
        }),
      }),
      expect.objectContaining({
        companyName: 'AkzoNobel',
        marketShare: '17% global esterquats share (Fortune Business Insights market-reference estimate; not textile-softener-specific).',
        reviewRequired: true,
        source: expect.objectContaining({
          title: 'Fortune Business Insights - Esterquats Market',
          date: 'May 18, 2026',
        }),
        riskReason: expect.stringContaining('Tier-4 market-reference company-share estimate'),
      }),
      expect.objectContaining({
        companyName: 'Procter & Gamble',
        marketShare: '14% global esterquats share (Fortune Business Insights market-reference estimate; not textile-softener-specific).',
        reviewRequired: true,
      }),
      expect.objectContaining({
        companyName: 'Archroma',
        revenue: 'FY2025 company-wide sales: about US$1.6B (S&P Global Ratings research update)',
        evidenceStatus: 'Market Reference',
        reviewRequired: false,
      }),
      expect.objectContaining({
        companyName: 'Transfar',
        revenue: 'FY2025 company-wide revenue: CNY 25.08B (StockAnalysis / S&P Global Market Intelligence)',
        yearlyGrowth: 'FY2025 company-wide revenue YoY: -6.05%',
        productEquivalent: expect.stringContaining('Textile Printing and Dyeing Auxiliaries segment: CNY 7.41B'),
        evidenceStatus: 'Market Reference',
        reviewRequired: false,
      }),
    ]))
    expect(envelope?.state.researchFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyClaim: expect.stringContaining('Global esterquats market size'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'marketClaims',
          value: 'USD 2.8B in 2025 (market-reference estimate)',
        }),
      }),
      expect.objectContaining({
        keyClaim: expect.stringContaining('Collective Tier-1 esterquats share 50-60%'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          companyName: 'BASF',
          value: 'Collective Tier-1 esterquats share 50-60%; individual company share not published by this source. Review required before ranking or investor use.',
        }),
      }),
    ]))
    expect(envelope?.state.presentationMaterials).toEqual([])
  })

  it('hydrates market-reference traffic estimates into competitor rows without price or share claims', async () => {
    writeFullDashboardJob(hermesHome)
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('r.jina.ai') && url.includes('stepan.com')) {
        return {
          ok: true,
          text: async () => [
            'Title: stepan.com Website Traffic, Ranking, Analytics [April 2026]',
            'In April stepan.com received 412.2K visits with the average session duration 02:42. Compared to March traffic to stepan.com has increased by 4.8%.',
            '"authorityScore":[0,{"value":[0,52],"valueDiffPercent":[0,null]}]',
          ].join(' '),
        }
      }
      if (url.includes('basf.com')) {
        return {
          ok: true,
          text: async () => [
            '<title>basf.com Website Traffic, Ranking, Analytics [April 2026]</title>',
            '<p>In April basf.com received 2.8M visits with the average session duration 03:44. Compared to March traffic to basf.com has decreased by -2.1%.</p>',
            '&quot;authorityScore&quot;:[0,{&quot;value&quot;:[0,72],&quot;valueDiffPercent&quot;:[0,null]}]',
          ].join(''),
        }
      }
      if (url.includes('stepan.com')) {
        return { ok: false, status: 403, text: async () => '' }
      }
      if (url.includes('kao.com')) {
        return {
          ok: true,
          text: async () => [
            '<title>kao.com Website Traffic, Ranking, Analytics [April 2026]</title>',
            '<p>In April kao.com received 1.17M visits with the average session duration 07:12. Compared to March traffic to kao.com has decreased by -6.34%.</p>',
            '&quot;authorityScore&quot;:[0,{&quot;value&quot;:[0,60],&quot;valueDiffPercent&quot;:[0,null]}]',
          ].join(''),
        }
      }
      if (url.includes('syensqo.com')) {
        return {
          ok: true,
          text: async () => [
            '<title>syensqo.com Website Traffic, Ranking, Analytics [April 2026]</title>',
            '<p>In April syensqo.com received 87.39K visits with the average session duration 02:10. Compared to March traffic to syensqo.com has increased by 12.4%.</p>',
            '&quot;authorityScore&quot;:[0,{&quot;value&quot;:[0,37],&quot;valueDiffPercent&quot;:[0,null]}]',
          ].join(''),
        }
      }
      return { ok: false, status: 404, text: async () => '' }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialRecognitionConnectors: false,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: false,
      includeMarketReferenceConnectors: false,
      includeMarketReferenceTrafficConnectors: true,
      includeTrancoTrafficConnectors: false,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(27)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 4,
      stagedReviewCount: 4,
    })
    expect(envelope?.state.competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'BASF',
        traffic: expect.stringContaining('2.8M visits'),
        rating: expect.stringContaining('Authority Score: 72'),
        pricingEvidence: '',
        marketShare: '',
        evidenceStatus: 'Market Reference',
        sourceTier: 'tier4-market-reference',
        reviewRequired: false,
      }),
      expect.objectContaining({
        companyName: 'Stepan Company',
        traffic: expect.stringContaining('412.2K visits'),
        rating: expect.stringContaining('Authority Score: 52'),
        pricingEvidence: '',
        marketShare: '',
        evidenceStatus: 'Market Reference',
        sourceTier: 'tier4-market-reference',
        reviewRequired: false,
      }),
      expect.objectContaining({
        companyName: 'Kao Corporation',
        traffic: expect.stringContaining('1.17M visits'),
        rating: expect.stringContaining('Authority Score: 60'),
        pricingEvidence: '',
        marketShare: '',
        evidenceStatus: 'Market Reference',
        sourceTier: 'tier4-market-reference',
        reviewRequired: false,
        riskReason: expect.stringContaining('Traffic and authority'),
      }),
      expect.objectContaining({
        companyName: 'Syensqo / Solvay',
        traffic: expect.stringContaining('87.39K visits'),
        rating: expect.stringContaining('Authority Score: 37'),
      }),
    ]))
    expect(envelope?.state.researchFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyClaim: expect.stringContaining('Semrush website-traffic estimate'),
        status: 'Pending Review',
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          companyName: 'Kao Corporation',
        }),
      }),
    ]))
  })

  it('hydrates Tranco traffic-rank signals for all configured competitor domains', async () => {
    writeFullDashboardJob(hermesHome)
    const fetchMock = vi.fn(async (url: string) => {
      const domain = String(url).split('/').pop() || 'unknown.example'
      const rank = domain.length * 1000
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ranks: [
            { date: '2026-06-04', rank: rank + 20 },
            { date: '2026-06-05', rank },
          ],
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestFullDashboardAutopilotOutputs('default', {
      includeOfficialConnectors: false,
      includeOfficialCompanyFinancialConnectors: false,
      includeOfficialProductConnectors: false,
      includeOfficialRecognitionConnectors: false,
      includeOfficialSupplierConnectors: false,
      includeOfficialTradeConnectors: false,
      includeMarketReferenceConnectors: false,
      includeMarketReferenceTrafficConnectors: false,
      includeTrancoTrafficConnectors: true,
    })
    const envelope = await readDashboardIntelligenceState('default')

    expect(fetchMock).toHaveBeenCalledTimes(15)
    expect(result).toMatchObject({
      importedRuns: 0,
      autoFilledCount: 15,
      stagedReviewCount: 15,
    })
    expect(envelope?.state.competitors).toHaveLength(15)
    expect(envelope?.state.competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'BASF',
        traffic: expect.stringContaining('Tranco daily traffic-rank signal'),
        pricingEvidence: '',
        marketShare: '',
        revenue: '',
        evidenceStatus: 'Market Reference',
        sourceTier: 'tier4-market-reference',
        reviewRequired: false,
        metricEvidence: expect.objectContaining({
          traffic: expect.objectContaining({
            source: expect.objectContaining({
              title: 'Tranco daily domain rank - basf.com',
              url: 'https://tranco-list.eu/api/ranks/domain/basf.com',
            }),
            evidenceStatus: 'Market Reference',
            reviewRequired: false,
          }),
        }),
      }),
      expect.objectContaining({
        companyName: 'Pulcra Chemicals',
        traffic: expect.stringContaining('pulcra-chemicals.com'),
      }),
    ]))
    expect(envelope?.state.researchFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyClaim: expect.stringContaining('Tranco daily traffic-rank signal'),
        dashboardTarget: expect.objectContaining({
          group: 'competitorRecords',
          companyName: 'BASF',
        }),
      }),
    ]))
  })

  it('extracts 360 Research market-reference data and keeps company share review-gated', () => {
    const source = {
      fieldKeySlug: 'research360_esterquat',
      sourceTitle: '360 Research Reports - Esterquat Market',
      sourceUrl: 'https://www.360researchreports.com/market-reports/esterquat-market-204218',
      parser: 'research360-esterquat' as const,
    }
    const html = `
      <article>
        <p>Last Updated: 23 February 2026</p>
        <p>Global Esterquat market value is expected to rise from USD 535.392 million in 2026 to approximately USD 874.1568 million by 2035, progressing at a CAGR of 5.6% between 2026 and 2035.</p>
        <p>Asia-Pacific holds 41% of global esterquat consumption at 787,200 tons, Europe holds 28%, and North America holds 19%, with these three regions jointly representing 88% of global demand. Middle East & Africa consumes 134,400 tons, contributing 7% of global esterquat demand.</p>
        <p>The Esterquat Market is segmented by type into TEAQ, DEEDMAC, HEQ, and Others, representing 48%, 32%, 14%, and 6% of global volume respectively.</p>
        <p>The top 2 manufacturers hold 33% market share collectively, while the top 5 control 57%, and the largest producer alone represents 19%, shaping a consolidated Esterquat Competitive Landscape.</p>
        <p>Asia-Pacific is the largest regional market, consuming 787,200 tons, representing 41% of global esterquat volume. China leads with 326,000 tons, India with 154,000 tons, Japan with 98,100 tons, South Korea with 67,000 tons, and Indonesia with 52,400 tons.</p>
        <p>Europe holds 28% of global esterquat consumption, totaling 537,600 tons. Germany leads with 126,000 tons, followed by the U.K. at 94,000 tons, France at 78,000 tons, Italy at 69,200 tons, and Spain at 56,100 tons.</p>
        <p>List of Top Esterquat Companies * Stepan Company * Kao Chemicals * Evonik Industries * BASF SE * Clariant Chemicals Top Two Companies with Highest Share</p>
        <p>Stepan Company: Stepan Company holds 19% global esterquat share, operates 12 production plants, and manufactures over 410,000 tons annually for household and personal care industries.</p>
        <p>Evonik Industries: Evonik Industries controls 14% global esterquat share, manages 7 advanced facilities, and supplies more than 268,000 tons yearly to global detergent and cosmetic manufacturers.</p>
      </article>
    `

    const claims = marketReferencePageToMarketClaimUpdates(source, html, '2026-06-06T00:00:00.000Z')
    const competitors = marketReferencePageToCompetitorContextUpdates(source, html, '2026-06-06T00:00:00.000Z')

    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldKey: 'market.esterquats.360_market_size',
        value: 'USD 535.392M in 2026 (market-reference estimate)',
        sourceDate: '23 February 2026',
        reviewRequired: true,
      }),
      expect.objectContaining({
        fieldKey: 'market.esterquats.360_country_consumption.china',
        value: '326,000 tons esterquat consumption (market-reference estimate)',
      }),
      expect.objectContaining({
        fieldKey: 'market.esterquats.360_top_five_share',
        value: '57% top-five collective share (market-reference estimate)',
      }),
    ]))
    expect(competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'Stepan Company',
        marketShare: '19% global esterquat share (market-reference estimate; not textile-softener-specific).',
        evidenceStatus: 'Market Reference',
        reviewRequired: true,
        riskReason: expect.stringContaining('not official'),
      }),
      expect.objectContaining({
        companyName: 'Evonik Industries',
        marketShare: '14% global esterquat share (market-reference estimate; not textile-softener-specific).',
        reviewRequired: true,
      }),
    ]))
  })

  it('extracts Fortune market-reference data and keeps company share review-gated', () => {
    const source = {
      fieldKeySlug: 'fortune_esterquats',
      sourceTitle: 'Fortune Business Insights - Esterquats Market',
      sourceUrl: 'https://www.fortunebusinessinsights.com/esterquats-market-102891',
      parser: 'fortune-esterquats' as const,
    }
    const html = `
      <article>
        <p>Last Updated: May 18, 2026</p>
        <p>The global esterquats market size was valued at USD 2.19 billion in 2025.</p>
        <p>It is projected to grow from USD 2.34 billion in 2026 to USD 4.23 billion by 2034, exhibiting a CAGR of 7.7%.</p>
        <p>North America held 40.6% share in 2025.</p>
        <p>Canada captured 5.08% of the global market share in 2025.</p>
        <p>The triethanolamine (TEA) segment accounted for 33.6% in 2025.</p>
        <p>The liquid form segment held 85.6% share in 2025.</p>
        <p>The fabric softeners segment held 55% share in 2025.</p>
        <p>List of Top Esterquats Companies AkzoNobel Procter & Gamble Kao Chemicals BASF Stepan Company Evonik Industries Market Size by Form</p>
        <p>AkzoNobel: 17% Market Share</p>
        <p>Procter & Gamble: 14% Market Share</p>
      </article>
    `

    const claims = marketReferencePageToMarketClaimUpdates(source, html, '2026-06-06T00:00:00.000Z')
    const competitors = marketReferencePageToCompetitorContextUpdates(source, html, '2026-06-06T00:00:00.000Z')

    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldKey: 'market.esterquats.fortune_market_size',
        value: 'USD 2.19B in 2025 (market-reference estimate)',
        sourceDate: 'May 18, 2026',
        reviewRequired: true,
      }),
      expect.objectContaining({
        fieldKey: 'market.esterquats.fortune_cagr',
        value: '7.7% CAGR from 2026 to 2034 (market-reference forecast)',
      }),
      expect.objectContaining({
        fieldKey: 'market.esterquats.fortune_fabric_softener_share',
        value: '55% fabric-softener application share in 2025 (market-reference segment estimate)',
      }),
    ]))
    expect(competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'AkzoNobel',
        marketShare: '17% global esterquats share (Fortune Business Insights market-reference estimate; not textile-softener-specific).',
        evidenceStatus: 'Market Reference',
        reviewRequired: true,
        riskReason: expect.stringContaining('not official'),
      }),
      expect.objectContaining({
        companyName: 'Procter & Gamble',
        marketShare: '14% global esterquats share (Fortune Business Insights market-reference estimate; not textile-softener-specific).',
        reviewRequired: true,
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
        companyName: 'Stepan Company',
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
    expect(registry.importerVersion).toBe(DASHBOARD_AUTOPILOT_IMPORTER_VERSION)
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
