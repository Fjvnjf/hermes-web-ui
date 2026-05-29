// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateInvestmentScenario,
  createEmptyInvestmentScenario,
  irr,
  npv,
  summarizeInvestmentEvidence,
} from '@/utils/investmentCalculator'
import {
  buildInvestorPresentationDraft,
  calculateInvestorReadinessScore,
  canMarkMarketClaimVerified,
  formatMarketShare,
} from '@/utils/investorIntelligence'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'

const createTaskMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/hermes/kanban', () => ({
  DEFAULT_KANBAN_BOARD: 'default',
  useKanbanStore: () => ({
    selectedBoard: 'default',
    activeBoards: [{ slug: 'default', name: 'default' }],
    fetchBoards: vi.fn().mockResolvedValue(undefined),
    resolveAvailableBoard: () => 'default',
    setSelectedBoard: vi.fn(),
    createTask: createTaskMock,
  }),
}))

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}))

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
  NButton: { template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' },
  NAlert: { template: '<div class="n-alert"><slot /></div>' },
  NInput: { props: ['value'], template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />' },
  NInputNumber: { props: ['value'], template: '<input type="number" :value="value" @input="$emit(\'update:value\', Number($event.target.value))" />' },
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

import InvestorReadinessView from '@/views/hermes/InvestorReadinessView.vue'
import CompetitorIntelligenceView from '@/views/hermes/CompetitorIntelligenceView.vue'
import ResearchResultReviewView from '@/views/hermes/ResearchResultReviewView.vue'

beforeEach(() => {
  window.localStorage.clear()
  useFeasibilityIntelligence().resetFeasibilityIntelligenceForTests()
  createTaskMock.mockClear()
})

describe('investor feasibility workflow utilities', () => {
  it('calculates NPV and IRR for sample cash flows', () => {
    const cashFlows = [-1000, 400, 400, 400]

    expect(Math.round(npv(0.1, cashFlows))).toBe(-5)
    expect(irr(cashFlows)).toBeCloseTo(0.097, 2)
  })

  it('warns when an investment scenario has incomplete inputs', () => {
    const scenario = createEmptyInvestmentScenario()
    const result = calculateInvestmentScenario(scenario)

    expect(result.incomplete).toBe(true)
    expect(result.warnings.join(' ')).toContain('Revenue assumptions are missing')
  })

  it('calculates outputs when revenue and capex assumptions are provided', () => {
    const scenario = createEmptyInvestmentScenario()
    scenario.capex.machinery.value = 1000
    scenario.products[0].annualVolumeTon = [10, 10, 10, 10, 10]
    scenario.products[0].sellingPricePerTon = [100, 100, 100, 100, 100]
    scenario.variableCostPerTon.rawMaterials.value = 20

    const result = calculateInvestmentScenario(scenario)

    expect(result.cashFlows[0]).toBe(-1000)
    expect(result.yearly[0].revenue).toBe(1000)
    expect(result.irr).not.toBeNull()
  })

  it('summarizes investment evidence statuses for financial readiness', () => {
    const scenario = createEmptyInvestmentScenario()
    scenario.capex.machinery.evidenceStatus = 'Verified'
    scenario.products[0].evidenceStatus = 'User Provided'
    scenario.discountRate.evidenceStatus = 'Assumption'

    const summary = summarizeInvestmentEvidence(scenario)

    expect(summary.total).toBeGreaterThan(0)
    expect(summary.verified).toBeGreaterThan(0)
    expect(summary.userProvided).toBeGreaterThan(0)
    expect(summary.weak).toBeGreaterThan(0)
  })

  it('blocks verified market claims without a source', () => {
    expect(canMarkMarketClaimVerified({
      label: 'Market size',
      value: '100',
      evidenceStatus: 'Verified',
      source: null,
    })).toBe(false)
  })

  it('displays unknown competitor market share as To Verify', () => {
    expect(formatMarketShare('')).toBe('To Verify')
    expect(formatMarketShare(null)).toBe('To Verify')
  })

  it('excludes unsupported investor presentation claims', () => {
    const draft = buildInvestorPresentationDraft([
      { section: 'Market Evidence', content: 'Unsupported market claim', evidenceStatus: 'Verified', source: null },
      { section: 'Use of Funds', content: 'User approved use-of-funds draft', evidenceStatus: 'User Approved' },
    ])

    expect(draft).toHaveLength(1)
    expect(draft[0].section).toBe('Use of Funds')
  })

  it('scores readiness from evidence status only', () => {
    const score = calculateInvestorReadinessScore([
      { label: 'Legal', evidenceStatus: 'Verified' },
      { label: 'Market', evidenceStatus: 'Missing' },
      { label: 'Finance', evidenceStatus: 'Assumption' },
    ])

    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(100)
  })

  it('keeps verified market claims To Verify until a usable source is attached', () => {
    const intelligence = useFeasibilityIntelligence()

    const saved = intelligence.addMarketClaim({
      label: 'China market size',
      value: '100 MT',
      evidenceStatus: 'Verified',
      source: null,
      confidence: 'high',
    })

    expect(saved.evidenceStatus).toBe('To Verify')
    expect(intelligence.verifiedClaimCount.value).toBe(0)
  })

  it('promotes source-backed market evidence into shared readiness state', () => {
    const intelligence = useFeasibilityIntelligence()
    const source = { title: 'Distributor interview notes', date: '2026-05-30' }

    const saved = intelligence.addMarketClaim({
      label: 'CWAS pricing evidence',
      value: 'User-approved source-backed note',
      evidenceStatus: 'Verified',
      source,
      confidence: 'medium',
    })
    intelligence.updateEvidenceStatus('market', saved.evidenceStatus, source)

    expect(saved.evidenceStatus).toBe('Verified')
    expect(intelligence.verifiedClaimCount.value).toBe(1)
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'market')?.evidenceStatus).toBe('Verified')
  })

  it('stores approved investor material while excluding unsupported draft claims', () => {
    const intelligence = useFeasibilityIntelligence()

    intelligence.addPresentationMaterial({
      section: 'Use of Funds',
      content: 'User approved use-of-funds draft',
      evidenceStatus: 'User Approved',
    })
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Unsupported verified claim',
      evidenceStatus: 'Verified',
      source: null,
    })

    const draft = buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)

    expect(intelligence.approvedPresentationCount.value).toBe(1)
    expect(draft).toHaveLength(1)
    expect(draft[0].section).toBe('Use of Funds')
  })

  it('allows assumption-labeled derived financial outputs in investor drafts', () => {
    const draft = buildInvestorPresentationDraft([
      {
        section: 'IRR / Investor Return',
        content: 'NPV and IRR summary labeled as derived from assumptions.',
        evidenceStatus: 'Derived from Assumptions',
      },
    ])

    expect(draft).toHaveLength(1)
    expect(draft[0].sourceLabel).toBe('Derived from assumptions')
  })

  it('downgrades verified competitor records without source evidence', () => {
    const intelligence = useFeasibilityIntelligence()

    const saved = intelligence.addCompetitor({
      companyName: 'Example competitor',
      countryRegion: 'China',
      productEquivalent: 'To Verify',
      activeContent: 'To Verify',
      pricingEvidence: 'Missing',
      certifications: 'To Verify',
      distributionPresence: 'To Verify',
      marketShare: '',
      evidenceStatus: 'Verified',
      source: null,
      notes: 'No source yet',
    })

    expect(saved.evidenceStatus).toBe('To Verify')
    expect(formatMarketShare(saved.marketShare)).toBe('To Verify')
  })

  it('keeps unsourced verified research findings pending as To Verify', () => {
    const intelligence = useFeasibilityIntelligence()

    const saved = intelligence.addResearchFinding({
      summary: 'A research output mentioned a market claim without a usable source.',
      keyClaim: 'Unsourced market claim',
      area: 'market',
      evidenceStatus: 'Verified',
      confidence: 'high',
      source: null,
      suggestedInvestorMaterial: 'Unsupported investor claim',
    })

    expect(saved.evidenceStatus).toBe('To Verify')
    expect(saved.status).toBe('Pending Review')
    expect(intelligence.pendingResearchFindings.value).toHaveLength(1)
  })

  it('approves source-backed research findings into readiness and presentation material', () => {
    const intelligence = useFeasibilityIntelligence()
    const source = { title: 'Supplier interview', date: '2026-05-30' }
    const saved = intelligence.addResearchFinding({
      summary: 'Supplier provided a source-backed product evidence note.',
      keyClaim: 'Product evidence source exists',
      area: 'product',
      evidenceStatus: 'Verified',
      confidence: 'medium',
      source,
      suggestedInvestorMaterial: 'Product evidence has a supplier-backed source and should be cited in the appendix.',
    })

    const approved = intelligence.approveResearchFinding(saved.id, {
      updateReadiness: true,
      addToPresentation: true,
    })

    expect(approved?.status).toBe('Approved')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'product')?.evidenceStatus).toBe('Verified')
    expect(buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)).toHaveLength(1)
  })

  it('records research jobs from capture/intelligence pages in shared state', () => {
    const intelligence = useFeasibilityIntelligence()

    const saved = intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      context: 'Chemicon China Feasibility',
      status: 'Task Created',
    })

    expect(saved.status).toBe('Task Created')
    expect(intelligence.state.value.researchJobs[0].title).toContain('DMS')
  })

  it('saves financial model snapshots and updates financial readiness status', () => {
    const intelligence = useFeasibilityIntelligence()

    const saved = intelligence.saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Derived from Assumptions',
      npv: 1000,
      irr: 0.18,
      mirr: 0.15,
      paybackYear: 3,
      breakEvenVolumeTon: 1200,
      capexTotal: 5000,
      yearOneRevenue: 9000,
      warnings: ['Outputs are derived from assumptions or unverified inputs.'],
    })

    expect(saved.evidenceStatus).toBe('Derived from Assumptions')
    expect(intelligence.latestFinancialModel.value?.scenarioName).toBe('Base')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'financial')?.evidenceStatus).toBe('Derived from Assumptions')
  })
})

describe('investor readiness pages', () => {
  it('renders the investor readiness shell without fake readiness data', () => {
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Investor-Ready Feasibility Intelligence')
    expect(wrapper.text()).toContain('Missing')
    expect(wrapper.text()).toContain('To Verify')
  })

  it('renders competitor unknown market share as To Verify', () => {
    const wrapper = mount(CompetitorIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Evidence-Backed Competitor Tracking')
    expect(wrapper.text()).toContain('To Verify')
  })

  it('renders staged research jobs and findings in Research Result Review', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      context: 'Chemicon China Feasibility',
      status: 'Task Created',
    })
    intelligence.addResearchFinding({
      summary: 'Research finding summary awaiting approval.',
      keyClaim: 'DMS regulation source needed',
      area: 'regulatory',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: null,
    })

    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Approve Research Before It Changes Anything')
    expect(wrapper.text()).toContain('DMS regulation in China')
    expect(wrapper.text()).toContain('DMS regulation source needed')
  })
})
