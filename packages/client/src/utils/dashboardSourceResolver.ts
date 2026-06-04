import type {
  CompetitorIntelligenceRecord,
  DataRoomSourceRecord,
  FeasibilityIntelligenceState,
  ResearchReviewDashboardTargetGroup,
} from '@/composables/useFeasibilityIntelligence'
import {
  normalizedMarketClaimStatus,
  sourceIsUsable,
  type IntelligenceEvidenceStatus,
  type MarketClaim,
  type SourceReference,
} from '@/utils/investorIntelligence'

export type SourceBackedDashboardRecordType = 'marketClaim' | 'dataRoomSource' | 'competitor'

export interface SourceBackedDashboardRecord {
  id: string
  label: string
  value: string
  source: SourceReference
  evidenceStatus: IntelligenceEvidenceStatus
  recordType: SourceBackedDashboardRecordType
  dashboardGroup: ResearchReviewDashboardTargetGroup
  original: MarketClaim | DataRoomSourceRecord | CompetitorIntelligenceRecord
}

export interface DashboardSourceTarget {
  group: ResearchReviewDashboardTargetGroup
  fields: string[]
}

const SOURCE_BACKED_STATUSES = new Set<IntelligenceEvidenceStatus>([
  'Verified',
  'Source-backed',
  'Official Data',
  'Trusted Source Auto-Updated',
  'Supplier Evidence',
])

const COMPETITOR_AGGREGATE_FIELDS = new Set([
  normalizeDashboardField('Competitors Profiled'),
  normalizeDashboardField('Competitor Landscape Table'),
  normalizeDashboardField('Source Coverage / Confidence'),
])
const COMPETITOR_MARKET_SHARE_FIELD = normalizeDashboardField('Market Share Chart')

export function normalizeDashboardField(value: string): string {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function dashboardFieldMatches(value: string, fields: string[]): boolean {
  const normalizedValue = normalizeDashboardField(value)
  if (!normalizedValue) return false
  return fields.some(field => {
    const normalizedField = normalizeDashboardField(field)
    return normalizedValue === normalizedField ||
      normalizedValue.startsWith(`${normalizedField} `) ||
      normalizedValue.endsWith(` ${normalizedField}`)
  })
}

export function hasSourceBackedDashboardStatus(status?: string | null): boolean {
  return SOURCE_BACKED_STATUSES.has(String(status || '').trim() as IntelligenceEvidenceStatus)
}

function sourceBackedSource(source?: SourceReference | null): SourceReference | null {
  return sourceIsUsable(source) ? source! : null
}

function sourceBackedMarketClaim(claim: MarketClaim): boolean {
  return Boolean(sourceBackedSource(claim.source) && hasSourceBackedDashboardStatus(normalizedMarketClaimStatus(claim)))
}

function sourceBackedDataRoomSource(record: DataRoomSourceRecord): boolean {
  return Boolean(sourceBackedSource(record.source) && hasSourceBackedDashboardStatus(record.evidenceStatus))
}

function sourceBackedCompetitor(record: CompetitorIntelligenceRecord): boolean {
  return Boolean(sourceBackedSource(record.source) && hasSourceBackedDashboardStatus(record.evidenceStatus))
}

function targetFieldsForGroup(targets: DashboardSourceTarget[], group: ResearchReviewDashboardTargetGroup): string[] {
  return targets
    .filter(target => target.group === group)
    .flatMap(target => target.fields)
}

function anyDashboardFieldMatches(values: Array<string | undefined>, fields: string[]): boolean {
  return values.some(value => value ? dashboardFieldMatches(value, fields) : false)
}

function competitorMatchesDashboardFields(record: CompetitorIntelligenceRecord, fields: string[]): boolean {
  const normalizedFields = new Set(fields.map(normalizeDashboardField))
  if ([...normalizedFields].some(field => COMPETITOR_AGGREGATE_FIELDS.has(field))) return true
  return normalizedFields.has(COMPETITOR_MARKET_SHARE_FIELD) && Boolean(record.marketShare?.trim())
}

function competitorValueForDashboardFields(record: CompetitorIntelligenceRecord, fields: string[]): string {
  const normalizedFields = new Set(fields.map(normalizeDashboardField))
  if (normalizedFields.has(COMPETITOR_MARKET_SHARE_FIELD) && record.marketShare?.trim()) return record.marketShare.trim()
  return record.productEquivalent || record.notes || 'Source-backed competitor profile'
}

export function resolveSourceBackedDashboardRecords(
  state: Pick<FeasibilityIntelligenceState, 'marketClaims' | 'dataRoomSources' | 'competitors'>,
  targets: DashboardSourceTarget[],
): SourceBackedDashboardRecord[] {
  const marketFields = targetFieldsForGroup(targets, 'marketClaims')
  const competitorFields = targetFieldsForGroup(targets, 'competitorRecords')
  const dataRoomTargets = targets.filter(target => target.group !== 'marketClaims' && target.group !== 'competitorRecords')

  return [
    ...state.marketClaims
      .filter(claim =>
        marketFields.length > 0 &&
        sourceBackedMarketClaim(claim) &&
        anyDashboardFieldMatches([claim.proposedDashboardField, claim.label, claim.fieldKey], marketFields),
      )
      .map((claim, index): SourceBackedDashboardRecord => ({
        id: claim.id || `market-${index}`,
        label: claim.label,
        value: claim.value || '',
        source: sourceBackedSource(claim.source)!,
        evidenceStatus: normalizedMarketClaimStatus(claim),
        recordType: 'marketClaim',
        dashboardGroup: 'marketClaims',
        original: claim,
      })),
    ...state.dataRoomSources
      .filter(record =>
        sourceBackedDataRoomSource(record) &&
        dataRoomTargets.some(target =>
          record.dashboardGroup === target.group &&
          anyDashboardFieldMatches([record.proposedDashboardField, record.checklistLabel, record.fieldKey], target.fields),
        ),
      )
      .map((record): SourceBackedDashboardRecord => ({
        id: record.id,
        label: record.checklistLabel,
        value: record.proposedValue || record.notes || record.checklistLabel,
        source: sourceBackedSource(record.source)!,
        evidenceStatus: record.evidenceStatus,
        recordType: 'dataRoomSource',
        dashboardGroup: record.dashboardGroup as ResearchReviewDashboardTargetGroup,
        original: record,
      })),
    ...state.competitors
      .filter(record => competitorFields.length > 0 && sourceBackedCompetitor(record) && competitorMatchesDashboardFields(record, competitorFields))
      .map((record): SourceBackedDashboardRecord => ({
        id: record.id,
        label: record.companyName,
        value: competitorValueForDashboardFields(record, competitorFields),
        source: sourceBackedSource(record.source)!,
        evidenceStatus: record.evidenceStatus,
        recordType: 'competitor',
        dashboardGroup: 'competitorRecords',
        original: record,
      })),
  ]
}

export function firstSourceBackedDashboardRecord(
  state: Pick<FeasibilityIntelligenceState, 'marketClaims' | 'dataRoomSources' | 'competitors'>,
  targets: DashboardSourceTarget[],
): SourceBackedDashboardRecord | null {
  return resolveSourceBackedDashboardRecords(state, targets)[0] || null
}
