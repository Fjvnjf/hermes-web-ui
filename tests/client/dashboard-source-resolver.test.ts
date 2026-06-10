import { describe, expect, it } from 'vitest'
import {
  resolveSourceBackedDashboardRecords,
  type DashboardSourceTarget,
} from '@/utils/dashboardSourceResolver'
import type {
  CompetitorIntelligenceRecord,
  DataRoomSourceRecord,
} from '@/composables/useFeasibilityIntelligence'
import type { MarketClaim } from '@/utils/investorIntelligence'

function resolve(input: {
  marketClaims?: MarketClaim[]
  dataRoomSources?: DataRoomSourceRecord[]
  competitors?: CompetitorIntelligenceRecord[]
}, targets: DashboardSourceTarget[]) {
  return resolveSourceBackedDashboardRecords({
    marketClaims: input.marketClaims || [],
    dataRoomSources: input.dataRoomSources || [],
    competitors: input.competitors || [],
  }, targets)
}

describe('dashboard source resolver', () => {
  it('uses exact market dashboard fields instead of keyword scans', () => {
    const records = resolve({
      marketClaims: [
        {
          id: 'keyword-bait',
          label: 'CWAS growth demand headline',
          value: '8%',
          evidenceStatus: 'Source-backed',
          source: { title: 'Official market source', url: 'https://example.gov/market' },
        },
        {
          id: 'missing-source-detail',
          label: 'Growth Rate',
          value: '7%',
          evidenceStatus: 'Source-backed',
          source: { title: 'Official market source' },
        },
        {
          id: 'exact-growth',
          label: 'Growth Rate',
          value: '6.5%',
          evidenceStatus: 'Official Data',
          source: { title: 'National statistics office', date: '2026-06-01' },
        },
      ],
    }, [{
      group: 'marketClaims',
      fields: ['Growth Rate'],
    }])

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: 'exact-growth',
      label: 'Growth Rate',
      value: '6.5%',
      recordType: 'marketClaim',
      dashboardGroup: 'marketClaims',
    })
  })

  it('matches source-backed dashboard records by proposed field and field key metadata', () => {
    const source = { title: 'Official textile source', url: 'https://example.gov/textile' }
    const records = resolve({
      marketClaims: [
        {
          id: 'field-key-growth',
          label: 'Official source-backed country note',
          fieldKey: 'market.countryWiseConsumptionGrowth',
          value: '6.5%',
          evidenceStatus: 'Official Data',
          source,
        },
        {
          id: 'proposed-market-size',
          label: 'Official market context',
          proposedDashboardField: 'Market Size / Scope',
          value: 'Official textile-sector scope source located',
          evidenceStatus: 'Source-backed',
          source,
        },
      ],
      dataRoomSources: [
        {
          id: 'supplier-field-key',
          checklistLabel: 'Uploaded source packet',
          fieldKey: 'rawMaterial.sdsTdsCoaEvidence',
          area: 'product',
          dashboardGroup: 'rawMaterialSignals',
          proposedValue: 'CWAS 90 TDS attached',
          evidenceStatus: 'Supplier Evidence',
          source,
          notes: 'Imported by autopilot.',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    }, [
      {
        group: 'marketClaims',
        fields: ['Country-wise Consumption Growth', 'Market Size / Scope'],
      },
      {
        group: 'rawMaterialSignals',
        fields: ['SDS / TDS / COA Evidence'],
      },
    ])

    expect(records.map(record => record.id)).toEqual([
      'field-key-growth',
      'proposed-market-size',
      'supplier-field-key',
    ])
  })

  it('maps data-room records by dashboard group and exact field root only when source-backed', () => {
    const source = { title: 'Supplier TDS upload', date: '2026-06-01' }
    const records = resolve({
      dataRoomSources: [
        {
          id: 'raw-material-product',
          checklistLabel: 'SDS / TDS / COA Evidence - CWAS 90',
          area: 'product',
          dashboardGroup: 'rawMaterialSignals',
          proposedValue: 'CWAS 90 TDS attached',
          evidenceStatus: 'Supplier Evidence',
          source,
          notes: 'Imported by autopilot.',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'wrong-group',
          checklistLabel: 'SDS / TDS / COA Evidence',
          area: 'financial',
          dashboardGroup: 'financialEvidence',
          proposedValue: 'Finance appendix',
          evidenceStatus: 'Supplier Evidence',
          source,
          notes: 'Wrong dashboard group for this widget.',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'weak-status',
          checklistLabel: 'SDS / TDS / COA Evidence',
          area: 'product',
          dashboardGroup: 'rawMaterialSignals',
          proposedValue: 'Reference listing only',
          evidenceStatus: 'Reference Only',
          source,
          notes: 'Should stay out of widgets.',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    }, [{
      group: 'rawMaterialSignals',
      fields: ['SDS / TDS / COA Evidence'],
    }])

    expect(records.map(record => record.id)).toEqual(['raw-material-product'])
    expect(records[0].value).toBe('CWAS 90 TDS attached')
  })

  it('maps competitors to aggregate and market-share dashboard fields without unsupported records', () => {
    const sourcedCompetitor: CompetitorIntelligenceRecord = {
      id: 'competitor-source-backed',
      companyName: 'Stepan Company',
      countryRegion: 'United States',
      productEquivalent: 'Textile softener portfolio',
      activeContent: 'To Verify',
      pricingEvidence: 'To Verify',
      certifications: 'Company product source',
      distributionPresence: 'Global',
      marketShare: '12%',
      revenue: '',
      yearlyGrowth: '',
      metricEvidence: {
        marketShare: {
          value: '12%',
          source: { title: 'Stepan market-share report', url: 'https://www.stepan.com/share-source' },
          evidenceStatus: 'Source-backed',
          confidence: 'high',
          reviewRequired: false,
        },
      },
      evidenceStatus: 'Source-backed',
      source: { title: 'Stepan official', url: 'https://www.stepan.com/' },
      notes: 'Imported by autopilot.',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }

    const profiled = resolve({
      competitors: [
        sourcedCompetitor,
        {
          ...sourcedCompetitor,
          id: 'no-source',
          companyName: 'No Source Co',
          source: { title: 'Listing without URL or date' },
          metricEvidence: undefined,
        },
        {
          ...sourcedCompetitor,
          id: 'user-approved',
          companyName: 'User Approved Co',
          evidenceStatus: 'User Approved',
          source: { title: 'Manual note', date: '2026-06-01' },
        },
      ],
    }, [{
      group: 'competitorRecords',
      fields: ['Competitors Profiled'],
    }])
    const marketShare = resolve({
      competitors: [
        sourcedCompetitor,
        { ...sourcedCompetitor, id: 'no-share', companyName: 'No Share Co', marketShare: '', metricEvidence: undefined },
      ],
    }, [{
      group: 'competitorRecords',
      fields: ['Market Share Chart'],
    }])

    expect(profiled.map(record => record.label)).toEqual(['Stepan Company', 'User Approved Co'])
    expect(marketShare).toHaveLength(1)
    expect(marketShare[0]).toMatchObject({
      label: 'Stepan Company',
      value: '12%',
      source: { title: 'Stepan market-share report', url: 'https://www.stepan.com/share-source' },
      recordType: 'competitor',
    })
  })

  it('does not export competitor metric values from a generic company source', () => {
    const records = resolve({
      competitors: [{
        id: 'generic-source-only',
        companyName: 'Generic Source Co',
        countryRegion: 'Germany',
        productEquivalent: 'Official company profile',
        activeContent: 'To Verify',
        pricingEvidence: '',
        certifications: 'Official profile source',
        distributionPresence: 'To Verify',
        marketShare: '12%',
        revenue: 'US$2B',
        yearlyGrowth: '',
        evidenceStatus: 'Source-backed',
        source: { title: 'Generic official company page', url: 'https://example.com/company' },
        notes: 'This source proves company identity only.',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }],
    }, [{
      group: 'competitorRecords',
      fields: ['Market Share Chart', 'Revenue'],
    }])

    expect(records).toHaveLength(0)
  })

  it('uses metric-level competitor evidence when the top-level competitor source is only contextual', () => {
    const records = resolve({
      competitors: [{
        id: 'metric-evidence-only',
        companyName: 'Metric Evidence Co',
        countryRegion: 'Germany',
        productEquivalent: 'Company-wide financial context',
        activeContent: 'To Verify',
        pricingEvidence: '',
        certifications: 'To Verify',
        distributionPresence: 'To Verify',
        marketShare: '',
        revenue: 'FY2025 company-wide revenue: US$2.4B',
        yearlyGrowth: '',
        evidenceStatus: 'To Verify',
        source: null,
        metricEvidence: {
          revenue: {
            value: 'FY2025 company-wide revenue: US$2.4B',
            source: { title: 'Official annual report', url: 'https://example.com/report' },
            evidenceStatus: 'Official Company Evidence',
            confidence: 'high',
            reviewRequired: false,
          },
        },
        notes: 'Imported by autopilot.',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }],
    }, [{
      group: 'competitorRecords',
      fields: ['Revenue'],
    }])

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      label: 'Metric Evidence Co',
      value: 'FY2025 company-wide revenue: US$2.4B',
      source: { title: 'Official annual report', url: 'https://example.com/report' },
      evidenceStatus: 'Official Company Evidence',
    })
  })
})
