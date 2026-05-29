// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateInvestmentScenario,
  createEmptyInvestmentScenario,
  hasUsableInvestmentOutputs,
  irr,
  npv,
  summarizeInvestmentEvidence,
} from '@/utils/investmentCalculator'
import {
  buildInvestorPresentationDraft,
  buildInvestorNextActions,
  buildInvestorSlideOutline,
  calculateInvestorReadinessScore,
  canMarkMarketClaimVerified,
  formatMarketShare,
  formatInvestorPresentationOutline,
  presentationSectionForEvidence,
} from '@/utils/investorIntelligence'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import type { EvidenceArea } from '@/composables/useFeasibilityIntelligence'
import type { IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'

interface InvestorReadinessTestVm {
  evidenceForm: {
    area: EvidenceArea
    evidenceStatus: IntelligenceEvidenceStatus
    sourceTitle: string
    sourceUrl: string
    sourceDate: string
  }
  saveEvidenceStatus: () => void
}

const createTaskMock = vi.hoisted(() => vi.fn())
const fetchMemoryMock = vi.hoisted(() => vi.fn())
const saveMemoryMock = vi.hoisted(() => vi.fn())
const checkConnectionMock = vi.hoisted(() => vi.fn())
const loadModelsMock = vi.hoisted(() => vi.fn())
const fetchSessionsMock = vi.hoisted(() => vi.fn())
const listJobsMock = vi.hoisted(() => vi.fn())
const fetchPerformanceRuntimeMock = vi.hoisted(() => vi.fn())

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

vi.mock('@/api/hermes/skills', () => ({
  fetchMemory: fetchMemoryMock,
  saveMemory: saveMemoryMock,
}))

vi.mock('@/api/hermes/sessions', () => ({
  fetchSessions: fetchSessionsMock,
}))

vi.mock('@/api/hermes/jobs', () => ({
  listJobs: listJobsMock,
}))

vi.mock('@/api/hermes/performance-monitor', () => ({
  fetchPerformanceRuntime: fetchPerformanceRuntimeMock,
}))

vi.mock('@/api/client', () => ({
  getActiveProfileName: () => 'default',
  hasApiKey: () => true,
}))

vi.mock('@/stores/hermes/app', () => ({
  useAppStore: () => ({
    connected: true,
    modelGroups: [{ provider: 'openai-codex', models: [] }],
    selectedModel: 'gpt-5.5',
    selectedProvider: 'openai-codex',
    displayModelName: (model: string) => model,
    checkConnection: checkConnectionMock,
    loadModels: loadModelsMock,
  }),
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
import MarketIntelligenceView from '@/views/hermes/MarketIntelligenceView.vue'
import CompetitorIntelligenceView from '@/views/hermes/CompetitorIntelligenceView.vue'
import ResearchResultReviewView from '@/views/hermes/ResearchResultReviewView.vue'
import InvestorPresentationBuilderView from '@/views/hermes/InvestorPresentationBuilderView.vue'
import DashboardView from '@/views/hermes/DashboardView.vue'
import InvestmentCalculatorView from '@/views/hermes/InvestmentCalculatorView.vue'

beforeEach(() => {
  window.localStorage.clear()
  Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), writable: true })
  useFeasibilityIntelligence().resetFeasibilityIntelligenceForTests()
  createTaskMock.mockReset().mockResolvedValue({ id: 'task-1' })
  fetchMemoryMock.mockReset().mockResolvedValue({ memory: 'Existing memory' })
  saveMemoryMock.mockReset().mockResolvedValue(undefined)
  checkConnectionMock.mockReset().mockResolvedValue(undefined)
  loadModelsMock.mockReset().mockResolvedValue(undefined)
  fetchSessionsMock.mockReset().mockResolvedValue([])
  listJobsMock.mockReset().mockResolvedValue([])
  fetchPerformanceRuntimeMock.mockReset().mockResolvedValue({
    sessions: { active: 0, running: 0 },
    bridge: { reachable: true, workers: [] },
  })
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

  it('separates usable financial outputs from weak assumption evidence', () => {
    const scenario = createEmptyInvestmentScenario()
    scenario.capex.machinery.value = 1000
    scenario.products[0].annualVolumeTon = [10, 10, 10, 10, 10]
    scenario.products[0].sellingPricePerTon = [100, 100, 100, 100, 100]
    scenario.variableCostPerTon.rawMaterials.value = 20

    const result = calculateInvestmentScenario(scenario)

    expect(result.incomplete).toBe(true)
    expect(result.warnings).toContain('Outputs are derived from assumptions or unverified inputs.')
    expect(hasUsableInvestmentOutputs(result)).toBe(true)
  })

  it('calculates investor return lens from funding and exit assumptions', () => {
    const scenario = createEmptyInvestmentScenario()
    scenario.capex.machinery.value = 1000
    scenario.products[0].annualVolumeTon = [10, 10, 10, 10, 10]
    scenario.products[0].sellingPricePerTon = [100, 100, 100, 100, 100]
    scenario.variableCostPerTon.rawMaterials.value = 20
    scenario.funding.investorAmount.value = 500
    scenario.funding.investorEquityPercent.value = 25
    scenario.funding.exitYear.value = 3
    scenario.funding.exitMultiple.value = 5

    const result = calculateInvestmentScenario(scenario)

    expect(result.investorExitValue).toBe(4000)
    expect(result.investorExitProceeds).toBe(1000)
    expect(result.investorMoic).toBe(2)
    expect(result.investorCashFlows[0]).toBe(-500)
    expect(result.investorCashFlows[3]).toBe(1000)
    expect(result.investorIrr).toBeCloseTo(0.26, 2)
  })

  it('warns when funding assumptions do not cover modeled capex', () => {
    const scenario = createEmptyInvestmentScenario()
    scenario.capex.machinery.value = 1000
    scenario.funding.investorAmount.value = 200
    scenario.funding.founderContribution.value = 300

    const result = calculateInvestmentScenario(scenario)

    expect(result.totalFunding).toBe(500)
    expect(result.fundingGap).toBe(500)
    expect(result.warnings).toContain('Funding assumptions do not cover modeled capex.')
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

  it('updates market claims while enforcing source-backed verification', () => {
    const intelligence = useFeasibilityIntelligence()
    const saved = intelligence.addMarketClaim({
      label: 'CWAS price validation note',
      value: '',
      evidenceStatus: 'To Verify',
      source: null,
      confidence: 'low',
    })

    const unsourced = intelligence.updateMarketClaim(saved.id!, {
      value: 'Sourced value still missing source reference',
      evidenceStatus: 'Verified',
      source: null,
    })
    const sourced = intelligence.updateMarketClaim(saved.id!, {
      value: 'User-provided sourced validation note',
      evidenceStatus: 'Verified',
      source: { title: 'Distributor interview', date: '2026-05-30' },
      confidence: 'medium',
    })

    expect(unsourced?.evidenceStatus).toBe('To Verify')
    expect(sourced?.evidenceStatus).toBe('Verified')
    expect(sourced?.source?.title).toBe('Distributor interview')
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

  it('updates staged investor material while enforcing source-backed verification', () => {
    const intelligence = useFeasibilityIntelligence()
    const saved = intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Market evidence note awaiting source.',
      evidenceStatus: 'User Approved',
    })

    const unsourced = intelligence.updatePresentationMaterial(saved.id!, {
      evidenceStatus: 'Verified',
      source: null,
    })
    const sourced = intelligence.updatePresentationMaterial(saved.id!, {
      evidenceStatus: 'Verified',
      source: { title: 'Distributor interview', date: '2026-05-30' },
    })

    expect(unsourced?.evidenceStatus).toBe('To Verify')
    expect(sourced?.evidenceStatus).toBe('Verified')
    expect(buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)).toHaveLength(1)
  })

  it('removes staged investor material without changing research review history', () => {
    const intelligence = useFeasibilityIntelligence()
    const saved = intelligence.addPresentationMaterial({
      section: 'Use of Funds',
      content: 'Material to remove from investor draft.',
      evidenceStatus: 'User Approved',
    })
    intelligence.addResearchFinding({
      summary: 'Original reviewed finding should remain after deck cleanup.',
      keyClaim: 'Use of funds note',
      area: 'presentation',
      evidenceStatus: 'User Approved',
      confidence: 'medium',
    })

    expect(intelligence.removePresentationMaterial(saved.id!)).toBe(true)
    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
    expect(intelligence.state.value.researchFindings).toHaveLength(1)
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

  it('keeps source details attached to investor-ready draft sections', () => {
    const draft = buildInvestorPresentationDraft([
      {
        section: 'Market Evidence',
        content: 'Distributor interview supports a pricing validation note.',
        evidenceStatus: 'Verified',
        source: { title: 'Distributor interview', date: '2026-05-30' },
      },
    ])

    expect(draft).toHaveLength(1)
    expect(draft[0].sourceLabel).toBe('Distributor interview')
    expect(draft[0].sourceDetail).toContain('2026-05-30')
  })

  it('builds a slide outline only from approved investor material', () => {
    const slides = buildInvestorSlideOutline(['Executive Summary', 'Market Evidence'], [
      {
        section: 'Executive Summary',
        content: 'Approved executive summary.',
        evidenceStatus: 'User Approved',
      },
      {
        section: 'Market Evidence',
        content: 'Unsupported market claim.',
        evidenceStatus: 'Verified',
        source: null,
      },
    ])
    const outline = formatInvestorPresentationOutline(slides)

    expect(slides[0].status).toBe('Ready')
    expect(slides[1].status).toBe('Missing / To Verify')
    expect(outline).toContain('Ready slides: 1/2')
    expect(outline).not.toContain('Unsupported market claim')
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

  it('updates competitor records while enforcing source-backed verification', () => {
    const intelligence = useFeasibilityIntelligence()
    const saved = intelligence.addCompetitor({
      companyName: 'Editable competitor',
      countryRegion: 'China',
      productEquivalent: 'To Verify',
      activeContent: 'To Verify',
      pricingEvidence: 'Missing',
      certifications: 'To Verify',
      distributionPresence: 'To Verify',
      marketShare: '',
      evidenceStatus: 'To Verify',
      source: null,
      notes: 'No source yet.',
    })

    const unsourced = intelligence.updateCompetitor(saved.id, {
      pricingEvidence: 'Claimed quote without source',
      evidenceStatus: 'Verified',
      source: null,
    })
    const sourced = intelligence.updateCompetitor(saved.id, {
      pricingEvidence: 'Distributor quote note',
      productEquivalent: 'CWAS equivalent',
      evidenceStatus: 'Verified',
      source: { title: 'Distributor quote', date: '2026-05-30' },
    })

    expect(unsourced?.evidenceStatus).toBe('To Verify')
    expect(sourced?.evidenceStatus).toBe('Verified')
    expect(sourced?.pricingEvidence).toBe('Distributor quote note')
    expect(sourced?.source?.title).toBe('Distributor quote')
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

  it('maps approved research investor material into the fixed slide outline', () => {
    const intelligence = useFeasibilityIntelligence()
    const saved = intelligence.addResearchFinding({
      summary: 'A distributor interview supports a market pricing validation note.',
      keyClaim: 'Market claim: CWAS pricing evidence',
      area: 'market',
      evidenceStatus: 'Verified',
      confidence: 'medium',
      source: { title: 'Distributor interview', date: '2026-05-30' },
      suggestedInvestorMaterial: 'Distributor interview supports a source-backed pricing validation note.',
    })

    intelligence.approveResearchFinding(saved.id, {
      addToPresentation: true,
      updateReadiness: true,
    })
    const slides = buildInvestorSlideOutline(['Market Evidence'], intelligence.state.value.presentationMaterials)

    expect(intelligence.state.value.presentationMaterials[0].section).toBe('Market Evidence')
    expect(slides[0].status).toBe('Ready')
    expect(slides[0].content).toContain('Distributor interview supports')
  })

  it('maps readiness draft material into a fixed investor slide section', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.updateEvidenceStatus('product', 'Verified', {
      title: 'CWAS SDS source',
      date: '2026-05-30',
    })
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const addButtons = wrapper.findAll('button').filter(button => button.text() === 'Add to investor draft')

    expect(addButtons.length).toBeGreaterThan(1)
    await addButtons[1].trigger('click')

    expect(intelligence.state.value.presentationMaterials[0].section).toBe('Product Plan')
    expect(buildInvestorSlideOutline(['Product Plan'], intelligence.state.value.presentationMaterials)[0].status).toBe('Ready')
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

  it('updates deferred research jobs after they become real tasks', () => {
    const intelligence = useFeasibilityIntelligence()
    const saved = intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      context: 'Chemicon China Feasibility',
      status: 'Later',
    })

    const updated = intelligence.updateResearchJobStatus(saved.id, 'Task Created')

    expect(updated?.status).toBe('Task Created')
    expect(intelligence.state.value.researchJobs[0].status).toBe('Task Created')
  })

  it('builds honest next actions from current investor evidence state', () => {
    const intelligence = useFeasibilityIntelligence()

    const actions = buildInvestorNextActions(intelligence.state.value)

    expect(actions[0].title).toContain('Regulatory evidence')
    expect(actions.some(action => action.title === 'Save a financial model snapshot')).toBe(true)
    expect(actions.some(action => action.title === 'Collect source-backed market evidence')).toBe(true)
    expect(actions.some(action => action.title === 'Stage approved investor material')).toBe(true)
    expect(actions.every(action => !action.reason.includes('market share is'))).toBe(true)
  })

  it('maps evidence areas and text hints to investor presentation sections', () => {
    expect(presentationSectionForEvidence('companyLegal', 'business license')).toBe('Chemicon Background')
    expect(presentationSectionForEvidence('market', 'competitor pricing proof')).toBe('Competitor Landscape')
    expect(presentationSectionForEvidence('financial', 'investor IRR and NPV')).toBe('IRR / Investor Return')
    expect(presentationSectionForEvidence('regulatory', 'DMS permission risk')).toBe('Risk & Mitigation')
  })

  it('points next actions to research review and financial review when data exists', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: 'Pending source-backed research review.',
      keyClaim: 'DMS evidence needs approval',
      area: 'regulatory',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
    })
    intelligence.saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Derived from Assumptions',
      npv: 100,
      irr: 0.12,
      mirr: 0.1,
      paybackYear: 4,
      breakEvenVolumeTon: 1200,
      capexTotal: 1000,
      yearOneRevenue: 500,
      warnings: ['Outputs are derived from assumptions.'],
    })

    const actions = buildInvestorNextActions(intelligence.state.value)

    expect(actions.some(action => action.routeName === 'hermes.researchResultReview')).toBe(true)
    expect(actions.some(action => action.title === 'Review Base financial assumptions')).toBe(true)
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
  it('lets non-cost investment assumptions carry editable evidence status', () => {
    const wrapper = mount(InvestmentCalculatorView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.find('select[aria-label="Setup months evidence status"]').exists()).toBe(true)
    expect(wrapper.find('select[aria-label="Discount rate evidence status"]').exists()).toBe(true)
    expect(wrapper.find('select[aria-label="Tax rate evidence status"]').exists()).toBe(true)
    expect(wrapper.find('select[aria-label="Terminal value evidence status"]').exists()).toBe(true)
    expect(wrapper.find('select[aria-label="Investor amount evidence status"]').exists()).toBe(true)
    expect(wrapper.find('select[aria-label="Customer credit days evidence status"]').exists()).toBe(true)
    expect(wrapper.find('select[aria-label="Revenue assumptions evidence status"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Investor Return Lens')
    expect(wrapper.text()).toContain('Funding gap')
    expect(wrapper.text()).toContain('Investor IRR')
  })

  it('stages calculable financial outputs as assumption-labeled investor material', async () => {
    const intelligence = useFeasibilityIntelligence()
    const base = createEmptyInvestmentScenario('Chemicon China Feasibility - Base')
    base.capex.machinery.value = 1000
    base.products[0].annualVolumeTon = [10, 10, 10, 10, 10]
    base.products[0].sellingPricePerTon = [100, 100, 100, 100, 100]
    base.variableCostPerTon.rawMaterials.value = 20
    window.localStorage.setItem('hermes.investmentCalculator.scenarios.v1', JSON.stringify({
      Lean: createEmptyInvestmentScenario('Chemicon China Feasibility - Lean'),
      Base: base,
      Conservative: createEmptyInvestmentScenario('Chemicon China Feasibility - Conservative'),
      Aggressive: createEmptyInvestmentScenario('Chemicon China Feasibility - Aggressive'),
    }))
    const wrapper = mount(InvestmentCalculatorView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const addButton = wrapper.findAll('button').find(button => button.text() === 'Add assumption-labeled draft')

    expect(wrapper.text()).toContain('Can stage as investor draft text')
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    expect(intelligence.state.value.presentationMaterials[0].section).toBe('IRR / Investor Return')
    expect(intelligence.state.value.presentationMaterials[0].evidenceStatus).toBe('Derived from Assumptions')
    expect(intelligence.state.value.presentationMaterials[0].content).toContain('All outputs are derived from assumptions')
    const draft = buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)
    expect(draft.length).toBeGreaterThan(0)
    expect(draft.every(item => item.evidenceStatus === 'Derived from Assumptions')).toBe(true)
  })

  it('creates a Kanban task for weak financial model evidence without approving outputs', async () => {
    const intelligence = useFeasibilityIntelligence()
    const base = createEmptyInvestmentScenario('Chemicon China Feasibility - Base')
    base.capex.machinery.value = 1000
    base.products[0].annualVolumeTon = [10, 10, 10, 10, 10]
    base.products[0].sellingPricePerTon = [100, 100, 100, 100, 100]
    base.variableCostPerTon.rawMaterials.value = 20
    window.localStorage.setItem('hermes.investmentCalculator.scenarios.v1', JSON.stringify({
      Lean: createEmptyInvestmentScenario('Chemicon China Feasibility - Lean'),
      Base: base,
      Conservative: createEmptyInvestmentScenario('Chemicon China Feasibility - Conservative'),
      Aggressive: createEmptyInvestmentScenario('Chemicon China Feasibility - Aggressive'),
    }))
    const wrapper = mount(InvestmentCalculatorView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const taskButton = wrapper.findAll('button').find(button => button.text() === 'Create financial evidence task')

    expect(taskButton).toBeTruthy()
    await taskButton!.trigger('click')

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Financial evidence: Base model assumptions',
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    }))
    expect(createTaskMock.mock.calls[0][0].body).toContain('Weak inputs:')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Do not treat IRR, NPV, investor return, or payback as verified investor claims')
    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'financial')?.evidenceStatus).toBe('Assumption')
  })

  it('renders the investor readiness shell without fake readiness data', () => {
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Investor-Ready Feasibility Intelligence')
    expect(wrapper.text()).toContain('Missing')
    expect(wrapper.text()).toContain('To Verify')
  })

  it('saves source-backed readiness evidence from the intake form', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const vm = wrapper.vm as unknown as InvestorReadinessTestVm

    vm.evidenceForm.area = 'product'
    vm.evidenceForm.evidenceStatus = 'Verified'
    vm.evidenceForm.sourceTitle = 'CWAS SDS source'
    vm.evidenceForm.sourceDate = '2026-05-30'
    vm.saveEvidenceStatus()
    await wrapper.vm.$nextTick()

    const product = intelligence.state.value.evidenceItems.find(item => item.id === 'product')
    expect(product?.evidenceStatus).toBe('Verified')
    expect(product?.source?.title).toBe('CWAS SDS source')
  })

  it('shows saved evidence sources in readiness cards and data-room checklist', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.updateEvidenceStatus('product', 'Verified', {
      title: 'CWAS SDS source',
      date: '2026-05-30',
    })

    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('CWAS SDS source')
    expect(wrapper.text()).toContain('Product TDS/SDS and CAS evidence')
    expect(wrapper.text()).toContain('Verified')
    expect(wrapper.text()).not.toContain('Product TDS/SDS and CAS evidence Missing / To Verify')
  })

  it('removes a market claim without silently changing readiness evidence', async () => {
    const intelligence = useFeasibilityIntelligence()
    const source = { title: 'Distributor interview', date: '2026-05-30' }
    const claim = intelligence.addMarketClaim({
      label: 'CWAS price validation note',
      value: 'Source-backed user note',
      evidenceStatus: 'Verified',
      source,
      confidence: 'medium',
    })
    intelligence.updateEvidenceStatus('market', claim.evidenceStatus, source)
    const wrapper = mount(MarketIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const removeButton = wrapper.findAll('button').find(button => button.text().includes('Remove claim'))

    expect(removeButton).toBeTruthy()
    await removeButton!.trigger('click')

    expect(intelligence.state.value.marketClaims).toHaveLength(0)
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'market')?.evidenceStatus).toBe('Verified')
  })

  it('stages source-backed market claims for research review without updating readiness', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'CWAS price validation note',
      value: 'Distributor interview supports price validation note',
      evidenceStatus: 'Verified',
      source: { title: 'Distributor interview', date: '2026-05-30' },
      confidence: 'medium',
    })
    const wrapper = mount(MarketIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const stageButton = wrapper.findAll('button').find(button => button.text().includes('Stage for review'))

    expect(stageButton).toBeTruthy()
    await stageButton!.trigger('click')

    const finding = intelligence.state.value.researchFindings[0]
    expect(finding.keyClaim).toBe('Market claim: CWAS price validation note')
    expect(finding.evidenceStatus).toBe('Verified')
    expect(finding.source?.title).toBe('Distributor interview')
    expect(finding.status).toBe('Pending Review')
    expect(finding.suggestedInvestorMaterial).toContain('Distributor interview supports price validation note')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'market')?.evidenceStatus).toBe('To Verify')
  })

  it('keeps unsourced market claims To Verify when staged for review', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'Unsourced market size note',
      value: 'Claimed market size without source',
      evidenceStatus: 'Verified',
      source: null,
      confidence: 'high',
    })
    const wrapper = mount(MarketIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const stageButton = wrapper.findAll('button').find(button => button.text().includes('Stage for review'))

    await stageButton!.trigger('click')

    const finding = intelligence.state.value.researchFindings[0]
    expect(finding.keyClaim).toBe('Market claim: Unsourced market size note')
    expect(finding.evidenceStatus).toBe('To Verify')
    expect(finding.source).toBeNull()
    expect(finding.suggestedInvestorMaterial).toBe('')
  })

  it('keeps verified readiness evidence To Verify when source is missing', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const vm = wrapper.vm as unknown as InvestorReadinessTestVm

    vm.evidenceForm.area = 'regulatory'
    vm.evidenceForm.evidenceStatus = 'Verified'
    vm.saveEvidenceStatus()
    await wrapper.vm.$nextTick()

    const regulatory = intelligence.state.value.evidenceItems.find(item => item.id === 'regulatory')
    expect(regulatory?.evidenceStatus).toBe('To Verify')
    expect(regulatory?.source).toBeNull()
  })

  it('renders competitor unknown market share as To Verify', () => {
    const wrapper = mount(CompetitorIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Evidence-Backed Competitor Tracking')
    expect(wrapper.text()).toContain('To Verify')
  })

  it('stages source-backed competitor evidence for research review without updating readiness', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addCompetitor({
      companyName: 'Example competitor',
      countryRegion: 'China',
      productEquivalent: 'CWAS equivalent',
      activeContent: '90% active content',
      pricingEvidence: 'Distributor quote note',
      certifications: 'To Verify',
      distributionPresence: 'Distributor in China',
      marketShare: '',
      evidenceStatus: 'Verified',
      source: { title: 'Distributor quote', date: '2026-05-30' },
      notes: 'Pricing source needs investor review before use.',
    })
    const wrapper = mount(CompetitorIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const stageButton = wrapper.findAll('button').find(button => button.text().includes('Stage for review'))

    expect(stageButton).toBeTruthy()
    await stageButton!.trigger('click')

    const finding = intelligence.state.value.researchFindings[0]
    expect(finding.keyClaim).toBe('Competitor evidence: Example competitor')
    expect(finding.evidenceStatus).toBe('Verified')
    expect(finding.source?.title).toBe('Distributor quote')
    expect(finding.status).toBe('Pending Review')
    expect(finding.suggestedInvestorMaterial).toContain('CWAS equivalent')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'market')?.evidenceStatus).toBe('To Verify')
  })

  it('keeps unsourced competitor evidence To Verify when staged for review', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addCompetitor({
      companyName: 'Unsourced competitor',
      countryRegion: 'To Verify',
      productEquivalent: 'To Verify',
      activeContent: 'To Verify',
      pricingEvidence: 'Missing',
      certifications: 'To Verify',
      distributionPresence: 'To Verify',
      marketShare: '',
      evidenceStatus: 'Verified',
      source: null,
      notes: 'No source yet.',
    })
    const wrapper = mount(CompetitorIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const stageButton = wrapper.findAll('button').find(button => button.text().includes('Stage for review'))

    await stageButton!.trigger('click')

    const finding = intelligence.state.value.researchFindings[0]
    expect(finding.keyClaim).toBe('Competitor evidence: Unsourced competitor')
    expect(finding.evidenceStatus).toBe('To Verify')
    expect(finding.source).toBeNull()
    expect(finding.suggestedInvestorMaterial).toBe('')
  })

  it('removes a competitor record without silently removing staged review findings', async () => {
    const intelligence = useFeasibilityIntelligence()
    const competitor = intelligence.addCompetitor({
      companyName: 'Removable competitor',
      countryRegion: 'China',
      productEquivalent: 'CWMS equivalent',
      activeContent: 'To Verify',
      pricingEvidence: 'Distributor note',
      certifications: 'To Verify',
      distributionPresence: 'To Verify',
      marketShare: '',
      evidenceStatus: 'User Approved',
      source: { title: 'User interview note', date: '2026-05-30' },
      notes: 'Keep review trail after deleting source record.',
    })
    intelligence.addResearchFinding({
      summary: 'Competitor evidence was staged before source record cleanup.',
      keyClaim: `Competitor evidence: ${competitor.companyName}`,
      area: 'market',
      evidenceStatus: competitor.evidenceStatus,
      confidence: 'medium',
      source: competitor.source,
    })
    const wrapper = mount(CompetitorIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const removeButton = wrapper.findAll('button').find(button => button.text() === 'Remove')

    expect(removeButton).toBeTruthy()
    await removeButton!.trigger('click')

    expect(intelligence.state.value.competitors).toHaveLength(0)
    expect(intelligence.state.value.researchFindings).toHaveLength(1)
    expect(intelligence.state.value.researchFindings[0].keyClaim).toBe('Competitor evidence: Removable competitor')
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

  it('saves a staged research finding as a labeled Memory note without changing readiness', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: 'Market evidence needs distributor source review before investor use.',
      keyClaim: 'CWAS distributor evidence note',
      area: 'market',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: null,
      suggestedTask: 'Collect distributor source for CWAS evidence',
      riskNote: 'Do not use in investor material until sourced.',
    })
    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save research note')

    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')

    expect(fetchMemoryMock).toHaveBeenCalled()
    expect(saveMemoryMock).toHaveBeenCalledWith(
      'memory',
      expect.stringContaining('## Research Review Note - CWAS distributor evidence note'),
    )
    expect(saveMemoryMock.mock.calls[0][1]).toContain('Existing memory')
    expect(saveMemoryMock.mock.calls[0][1]).toContain('Evidence status: To Verify')
    expect(saveMemoryMock.mock.calls[0][1]).toContain('Source evidence: Source missing')
    expect(saveMemoryMock.mock.calls[0][1]).toContain('Do not treat it as verified fact')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'market')?.evidenceStatus).toBe('To Verify')
    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
  })

  it('prefills a To Verify finding draft from a research job without approving it', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      context: 'Chemicon China Feasibility',
      status: 'Task Created',
    })

    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const draftButton = wrapper.findAll('button').find(button => button.text().includes('Use as finding draft'))
    expect(draftButton).toBeTruthy()

    await draftButton!.trigger('click')
    const textareas = wrapper.findAll('textarea')
    const inputs = wrapper.findAll('input')
    const selects = wrapper.findAll('select')

    expect((textareas[0].element as HTMLTextAreaElement).value).toContain('Research job request: Verify DMS regulatory status')
    expect((inputs[0].element as HTMLInputElement).value).toBe('DMS regulation in China')
    expect((selects[0].element as HTMLSelectElement).value).toBe('regulatory')
    expect((selects[1].element as HTMLSelectElement).value).toBe('To Verify')
    expect(intelligence.state.value.researchFindings).toHaveLength(0)
  })

  it('creates a Kanban task from a deferred research job and marks it task-created', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      context: 'Chemicon China Feasibility',
      status: 'Later',
    })

    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const createButton = wrapper.findAll('button').find(button => button.text().includes('Create research task'))

    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Research: DMS regulation in China',
      tenant: 'Chemicon China Feasibility',
    }))
    expect(createTaskMock.mock.calls[0][0].body).toContain('Source requirements')
    expect(intelligence.state.value.researchJobs[0].status).toBe('Task Created')
  })

  it('renders approved investor material and creates missing-proof tasks from presentation builder', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addPresentationMaterial({
      section: 'Executive Summary',
      content: 'Approved feasibility summary for investor draft.',
      evidenceStatus: 'User Approved',
    })

    const wrapper = mount(InvestorPresentationBuilderView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Draft From Approved Material Only')
    expect(wrapper.text()).toContain('Approved feasibility summary for investor draft')
    expect(wrapper.text()).toContain('Missing / To Verify')

    const taskButton = wrapper.findAll('button').find(button => button.text().includes('Create task for missing proof') && !button.attributes('disabled'))
    expect(taskButton).toBeTruthy()
    await taskButton!.trigger('click')

    expect(createTaskMock).toHaveBeenCalled()
  })

  it('shows source trace for investor-ready material in the presentation builder', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Source-backed distributor note for investor draft.',
      evidenceStatus: 'Verified',
      source: { title: 'Distributor interview', date: '2026-05-30' },
    })

    const wrapper = mount(InvestorPresentationBuilderView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Source-backed distributor note for investor draft')
    expect(wrapper.text()).toContain('Evidence: Verified / Distributor interview (2026-05-30)')
  })

  it('keeps unsupported material visible for follow-up but excluded from investor slides', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Unsupported verified market claim.',
      evidenceStatus: 'Verified',
      source: null,
    })

    const wrapper = mount(InvestorPresentationBuilderView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Needs Evidence Before Investor Use')
    expect(wrapper.text()).toContain('Unsupported verified market claim')
    expect(wrapper.text()).toContain('Source missing')
    expect(wrapper.text()).toContain('Marked To Verify')
    expect(wrapper.text()).toContain('Missing / To Verify')
  })

  it('creates a Kanban evidence task from unsupported investor material without approving it', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Unsupported market evidence captured from a session.',
      evidenceStatus: 'Verified',
      source: null,
    })

    const wrapper = mount(InvestorPresentationBuilderView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const taskButton = wrapper.findAll('button').find(button => button.text() === 'Create evidence task')

    expect(taskButton).toBeTruthy()
    await taskButton!.trigger('click')

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Verify investor material: Market Evidence',
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    }))
    expect(createTaskMock.mock.calls[0][0].body).toContain('Unsupported market evidence captured from a session')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Do not mark this investor-ready')
    expect(buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)).toHaveLength(0)
  })

  it('lets the presentation builder edit weak material into source-backed investor material', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Distributor pricing note awaiting source.',
      evidenceStatus: 'To Verify',
      source: null,
    })
    const wrapper = mount(InvestorPresentationBuilderView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const editButton = wrapper.findAll('button').find(button => button.text() === 'Edit evidence')

    expect(editButton).toBeTruthy()
    await editButton!.trigger('click')
    const editForm = wrapper.find('.managed-edit')
    const selects = editForm.findAll('select')
    const inputs = editForm.findAll('input')
    await selects[1].setValue('Verified')
    await inputs[0].setValue('Distributor interview')
    await inputs[2].setValue('2026-05-30')
    await editForm.find('textarea').setValue('Source-backed distributor pricing note.')
    const saveButton = editForm.findAll('button').find(button => button.text() === 'Save material')
    await saveButton!.trigger('click')

    const material = intelligence.state.value.presentationMaterials[0]
    expect(material.evidenceStatus).toBe('Verified')
    expect(material.source?.title).toBe('Distributor interview')
    expect(wrapper.text()).toContain('Evidence: Verified / Distributor interview (2026-05-30)')
    expect(wrapper.text()).not.toContain('Needs Evidence Before Investor Use')
  })

  it('removes staged investor material from the presentation builder without deleting findings', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addPresentationMaterial({
      section: 'Executive Summary',
      content: 'Draft material to remove.',
      evidenceStatus: 'User Approved',
    })
    intelligence.addResearchFinding({
      summary: 'Keep research finding after deck material is removed.',
      keyClaim: 'Executive summary note',
      area: 'presentation',
      evidenceStatus: 'User Approved',
      confidence: 'medium',
    })
    const wrapper = mount(InvestorPresentationBuilderView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const removeButton = wrapper.findAll('button').find(button => button.text() === 'Remove')

    expect(removeButton).toBeTruthy()
    await removeButton!.trigger('click')

    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
    expect(intelligence.state.value.researchFindings).toHaveLength(1)
  })

  it('shows real feasibility intelligence triage on Home without fake business metrics', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: 'DMS source review is waiting for approval.',
      keyClaim: 'DMS regulation source review',
      area: 'regulatory',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: null,
    })
    intelligence.addResearchJob({
      title: 'CWAS competitor price proof',
      question: 'Find source-backed price evidence only.',
      context: 'Chemicon China Feasibility',
      status: 'Manual Research Job',
    })
    intelligence.saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Derived from Assumptions',
      npv: 100,
      irr: 0.12,
      mirr: 0.1,
      paybackYear: 4,
      breakEvenVolumeTon: 1200,
      capexTotal: 1000,
      yearOneRevenue: 500,
      warnings: ['Pricing input is still To Verify.'],
    })
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Unsupported market evidence needs source.',
      evidenceStatus: 'Verified',
      source: null,
    })

    const wrapper = mount(DashboardView, {
      global: { stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Evidence Gaps')
    expect(wrapper.text()).toContain('Research Review Queue')
    expect(wrapper.text()).toContain('Financial & Deck Status')
    expect(wrapper.text()).toContain('Regulatory evidence')
    expect(wrapper.text()).toContain('DMS regulation source review')
    expect(wrapper.text()).toContain('CWAS competitor price proof')
    expect(wrapper.text()).toContain('Base')
    expect(wrapper.text()).toContain('Derived from Assumptions')
    expect(wrapper.text()).toContain('Market Evidence')
    expect(wrapper.text()).toContain('Unsupported market evidence needs source')
    expect(wrapper.text()).not.toContain('market share is')
    expect(wrapper.text()).not.toContain('CAGR')
  })
})
