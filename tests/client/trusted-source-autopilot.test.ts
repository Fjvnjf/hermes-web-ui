// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import TrustedSourcesView from '@/views/hermes/TrustedSourcesView.vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import {
  FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
  FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
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
import { canAccessRouteName } from '@/utils/accessControl'

vi.mock('@/api/client', () => ({
  getStoredUserRole: () => 'super_admin',
}))

vi.mock('@/stores/hermes/jobs', () => ({
  useJobsStore: () => ({
    createJob: vi.fn().mockResolvedValue({ id: 'job-1', job_id: 'job-1' }),
  }),
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
    expect(prompt).toContain('Do not invent market size')
    expect(prompt).toContain('competitor market share as To Verify')
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

    await wrapper.findAll('button').find(button => button.text().includes('Run Source Snapshot Now'))!.trigger('click')
    await vi.dynamicImportSettled()

    expect(autopilot.lastSnapshotForScreen('market')).not.toBeNull()
    expect(wrapper.text()).toContain('Needs Review')
  })
})
