// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExecutiveOverviewView from '@/views/hermes/ExecutiveOverviewView.vue'
import InvestmentAnalysisView from '@/views/hermes/InvestmentAnalysisView.vue'
import MarketIntelligenceView from '@/views/hermes/MarketIntelligenceView.vue'
import CompetitorIntelligenceView from '@/views/hermes/CompetitorIntelligenceView.vue'
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
const fetchBoardsMock = vi.hoisted(() => vi.fn())
const setSelectedBoardMock = vi.hoisted(() => vi.fn())

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
    createJob: createJobMock,
  }),
}))

vi.mock('@/api/client', () => ({
  getStoredUserRole: () => 'super_admin',
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
    fetchBoardsMock.mockReset().mockResolvedValue(undefined)
    setSelectedBoardMock.mockReset()
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

  it('keeps Investment Analysis values To Verify until an IRR Calculator snapshot exists', () => {
    const wrapper = mount(InvestmentAnalysisView)

    expect(wrapper.text()).toContain('Investment Analysis')
    expect(wrapper.text()).toContain('Investor Economics Control Panel')
    expect(wrapper.text()).toContain('Process Equipment Detail')
    expect(wrapper.text()).toContain('Utilities & Buildings Detail')
    expect(wrapper.text()).toContain('Working Capital Detail')
    expect(wrapper.text()).toContain('Total Investment')
    expect(wrapper.text()).toContain('Project IRR')
    expect(wrapper.text()).toContain('NPV @ 12%')
    expect(wrapper.text()).toContain('Payback Period')
    expect(wrapper.text()).toContain('Profitability Index')
    expect(wrapper.text()).toContain('5-Year ROI')
    expect(wrapper.text()).toContain('Scenario Selector')
    expect(wrapper.text()).toContain('Scenario not filled yet')
    expect(wrapper.text()).toContain('Missing / To Verify')
    expect(wrapper.text()).toContain('To Verify')
    expect(wrapper.text()).not.toContain('$135M')
    expect(wrapper.text()).not.toContain('60,000')
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
    expect(wrapper.text()).toContain('Missing / To Verify')
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

  it('shows Market Intelligence values and competitor market share as To Verify when unsourced', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'China market size',
      value: '',
      evidenceStatus: 'Source-backed',
      source: null,
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

    expect(wrapper.text()).toContain('Executive Market Panel')
    expect(wrapper.text()).toContain('Market Size / Scope')
    expect(wrapper.text()).toContain('Import Dependence')
    expect(wrapper.text()).toContain('Market Segmentation Table')
    expect(wrapper.text()).toContain('Textile Softeners Total')
    expect(wrapper.text()).toContain('Cationic / Ester Quat')
    expect(wrapper.text()).toContain('Target Countries / Provinces')
    expect(wrapper.text()).toContain('Research HS Codes')
    expect(wrapper.text()).toContain('Missing / To Verify')
    expect(wrapper.text()).toContain('Example supplier')
    expect(wrapper.text()).toContain('To Verify')
    expect(competitorMarketShare('', null, 'Verified')).toBe('To Verify')
  })

  it('renders Competitor Intelligence product context, landscape, and source-gated market share chart', () => {
    const wrapper = mount(CompetitorIntelligenceView)

    expect(wrapper.text()).toContain('Product Context Panel')
    expect(wrapper.text()).toContain('Cationic Softeners / CHEMISOFT')
    expect(wrapper.text()).toContain('CHEMISIL HS 200')
    expect(wrapper.text()).toContain('Competitor Landscape Table')
    expect(wrapper.text()).toContain('Competitor Market Share Chart')
    expect(wrapper.text()).toContain('No source-backed competitor share data yet.')
    expect(wrapper.text()).toContain('Research Competitor')
    expect(wrapper.text()).toContain('Schedule Deeper Research')
  })

  it('stages Sync Now as a Research Result Review item instead of silently approving market or finance facts', async () => {
    const marketWrapper = mount(MarketIntelligenceView)
    await marketWrapper.findAll('button').find(button => button.text().includes('Sync Now'))!.trigger('click')
    await flushPromises()

    const investmentWrapper = mount(InvestmentAnalysisView)
    await investmentWrapper.findAll('button').find(button => button.text().includes('Sync Now'))!.trigger('click')
    await flushPromises()

    const findings = useFeasibilityIntelligence().pendingResearchFindings.value
    expect(findings.some(item => item.keyClaim.includes('Market intelligence'))).toBe(true)
    expect(findings.some(item => item.keyClaim.includes('Investment analysis'))).toBe(true)
    expect(findings.every(item => item.status === 'Pending Review' || item.status === 'To Verify')).toBe(true)
  })

  it('keeps employee and investor route access conservative', () => {
    expect(canAccessRouteName('hermes.executiveOverview', 'employee')).toBe(true)
    expect(canAccessRouteName('hermes.investmentAnalysis', 'employee')).toBe(false)
    expect(canAccessRouteName('hermes.investmentAnalysis', 'financial_analyst')).toBe(true)
    expect(canAccessRouteName('hermes.executiveOverview', 'investor_viewer')).toBe(false)
  })
})
