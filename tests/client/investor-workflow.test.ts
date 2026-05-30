// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateInvestmentScenario,
  createEmptyInvestmentScenario,
  hasUsableInvestmentOutputs,
  irr,
  listInvestmentEvidenceGaps,
  npv,
  summarizeInvestmentEvidence,
  type EvidenceStatus,
} from '@/utils/investmentCalculator'
import {
  buildInvestorPresentationDraft,
  buildInvestorNextActions,
  buildInvestorSlideOutline,
  calculateInvestorReadinessScore,
  canMarkMarketClaimVerified,
  formatMarketShare,
  formatSourcedMarketShare,
  formatInvestorPresentationOutline,
  presentationSectionForEvidence,
} from '@/utils/investorIntelligence'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { recordSessionCaptureActivity } from '@/composables/useSessionCapture'
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
  dataRoomSourceForm: {
    checklistLabel: string
    evidenceStatus: IntelligenceEvidenceStatus
    sourceTitle: string
    sourceUrl: string
    sourceDate: string
    notes: string
  }
  saveEvidenceStatus: () => void
  saveDataRoomSource: () => void
  saveDataRoomIndexFile: () => Promise<void>
}

const createTaskMock = vi.hoisted(() => vi.fn())
const fetchMemoryMock = vi.hoisted(() => vi.fn())
const saveMemoryMock = vi.hoisted(() => vi.fn())
const checkConnectionMock = vi.hoisted(() => vi.fn())
const loadModelsMock = vi.hoisted(() => vi.fn())
const fetchSessionsMock = vi.hoisted(() => vi.fn())
const listJobsMock = vi.hoisted(() => vi.fn())
const createJobMock = vi.hoisted(() => vi.fn())
const listCronRunsMock = vi.hoisted(() => vi.fn())
const readCronRunMock = vi.hoisted(() => vi.fn())
const fetchPerformanceRuntimeMock = vi.hoisted(() => vi.fn())
const mkDirMock = vi.hoisted(() => vi.fn())
const writeFileMock = vi.hoisted(() => vi.fn())

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

vi.mock('@/stores/hermes/jobs', () => ({
  useJobsStore: () => ({
    createJob: createJobMock,
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
  createJob: createJobMock,
}))

vi.mock('@/api/hermes/cron-history', () => ({
  listCronRuns: listCronRunsMock,
  readCronRun: readCronRunMock,
}))

vi.mock('@/api/hermes/performance-monitor', () => ({
  fetchPerformanceRuntime: fetchPerformanceRuntimeMock,
}))

vi.mock('@/api/hermes/files', () => ({
  mkDir: mkDirMock,
  writeFile: writeFileMock,
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
import FeasibilityStudioView from '@/views/hermes/FeasibilityStudioView.vue'
import InvestmentCalculatorView from '@/views/hermes/InvestmentCalculatorView.vue'
import ResearchLibraryView from '@/views/hermes/ResearchLibraryView.vue'
import ReportsHubView from '@/views/hermes/ReportsHubView.vue'

function markScenarioEvidenceStatus(scenario: ReturnType<typeof createEmptyInvestmentScenario>, evidenceStatus: EvidenceStatus) {
  scenario.setupMonths.evidenceStatus = evidenceStatus
  scenario.discountRate.evidenceStatus = evidenceStatus
  scenario.taxRate.evidenceStatus = evidenceStatus
  scenario.salvageValue.evidenceStatus = evidenceStatus
  scenario.products.forEach(product => {
    product.evidenceStatus = evidenceStatus
  })
  Object.values(scenario.variableCostPerTon).forEach(item => {
    item.evidenceStatus = evidenceStatus
  })
  Object.values(scenario.annualFixedCosts).forEach(item => {
    item.evidenceStatus = evidenceStatus
  })
  Object.values(scenario.capex).forEach(item => {
    item.evidenceStatus = evidenceStatus
  })
  Object.values(scenario.workingCapital).forEach(item => {
    item.evidenceStatus = evidenceStatus
  })
  Object.values(scenario.funding).forEach(item => {
    item.evidenceStatus = evidenceStatus
  })
}

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
  createJobMock.mockReset().mockResolvedValue({
    job_id: 'job-scheduled-1',
    id: 'job-scheduled-1',
    name: 'Research: DMS regulation in China',
  })
  listCronRunsMock.mockReset().mockResolvedValue([])
  readCronRunMock.mockReset().mockResolvedValue({
    jobId: 'job-1',
    fileName: '2026-05-30T22-00-00.md',
    runTime: '2026-05-30 22:00:00',
    content: 'Research output pending.',
  })
  fetchPerformanceRuntimeMock.mockReset().mockResolvedValue({
    sessions: { active: 0, running: 0 },
    bridge: { reachable: true, workers: [] },
  })
  mkDirMock.mockReset().mockResolvedValue(undefined)
  writeFileMock.mockReset().mockResolvedValue(undefined)
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

  it('lists targeted financial evidence gaps for weak model inputs', () => {
    const scenario = createEmptyInvestmentScenario()
    scenario.products[0].name = 'CWAS / CWMS product mix'
    scenario.products[0].evidenceStatus = 'User Provided'
    scenario.capex.machinery.evidenceStatus = 'Verified'
    scenario.variableCostPerTon.rawMaterials.evidenceStatus = 'To Verify'
    scenario.discountRate.evidenceStatus = 'Assumption'

    const gaps = listInvestmentEvidenceGaps(scenario)

    expect(gaps.some(gap => gap.label === 'Raw material cost / ton' && gap.priority === 3)).toBe(true)
    expect(gaps.some(gap => gap.label === 'Discount rate' && gap.priority === 2)).toBe(true)
    expect(gaps.some(gap => gap.label === 'Machinery')).toBe(false)
    expect(gaps.some(gap => gap.label.includes('CWAS / CWMS product mix'))).toBe(false)
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

  it('does not display competitor market share as fact without source-backed evidence', () => {
    expect(formatSourcedMarketShare('12%', null, 'Verified')).toBe('To Verify')
    expect(formatSourcedMarketShare('12%', { title: 'Distributor quote' }, 'Verified')).toBe('To Verify')
    expect(formatSourcedMarketShare('12%', { title: 'Industry report', date: '2026-05-30' }, 'To Verify')).toBe('To Verify')
    expect(formatSourcedMarketShare('12%', { title: 'Industry report', date: '2026-05-30' }, 'Verified')).toBe('12%')
    expect(formatSourcedMarketShare('12%', null, 'Assumption')).toBe('Assumption: 12%')
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

  it('turns user-provided reviewed findings into user-approved investor draft material', () => {
    const intelligence = useFeasibilityIntelligence()
    const saved = intelligence.addResearchFinding({
      summary: 'User supplied a data-room source note for product evidence.',
      keyClaim: 'Product source packet',
      area: 'product',
      evidenceStatus: 'User Provided',
      confidence: 'medium',
      source: { title: 'User supplied source packet', date: '2026-05-30' },
      suggestedInvestorMaterial: 'User supplied product evidence packet is available for review in the data room.',
    })

    intelligence.approveResearchFinding(saved.id, {
      addToPresentation: true,
      updateReadiness: true,
    })

    const material = intelligence.state.value.presentationMaterials[0]
    expect(material.evidenceStatus).toBe('User Approved')
    expect(buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)).toHaveLength(1)
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'product')?.evidenceStatus).toBe('User Provided')
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

  it('turns user-provided readiness evidence into explicitly user-approved investor material', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.updateEvidenceStatus('product', 'User Provided', {
      title: 'User supplied CWAS SDS packet',
      date: '2026-05-30',
    })
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const addButtons = wrapper.findAll('button').filter(button => button.text() === 'Add to investor draft')

    await addButtons[1].trigger('click')

    const material = intelligence.state.value.presentationMaterials[0]
    expect(material.section).toBe('Product Plan')
    expect(material.evidenceStatus).toBe('User Approved')
    expect(buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)).toHaveLength(1)
    expect(buildInvestorSlideOutline(['Product Plan'], intelligence.state.value.presentationMaterials)[0].status).toBe('Ready')
  })

  it('does not stage To Verify readiness evidence into investor material', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const addButton = wrapper.findAll('button').find(button => button.text() === 'Add to investor draft')

    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
    expect(buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)).toHaveLength(0)
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

  it('records scheduled Hermes job details for deferred research jobs', () => {
    const intelligence = useFeasibilityIntelligence()
    const saved = intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      context: 'Chemicon China Feasibility',
      status: 'Later',
    })

    const updated = intelligence.updateResearchJobSchedule(saved.id, {
      scheduledJobId: 'job-1',
      schedule: '2026-05-30T22:00:00',
    })

    expect(updated?.status).toBe('Scheduled Hermes Job')
    expect(updated?.scheduledJobId).toBe('job-1')
    expect(intelligence.state.value.researchJobs[0].schedule).toBe('2026-05-30T22:00:00')
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
    markScenarioEvidenceStatus(base, 'Assumption')
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

    expect(wrapper.text()).toContain('assumption-only outputs stay labeled as derived from assumptions')
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    expect(intelligence.state.value.presentationMaterials[0].section).toBe('IRR / Investor Return')
    expect(intelligence.state.value.presentationMaterials[0].evidenceStatus).toBe('Derived from Assumptions')
    expect(intelligence.state.value.presentationMaterials[0].content).toContain('All outputs are derived from assumptions')
    const draft = buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)
    expect(draft.length).toBeGreaterThan(0)
    expect(draft.every(item => item.evidenceStatus === 'Derived from Assumptions')).toBe(true)
  })

  it('keeps To Verify financial outputs excluded from investor slides even when calculable', async () => {
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
    const addButton = wrapper.findAll('button').find(button => button.text() === 'Stage To Verify finance draft')

    expect(wrapper.text()).toContain('To Verify outputs stay excluded from investor slides')
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    expect(intelligence.state.value.presentationMaterials[0].section).toBe('IRR / Investor Return')
    expect(intelligence.state.value.presentationMaterials[0].evidenceStatus).toBe('To Verify')
    expect(intelligence.state.value.presentationMaterials[0].content).toContain('Some outputs depend on To Verify inputs')
    expect(buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)).toHaveLength(0)
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'presentation')?.evidenceStatus).toBe('Missing')
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

  it('registers calculable To Verify financial models as data-room evidence without investor approval', async () => {
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
    const registerButton = wrapper.findAll('button').find(button => button.text() === 'Register in data room')

    expect(registerButton).toBeTruthy()
    await registerButton!.trigger('click')

    const source = intelligence.state.value.dataRoomSources[0]
    expect(source.checklistLabel).toBe('Financial model with evidence status per input')
    expect(source.area).toBe('financial')
    expect(source.evidenceStatus).toBe('To Verify')
    expect(source.source?.title).toBe('IRR calculator Base scenario')
    expect(source.notes).toContain('Weak inputs:')
    expect(source.notes).toContain('IRR:')
    expect(source.notes).toContain('not verified investor claims')
    expect(intelligence.latestFinancialModel.value?.scenarioName).toBe('Base')
    expect(intelligence.latestFinancialModel.value?.evidenceStatus).toBe('To Verify')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'financial')?.evidenceStatus).toBe('To Verify')
    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
  })

  it('registers assumption-derived financial models with explicit assumption labels', async () => {
    const intelligence = useFeasibilityIntelligence()
    const base = createEmptyInvestmentScenario('Chemicon China Feasibility - Base')
    markScenarioEvidenceStatus(base, 'Assumption')
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
    const registerButton = wrapper.findAll('button').find(button => button.text() === 'Register in data room')

    expect(registerButton).toBeTruthy()
    await registerButton!.trigger('click')

    const source = intelligence.state.value.dataRoomSources[0]
    expect(source.evidenceStatus).toBe('Derived from Assumptions')
    expect(source.notes).toContain('Assumption inputs:')
    expect(source.notes).toContain('Registered from IRR / Investment Calculator')
    expect(intelligence.latestFinancialModel.value?.evidenceStatus).toBe('Derived from Assumptions')
    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
  })

  it('saves calculable financial model assumptions to Documents with evidence guardrails', async () => {
    const intelligence = useFeasibilityIntelligence()
    const base = createEmptyInvestmentScenario('Chemicon China Feasibility - Base')
    markScenarioEvidenceStatus(base, 'Assumption')
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
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save model file')

    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(mkDirMock).toHaveBeenCalledWith('financial-models')
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [path, content] = writeFileMock.mock.calls[0]
    expect(path).toMatch(/^financial-models\/chemicon-china-feasibility-base-base-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/)
    expect(content).toContain('# Financial Model Record - Chemicon China Feasibility - Base')
    expect(content).toContain('Evidence status: Derived from Assumptions')
    expect(content).toContain('Raw material cost / ton: 20')
    expect(content).toContain('Yearly Revenue / Cash Flow')
    expect(content).toContain('Investor IRR')
    expect(content).toContain('Do not treat IRR, NPV, investor return, payback, revenue, cost, or market-linked assumptions as verified investor claims')
    expect(wrapper.text()).toContain(path)
    expect(intelligence.latestFinancialModel.value?.scenarioName).toBe('Base')
    expect(intelligence.latestFinancialModel.value?.evidenceStatus).toBe('Derived from Assumptions')
  })

  it('creates targeted Kanban tasks from financial input evidence gaps', async () => {
    const base = createEmptyInvestmentScenario('Chemicon China Feasibility - Base')
    base.products[0].name = 'CWAS / CWMS product mix'
    base.variableCostPerTon.rawMaterials.evidenceStatus = 'To Verify'
    window.localStorage.setItem('hermes.investmentCalculator.scenarios.v1', JSON.stringify({
      Lean: createEmptyInvestmentScenario('Chemicon China Feasibility - Lean'),
      Base: base,
      Conservative: createEmptyInvestmentScenario('Chemicon China Feasibility - Conservative'),
      Aggressive: createEmptyInvestmentScenario('Chemicon China Feasibility - Aggressive'),
    }))
    const wrapper = mount(InvestmentCalculatorView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Financial Input Evidence Checklist')
    expect(wrapper.text()).toContain('Raw material cost / ton')
    const taskButton = wrapper.findAll('button').find(button => button.text() === 'Create input task')

    expect(taskButton).toBeTruthy()
    await taskButton!.trigger('click')
    await flushPromises()

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Verify financial input: Setup months',
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    }))
    expect(createTaskMock.mock.calls[0][0].body).toContain('Source page: IRR / Investment Calculator / Financial Input Evidence')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Do not use this input as investor-ready')
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

  it('saves data-room sources against checklist items and updates readiness explicitly', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const vm = wrapper.vm as unknown as InvestorReadinessTestVm

    vm.dataRoomSourceForm.checklistLabel = 'Product TDS/SDS and CAS evidence'
    vm.dataRoomSourceForm.evidenceStatus = 'Verified'
    vm.dataRoomSourceForm.sourceTitle = 'CWAS SDS source'
    vm.dataRoomSourceForm.sourceDate = '2026-05-30'
    vm.dataRoomSourceForm.notes = 'SDS source reviewed for investor data room.'
    vm.saveDataRoomSource()
    await wrapper.vm.$nextTick()

    const product = intelligence.state.value.evidenceItems.find(item => item.id === 'product')
    expect(product?.evidenceStatus).toBe('Verified')
    expect(product?.source?.title).toBe('CWAS SDS source')
    expect(intelligence.state.value.dataRoomSources).toHaveLength(1)
    expect(intelligence.state.value.dataRoomSources[0].checklistLabel).toBe('Product TDS/SDS and CAS evidence')
    expect(wrapper.text()).toContain('Source register')
    expect(wrapper.text()).toContain('SDS source reviewed for investor data room.')
  })

  it('downgrades readiness when the backing data-room source is removed', () => {
    const intelligence = useFeasibilityIntelligence()
    const saved = intelligence.addDataRoomSource({
      checklistLabel: 'Product TDS/SDS and CAS evidence',
      area: 'product',
      evidenceStatus: 'Verified',
      source: { title: 'CWAS SDS source', date: '2026-05-30' },
      notes: 'SDS source reviewed for investor data room.',
    })

    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'product')).toMatchObject({
      evidenceStatus: 'Verified',
      sourceRecordId: saved.id,
    })

    expect(intelligence.removeDataRoomSource(saved.id)).toBe(true)

    expect(intelligence.state.value.dataRoomSources).toHaveLength(0)
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'product')).toMatchObject({
      evidenceStatus: 'To Verify',
      source: null,
      sourceRecordId: null,
    })
  })

  it('falls back to the next available data-room source when the latest one is removed', () => {
    const intelligence = useFeasibilityIntelligence()
    const fallback = intelligence.addDataRoomSource({
      checklistLabel: 'Product TDS/SDS and CAS evidence',
      area: 'product',
      evidenceStatus: 'User Provided',
      source: { title: 'CWAS TDS user upload', date: '2026-05-29' },
      notes: 'User-uploaded product document awaiting source review.',
    })
    const latest = intelligence.addDataRoomSource({
      checklistLabel: 'Product TDS/SDS and CAS evidence',
      area: 'product',
      evidenceStatus: 'Verified',
      source: { title: 'CWAS SDS source', date: '2026-05-30' },
      notes: 'SDS source reviewed for investor data room.',
    })

    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'product')).toMatchObject({
      evidenceStatus: 'Verified',
      sourceRecordId: latest.id,
    })

    expect(intelligence.removeDataRoomSource(latest.id)).toBe(true)

    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'product')).toMatchObject({
      evidenceStatus: 'User Provided',
      sourceRecordId: fallback.id,
      source: { title: 'CWAS TDS user upload', date: '2026-05-29' },
    })
  })

  it('saves a labeled data-room index file without approving missing evidence', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addDataRoomSource({
      checklistLabel: 'Product TDS/SDS and CAS evidence',
      area: 'product',
      evidenceStatus: 'Verified',
      source: { title: 'CWAS SDS source', date: '2026-05-30' },
      notes: 'SDS source reviewed for investor data room.',
    })
    const beforeScore = intelligence.readinessScore.value
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const vm = wrapper.vm as unknown as InvestorReadinessTestVm

    await vm.saveDataRoomIndexFile()
    await flushPromises()

    expect(mkDirMock).toHaveBeenCalledWith('data-room-indexes')
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [path, content] = writeFileMock.mock.calls[0]
    expect(path).toMatch(/^data-room-indexes\/chemicon-data-room-index-/)
    expect(content).toContain('# Chemicon China Investor Data-Room Index')
    expect(content).toContain('This file is an index only. It does not verify any business claim by itself.')
    expect(content).toContain('Missing / To Verify items must not be used as investor claims.')
    expect(content).toContain('## Product TDS/SDS and CAS evidence')
    expect(content).toContain('Evidence status: Verified')
    expect(content).toContain('Source trace: CWAS SDS source / 2026-05-30')
    expect(content).toContain('## Factory/rent/permit evidence')
    expect(content).toContain('Evidence status: Missing')
    expect(content).toContain('Use rule: Keep this item out of investor claims')
    expect(content).toContain('# Source Register')
    expect(content).toContain('SDS source reviewed for investor data room.')
    expect(wrapper.text()).toContain(path)
    expect(intelligence.readinessScore.value).toBe(beforeScore)
    expect(intelligence.state.value.dataRoomSources).toHaveLength(1)
  })

  it('shows a central assumption register and creates verification tasks', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.updateEvidenceStatus('financial', 'Assumption')
    intelligence.addMarketClaim({
      label: 'Year 1 volume planning assumption',
      value: '15,000 MT/year planning case',
      evidenceStatus: 'Assumption',
      confidence: 'medium',
      source: null,
    })
    intelligence.addPresentationMaterial({
      section: 'IRR / Investor Return',
      content: 'Draft financial returns are derived from assumption-labeled model inputs.',
      evidenceStatus: 'Derived from Assumptions',
      source: null,
    })
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Assumption register')
    expect(wrapper.text()).toContain('Financial model completeness')
    expect(wrapper.text()).toContain('Year 1 volume planning assumption')
    expect(wrapper.text()).toContain('IRR / Investor Return')
    expect(wrapper.text()).toContain('Derived from Assumptions')

    const createButton = wrapper.findAll('button').find(button => button.text() === 'Create verification task')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Verify assumption: Financial model completeness',
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    }))
    const body = createTaskMock.mock.calls[0][0].body
    expect(body).toContain('Current evidence status: Assumption')
    expect(body).toContain('Source page: Investor Readiness Center / Assumption Register')
    expect(body).toContain('Do not convert this into a verified investor claim')
  })

  it('surfaces a live risk register and creates mitigation tasks without approving evidence', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: 'DMS regulatory status still needs source-backed review.',
      keyClaim: 'DMS regulatory status',
      area: 'regulatory',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: null,
      riskNote: 'Regulatory status must be confirmed before investor use.',
      status: 'Pending Review',
    })
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Unsupported market demand claim should stay out of investor materials.',
      evidenceStatus: 'To Verify',
      source: null,
    })
    const beforeScore = intelligence.readinessScore.value
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Risk register')
    expect(wrapper.text()).toContain('Investor Risks')
    expect(wrapper.text()).toContain('Factory evidence')
    expect(wrapper.text()).toContain('DMS regulatory status')
    expect(wrapper.text()).toContain('Unsupported')

    const createButton = wrapper.findAll('button').find(button => button.text() === 'Create mitigation task')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Mitigate risk:'),
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    }))
    const body = createTaskMock.mock.calls[0][0].body
    expect(body).toContain('Source page: Investor Readiness Center / Risk Register')
    expect(body).toContain('Do not hide this risk or use the related claim as investor-ready')
    expect(intelligence.readinessScore.value).toBe(beforeScore)
  })

  it('creates deeper research jobs from investor risks without approving the risk', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: 'DMS regulatory status still needs source-backed review.',
      keyClaim: 'DMS regulatory status',
      area: 'regulatory',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: null,
      riskNote: 'Regulatory status must be confirmed before investor use.',
      status: 'Pending Review',
    })
    const beforeScore = intelligence.readinessScore.value
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const riskPanel = wrapper.find('.risk-register')
    const researchButton = riskPanel.findAll('button').find(button => button.text() === 'Do deeper research')

    expect(researchButton).toBeTruthy()
    await researchButton!.trigger('click')

    const job = intelligence.state.value.researchJobs[0]
    expect(job.title).toBe('Risk research: Factory evidence')
    expect(job.status).toBe('Manual Research Job')
    expect(job.priority).toBe('high')
    expect(job.schedulePreference).toBe('Tonight')
    expect(job.context).toBe('Chemicon China Feasibility')
    expect(job.scope).toContain('Current evidence status: Missing')
    expect(job.scope).toContain('Do not invent market data')
    expect(job.sourceRequirements).toContain('Every claim needs source evidence or must remain To Verify')
    expect(intelligence.readinessScore.value).toBe(beforeScore)
  })

  it('stages saved data-room sources for research review without updating investor draft material', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addDataRoomSource({
      checklistLabel: 'Product TDS/SDS and CAS evidence',
      area: 'product',
      evidenceStatus: 'Verified',
      source: { title: 'CWAS SDS source', date: '2026-05-30' },
      notes: 'SDS source reviewed for investor data room.',
    })
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const stageButton = wrapper.findAll('button').find(button => button.text() === 'Stage for review')

    expect(stageButton).toBeTruthy()
    await stageButton!.trigger('click')

    const finding = intelligence.state.value.researchFindings[0]
    expect(finding.keyClaim).toBe('Data-room source: Product TDS/SDS and CAS evidence')
    expect(finding.evidenceStatus).toBe('Verified')
    expect(finding.source?.title).toBe('CWAS SDS source')
    expect(finding.suggestedInvestorMaterial).toContain('CWAS SDS source')
    expect(finding.summary).toContain('This source record must be reviewed')
    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
  })

  it('keeps verified data-room sources To Verify without usable source evidence', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const vm = wrapper.vm as unknown as InvestorReadinessTestVm

    vm.dataRoomSourceForm.checklistLabel = 'Factory/rent/permit evidence'
    vm.dataRoomSourceForm.evidenceStatus = 'Verified'
    vm.dataRoomSourceForm.sourceTitle = 'Factory permit note without date'
    vm.saveDataRoomSource()
    await wrapper.vm.$nextTick()

    const factory = intelligence.state.value.evidenceItems.find(item => item.id === 'factory')
    expect(factory?.evidenceStatus).toBe('To Verify')
    expect(intelligence.state.value.dataRoomSources[0].evidenceStatus).toBe('To Verify')
    expect(wrapper.text()).toContain('Factory permit note without date')
  })

  it('stages unsourced data-room sources as To Verify without investor material candidates', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addDataRoomSource({
      checklistLabel: 'Factory/rent/permit evidence',
      area: 'factory',
      evidenceStatus: 'Verified',
      source: { title: 'Factory permit note without date' },
      notes: 'Needs source date or URL before investor use.',
    })
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const stageButton = wrapper.findAll('button').find(button => button.text() === 'Stage for review')

    expect(stageButton).toBeTruthy()
    await stageButton!.trigger('click')

    const finding = intelligence.state.value.researchFindings[0]
    expect(finding.keyClaim).toBe('Data-room source: Factory/rent/permit evidence')
    expect(finding.evidenceStatus).toBe('To Verify')
    expect(finding.suggestedInvestorMaterial).toBe('')
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

  it('creates Kanban tasks from investor data-room checklist gaps', async () => {
    const wrapper = mount(InvestorReadinessView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const taskButton = wrapper.findAll('button').find(button => button.text() === 'Create task')

    expect(taskButton).toBeTruthy()
    await taskButton!.trigger('click')

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Data room evidence: Company registration and business scope',
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    }))
    expect(createTaskMock.mock.calls[0][0].body).toContain('Investor data-room evidence item: Company registration and business scope')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Source page: Investor Readiness Center / Data Room Checklist')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Do not mark this investor-ready')
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

  it('creates a Kanban evidence task from a weak market claim without approving it', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'CWAS China price proof',
      value: 'Distributor price mentioned in chat but no source attached',
      evidenceStatus: 'To Verify',
      source: null,
      confidence: 'medium',
    })
    const wrapper = mount(MarketIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const taskButton = wrapper.findAll('button').find(button => button.text() === 'Create evidence task')

    expect(taskButton).toBeTruthy()
    await taskButton!.trigger('click')
    await flushPromises()

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Market evidence: CWAS China price proof',
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    }))
    expect(createTaskMock.mock.calls[0][0].body).toContain('Market claim evidence gap: CWAS China price proof')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Evidence status: To Verify')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Source trace: Source missing')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Do not use market size, CAGR, demand, pricing, country ranking, or customer claims')
    expect(intelligence.state.value.researchFindings).toHaveLength(0)
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'market')?.evidenceStatus).toBe('To Verify')
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

  it('hides unsourced competitor market share values behind To Verify in the workspace UI', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addCompetitor({
      companyName: 'Unsourced share competitor',
      countryRegion: 'China',
      productEquivalent: 'CWAS equivalent',
      activeContent: '90% active content',
      pricingEvidence: 'Claimed quote without source',
      certifications: 'To Verify',
      distributionPresence: 'To Verify',
      marketShare: '12%',
      evidenceStatus: 'Verified',
      source: null,
      notes: 'Market share claim has no usable source.',
    })

    const wrapper = mount(CompetitorIntelligenceView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Unsourced share competitor')
    expect(wrapper.text()).toContain('To Verify')
    expect(wrapper.text()).not.toContain('12%')
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
      scope: 'Regulatory classification, permits, SDS, storage, transport, and evidence gaps.',
      expectedOutput: 'Source-backed research note with citations and follow-up tasks.',
      sourceRequirements: 'Include source title plus URL or date for every claim.',
      priority: 'high',
      schedulePreference: 'Tonight',
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

  it('surfaces real research intelligence records in Research Library', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      scope: 'Regulatory classification, permits, SDS, storage, transport, and evidence gaps.',
      expectedOutput: 'Source-backed research note with citations and follow-up tasks.',
      sourceRequirements: 'Include source title plus URL or date for every claim.',
      priority: 'high',
      schedulePreference: 'Tonight',
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
    intelligence.addMarketClaim({
      label: 'CWAS price validation evidence',
      value: 'Distributor interview supports a pricing note.',
      evidenceStatus: 'Verified',
      confidence: 'medium',
      source: { title: 'Distributor interview', date: '2026-05-30' },
    })
    intelligence.addCompetitor({
      companyName: 'Example Softener Co',
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

    const wrapper = mount(ResearchLibraryView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Live research hub')
    expect(wrapper.text()).toContain('Research Waiting for Approval')
    expect(wrapper.text()).toContain('DMS regulation source needed')
    expect(wrapper.text()).toContain('DMS regulation in China')
    expect(wrapper.text()).toContain('CWAS price validation evidence')
    expect(wrapper.text()).toContain('Example Softener Co')
    expect(wrapper.text()).toContain('market share: To Verify')
    expect(wrapper.text()).toContain('Distributor interview')
  })

  it('surfaces approved report material and financial snapshots in Reports Hub', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Approved distributor interview narrative for investor output.',
      evidenceStatus: 'User Approved',
      source: { title: 'Distributor interview', date: '2026-05-30' },
    })
    intelligence.addPresentationMaterial({
      section: 'Competitor Landscape',
      content: 'Unsupported competitor claim should remain follow-up only.',
      evidenceStatus: 'To Verify',
      source: null,
    })
    intelligence.saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Derived from Assumptions',
      npv: 1000000,
      irr: 0.24,
      mirr: 0.18,
      investorIrr: 0.21,
      investorMoic: 2.4,
      investorExitProceeds: 2400000,
      fundingGap: 250000,
      paybackYear: 3,
      breakEvenVolumeTon: 4500,
      capexTotal: 1500000,
      yearOneRevenue: 8000000,
      warnings: ['Pricing input is still To Verify.'],
      source: { title: 'IRR calculator Base scenario', date: '2026-05-30' },
    })
    intelligence.addResearchFinding({
      summary: 'DMS regulatory evidence needs source review.',
      keyClaim: 'DMS source needed',
      area: 'regulatory',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: null,
    })

    const wrapper = mount(ReportsHubView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Live output hub')
    expect(wrapper.text()).toContain('Approved distributor interview narrative')
    expect(wrapper.text()).toContain('Distributor interview')
    expect(wrapper.text()).toContain('Deck sections ready')
    expect(wrapper.text()).toContain('1/20')
    expect(wrapper.text()).toContain('Base')
    expect(wrapper.text()).toContain('Derived from Assumptions')
    expect(wrapper.text()).toContain('Pricing input is still To Verify.')
    expect(wrapper.text()).toContain('DMS source needed')
    expect(wrapper.text()).not.toContain('Unsupported competitor claim should remain follow-up only.')

    const taskButton = wrapper.findAll('button').find(button => button.text() === 'Create task')
    expect(taskButton).toBeTruthy()
    await taskButton!.trigger('click')
    await flushPromises()

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Report input evidence: DMS source needed',
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    }))
    expect(createTaskMock.mock.calls[0][0].body).toContain('Source page: Reports Hub / Before Investor Use')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Do not use this in investor material')
  })

  it('saves the approved investor draft as a Markdown file without unsupported claims', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Approved distributor interview narrative for investor output.',
      evidenceStatus: 'User Approved',
      source: { title: 'Distributor interview', date: '2026-05-30' },
    })
    intelligence.addPresentationMaterial({
      section: 'Competitor Landscape',
      content: 'Unsupported competitor claim should not be saved to the draft.',
      evidenceStatus: 'To Verify',
      source: null,
    })

    const wrapper = mount(ReportsHubView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save draft file')
    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(mkDirMock).toHaveBeenCalledWith('investor-drafts')
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [path, content] = writeFileMock.mock.calls[0]
    expect(path).toMatch(/^investor-drafts\/chemicon-investor-draft-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/)
    expect(content).toContain('Generated from approved material only')
    expect(content).toContain('Evidence rule: only verified, user-approved, approved-assumption, or derived-from-assumptions material is included.')
    expect(content).toContain('Source: Hermes Reports Hub')
    expect(content).toContain('Approved distributor interview narrative for investor output.')
    expect(content).toContain('Evidence status: User Approved')
    expect(content).not.toContain('Unsupported competitor claim should not be saved to the draft.')
    expect(wrapper.text()).toContain(path)

    const source = intelligence.state.value.dataRoomSources[0]
    expect(source.checklistLabel).toBe('Investor presentation draft file')
    expect(source.area).toBe('presentation')
    expect(source.evidenceStatus).toBe('User Approved')
    expect(source.source?.title).toBe(path)
    expect(source.notes).toContain('generated Markdown draft file, not final truth')
    expect(source.notes).toContain('Each section in the file keeps its own evidence status')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'presentation')?.evidenceStatus).toBe('User Approved')
  })

  it('saves a feasibility evidence brief without approving weak claims', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addPresentationMaterial({
      section: 'Market Evidence',
      content: 'Approved distributor interview narrative for the evidence brief.',
      evidenceStatus: 'User Approved',
      source: { title: 'Distributor interview', date: '2026-05-30' },
    })
    intelligence.addPresentationMaterial({
      section: 'Competitor Landscape',
      content: 'Unsupported investor text should not appear as approved material.',
      evidenceStatus: 'To Verify',
      source: null,
    })
    intelligence.addMarketClaim({
      label: 'CWAS price validation note',
      value: 'Distributor interview supports a pricing note.',
      evidenceStatus: 'Verified',
      confidence: 'medium',
      source: { title: 'Distributor interview', date: '2026-05-30' },
    })
    intelligence.addMarketClaim({
      label: 'Unsourced market size claim',
      value: 'Unsupported market-size text.',
      evidenceStatus: 'Verified',
      confidence: 'low',
      source: null,
    })
    intelligence.addCompetitor({
      companyName: 'Example Softener Co',
      countryRegion: 'China',
      productEquivalent: 'CWAS equivalent',
      activeContent: '90%',
      pricingEvidence: 'To Verify',
      certifications: 'To Verify',
      distributionPresence: 'To Verify',
      marketShare: '25%',
      evidenceStatus: 'Verified',
      source: null,
      notes: 'Market share must remain hidden until sourced.',
    })
    intelligence.saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Derived from Assumptions',
      npv: 1000000,
      irr: 0.24,
      mirr: 0.18,
      paybackYear: 3,
      breakEvenVolumeTon: 4500,
      capexTotal: 1500000,
      yearOneRevenue: 8000000,
      warnings: ['Pricing input is still To Verify.'],
      source: { title: 'IRR calculator Base scenario', date: '2026-05-30' },
    })
    intelligence.addDataRoomSource({
      checklistLabel: 'Product TDS/SDS and CAS evidence',
      area: 'product',
      evidenceStatus: 'Verified',
      source: { title: 'CWAS SDS source', date: '2026-05-30' },
      notes: 'SDS source reviewed for feasibility evidence.',
    })
    intelligence.addResearchFinding({
      summary: 'DMS regulatory evidence needs source review.',
      keyClaim: 'DMS source needed',
      area: 'regulatory',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: null,
      riskNote: 'Do not use DMS regulatory claims until sourced.',
    })
    const beforeScore = intelligence.readinessScore.value
    const beforeSourceCount = intelligence.state.value.dataRoomSources.length

    const wrapper = mount(ReportsHubView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save feasibility brief')

    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(mkDirMock).toHaveBeenCalledWith('feasibility-briefs')
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [path, content] = writeFileMock.mock.calls[0]
    expect(path).toMatch(/^feasibility-briefs\/chemicon-feasibility-evidence-brief-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/)
    expect(content).toContain('# Chemicon China Feasibility Evidence Brief')
    expect(content).toContain('This is a working evidence brief, not final truth and not an investor claim pack.')
    expect(content).toContain('Planning scope: Year 1 15,000 MT feasibility; 60,000 MT scale-up remains a scenario until validated.')
    expect(content).toContain('## Readiness Evidence Matrix')
    expect(content).toContain('## Latest Financial Snapshot')
    expect(content).toContain('NPV: $1,000,000')
    expect(content).toContain('IRR: 24.0%')
    expect(content).toContain('Pricing input is still To Verify.')
    expect(content).toContain('Approved distributor interview narrative for the evidence brief.')
    expect(content).toContain('Evidence status: User Approved')
    expect(content).toContain('CWAS price validation note')
    expect(content).toContain('Evidence status: Verified')
    expect(content).toContain('Unsourced market size claim')
    expect(content).toContain('Evidence status: To Verify')
    expect(content).toContain('Example Softener Co')
    expect(content).toContain('Market share: To Verify')
    expect(content).toContain('Product TDS/SDS and CAS evidence')
    expect(content).toContain('CWAS SDS source (2026-05-30)')
    expect(content).toContain('## Investor Risk Register')
    expect(content).toContain('Factory evidence')
    expect(content).toContain('DMS source needed')
    expect(content).toContain('Do not use DMS regulatory claims until sourced.')
    expect(content).toContain('Unknown competitor market share must remain To Verify.')
    expect(content).not.toContain('Unsupported investor text should not appear as approved material.')
    expect(wrapper.text()).toContain(path)
    expect(intelligence.readinessScore.value).toBe(beforeScore)
    expect(intelligence.state.value.dataRoomSources).toHaveLength(beforeSourceCount)
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

  it('saves reviewed market research as a structured Market Intelligence claim', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: 'Distributor interview supports CWAS price validation note.',
      keyClaim: 'CWAS price validation evidence',
      area: 'market',
      evidenceStatus: 'Verified',
      confidence: 'medium',
      source: { title: 'Distributor interview', date: '2026-05-30' },
      suggestedInvestorMaterial: 'Source-backed distributor note for market evidence.',
    })
    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save as market claim')

    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')

    const claim = intelligence.state.value.marketClaims[0]
    expect(claim.label).toBe('CWAS price validation evidence')
    expect(claim.value).toContain('Distributor interview supports')
    expect(claim.evidenceStatus).toBe('Verified')
    expect(claim.source?.title).toBe('Distributor interview')
  })

  it('keeps unsourced reviewed market research To Verify when saved as a market claim', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: 'A session mentioned competitor price evidence, but no source was attached.',
      keyClaim: 'Unsourced competitor price evidence',
      area: 'market',
      evidenceStatus: 'Verified',
      confidence: 'high',
      source: null,
    })
    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save as market claim')

    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')

    const claim = intelligence.state.value.marketClaims[0]
    expect(claim.label).toBe('Unsourced competitor price evidence')
    expect(claim.evidenceStatus).toBe('To Verify')
    expect(claim.source).toBeNull()
  })

  it('saves reviewed competitor research as a structured Competitor Intelligence record', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: [
        'Competitor: Example Softener Co',
        'Region: China',
        'Product equivalent: CWAS equivalent',
        'Active content: 90% active content',
        'Pricing evidence: Distributor quote note',
        'Certifications: To Verify',
        'Distribution presence: Distributor in China',
        'Market share: To Verify',
        'Notes: Pricing source needs investor review before use.',
      ].join('\n'),
      keyClaim: 'Competitor evidence: Example Softener Co',
      area: 'market',
      evidenceStatus: 'Verified',
      confidence: 'medium',
      source: { title: 'Distributor quote', date: '2026-05-30' },
    })
    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save as competitor record')

    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')

    const competitor = intelligence.state.value.competitors[0]
    expect(competitor.companyName).toBe('Example Softener Co')
    expect(competitor.productEquivalent).toBe('CWAS equivalent')
    expect(competitor.pricingEvidence).toBe('Distributor quote note')
    expect(competitor.evidenceStatus).toBe('Verified')
    expect(competitor.source?.title).toBe('Distributor quote')
    expect(formatMarketShare(competitor.marketShare)).toBe('To Verify')
  })

  it('keeps unsourced reviewed competitor research To Verify when saved as a competitor record', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: [
        'Competitor: Unsourced Competitor',
        'Region: To Verify',
        'Product equivalent: To Verify',
        'Active content: To Verify',
        'Pricing evidence: Missing',
        'Market share: 12%',
        'Notes: No usable source attached.',
      ].join('\n'),
      keyClaim: 'Competitor evidence: Unsourced Competitor',
      area: 'market',
      evidenceStatus: 'Verified',
      confidence: 'high',
      source: null,
    })
    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save as competitor record')

    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')

    const competitor = intelligence.state.value.competitors[0]
    expect(competitor.companyName).toBe('Unsourced Competitor')
    expect(competitor.marketShare).toBe('12%')
    expect(competitor.evidenceStatus).toBe('To Verify')
    expect(competitor.source).toBeNull()
  })

  it('saves source-backed reviewed research as data-room evidence and updates readiness', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: 'CWAS SDS source confirms product safety document is available for review.',
      keyClaim: 'CWAS SDS evidence',
      area: 'product',
      evidenceStatus: 'Verified',
      confidence: 'high',
      source: { title: 'CWAS SDS document', date: '2026-05-30' },
      status: 'Approved',
      riskNote: 'Review document quality before investor deck use.',
    })
    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save as data-room evidence')

    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')

    const source = intelligence.state.value.dataRoomSources[0]
    expect(source.checklistLabel).toBe('CWAS SDS evidence')
    expect(source.area).toBe('product')
    expect(source.evidenceStatus).toBe('Verified')
    expect(source.notes).toContain('CWAS SDS source confirms')
    expect(source.notes).toContain('Saved from Research Result Review')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'product')?.evidenceStatus).toBe('Verified')
  })

  it('keeps unsourced reviewed research To Verify when saved as data-room evidence', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: 'Factory chemical permission appears likely but no source is attached.',
      keyClaim: 'Factory chemical permission',
      area: 'factory',
      evidenceStatus: 'Verified',
      confidence: 'medium',
      source: null,
      status: 'Pending Review',
    })
    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save as data-room evidence')

    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')

    const source = intelligence.state.value.dataRoomSources[0]
    expect(source.checklistLabel).toBe('Factory chemical permission')
    expect(source.evidenceStatus).toBe('To Verify')
    expect(source.source).toBeNull()
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'factory')?.evidenceStatus).toBe('To Verify')
  })

  it('prevents rejected research findings from feeding downstream investor stores', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchFinding({
      summary: [
        'Competitor: Rejected Softener Co',
        'Region: China',
        'Product equivalent: Unsupported equivalent',
        'Pricing evidence: Unsupported note',
        'Market share: 12%',
      ].join('\n'),
      keyClaim: 'Competitor evidence: Rejected Softener Co',
      area: 'market',
      evidenceStatus: 'Verified',
      confidence: 'high',
      source: { title: 'Rejected source note', date: '2026-05-30' },
      suggestedTask: 'Do not create this task',
      suggestedInvestorMaterial: 'Rejected investor claim should not be staged.',
      status: 'Rejected',
    })
    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const buttonByText = (label: string) => wrapper.findAll('button').find(button => button.text() === label)

    for (const label of [
      'Approve selected updates',
      'Add to investor draft',
      'Create task',
      'Save research note',
      'Save as market claim',
      'Save as competitor record',
      'Save as data-room evidence',
      'Mark To Verify',
      'Reject',
    ]) {
      const button = buttonByText(label)
      expect(button).toBeTruthy()
      expect(button!.attributes('disabled')).toBeDefined()
      await button!.trigger('click')
    }
    await flushPromises()

    expect(createTaskMock).not.toHaveBeenCalled()
    expect(saveMemoryMock).not.toHaveBeenCalled()
    expect(intelligence.state.value.marketClaims).toHaveLength(0)
    expect(intelligence.state.value.competitors).toHaveLength(0)
    expect(intelligence.state.value.dataRoomSources).toHaveLength(0)
    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
    expect(intelligence.state.value.researchFindings[0].status).toBe('Rejected')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'market')?.evidenceStatus).toBe('To Verify')
  })

  it('prefills a To Verify finding draft from a research job without approving it', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      scope: 'Regulatory classification, permits, SDS, storage, transport, and evidence gaps.',
      expectedOutput: 'Source-backed research note with citations and follow-up tasks.',
      sourceRequirements: 'Include source title plus URL or date for every claim.',
      priority: 'high',
      schedulePreference: 'Tonight',
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
    expect((textareas[0].element as HTMLTextAreaElement).value).toContain('Scope: Regulatory classification')
    expect((textareas[0].element as HTMLTextAreaElement).value).toContain('Expected output: Source-backed research note')
    expect((textareas[0].element as HTMLTextAreaElement).value).toContain('Source requirements: Include source title')
    expect((textareas[0].element as HTMLTextAreaElement).value).toContain('Run time preference: Tonight')
    expect((inputs[0].element as HTMLInputElement).value).toBe('DMS regulation in China')
    expect((selects[0].element as HTMLSelectElement).value).toBe('regulatory')
    expect((selects[1].element as HTMLSelectElement).value).toBe('To Verify')
    expect(intelligence.state.value.researchFindings).toHaveLength(0)
  })

  it('schedules a deferred research job as a Hermes job without approving it', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      scope: 'Regulatory classification, permits, SDS, storage, transport, and evidence gaps.',
      expectedOutput: 'Source-backed research note with citations and follow-up tasks.',
      sourceRequirements: 'Include source title plus URL or date for every claim.',
      priority: 'high',
      schedulePreference: 'Tonight',
      context: 'Chemicon China Feasibility',
      status: 'Later',
    })

    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const scheduleButton = wrapper.findAll('button').find(button => button.text().includes('Schedule Hermes job'))
    expect(scheduleButton).toBeTruthy()

    await scheduleButton!.trigger('click')
    await flushPromises()

    expect(createJobMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Research: DMS regulation in China',
      deliver: 'local',
      repeat: 1,
    }))
    expect(createJobMock.mock.calls[0][0].schedule).toMatch(/T22:00:00$/)
    expect(createJobMock.mock.calls[0][0].prompt).toContain('Research question: Verify DMS regulatory status')
    expect(createJobMock.mock.calls[0][0].prompt).toContain('Do not invent market size')
    expect(createJobMock.mock.calls[0][0].prompt).toContain('Do not update Memory')
    expect(intelligence.state.value.researchJobs[0].status).toBe('Scheduled Hermes Job')
    expect(intelligence.state.value.researchJobs[0].scheduledJobId).toBe('job-scheduled-1')
    expect(intelligence.state.value.researchFindings).toHaveLength(0)
    expect(wrapper.text()).toContain('Scheduled as a Hermes job')
  })

  it('imports scheduled Hermes job output into the review form without approving it', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      scope: 'Regulatory classification, permits, SDS, storage, transport, and evidence gaps.',
      expectedOutput: 'Source-backed research note with citations and follow-up tasks.',
      sourceRequirements: 'Include source title plus URL or date for every claim.',
      priority: 'high',
      schedulePreference: 'Tonight',
      scheduledJobId: 'job-1',
      schedule: '2026-05-30T22:00:00',
      context: 'Chemicon China Feasibility',
      status: 'Scheduled Hermes Job',
    })
    listCronRunsMock.mockResolvedValueOnce([
      {
        jobId: 'job-1',
        fileName: '2026-05-30T22-00-00.md',
        runTime: '2026-05-30 22:00:00',
        size: 1200,
        hasOutput: true,
      },
    ])
    readCronRunMock.mockResolvedValueOnce({
      jobId: 'job-1',
      fileName: '2026-05-30T22-00-00.md',
      runTime: '2026-05-30 22:00:00',
      content: [
        'Research output: DMS regulatory status remains To Verify.',
        'Source: China chemical inventory note, 2026-05-30.',
        'Recommended task: collect official source link before investor use.',
      ].join('\n'),
    })

    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const importButton = wrapper.findAll('button').find(button => button.text().includes('Import latest output'))

    expect(importButton).toBeTruthy()
    await importButton!.trigger('click')
    await flushPromises()

    const textareas = wrapper.findAll('textarea')
    const inputs = wrapper.findAll('input')
    const selects = wrapper.findAll('select')
    expect(listCronRunsMock).toHaveBeenCalledWith('job-1')
    expect(readCronRunMock).toHaveBeenCalledWith('job-1', '2026-05-30T22-00-00.md')
    expect((textareas[0].element as HTMLTextAreaElement).value).toContain('Scheduled Hermes research output from DMS regulation in China')
    expect((textareas[0].element as HTMLTextAreaElement).value).toContain('DMS regulatory status remains To Verify')
    expect((inputs[0].element as HTMLInputElement).value).toBe('Research result: DMS regulation in China')
    expect((inputs[1].element as HTMLInputElement).value).toBe('Hermes scheduled job output: DMS regulation in China')
    expect((inputs[4].element as HTMLInputElement).value).toContain('Review sources and follow-up tasks')
    expect((selects[0].element as HTMLSelectElement).value).toBe('regulatory')
    expect((selects[1].element as HTMLSelectElement).value).toBe('To Verify')
    expect(intelligence.state.value.researchFindings).toHaveLength(0)
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'regulatory')?.evidenceStatus).toBe('Missing')
  })

  it('does not import scheduler metadata as a verified research result', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      scheduledJobId: 'job-1',
      context: 'Chemicon China Feasibility',
      status: 'Scheduled Hermes Job',
    })
    listCronRunsMock.mockResolvedValueOnce([
      {
        jobId: 'job-1',
        fileName: '__scheduler_metadata__.md',
        runTime: '2026-05-30 22:00:00',
        size: 0,
        hasOutput: false,
        synthetic: true,
        status: 'success',
      },
    ])

    const wrapper = mount(ResearchResultReviewView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const importButton = wrapper.findAll('button').find(button => button.text().includes('Import latest output'))

    expect(importButton).toBeTruthy()
    await importButton!.trigger('click')
    await flushPromises()

    expect(readCronRunMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('No readable research output found')
    expect(intelligence.state.value.researchFindings).toHaveLength(0)
  })

  it('creates a Kanban task from a deferred research job and marks it task-created', async () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addResearchJob({
      title: 'DMS regulation in China',
      question: 'Verify DMS regulatory status with sources.',
      scope: 'Regulatory classification, permits, SDS, storage, transport, and evidence gaps.',
      expectedOutput: 'Source-backed research note with citations and follow-up tasks.',
      sourceRequirements: 'Include source title plus URL or date for every claim.',
      priority: 'high',
      schedulePreference: 'Tonight',
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
    expect(createTaskMock.mock.calls[0][0].body).toContain('Scope: Regulatory classification')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Expected output: Source-backed research note')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Run time preference: Tonight')
    expect(createTaskMock.mock.calls[0][0].priority).toBe(3)
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

  it('creates deeper research jobs from missing investor slide gaps', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(InvestorPresentationBuilderView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const marketSlide = wrapper.findAll('.slide-card').find(card => card.text().includes('Market Evidence'))

    expect(marketSlide).toBeTruthy()
    const researchButton = marketSlide!.findAll('button').find(button => button.text() === 'Do deeper research')
    expect(researchButton).toBeTruthy()
    await researchButton!.trigger('click')

    const job = intelligence.state.value.researchJobs[0]
    expect(job.title).toBe('Investor slide research: Market Evidence')
    expect(job.status).toBe('Manual Research Job')
    expect(job.priority).toBe('high')
    expect(job.question).toContain('Market Evidence')
    expect(job.scope).toContain('Current slide status: Missing / To Verify')
    expect(job.scope).toContain('Do not invent market data')
    expect(job.sourceRequirements).toContain('Every claim needs a source')
    expect(intelligence.state.value.presentationMaterials).toHaveLength(0)
  })

  it('creates deeper research jobs from weak investor material without approving it', async () => {
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
    const weakMaterialPanel = wrapper.find('.excluded-materials')
    const researchButton = weakMaterialPanel.findAll('button').find(button => button.text() === 'Do deeper research')

    expect(researchButton).toBeTruthy()
    await researchButton!.trigger('click')

    const job = intelligence.state.value.researchJobs[0]
    expect(job.title).toBe('Investor material source review: Market Evidence')
    expect(job.status).toBe('Manual Research Job')
    expect(job.question).toContain('Verify, source, improve, or reject')
    expect(job.scope).toContain('Unsupported market evidence captured from a session')
    expect(job.scope).toContain('Why it is not investor-ready')
    expect(job.sourceRequirements).toContain('Unknown market share, market size, pricing, and investor return claims must stay To Verify')
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
    recordSessionCaptureActivity(
      'captured-session-1',
      {
        sessionId: 'captured-session-1',
        sessionTitle: 'DMS source review',
        contextLabel: 'Chemicon China Feasibility',
        capturedAt: new Date('2026-05-30T10:00:00Z'),
      },
      {
        createdTasks: 2,
        createdResearchTasks: 0,
        savedMemoryItems: 1,
        savedSessionSummary: true,
        savedFullTranscript: false,
        stagedResearchFindings: 1,
        stagedPresentationItems: 0,
        copiedItems: 0,
        fallbackText: '',
        errors: [],
      },
    )

    const wrapper = mount(DashboardView, {
      global: { stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Evidence Gaps')
    expect(wrapper.text()).toContain('Investor Risks')
    expect(wrapper.text()).toContain('Investor Risk Register')
    expect(wrapper.text()).toContain('Research Review Queue')
    expect(wrapper.text()).toContain('Recent Session Captures')
    expect(wrapper.text()).toContain('Financial & Deck Status')
    expect(wrapper.text()).toContain('Factory evidence')
    expect(wrapper.text()).toContain('Regulatory evidence')
    expect(wrapper.text()).toContain('DMS regulation source review')
    expect(wrapper.text()).toContain('CWAS competitor price proof')
    expect(wrapper.text()).toContain('Base')
    expect(wrapper.text()).toContain('Derived from Assumptions')
    expect(wrapper.text()).toContain('Market Evidence')
    expect(wrapper.text()).toContain('Unsupported market evidence needs source')
    expect(wrapper.text()).toContain('DMS source review')
    expect(wrapper.text()).toContain('2 tasks')
    expect(wrapper.text()).toContain('memory saved')
    expect(wrapper.text()).not.toContain('market share is')
    expect(wrapper.text()).not.toContain('CAGR')

    const taskButton = wrapper.findAll('button').find(button => button.text() === 'Create task')
    expect(taskButton).toBeTruthy()
    await taskButton!.trigger('click')
    await flushPromises()

    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Resolve Regulatory evidence',
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    }))
    expect(createTaskMock.mock.calls[0][0].body).toContain('Source page: Home / Next Best Actions')
    expect(createTaskMock.mock.calls[0][0].body).toContain('Do not mark this investor-ready')
  })

  it('shows shared feasibility intelligence inside Feasibility Studio', async () => {
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

    const wrapper = mount(FeasibilityStudioView, {
      global: { stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Current Investor-Readiness State')
    expect(wrapper.text()).toContain('Investor risks')
    expect(wrapper.text()).toContain('Investor Risk Register')
    expect(wrapper.text()).toContain('Financial model')
    expect(wrapper.text()).toContain('Base')
    expect(wrapper.text()).toContain('Factory evidence')
    expect(wrapper.text()).toContain('DMS regulation source review')
    expect(wrapper.text()).toContain('CWAS competitor price proof')
    expect(wrapper.text()).toContain('Deck Material Needing Evidence')
    expect(wrapper.text()).toContain('Unsupported market evidence needs source')
    expect(wrapper.text()).toContain('Chemicon Feasibility Checklist')
    expect(wrapper.text()).toContain('Report Preparation')
    expect(wrapper.text()).toContain('Feasibility Evidence Brief')
    expect(wrapper.text()).toContain('Investor Presentation Draft')
    expect(wrapper.text()).toContain('Financial Model Summary')
    expect(wrapper.text()).toContain('Research Review Notes')
    expect(wrapper.text()).toContain('Investor Data Room Index')
    expect(wrapper.text()).toContain('Base / Derived from Assumptions')
    expect(wrapper.text()).toContain('1 pending review')
    expect(wrapper.text()).not.toContain('Not generated yet')
    expect(wrapper.text()).not.toContain('CAGR')
  })
})
