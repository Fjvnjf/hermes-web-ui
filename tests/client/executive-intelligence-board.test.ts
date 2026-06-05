// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PinnedExecutiveIntelligenceBoard from '@/components/intelligence/PinnedExecutiveIntelligenceBoard.vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import {
  EXECUTIVE_REFRESH_SCHEDULE,
  buildInvestmentBreakdownRows,
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

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  NAlert: { template: '<div class="n-alert"><slot /></div>' },
  NButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
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

describe('Pinned Executive Intelligence Board', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('hermes.frontendAccessRole', 'owner')
    useFeasibilityIntelligence().resetFeasibilityIntelligenceForTests()
    createTaskMock.mockReset().mockResolvedValue({ id: 'task-1' })
    createJobMock.mockReset().mockResolvedValue({ id: 'job-1', job_id: 'job-1' })
    fetchBoardsMock.mockReset().mockResolvedValue(undefined)
    setSelectedBoardMock.mockReset()
  })

  it('renders missing economics as source review instead of hardcoded old dashboard numbers', () => {
    const wrapper = mount(PinnedExecutiveIntelligenceBoard)

    expect(wrapper.text()).toContain('Executive Intelligence Board')
    expect(wrapper.text()).toContain('Investor Economics Panel')
    expect(wrapper.text()).toContain('No approved source-backed value')
    expect(wrapper.text()).toContain('Trusted Sources / Research Review')
    expect(wrapper.text()).toContain('No saved IRR scenario')
    expect(wrapper.text()).not.toContain('Largest consumer; nearly half of 2024 global textile-chemicals value')
    expect(wrapper.text()).not.toMatch(/Missing\s*\/\s*Hermes\s+verifying\s+twice\s+daily/i)
    expect(wrapper.text()).not.toContain('fake CAGR')
    expect(wrapper.text()).not.toContain('fake market share')
  })

  it('labels financial outputs as Derived from Assumptions unless source-backed', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Assumption',
      npv: 125000,
      irr: 0.18,
      mirr: 0.14,
      paybackYear: 4,
      breakEvenVolumeTon: 5000,
      capexTotal: 2500000,
      yearOneRevenue: 3000000,
      warnings: ['Inputs still require source evidence.'],
      source: null,
    })

    const wrapper = mount(PinnedExecutiveIntelligenceBoard)

    expect(wrapper.text()).toContain('18.0%')
    expect(wrapper.text()).toContain('Derived from Assumptions')
    expect(wrapper.text()).toContain('IRR Calculator local scenario')
  })

  it('keeps market and competitor values source-gated with source-review defaults', () => {
    const intelligence = useFeasibilityIntelligence()
    intelligence.addMarketClaim({
      label: 'Market size',
      value: '',
      evidenceStatus: 'Source-backed',
      source: null,
    })
    intelligence.addCompetitor({
      companyName: 'Unknown supplier',
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
    intelligence.addCompetitor({
      companyName: 'Assumption competitor',
      countryRegion: 'China',
      productEquivalent: 'CWMS equivalent',
      activeContent: 'To Verify',
      pricingEvidence: 'To Verify',
      certifications: 'To Verify',
      distributionPresence: 'To Verify',
      marketShare: '12%',
      evidenceStatus: 'Powerful Assumption',
      source: null,
      notes: 'Assumption only.',
    })

    const wrapper = mount(PinnedExecutiveIntelligenceBoard)

    expect(wrapper.text()).toContain('Market size')
    expect(wrapper.text()).toContain('No source-backed claim captured yet')
    expect(wrapper.text()).not.toContain('Largest consumer; nearly half of 2024 global textile-chemicals value')
    expect(wrapper.text()).toContain('Unknown supplier')
    expect(wrapper.text()).toContain('No source-backed value yet')
    expect(wrapper.text()).not.toMatch(/Hermes\s+verifying\s+twice\s+daily/i)
    expect(wrapper.text()).not.toMatch(/Missing\s*\/\s*Hermes\s+verifying\s+twice\s+daily/i)
    expect(wrapper.text()).toContain('Powerful Assumption: 12%')
    expect(competitorMarketShare('', null, 'Verified')).toBe('To Verify')
    expect(competitorMarketShare('12%', null, 'Powerful Assumption')).toBe('Powerful Assumption: 12%')
  })

  it('exposes twice daily schedule metadata and stages Sync Now into Research Result Review', async () => {
    const wrapper = mount(PinnedExecutiveIntelligenceBoard)
    expect(defaultExecutiveRefreshState().schedule).toBe(EXECUTIVE_REFRESH_SCHEDULE)
    expect(wrapper.text()).toContain('09:00 and 21:00 local time')

    const before = useFeasibilityIntelligence().pendingResearchFindings.value.length
    await wrapper.get('button').trigger('click')
    await flushPromises()

    const findings = useFeasibilityIntelligence().pendingResearchFindings.value
    expect(findings.length).toBeGreaterThan(before)
    expect(findings.some(item => item.keyClaim.includes('Executive intelligence board'))).toBe(true)
  })

  it('can create a real Kanban fallback task and a Hermes refresh job from explicit user actions', async () => {
    const wrapper = mount(PinnedExecutiveIntelligenceBoard)
    const buttons = wrapper.findAll('button')

    await buttons.find(button => button.text().includes('Enable Twice Daily Refresh'))!.trigger('click')
    await flushPromises()
    expect(createJobMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Executive Intelligence Refresh',
      schedule: EXECUTIVE_REFRESH_SCHEDULE,
      deliver: 'local',
    }))

    await buttons.find(button => button.text().includes('Create Missing Data Task'))!.trigger('click')
    await flushPromises()
    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Fill missing executive intelligence data',
    }))
  })

  it('redacts sensitive economics for employee-style views and keeps investor viewers in approved-only mode', () => {
    useFeasibilityIntelligence().saveFinancialModelSnapshot({
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Assumption',
      npv: 125000,
      irr: 0.18,
      mirr: 0.14,
      paybackYear: 4,
      breakEvenVolumeTon: 5000,
      capexTotal: 2500000,
      yearOneRevenue: 3000000,
      warnings: [],
      source: null,
    })

    window.localStorage.setItem('hermes.frontendAccessRole', 'employee')
    const employeeWrapper = mount(PinnedExecutiveIntelligenceBoard)
    expect(employeeWrapper.text()).toContain('Restricted role view')
    expect(employeeWrapper.text()).toContain('Restricted')
    expect(employeeWrapper.text()).not.toContain('$2,500,000')

    window.localStorage.setItem('hermes.frontendAccessRole', 'investor_viewer')
    const investorWrapper = mount(PinnedExecutiveIntelligenceBoard)
    expect(investorWrapper.text()).toContain('No approved investor board is available yet')
    expect(investorWrapper.text()).not.toContain('Investor Economics Panel')
  })

  it('keeps investment breakdown line items as To Verify until source-backed storage exists', () => {
    expect(buildInvestmentBreakdownRows()).toEqual([
      expect.objectContaining({ label: 'Process Equipment', value: 'Source-backed quote required', evidenceStatus: 'To Verify' }),
      expect.objectContaining({ label: 'Utilities & Infrastructure', value: 'Source-backed quote required', evidenceStatus: 'To Verify' }),
      expect.objectContaining({ label: 'Buildings & Civil', value: 'Source-backed quote required', evidenceStatus: 'To Verify' }),
      expect.objectContaining({ label: 'Engineering & Project Management', value: 'Source-backed quote required', evidenceStatus: 'To Verify' }),
      expect.objectContaining({ label: 'Installation & Commissioning', value: 'Source-backed quote required', evidenceStatus: 'To Verify' }),
      expect.objectContaining({ label: 'Working Capital', value: 'Source-backed quote required', evidenceStatus: 'To Verify' }),
      expect.objectContaining({ label: 'Contingency', value: 'Source-backed quote required', evidenceStatus: 'To Verify' }),
      expect.objectContaining({ label: 'Other Costs', value: 'Source-backed quote required', evidenceStatus: 'To Verify' }),
    ])
  })

  it('builds source-backed financial KPIs only when a usable source exists', () => {
    const kpis = buildInvestorEconomicsKpis({
      id: 'source-backed-model',
      scenarioName: 'Base',
      projectName: 'Chemicon China Feasibility',
      currency: 'USD',
      evidenceStatus: 'Source-backed',
      npv: 1000,
      irr: 0.1,
      mirr: 0.09,
      paybackYear: 3,
      breakEvenVolumeTon: 100,
      capexTotal: 5000,
      yearOneRevenue: 8000,
      warnings: [],
      source: { title: 'Reviewed model', date: '2026-05-30' },
      createdAt: '2026-05-30T00:00:00.000Z',
    }, 'Tonight')

    expect(kpis.find(item => item.key === 'projectIrr')?.evidenceStatus).toBe('Source-backed')
    expect(kpis.find(item => item.key === 'capacity')?.value).toBe('No approved capacity evidence')
  })
})
