import { describe, expect, it } from 'vitest'

import { canAccessRouteName } from '@/utils/accessControl'

describe('frontend route access policy', () => {
  it('keeps investor viewers inside the approved portal until approved data filtering exists', () => {
    expect(canAccessRouteName('hermes.investorPortal', 'investor_viewer')).toBe(true)
    expect(canAccessRouteName('hermes.investorPresentation', 'investor_viewer')).toBe(false)
    expect(canAccessRouteName('hermes.investorReadiness', 'investor_viewer')).toBe(false)
    expect(canAccessRouteName('hermes.marketIntelligence', 'investor_viewer')).toBe(false)
    expect(canAccessRouteName('hermes.chat', 'investor_viewer')).toBe(false)
  })

  it('blocks employee-style roles from raw sensitive owner areas', () => {
    for (const role of ['employee', 'research_assistant', 'regulatory_consultant'] as const) {
      expect(canAccessRouteName('hermes.kanban', role)).toBe(true)
      expect(canAccessRouteName('hermes.memory', role)).toBe(false)
      expect(canAccessRouteName('hermes.history', role)).toBe(false)
      expect(canAccessRouteName('hermes.files', role)).toBe(false)
      expect(canAccessRouteName('hermes.terminal', role)).toBe(false)
      expect(canAccessRouteName('hermes.marketIntelligence', role)).toBe(false)
    }
  })

  it('allows developer admins system tools without raw business memory', () => {
    expect(canAccessRouteName('hermes.terminal', 'developer_admin')).toBe(true)
    expect(canAccessRouteName('hermes.settings', 'developer_admin')).toBe(true)
    expect(canAccessRouteName('hermes.logs', 'developer_admin')).toBe(true)
    expect(canAccessRouteName('hermes.memory', 'developer_admin')).toBe(false)
  })

  it('allows financial analysts to open the calculator but not raw history or files', () => {
    expect(canAccessRouteName('hermes.investmentCalculator', 'financial_analyst')).toBe(true)
    expect(canAccessRouteName('hermes.history', 'financial_analyst')).toBe(false)
    expect(canAccessRouteName('hermes.files', 'financial_analyst')).toBe(false)
  })
})
