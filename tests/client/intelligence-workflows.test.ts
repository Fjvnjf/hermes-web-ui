// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  canAccessRouteName,
  isEmployeeRestrictedRoute,
} from '@/utils/accessControl'
import {
  calculatePriceAlert,
  createExportMarketResearchTaskBody,
  exportMarketStatusLabel,
  sourceBackedOrToVerify,
  sourceTypeStatus,
} from '@/utils/intelligenceWorkflow'
import {
  buildInvestorPresentationDraft,
  formatSourcedMarketShare,
  normalizedMarketClaimStatus,
} from '@/utils/investorIntelligence'

vi.mock('@/api/client', () => ({
  getStoredUserRole: () => 'super_admin',
}))

describe('intelligence workspace guardrails', () => {
  it('keeps employee access away from sensitive product, price, memory, terminal, and system routes', () => {
    expect(canAccessRouteName('hermes.research', 'employee')).toBe(true)
    expect(canAccessRouteName('hermes.kanban', 'employee')).toBe(true)
    expect(canAccessRouteName('hermes.rawMaterialSourcing', 'employee')).toBe(false)
    expect(canAccessRouteName('hermes.memory', 'employee')).toBe(false)
    expect(canAccessRouteName('hermes.history', 'employee')).toBe(false)
    expect(canAccessRouteName('hermes.terminal', 'employee')).toBe(false)
    expect(canAccessRouteName('hermes.settings', 'employee')).toBe(false)
    expect(isEmployeeRestrictedRoute('hermes.rawMaterialSourcing')).toBe(true)
  })

  it('labels raw material prices without source or value as To Verify and detects 5 percent alerts', () => {
    expect(sourceTypeStatus('Supplier quote', 'Supplier A quote', '2026-05-30', true)).toBe('Source-backed')
    expect(sourceTypeStatus('Alibaba/Made-in-China reference', 'Listing page', '2026-05-30', true)).toBe('Reference Only')
    expect(sourceTypeStatus('Manual entry', '', '2026-05-30', true)).toBe('To Verify')
    expect(sourceTypeStatus('Supplier quote', 'Supplier A quote', '2026-05-30', false)).toBe('To Verify')

    const alert = calculatePriceAlert(100, 106, 5)
    expect(alert.triggered).toBe(true)
    expect(alert.direction).toBe('increase')

    const quiet = calculatePriceAlert(100, 103, 5)
    expect(quiet.triggered).toBe(false)
  })

  it('keeps export market country data as trade proxy or To Verify without HS/source evidence', () => {
    expect(exportMarketStatusLabel('')).toBe('Trade proxy / To Verify')
    expect(sourceBackedOrToVerify('import value available', '', '2026-05-30', 'Source-backed')).toBe('To Verify')
    expect(sourceBackedOrToVerify('import value available', 'UN Comtrade', '2026-05-30', 'Source-backed')).toBe('Source-backed')
    expect(createExportMarketResearchTaskBody('CWAS', 'largest importers', '5-year')).toContain('Trade proxy / To Verify')
  })

  it('prevents unsupported market and competitor claims from looking verified', () => {
    expect(normalizedMarketClaimStatus({
      label: 'CWAS demand',
      value: 'Large market',
      evidenceStatus: 'Verified',
      source: null,
    })).toBe('To Verify')

    expect(formatSourcedMarketShare('', null, 'Verified')).toBe('To Verify')
    expect(formatSourcedMarketShare('12%', null, 'Powerful Assumption')).toBe('Powerful Assumption: 12%')
    expect(formatSourcedMarketShare('12%', { title: 'Industry report', date: '2026' }, 'Source-backed')).toBe('12%')
  })

  it('excludes unsupported investor presentation material while allowing labeled approved/source-backed material', () => {
    const draft = buildInvestorPresentationDraft([
      {
        section: 'Market Opportunity',
        content: 'Unsupported market size claim',
        evidenceStatus: 'Verified',
        source: null,
      },
      {
        section: 'Raw Material Strategy',
        content: 'Supplier quote evidence is attached for review.',
        evidenceStatus: 'Source-backed',
        source: { title: 'Supplier quote', date: '2026-05-30' },
      },
      {
        section: 'Competitor analysis',
        content: 'Market share is a powerful assumption, not a fact.',
        evidenceStatus: 'Powerful Assumption',
        source: null,
      },
    ])

    expect(draft).toHaveLength(2)
    expect(draft.map(item => item.section)).toEqual(['Raw Material Strategy', 'Competitor analysis'])
    expect(draft[1].sourceDetail).toContain('not a fact')
  })
})
