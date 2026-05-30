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

  it('allows employee-style roles into business workspaces while keeping sensitive owner areas blocked', () => {
    for (const role of ['employee', 'research_assistant', 'regulatory_consultant'] as const) {
      expect(canAccessRouteName('hermes.chat', role)).toBe(true)
      expect(canAccessRouteName('hermes.history', role)).toBe(true)
      expect(canAccessRouteName('hermes.files', role)).toBe(true)
      expect(canAccessRouteName('hermes.kanban', role)).toBe(true)
      expect(canAccessRouteName('hermes.research', role)).toBe(true)
      expect(canAccessRouteName('hermes.marketIntelligence', role)).toBe(true)
      expect(canAccessRouteName('hermes.competitorIntelligence', role)).toBe(true)
      expect(canAccessRouteName('hermes.exportMarketOpportunity', role)).toBe(true)
      expect(canAccessRouteName('hermes.jobs', role)).toBe(true)
      expect(canAccessRouteName('hermes.memory', role)).toBe(false)
      expect(canAccessRouteName('hermes.rawMaterialSourcing', role)).toBe(false)
      expect(canAccessRouteName('hermes.terminal', role)).toBe(false)
      expect(canAccessRouteName('hermes.settings', role)).toBe(false)
      expect(canAccessRouteName('hermes.models', role)).toBe(false)
      expect(canAccessRouteName('hermes.logs', role)).toBe(false)
    }
  })

  it('allows developer admins system tools without raw business memory', () => {
    expect(canAccessRouteName('hermes.terminal', 'developer_admin')).toBe(true)
    expect(canAccessRouteName('hermes.settings', 'developer_admin')).toBe(true)
    expect(canAccessRouteName('hermes.logs', 'developer_admin')).toBe(true)
    expect(canAccessRouteName('hermes.memory', 'developer_admin')).toBe(false)
    expect(canAccessRouteName('hermes.localBackupVault', 'developer_admin')).toBe(false)
  })

  it('allows financial analysts to open finance and business workspaces but not raw memory or system areas', () => {
    expect(canAccessRouteName('hermes.investmentCalculator', 'financial_analyst')).toBe(true)
    expect(canAccessRouteName('hermes.history', 'financial_analyst')).toBe(true)
    expect(canAccessRouteName('hermes.files', 'financial_analyst')).toBe(true)
    expect(canAccessRouteName('hermes.memory', 'financial_analyst')).toBe(false)
    expect(canAccessRouteName('hermes.terminal', 'financial_analyst')).toBe(false)
  })

  it('keeps the Local Backup Vault owner-only', () => {
    expect(canAccessRouteName('hermes.localBackupVault', 'owner')).toBe(true)
    expect(canAccessRouteName('hermes.localBackupVault', 'employee')).toBe(false)
    expect(canAccessRouteName('hermes.localBackupVault', 'investor_viewer')).toBe(false)
  })
})
