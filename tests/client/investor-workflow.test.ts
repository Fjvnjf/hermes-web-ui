// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateInvestmentScenario,
  createEmptyInvestmentScenario,
  irr,
  npv,
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
})
