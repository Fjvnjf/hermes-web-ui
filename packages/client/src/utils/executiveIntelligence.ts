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
  const status = snapshot.evidenceStatus
  if (
    (
      status === 'Verified' ||
      status === 'Source-backed' ||
      status === 'Official Data' ||
      status === 'Trusted Source Auto-Updated' ||
      status === 'Supplier Evidence' ||
      status === 'Market Reference'
    ) &&
    sourceIsUsable(snapshot.source)
  ) {
    return status
  }
  if (
    status === 'User Approved' ||
    status === 'Investor Approved' ||
    status === 'Approved Assumption'
  ) {
    return status
  }
  if (status === 'Assumption' || status === 'Powerful Assumption' || status === 'Derived from Assumptions') {
    return 'Derived from Assumptions'
  }
  return 'To Verify'
}

export function formatExecutiveCurrency(value: number | null | undefined, currency = 'USD'): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return 'No approved source-backed value'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatExecutivePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'No approved source-backed value'
  return `${(value * 100).toFixed(1)}%`
}

function financialKpiCanDisplayValue(snapshot: FinancialModelSnapshot | null, outputStatus: IntelligenceEvidenceStatus): snapshot is FinancialModelSnapshot {
  if (!snapshot) return false
  return [
    'Verified',
    'Source-backed',
    'Official Data',
    'Trusted Source Auto-Updated',
    'Supplier Evidence',
    'Market Reference',
    'User Approved',
    'Investor Approved',
    'Approved Assumption',
  ].includes(outputStatus)
}

function formatExecutiveRoiFromMoic(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return 'No approved source-backed scenario'
  return `${((value - 1) * 100).toFixed(1)}%`
}

export function buildInvestorEconomicsKpis(
  snapshot: FinancialModelSnapshot | null,
  nextUpdate: string,
): ExecutiveKpi[] {
  const currency = snapshot?.currency || 'USD'
  const sourceLabel = snapshot?.source?.title || (snapshot ? 'IRR Calculator local scenario' : 'No saved IRR scenario')
  const lastUpdated = snapshot?.createdAt || 'Not available'
  const outputStatus = financialOutputStatus(snapshot)
  const canDisplayValue = financialKpiCanDisplayValue(snapshot, outputStatus)

  return [
    {
      key: 'totalInvestment',
      label: 'Total Investment',
      value: canDisplayValue ? formatExecutiveCurrency(snapshot.capexTotal, currency) : 'No approved source-backed value',
      evidenceStatus: canDisplayValue ? outputStatus : 'To Verify',
      sourceLabel: canDisplayValue ? sourceLabel : 'No approved financial model',
      lastUpdated: canDisplayValue ? lastUpdated : 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'projectIrr',
      label: 'Project IRR',
      value: canDisplayValue ? formatExecutivePercent(snapshot.irr) : 'No approved source-backed value',
      evidenceStatus: canDisplayValue ? outputStatus : 'To Verify',
      sourceLabel: canDisplayValue ? sourceLabel : 'No approved financial model',
      lastUpdated: canDisplayValue ? lastUpdated : 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'npv',
      label: 'NPV @ 12%',
      value: canDisplayValue ? formatExecutiveCurrency(snapshot.npv, currency) : 'No approved source-backed value',
      evidenceStatus: canDisplayValue ? outputStatus : 'To Verify',
      sourceLabel: canDisplayValue ? sourceLabel : 'No approved financial model',
      lastUpdated: canDisplayValue ? lastUpdated : 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'payback',
      label: 'Payback Period',
      value: canDisplayValue && snapshot.paybackYear ? `Year ${snapshot.paybackYear}` : 'No approved source-backed value',
      evidenceStatus: canDisplayValue && snapshot.paybackYear ? outputStatus : 'To Verify',
      sourceLabel: canDisplayValue && snapshot.paybackYear ? sourceLabel : 'No approved financial model',
      lastUpdated: canDisplayValue && snapshot.paybackYear ? lastUpdated : 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'profitabilityIndex',
      label: 'Profitability Index',
      value: 'No approved source-backed value',
      evidenceStatus: 'To Verify',
      sourceLabel: 'Not calculated yet',
      lastUpdated: 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'revenueTarget',
      label: 'Revenue Target',
      value: canDisplayValue ? formatExecutiveCurrency(snapshot.yearOneRevenue, currency) : 'No approved source-backed value',
      evidenceStatus: canDisplayValue ? outputStatus : 'To Verify',
      sourceLabel: canDisplayValue ? sourceLabel : 'No approved financial model',
      lastUpdated: canDisplayValue ? lastUpdated : 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'capacity',
      label: 'EQ Capacity MT/YR',
      value: 'No approved capacity evidence',
      evidenceStatus: 'To Verify',
      sourceLabel: 'No source-backed capacity record',
      lastUpdated: 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'blendedAsp',
      label: 'Blended ASP/MT',
      value: 'No approved ASP evidence',
      evidenceStatus: 'To Verify',
      sourceLabel: 'No source-backed ASP record',
      lastUpdated: 'Not available',
      nextUpdate,
      sensitive: true,
    },
    {
      key: 'fiveYearRoi',
      label: '5-Year ROI',
      value: canDisplayValue ? formatExecutiveRoiFromMoic(snapshot.investorMoic) : 'No approved source-backed value',
      evidenceStatus: canDisplayValue && snapshot.investorMoic ? outputStatus : 'To Verify',
      sourceLabel: canDisplayValue && snapshot.investorMoic ? sourceLabel : 'Not calculated yet',
      lastUpdated: canDisplayValue && snapshot.investorMoic ? lastUpdated : 'Not available',
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
    value: 'Source-backed quote required',
    evidenceStatus: 'To Verify',
    sourceLabel: 'No source-backed line-item record',
  }))
}

export function marketClaimValue(claim: MarketClaim | null | undefined): string {
  if (!claim?.value?.trim()) return 'No source-backed claim captured yet'
  return claim.value.trim()
}

export function marketClaimSourceLabel(claim: MarketClaim | null | undefined): string {
  if (!claim?.source?.title?.trim()) return 'Source search running'
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
