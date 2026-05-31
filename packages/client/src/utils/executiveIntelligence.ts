import type { FinancialModelSnapshot } from '@/composables/useFeasibilityIntelligence'
import {
  formatSourcedMarketShare,
  normalizedMarketClaimStatus,
  type IntelligenceEvidenceStatus,
  type MarketClaim,
  type SourceReference,
} from '@/utils/investorIntelligence'

export const EXECUTIVE_INTELLIGENCE_STORAGE_KEY = 'hermes.executiveIntelligenceBoard.v1'
export const EXECUTIVE_REFRESH_JOB_NAME = 'Executive Intelligence Refresh'
export const EXECUTIVE_REFRESH_SCHEDULE = '0 9,21 * * *'

export interface ExecutiveRefreshState {
  lastRun: string | null
  nextRun: string | null
  lastStatus: string
  resultNeedsReviewCount: number
  scheduledJobId?: string
  schedule: string
  scheduleDisplay: string
  localOnly: boolean
}

export interface ExecutiveKpi {
  key: string
  label: string
  value: string
  evidenceStatus: IntelligenceEvidenceStatus
  sourceLabel: string
  lastUpdated: string
  nextUpdate: string
  sensitive?: boolean
}

export interface ExecutiveBreakdownRow {
  label: string
  value: string
  evidenceStatus: IntelligenceEvidenceStatus
  sourceLabel: string
}

export interface ExecutiveCompetitorRow {
  rank: string
  manufacturer: string
  hq: string
  productEquivalent: string
  capacity: string
  marketShare: string
  sourceLabel: string
  evidenceStatus: IntelligenceEvidenceStatus
}

export function nextTwiceDailyRefresh(now = new Date()): string {
  const candidates = [9, 21].map(hour => {
    const candidate = new Date(now)
    candidate.setHours(hour, 0, 0, 0)
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1)
    return candidate
  })
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0].toISOString()
}

export function defaultExecutiveRefreshState(now = new Date()): ExecutiveRefreshState {
  return {
    lastRun: null,
    nextRun: nextTwiceDailyRefresh(now),
    lastStatus: 'Not run yet',
    resultNeedsReviewCount: 0,
    schedule: EXECUTIVE_REFRESH_SCHEDULE,
    scheduleDisplay: '09:00 and 21:00 local time',
    localOnly: true,
  }
}

export function financialOutputStatus(snapshot: FinancialModelSnapshot | null): IntelligenceEvidenceStatus {
  if (!snapshot) return 'To Verify'
  if (
    (snapshot.evidenceStatus === 'Verified' || snapshot.evidenceStatus === 'Source-backed') &&
    sourceIsUsable(snapshot.source)
  ) {
    return snapshot.evidenceStatus
  }
  return 'Derived from Assumptions'
}

export function formatExecutiveCurrency(value: number | null | undefined, currency = 'USD'): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return 'Missing / To Verify'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatExecutivePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Missing / To Verify'
  return `${(value * 100).toFixed(1)}%`
}

export function buildInvestorEconomicsKpis(
  snapshot: FinancialModelSnapshot | null,
  nextUpdate: string,
): ExecutiveKpi[] {
  const currency = snapshot?.currency || 'USD'
  const sourceLabel = snapshot?.source?.title || (snapshot ? 'IRR Calculator local scenario' : 'No saved IRR scenario')
  const lastUpdated = snapshot?.createdAt || 'Not available'
  const outputStatus = financialOutputStatus(snapshot)

  return [
    {
      key: 'totalInvestment',
      label: 'Total investment',
      value: formatExecutiveCurrency(snapshot?.capexTotal, currency),
      evidenceStatus: outputStatus,
      sourceLabel,
      lastUpdated,
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'projectIrr',
      label: 'Project IRR',
      value: formatExecutivePercent(snapshot?.irr),
      evidenceStatus: outputStatus,
      sourceLabel,
      lastUpdated,
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'npv',
      label: 'NPV',
      value: snapshot ? formatExecutiveCurrency(snapshot.npv, currency) : 'Missing / To Verify',
      evidenceStatus: outputStatus,
      sourceLabel,
      lastUpdated,
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'payback',
      label: 'Payback period',
      value: snapshot?.paybackYear ? `Year ${snapshot.paybackYear}` : 'Missing / To Verify',
      evidenceStatus: outputStatus,
      sourceLabel,
      lastUpdated,
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'profitabilityIndex',
      label: 'Profitability index',
      value: 'Missing / To Verify',
      evidenceStatus: 'To Verify',
      sourceLabel: 'Not calculated yet',
      lastUpdated: 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'revenueTarget',
      label: 'Revenue target',
      value: formatExecutiveCurrency(snapshot?.yearOneRevenue, currency),
      evidenceStatus: outputStatus,
      sourceLabel,
      lastUpdated,
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'capacity',
      label: 'Capacity',
      value: 'Missing / To Verify',
      evidenceStatus: 'To Verify',
      sourceLabel: 'No source-backed capacity record',
      lastUpdated: 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'blendedAsp',
      label: 'Blended ASP',
      value: 'Missing / To Verify',
      evidenceStatus: 'To Verify',
      sourceLabel: 'No source-backed ASP record',
      lastUpdated: 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'fiveYearRoi',
      label: '5-year ROI',
      value: snapshot?.investorMoic && Number.isFinite(snapshot.investorMoic)
        ? `${snapshot.investorMoic.toFixed(2)}x MOIC`
        : 'Missing / To Verify',
      evidenceStatus: snapshot?.investorMoic ? outputStatus : 'To Verify',
      sourceLabel: snapshot?.investorMoic ? sourceLabel : 'Not calculated yet',
      lastUpdated: snapshot?.investorMoic ? lastUpdated : 'Not available',
      nextUpdate,
      sensitive: true,
    },
  ]
}

export function buildInvestmentBreakdownRows(): ExecutiveBreakdownRow[] {
  return [
    'Process Equipment',
    'Utilities & Infrastructure',
    'Buildings & Civil',
    'Engineering & Project Management',
    'Installation & Commissioning',
    'Working Capital',
    'Contingency',
    'Other Costs',
  ].map(label => ({
    label,
    value: 'To Verify',
    evidenceStatus: 'To Verify',
    sourceLabel: 'No source-backed line-item record',
  }))
}

export function marketClaimValue(claim: MarketClaim | null | undefined): string {
  if (!claim?.value?.trim()) return 'Missing / To Verify'
  return claim.value.trim()
}

export function marketClaimSourceLabel(claim: MarketClaim | null | undefined): string {
  if (!claim?.source?.title?.trim()) return 'Source missing'
  return [claim.source.title, claim.source.date, claim.source.url].filter(Boolean).join(' / ')
}

export function claimStatusOrToVerify(claim: MarketClaim | null | undefined): IntelligenceEvidenceStatus {
  if (!claim) return 'To Verify'
  return normalizedMarketClaimStatus(claim)
}

export function competitorMarketShare(
  value: string | null | undefined,
  source: SourceReference | null | undefined,
  evidenceStatus: IntelligenceEvidenceStatus,
): string {
  return formatSourcedMarketShare(value, source, evidenceStatus)
}

function sourceIsUsable(source?: SourceReference | null): boolean {
  return Boolean(source?.title?.trim() && (source.url?.trim() || source.date?.trim()))
}
