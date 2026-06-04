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
  buildInvestorEconomicsKpis,
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
    expect(wrapper.text()).toContain('Vendor quote benchmark found; capex amount requires owner review')
    expect(wrapper.text()).toContain('Uploaded vendor quote evidence')
    expect(wrapper.text()).toContain('tier3-supplier-evidence / medium')
    expect(wrapper.text()).toContain('Process Equipment Detail')
    expect(wrapper.text()).toContain('Utilities & Buildings Detail')
    expect(wrapper.text()).toContain('Working Capital Detail')
    expect(wrapper.text()).toContain('Total Investment')
    expect(wrapper.text()).toContain('Project IRR')
    expect(wrapper.text()).toContain('NPV @ 12%')
    expect(wrapper.text()).toContain('Payback Period')
    expect(wrapper.text()).toContain('Profitability Index')
    expect(wrapper.text()).toContain('5-Year ROI')
    expect(wrapper.text()).toContain('Project analysis template')
    expect(wrapper.text()).toContain('Scale-Up Esterquat Plant Project Analysis Template')
    expect(wrapper.text()).toContain('Investment Breakdown - Esterquat Plant')
    expect(wrapper.text()).toContain('Reactors, columns, exchangers, tanks, pumps, packaging')
    expect(wrapper.text()).toContain('Vendor quotes needed')
    expect(wrapper.text()).toContain('Scenario Selector')
    expect(wrapper.text()).toContain('Scenario not filled yet')
    expect(wrapper.text()).toContain('No approved source-backed value')
    expect(wrapper.text()).toContain('No source-backed value yet')
    expect(wrapper.text()).not.toMatch(/Hermes\s+verifying\s+twice\s+daily/i)
    expect(wrapper.text()).not.toMatch(/Missing\s*\/\s*Hermes\s+verifying\s+twice\s+daily/i)
    expect(wrapper.text()).toContain('User PDF Project Analysis Reference - 60,000 MT/YR Esterquat Plant')
    expect(wrapper.text()).toContain('$16M')
    expect(wrapper.text()).toContain('$49.8M')
    expect(wrapper.text()).toContain('4.1x')
    expect(wrapper.text()).toContain('User PDF screenshot / source quotes needed')
    expect(wrapper.text()).toContain('Derived from Assumptions')
    expect(wrapper.text()).not.toContain('$135M')
    expect(wrapper.text()).not.toContain('50%')
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
    expect(wrapper.text()).toContain('18.0%')
    expect(wrapper.text()).toContain('Derived from Assumptions')

    await wrapper.findAll('button').find(button => button.text() === 'Lean')!.trigger('click')
    expect(wrapper.text()).toContain('Scenario not filled yet')
    expect(wrapper.text()).toContain('No approved source-backed value')
    expect(wrapper.text()).not.toMatch(/Missing\s*\/\s*Hermes\s+verifying\s+twice\s+daily/i)
  })

  it('labels saved financial outputs as Derived from Assumptions for investor safety', () => {
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
    expect(wrapper.text()).toContain('Derived from Assumptions')
    expect(wrapper.text()).toContain('18.0%')
    expect(buildInvestorEconomicsKpis(useFeasibilityIntelligence().latestFinancialModel.value, 'Tonight')[1].evidenceStatus).toBe('Derived from Assumptions')
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
      evidenceStatus: 'Trade Proxy',
      confidence: 'high',
      source: { title: 'UN Comtrade Plus', url: 'https://comtradeplus.un.org', date: '2024' },
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
    expect(wrapper.text()).toContain('Source-backed signals')
    expect(wrapper.text()).toContain('Need direct proof')
    expect(wrapper.text()).toContain('Create research task')
    expect(marketTextLower).toContain('global market intelligence')
    expect(wrapper.text()).toContain('Textile Softeners, Esterquats, and Export-Market Signals')
    expect(wrapper.text()).toContain('China textile-chemicals anchor')
    expect(wrapper.text()).toContain('Global esterquat reference market')
    expect(wrapper.text()).toContain('Global Opportunity Map')
    expect(wrapper.text()).toContain('Country-wise Consumption Growth Tracker')
    expect(wrapper.text()).toContain('Direct softener consumption')
    expect(wrapper.text()).toContain('Auto-imported')
    expect(wrapper.text()).toContain('China: +100.0% YoY trade proxy')
    expect(wrapper.text()).toContain('UN Comtrade Plus')
    expect(wrapper.text()).toContain('official trade data, not direct textile-softener consumption')
    expect(wrapper.text()).toContain('Cotton mill-use proxy')
    expect(wrapper.text()).toContain('Vietnam')
    expect(wrapper.text()).toContain('Bangladesh')
    expect(wrapper.text()).toContain('OECD-FAO Agricultural Outlook 2025-2034')
    expect(wrapper.text()).toContain('Market Research Questions Hermes Should Answer')
    expect(wrapper.text()).toContain('User PDF reference')
    expect(wrapper.text()).toContain('Imported Market Tables From Your Document')
    expect(wrapper.text()).toContain('China Import Data - Quaternary Ammonium Textile Agents')
    expect(wrapper.text()).toContain('South Korea')
    expect(wrapper.text()).toContain('65,409')
    expect(wrapper.text()).toContain('Country-wise Cationic Softener Consumption')
    expect(wrapper.text()).toContain('World Total')
    expect(wrapper.text()).toContain('Market Segmentation Snapshot')
    expect(wrapper.text()).toContain('$3.2B')
    expect(wrapper.text()).toContain('User Provided')
    expect(wrapper.text()).toContain('Market Size / Scope')
    expect(wrapper.text()).toContain('Import Dependence')
    expect(wrapper.text()).toContain('Market Segmentation Table')
    expect(wrapper.text()).toContain('Textile Softeners Total')
    expect(wrapper.text()).toContain('Cationic / Ester Quat')
    expect(wrapper.text()).toContain('Target Countries / Provinces')
    expect(wrapper.text()).toContain('Research HS Codes')
    expect(wrapper.text()).toContain('Mainland China accounts for nearly half of global textile chemicals value')
    expect(wrapper.text()).toContain('Keqiao 8,000+ textile businesses')
    expect(wrapper.text()).toContain('Example supplier')
    expect(wrapper.text()).toContain('No source-backed value yet')
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
      evidenceStatus: 'Source-backed',
      source: { title: 'Official annual profile', url: 'https://example.com/annual-profile' },
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
    expect(wrapper.text()).toContain('Traffic')
    expect(wrapper.text()).toContain('Rating')
    expect(wrapper.text()).toContain('Last Updated')
    expect(wrapper.text()).toContain('Confidence')
    expect(wrapper.text()).toContain('🥇 Market Leader')
    expect(wrapper.text()).toContain('📈 Fastest Growth')
    expect(wrapper.text()).toContain('💰 Highest Revenue')
    expect(wrapper.text()).toContain('🔥 Most Competitive Pricing')
    expect(wrapper.text()).toContain('No source-backed leader badge')
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
    expect(wrapper.text()).toContain('price/kg, revenue, yearly growth, product equivalence, and local supplier claims remain in source review')
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
    expect(wrapper.text()).toContain('No source-backed value yet')
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
    expect(wrapper.text()).toContain('21.4%')
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
      yearlyGrowth: '+8% source-backed',
      evidenceStatus: 'Source-backed',
      source: { title: 'Official annual profile', url: 'https://example.com/alpha' },
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
      revenue: '$18M source-backed',
      yearlyGrowth: '+5% source-backed',
      evidenceStatus: 'Source-backed',
      source: { title: 'Official product variation page', url: 'https://example.com/alpha-cwms' },
      notes: 'Second product variation should not duplicate the company row.',
    })
    intelligence.addCompetitor({
      companyName: 'Beta Source Co',
      countryRegion: 'Germany',
      productEquivalent: 'Silicone Softener',
      activeContent: 'No source-backed value yet',
      pricingEvidence: '$36/kg source-backed',
      certifications: 'Official product page',
      distributionPresence: 'Official distributor page',
      marketShare: '4% source-backed',
      revenue: '$12M source-backed',
      yearlyGrowth: '+3% source-backed',
      evidenceStatus: 'Source-backed',
      source: { title: 'Official company profile', url: 'https://example.com/beta' },
      notes: 'Source-backed silicone competitor record.',
    })

    const wrapper = mount(CompetitorIntelligenceView)
    const panel = () => wrapper.get('.comparison-command-panel')

    expect(panel().text()).toContain('Competitor')
    expect(panel().text()).toContain('Product')
    expect(panel().text()).toContain('Market Share')
    expect(panel().text()).toContain('Revenue')
    expect(panel().text()).toContain('YoY Growth')
    expect(panel().text()).toContain('No source-backed value yet')
    expect(panel().text()).not.toMatch(/Hermes\s+verifying\s+twice\s+daily/i)
    const alphaRows = wrapper.findAll('.comparison-grid-row')
      .filter(row => !row.classes().includes('head') && row.text().includes('Alpha Source Co'))
    expect(alphaRows).toHaveLength(1)
    expect(alphaRows[0].text()).toContain('CWAS equivalent / CWMS variation')
    const rawAlphaRows = wrapper.findAll('.competitor-table .competitor-row')
      .filter(row => !row.classes().includes('head') && row.text().includes('Alpha Source Co'))
    expect(rawAlphaRows).toHaveLength(1)
    expect(rawAlphaRows[0].text()).toContain('CWAS equivalent / CWMS variation')
    const alphaShareRows = wrapper.findAll('.market-share-panel .share-row')
      .filter(row => row.text().includes('Alpha Source Co'))
    expect(alphaShareRows).toHaveLength(1)

    const revenueSort = wrapper.findAll('.comparison-sort-button').find(button => button.text().includes('Revenue'))
    expect(revenueSort).toBeTruthy()
    await revenueSort!.trigger('click')
    const firstSortedRow = wrapper.findAll('.comparison-grid-row').filter(row => !row.classes().includes('head'))[0]
    expect(firstSortedRow.text()).toContain('Alpha Source Co')
    expect(firstSortedRow.text()).toContain('$42M source-backed')

    const categorySelect = wrapper.findAll('.comparison-filter-bar select')[0]
    await categorySelect.setValue('Silicone Softener')
    await flushPromises()
    expect(panel().text()).toContain('Beta Source Co')
    expect(panel().text()).not.toContain('Alpha Source Co')

    const evidenceSelect = wrapper.findAll('.comparison-filter-bar select')[1]
    await evidenceSelect.setValue('Auto-checking')
    await flushPromises()
    expect(panel().text()).toContain('WACKER')
    expect(panel().text()).toContain('No source-backed value yet')
    expect(panel().text()).not.toMatch(/Hermes\s+verifying\s+twice\s+daily/i)
    expect(panel().text()).not.toContain('$18-22')
    expect(panel().text()).not.toContain('20-25%')
  })

  it('renders supplier scorecards as source-gated raw material verification targets and auto-schedules supplier research', async () => {
    useFeasibilityIntelligence().addDataRoomSource({
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
    expect(text).toContain('Hermes Autopilot has staged 1 supplier/raw-material candidates')
    expect(text).toContain('Official Supplier Candidate')
    expect(text).toContain('Stearic Acid TP')
    expect(text).toContain('Quote/TDS requested; price To Verify')
    expect(text).toContain('Official supplier product catalog')
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
    expect(text).toContain('Candidate Source')
    expect(text).toContain('Pending quote')
    expect(text).toContain('Pending regulatory review')
    expect(text).toContain('Do not use screenshot prices or supplier scores as verified facts')
    expect(text).toContain('Hermes is checking the supplier scorecard schedule automatically')
    expect(text).toContain('Check Supplier Autopilot')
    expect(text).toContain('Search')
    expect(text).toContain('Stage')
    expect(text).toContain('Owner approval')
    expect(text).toContain('Full dashboard autopilot')
    expect(text).toContain('Verify Supplier')
    expect(text).toContain('To Verify')
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
    expect(text).toContain('Hermes Autopilot has filled 1 country-wise trade-proxy records')
    expect(text).toContain('China')
    expect(text).toContain('Textile auxiliary / softener trade proxy')
    expect(text).toContain('HS 380991 trade proxy / No source-backed value yet')
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
