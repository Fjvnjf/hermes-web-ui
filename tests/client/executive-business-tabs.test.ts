// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExecutiveOverviewView from '@/views/hermes/ExecutiveOverviewView.vue'
import InvestmentAnalysisView from '@/views/hermes/InvestmentAnalysisView.vue'
import MarketIntelligenceView from '@/views/hermes/MarketIntelligenceView.vue'
import CompetitorIntelligenceView from '@/views/hermes/CompetitorIntelligenceView.vue'
import RawMaterialSourcingView from '@/views/hermes/RawMaterialSourcingView.vue'
import ExportMarketOpportunityView from '@/views/hermes/ExportMarketOpportunityView.vue'
import RegulatoryIntelligenceView from '@/views/hermes/RegulatoryIntelligenceView.vue'
import InvestorReadinessView from '@/views/hermes/InvestorReadinessView.vue'
import InvestorPresentationBuilderView from '@/views/hermes/InvestorPresentationBuilderView.vue'
import TrustedSourcesView from '@/views/hermes/TrustedSourcesView.vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { canAccessRouteName } from '@/utils/accessControl'
import {
  EXECUTIVE_REFRESH_SCHEDULE,
  competitorMarketShare,
  defaultExecutiveRefreshState,
} from '@/utils/executiveIntelligence'

const createTaskMock = vi.hoisted(() => vi.fn())
const createJobMock = vi.hoisted(() => vi.fn())
const fetchJobsMock = vi.hoisted(() => vi.fn())
const fetchBoardsMock = vi.hoisted(() => vi.fn())
const setSelectedBoardMock = vi.hoisted(() => vi.fn())
const apiRequestMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/hermes/kanban', () => ({
  DEFAULT_KANBAN_BOARD: 'default',
  useKanbanStore: () => ({
    selectedBoard: 'default',
    fetchBoards: fetchBoardsMock,
    resolveAvailableBoard: () => 'default',
    setSelectedBoard: setSelectedBoardMock,
    createTask: createTaskMock,
  }),
}))

vi.mock('@/stores/hermes/jobs', () => ({
  useJobsStore: () => ({
    jobs: [],
    fetchJobs: fetchJobsMock,
    createJob: createJobMock,
  }),
}))

vi.mock('@/api/client', () => ({
  getStoredUserRole: () => 'super_admin',
  request: apiRequestMock,
}))

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  NAlert: { template: '<div class="n-alert"><slot /></div>' },
  NButton: { template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' },
  NDrawer: { template: '<div class="n-drawer"><slot /></div>' },
  NDrawerContent: { template: '<div class="n-drawer-content"><slot /></div>' },
  NSelect: { template: '<div class="n-select"><slot /></div>' },
  NSwitch: { template: '<button class="n-switch" v-bind="$attrs" @click="$emit(\'update:value\', true)"><slot /></button>' },
  NTag: { template: '<span class="n-tag"><slot /></span>' },
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    RouterLink: {
      props: ['to'],
      template: '<a class="router-link"><slot /></a>',
    },
  }
})

function metricEvidence(value: string, source: { title: string, url?: string, date?: string }, evidenceStatus = 'Source-backed', confidence = 'high') {
  return {
    value,
    source,
    evidenceStatus,
    confidence,
    reviewRequired: false,
    lastChecked: source.date,
  } as const
}

describe('screenshot-matched executive business tabs', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('hermes.frontendAccessRole', 'owner')
    useFeasibilityIntelligence().resetFeasibilityIntelligenceForTests()
    createTaskMock.mockReset().mockResolvedValue({ id: 'task-1' })
    createJobMock.mockReset().mockResolvedValue({ id: 'job-1', job_id: 'job-1' })
    fetchJobsMock.mockReset().mockResolvedValue(undefined)
    fetchBoardsMock.mockReset().mockResolvedValue(undefined)
    setSelectedBoardMock.mockReset()
    apiRequestMock.mockReset().mockImplementation(async (url: string) => {
      if (url.includes('/api/hermes/jobs')) return { jobs: [] }
      if (url.includes('/api/hermes/intelligence-state')) {
        return {
          ok: true,
          profile: 'default',
          savedAt: null,
          state: null,
          autopilotImport: {
            profile: 'default',
            jobCount: 0,
            outputCount: 0,
            importedRunCount: 0,
            pendingOutputCount: 0,
            latestOutputRunKey: '',
            latestOutputFile: '',
            latestOutputAt: '',
            latestOutputImported: false,
            latestImportedRunKey: '',
            registryUpdatedAt: '',
            latestDueSlotAt: '',
            latestDueSlotSatisfied: false,
            latestDueSlotAttemptedAt: '',
            latestDueSlotRunError: '',
          },
        }
      }
      return {}
    })
  })

  it('renders Executive Overview KPI cards, daily brief, and twice-daily metadata', () => {
    const wrapper = mount(ExecutiveOverviewView)

    expect(wrapper.text()).toContain('Executive Overview')
    expect(wrapper.text()).toContain('Hermes Executive Intelligence')
    expect(wrapper.text()).toContain('Executive Intelligence Board')
    expect(wrapper.text()).toContain('Hermes Daily Brief')
    expect(wrapper.text()).toContain('No daily brief generated yet')
    expect(wrapper.text()).toContain('Generate Daily Brief')
    expect(wrapper.text()).toContain('Revenue Target')
    expect(wrapper.text()).toContain('EQ Capacity MT/YR')
    expect(wrapper.text()).toContain('Projected IRR')
    expect(wrapper.text()).toContain('Payback Period')
    expect(wrapper.text()).toContain('Blended ASP/MT')
    expect(wrapper.text()).toContain('NPV @ 12%')
    expect(wrapper.text()).toContain('Generate Investor Brief')
    expect(wrapper.text()).toContain('Backup Now')
    expect(wrapper.text()).toContain('09:00 / 21:00')
    expect(defaultExecutiveRefreshState().schedule).toBe(EXECUTIVE_REFRESH_SCHEDULE)
  })

  it('shows Hermes Daily Brief items when session capture or research data exists', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'Night research job',
      question: 'Verify market source',
      context: 'Chemicon China Feasibility',
      status: 'Manual Research Job',
    })

    const wrapper = mount(ExecutiveOverviewView)

    expect(wrapper.text()).toContain('1 research job record')
    expect(wrapper.text()).not.toContain('No daily brief generated yet')
  })

  it('keeps unsourced financial scenarios out of Executive Overview command cards', () => {
    useFeasibilityIntelligence().saveFinancialModelSnapshot({
      scenarioName: 'Unsafe Verified Scenario',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Verified',
      npv: 125000,
      irr: 0.18,
      mirr: 0.14,
      investorMoic: 2.1,
      paybackYear: 4,
      breakEvenVolumeTon: 5000,
      capexTotal: 2500000,
      yearOneRevenue: 3000000,
      warnings: ['Inputs still require source evidence.'],
      source: null,
    })

    const wrapper = mount(ExecutiveOverviewView)
    const investmentCard = wrapper.findAll('.command-card')
      .find(card => card.text().includes('Investment Analysis'))

    expect(investmentCard).toBeTruthy()
    expect(investmentCard!.text()).toContain('No approved source-backed value')
    expect(investmentCard!.text()).not.toContain('Unsafe Verified Scenario')
  })

  it('keeps Investment Analysis values in source review until an IRR Calculator snapshot exists', () => {
    useFeasibilityIntelligence().addDataRoomSource({
      checklistLabel: 'Process equipment quote benchmark',
      area: 'financial',
      dashboardGroup: 'financialEvidence',
      proposedValue: 'Vendor quote benchmark found; capex amount requires owner review',
      sourceTier: 'tier3-supplier-evidence',
      dataType: 'financial_data',
      confidence: 'medium',
      evidenceStatus: 'To Verify',
      source: {
        title: 'Uploaded vendor quote evidence',
        url: 'https://example.com/vendor-quote',
      },
      notes: [
        'Autopilot candidate from financialEvidence.',
        'Proposed value: Vendor quote benchmark found; capex amount requires owner review',
        'Source tier: tier3-supplier-evidence',
        'This record was auto-staged to make the dashboard useful without manual copy-paste. It is not investor-approved.',
      ].join('\n'),
    })

    const wrapper = mount(InvestmentAnalysisView)

    expect(wrapper.text()).toContain('Investment Analysis')
    expect(wrapper.text()).toContain('Investor Economics Control Panel')
    expect(wrapper.text()).toContain('Autopilot Financial Evidence Candidates')
    expect(wrapper.text()).toContain('Process equipment quote benchmark')
    expect(wrapper.get('.financial-autopilot-panel').text()).toContain('Review required')
    expect(wrapper.get('.financial-autopilot-panel').text()).not.toContain('Vendor quote benchmark found; capex amount requires owner review')
    expect(wrapper.text()).toContain('Uploaded vendor quote evidence')
    expect(wrapper.text()).toContain('tier3-supplier-evidence / medium')
    expect(wrapper.text()).toContain('Process Equipment Detail')
    expect(wrapper.text()).toContain('Utilities & Buildings Detail')
    expect(wrapper.text()).toContain('Working Capital Detail')
    expect(wrapper.text()).toContain('Total Investment')
    expect(wrapper.text()).toContain('Project IRR')
    expect(wrapper.text()).not.toContain('NPV @ 12%')
    expect(wrapper.text()).toContain('Payback Period')
    expect(wrapper.text()).toContain('Profitability Index')
    expect(wrapper.text()).toContain('5-Year ROI')
    expect(wrapper.get('.kpi-grid').text()).toContain('NPV (saved model rate)')
    expect(wrapper.get('.kpi-grid').text()).not.toContain('NPV @ 12%')
    expect(wrapper.text()).toContain('Scenario Selector')
    expect(wrapper.text()).toContain('Scenario not filled yet')
    expect(wrapper.text()).toContain('No approved source-backed value')
    expect(wrapper.text()).toContain('Awaiting trusted-source import')
    expect(wrapper.text()).not.toMatch(/Hermes\s+verifying\s+twice\s+daily/i)
    expect(wrapper.text()).not.toMatch(/Missing\s*\/\s*Hermes\s+verifying\s+twice\s+daily/i)
    expect(wrapper.text()).not.toContain('Reference-only project analysis template')
    expect(wrapper.text()).not.toContain('Reference Template / User PDF Archive')
    expect(wrapper.text()).not.toContain('Reference value archived')
    expect(wrapper.text()).not.toContain('Scale-Up Esterquat Plant Project Analysis Template')
    expect(wrapper.text()).toContain('Derived from Assumptions')
    expect(wrapper.text()).not.toContain('$16M')
    expect(wrapper.text()).not.toContain('$49.8M')
    expect(wrapper.text()).not.toContain('4.1x')
    expect(wrapper.text()).not.toContain('$16,000,000')
    expect(wrapper.text()).not.toContain('$135M')
    expect(wrapper.text()).not.toContain('50%')
    expect(wrapper.find('.project-analysis-template').exists()).toBe(false)
    expect(wrapper.find('.pdf-project-analysis-panel').exists()).toBe(false)
    expect(wrapper.get('.kpi-grid').text()).not.toContain('To Verify')
    expect(wrapper.get('.analysis-grid').text()).not.toContain('To Verify')
  })

  it('lets Investment Analysis select scenarios without inventing missing values', async () => {
    useFeasibilityIntelligence().saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Assumption',
      npv: 125000,
      irr: 0.18,
      mirr: 0.14,
      investorMoic: 2.1,
      paybackYear: 4,
      breakEvenVolumeTon: 5000,
      capexTotal: 2500000,
      yearOneRevenue: 3000000,
      warnings: ['Inputs still require source evidence.'],
      source: null,
    })

    const wrapper = mount(InvestmentAnalysisView)
    const kpiGrid = () => wrapper.get('.kpi-grid').text()
    expect(kpiGrid()).toContain('18.0%')
    expect(kpiGrid()).toContain('$125,000')
    expect(kpiGrid()).toContain('Year 4')
    expect(kpiGrid()).toContain('1.05x')
    expect(kpiGrid()).toContain('110.0%')
    expect(kpiGrid()).toContain('Derived from Assumptions')
    expect(kpiGrid()).toContain('NPV (saved model rate)')
    expect(kpiGrid()).not.toContain('NPV @ 12%')

    await wrapper.findAll('button').find(button => button.text() === 'Lean')!.trigger('click')
    expect(wrapper.text()).toContain('Scenario not filled yet')
    expect(kpiGrid()).toContain('No approved source-backed value')
    expect(kpiGrid()).not.toContain('18.0%')
    expect(kpiGrid()).not.toContain('$125,000')
    expect(wrapper.text()).not.toMatch(/Missing\s*\/\s*Hermes\s+verifying\s+twice\s+daily/i)
  })

  it('labels Investment Analysis saved financial outputs as Derived from Assumptions for investor safety', () => {
    useFeasibilityIntelligence().saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'User Provided',
      npv: 125000,
      irr: 0.18,
      mirr: 0.14,
      investorMoic: 2.1,
      paybackYear: 4,
      breakEvenVolumeTon: 5000,
      capexTotal: 2500000,
      yearOneRevenue: 3000000,
      warnings: ['Inputs still require source evidence.'],
      source: null,
    })

    const wrapper = mount(InvestmentAnalysisView)
    const kpiGrid = wrapper.get('.kpi-grid').text()
    expect(kpiGrid).toContain('18.0%')
    expect(kpiGrid).toContain('Derived from Assumptions')
    expect(kpiGrid).toContain('Saved financial model / Derived from Assumptions')
    expect(kpiGrid).not.toContain('User Provided')
    expect(kpiGrid).not.toContain('Verified')
  })

  it('gates unsupported verified financial snapshots on the primary Investment Analysis surface', () => {
    useFeasibilityIntelligence().saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Verified',
      npv: 125000,
      irr: 0.18,
      mirr: 0.14,
      investorMoic: 2.1,
      paybackYear: 4,
      breakEvenVolumeTon: 5000,
      capexTotal: 2500000,
      yearOneRevenue: 3000000,
      warnings: ['Inputs still require source evidence.'],
      source: null,
    })

    const wrapper = mount(InvestmentAnalysisView)
    const kpiGrid = wrapper.get('.kpi-grid').text()
    expect(kpiGrid).toContain('No approved source-backed value')
    expect(kpiGrid).not.toContain('18.0%')
    expect(kpiGrid).not.toContain('$125,000')
    expect(kpiGrid).not.toContain('Verified')
  })

  it('shows Investment Analysis source metadata when a financial snapshot has usable source backing', () => {
    useFeasibilityIntelligence().saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Verified',
      npv: 125000,
      irr: 0.18,
      mirr: 0.14,
      investorMoic: 2.1,
      paybackYear: 4,
      breakEvenVolumeTon: 5000,
      capexTotal: 2500000,
      yearOneRevenue: 3000000,
      warnings: ['Inputs trace to approved workbook.'],
      source: {
        title: 'Approved IRR workbook',
        date: '2026-06-01',
      },
    })

    const wrapper = mount(InvestmentAnalysisView)
    const kpiGrid = wrapper.get('.kpi-grid').text()
    expect(kpiGrid).toContain('18.0%')
    expect(kpiGrid).toContain('$125,000')
    expect(kpiGrid).toContain('Verified')
    expect(kpiGrid).toContain('Approved IRR workbook (2026-06-01)')
    expect(kpiGrid).toContain('source-backed approved input')
    expect(kpiGrid).not.toContain('Derived from Assumptions')
  })

  it('shows Market Intelligence values and competitor market share as source review when unsourced', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'China market size',
      value: '',
      evidenceStatus: 'Source-backed',
      source: null,
    })
    intelligence.addMarketClaim({
      label: 'Country-wise consumption growth - China',
      value: 'Country-wise trade-proxy growth: China: +100.0% YoY trade proxy (US$236.6M vs US$118.3M, 2024/2023)',
      evidenceStatus: 'To Verify',
      confidence: 'high',
      source: { title: 'UN Comtrade Plus', url: 'https://comtradeplus.un.org', date: '2024' },
      lastChecked: '2024-12-31',
    })
    intelligence.addMarketClaim({
      label: 'Review-only market reference size',
      value: 'USD 9.99B unsupported market-reference estimate',
      evidenceStatus: 'Market Reference',
      confidence: 'medium',
      source: { title: 'Market reference page', url: 'https://example.com/market-reference', date: '2026-01-01' },
      lastChecked: '2026-01-01',
    })
    intelligence.addCompetitor({
      companyName: 'Example supplier',
      countryRegion: 'China',
      productEquivalent: 'CWAS equivalent',
      activeContent: 'To Verify',
      pricingEvidence: 'To Verify',
      certifications: 'To Verify',
      distributionPresence: 'To Verify',
      marketShare: '',
      evidenceStatus: 'To Verify',
      source: null,
      notes: '',
    })

    const wrapper = mount(MarketIntelligenceView)
    const marketText = wrapper.text()
    const marketTextLower = marketText.toLowerCase()

    expect(wrapper.get('.summary-card').text()).toContain('0')
    expect(wrapper.get('.summary-card').text()).toContain('approved source claims')
    expect(wrapper.text()).toContain('Executive Market Panel')
    expect(wrapper.text()).toContain('Owner research permission active')
    expect(wrapper.text()).toContain('Hermes may research trusted public, company, regulatory, supplier, and uploaded evidence sources.')
    expect(wrapper.text()).toContain('Unknown or conflicting data stays in source review')
    expect(wrapper.text()).toContain('Automatic market research')
    expect(wrapper.text()).toContain('Hermes researches the market and fills only source-backed evidence')
    expect(wrapper.text()).toContain('Market data')
    expect(wrapper.text()).toContain('Country growth')
    expect(wrapper.text()).toContain('Review gate')
    expect(wrapper.text()).toContain('Review staged market findings')
    expect(wrapper.text()).toContain('Autopilot status')
    expect(wrapper.text()).toContain('Competitor analysis')
    expect(wrapper.text()).toContain('Simple global market map')
    expect(wrapper.text()).toContain('Where Hermes Should Focus Market Research Next')
    expect(wrapper.text()).toContain('Countries tracked')
    expect(wrapper.text()).toContain('Auto-imported')
    expect(wrapper.text()).toContain('Source-attached signals')
    expect(wrapper.text()).toContain('Need direct proof')
    expect(wrapper.text()).toContain('Create research task')
    expect(marketTextLower).toContain('global market intelligence')
    expect(wrapper.text()).toContain('Textile Softeners, Esterquats, and Export-Market Signals')
    expect(wrapper.get('.global-market-intelligence').text()).toContain('No imported trusted-source global market claims yet')
    expect(wrapper.get('.claims-panel').text()).toContain('Country-wise consumption growth - China')
    expect(wrapper.get('.claims-panel').text()).toContain('Review required')
    expect(wrapper.get('.global-market-intelligence').text()).not.toContain('USD 9.99B unsupported market-reference estimate')
    expect(wrapper.get('.global-market-intelligence').text()).not.toContain('China textile-chemicals anchor')
    expect(wrapper.get('.global-market-intelligence').text()).not.toContain('Global esterquat reference market')
    expect(wrapper.text()).toContain('Global Opportunity Map')
    expect(wrapper.text()).toContain('Country-wise Consumption Growth Tracker')
    expect(wrapper.text()).toContain('direct textile-softener proof')
    expect(wrapper.text()).toContain('No imported trusted-source country growth rows yet')
    expect(wrapper.text()).not.toContain('China: +100.0% YoY trade proxy')
    expect(wrapper.text()).toContain('UN Comtrade Plus')
    expect(wrapper.get('.claims-panel').text()).toContain('Confidence: high')
    expect(wrapper.get('.claims-panel').text()).toContain('Last checked: 2024-12-31')
    expect(wrapper.find('.country-growth-table').exists()).toBe(false)
    expect(wrapper.get('.market-map-brief').text()).not.toContain('Trade Proxy')
    expect(wrapper.text()).not.toContain('official trade data, not direct textile-softener consumption')
    expect(wrapper.text()).not.toContain('Official trade-proxy import/export signal')
    expect(wrapper.text()).toContain('Reference Source Pack')
    expect(wrapper.text()).toContain('Market Research Questions Hermes Should Answer')
    expect(wrapper.text()).toContain('User PDF reference')
    expect(wrapper.text()).toContain('Imported Market Tables From Your Document')
    expect(wrapper.text()).toContain('China Import Data - Quaternary Ammonium Textile Agents')
    expect(wrapper.text()).toContain('South Korea')
    expect(wrapper.text()).toContain('Country-wise Cationic Softener Consumption')
    expect(wrapper.text()).toContain('Market Segmentation Snapshot')
    expect(wrapper.text()).toContain('Reference value archived')
    expect(wrapper.get('.market-command-panel').text()).not.toContain('65,409')
    expect(wrapper.get('.market-command-panel').text()).not.toContain('USD 9.99B unsupported market-reference estimate')
    expect(wrapper.text()).not.toContain('$3.2B')
    expect(wrapper.text()).not.toContain('$120M')
    expect(wrapper.text()).toContain('Reference only')
    expect(wrapper.text()).toContain('Market Size / Scope')
    expect(wrapper.text()).toContain('Import Dependence')
    expect(wrapper.text()).toContain('Market Segmentation Table')
    expect(wrapper.text()).toContain('Target Countries / Provinces')
    expect(wrapper.get('.segmentation-panel').text()).toContain('No approved source-backed segment')
    expect(wrapper.get('.target-panel').text()).toContain('No approved source-backed target region')
    expect(wrapper.text()).toContain('Research HS Codes')
    expect(wrapper.text()).toContain('No approved source-backed value')
    expect(wrapper.text()).not.toContain('Example supplier')
    expect(wrapper.text()).toContain('Awaiting trusted-source import')
    expect(wrapper.text()).not.toMatch(/Hermes\s+verifying\s+twice\s+daily/i)
    expect(wrapper.text()).not.toMatch(/Missing\s*\/\s*Hermes\s+verifying\s+twice\s+daily/i)
    for (const selector of [
      '.market-map-brief',
      '.global-market-intelligence',
      '.pdf-reference-pack',
      '.screenshot-market-template',
      '.market-command-panel',
      '.claims-panel',
    ]) {
      expect(wrapper.get(selector).text()).not.toContain('To Verify')
    }
    expect(competitorMarketShare('', null, 'Verified')).toBe('To Verify')
  })

  it('renders approved trusted-source market claims while hiding review-gated reference values', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'Market Size / Scope',
      value: 'Official source-backed market scope',
      evidenceStatus: 'Official Data',
      confidence: 'high',
      source: { title: 'Official market bulletin', url: 'https://example.gov/market', date: '2026-06-05' },
      lastChecked: '2026-06-06',
      proposedDashboardField: 'Market Size / Scope',
      fieldKey: 'market.size.scope',
      reviewRequired: false,
    })
    intelligence.addMarketClaim({
      label: 'Cationic textile softener segment',
      value: 'Source-backed cationic segment present',
      evidenceStatus: 'Source-backed',
      confidence: 'medium',
      source: { title: 'Official segment source', url: 'https://example.gov/segment', date: '2026-06-04' },
      lastChecked: '2026-06-06',
      proposedDashboardField: 'Cationic / Ester Quat',
      fieldKey: 'market.segment.cationic',
      reviewRequired: false,
    })
    intelligence.addMarketClaim({
      label: 'Target Countries / Provinces',
      value: 'Zhejiang textile cluster source-backed',
      evidenceStatus: 'Official Data',
      confidence: 'high',
      source: { title: 'Official province source', url: 'https://example.gov/province', date: '2026-06-03' },
      lastChecked: '2026-06-06',
      proposedDashboardField: 'Target Countries / Provinces',
      fieldKey: 'market.target.zhejiang',
      reviewRequired: false,
    })
    intelligence.addMarketClaim({
      label: 'Global market CAGR',
      value: '999% fake CAGR',
      evidenceStatus: 'Market Reference',
      confidence: 'low',
      source: { title: 'Weak market reference', url: 'https://example.com/reference', date: '2026-06-01' },
      lastChecked: '2026-06-06',
      reviewRequired: true,
    })

    const wrapper = mount(MarketIntelligenceView)
    const text = wrapper.text()

    expect(wrapper.get('.summary-card').text()).toContain('3')
    expect(wrapper.get('.market-command-panel').text()).toContain('Official source-backed market scope')
    expect(wrapper.get('.global-market-intelligence').text()).toContain('Official market bulletin')
    expect(wrapper.get('.global-market-intelligence').text()).toContain('Confidence: high')
    expect(wrapper.get('.global-market-intelligence').text()).toContain('Last checked: 2026-06-06')
    expect(wrapper.get('.segmentation-panel').text()).toContain('Cationic / Ester Quat')
    expect(wrapper.get('.segmentation-panel').text()).toContain('Source-backed cationic segment present')
    expect(wrapper.get('.target-panel').text()).toContain('Zhejiang')
    expect(wrapper.get('.target-panel').text()).toContain('Official province source')
    expect(wrapper.get('.claims-panel').text()).toContain('Weak market reference')
    expect(wrapper.get('.claims-panel').text()).toContain('Review required')
    expect(text).not.toContain('999% fake CAGR')
  })

  it('documents trusted-source research permission and evidence rules', () => {
    const wrapper = mount(TrustedSourcesView)

    expect(wrapper.text()).toContain('Hermes can research trusted sources')
    expect(wrapper.text()).toContain('Owner-approved research is active')
    expect(wrapper.text()).toContain('Twice-daily trusted research')
    expect(wrapper.text()).toContain('Extract important data')
    expect(wrapper.text()).toContain('Attach evidence label')
    expect(wrapper.text()).toContain('Auto-stage critical items')
    expect(wrapper.text()).toContain('Fill only safe source-backed fields')
    expect(wrapper.text()).toContain('Unsupported market size, CAGR, market share, pricing, cost, IRR, or NPV values stay in source review until approved evidence arrives.')
  })

  it('renders Competitor Intelligence product context, landscape, and source-gated market share chart', () => {
    useFeasibilityIntelligence().addCompetitor({
      companyName: 'Source Backed Softener Co',
      countryRegion: 'China',
      productEquivalent: 'CWAS equivalent',
      activeContent: '90% active',
      pricingEvidence: '$24/kg source-backed',
      certifications: 'Company product certificate',
      distributionPresence: 'Official distributor page',
      marketShare: '7% source-backed',
      revenue: '$42M source-backed',
      yearlyGrowth: '+8% source-backed',
      traffic: '1.2M visits source-backed',
      rating: '4.8 source-backed',
      lastUpdated: '2026-06-05',
      confidence: 'high',
      evidenceStatus: 'Source-backed',
      source: { title: 'Official annual profile', url: 'https://example.com/annual-profile', date: '2026-06-05' },
      metricEvidence: {
        pricingEvidence: metricEvidence('$24/kg source-backed', { title: 'Official annual profile', url: 'https://example.com/annual-profile', date: '2026-06-05' }),
        marketShare: metricEvidence('7% source-backed', { title: 'Official annual profile', url: 'https://example.com/annual-profile', date: '2026-06-05' }),
        revenue: metricEvidence('$42M source-backed', { title: 'Official annual profile', url: 'https://example.com/annual-profile', date: '2026-06-05' }),
        yearlyGrowth: metricEvidence('+8% source-backed', { title: 'Official annual profile', url: 'https://example.com/annual-profile', date: '2026-06-05' }),
        traffic: metricEvidence('1.2M visits source-backed', { title: 'Official annual profile', url: 'https://example.com/annual-profile', date: '2026-06-05' }),
        rating: metricEvidence('4.8 source-backed', { title: 'Official annual profile', url: 'https://example.com/annual-profile', date: '2026-06-05' }),
        lastUpdated: metricEvidence('2026-06-05', { title: 'Official annual profile', url: 'https://example.com/annual-profile', date: '2026-06-05' }),
      },
      notes: 'Revenue and growth should appear when source-backed.',
    })
    const wrapper = mount(CompetitorIntelligenceView)
    const competitorText = wrapper.text()
    const competitorTextLower = competitorText.toLowerCase()

    expect(wrapper.text()).toContain('Product Context Panel')
    expect(wrapper.text()).toContain('Cationic Softeners / CHEMISOFT')
    expect(wrapper.text()).toContain('CHEMISIL HS 200')
    expect(wrapper.text()).toContain('Single Competitor Intelligence Table')
    expect(wrapper.text()).toContain('Product category')
    expect(wrapper.text()).toContain('Evidence state')
    const comparisonHeaderText = wrapper.get('.comparison-grid-row.head').text()
    expect(comparisonHeaderText).toContain('PRICE')
    expect(comparisonHeaderText).toContain('MARKET SHARE')
    expect(comparisonHeaderText).toContain('REVENUE')
    expect(comparisonHeaderText).toContain('YOY GROWTH')
    expect(comparisonHeaderText).toContain('TRAFFIC')
    expect(comparisonHeaderText).toContain('RATING')
    expect(comparisonHeaderText).toContain('LAST UPDATED')
    expect(comparisonHeaderText).toContain('CONFIDENCE')
    expect(comparisonHeaderText).toContain('SOURCE')
    expect(comparisonHeaderText).toContain('LEADER')
    expect(comparisonHeaderText).toContain('NEXT ACTION')
    expect(wrapper.text()).toContain('No source-backed leader badge')
    expect(wrapper.text()).not.toContain('📈 Fastest Growth')
    expect(wrapper.text()).not.toContain('💰 Highest Revenue')
    expect(wrapper.text()).not.toContain('🔥 Most Competitive Pricing')
    expect(wrapper.text()).toContain('Reference templates, charts, and manual evidence tools')
    expect(wrapper.text()).toContain('Competitor Landscape Table')
    expect(wrapper.text()).toContain('Competitor Market Share Chart')
    expect(wrapper.text()).toContain('Source Backed Softener Co')
    expect(wrapper.text()).toContain('Competitors Tab Template')
    expect(wrapper.text()).toContain('Transfar Chemicals')
    expect(wrapper.text()).toContain('WACKER')
    expect(wrapper.text()).toContain('RUDOLF Group')
    expect(wrapper.text()).toContain('CHT Group')
    expect(wrapper.text()).toContain('Archroma')
    expect(wrapper.text()).toContain('Zschimmer & Schwarz')
    expect(wrapper.text()).toContain('Reference only. Not source-backed. Use Trusted Sources / Research Review to verify before use')
    expect(wrapper.text()).toContain('Competitor Product / Price / Share / Revenue / Growth')
    expect(wrapper.text()).toContain('One table for the numbers you asked for')
    expect(wrapper.text()).toContain('Product focus')
    expect(wrapper.text()).toContain('Price/kg')
    expect(wrapper.text()).toContain('Market share')
    expect(wrapper.text()).toContain('Revenue')
    expect(wrapper.text()).toContain('Yearly growth')
    expect(wrapper.text()).toContain('Source Backed Softener Co')
    expect(wrapper.text()).toContain('$24/kg source-backed')
    expect(wrapper.text()).toContain('7% source-backed')
    expect(wrapper.text()).toContain('$42M source-backed')
    expect(wrapper.text()).toContain('+8% source-backed')
    expect(wrapper.text()).toContain('1.2M visits source-backed')
    expect(wrapper.text()).toContain('4.8 source-backed')
    expect(wrapper.text()).toContain('high')
    expect(wrapper.text()).not.toMatch(/Hermes\s+verifying\s+twice\s+daily/i)
    expect(competitorTextLower).toContain('global competitor analysis')
    expect(wrapper.text()).toContain('Supplier Types, Strategic Threats, and Evidence Gaps')
    expect(wrapper.text()).toContain('Global formulation houses')
    expect(wrapper.text()).toContain('Silicone technology suppliers')
    expect(wrapper.text()).toContain('China local suppliers')
    expect(wrapper.text()).toContain('Global Competitor Matrix')
    expect(wrapper.text()).toContain('Source-backed public facts are separated from research gaps')
    expect(wrapper.text()).toContain('User PDF Competitor / Importer Tables')
    expect(wrapper.text()).toContain('Zhejiang Longsheng')
    expect(wrapper.text()).toContain('Dymatic Chemicals')
    expect(wrapper.text()).toContain('Evonik Industries')
    expect(wrapper.text()).toContain('Reference value archived')
    expect(wrapper.text()).not.toContain('21.4%')
    expect(wrapper.text()).not.toContain('15.9%')
    expect(wrapper.text()).toContain('paid China Customs database')
    expect(wrapper.text()).toContain('Archroma')
    expect(wrapper.text()).toContain('WACKER')
    expect(wrapper.text()).not.toContain('$18-22')
    expect(wrapper.text()).not.toContain('12%')
    expect(wrapper.text()).toContain('Research Competitor')
    expect(wrapper.text()).toContain('Schedule Deeper Research')
  })

  it('sorts and filters the primary competitor comparison table without promoting unsupported values', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addCompetitor({
      companyName: 'Alpha Source Co',
      countryRegion: 'China',
      productEquivalent: 'CWAS equivalent',
      activeContent: '90% active',
      pricingEvidence: '$24/kg source-backed',
      certifications: 'Official certificate',
      distributionPresence: 'Official distributor page',
      marketShare: '7% source-backed',
      revenue: '$42M source-backed',
      yearlyGrowth: '',
      traffic: '1.2M visits source-backed',
      rating: '4.8 source-backed',
      lastUpdated: '2026-06-05',
      confidence: 'high',
      evidenceStatus: 'Source-backed',
      source: { title: 'Official annual profile', url: 'https://example.com/alpha', date: '2026-06-05' },
      metricEvidence: {
        pricingEvidence: metricEvidence('$24/kg source-backed', { title: 'Official annual profile', url: 'https://example.com/alpha', date: '2026-06-05' }),
        marketShare: metricEvidence('7% source-backed', { title: 'Official annual profile', url: 'https://example.com/alpha', date: '2026-06-05' }),
        revenue: metricEvidence('$42M source-backed', { title: 'Official annual profile', url: 'https://example.com/alpha', date: '2026-06-05' }),
        traffic: metricEvidence('1.2M visits source-backed', { title: 'Official annual profile', url: 'https://example.com/alpha', date: '2026-06-05' }),
        rating: metricEvidence('4.8 source-backed', { title: 'Official annual profile', url: 'https://example.com/alpha', date: '2026-06-05' }),
        lastUpdated: metricEvidence('2026-06-05', { title: 'Official annual profile', url: 'https://example.com/alpha', date: '2026-06-05' }),
      },
      notes: 'Source-backed competitor record.',
    })
    intelligence.addCompetitor({
      companyName: 'Alpha Source Co',
      countryRegion: 'China',
      productEquivalent: 'CWMS variation',
      activeContent: '70% active',
      pricingEvidence: '$22/kg source-backed',
      certifications: 'Official certificate',
      distributionPresence: 'Official distributor page',
      marketShare: '6% source-backed',
      revenue: 'FY2024 company-wide net sales: US$2,180,274,000',
      yearlyGrowth: 'FY2024 net sales YoY: -6.26% vs FY2023 US$2,325,768,000',
      traffic: '950K visits source-backed',
      rating: '4.6 source-backed',
      lastUpdated: '2026-06-04',
      confidence: 'medium',
      evidenceStatus: 'Source-backed',
      source: { title: 'Official product variation page', url: 'https://example.com/alpha-cwms', date: '2026-06-04' },
      metricEvidence: {
        pricingEvidence: metricEvidence('$22/kg source-backed', { title: 'Official product variation page', url: 'https://example.com/alpha-cwms', date: '2026-06-04' }),
        marketShare: metricEvidence('6% source-backed', { title: 'Official product variation page', url: 'https://example.com/alpha-cwms', date: '2026-06-04' }),
        revenue: metricEvidence('FY2024 company-wide net sales: US$2,180,274,000', { title: 'Official product variation page', url: 'https://example.com/alpha-cwms', date: '2026-06-04' }),
        yearlyGrowth: metricEvidence('FY2024 net sales YoY: -6.26% vs FY2023 US$2,325,768,000', { title: 'Official product variation page', url: 'https://example.com/alpha-cwms', date: '2026-06-04' }),
        traffic: metricEvidence('950K visits source-backed', { title: 'Official product variation page', url: 'https://example.com/alpha-cwms', date: '2026-06-04' }),
        rating: metricEvidence('4.6 source-backed', { title: 'Official product variation page', url: 'https://example.com/alpha-cwms', date: '2026-06-04' }),
        lastUpdated: metricEvidence('2026-06-04', { title: 'Official product variation page', url: 'https://example.com/alpha-cwms', date: '2026-06-04' }),
      },
      notes: 'Second product variation should not duplicate the company row.',
    })
    intelligence.addCompetitor({
      companyName: 'Alpha Source Co',
      countryRegion: 'Company-wide',
      productEquivalent: 'Company-wide financial context; not product-line revenue.',
      activeContent: 'Awaiting trusted-source import',
      pricingEvidence: '',
      certifications: 'Official SEC companyfacts',
      distributionPresence: 'Awaiting trusted-source import',
      marketShare: '',
      revenue: 'FY2025 company-wide revenue: US$2.332B (SEC reported US$2,332,114,000)',
      yearlyGrowth: '+6.96% source-backed',
      traffic: '',
      rating: '',
      lastUpdated: '2026-02-26',
      confidence: 'high',
      evidenceStatus: 'Official Data',
      source: { title: 'SEC Companyfacts: Alpha Source Co Revenues', url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000000.json', date: '2026-02-26' },
      metricEvidence: {
        revenue: metricEvidence('FY2025 company-wide revenue: US$2.332B (SEC reported US$2,332,114,000)', { title: 'SEC Companyfacts: Alpha Source Co Revenues', url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000000.json', date: '2026-02-26' }, 'Official Data'),
        yearlyGrowth: metricEvidence('+6.96% source-backed', { title: 'SEC Companyfacts: Alpha Source Co Revenues', url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000000.json', date: '2026-02-26' }, 'Official Data'),
        lastUpdated: metricEvidence('2026-02-26', { title: 'SEC Companyfacts: Alpha Source Co Revenues', url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000000.json', date: '2026-02-26' }, 'Official Data'),
      },
      notes: 'Latest official company-wide metric should beat older exact-dollar formatting.',
    })
    intelligence.addCompetitor({
      companyName: 'Beta Source Co',
      countryRegion: 'Germany',
      productEquivalent: 'Silicone Softener',
      activeContent: 'Awaiting trusted-source import',
      pricingEvidence: '$36/kg source-backed',
      certifications: 'Official product page',
      distributionPresence: 'Official distributor page',
      marketShare: '4% source-backed',
      revenue: '$12M source-backed',
      yearlyGrowth: '+3% source-backed',
      evidenceStatus: 'Source-backed',
      source: { title: 'Official company profile', url: 'https://example.com/beta' },
      metricEvidence: {
        pricingEvidence: metricEvidence('$36/kg source-backed', { title: 'Official company profile', url: 'https://example.com/beta', date: '2026-06-05' }),
        marketShare: metricEvidence('4% source-backed', { title: 'Official company profile', url: 'https://example.com/beta', date: '2026-06-05' }),
        revenue: metricEvidence('$12M source-backed', { title: 'Official company profile', url: 'https://example.com/beta', date: '2026-06-05' }),
        yearlyGrowth: metricEvidence('+3% source-backed', { title: 'Official company profile', url: 'https://example.com/beta', date: '2026-06-05' }),
      },
      notes: 'Source-backed silicone competitor record.',
    })

    const wrapper = mount(CompetitorIntelligenceView)
    const panel = () => wrapper.get('.comparison-command-panel')

    expect(panel().text()).toContain('COMPANY')
    expect(panel().text()).toContain('PRODUCT VARIATIONS')
    expect(panel().text()).toContain('MARKET SHARE')
    expect(panel().text()).toContain('REVENUE')
    expect(panel().text()).toContain('YOY GROWTH')
    expect(panel().text()).toContain('SOURCE')
    expect(panel().text()).toContain('LEADER')
    expect(panel().text()).toContain('NEXT ACTION')
    expect(panel().text()).toContain('Review-gated empty state')
    expect(panel().text()).toContain('No approved source-backed value')
    expect(panel().text()).not.toMatch(/Hermes\s+verifying\s+twice\s+daily/i)
    const alphaRows = wrapper.findAll('.comparison-grid-row')
      .filter(row => !row.classes().includes('head') && row.text().includes('Alpha Source Co'))
    expect(alphaRows).toHaveLength(1)
    expect(alphaRows[0].text()).toContain('CWAS equivalent / CWMS variation')
    expect(alphaRows[0].text()).toContain('2 product variations')
    expect(alphaRows[0].text()).toContain('FY2025 company-wide revenue: US$2.332B')
    expect(alphaRows[0].text()).toContain('+6.96% source-backed')
    expect(alphaRows[0].text()).not.toContain('FY2024 company-wide net sales: US$2,180,274,000')
    expect(alphaRows[0].text()).not.toContain('FY2024 net sales YoY: -6.26%')
    expect(alphaRows[0].text()).toContain('1.2M visits source-backed')
    expect(alphaRows[0].text()).toContain('4.8 source-backed')
    expect(alphaRows[0].text()).toContain('high')
    expect(alphaRows[0].text()).toContain('🥇 Market Leader')
    expect(alphaRows[0].text()).toContain('📈 Fastest Growth')
    expect(alphaRows[0].text()).toContain('💰 Highest Revenue')
    expect(alphaRows[0].text()).toContain('🔥 Most Competitive Pricing')
    const rawAlphaRows = wrapper.findAll('.competitor-table .competitor-row')
      .filter(row => !row.classes().includes('head') && row.text().includes('Alpha Source Co'))
    expect(rawAlphaRows).toHaveLength(1)
    expect(rawAlphaRows[0].text()).toContain('CWAS equivalent / CWMS variation')
    const alphaShareRows = wrapper.findAll('.market-share-panel .share-row')
      .filter(row => row.text().includes('Alpha Source Co'))
    expect(alphaShareRows).toHaveLength(1)

    const revenueSort = wrapper.findAll('.comparison-sort-button').find(button => button.text().includes('REVENUE'))
    expect(revenueSort).toBeTruthy()
    await revenueSort!.trigger('click')
    const firstSortedRow = wrapper.findAll('.comparison-grid-row').filter(row => !row.classes().includes('head'))[0]
    expect(firstSortedRow.text()).toContain('Alpha Source Co')
    expect(firstSortedRow.text()).toContain('FY2025 company-wide revenue: US$2.332B')

    const categorySelect = wrapper.findAll('.comparison-filter-bar select')[0]
    await categorySelect.setValue('Silicone Softener')
    await flushPromises()
    expect(panel().text()).toContain('Beta Source Co')
    expect(panel().text()).not.toContain('Alpha Source Co')

    const evidenceSelect = wrapper.findAll('.comparison-filter-bar select')[1]
    await evidenceSelect.setValue('Auto-checking')
    await flushPromises()
    expect(panel().text()).toContain('Beta Source Co')
    expect(panel().text()).not.toContain('WACKER')
    expect(panel().text()).not.toMatch(/Hermes\s+verifying\s+twice\s+daily/i)
    expect(panel().text()).not.toContain('$18-22')
    expect(panel().text()).not.toContain('20-25%')
  })

  it('dedupes duplicate companies without borrowing sources for unsupported product or metric values', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addCompetitor({
      companyName: 'Gamma Source Co',
      countryRegion: 'China',
      productEquivalent: 'CWAS source-backed equivalent',
      activeContent: '90% active',
      pricingEvidence: '$24/kg source-backed',
      certifications: 'Official certificate',
      distributionPresence: 'Official distributor page',
      marketShare: '7% source-backed',
      revenue: '$42M source-backed',
      yearlyGrowth: '+8% source-backed',
      traffic: '1.2M visits source-backed',
      rating: '4.8 source-backed',
      lastUpdated: '2026-06-05',
      confidence: 'high',
      evidenceStatus: 'Source-backed',
      source: { title: 'Official Gamma profile', url: 'https://example.com/gamma', date: '2026-06-05' },
      metricEvidence: {
        pricingEvidence: metricEvidence('$24/kg source-backed', { title: 'Official Gamma profile', url: 'https://example.com/gamma', date: '2026-06-05' }),
        marketShare: metricEvidence('7% source-backed', { title: 'Official Gamma profile', url: 'https://example.com/gamma', date: '2026-06-05' }),
        revenue: metricEvidence('$42M source-backed', { title: 'Official Gamma profile', url: 'https://example.com/gamma', date: '2026-06-05' }),
        yearlyGrowth: metricEvidence('+8% source-backed', { title: 'Official Gamma profile', url: 'https://example.com/gamma', date: '2026-06-05' }),
        traffic: metricEvidence('1.2M visits source-backed', { title: 'Official Gamma profile', url: 'https://example.com/gamma', date: '2026-06-05' }),
        rating: metricEvidence('4.8 source-backed', { title: 'Official Gamma profile', url: 'https://example.com/gamma', date: '2026-06-05' }),
        lastUpdated: metricEvidence('2026-06-05', { title: 'Official Gamma profile', url: 'https://example.com/gamma', date: '2026-06-05' }),
      },
      notes: 'Approved source-backed competitor record.',
    })
    intelligence.addCompetitor({
      companyName: 'Gamma Source Company',
      countryRegion: 'China',
      productEquivalent: 'Claimed unsupported CWMS variant',
      activeContent: 'Claimed 70% active',
      pricingEvidence: '$12/kg unsupported quote',
      certifications: 'Claimed certificate',
      distributionPresence: 'Claimed distributor page',
      marketShare: '19% unsupported estimate',
      revenue: '$999M unsupported revenue',
      yearlyGrowth: '+99% unsupported growth',
      traffic: '9.9M unsupported visits',
      rating: '5.0 unsupported rating',
      lastUpdated: '2026-06-06',
      confidence: 'high',
      evidenceStatus: 'Verified',
      source: null,
      notes: 'This duplicate lacks a usable source and must not borrow the Gamma source.',
    })

    const wrapper = mount(CompetitorIntelligenceView)
    const gammaRows = wrapper.findAll('.comparison-grid-row')
      .filter(row => !row.classes().includes('head') && row.text().includes('Gamma Source Co'))

    expect(gammaRows).toHaveLength(1)
    expect(gammaRows[0].text()).toContain('CWAS source-backed equivalent')
    expect(gammaRows[0].text()).toContain('$24/kg source-backed')
    expect(gammaRows[0].text()).toContain('7% source-backed')
    expect(gammaRows[0].text()).toContain('$42M source-backed')
    expect(gammaRows[0].text()).toContain('+8% source-backed')
    expect(gammaRows[0].text()).not.toContain('Claimed unsupported CWMS variant')
    expect(gammaRows[0].text()).not.toContain('$12/kg unsupported quote')
    expect(gammaRows[0].text()).not.toContain('19% unsupported estimate')
    expect(gammaRows[0].text()).not.toContain('$999M unsupported revenue')
    expect(gammaRows[0].text()).not.toContain('+99% unsupported growth')
    expect(gammaRows[0].text()).not.toContain('9.9M unsupported visits')
    expect(gammaRows[0].text()).not.toContain('5.0 unsupported rating')
    expect(gammaRows[0].text()).not.toContain('2026-06-06')
  })

  it('does not use company-level source or confidence as primary metric metadata', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addCompetitor({
      companyName: 'Identity Only Source Co',
      countryRegion: 'China',
      productEquivalent: 'CWAS identity source only',
      activeContent: '90% active claimed',
      pricingEvidence: '$12/kg unsupported quote',
      certifications: 'Official company identity page',
      distributionPresence: 'Claimed distributor page',
      marketShare: '19% unsupported estimate',
      revenue: '$999M unsupported revenue',
      yearlyGrowth: '+99% unsupported growth',
      traffic: '9.9M unsupported visits',
      rating: '5.0 unsupported rating',
      lastUpdated: '2026-06-06',
      confidence: 'high',
      evidenceStatus: 'Verified',
      source: {
        title: 'Official identity profile',
        url: 'https://example.com/identity-only',
        date: '2026-06-06',
      },
      notes: 'Identity source exists, but no metric-level evidence is imported or approved.',
    })

    const wrapper = mount(CompetitorIntelligenceView)
    const row = wrapper.findAll('.comparison-grid-row')
      .filter(item => !item.classes().includes('head') && item.text().includes('Identity Only Source Co'))[0]

    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('CWAS identity source only')
    expect(row.text()).toContain('Review-gated empty state')
    expect(row.text()).toContain('No approved source-backed value')
    expect(row.text()).toContain('Still missing source-backed fields:')
    expect(row.text()).not.toContain('Official identity profile')
    expect(row.text()).not.toContain('$12/kg unsupported quote')
    expect(row.text()).not.toContain('19% unsupported estimate')
    expect(row.text()).not.toContain('$999M unsupported revenue')
    expect(row.text()).not.toContain('+99% unsupported growth')
    expect(row.text()).not.toContain('9.9M unsupported visits')
    expect(row.text()).not.toContain('5.0 unsupported rating')
    expect(row.text()).not.toContain('Identity/product source only')
  })

  it('hydrates competitor records from durable server intelligence on direct tab load', async () => {
    apiRequestMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/hermes/intelligence-state')) {
        return {
          ok: true,
          profile: 'default',
          savedAt: '2026-06-06T09:00:00.000Z',
          state: {
            competitors: [
              {
                id: 'server-competitor-1',
                companyName: 'Server Hydrated Co',
                countryRegion: 'Germany',
                productEquivalent: 'Silicone softener product family',
                activeContent: 'Official product source-backed',
                pricingEvidence: '',
                certifications: 'Official source-backed',
                distributionPresence: 'Official source-backed',
                revenue: 'FY2025 company-wide revenue: EUR 6.4B',
                yearlyGrowth: '+4.2% YoY source-backed',
                traffic: '',
                rating: 'Official recognition source-backed',
                lastUpdated: '2026-06-06',
                confidence: 'high',
                evidenceStatus: 'Official Data',
                source: {
                  title: 'Official annual report',
                  url: 'https://example.com/annual-report',
                  date: '2026-06-06',
                },
                metricEvidence: {
                  revenue: {
                    value: 'FY2025 company-wide revenue: EUR 6.4B',
                    source: {
                      title: 'Official annual report',
                      url: 'https://example.com/annual-report',
                      date: '2026-06-06',
                    },
                    evidenceStatus: 'Official Data',
                    confidence: 'high',
                    reviewRequired: false,
                  },
                },
                notes: 'Loaded from server state on direct Competitor tab open.',
                updatedAt: '2026-06-06T09:00:00.000Z',
              },
            ],
          },
        }
      }
      if (url.includes('/api/hermes/jobs')) return { jobs: [] }
      return {}
    })

    const wrapper = mount(CompetitorIntelligenceView)
    await flushPromises()

    const row = wrapper.findAll('.comparison-grid-row')
      .filter(item => !item.classes().includes('head') && item.text().includes('Server Hydrated Co'))[0]

    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('FY2025 company-wide revenue: EUR 6.4B')
    expect(row.text()).toContain('Official annual report')
    expect(row.text()).toContain('high')
  })

  it('shows collective market-share context without promoting it to a company-specific leader badge', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addCompetitor({
      companyName: 'BASF',
      countryRegion: 'Germany / global',
      productEquivalent: 'Esterquats / fabric-care softener competitor context',
      activeContent: 'Awaiting trusted-source import',
      pricingEvidence: '',
      certifications: 'Awaiting trusted-source import',
      distributionPresence: 'Awaiting trusted-source import',
      marketShare: 'Collective Tier-1 esterquats share 50-60%; individual company share not published by this source. Review required before ranking or investor use.',
      revenue: '',
      yearlyGrowth: '',
      traffic: '',
      rating: '',
      lastUpdated: 'February 2026',
      confidence: 'medium',
      evidenceStatus: 'Market Reference',
      reviewRequired: true,
      source: {
        title: 'Persistence Market Research - Esterquats Market',
        url: 'https://www.persistencemarketresearch.com/market-research/esterquats-market.asp',
        date: 'February 2026',
      },
      notes: 'Use as competitor-landscape context only. Do not rank companies from collective share.',
    })

    const wrapper = mount(CompetitorIntelligenceView)
    const basfRow = wrapper.findAll('.comparison-grid-row')
      .filter(row => !row.classes().includes('head') && row.text().includes('BASF'))[0]

    expect(basfRow.text()).toContain('No approved source-backed value')
    expect(basfRow.text()).toContain('Still missing source-backed fields:')
    expect(basfRow.text()).toContain('company-specific market share')
    expect(basfRow.text()).not.toContain('Collective Tier-1 esterquats share 50-60%')
    expect(basfRow.text()).not.toContain('individual company share not published')
    expect(basfRow.text()).toContain('No source-backed leader badge')
    expect(basfRow.text()).not.toContain('🥇 Market Leader')
    expect(wrapper.findAll('.market-share-panel .share-row')
      .filter(row => row.text().includes('BASF'))).toHaveLength(0)
  })

  it('does not promote review-gated company-specific market share into a market leader badge', () => {
    useFeasibilityIntelligence().addCompetitor({
      companyName: 'Review Share Co',
      countryRegion: 'Global',
      productEquivalent: 'Esterquat competitor context',
      activeContent: 'Awaiting trusted-source import',
      pricingEvidence: '',
      certifications: 'Awaiting trusted-source import',
      distributionPresence: 'Awaiting trusted-source import',
      marketShare: '19% global esterquat share (market-reference estimate; not textile-softener-specific).',
      revenue: 'FY2025 company-wide revenue: US$2.332B',
      yearlyGrowth: '+6.96% YoY source-backed',
      traffic: '',
      rating: '',
      lastUpdated: '2026-06-06',
      confidence: 'high',
      evidenceStatus: 'Official Data',
      source: { title: 'SEC Companyfacts', url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000094049.json', date: '2026-02-26' },
      metricEvidence: {
        marketShare: {
          value: '19% global esterquat share (market-reference estimate; not textile-softener-specific).',
          source: { title: '360 Research Reports - Esterquat Market', url: 'https://www.360researchreports.com/market-reports/esterquat-market-204218', date: '18 November 2025' },
          evidenceStatus: 'Market Reference',
          confidence: 'medium',
          reviewRequired: true,
        },
        revenue: {
          value: 'FY2025 company-wide revenue: US$2.332B',
          source: { title: 'SEC Companyfacts', url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000094049.json', date: '2026-02-26' },
          evidenceStatus: 'Official Data',
          confidence: 'high',
          reviewRequired: false,
        },
      },
      notes: 'Market share is company-specific but still review-gated.',
    })

    const wrapper = mount(CompetitorIntelligenceView)
    const row = wrapper.findAll('.comparison-grid-row')
      .filter(item => !item.classes().includes('head') && item.text().includes('Review Share Co'))[0]

    expect(row.text()).toContain('Review required')
    expect(row.text()).toContain('Review source-backed candidates before using:')
    expect(row.text()).toContain('company-specific market share')
    expect(row.text()).toContain('Source found - review required: 19% global esterquat share')
    expect(row.text()).not.toContain('💰 Highest Revenue')
    expect(row.text()).toContain('No source-backed leader badge')
    expect(row.text()).not.toContain('🥇 Market Leader')
    expect(wrapper.findAll('.market-share-panel .share-row')
      .filter(item => item.text().includes('Review Share Co'))).toHaveLength(0)
  })

  it('shows sourced traffic and recognition while keeping market-reference share review-gated', () => {
    useFeasibilityIntelligence().addCompetitor({
      companyName: 'Traffic Evidence Co',
      countryRegion: 'Japan / global',
      productEquivalent: 'Textile softener competitor context',
      activeContent: 'Source-backed product context',
      pricingEvidence: '',
      certifications: 'Source-backed',
      distributionPresence: 'Source-backed',
      marketShare: '14% global esterquat share (market-reference estimate; not textile-softener-specific).',
      revenue: 'FY2025 company-wide net sales: ¥1,688.6B',
      yearlyGrowth: 'FY2024 net sales YoY: +6.26%',
      traffic: 'April 2026 Semrush website-traffic estimate: 1.17M visits.',
      rating: 'Official sustainability recognition source-backed.',
      lastUpdated: 'April 2026',
      confidence: 'high',
      evidenceStatus: 'Official Data',
      source: { title: 'Official company source', url: 'https://example.com/company', date: '2026-06-06' },
      metricEvidence: {
        marketShare: {
          value: '14% global esterquat share (market-reference estimate; not textile-softener-specific).',
          source: { title: 'Market reference estimate', url: 'https://example.com/market-reference', date: '2026-06-06' },
          evidenceStatus: 'Market Reference',
          confidence: 'medium',
          reviewRequired: true,
        },
        traffic: {
          value: 'April 2026 Semrush website-traffic estimate: 1.17M visits.',
          source: { title: 'Semrush website traffic overview', url: 'https://www.semrush.com/website/example.com/overview/', date: 'April 2026' },
          evidenceStatus: 'Market Reference',
          confidence: 'high',
          reviewRequired: false,
        },
        rating: {
          value: 'Official sustainability recognition source-backed.',
          source: { title: 'Official recognition page', url: 'https://example.com/recognition', date: '2026-06-06' },
          evidenceStatus: 'Official Data',
          confidence: 'high',
          reviewRequired: false,
        },
      },
      notes: 'Traffic is directional; market share is review-gated.',
    })

    const wrapper = mount(CompetitorIntelligenceView)
    const row = wrapper.findAll('.comparison-grid-row')
      .filter(item => !item.classes().includes('head') && item.text().includes('Traffic Evidence Co'))[0]

    expect(row.text()).toContain('1.17M visits')
    expect(row.text()).toContain('Official sustainability recognition')
    expect(row.text()).toContain('Review required')
    expect(row.text()).toContain('Source found - review required: 14% global esterquat share')
    expect(row.text()).not.toContain('🥇 Market Leader')
    expect(wrapper.findAll('.market-share-panel .share-row')
      .filter(item => item.text().includes('Traffic Evidence Co'))).toHaveLength(0)
  })

  it('renders imported supplier scorecards with source metadata while keeping staged candidates review-gated', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.state.value.supplierScorecards = [
      {
        id: 'supplier-import-quote-1',
        supplier: 'Uploaded Quote Supplier',
        material: 'Stearic Acid TP',
        value: 'Uploaded supplier quote packet confirms the quoted material and attached evidence.',
        source: {
          title: 'Uploaded supplier quote packet',
          url: 'https://example.com/uploaded-quote-packet',
          date: '2026-06-05',
        },
        sourceTier: 'tier3-supplier-evidence',
        confidence: 'high',
        evidenceStatus: 'Supplier Evidence',
        reviewRequired: true,
        dataType: 'supplier_quote',
        pricePerTon: 'USD 1,235/T',
        quality: 'TDS/SDS uploaded',
        reliability: 'Distributor delivery record uploaded',
        payment: 'LC at sight',
        score: '82/100',
        notes: 'Uploaded supplier evidence remains owner-reviewed before procurement use.',
      },
      {
        id: 'supplier-import-gap-1',
        supplier: 'Official Product Supplier',
        material: 'Triethanolamine / TEA',
        value: 'Official product page confirms product identity, but no supplier quote is approved.',
        source: {
          title: 'Official supplier product page',
          url: 'https://example.com/official-tea-product',
          date: '2026-06-04',
        },
        sourceTier: 'tier2-company-official',
        confidence: 'medium',
        evidenceStatus: 'Source-backed',
        reviewRequired: true,
        dataType: 'document_evidence',
        pricePerTon: '',
        quality: '',
        reliability: '',
        payment: '',
        score: '',
      },
      {
        id: 'supplier-import-approved-1',
        supplier: 'Approved Audit Supplier',
        material: 'PDMS Silicone Oil',
        value: 'Approved supplier evidence packet imported for dashboard display.',
        source: {
          title: 'Approved supplier audit scorecard quote packet',
          url: 'https://example.com/approved-supplier-audit',
          date: '2026-06-06',
        },
        sourceTier: 'tier3-supplier-evidence',
        confidence: 'high',
        evidenceStatus: 'Supplier Evidence',
        reviewRequired: false,
        dataType: 'supplier_quote',
        pricePerTon: 'USD 2,450/T',
        quality: 'COA/TDS approved',
        reliability: 'On-time delivery audited',
        payment: 'Documentary credit approved',
        score: '91/100',
        notes: 'Approved supplier audit scorecard includes COA, TDS, on-time delivery record, proforma invoice, LC payment terms, and scorecard approval.',
      },
      {
        id: 'supplier-import-tds-only-1',
        supplier: 'TDS Only Supplier',
        material: 'Acetic Acid',
        value: 'TDS upload includes a claimed LC 30 days term and 99/100 score, but no commercial source packet.',
        source: {
          title: 'Official TDS document',
          url: 'https://example.com/tds-only',
          date: '2026-06-06',
        },
        sourceTier: 'tier2-company-official',
        confidence: 'medium',
        evidenceStatus: 'Source-backed',
        reviewRequired: false,
        dataType: 'document_evidence',
        pricePerTon: 'USD 1,999/T',
        quality: 'TDS evidence located',
        reliability: 'Fast delivery',
        payment: 'LC 30 days',
        score: '99/100',
        notes: 'Document source supports identity and TDS review only.',
      },
      {
        id: 'supplier-import-unapproved-commercial-1',
        supplier: 'Unapproved Commercial Supplier',
        material: 'DMS / dimethyl sulfate',
        value: 'Autopilot extracted USD 777/T with freight, duties, and delivery time from a supplier quote-looking source.',
        source: {
          title: 'Supplier quote-looking source',
          url: 'https://example.com/unapproved-commercial',
          date: '2026-06-06',
        },
        sourceTier: 'tier3-supplier-evidence',
        confidence: 'medium',
        evidenceStatus: 'Supplier Evidence',
        reviewRequired: false,
        dataType: 'supplier_quote',
        pricePerTon: 'USD 777/T',
        quality: 'Quality score 99/100',
        reliability: '7 day delivery time',
        payment: 'TT 30 days',
        score: '99/100',
        notes: 'Quote-looking extraction is not owner-approved for dashboard display.',
      },
    ]
    intelligence.state.value.rawMaterialSignals = [{
      id: 'raw-material-stearic-identity',
      material: 'Stearic Acid TP',
      value: 'CAS 57-11-4 identity source imported for material matching.',
      cas: '57-11-4',
      formula: 'C18H36O2',
      source: {
        title: 'PubChem stearic acid identity',
        url: 'https://pubchem.ncbi.nlm.nih.gov/compound/Stearic-acid',
        date: '2026-06-02',
      },
      sourceTier: 'tier1-official',
      confidence: 'high',
      evidenceStatus: 'Official Data',
      reviewRequired: true,
      dataType: 'regulatory_data',
    }]
    intelligence.addDataRoomSource({
      checklistLabel: 'Autopilot supplier scorecard - Official Supplier',
      area: 'factory',
      dashboardGroup: 'supplierScorecards',
      supplier: 'Official Supplier Candidate',
      material: 'Stearic Acid TP',
      proposedValue: 'Quote/TDS requested; price To Verify',
      sourceTier: 'tier2-company-official',
      dataType: 'supplier_quote',
      confidence: 'medium',
      evidenceStatus: 'To Verify',
      source: {
        title: 'Official supplier product catalog',
        url: 'https://example.com/official-product-catalog',
      },
      notes: [
        'Autopilot candidate from supplierScorecards.',
        'Proposed value: Quote/TDS requested; price To Verify',
        'Source tier: tier2-company-official',
        'This record was auto-staged to make the dashboard useful without manual copy-paste. It is not investor-approved.',
      ].join('\n'),
    })

    const wrapper = mount(RawMaterialSourcingView)
    const text = wrapper.text()

    expect(text).toContain('Supplier Scorecards - Key Raw Materials')
    expect(text).toContain('Hermes Autopilot has imported 5 supplier scorecard rows and 1 raw-material signals with source metadata')
    expect(text).toContain('1 supplier candidate is shown as review-gated scorecard context')
    expect(text).toContain('Uploaded Quote Supplier')
    expect(text).toContain('Stearic Acid TP')
    expect(text).not.toContain('USD 1,235/T')
    expect(text).not.toContain('TDS/SDS uploaded')
    expect(text).not.toContain('Distributor delivery record uploaded')
    expect(text).not.toContain('LC at sight')
    expect(text).not.toContain('82/100')
    expect(text).toContain('Uploaded supplier quote packet')
    expect(text).toContain('Source metadata: tier3-supplier-evidence / confidence: high / date: 2026-06-05')
    expect(text).toContain('Raw-material identity source: PubChem stearic acid identity / 2026-06-02')
    expect(text).toContain('Official Product Supplier')
    expect(text).toContain('Cost-sensitive: quote evidence required')
    expect(text).toContain('Cost-sensitive: payment evidence required')
    expect(text).toContain('Review-gated: scoring evidence required')
    expect(text).toContain('Approved Audit Supplier')
    expect(text).toContain('USD 2,450/T')
    expect(text).toContain('COA/TDS approved')
    expect(text).toContain('On-time delivery audited')
    expect(text).toContain('Documentary credit approved')
    expect(text).toContain('91/100')
    expect(text).toContain('TDS Only Supplier')
    expect(text).toContain('TDS evidence located')
    expect(text).not.toContain('USD 1,999/T')
    expect(text).not.toContain('LC 30 days')
    expect(text).not.toContain('Fast delivery')
    expect(text).not.toContain('99/100')
    expect(text).toContain('Unapproved Commercial Supplier')
    expect(text).not.toContain('USD 777/T')
    expect(text).not.toContain('freight')
    expect(text).not.toContain('duties')
    expect(text).not.toContain('7 day delivery time')
    expect(text).not.toContain('TT 30 days')
    expect(text).not.toContain('Quality score')
    expect(text).toContain('Review state: source-backed context only')
    expect(text).toContain('Review state: approved supplier evidence')
    expect(text).toContain('Review state: review-gated')
    expect(text).toContain('Collapsed reference-only supplier target template')
    expect(text).toContain('Stearic Acid TP / Stearic acid 1842')
    expect(text).toContain('Triethanolamine / TEA')
    expect(text).toContain('PDMS Silicone Oil / 1000 cSt target')
    expect(text).toContain('Dimethyl Sulfate / DMS')
    expect(text).toContain('Acetic Acid')
    expect(text).toContain('Wilmar Oleochemicals')
    expect(text).toContain('KLK OLEO')
    expect(text).toContain('BASF')
    expect(text).toContain('Dow')
    expect(text).toContain('WACKER')
    expect(text).not.toContain('No imported supplier scorecard rows yet')
    expect(text).toContain('Official Supplier Candidate')
    expect(text).toContain('Official supplier product catalog')
    expect(text).toContain('Source found - review required: Supplier evidence staged for review. Commercial values are hidden until approved for dashboard use.')
    expect(text).not.toContain('No approved quote yet')
    expect(text).toContain('Do not use screenshot prices or supplier scores as verified facts')
    expect(text).toContain('Supplier scorecard autopilot keeps findings review-gated until approved')
    expect(text).toContain('Check Supplier Autopilot')
    expect(text).toContain('Search')
    expect(text).toContain('Stage')
    expect(text).toContain('Owner approval')
    expect(text).toContain('Only approved uploaded supplier evidence can reveal price, payment, reliability, or score fields.')
    expect(text).toContain('Full dashboard autopilot')
    expect(text).toContain('Verify Supplier')
    expect(text).toContain('Awaiting trusted-source import')
    expect(text).not.toContain('$1,180')
    expect(text).not.toContain('$1,210')
    expect(text).not.toContain('$1,450')
    expect(text).not.toContain('$3,200')
    expect(text).not.toContain('$3,350')
    expect(text).not.toContain('$890')
    expect(text).not.toContain('10.0')

    await flushPromises()
    expect(fetchJobsMock).toHaveBeenCalled()
    expect(createJobMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Supplier Scorecard Autopilot - Key Raw Materials',
      schedule: EXECUTIVE_REFRESH_SCHEDULE,
      deliver: 'local',
    }))
    expect(useFeasibilityIntelligence().state.value.researchJobs[0]).toMatchObject({
      title: 'Supplier Scorecard Autopilot - Key Raw Materials',
      status: 'Scheduled Hermes Job',
      scheduledJobId: 'job-1',
    })
  })

  it('shows approved raw-material prices while hiding reference-only saved prices', () => {
    window.localStorage.setItem('hermes.rawMaterialSourcing.v1', JSON.stringify([{
      id: 'tea',
      name: 'TEA',
      cas: '102-71-6',
      unit: 'MT',
      sourceType: 'Supplier quote',
      evidenceStatus: 'User Approved',
      confidence: 'high',
      alertThresholdPct: 5,
      source: 'Owner uploaded supplier quote',
      sourceDate: '2026-06-06',
      notes: 'Approved user-entered quote.',
      highRisk: false,
      priceHistory: [
        {
          id: 'tea-reference-price',
          materialName: 'TEA',
          unit: 'MT',
          rmbPrice: 1180,
          usdPrice: null,
          source: 'Alibaba listing',
          sourceType: 'Alibaba/Made-in-China reference',
          sourceDate: '2026-06-07',
          confidence: 'low',
          evidenceStatus: 'Reference Only',
          notes: 'Listing only.',
          createdAt: '2026-06-07T00:00:00.000Z',
        },
        {
          id: 'tea-approved-price',
          materialName: 'TEA',
          unit: 'MT',
          rmbPrice: 1250,
          usdPrice: null,
          source: 'Owner uploaded supplier quote',
          sourceType: 'Supplier quote',
          sourceDate: '2026-06-06',
          confidence: 'high',
          evidenceStatus: 'User Approved',
          notes: 'Approved by owner.',
          createdAt: '2026-06-06T00:00:00.000Z',
        },
      ],
    }]))

    const wrapper = mount(RawMaterialSourcingView)
    const text = wrapper.text()

    expect(text).toContain('Latest RMB')
    expect(text).toContain('RMB 1,250')
    expect(text).toContain('User Approved / Supplier quote')
    expect(text).not.toContain('RMB 1,180')
    expect(text).not.toContain('Reference Only / Alibaba/Made-in-China reference')
  })

  it('stages Sync Now as a Research Result Review item instead of silently approving market or finance facts', async () => {
    const marketWrapper = mount(MarketIntelligenceView)
    await marketWrapper.findAll('button').find(button => button.text().includes('Sync Now'))!.trigger('click')
    await flushPromises()

    const investmentWrapper = mount(InvestmentAnalysisView)
    await investmentWrapper.findAll('button').find(button => button.text().includes('Sync Now'))!.trigger('click')
    await flushPromises()

    const findings = useFeasibilityIntelligence().pendingResearchFindings.value
    const keyClaims = findings.map(item => item.keyClaim.toLowerCase())
    expect(keyClaims.some(keyClaim => keyClaim.includes('market intelligence'))).toBe(true)
    expect(keyClaims.some(keyClaim => keyClaim.includes('investment analysis'))).toBe(true)
    expect(findings.every(item => item.status === 'Pending Review' || item.status === 'To Verify')).toBe(true)
  })

  it('auto-fills Export Market Opportunity from trusted-source country market claims as trade proxies', () => {
    useFeasibilityIntelligence().addMarketClaim({
      label: 'Country-wise consumption growth - China',
      value: '2024 HS 380991 imports: $236,608.42K; quantity 65,409,000 kg; YoY value change +21.23% vs 2023',
      source: {
        title: 'WITS / World Bank Comtrade - China imports of HS 380991',
        url: 'https://wits.worldbank.org/trade/comtrade/en/country/CHN/year/2024/tradeflow/Imports/partner/ALL/product/380991',
      },
      confidence: 'medium',
      evidenceStatus: 'To Verify',
      lastChecked: '2026-06-03',
    })

    const wrapper = mount(ExportMarketOpportunityView)
    const text = wrapper.text()

    expect(text).toContain('Export market opportunity')
    expect(text).toContain('Trusted-source imports have filled 1 country-wise trade-proxy records')
    expect(text).toContain('China')
    expect(text).toContain('Textile auxiliary / softener trade proxy')
    expect(text).toContain('HS 380991 trade proxy / source review needed')
    expect(text).toContain('2024 HS 380991 imports: $236,608.42K; quantity 65,409,000 kg')
    expect(text).toContain('+21.23%')
    expect(text).toContain('WITS / World Bank Comtrade - China imports of HS 380991')
    expect(text).toContain('Trade proxy')
    expect(text).toContain('not proven actual consumption')
  })

  it('surfaces autopilot regulatory findings without marking DMS or permits verified', () => {
    useFeasibilityIntelligence().addDataRoomSource({
      checklistLabel: 'DMS regulatory status in China',
      area: 'regulatory',
      dashboardGroup: 'regulatoryFindings',
      proposedValue: 'Dimethyl sulfate handling and China use permissions require official review',
      sourceTier: 'tier1-official',
      dataType: 'regulatory_data',
      confidence: 'high',
      evidenceStatus: 'To Verify',
      source: {
        title: 'China Ministry of Emergency Management chemical safety notice',
        url: 'https://www.mem.gov.cn/',
      },
      notes: [
        'Autopilot candidate from regulatoryFindings.',
        'Proposed value: Dimethyl sulfate handling and China use permissions require official review',
        'Source tier: tier1-official',
        'Review reason: sensitive price/cost/financial/regulatory data',
        'This record was auto-staged to make the dashboard useful without manual copy-paste. It is not investor-approved.',
      ].join('\n'),
    })

    const wrapper = mount(RegulatoryIntelligenceView)
    const text = wrapper.text()

    expect(text).toContain('Regulatory Intelligence')
    expect(text).toContain('Autopilot Regulatory Candidates')
    expect(text).toContain('DMS regulatory status in China')
    expect(text).toContain('Hermes Autopilot has filled 1 regulatory candidate records')
    expect(text).toContain('Dimethyl sulfate handling and China use permissions require official review')
    expect(text).toContain('China Ministry of Emergency Management chemical safety notice')
    expect(text).toContain('tier1-official / high')
    expect(text).toContain('DMS / SDS / factory permission status')
    expect(text).toContain('DMS meaning confirmation')
    expect(text).toContain('China regulatory status')
    expect(text).toContain('SDS / TDS / CAS evidence')
    expect(text).toContain('factory permissions')
    expect(text).toContain('not treated as verified legal advice or investor-approved facts')
    expect(text).toContain('To Verify')
    expect(text).toContain('DMS regulatory status in ChinaTo Verify')
    expect(text).not.toContain('DMS regulatory status in ChinaVerified')
    expect(text).not.toContain('Investor Approved')
  })

  it('shows trusted-source autopilot status on every expanded intelligence workspace', () => {
    const cases = [
      [RawMaterialSourcingView, 'Raw Material Auto Source Status'],
      [ExportMarketOpportunityView, 'Export Market Auto Source Status'],
      [RegulatoryIntelligenceView, 'Regulatory Auto Source Status'],
      [InvestorReadinessView, 'Investor Readiness Auto Source Status'],
      [InvestorPresentationBuilderView, 'Presentation Auto Source Status'],
    ] as const

    for (const [Component, title] of cases) {
      const wrapper = mount(Component, {
        global: {
          stubs: {
            RouterLink: { props: ['to'], template: '<a class="router-link"><slot /></a>' },
          },
        },
      })
      const text = wrapper.text()

      expect(text).toContain(title)
      expect(text).toContain('Trusted Source Autopilot')
      expect(text).toContain('Run Source Check Now')
      expect(text).toContain('View Review Queue')

      wrapper.unmount()
    }
  })

  it('keeps employee and investor route access conservative', () => {
    expect(canAccessRouteName('hermes.executiveOverview', 'employee')).toBe(true)
    expect(canAccessRouteName('hermes.investmentAnalysis', 'employee')).toBe(false)
    expect(canAccessRouteName('hermes.investmentAnalysis', 'financial_analyst')).toBe(true)
    expect(canAccessRouteName('hermes.regulatory', 'regulatory_consultant')).toBe(true)
    expect(canAccessRouteName('hermes.regulatory', 'research_assistant')).toBe(true)
    expect(canAccessRouteName('hermes.regulatory', 'employee')).toBe(false)
    expect(canAccessRouteName('hermes.executiveOverview', 'investor_viewer')).toBe(false)
  })
})
