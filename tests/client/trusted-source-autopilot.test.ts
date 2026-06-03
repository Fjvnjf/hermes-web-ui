// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import TrustedSourcesView from '@/views/hermes/TrustedSourcesView.vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import {
  FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
  FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
  loadFullDashboardAutopilotStatus,
  persistFullDashboardAutopilotStatus,
  useTrustedSourceAutopilot,
} from '@/composables/useTrustedSourceAutopilot'
import {
  DEFAULT_TRUSTED_SOURCES,
  classifySourceCandidate,
  evidenceStatusForTier,
} from '@/utils/trustedSources'
import {
  SCREEN_FIELD_MAPPINGS,
  createMissingFieldClaim,
  preferredSourceForField,
  runConnector,
} from '@/utils/trustedSourceConnectors'
import {
  buildDashboardUpdateCandidate,
  dashboardFieldKey,
  dashboardSourceTier,
  extractDashboardResearchUpdates,
  sortSourcesByDashboardPolicy,
} from '@/utils/dashboardAutopilotPolicy'
import { canAccessRouteName } from '@/utils/accessControl'
import { listCronRuns, readCronRun } from '@/api/hermes/cron-history'

const createJobMock = vi.hoisted(() => vi.fn())
const runJobMock = vi.hoisted(() => vi.fn())
const listJobsMock = vi.hoisted(() => vi.fn())
const fetchAvailableModelsMock = vi.hoisted(() => vi.fn())
const updateDefaultModelMock = vi.hoisted(() => vi.fn())
const fetchDashboardIntelligenceStateMock = vi.hoisted(() => vi.fn())
const fetchDashboardAutopilotImportStatusMock = vi.hoisted(() => vi.fn())
const saveDashboardIntelligenceStateMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/client', () => ({
  getStoredUserRole: () => 'super_admin',
}))

vi.mock('@/api/hermes/jobs', () => ({
  listJobs: listJobsMock,
  createJob: createJobMock,
  runJob: runJobMock,
}))

vi.mock('@/api/hermes/system', () => ({
  fetchAvailableModels: fetchAvailableModelsMock,
  updateDefaultModel: updateDefaultModelMock,
}))

vi.mock('@/api/hermes/intelligence-state', () => ({
  fetchDashboardIntelligenceState: fetchDashboardIntelligenceStateMock,
  fetchDashboardAutopilotImportStatus: fetchDashboardAutopilotImportStatusMock,
  saveDashboardIntelligenceState: saveDashboardIntelligenceStateMock,
}))

vi.mock('@/stores/hermes/jobs', () => ({
  useJobsStore: () => ({
    jobs: [],
    fetchJobs: vi.fn(),
    createJob: createJobMock,
    runJob: runJobMock,
  }),
}))

vi.mock('@/api/hermes/cron-history', () => ({
  listCronRuns: vi.fn(),
  readCronRun: vi.fn(),
}))

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  NButton: { template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' },
  NDrawer: { template: '<div v-if="show" class="n-drawer"><slot /></div>', props: ['show'] },
  NDrawerContent: { template: '<div class="n-drawer-content"><slot /></div>' },
  NSelect: { props: ['value', 'options'], template: '<div class="n-select"></div>' },
  NSwitch: { template: '<input type="checkbox" />' },
  NTag: { template: '<span class="n-tag"><slot /></span>' },
}))

vi.mock('vue-router', () => ({
  RouterLink: {
    props: ['to'],
    template: '<a class="router-link"><slot /></a>',
  },
}))

describe('Trusted Source Autopilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchAvailableModelsMock.mockResolvedValue({
      default: 'gpt-5.5',
      default_provider: 'codex',
      groups: [{ provider: 'codex', label: 'Codex', base_url: '', models: ['gpt-5.5'], api_key: '' }],
      allProviders: [{ provider: 'codex', label: 'Codex', base_url: '', models: ['gpt-5.5'], api_key: '' }],
      profiles: [],
      model_aliases: {},
      custom_models: {},
      model_visibility: {},
    })
    updateDefaultModelMock.mockResolvedValue(undefined)
    listJobsMock.mockResolvedValue([])
    createJobMock.mockResolvedValue({ id: 'job-1', job_id: 'job-1' })
    runJobMock.mockResolvedValue({ id: 'job-1', job_id: 'job-1' })
    fetchDashboardIntelligenceStateMock.mockResolvedValue({
      ok: true,
      profile: 'default',
      savedAt: null,
      state: null,
    })
    fetchDashboardAutopilotImportStatusMock.mockRejectedValue(new Error('server import status not configured'))
    saveDashboardIntelligenceStateMock.mockResolvedValue({
      ok: true,
      profile: 'default',
      savedAt: '2026-06-02T00:00:00.000Z',
    })
    window.localStorage.clear()
    window.localStorage.setItem('hermes.frontendAccessRole', 'owner')
    useFeasibilityIntelligence().resetFeasibilityIntelligenceForTests()
    useTrustedSourceAutopilot().resetTrustedSourceAutopilotForTests()
  })

  it('classifies trusted and weak sources into safe tiers', () => {
    expect(classifySourceCandidate({
      name: 'UN Comtrade',
      url: 'https://comtradeplus.un.org/TradeFlow',
      dataType: 'trade_data',
    }).tier).toBe('tier1-official')
    expect(classifySourceCandidate({
      name: 'ECHEMI',
      url: 'https://www.echemi.com/products',
      dataType: 'price_data',
    }).tier).toBe('tier2-market-reference')
    expect(classifySourceCandidate({
      name: 'Alibaba listing',
      url: 'https://www.alibaba.com/product-detail/example',
      dataType: 'price_data',
    }).tier).toBe('tier4-public-listing')
    expect(classifySourceCandidate({
      name: 'Unknown blog',
      url: 'https://example-blog.invalid/post',
      dataType: 'market_size',
    }).tier).toBe('candidate-source')
  })

  it('seeds a real 100-plus trusted source registry with connector metadata', () => {
    expect(DEFAULT_TRUSTED_SOURCES.length).toBeGreaterThanOrEqual(100)
    expect(DEFAULT_TRUSTED_SOURCES.every(source => source.url && source.connector_type && source.data_types_supported.length)).toBe(true)
    expect(DEFAULT_TRUSTED_SOURCES.some(source => source.source_id === 'world-bank-indicators-api' && source.connector_type === 'API')).toBe(true)
    expect(DEFAULT_TRUSTED_SOURCES.some(source => source.source_id === 'supplier-uploaded-quote' && source.connector_type === 'supplier_quote')).toBe(true)
    expect(DEFAULT_TRUSTED_SOURCES.some(source => source.tier === 'tier4-public-listing' && source.requires_review)).toBe(true)
  })

  it('defines source mappings for the four screenshot dashboard screens', () => {
    expect(SCREEN_FIELD_MAPPINGS.executive.map(item => item.field)).toContain('Revenue Target')
    expect(SCREEN_FIELD_MAPPINGS.market.map(item => item.field)).toContain('Market Size / Scope')
    expect(SCREEN_FIELD_MAPPINGS.investment.map(item => item.field)).toContain('Project IRR')
    expect(SCREEN_FIELD_MAPPINGS.competitor.map(item => item.field)).toContain('Market Share Chart')
  })

  it('builds connector skeletons that return normalized To Verify claims instead of fake values', async () => {
    const source = DEFAULT_TRUSTED_SOURCES.find(item => item.source_id === 'un-comtrade-plus')!
    const { claims } = await runConnector({
      screen: 'market',
      field: 'Market Size / Scope',
      source,
      now: '2026-06-01T00:00:00.000Z',
    })

    expect(claims[0]).toMatchObject({
      screen: 'market',
      field: 'Market Size / Scope',
      value: 'Trade Proxy / To Verify',
      source_id: 'un-comtrade-plus',
      evidence_status: 'Trade Proxy',
      review_required: true,
    })
    expect(claims[0].value).not.toContain('$3.2B')
  })

  it('fetches and normalizes a World Bank API claim when fetch is available', async () => {
    const source = DEFAULT_TRUSTED_SOURCES.find(item => item.source_id === 'world-bank-indicators-api')!
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [null, [{ date: '2025', value: 4.25 }]],
    } as Response)
    const { claims } = await runConnector({
      screen: 'market',
      field: 'Growth Rate',
      source,
      fetchImpl,
      now: '2026-06-01T00:00:00.000Z',
    })

    expect(fetchImpl).toHaveBeenCalled()
    expect(claims[0].value).toBe('4.25%')
    expect(claims[0].evidence_status).toBe('Official Data')
    expect(claims[0].review_required).toBe(true)
  })

  it('gracefully falls back when a connector cannot fetch', async () => {
    const source = DEFAULT_TRUSTED_SOURCES.find(item => item.source_id === 'world-bank-indicators-api')!
    const { claims } = await runConnector({
      screen: 'market',
      field: 'Growth Rate',
      source,
      fetchImpl: vi.fn().mockRejectedValue(new Error('network blocked')),
    })

    expect(claims[0].value).toBe('Research Required / To Verify')
    expect(claims[0].method).toBe('fallback')
    expect(claims[0].review_required).toBe(true)
  })

  it('selects preferred sources and creates missing field claims with action path metadata', () => {
    const preferred = preferredSourceForField('market', 'Market Size / Scope', DEFAULT_TRUSTED_SOURCES)
    expect(preferred?.source_id).toMatch(/comtrade|world-bank/)

    const missing = createMissingFieldClaim('competitor', 'Market Share Chart')
    expect(missing.value).toBe('Missing / To Verify')
    expect(missing.review_required).toBe(true)
    expect(missing.notes).toContain('Create research job')
  })

  it('ranks official and company sources ahead of weak marketplace references', () => {
    const official = DEFAULT_TRUSTED_SOURCES.find(item => item.source_id === 'un-comtrade-plus')!
    const company = DEFAULT_TRUSTED_SOURCES.find(item => item.source_id === 'basf')!
    const weakListing = DEFAULT_TRUSTED_SOURCES.find(item => item.source_id.includes('alibaba'))!
    const ranked = sortSourcesByDashboardPolicy([weakListing, company, official], ['trade_data', 'company_data'], ['price_data'])

    expect(ranked[0].source_id).toBe('un-comtrade-plus')
    expect(dashboardSourceTier(official)).toBe('tier1-official')
    expect(dashboardSourceTier(company)).toBe('tier2-company-official')
    expect(dashboardSourceTier(weakListing)).toBe('tier5-public-listing')
  })

  it('auto-fills only low-risk source-backed fields and stages critical values for review', () => {
    const company = DEFAULT_TRUSTED_SOURCES.find(item => item.source_id === 'basf')!
    const lowRisk = buildDashboardUpdateCandidate({
      screen: 'competitor',
      field: 'Competitors Profiled',
      value: 'BASF official textile chemical presence confirmed',
      source: { title: 'BASF official', url: 'https://www.basf.com/', date: '2026-06-01' },
      evidenceStatus: 'Source-backed',
      confidence: 'medium',
      dataType: 'company_data',
      reviewRequired: false,
    }, company)
    const critical = buildDashboardUpdateCandidate({
      screen: 'competitor',
      field: 'Market Share Chart',
      value: '12%',
      source: { title: 'BASF official', url: 'https://www.basf.com/', date: '2026-06-01' },
      evidenceStatus: 'Source-backed',
      confidence: 'medium',
      dataType: 'competitor_data',
      reviewRequired: false,
    }, company)

    expect(lowRisk.fieldKey).toBe(dashboardFieldKey('competitor', 'Competitors Profiled'))
    expect(lowRisk.action).toBe('auto-fill')
    expect(lowRisk.reviewRequired).toBe(false)
    expect(critical.action).toBe('stage-review')
    expect(critical.reviewRequired).toBe(true)
    expect(critical.riskReason).toContain('critical dashboard claim')
  })

  it('stages fake-looking screenshot values and unsupported financial/supplier values instead of approving them', () => {
    const marketRef = DEFAULT_TRUSTED_SOURCES.find(item => item.source_id === 'marketsandmarkets')!
    const fakeMarketSize = buildDashboardUpdateCandidate({
      screen: 'market',
      field: 'Market Size / Scope',
      value: '$3.2B',
      source: { title: 'Template screenshot', date: '2026-06-01' },
      evidenceStatus: 'Market Reference',
      confidence: 'low',
      dataType: 'market_size',
      reviewRequired: false,
    }, marketRef)
    const supplierPrice = buildDashboardUpdateCandidate({
      screen: 'market',
      field: 'Supplier price / DMS',
      value: '$890/T',
      source: { title: 'Alibaba listing', url: 'https://www.alibaba.com/example', date: '2026-06-01' },
      evidenceStatus: 'Reference Only',
      confidence: 'low',
      dataType: 'supplier_quote',
      reviewRequired: false,
      sensitive: true,
    }, DEFAULT_TRUSTED_SOURCES.find(item => item.source_id.includes('alibaba')))

    expect(fakeMarketSize.action).toBe('stage-review')
    expect(fakeMarketSize.riskReason).toContain('matches old screenshot/template number')
    expect(supplierPrice.action).toBe('stage-review')
    expect(supplierPrice.riskReason).toContain('sensitive price/cost/financial/regulatory data')
  })

  it('maps source tiers to evidence labels without pretending weak sources are verified', () => {
    expect(evidenceStatusForTier('tier1-official')).toBe('Trusted Source Auto-Updated')
    expect(evidenceStatusForTier('tier2-market-reference')).toBe('Market Reference')
    expect(evidenceStatusForTier('tier4-public-listing')).toBe('Reference Only')
    expect(evidenceStatusForTier('candidate-source')).toBe('Candidate Source')
    expect(evidenceStatusForTier('tier1-official', true)).toBe('Conflict Detected')
  })

  it('auto-updates market claims from Tier 1 source records with source/date/confidence', () => {
    const autopilot = useTrustedSourceAutopilot()
    const intelligence = useFeasibilityIntelligence()

    const snapshot = autopilot.applyTrustedSourceClaim({
      screen: 'market',
      label: 'China textile softener import proxy',
      value: 'Trade Proxy / To Verify',
      dataType: 'trade_data',
      source: {
        title: 'UN Comtrade',
        url: 'https://comtradeplus.un.org',
        date: '2026-05-31',
      },
    })

    expect(snapshot.evidence_status).toBe('Trusted Source Auto-Updated')
    expect(snapshot.claims[0].confidence).toBe('high')
    expect(snapshot.claims[0].source.date).toBe('2026-05-31')
    expect(intelligence.state.value.marketClaims[0].label).toBe('China textile softener import proxy')
    expect(intelligence.state.value.marketClaims[0].evidenceStatus).toBe('Trusted Source Auto-Updated')
  })

  it('runs the data engine across mapped fields without injecting fake screenshot values', async () => {
    const autopilot = useTrustedSourceAutopilot()
    const result = await autopilot.runTrustedSourceDataEngine('market')

    expect(result.snapshot.claims.length).toBeGreaterThanOrEqual(SCREEN_FIELD_MAPPINGS.market.length)
    expect(result.snapshot.claims.some(claim => claim.label === 'Market Size / Scope')).toBe(true)
    expect(result.snapshot.claims.every(claim => !claim.value.includes('$3.2B'))).toBe(true)
    expect(result.snapshot.review_required).toBe(true)
  })

  it('builds a full dashboard autopilot prompt for online research without allowing fake values', () => {
    const prompt = useTrustedSourceAutopilot().fullDashboardAutopilotPrompt()

    expect(prompt).toContain(FULL_DASHBOARD_AUTOPILOT_JOB_NAME)
    expect(FULL_DASHBOARD_AUTOPILOT_SCHEDULE).toBe('0 7,19 * * *')
    expect(prompt).toContain('Raw Material Sourcing')
    expect(prompt).toContain('Supplier Scorecards')
    expect(prompt).toContain('UN Comtrade')
    expect(prompt).toContain('PubChem')
    expect(prompt).toContain('Wilmar')
    expect(prompt).toContain('WACKER')
    expect(prompt).toContain('Do the online research yourself')
    expect(prompt).toContain('Do not ask the user to manually search')
    expect(prompt).toContain('Country-wise consumption growth')
    expect(prompt).toContain('Put the appendix in one fenced ```json block')
    expect(prompt).toContain('source-backed Markdown tables')
    expect(prompt).toContain('source-backed delimited bullets')
    expect(prompt).toContain('unstructured or unsourced output will be ignored')
    expect(prompt).toContain('Do not invent market size')
    expect(prompt).toContain('competitor market share as To Verify')
  })

  it('extracts dashboard_updates JSON from Hermes markdown job output', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '```json',
      JSON.stringify({
        dashboard_updates: {
          marketClaims: [{
            field: 'Target Countries / Provinces',
            value: 'Zhejiang textile cluster source-backed',
            sourceTitle: 'China National Bureau of Statistics',
            sourceUrl: 'https://www.stats.gov.cn/',
            evidenceStatus: 'Official Data',
          }],
        },
      }),
      '```',
    ].join('\n'))

    expect(payload?.marketClaims).toHaveLength(1)
    expect(payload?.marketClaims?.[0].field).toBe('Target Countries / Provinces')
  })

  it('extracts source-backed markdown tables from Hermes output when the JSON appendix is missing', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Competitor Intelligence',
      '| Company | Product Equivalent | Market Share | Source Title | Source URL | Source Tier | Evidence Status | Confidence | Review Required |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| Stepan | STEPANTEX SP-90 official product page | To Verify | Stepan official product page | https://www.stepan.com/ | Tier 2 - Official company / product source | To Verify | medium | yes |',
    ].join('\n'))

    expect(payload?.competitorRecords).toEqual([
      expect.objectContaining({
        companyName: 'Stepan',
        productEquivalent: 'STEPANTEX SP-90 official product page',
        marketShare: 'To Verify',
        sourceTitle: 'Stepan official product page',
        sourceUrl: 'https://www.stepan.com/',
        reviewRequired: true,
      }),
    ])
  })

  it('extracts source-backed delimited bullets from Hermes output when JSON and tables are missing', () => {
    const payload = extractDashboardResearchUpdates([
      '# Full Dashboard Trusted Source Autopilot',
      '',
      '## Market Intelligence',
      '- Field: Country-wise consumption growth - China | Value: Official trade proxy located | Source: [WITS / World Bank Comtrade](https://wits.worldbank.org/) | Source Tier: Tier 1 - Official / regulator / trade source | Evidence Status: Official Data | Confidence: high | Review Required: yes',
      '',
      '## Supplier Scorecards',
      '* Supplier: KLK Oleo | Material: Stearic Acid TP | Price: To Verify | Source Title: Uploaded supplier quote index | Source Date: 2026-06-03 | Evidence Status: To Verify | Confidence: medium | Review Required: yes',
    ].join('\n'))

    expect(payload?.marketClaims).toEqual([
      expect.objectContaining({
        field: 'Country-wise consumption growth - China',
        value: 'Official trade proxy located',
        sourceTitle: 'WITS / World Bank Comtrade',
        sourceUrl: 'https://wits.worldbank.org/',
        reviewRequired: true,
      }),
    ])
    expect(payload?.supplierScorecards).toEqual([
      expect.objectContaining({
        supplier: 'KLK Oleo',
        material: 'Stearic Acid TP',
        value: 'To Verify',
        sourceTitle: 'Uploaded supplier quote index',
      }),
    ])
  })

  it('imports Hermes research output, auto-fills safe official data, and stages critical claims for review', () => {
    const autopilot = useTrustedSourceAutopilot()
    const intelligence = useFeasibilityIntelligence()
    const output = [
      'Full dashboard research result.',
      '',
      '```json',
      JSON.stringify({
        dashboard_updates: {
          marketClaims: [{
            field: 'Target Countries / Provinces',
            value: 'Zhejiang, Jiangsu, Guangdong textile clusters',
            sourceTitle: 'China National Bureau of Statistics',
            sourceUrl: 'https://www.stats.gov.cn/',
            sourceDate: '2026-06-01',
            evidenceStatus: 'Official Data',
            confidence: 'high',
            dataType: 'company_data',
          }],
          financialEvidence: [{
            field: 'Project IRR',
            value: '60%',
            sourceTitle: 'Hermes research output',
            sourceDate: '2026-06-01',
            evidenceStatus: 'Derived from Assumptions',
            confidence: 'medium',
            dataType: 'financial_data',
          }],
          supplierScorecards: [{
            supplier: 'Example supplier',
            material: 'DMS',
            pricingEvidence: '$890/T',
            sourceTitle: 'Alibaba listing',
            sourceUrl: 'https://www.alibaba.com/example',
            evidenceStatus: 'Reference Only',
            confidence: 'low',
            dataType: 'supplier_quote',
          }],
        },
      }),
      '```',
    ].join('\n')

    const result = autopilot.importDashboardResearchOutput(output, 'job-full-dashboard')

    expect(result.runImported).toBe(true)
    expect(result.parsedItemCount).toBe(3)
    expect(result.autoFilledCount).toBe(1)
    expect(result.reviewItemCount).toBe(2)
    expect(result.snapshotCount).toBeGreaterThan(0)
    expect(intelligence.state.value.marketClaims.some(claim => claim.label === 'Target Countries / Provinces')).toBe(true)
    expect(intelligence.state.value.financialModels).toHaveLength(0)
    expect(intelligence.pendingResearchFindings.value.some(item => item.keyClaim.includes('Project IRR'))).toBe(true)
    expect(intelligence.pendingResearchFindings.value.some(item => item.summary.includes('Supplier scorecard'))).toBe(true)
  })

  it('imports the latest scheduled Hermes output artifact automatically when available', async () => {
    vi.mocked(listCronRuns).mockResolvedValue([{
      jobId: 'job-full-dashboard',
      fileName: '2026-06-02T07-00-00.md',
      runTime: '2026-06-02 07:00:00',
      size: 1024,
      hasOutput: true,
    }])
    vi.mocked(readCronRun).mockResolvedValue({
      jobId: 'job-full-dashboard',
      fileName: '2026-06-02T07-00-00.md',
      runTime: '2026-06-02 07:00:00',
      content: JSON.stringify({
        dashboard_updates: {
          competitorRecords: [{
            companyName: 'BASF',
            countryRegion: 'Germany',
            productEquivalent: 'Textile softener portfolio',
            activeContent: 'To Verify',
            certifications: 'Official company/product source',
            distributionPresence: 'Global',
            sourceTitle: 'BASF official',
            sourceUrl: 'https://www.basf.com/',
            evidenceStatus: 'Source-backed',
            confidence: 'medium',
            dataType: 'company_data',
          }],
        },
      }),
    })

    const result = await useTrustedSourceAutopilot().importLatestFullDashboardRunOutput('job-full-dashboard')

    expect(listCronRuns).toHaveBeenCalledWith('job-full-dashboard')
    expect(readCronRun).toHaveBeenCalledWith('job-full-dashboard', '2026-06-02T07-00-00.md')
    expect(result.runImported).toBe(true)
    expect(result.autoFilledCount).toBe(1)
    expect(result.runKey).toBe('job-full-dashboard/2026-06-02T07-00-00.md')
    expect(useFeasibilityIntelligence().state.value.competitors[0].companyName).toBe('BASF')
  })

  it('does not import the same scheduled Hermes output twice', async () => {
    vi.mocked(listCronRuns).mockResolvedValue([{
      jobId: 'job-full-dashboard',
      fileName: '2026-06-02T07-00-00.md',
      runTime: '2026-06-02 07:00:00',
      size: 1024,
      hasOutput: true,
    }])
    vi.mocked(readCronRun).mockResolvedValue({
      jobId: 'job-full-dashboard',
      fileName: '2026-06-02T07-00-00.md',
      runTime: '2026-06-02 07:00:00',
      content: JSON.stringify({
        dashboard_updates: {
          marketClaims: [{
            field: 'Target Countries / Provinces',
            value: 'Guangdong textile cluster',
            sourceTitle: 'China National Bureau of Statistics',
            sourceUrl: 'https://www.stats.gov.cn/',
            evidenceStatus: 'Official Data',
            confidence: 'high',
            dataType: 'company_data',
          }],
        },
      }),
    })

    const autopilot = useTrustedSourceAutopilot()
    const first = await autopilot.importLatestFullDashboardRunOutput('job-full-dashboard')
    const second = await autopilot.importLatestFullDashboardRunOutput('job-full-dashboard')

    expect(first.runImported).toBe(true)
    expect(second.runImported).toBe(false)
    expect(second.message).toContain('already imported')
    expect(readCronRun).toHaveBeenCalledTimes(1)
    expect(useFeasibilityIntelligence().state.value.marketClaims).toHaveLength(1)
  })

  it('imports enabled full-dashboard output in the background and updates autopilot status', async () => {
    persistFullDashboardAutopilotStatus({
      enabled: true,
      scheduledJobId: 'job-full-dashboard',
      lastStatus: 'Scheduled',
    })
    vi.mocked(listCronRuns).mockResolvedValue([{
      jobId: 'job-full-dashboard',
      fileName: '2026-06-02T19-00-00.md',
      runTime: '2026-06-02 19:00:00',
      size: 512,
      hasOutput: true,
    }])
    vi.mocked(readCronRun).mockResolvedValue({
      jobId: 'job-full-dashboard',
      fileName: '2026-06-02T19-00-00.md',
      runTime: '2026-06-02 19:00:00',
      content: JSON.stringify({
        dashboard_updates: {
          marketClaims: [{
            field: 'Target Countries / Provinces',
            value: 'Jiangsu textile cluster source-backed',
            sourceTitle: 'Jiangsu official source',
            sourceUrl: 'https://www.jiangsu.gov.cn/',
            evidenceStatus: 'Official Data',
            confidence: 'high',
            dataType: 'company_data',
          }],
        },
      }),
    })

    const result = await useTrustedSourceAutopilot().importEnabledFullDashboardRunOutput()
    const status = loadFullDashboardAutopilotStatus()

    expect(result?.runImported).toBe(true)
    expect(status.lastStatus).toContain('Auto-filled: 1')
    expect(status.lastStatus).toContain('Needs review: 0')
    expect(useFeasibilityIntelligence().state.value.marketClaims[0].label).toBe('Target Countries / Provinces')
  })

  it('refreshes live server autopilot status from jobs and cron history', async () => {
    listJobsMock.mockResolvedValueOnce([{
      id: 'job-full-dashboard',
      job_id: 'job-full-dashboard',
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      prompt: 'Research trusted-source dashboard_updates for the full dashboard',
      schedule: { kind: 'cron', expr: FULL_DASHBOARD_AUTOPILOT_SCHEDULE, display: '07:00 / 19:00' },
      schedule_display: '07:00 / 19:00',
      enabled: true,
      state: 'scheduled',
      last_run_at: '2026-06-03T07:00:00.000Z',
      next_run_at: '2026-06-03T19:00:00.000Z',
      last_status: 'completed',
      last_error: null,
    }])
    vi.mocked(listCronRuns).mockResolvedValueOnce([{
      jobId: 'job-full-dashboard',
      fileName: '2026-06-03T07-00-00.md',
      runTime: '2026-06-03T07:00:00.000Z',
      size: 2048,
      hasOutput: true,
    }])

    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'Official low-risk source',
      value: 'Official page found',
      evidenceStatus: 'Official Data',
      confidence: 'high',
      source: { title: 'Official source', url: 'https://example.gov' },
    })
    intelligence.addResearchFinding({
      summary: 'Review market share claim.',
      keyClaim: 'Market share To Verify',
      area: 'market',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: { title: 'Weak source', date: '2026-06-03' },
    })

    const status = await useTrustedSourceAutopilot().refreshFullDashboardServerStatus()

    expect(listJobsMock).toHaveBeenCalled()
    expect(listCronRuns).toHaveBeenCalledWith('job-full-dashboard')
    expect(status).toMatchObject({
      scheduled: true,
      jobId: 'job-full-dashboard',
      enabled: true,
      state: 'scheduled',
      outputCount: 1,
      latestOutputFile: '2026-06-03T07-00-00.md',
      latestOutputImported: false,
      dashboardRecordCount: 1,
      pendingReviewCount: 1,
    })
    expect(status.message).toContain('ready to import')
  })

  it('uses the server import registry for latest full-dashboard import status', async () => {
    listJobsMock.mockResolvedValueOnce([{
      id: 'job-full-dashboard',
      job_id: 'job-full-dashboard',
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      prompt: 'Research trusted-source dashboard_updates for the full dashboard',
      schedule_display: '07:00 / 19:00',
      enabled: true,
      state: 'scheduled',
      last_run_at: '2026-06-03T07:00:00.000Z',
      next_run_at: '2026-06-03T19:00:00.000Z',
      last_status: 'completed',
      last_error: null,
    }])
    vi.mocked(listCronRuns).mockResolvedValueOnce([{
      jobId: 'job-full-dashboard',
      fileName: '2026-06-03T07-00-00.md',
      runTime: '2026-06-03T07:00:00.000Z',
      size: 2048,
      hasOutput: true,
    }])
    fetchDashboardAutopilotImportStatusMock.mockResolvedValueOnce({
      ok: true,
      profile: 'default',
      autopilotImport: {
        profile: 'default',
        jobCount: 1,
        outputCount: 7,
        importedRunCount: 6,
        pendingOutputCount: 0,
        latestOutputRunKey: 'job-full-dashboard/2026-06-03T07-00-00.md',
        latestOutputFile: '2026-06-03T07-00-00.md',
        latestOutputAt: '2026-06-03T07:05:00.000Z',
        latestOutputImported: true,
        latestOutputParseStatus: 'imported',
        latestOutputCandidateCount: 0,
        latestOutputParseError: '',
        latestImportedRunKey: 'job-full-dashboard/2026-06-03T07-00-00.md',
        registryUpdatedAt: '2026-06-03T07:06:00.000Z',
        latestDueSlotAt: '2026-06-03T07:00:00.000Z',
        latestDueSlotSatisfied: true,
        latestDueSlotAttemptedAt: '2026-06-03T07:01:00.000Z',
        latestDueSlotRunError: '',
      },
    })

    const status = await useTrustedSourceAutopilot().refreshFullDashboardServerStatus()

    expect(fetchDashboardAutopilotImportStatusMock).toHaveBeenCalled()
    expect(status.outputCount).toBe(7)
    expect(status.importedRunCount).toBe(6)
    expect(status.latestOutputImported).toBe(true)
    expect(status.latestOutputParseStatus).toBe('imported')
    expect(status.latestOutputFile).toBe('2026-06-03T07-00-00.md')
    expect(status.latestDueSlotSatisfied).toBe(true)
    expect(status.latestDueSlotAttemptedAt).toBe('2026-06-03T07:01:00.000Z')
    expect(status.message).toContain('imported outputs are reflected')
  })

  it('refreshes server autopilot health without waiting for durable intelligence hydration', async () => {
    listJobsMock.mockResolvedValueOnce([{
      id: 'job-full-dashboard',
      job_id: 'job-full-dashboard',
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      prompt: 'Research trusted-source dashboard_updates for the full dashboard',
      schedule_display: '07:00 / 19:00',
      enabled: true,
      state: 'scheduled',
      last_run_at: '2026-06-03T07:00:00.000Z',
      next_run_at: '2026-06-03T19:00:00.000Z',
      last_status: 'completed',
      last_error: null,
    }])
    vi.mocked(listCronRuns).mockResolvedValueOnce([])
    fetchDashboardAutopilotImportStatusMock.mockResolvedValueOnce({
      ok: true,
      profile: 'default',
      autopilotImport: {
        profile: 'default',
        jobCount: 1,
        outputCount: 0,
        importedRunCount: 0,
        pendingOutputCount: 0,
        latestOutputRunKey: '',
        latestOutputFile: '',
        latestOutputAt: '',
        latestOutputImported: false,
        latestOutputParseStatus: 'none',
        latestOutputCandidateCount: 0,
        latestOutputParseError: '',
        latestImportedRunKey: '',
        registryUpdatedAt: '',
        latestDueSlotAt: '',
        latestDueSlotSatisfied: false,
        latestDueSlotAttemptedAt: '',
        latestDueSlotRunError: '',
      },
    })
    fetchDashboardIntelligenceStateMock.mockReturnValueOnce(new Promise(() => {}))

    const wrapper = mount(TrustedSourcesView)
    await flushPromises()

    expect(fetchDashboardAutopilotImportStatusMock).toHaveBeenCalled()
    expect(fetchDashboardIntelligenceStateMock).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('Server job status')
    expect(text).toContain('Hermes research job is connected')
    expect(text).toContain('Full Dashboard Autopilot is scheduled. Waiting for the first readable research output.')
  })

  it('hydrates dashboard intelligence from the owner-only server state before local rendering', async () => {
    fetchDashboardIntelligenceStateMock.mockResolvedValueOnce({
      ok: true,
      profile: 'default',
      savedAt: '2026-06-02T07:00:00.000Z',
      state: {
        marketClaims: [{
          id: 'market-server-1',
          label: 'Country-wise consumption growth - China',
          value: 'Official trade proxy / To Verify',
          evidenceStatus: 'Trade Proxy',
          confidence: 'medium',
          source: {
            title: 'UN Comtrade',
            url: 'https://comtradeplus.un.org',
            date: '2026-06-02',
          },
          lastChecked: '2026-06-02',
        }],
      },
    })

    const intelligence = useFeasibilityIntelligence()
    await intelligence.hydrateFeasibilityIntelligenceFromServer()

    expect(fetchDashboardIntelligenceStateMock).toHaveBeenCalledOnce()
    expect(intelligence.state.value.marketClaims[0].label).toBe('Country-wise consumption growth - China')
    expect(intelligence.serverSyncStatus.value.hydrated).toBe(true)
    expect(window.localStorage.getItem('hermes.feasibilityIntelligence.v1')).toContain('Country-wise consumption growth - China')
  })

  it('hydrates trusted-source panels from durable server intelligence state', async () => {
    fetchDashboardIntelligenceStateMock.mockResolvedValueOnce({
      ok: true,
      profile: 'default',
      savedAt: '2026-06-02T19:00:00.000Z',
      state: {
        marketClaims: [{
          id: 'market-server-1',
          label: 'Country-wise consumption growth - China',
          value: 'Official trade proxy / To Verify',
          evidenceStatus: 'Trade Proxy',
          confidence: 'medium',
          source: {
            title: 'UN Comtrade',
            url: 'https://comtradeplus.un.org',
            date: '2026-06-02',
          },
          lastChecked: '2026-06-02',
        }],
        competitors: [{
          id: 'competitor-server-1',
          companyName: 'Evonik Industries',
          countryRegion: 'Germany',
          productEquivalent: 'Esterquat / softener portfolio',
          activeContent: 'To Verify',
          pricingEvidence: 'To Verify',
          certifications: 'Official company source needed',
          distributionPresence: 'Global',
          marketShare: '',
          evidenceStatus: 'Source-backed',
          source: {
            title: 'Evonik official website',
            url: 'https://www.evonik.com/',
            date: '2026-06-02',
          },
          notes: 'Imported by Full Dashboard Autopilot.',
          updatedAt: '2026-06-02T19:00:00.000Z',
        }],
        researchFindings: [{
          id: 'finding-server-1',
          summary: 'Supplier scorecard finding needs owner review before dashboard use.',
          keyClaim: 'Supplier scorecard: stearic acid source',
          area: 'factory',
          evidenceStatus: 'Supplier Evidence',
          confidence: 'medium',
          source: {
            title: 'Supplier quote upload',
            date: '2026-06-02',
          },
          riskNote: 'Supplier price and score are sensitive.',
          status: 'Pending Review',
          createdAt: '2026-06-02T19:00:00.000Z',
          dashboardTarget: {
            group: 'supplierScorecards',
            proposedDashboardField: 'Stearic acid supplier scorecard',
            value: 'Quote evidence candidate',
            sourceTier: 'tier3-supplier-evidence',
            dataType: 'supplier_quote',
            sensitive: true,
          },
        }],
      },
    })

    const intelligence = useFeasibilityIntelligence()
    await intelligence.hydrateFeasibilityIntelligenceFromServer()
    const autopilot = useTrustedSourceAutopilot()
    const result = autopilot.hydrateSnapshotsFromServerIntelligenceState()

    expect(result).toMatchObject({ snapshotCount: 3, claimCount: 3 })
    expect(autopilot.lastSnapshotForScreen('market')?.claims[0].label).toBe('Country-wise consumption growth - China')
    expect(autopilot.lastSnapshotForScreen('competitor')?.claims[0].label).toBe('Evonik Industries')
    expect(autopilot.lastSnapshotForScreen('executive')?.claims[0].label).toBe('Stearic acid supplier scorecard')
    expect(loadFullDashboardAutopilotStatus().lastStatus).toContain('Durable server intelligence hydrated')
  })

  it('persists auto-filled dashboard intelligence to the server once sync is enabled', async () => {
    const intelligence = useFeasibilityIntelligence()
    await intelligence.hydrateFeasibilityIntelligenceFromServer({ seedServerIfEmpty: false })
    saveDashboardIntelligenceStateMock.mockClear()

    intelligence.addMarketClaim({
      label: 'Target province source-backed',
      value: 'Guangdong textile cluster',
      evidenceStatus: 'Official Data',
      confidence: 'high',
      source: {
        title: 'Guangdong official source',
        url: 'https://www.gd.gov.cn/',
        date: '2026-06-02',
      },
    })
    await intelligence.persistFeasibilityIntelligenceToServer()

    expect(saveDashboardIntelligenceStateMock).toHaveBeenCalledWith(expect.objectContaining({
      marketClaims: expect.arrayContaining([
        expect.objectContaining({ label: 'Target province source-backed' }),
      ]),
    }))
    expect(intelligence.serverSyncStatus.value.lastSavedAt).toBe('2026-06-02T00:00:00.000Z')
  })

  it('auto-bootstraps the full dashboard autopilot schedule without a manual click', async () => {
    const result = await useTrustedSourceAutopilot().ensureFullDashboardAutopilotScheduled({ startFirstRun: true })

    expect(updateDefaultModelMock).not.toHaveBeenCalled()
    expect(listJobsMock).toHaveBeenCalled()
    expect(createJobMock).toHaveBeenCalledWith(expect.objectContaining({
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      deliver: 'local',
    }))
    expect(runJobMock).toHaveBeenCalledWith('job-1')
    expect(result).toMatchObject({
      scheduledJobId: 'job-1',
      created: true,
      firstRunStarted: true,
    })
    expect(loadFullDashboardAutopilotStatus()).toMatchObject({
      enabled: true,
      scheduledJobId: 'job-1',
    })
    expect(useFeasibilityIntelligence().state.value.researchJobs[0].title).toBe(FULL_DASHBOARD_AUTOPILOT_JOB_NAME)
  })

  it('sets a default Hermes model before running autopilot when profile config is empty', async () => {
    fetchAvailableModelsMock.mockResolvedValue({
      default: '',
      default_provider: '',
      groups: [{ provider: 'codex', label: 'Codex', base_url: '', models: ['gpt-5.5'], api_key: '' }],
      allProviders: [],
      profiles: [],
      model_aliases: {},
      custom_models: {},
      model_visibility: {},
    })

    const result = await useTrustedSourceAutopilot().ensureFullDashboardAutopilotScheduled({ startFirstRun: true })

    expect(updateDefaultModelMock).toHaveBeenCalledWith({ default: 'gpt-5.5', provider: 'codex' })
    expect(runJobMock).toHaveBeenCalledWith('job-1')
    expect(result.defaultModelConfigured).toBe(true)
    expect(loadFullDashboardAutopilotStatus().lastStatus).toContain('first Hermes trusted-source research run has started')
  })

  it('retries an existing autopilot job after fixing a missing default model error', async () => {
    fetchAvailableModelsMock.mockResolvedValue({
      default: '',
      default_provider: '',
      groups: [{ provider: 'codex', label: 'Codex', base_url: '', models: ['gpt-5.5'], api_key: '' }],
      allProviders: [],
      profiles: [],
      model_aliases: {},
      custom_models: {},
      model_visibility: {},
    })
    persistFullDashboardAutopilotStatus({
      enabled: true,
      scheduledJobId: 'job-existing',
      lastRun: '2026-06-02T07:00:00.000Z',
      lastStatus: 'Previous run failed',
    })
    listJobsMock.mockResolvedValue([{
      id: 'job-existing',
      job_id: 'job-existing',
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      prompt: useTrustedSourceAutopilot().fullDashboardAutopilotPrompt(),
      last_error: "RuntimeError: Codex Responses request 'model' must be a non-empty string.",
    }])

    const result = await useTrustedSourceAutopilot().ensureFullDashboardAutopilotScheduled({ startFirstRun: true })

    expect(createJobMock).not.toHaveBeenCalled()
    expect(updateDefaultModelMock).toHaveBeenCalledWith({ default: 'gpt-5.5', provider: 'codex' })
    expect(runJobMock).toHaveBeenCalledWith('job-existing')
    expect(result.firstRunStarted).toBe(true)
  })

  it('reuses an existing full dashboard autopilot job instead of creating duplicates', async () => {
    listJobsMock.mockResolvedValue([{
      id: 'job-existing',
      job_id: 'job-existing',
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      prompt: useTrustedSourceAutopilot().fullDashboardAutopilotPrompt(),
    }])

    const result = await useTrustedSourceAutopilot().ensureFullDashboardAutopilotScheduled({ startFirstRun: true })
    const second = await useTrustedSourceAutopilot().ensureFullDashboardAutopilotScheduled({ startFirstRun: true })

    expect(createJobMock).not.toHaveBeenCalled()
    expect(runJobMock).toHaveBeenCalledTimes(1)
    expect(result.created).toBe(false)
    expect(result.firstRunStarted).toBe(true)
    expect(second.firstRunStarted).toBe(false)
    expect(loadFullDashboardAutopilotStatus().scheduledJobId).toBe('job-existing')
    expect(useFeasibilityIntelligence().state.value.researchJobs.filter(job => job.title === FULL_DASHBOARD_AUTOPILOT_JOB_NAME)).toHaveLength(1)
  })

  it('runs full dashboard data engine snapshots across the dashboard and queues review', async () => {
    const autopilot = useTrustedSourceAutopilot()
    const intelligence = useFeasibilityIntelligence()
    const result = await autopilot.runFullDashboardDataEngine('job-full-dashboard')

    expect(result.snapshots).toHaveLength(4)
    expect(result.reviewItemCount).toBeGreaterThan(0)
    expect(autopilot.lastSnapshotForScreen('executive')).not.toBeNull()
    expect(autopilot.lastSnapshotForScreen('market')).not.toBeNull()
    expect(autopilot.lastSnapshotForScreen('investment')).not.toBeNull()
    expect(autopilot.lastSnapshotForScreen('competitor')).not.toBeNull()
    expect(result.snapshots[0].claims[0]).toMatchObject({
      fieldKey: expect.any(String),
      sourceTier: expect.any(String),
      lastChecked: expect.any(String),
      riskReason: expect.any(String),
    })
    expect(intelligence.pendingResearchFindings.value.some(item => item.keyClaim.includes('Full dashboard autopilot'))).toBe(true)
  })

  it('sends conflicting trusted-source updates to Research Result Review', () => {
    const autopilot = useTrustedSourceAutopilot()
    const intelligence = useFeasibilityIntelligence()
    const source = {
      title: 'UN Comtrade',
      url: 'https://comtradeplus.un.org',
      date: '2026-05-31',
    }

    autopilot.applyTrustedSourceClaim({
      screen: 'market',
      label: 'Bangladesh import proxy',
      value: '100 MT',
      dataType: 'trade_data',
      source,
    })
    const conflict = autopilot.applyTrustedSourceClaim({
      screen: 'market',
      label: 'Bangladesh import proxy',
      value: '140 MT',
      dataType: 'trade_data',
      source,
    })

    expect(conflict.evidence_status).toBe('Conflict Detected')
    expect(conflict.review_required).toBe(true)
    expect(intelligence.pendingResearchFindings.value.some(item => item.keyClaim.includes('Conflict Detected'))).toBe(true)
  })

  it('flags raw material price movements over 5 percent for review without approving them', () => {
    const autopilot = useTrustedSourceAutopilot()
    const intelligence = useFeasibilityIntelligence()
    const source = {
      title: 'SunSirs',
      url: 'https://www.sunsirs.com/example-price',
      date: '2026-05-31',
    }

    autopilot.applyTrustedSourceClaim({
      screen: 'market',
      label: 'DMS raw material price reference',
      value: '$1000/MT',
      dataType: 'price_data',
      sensitive: true,
      source,
    })
    const snapshot = autopilot.applyTrustedSourceClaim({
      screen: 'market',
      label: 'DMS raw material price reference',
      value: '$1060/MT',
      dataType: 'price_data',
      sensitive: true,
      source,
    })

    expect(snapshot.claims[0].changePercent).toBeCloseTo(6)
    expect(snapshot.review_required).toBe(true)
    expect(snapshot.claims[0].sensitive).toBe(true)
    expect(intelligence.pendingResearchFindings.value.some(item => item.keyClaim.includes('Conflict Detected'))).toBe(true)
  })

  it('keeps uncertain trade data as Trade Proxy / To Verify instead of creating fake market size', () => {
    const autopilot = useTrustedSourceAutopilot()
    const intelligence = useFeasibilityIntelligence()

    autopilot.applyTrustedSourceClaim({
      screen: 'market',
      label: 'CWAS / CWMS import proxy',
      value: 'Trade Proxy / To Verify',
      dataType: 'trade_data',
      source: {
        title: 'UN Comtrade',
        url: 'https://comtradeplus.un.org',
        date: '2026-05-31',
      },
      notes: 'HS Code To Verify before treating this as exact consumption.',
    })

    expect(intelligence.state.value.marketClaims[0].value).toBe('Trade Proxy / To Verify')
    expect(intelligence.state.value.marketClaims[0].evidenceStatus).toBe('Trusted Source Auto-Updated')
    expect(intelligence.state.value.marketClaims[0].value).not.toContain('$3.2B')
  })

  it('does not update investment IRR from external web data as a verified fact', () => {
    const autopilot = useTrustedSourceAutopilot()
    const intelligence = useFeasibilityIntelligence()

    const snapshot = autopilot.applyTrustedSourceClaim({
      screen: 'investment',
      label: 'Project IRR',
      value: '60%',
      dataType: 'financial_data',
      sensitive: true,
      source: {
        title: 'Unknown market article',
        url: 'https://unknown.example/irr',
        date: '2026-05-31',
      },
    })

    expect(snapshot.claims[0].evidenceStatus).toBe('Candidate Source')
    expect(snapshot.review_required).toBe(true)
    expect(intelligence.state.value.financialModels).toHaveLength(0)
  })

  it('keeps trusted source admin owner-only and investor raw screens blocked', () => {
    expect(canAccessRouteName('hermes.trustedSources', 'owner')).toBe(true)
    expect(canAccessRouteName('hermes.trustedSources', 'employee')).toBe(false)
    expect(canAccessRouteName('hermes.trustedSources', 'investor_viewer')).toBe(false)
    expect(canAccessRouteName('hermes.marketIntelligence', 'investor_viewer')).toBe(false)
    expect(canAccessRouteName('hermes.competitorIntelligence', 'employee')).toBe(true)
  })

  it('renders source drawer metadata and disable auto-update control for sourced fields', async () => {
    const autopilot = useTrustedSourceAutopilot()
    autopilot.applyTrustedSourceClaim({
      screen: 'market',
      label: 'Market Size / Scope',
      value: 'Trade Proxy / To Verify',
      dataType: 'trade_data',
      source: {
        title: 'UN Comtrade',
        url: 'https://comtradeplus.un.org',
        date: '2026-05-31',
      },
    })

    const wrapper = mount(TrustedSourceAutopilotPanel, {
      props: { screen: 'market', title: 'Market Auto Source Status' },
    })
    await wrapper.findAll('button').find(button => button.text().includes('Market Size / Scope'))!.trigger('click')

    expect(wrapper.text()).toContain('Source')
    expect(wrapper.text()).toContain('UN Comtrade')
    expect(wrapper.text()).toContain('Source date')
    expect(wrapper.text()).toContain('2026-05-31')
    expect(wrapper.text()).toContain('Source tier')
    expect(wrapper.text()).toContain('Dashboard field')
    expect(wrapper.text()).toContain('Risk reason')
    expect(wrapper.text()).toContain('Confidence')
    expect(wrapper.text()).toContain('Disable Auto Update for this field')
  })

  it('creates a real data-engine snapshot from the Sync Now control', async () => {
    const autopilot = useTrustedSourceAutopilot()
    const wrapper = mount(TrustedSourceAutopilotPanel, {
      props: { screen: 'market', title: 'Market Auto Source Status' },
    })

    await wrapper.findAll('button').find(button => button.text().includes('Sync Now'))!.trigger('click')
    await vi.dynamicImportSettled()

    expect(autopilot.lastSnapshotForScreen('market')?.claims.some(claim => claim.label === 'Market Size / Scope')).toBe(true)
  })

  it('renders full dashboard autopilot controls in Trusted Sources and runs snapshots', async () => {
    const autopilot = useTrustedSourceAutopilot()
    const wrapper = mount(TrustedSourcesView)

    expect(wrapper.text()).toContain('Full dashboard autopilot')
    expect(wrapper.text()).toContain('Automatic Source Research For The Whole Dashboard')
    expect(wrapper.text()).toContain('Enable Full Autopilot')
    expect(wrapper.text()).toContain('Run Source Snapshot Now')
    expect(wrapper.text()).toContain('Unsupported market size, CAGR, market share, pricing, cost, IRR, or NPV values remain To Verify or Missing.')
    expect(wrapper.text()).toContain('Tier 1: official / regulator / trade')
    expect(wrapper.text()).toContain('Tier 2: official company / product')
    expect(wrapper.text()).toContain('Tier 5: public listing / weak reference')
    expect(wrapper.text()).toContain('07:00 / 19:00')

    await wrapper.findAll('button').find(button => button.text().includes('Run Source Snapshot Now'))!.trigger('click')
    await vi.dynamicImportSettled()

    expect(autopilot.lastSnapshotForScreen('market')).not.toBeNull()
    expect(wrapper.text()).toContain('Needs Review')
  })

  it('shows imported durable dashboard records inside screen source panels', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'Country-wise consumption growth - China',
      value: 'Trade proxy / To Verify',
      evidenceStatus: 'Trade Proxy',
      confidence: 'medium',
      source: { title: 'UN Comtrade', url: 'https://comtradeplus.un.org' },
    })
    intelligence.addDataRoomSource({
      checklistLabel: 'Raw material trade proxy',
      area: 'market',
      dashboardGroup: 'rawMaterialSignals',
      evidenceStatus: 'To Verify',
      source: { title: 'China Customs source candidate', date: '2026-06-03' },
      notes: 'Imported by Full Dashboard Autopilot.',
    })
    intelligence.addResearchFinding({
      summary: 'Market growth claim requires official source review.',
      keyClaim: 'Growth Rate: To Verify',
      area: 'market',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: { title: 'Weak market reference', url: 'https://example.com/market' },
      riskNote: 'Growth rate is investor-impacting and must be reviewed.',
      dashboardTarget: {
        group: 'marketClaims',
        screen: 'market',
        field: 'Growth Rate',
        value: 'To Verify',
      },
    })

    const wrapper = mount(TrustedSourceAutopilotPanel, {
      props: { screen: 'market', title: 'Market Auto Source Status' },
    })
    const text = wrapper.text()

    expect(text).toContain('Imported dashboard records')
    expect(text).toContain('3 imported dashboard records visible on this screen.')
    expect(text).toContain('Market claims')
    expect(text).toContain('Trade / raw material signals')
    expect(text).toContain('Needs review')
    expect(wrapper.findAll('.durable-status-card')).toHaveLength(3)
    expect(wrapper.findAll('.durable-status-card').map(card => card.text())).toEqual([
      expect.stringContaining('Market claims1'),
      expect.stringContaining('Trade / raw material signals1'),
      expect.stringContaining('Needs review1'),
    ])
  })

  it('shows live imported intelligence counts from durable dashboard state', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'Country-wise consumption growth - China',
      value: 'Trade proxy / To Verify',
      evidenceStatus: 'Trade Proxy',
      confidence: 'medium',
      source: { title: 'UN Comtrade', url: 'https://comtradeplus.un.org' },
    })
    intelligence.addCompetitor({
      companyName: 'Evonik Industries',
      countryRegion: 'Germany',
      productEquivalent: 'Esterquat / textile softener portfolio',
      activeContent: 'To Verify',
      pricingEvidence: 'To Verify',
      certifications: 'Official company source needed',
      distributionPresence: 'Global',
      marketShare: '',
      evidenceStatus: 'Source-backed',
      source: { title: 'Evonik official website', url: 'https://www.evonik.com/' },
      notes: 'Imported by Full Dashboard Autopilot.',
    })
    intelligence.addDataRoomSource({
      checklistLabel: 'Stearic acid supplier scorecard',
      area: 'factory',
      dashboardGroup: 'supplierScorecards',
      supplier: 'Supplier Candidate',
      material: 'Stearic Acid TP',
      proposedValue: 'Quote evidence candidate',
      sourceTier: 'tier3-supplier-evidence',
      dataType: 'supplier_quote',
      confidence: 'medium',
      evidenceStatus: 'To Verify',
      source: { title: 'Supplier quote upload', date: '2026-06-02' },
      notes: 'Supplier score and price are review-gated.',
    })
    intelligence.addResearchFinding({
      summary: 'Competitor market share claim needs owner review.',
      keyClaim: 'Competitor market share: To Verify',
      area: 'market',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: { title: 'Weak public listing', url: 'https://example.com/listing' },
      riskNote: 'Market share is not source-backed enough.',
      dashboardTarget: {
        group: 'competitorRecords',
        screen: 'competitor',
        field: 'Market share',
        value: 'To Verify',
      },
    })
    intelligence.addResearchJob({
      title: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      question: 'Automatically research trusted online sources for dashboard updates.',
      context: 'Chemicon China Feasibility',
      status: 'Scheduled Hermes Job',
      scheduledJobId: 'job-full-dashboard',
      schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    })

    const wrapper = mount(TrustedSourcesView)
    const text = wrapper.text()

    expect(text).toContain('Live imported intelligence')
    expect(text).toContain('Automatic dashboard filling status')
    expect(text).toContain('Durable intelligence is active. 5 imported records are available to dashboard pages.')
    expect(text).toContain('Market and country signals')
    expect(text).toContain('Competitor records')
    expect(text).toContain('Supplier and data-room sources')
    expect(text).toContain('Research review findings')
    expect(text).toContain('Scheduled research jobs')
    expect(wrapper.findAll('.imported-intelligence-row')).toHaveLength(5)
    expect(wrapper.findAll('.imported-intelligence-row').map(row => row.text())).toEqual([
      expect.stringContaining('Market and country signals'),
      expect.stringContaining('Competitor records'),
      expect.stringContaining('Supplier and data-room sources'),
      expect.stringContaining('Research review findings'),
      expect.stringContaining('Scheduled research jobs'),
    ])
  })

  it('renders live server job status for the full dashboard autopilot', async () => {
    listJobsMock.mockResolvedValue([{
      id: 'job-full-dashboard',
      job_id: 'job-full-dashboard',
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      prompt: 'Research trusted-source dashboard_updates for the full dashboard',
      schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      schedule_display: '07:00 / 19:00',
      enabled: true,
      state: 'scheduled',
      last_run_at: '2026-06-03T07:00:00.000Z',
      next_run_at: '2026-06-03T19:00:00.000Z',
      last_status: 'completed',
      last_error: null,
    }])
    vi.mocked(listCronRuns).mockResolvedValue([{
      jobId: 'job-full-dashboard',
      fileName: '2026-06-03T07-00-00.md',
      runTime: '2026-06-03T07:00:00.000Z',
      size: 2048,
      hasOutput: true,
    }])
    fetchDashboardAutopilotImportStatusMock.mockResolvedValue({
      ok: true,
      profile: 'default',
      autopilotImport: {
        profile: 'default',
        jobCount: 1,
        outputCount: 1,
        importedRunCount: 0,
        pendingOutputCount: 1,
        latestOutputRunKey: 'job-full-dashboard/2026-06-03T07-00-00.md',
        latestOutputFile: '2026-06-03T07-00-00.md',
        latestOutputAt: '2026-06-03T07:05:00.000Z',
        latestOutputImported: false,
        latestOutputParseStatus: 'ready',
        latestOutputCandidateCount: 3,
        latestOutputParseError: '',
        latestImportedRunKey: '',
        registryUpdatedAt: '',
        latestDueSlotAt: '2026-06-03T07:00:00.000Z',
        latestDueSlotSatisfied: true,
        latestDueSlotAttemptedAt: '2026-06-03T07:01:00.000Z',
        latestDueSlotRunError: '',
      },
    })

    const wrapper = mount(TrustedSourcesView)
    await vi.dynamicImportSettled()

    const text = wrapper.text()
    expect(text).toContain('Server job status')
    expect(text).toContain('Hermes research job is connected')
    expect(text).toContain('The latest Hermes output has 3 source-backed candidate items ready for the source-gated importer')
    expect(text).toContain('job-full-dashboard')
    expect(text).toContain('Readable outputs')
    expect(text).toContain('Latest imported')
    expect(text).toContain('Parse status')
    expect(text).toContain('ready')
    expect(text).toContain('Candidate items')
    expect(text).toContain('3')
    expect(text).toContain('Due slot')
    expect(text).toContain('Due satisfied')
    expect(text).toContain('Last server kick')
    expect(text).toContain('No / pending')
    expect(text).toContain('Yes')
    expect(text).toContain('Latest file: 2026-06-03T07-00-00.md')
  })

  it('enables the full dashboard autopilot schedule and starts the first Hermes run immediately', async () => {
    vi.mocked(listCronRuns).mockResolvedValue([])
    const wrapper = mount(TrustedSourcesView)

    await wrapper.findAll('button').find(button => button.text().includes('Enable Full Autopilot'))!.trigger('click')
    await vi.dynamicImportSettled()

    expect(createJobMock).toHaveBeenCalledWith(expect.objectContaining({
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      deliver: 'local',
    }))
    expect(runJobMock).toHaveBeenCalledWith('job-1')
    expect(loadFullDashboardAutopilotStatus()).toMatchObject({
      enabled: true,
      scheduledJobId: 'job-1',
    })
    expect(loadFullDashboardAutopilotStatus().lastStatus).toContain('first Hermes trusted-source research run has started')
  })
})
