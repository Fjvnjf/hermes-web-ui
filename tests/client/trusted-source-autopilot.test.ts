// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { useTrustedSourceAutopilot } from '@/composables/useTrustedSourceAutopilot'
import {
  classifySourceCandidate,
  evidenceStatusForTier,
} from '@/utils/trustedSources'
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
  NSelect: { template: '<select />' },
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
})
