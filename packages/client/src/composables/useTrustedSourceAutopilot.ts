import { computed, ref } from 'vue'
import {
  type DataRoomSourceRecord,
  type EvidenceArea,
  type FeasibilityIntelligenceState,
  type ResearchReviewFinding,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import { listCronRuns, readCronRun } from '@/api/hermes/cron-history'
import { createJob, listJobs, runJob, scheduleToDisplayText, type Job } from '@/api/hermes/jobs'
import {
  fetchDashboardAutopilotImportStatus,
} from '@/api/hermes/intelligence-state'
import { fetchAvailableModels, updateDefaultModel } from '@/api/hermes/system'
import {
  SCREEN_FIELD_MAPPINGS,
  createMissingFieldClaim,
  preferredSourceForField,
  runConnector,
  type NormalizedTrustedSourceClaim,
} from '@/utils/trustedSourceConnectors'
import {
  DEFAULT_TRUSTED_SOURCES,
  classifySourceCandidate,
  evidenceStatusForTier,
  isSensitiveAutopilotDataType,
  normalizeDomain,
  snapshotVisibility,
  sourceRequiresReview,
  type AutopilotScreen,
  type TrustedSourceCandidate,
  type TrustedSourceDataType,
  type TrustedSourceRecord,
  type TrustedSourceSnapshot,
  type TrustedSourceSnapshotClaim,
} from '@/utils/trustedSources'
import {
  buildDashboardUpdateCandidate,
  coerceDashboardConfidence,
  coerceDashboardDataType,
  coerceDashboardEvidenceStatus,
  extractDashboardResearchUpdates,
  type DashboardResearchUpdateGroup,
  type DashboardResearchUpdateItem,
} from '@/utils/dashboardAutopilotPolicy'
import type { IntelligenceEvidenceStatus, SourceReference } from '@/utils/investorIntelligence'

interface TrustedSourceAutopilotState {
  sources: TrustedSourceRecord[]
  snapshots: TrustedSourceSnapshot[]
  importedRunKeys: string[]
}

export interface ApplyTrustedSourceClaimInput {
  screen: AutopilotScreen
  label: string
  value: string
  source: SourceReference
  dataType: TrustedSourceDataType
  sensitive?: boolean
  investorApprovedImpact?: boolean
  overwriteUserApprovedAssumption?: boolean
  notes?: string
}

export interface TrustedSourceRefreshResult {
  snapshot: TrustedSourceSnapshot
  researchJobCreated: boolean
  message: string
}

export interface FullDashboardAutopilotResult {
  snapshots: TrustedSourceSnapshot[]
  researchJobCreated: boolean
  reviewItemCount: number
  message: string
}

export interface DashboardResearchImportResult {
  parsedItemCount: number
  autoFilledCount: number
  reviewItemCount: number
  snapshotCount: number
  runImported: boolean
  runKey?: string
  message: string
  errors: string[]
}

export interface FullDashboardAutopilotStatus {
  enabled: boolean
  scheduledJobId: string
  lastRun: string
  lastStatus: string
}

export interface FullDashboardAutopilotBootstrapResult {
  scheduledJobId: string
  created: boolean
  firstRunStarted: boolean
  defaultModelConfigured: boolean
  message: string
}

export interface FullDashboardServerStatus {
  scheduled: boolean
  jobId: string
  jobName: string
  schedule: string
  enabled: boolean
  state: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: string
  lastError: string
  outputCount: number
  latestOutputAt: string
  latestOutputFile: string
  importedRunCount: number
  skippedRunCount: number
  latestOutputImported: boolean
  latestOutputSkipped: boolean
  latestOutputParseStatus: 'none' | 'imported' | 'ready' | 'unparseable' | 'unreadable'
  latestOutputCandidateCount: number
  latestOutputParseError: string
  latestDueSlotAt: string
  latestDueSlotSatisfied: boolean
  latestDueSlotAttemptedAt: string
  latestDueSlotRunError: string
  dashboardRecordCount: number
  pendingReviewCount: number
  message: string
  errors: string[]
}

const STORAGE_KEY = 'hermes.trustedSourceAutopilot.v1'
export const FULL_AUTOPILOT_STATUS_KEY = 'hermes.fullDashboardAutopilot.status.v1'
export const FULL_DASHBOARD_AUTOPILOT_JOB_NAME = 'Full Dashboard Trusted Source Autopilot'
export const FULL_DASHBOARD_AUTOPILOT_SCHEDULE = '0 7,19 * * *'
export const FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION = 'dashboard-autopilot-schema-v2026-06-03-coverage-v3'
const FULL_DASHBOARD_SCREENS: AutopilotScreen[] = [
  'executive',
  'market',
  'investment',
  'competitor',
  'rawMaterials',
  'exportMarkets',
  'regulatory',
  'investorReadiness',
  'presentation',
]
const SERVER_INTELLIGENCE_STATE_JOB_ID = 'server-dashboard-intelligence-state'
const DASHBOARD_RESEARCH_GROUPS: DashboardResearchUpdateGroup[] = [
  'marketClaims',
  'competitorRecords',
  'rawMaterialSignals',
  'supplierScorecards',
  'regulatoryFindings',
  'financialEvidence',
  'evidenceGaps',
  'suggestedTasks',
  'investorMaterialCandidates',
]

const state = ref<TrustedSourceAutopilotState>({
  sources: DEFAULT_TRUSTED_SOURCES.map(source => ({ ...source })),
  snapshots: [],
  importedRunKeys: [],
})
let loaded = false
let idSequence = 0

function nowIso(): string {
  return new Date().toISOString()
}

function idFrom(prefix: string, label: string): string {
  idSequence += 1
  return `${prefix}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}-${idSequence.toString(36)}`
}

function mergeState(raw: Partial<TrustedSourceAutopilotState> | null): TrustedSourceAutopilotState {
  const defaults = DEFAULT_TRUSTED_SOURCES.map(source => ({ ...source }))
  if (!raw || typeof raw !== 'object') return { sources: defaults, snapshots: [], importedRunKeys: [] }
  const savedSources = Array.isArray(raw.sources) ? raw.sources : []
  const sourceMap = new Map(defaults.map(source => [source.source_id, source]))
  for (const source of savedSources) {
    if (!source?.source_id) continue
    const fallback = defaults.find(item => normalizeDomain(item.domain) === normalizeDomain(source.domain)) || defaults[0]
    sourceMap.set(source.source_id, { ...fallback, ...source })
  }
  return {
    sources: Array.from(sourceMap.values()),
    snapshots: Array.isArray(raw.snapshots) ? raw.snapshots.slice(0, 50) : [],
    importedRunKeys: Array.isArray(raw.importedRunKeys)
      ? raw.importedRunKeys.filter(key => typeof key === 'string').slice(0, 100)
      : [],
  }
}

function loadState(): TrustedSourceAutopilotState {
  if (typeof window === 'undefined') return { sources: DEFAULT_TRUSTED_SOURCES.map(source => ({ ...source })), snapshots: [], importedRunKeys: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return mergeState(raw ? JSON.parse(raw) : null)
  } catch {
    return { sources: DEFAULT_TRUSTED_SOURCES.map(source => ({ ...source })), snapshots: [], importedRunKeys: [] }
  }
}

function persist() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
}

function ensureLoaded() {
  if (loaded) return
  state.value = loadState()
  loaded = true
}

export function loadFullDashboardAutopilotStatus(): FullDashboardAutopilotStatus {
  if (typeof window === 'undefined') {
    return { enabled: false, scheduledJobId: '', lastRun: '', lastStatus: 'Not enabled yet' }
  }
  try {
    const raw = window.localStorage.getItem(FULL_AUTOPILOT_STATUS_KEY)
    return raw
      ? { enabled: false, scheduledJobId: '', lastRun: '', lastStatus: 'Not enabled yet', ...JSON.parse(raw) }
      : { enabled: false, scheduledJobId: '', lastRun: '', lastStatus: 'Not enabled yet' }
  } catch {
    return { enabled: false, scheduledJobId: '', lastRun: '', lastStatus: 'Not enabled yet' }
  }
}

export function persistFullDashboardAutopilotStatus(patch: Partial<FullDashboardAutopilotStatus>): FullDashboardAutopilotStatus {
  const next = { ...loadFullDashboardAutopilotStatus(), ...patch }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FULL_AUTOPILOT_STATUS_KEY, JSON.stringify(next))
  }
  return next
}

function sourceReferenceDomain(source: SourceReference): string {
  return normalizeDomain(source.url || source.title)
}

function findSourceByReference(source: SourceReference): TrustedSourceRecord | null {
  const domain = sourceReferenceDomain(source)
  const normalizedTitle = source.title.trim().toLowerCase()
  return state.value.sources.find(item =>
    item.enabled &&
    (domain && item.domain !== 'gov / regulator domains' && item.domain !== 'company official domains' && item.domain !== 'uploaded supplier evidence'
      ? domain.endsWith(normalizeDomain(item.domain))
      : item.name.trim().toLowerCase() === normalizedTitle),
  ) || null
}

function registerCandidate(candidate: TrustedSourceCandidate): TrustedSourceRecord {
  ensureLoaded()
  const classified = classifySourceCandidate(candidate)
  const existing = state.value.sources.find(source => normalizeDomain(source.domain) === normalizeDomain(classified.domain))
  if (existing) return existing
  const saved: TrustedSourceRecord = {
    ...classified,
    source_id: idFrom('source', classified.name),
    last_checked: null,
    last_failure: null,
  }
  state.value.sources = [saved, ...state.value.sources]
  persist()
  return saved
}

function updateSource(sourceId: string, patch: Partial<TrustedSourceRecord>): TrustedSourceRecord | null {
  ensureLoaded()
  const index = state.value.sources.findIndex(source => source.source_id === sourceId)
  if (index === -1) return null
  const updated = { ...state.value.sources[index], ...patch }
  state.value.sources = [
    ...state.value.sources.slice(0, index),
    updated,
    ...state.value.sources.slice(index + 1),
  ]
  persist()
  return updated
}

function latestClaim(screen: AutopilotScreen, label: string): TrustedSourceSnapshotClaim | null {
  for (const snapshot of state.value.snapshots) {
    if (snapshot.screen !== screen) continue
    const match = snapshot.claims.find(claim => claim.label.toLowerCase() === label.toLowerCase())
    if (match) return match
  }
  return null
}

function claimFromNormalized(claim: NormalizedTrustedSourceClaim): TrustedSourceSnapshotClaim {
  const sourceRecord = state.value.sources.find(source => source.source_id === claim.source_id) || null
  const update = buildDashboardUpdateCandidate({
    screen: claim.screen,
    field: claim.field,
    value: claim.value,
    source: {
      title: claim.source_name,
      url: claim.source_url,
      date: claim.source_date,
    },
    sourceId: claim.source_id,
    fetchedAt: claim.fetched_at,
    evidenceStatus: claim.evidence_status,
    confidence: claim.confidence,
    reviewRequired: claim.review_required,
    dataType: claim.data_type,
    sensitive: claim.sensitive,
  }, sourceRecord)
  return {
    id: claim.claim_id,
    fieldKey: update.fieldKey,
    label: claim.field,
    value: claim.value,
    evidenceStatus: claim.evidence_status,
    confidence: claim.confidence,
    source: {
      title: claim.source_name,
      url: claim.source_url,
      date: claim.source_date,
    },
    sourceTier: update.sourceTier,
    sourceTierLabel: update.sourceTierLabel,
    lastChecked: update.lastChecked,
    riskReason: update.riskReason,
    dataType: claim.data_type,
    reviewRequired: update.reviewRequired,
    sensitive: update.sensitive,
    notes: [
      claim.notes,
      `Method: ${claim.method}`,
      `Fetched at: ${claim.fetched_at}`,
      claim.unit ? `Unit: ${claim.unit}` : '',
      `Dashboard field: ${update.fieldKey}`,
      `Autopilot action: ${update.action}`,
      `Risk reason: ${update.riskReason}`,
    ].filter(Boolean).join('\n'),
  }
}

function normalizedInternalClaim(input: {
  screen: AutopilotScreen
  field: string
  value: string
  evidenceStatus: IntelligenceEvidenceStatus
  confidence?: 'low' | 'medium' | 'high'
  sourceName: string
  sourceUrl?: string
  sourceDate?: string
  dataType: TrustedSourceDataType
  notes: string
  sensitive?: boolean
}): NormalizedTrustedSourceClaim {
  const fetchedAt = nowIso()
  return {
    claim_id: idFrom('claim', `${input.screen}-${input.field}`),
    screen: input.screen,
    field: input.field,
    value: input.value,
    source_id: 'internal-hermes-workspace',
    source_name: input.sourceName,
    source_url: input.sourceUrl,
    source_date: input.sourceDate || fetchedAt.slice(0, 10),
    fetched_at: fetchedAt,
    evidence_status: input.evidenceStatus,
    confidence: input.confidence || 'medium',
    method: 'internal',
    notes: input.notes,
    review_required: input.evidenceStatus === 'To Verify' || input.evidenceStatus === 'Missing' || input.evidenceStatus === 'Derived from Assumptions',
    data_type: input.dataType,
    sensitive: input.sensitive,
  }
}

function internalClaimForField(screen: AutopilotScreen, field: string): NormalizedTrustedSourceClaim | null {
  const intelligence = useFeasibilityIntelligence()
  const financial = intelligence.latestFinancialModel.value
  const stateValue = intelligence.state.value
  if ((screen === 'executive' || screen === 'investment') && financial) {
    const sourceName = financial.source?.title || 'IRR Calculator saved scenario'
    const sourceUrl = financial.source?.url
    const sourceDate = financial.source?.date || financial.createdAt.slice(0, 10)
    const financeValues: Record<string, string> = {
      'Revenue Target': `${financial.currency} ${financial.yearOneRevenue.toLocaleString()}`,
      'Projected IRR': financial.irr === null ? 'To Verify' : `${financial.irr.toFixed(2)}%`,
      'Payback Period': financial.paybackYear === null ? 'To Verify' : `${financial.paybackYear.toFixed(1)} years`,
      'NPV @ 12%': `${financial.currency} ${financial.npv.toLocaleString()}`,
      'Total Investment': `${financial.currency} ${financial.capexTotal.toLocaleString()}`,
      'Project IRR': financial.irr === null ? 'To Verify' : `${financial.irr.toFixed(2)}%`,
      'Profitability Index': 'Derived from Assumptions',
      '5-Year ROI': 'Derived from Assumptions',
      'Investment Breakdown': 'Derived from saved IRR scenario',
    }
    if (financeValues[field]) {
      return normalizedInternalClaim({
        screen,
        field,
        value: financeValues[field],
        evidenceStatus: 'Derived from Assumptions',
        sourceName,
        sourceUrl,
        sourceDate,
        dataType: 'financial_data',
        notes: 'Internal financial model output. It is not pulled from external web data and remains Derived from Assumptions until reviewed.',
        sensitive: true,
      })
    }
  }
  if (screen === 'executive') {
    const executiveValues: Record<string, string> = {
      'Hermes Daily Brief': `${intelligence.state.value.researchFindings.length} research results, ${intelligence.state.value.researchJobs.length} research jobs, ${intelligence.state.value.dataRoomSources.length} data-room sources`,
      'Today’s Priorities': intelligence.evidenceGaps.value.slice(0, 3).map(item => item.label).join('; ') || 'No activity / To Verify',
      'Top Risk': intelligence.riskRegisterItems.value.slice(0, 2).map(item => `${item.title} - ${item.evidenceStatus}`).join('; ') || 'Missing / To Verify',
    }
    if (executiveValues[field]) {
      return normalizedInternalClaim({
        screen,
        field,
        value: executiveValues[field],
        evidenceStatus: 'Reference Only',
        confidence: 'medium',
        sourceName: 'Hermes internal workspace activity',
        dataType: 'internal_activity',
        notes: 'Generated from local Hermes activity, tasks, research jobs, memory-safe summaries, and readiness evidence.',
      })
    }
  }
  if (screen === 'market') {
    const claim = stateValue.marketClaims.find(item => {
      const text = `${item.label} ${item.value || ''}`.toLowerCase()
      return field.toLowerCase().split(/\s+|\/|-/).some(part => part.length > 3 && text.includes(part))
    })
    if (claim?.value) {
      return normalizedInternalClaim({
        screen,
        field,
        value: claim.value,
        evidenceStatus: claim.evidenceStatus,
        confidence: claim.confidence || 'low',
        sourceName: claim.source?.title || 'Saved Market Intelligence claim',
        sourceUrl: claim.source?.url,
        sourceDate: claim.source?.date || claim.lastChecked,
        dataType: 'market_size',
        notes: 'Loaded from saved Market Intelligence claim. Unsourced claims remain To Verify.',
      })
    }
  }
  if (screen === 'competitor') {
    const competitors = stateValue.competitors
    if (field === 'Competitors Profiled') {
      return normalizedInternalClaim({
        screen,
        field,
        value: competitors.length ? String(competitors.length) : 'Missing / To Verify',
        evidenceStatus: competitors.length ? 'Reference Only' : 'To Verify',
        sourceName: 'Competitor Intelligence records',
        dataType: 'competitor_data',
        notes: 'Count of local competitor records. It is a workspace status, not market share.',
      })
    }
    if (field === 'Source Coverage / Confidence') {
      const sourced = competitors.filter(item => item.source?.title && (item.source.url || item.source.date)).length
      return normalizedInternalClaim({
        screen,
        field,
        value: competitors.length ? `${sourced}/${competitors.length} records sourced` : 'Missing / To Verify',
        evidenceStatus: sourced ? 'Reference Only' : 'To Verify',
        sourceName: 'Competitor Intelligence records',
        dataType: 'competitor_data',
        notes: 'Source coverage summary. Market share remains To Verify unless source-backed.',
      })
    }
  }
  if (screen === 'rawMaterials') {
    const supplierEvidence = stateValue.dataRoomSources.filter(item =>
      item.dashboardGroup === 'supplierScorecards' ||
      item.dashboardGroup === 'rawMaterialSignals' ||
      /supplier|quote|stearic|tea|triethanolamine|dms|dimethyl|pdms|silicone|sds|tds|coa/i.test(`${item.checklistLabel} ${item.notes || ''} ${item.proposedValue || ''}`),
    )
    const materialText = supplierEvidence.map(item => `${item.checklistLabel} ${item.proposedValue || ''} ${item.notes || ''}`).join(' ').toLowerCase()
    const hasFieldMatch = field.toLowerCase().split(/\s+|\/|-/).some(part => part.length > 3 && materialText.includes(part))
    if (field === 'Supplier Scorecards' || field === 'SDS / TDS / COA Evidence' || hasFieldMatch) {
      return normalizedInternalClaim({
        screen,
        field,
        value: supplierEvidence.length ? `${supplierEvidence.length} supplier/raw-material evidence candidates` : 'Missing / To Verify',
        evidenceStatus: supplierEvidence.length ? 'Reference Only' : 'To Verify',
        confidence: supplierEvidence.length ? 'medium' : 'low',
        sourceName: 'Raw Material Sourcing evidence records',
        dataType: field.includes('SDS') || field.includes('TDS') || field.includes('COA') ? 'document_evidence' : 'supplier_quote',
        notes: 'Local supplier/raw-material evidence summary. Supplier prices and quotes stay sensitive and require review.',
        sensitive: !field.includes('SDS') && !field.includes('TDS') && !field.includes('COA'),
      })
    }
  }
  if (screen === 'exportMarkets') {
    const exportClaims = stateValue.marketClaims.filter(item =>
      /country|export|import|trade|consumption|hs code|growth/i.test(`${item.label} ${item.value || ''}`),
    )
    const matchingClaim = exportClaims.find(item => {
      const text = `${item.label} ${item.value || ''}`.toLowerCase()
      return field.toLowerCase().split(/\s+|\/|-/).some(part => part.length > 3 && text.includes(part))
    })
    if (matchingClaim?.value || field === 'Export Evidence Gaps') {
      return normalizedInternalClaim({
        screen,
        field,
        value: matchingClaim?.value || (exportClaims.length ? `${exportClaims.length} export/trade claims saved` : 'Missing / To Verify'),
        evidenceStatus: matchingClaim?.evidenceStatus || (exportClaims.length ? 'Reference Only' : 'Trade Proxy'),
        confidence: matchingClaim?.confidence || 'medium',
        sourceName: matchingClaim?.source?.title || 'Export Market Opportunity records',
        sourceUrl: matchingClaim?.source?.url,
        sourceDate: matchingClaim?.source?.date || matchingClaim?.lastChecked,
        dataType: 'trade_data',
        notes: 'Country-wise export/consumption evidence from saved market intelligence. Trade proxies stay To Verify until methodology is reviewed.',
      })
    }
  }
  if (screen === 'regulatory') {
    const regulatorySources = stateValue.dataRoomSources.filter(item =>
      item.dashboardGroup === 'regulatoryFindings' ||
      /regulatory|dms|dimethyl|sds|tds|cas|permit|approval|iech?sc|inventory|storage|transport/i.test(`${item.checklistLabel} ${item.notes || ''} ${item.proposedValue || ''}`),
    )
    if (regulatorySources.length || field.includes('SDS') || field.includes('DMS')) {
      return normalizedInternalClaim({
        screen,
        field,
        value: regulatorySources.length ? `${regulatorySources.length} regulatory evidence candidates` : 'Missing / To Verify',
        evidenceStatus: regulatorySources.length ? 'Reference Only' : 'To Verify',
        confidence: regulatorySources.length ? 'medium' : 'low',
        sourceName: 'Regulatory evidence records',
        dataType: 'regulatory_data',
        notes: 'Local regulatory evidence summary. DMS and factory chemical requirements remain review-gated.',
        sensitive: /DMS|Storage|Use|Factory/i.test(field),
      })
    }
  }
  if (screen === 'investorReadiness') {
    const factCount = stateValue.dataRoomSources.filter(item => item.evidenceStatus !== 'Missing' && item.evidenceStatus !== 'To Verify').length
    const gapCount = intelligence.evidenceGaps.value.length
    const riskCount = intelligence.riskRegisterItems.value.length
    const dataRoomCount = stateValue.dataRoomSources.length
    const readinessValues: Record<string, string> = {
      'Verified Facts Coverage': factCount ? `${factCount} source-backed or reviewed records` : 'Missing / To Verify',
      'Evidence Gaps': gapCount ? `${gapCount} open evidence gaps` : 'No open gaps recorded / To Verify',
      'Risk Register': riskCount ? `${riskCount} risk items tracked` : 'Missing / To Verify',
      'Data Room Checklist': dataRoomCount ? `${dataRoomCount} data-room/evidence records` : 'Missing / To Verify',
      'Financial Model Status': financial ? 'Derived from saved IRR scenario' : 'Missing / To Verify',
    }
    if (readinessValues[field]) {
      return normalizedInternalClaim({
        screen,
        field,
        value: readinessValues[field],
        evidenceStatus: field === 'Financial Model Status' && financial ? 'Derived from Assumptions' : factCount || gapCount || riskCount || dataRoomCount ? 'Reference Only' : 'To Verify',
        confidence: 'medium',
        sourceName: 'Investor Readiness workspace records',
        dataType: field === 'Financial Model Status' ? 'financial_data' : 'document_evidence',
        notes: 'Investor readiness status from approved/review-gated workspace records. It does not silently approve investor material.',
        sensitive: field === 'Financial Model Status',
      })
    }
  }
  if (screen === 'presentation') {
    const materialCount = stateValue.presentationMaterials.length
    const unsupportedCount = stateValue.presentationMaterials.filter(item => item.evidenceStatus === 'Missing' || item.evidenceStatus === 'To Verify').length
    const presentationValues: Record<string, string> = {
      'Approved Investor Material': materialCount ? `${materialCount} investor material candidates` : 'Missing / To Verify',
      'Presentation Snippets': materialCount ? `${materialCount} draft snippets available for review` : 'Missing / To Verify',
      'Unsupported Claims': unsupportedCount ? `${unsupportedCount} unsupported claims need proof` : 'No unsupported claims recorded / To Verify',
      'Missing Proof Tasks': intelligence.evidenceGaps.value.length ? `${intelligence.evidenceGaps.value.length} missing-proof tasks/gaps` : 'Missing / To Verify',
      'Investor Export Readiness': materialCount && !unsupportedCount ? 'Review required before export' : 'Not investor-ready yet / To Verify',
    }
    if (presentationValues[field]) {
      return normalizedInternalClaim({
        screen,
        field,
        value: presentationValues[field],
        evidenceStatus: materialCount && !unsupportedCount ? 'Reference Only' : 'To Verify',
        confidence: 'medium',
        sourceName: 'Investor Presentation Builder records',
        dataType: 'document_evidence',
        notes: 'Presentation readiness summary. Draft content stays review-gated and is not final investor truth.',
      })
    }
  }
  return null
}

function numericChangePercent(previousValue: string | undefined, nextValue: string): number | null {
  const previous = Number.parseFloat((previousValue || '').replace(/[^\d.-]/g, ''))
  const next = Number.parseFloat(nextValue.replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(previous) || !Number.isFinite(next) || previous === 0) return null
  return ((next - previous) / Math.abs(previous)) * 100
}

function createSnapshot(input: {
  screen: AutopilotScreen
  claims: TrustedSourceSnapshotClaim[]
  sourceIds: string[]
  jobId?: string
  conflicts?: string[]
  reviewRequired?: boolean
}): TrustedSourceSnapshot {
  const statuses = input.claims.map(claim => claim.evidenceStatus)
  const evidenceStatus: IntelligenceEvidenceStatus = input.conflicts?.length
    ? 'Conflict Detected'
    : statuses.includes('Trusted Source Auto-Updated')
      ? 'Trusted Source Auto-Updated'
      : statuses[0] || 'To Verify'
  const dataTypes = input.claims.map(claim => claim.dataType)
  const snapshot: TrustedSourceSnapshot = {
    snapshot_id: idFrom('snapshot', input.screen),
    screen: input.screen,
    generated_at: nowIso(),
    source_ids: input.sourceIds,
    claims: input.claims,
    evidence_status: evidenceStatus,
    confidence: input.claims.some(claim => claim.confidence === 'high') ? 'high' : input.claims.some(claim => claim.confidence === 'medium') ? 'medium' : 'low',
    changed_fields: input.claims.map(claim => claim.label),
    conflicts: input.conflicts || [],
    review_required: !!input.reviewRequired || input.claims.some(claim => claim.reviewRequired),
    job_id: input.jobId,
    user_visibility: snapshotVisibility(input.screen, dataTypes),
    redaction_rules: dataTypes.some(isSensitiveAutopilotDataType)
      ? ['Hide price, cost, supplier, formula, and financial values from employee/investor views.']
      : ['Investor viewers cannot access raw auto-updated dashboards.'],
  }
  state.value.snapshots = [snapshot, ...state.value.snapshots].slice(0, 50)
  persist()
  return snapshot
}

function sourceReferenceFromUnknown(value: unknown, fallbackTitle: string): SourceReference {
  const source = value && typeof value === 'object' ? value as Partial<SourceReference> : {}
  return {
    title: asText(source.title, fallbackTitle),
    url: asText(source.url, ''),
    date: asText(source.date, nowIso().slice(0, 10)),
  }
}

function sourceRecordForServerClaim(source: SourceReference, screen: AutopilotScreen, dataType: TrustedSourceDataType): TrustedSourceRecord {
  return findSourceByReference(source) || registerCandidate({
    name: source.title,
    url: source.url,
    dataType,
    screen,
  })
}

function screenForDashboardGroup(group?: string): AutopilotScreen {
  if (group === 'financialEvidence') return 'investment'
  if (group === 'competitorRecords') return 'competitor'
  if (group === 'marketClaims') return 'market'
  if (group === 'rawMaterialSignals' || group === 'supplierScorecards') return 'rawMaterials'
  if (group === 'regulatoryFindings') return 'regulatory'
  if (group === 'investorMaterialCandidates') return 'presentation'
  if (group === 'evidenceGaps' || group === 'suggestedTasks') return 'investorReadiness'
  return 'executive'
}

function evidenceStatusFromUnknown(value: unknown, fallback: IntelligenceEvidenceStatus = 'To Verify'): IntelligenceEvidenceStatus {
  return coerceDashboardEvidenceStatus(value, fallback)
}

function confidenceFromUnknown(value: unknown): 'low' | 'medium' | 'high' {
  return coerceDashboardConfidence(value)
}

function snapshotClaimFromServerState(input: {
  idSeed: string
  screen: AutopilotScreen
  label: string
  value: string
  source: SourceReference
  evidenceStatus: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  dataType: TrustedSourceDataType
  sensitive?: boolean
  notes?: string
  reviewRequired?: boolean
}): TrustedSourceSnapshotClaim {
  const sourceRecord = sourceRecordForServerClaim(input.source, input.screen, input.dataType)
  const update = buildDashboardUpdateCandidate({
    screen: input.screen,
    field: input.label,
    value: input.value,
    source: input.source,
    sourceId: sourceRecord.source_id,
    fetchedAt: input.source.date || nowIso(),
    evidenceStatus: input.evidenceStatus,
    confidence: input.confidence,
    reviewRequired: input.reviewRequired,
    dataType: input.dataType,
    sensitive: input.sensitive,
  }, sourceRecord)

  return {
    id: `server-${input.idSeed}`,
    fieldKey: update.fieldKey,
    label: input.label,
    value: input.value,
    evidenceStatus: input.evidenceStatus,
    confidence: update.confidence,
    source: input.source,
    sourceTier: update.sourceTier,
    sourceTierLabel: update.sourceTierLabel,
    lastChecked: update.lastChecked,
    riskReason: update.riskReason,
    dataType: input.dataType,
    reviewRequired: update.reviewRequired,
    sensitive: update.sensitive,
    notes: [
      input.notes,
      'Hydrated from durable dashboard intelligence state.',
      `Autopilot action: ${update.action}`,
      `Risk reason: ${update.riskReason}`,
    ].filter(Boolean).join('\n'),
  }
}

function buildServerStateSnapshot(
  screen: AutopilotScreen,
  claims: TrustedSourceSnapshotClaim[],
): TrustedSourceSnapshot | null {
  if (!claims.length) return null
  const generatedAt = nowIso()
  const sourceIds = claims
    .map(claim => findSourceByReference(claim.source)?.source_id || '')
    .filter(Boolean)
  return {
    snapshot_id: `server-${screen}-${claims.map(claim => claim.id).join('-').slice(0, 80)}`,
    screen,
    generated_at: generatedAt,
    source_ids: Array.from(new Set(sourceIds)),
    claims,
    evidence_status: claims.some(claim => claim.reviewRequired) ? 'To Verify' : claims[0].evidenceStatus,
    confidence: claims.some(claim => claim.confidence === 'high') ? 'high' : claims.some(claim => claim.confidence === 'medium') ? 'medium' : 'low',
    changed_fields: claims.map(claim => claim.label),
    conflicts: [],
    review_required: claims.some(claim => claim.reviewRequired),
    job_id: SERVER_INTELLIGENCE_STATE_JOB_ID,
    user_visibility: snapshotVisibility(screen, claims.map(claim => claim.dataType)),
    redaction_rules: claims.some(claim => claim.sensitive)
      ? ['Hide price, cost, supplier, formula, financial, regulatory, and product-development values from restricted roles.']
      : ['Investor viewers cannot access raw auto-updated dashboards.'],
  }
}

function claimsFromDurableIntelligenceState(intelligenceState: FeasibilityIntelligenceState): Map<AutopilotScreen, TrustedSourceSnapshotClaim[]> {
  const claimsByScreen = new Map<AutopilotScreen, TrustedSourceSnapshotClaim[]>()
  const addClaim = (screen: AutopilotScreen, claim: TrustedSourceSnapshotClaim) => {
    const list = claimsByScreen.get(screen) || []
    claimsByScreen.set(screen, [...list, claim])
  }

  for (const item of intelligenceState.marketClaims.slice(0, 12)) {
    addClaim('market', snapshotClaimFromServerState({
      idSeed: `market-${item.id || item.label}`,
      screen: 'market',
      label: item.label,
      value: item.value || 'To Verify',
      source: sourceReferenceFromUnknown(item.source, 'Saved Market Intelligence claim'),
      evidenceStatus: evidenceStatusFromUnknown(item.evidenceStatus),
      confidence: confidenceFromUnknown(item.confidence),
      dataType: item.label.toLowerCase().includes('trade') || item.value?.toLowerCase().includes('trade proxy') ? 'trade_data' : 'market_size',
      notes: 'Server-persisted market claim created by dashboard workflow or Full Dashboard Autopilot.',
    }))
  }

  for (const item of intelligenceState.competitors.slice(0, 12)) {
    addClaim('competitor', snapshotClaimFromServerState({
      idSeed: `competitor-${item.id || item.companyName}`,
      screen: 'competitor',
      label: item.companyName,
      value: [
        item.productEquivalent ? `Product: ${item.productEquivalent}` : '',
        item.marketShare ? `Market share: ${item.marketShare}` : 'Market share: To Verify',
        item.pricingEvidence ? `Pricing: ${item.pricingEvidence}` : '',
      ].filter(Boolean).join('; '),
      source: sourceReferenceFromUnknown(item.source, 'Competitor Intelligence record'),
      evidenceStatus: evidenceStatusFromUnknown(item.evidenceStatus),
      confidence: 'medium',
      dataType: 'competitor_data',
      sensitive: Boolean(item.pricingEvidence?.trim() || item.marketShare?.trim()),
      notes: item.notes,
    }))
  }

  for (const item of intelligenceState.dataRoomSources.slice(0, 12) as DataRoomSourceRecord[]) {
    const dashboardGroup = item.dashboardGroup || ''
    const screen = screenForDashboardGroup(dashboardGroup)
    const dataType = coerceDashboardDataType(item.dataType, dashboardGroup === 'financialEvidence' ? 'financial_data' : dashboardGroup === 'supplierScorecards' ? 'supplier_quote' : dashboardGroup === 'regulatoryFindings' ? 'regulatory_data' : 'document_evidence')
    addClaim(screen, snapshotClaimFromServerState({
      idSeed: `source-${item.id || item.checklistLabel}`,
      screen,
      label: item.checklistLabel,
      value: item.proposedValue || item.notes || 'Source-backed evidence candidate',
      source: sourceReferenceFromUnknown(item.source, 'Dashboard data-room source'),
      evidenceStatus: evidenceStatusFromUnknown(item.evidenceStatus),
      confidence: confidenceFromUnknown(item.confidence),
      dataType,
      sensitive: dataType === 'financial_data' || dataType === 'supplier_quote' || dataType === 'regulatory_data',
      notes: item.notes,
    }))
  }

  for (const finding of intelligenceState.researchFindings.filter(item => item.status === 'Pending Review' || item.status === 'To Verify').slice(0, 12) as ResearchReviewFinding[]) {
    const target = finding.dashboardTarget
    if (!target) continue
    const screen = screenForDashboardGroup(target.group)
    const dataType = coerceDashboardDataType(target.dataType, target.group === 'financialEvidence' ? 'financial_data' : target.group === 'competitorRecords' ? 'competitor_data' : target.group === 'supplierScorecards' ? 'supplier_quote' : 'market_size')
    addClaim(screen, snapshotClaimFromServerState({
      idSeed: `finding-${finding.id || finding.keyClaim}`,
      screen,
      label: target.proposedDashboardField || target.field || finding.keyClaim,
      value: target.value || target.content || finding.summary,
      source: sourceReferenceFromUnknown(finding.source, 'Research Result Review finding'),
      evidenceStatus: evidenceStatusFromUnknown(finding.evidenceStatus),
      confidence: confidenceFromUnknown(finding.confidence),
      dataType,
      sensitive: Boolean(target.sensitive),
      notes: finding.riskNote || finding.summary,
      reviewRequired: true,
    }))
  }

  return claimsByScreen
}

function hydrateSnapshotsFromServerIntelligenceState(
  intelligenceState: FeasibilityIntelligenceState = useFeasibilityIntelligence().state.value,
): { snapshotCount: number; claimCount: number } {
  ensureLoaded()
  const claimsByScreen = claimsFromDurableIntelligenceState(intelligenceState)
  const nextSnapshots: TrustedSourceSnapshot[] = []
  let claimCount = 0

  for (const screen of FULL_DASHBOARD_SCREENS) {
    const claims = claimsByScreen.get(screen) || []
    const snapshot = buildServerStateSnapshot(screen, claims)
    if (!snapshot) continue
    nextSnapshots.push(snapshot)
    claimCount += claims.length
  }

  state.value.snapshots = [
    ...nextSnapshots,
    ...state.value.snapshots.filter(snapshot => snapshot.job_id !== SERVER_INTELLIGENCE_STATE_JOB_ID),
  ].slice(0, 50)
  persist()

  if (claimCount > 0) {
    persistFullDashboardAutopilotStatus({
      enabled: true,
      lastRun: new Date().toISOString(),
      lastStatus: `Durable server intelligence hydrated into source panels. Source-backed fields: ${claimCount}. Screens updated: ${nextSnapshots.length}.`,
    })
  }

  return {
    snapshotCount: nextSnapshots.length,
    claimCount,
  }
}

function applyTrustedSourceClaim(input: ApplyTrustedSourceClaimInput): TrustedSourceSnapshot {
  ensureLoaded()
  const intelligence = useFeasibilityIntelligence()
  const sourceRecord = findSourceByReference(input.source) || registerCandidate({
    name: input.source.title,
    url: input.source.url,
    dataType: input.dataType,
    screen: input.screen,
  })
  const previous = latestClaim(input.screen, input.label)
  const changePercent = numericChangePercent(previous?.value, input.value)
  const hasConflict = !!previous && previous.value.trim() !== input.value.trim() && previous.evidenceStatus !== 'Candidate Source'
  const largeChange = changePercent !== null && Math.abs(changePercent) >= (input.dataType === 'price_data' ? 5 : 10)
  const sensitiveVisibilityRisk = !!input.sensitive || isSensitiveAutopilotDataType(input.dataType)
  const baseReviewRequired = sourceRequiresReview(sourceRecord, {
    hasConflict,
    largeChange,
    investorApprovedImpact: input.investorApprovedImpact,
    sensitiveVisibilityRisk,
    overwritesUserApprovedAssumption: input.overwriteUserApprovedAssumption,
  })
  const evidenceStatus = evidenceStatusForTier(sourceRecord.tier, hasConflict)
  const update = buildDashboardUpdateCandidate({
    screen: input.screen,
    field: input.label,
    value: input.value,
    source: input.source,
    sourceId: sourceRecord.source_id,
    fetchedAt: nowIso(),
    evidenceStatus,
    confidence: sourceRecord.confidence_default,
    reviewRequired: baseReviewRequired,
    dataType: input.dataType,
    sensitive: sensitiveVisibilityRisk,
    hasConflict,
    largeChange,
    investorApprovedImpact: input.investorApprovedImpact,
    overwritesUserApprovedAssumption: input.overwriteUserApprovedAssumption,
  }, sourceRecord)
  const reviewRequired = update.reviewRequired
  const claim: TrustedSourceSnapshotClaim = {
    id: idFrom('claim', input.label),
    fieldKey: update.fieldKey,
    label: input.label,
    value: input.value,
    previousValue: previous?.value,
    changePercent,
    evidenceStatus,
    confidence: sourceRecord.confidence_default,
    source: input.source,
    sourceTier: update.sourceTier,
    sourceTierLabel: update.sourceTierLabel,
    lastChecked: update.lastChecked,
    riskReason: update.riskReason,
    dataType: input.dataType,
    reviewRequired,
    sensitive: update.sensitive,
    notes: [input.notes, `Dashboard field: ${update.fieldKey}`, `Autopilot action: ${update.action}`, `Risk reason: ${update.riskReason}`].filter(Boolean).join('\n'),
  }
  const snapshot = createSnapshot({
    screen: input.screen,
    claims: [claim],
    sourceIds: [sourceRecord.source_id],
    conflicts: hasConflict ? [input.label] : [],
    reviewRequired,
  })
  updateSource(sourceRecord.source_id, { last_checked: nowIso(), last_failure: null })

  if (input.screen === 'market' && !sensitiveVisibilityRisk) {
    intelligence.addMarketClaim({
      label: input.label,
      value: input.value,
      evidenceStatus,
      confidence: sourceRecord.confidence_default,
      source: input.source,
      lastChecked: nowIso().slice(0, 10),
    })
  }

  if (reviewRequired || hasConflict) {
    intelligence.addResearchFinding({
      summary: [
        `Autopilot ${hasConflict ? 'conflict' : 'review'} for ${input.label}`,
        `Proposed dashboard field: ${update.fieldKey}`,
        `Value: ${input.value}`,
        previous?.value ? `Previous value: ${previous.value}` : 'Previous value: none',
        `Source: ${input.source.title}`,
        input.source.url ? `Source URL: ${input.source.url}` : '',
        `Source tier: ${update.sourceTierLabel}`,
        `Confidence: ${sourceRecord.confidence_default}`,
        `Evidence status: ${evidenceStatus}`,
        `Risk reason: ${update.riskReason}`,
      ].join('\n'),
      keyClaim: `${hasConflict ? 'Conflict Detected' : 'Trusted source review'}: ${input.label}`,
      area: refreshAreaForScreen(input.screen),
      evidenceStatus: hasConflict ? 'Conflict Detected' : evidenceStatus,
      confidence: sourceRecord.confidence_default,
      source: input.source,
      suggestedTask: 'Review source, confidence, value change, and visibility before using in investor material.',
      riskNote: hasConflict
        ? 'Trusted sources disagree. Do not overwrite approved material automatically.'
        : 'Review required by source policy or sensitivity threshold.',
    })
  }

  return snapshot
}

function screenRefreshPrompt(screen: AutopilotScreen): string {
  const common = [
    'Owner-approved research permission: Hermes may search trusted public/company/regulatory sources and stage findings for review.',
    'Source priority: official regulator/government pages, company product pages/catalogs, filings, uploaded evidence, then reputable market-reference sources.',
    'Use only trusted or cited sources. Do not invent values.',
    'Every claim must include source title, URL or date, evidence status, confidence, and extraction date.',
    'Summarize important data visually with source matrices, Markdown tables, evidence-gap checklists, and Mermaid charts when useful.',
    'If source conflicts, unknown source, or large movement is detected, create Research Result Review item instead of approving material.',
    'Do not update investor-approved material silently.',
    'Do not mark anything Verified without source evidence and user review.',
  ]
  if (screen === 'executive') return ['Refresh Executive Overview from internal Hermes activity: sessions, Kanban, Jobs, Files, Memory-safe summaries, Research Result Review, Investor Readiness, and IRR status.', ...common].join('\n')
  if (screen === 'market') return ['Refresh Market Intelligence using official trade/statistical sources first, then market references. Label uncertain HS-code data as Trade Proxy / To Verify.', ...common].join('\n')
  if (screen === 'investment') return ['Refresh Investment Analysis from saved IRR Calculator snapshots and user/source-backed files only. Never pull IRR/NPV/payback from random web sources.', ...common].join('\n')
  if (screen === 'competitor') return ['Refresh Competitor Intelligence using official company/product pages, filings, catalogs, regulator/certification sources, and source-backed market reports. Unknown market share stays To Verify.', ...common].join('\n')
  if (screen === 'rawMaterials') return ['Refresh Raw Material Sourcing and Supplier Scorecards from uploaded supplier evidence, official company pages, SDS/TDS/COA files, and price references. Supplier prices stay review-gated.', ...common].join('\n')
  if (screen === 'exportMarkets') return ['Refresh Export Market Opportunity using official trade datasets, HS-code candidates, country-wise import/export proxies, and growth indicators. Label proxy data clearly.', ...common].join('\n')
  if (screen === 'regulatory') return ['Refresh Regulatory Intelligence using official regulator/chemical databases first. DMS, storage, transport, use, and factory chemical approval claims stay To Verify until reviewed.', ...common].join('\n')
  if (screen === 'investorReadiness') return ['Refresh Investor Readiness from approved/review-gated evidence, source coverage, risk register, data-room checklist, and financial model completeness. Never approve investor material silently.', ...common].join('\n')
  return ['Refresh Investor Presentation Builder from approved facts, approved assumptions, unsupported-claim warnings, missing-proof tasks, and source-backed snippets. Generate draft material only, not final truth.', ...common].join('\n')
}

function fullDashboardAutopilotPrompt(): string {
  const mappedFields = FULL_DASHBOARD_SCREENS
    .map(screen => {
      const fields = SCREEN_FIELD_MAPPINGS[screen].map(item => `- ${item.field}`).join('\n')
      return `${screenLabel(screen)}:\n${fields}`
    })
    .join('\n\n')

  return [
    'Full Dashboard Trusted Source Autopilot',
    `Prompt version: ${FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION}`,
    '',
    'Mission: research and refresh the Hermes feasibility intelligence dashboard automatically using trusted online sources and existing Hermes workspace evidence.',
    'Do the online research yourself using available web/search/source tools. Do not ask the user to manually search, copy, or paste source data.',
    'If external browsing/search is unavailable in the runtime, state that limitation clearly and return evidence gaps/tasks instead of fabricating data.',
    '',
    'Dashboard areas to cover:',
    mappedFields,
    '',
    'Additional research areas:',
    '- Raw Material Sourcing: TEA, DMS / dimethyl sulfate, stearic acid, PDMS silicone oil, acetic acid, ethoxylates, packaging.',
    '- Supplier Scorecards: Wilmar Oleochemicals, KLK OLEO, BASF, Dow, WACKER, DMS candidate suppliers, Bangladesh acetic acid supplier shortlist.',
    '- Export Market Opportunity: country-wise textile/chemical trade proxies, HS-code candidates, growth indicators, import/export signals.',
    '- Regulatory: SDS/TDS/CAS, DMS safety/regulatory status, China import/storage/use requirements, factory chemical approvals.',
    '- Investor Readiness: evidence gaps, source coverage, risk register, data-room checklist, presentation-ready material only when source-backed.',
    '',
    'Required coverage checklist:',
    '- Every twice-daily run must attempt every dashboard area and every JSON array group. Do not omit a group silently.',
    '- If a source-backed value cannot be found for a required target, return an evidenceGaps item and a suggestedTasks item for that target with proposedDashboardField, Missing / To Verify status, and the best trusted source to check next.',
    '- Country-wise market/consumption targets: China, Bangladesh, India, Vietnam, Pakistan, Turkey, Indonesia, EU / Germany, United States, GCC / Middle East.',
    '- Competitor targets: Evonik Industries, Stepan Company, Kao Corporation, WACKER, Rudolf Group, CHT Group, Archroma, Transfar, Zschimmer & Schwarz, Pulcra Chemicals, Syensqo / Solvay, and any source-backed China/Bangladesh/Vietnam local competitors.',
    '- Supplier/raw-material targets: stearic acid, triethanolamine / TEA, dimethyl sulfate / DMS, PDMS silicone oil, acetic acid, ethoxylates, packaging, Wilmar, KLK OLEO, BASF, Dow, WACKER, DMS candidate suppliers, and local Bangladesh suppliers.',
    '- Regulatory targets: DMS safety/regulatory status, SDS/TDS/CAS evidence, China chemical import/storage/transport/use requirements, factory chemical approvals, and IECSC/China chemical inventory references when relevant.',
    '- Financial/investment targets: Lean/Base/Conservative/Aggressive scenarios, total investment, IRR, NPV, payback, ROI, working capital, capex breakdown, and sensitivity gaps. External web sources cannot verify IRR/NPV; use only approved internal scenarios or mark Derived from Assumptions / To Verify.',
    '- Investor material targets: approved facts, approved assumptions, missing proof, risk register items, data-room gaps, and presentation snippets. Never mark investor material approved without review.',
    '',
    'Trusted source priority:',
    '1. Official government/regulator/statistical/trade/price-index/company-filing sources: UN Comtrade, ITC, World Bank, WTO, OECD, U.S. BLS PPI, SEC EDGAR Company Facts, China Customs/NBS/MOFCOM/MEE/MEM/MIIT, ECHA, PubChem, EPA CompTox, NITE.',
    '2. Official company/product pages and catalogs: BASF, Dow, WACKER, Wilmar, KLK OLEO, Evonik, Stepan, Kao, CHT, Archroma, Transfar, Zschimmer & Schwarz, Pulcra.',
    '3. Supplier evidence: uploaded quotes, PI, invoice, TDS, SDS, COA, email quote, distributor letter.',
    '4. Market references and price references: ICIS, Argus, S&P Global, SunSirs, ECHEMI, ChemAnalyst, Trade Map. Treat as market reference, not final procurement truth.',
    '5. Public listings such as Alibaba/Made-in-China are weak references only and must stay Reference Only / To Verify.',
    '',
    'Output requirements:',
    '- Produce a concise executive summary plus structured sections for each dashboard area.',
    '- Use Markdown tables, source matrices, evidence-gap tables, and Mermaid charts where useful.',
    '- Every claim must include: value, source title, URL or publication/access date, source tier, confidence, evidence status, and last checked date.',
    '- Mark missing values as Missing / To Verify.',
    '- Mark trade proxies as Trade Proxy / To Verify until HS code methodology is reviewed.',
    '- Mark financial outputs as Derived from Assumptions unless they come from an approved internal IRR scenario.',
    '- Mark supplier prices, payment terms, quality scores, and reliability scores as To Verify unless quote/TDS/SDS/COA evidence is attached.',
    '- Mark competitor market share as To Verify unless the source explicitly supports it.',
    '- Separate Verified, Official Data, Source-backed, Market Reference, Supplier Evidence, Reference Only, Assumption, Derived from Assumptions, and To Verify.',
    '',
    'Machine-readable dashboard_updates schema:',
    '- Put the appendix in one fenced ```json block. The top-level object must be: { "dashboard_updates": { ... } }.',
    '- Each item should include fieldKey when known, field/title/label, value, sourceTitle, sourceUrl or sourceDate, sourceTier, lastChecked, confidence, evidenceStatus, reviewRequired, riskReason, dataType, and sensitive when applicable.',
    '- For missing checklist targets, include proposedDashboardField and recommendedAction so Research Result Review and Kanban can show exactly what still needs evidence.',
    '- Use these arrays only: marketClaims, competitorRecords, rawMaterialSignals, supplierScorecards, regulatoryFindings, financialEvidence, evidenceGaps, suggestedTasks, investorMaterialCandidates.',
    '- For country-wise growth/consumption, use marketClaims with field or label like "Country-wise consumption growth - <country/region>" and keep the value To Verify when the source is only a proxy.',
    '- For supplier scorecards, use supplierScorecards with supplier, material, value, sourceTitle, sourceUrl/sourceDate, confidence, evidenceStatus, and reviewRequired.',
    '- For competitor analysis, use competitorRecords with companyName, countryRegion, productEquivalent, activeContent, pricingEvidence, certifications, distributionPresence, marketShare, sourceTitle, sourceUrl/sourceDate, confidence, evidenceStatus, and reviewRequired.',
    '- If the JSON appendix fails, still include source-backed Markdown tables with Field/Value/Source Title/Source URL/Source Tier/Confidence/Evidence Status/Review Required columns.',
    '- If tables are not possible, use source-backed delimited bullets such as: Field: Country-wise consumption growth - China | Value: Trade proxy found | Source: [WITS / World Bank Comtrade](https://wits.worldbank.org/) | Source Tier: Tier 1 - Official / regulator / trade source | Evidence Status: Official Data | Confidence: high | Review Required: yes.',
    '- Do not output unsupported plain numbers without source metadata; unstructured or unsourced output will be ignored by the dashboard importer.',
    '',
    'Safety rules:',
    '- Do not invent market size, growth rate, consumption, pricing, supplier score, market share, IRR, NPV, payback, formula, CAS list, or regulatory status.',
    '- Do not treat paid reports, public listings, or unsourced web snippets as verified facts.',
    '- Do not expose formulas, raw material ratios, supplier confidential pricing, investor terms, product-development secrets, API keys, or system secrets.',
    '- Do not silently approve investor material.',
    '- Dashboard updates should be review-ready. Unsupported or sensitive findings go to Research Result Review before they become investor-approved truth.',
    '',
    'Preferred machine-readable appendix:',
    'Return a JSON block named dashboard_updates with arrays: marketClaims, competitorRecords, rawMaterialSignals, supplierScorecards, regulatoryFindings, financialEvidence, evidenceGaps, suggestedTasks, investorMaterialCandidates.',
  ].join('\n')
}

function fullDashboardJobId(job: Job): string {
  return job.job_id || job.id
}

function isFullDashboardAutopilotJob(job: Job): boolean {
  return job.name === FULL_DASHBOARD_AUTOPILOT_JOB_NAME ||
    (job.prompt || '').includes('Full Dashboard Trusted Source Autopilot')
}

function recordFullDashboardResearchJob(jobId: string) {
  const intelligence = useFeasibilityIntelligence()
  const alreadyRecorded = intelligence.state.value.researchJobs.some(job =>
    job.scheduledJobId === jobId || job.title === FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
  )
  if (alreadyRecorded) return

  intelligence.addResearchJob({
    title: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
    question: 'Automatically research trusted online sources and existing evidence to refresh the whole dashboard.',
    scope: 'Executive Overview, Market Intelligence, Competitor Intelligence, Investment Analysis, Raw Material Sourcing, Supplier Scorecards, Export Markets, Regulatory, Investor Readiness, and Presentation Builder inputs.',
    expectedOutput: 'Source-backed dashboard update candidates, evidence gaps, suggested tasks, and review-ready investor material candidates.',
    sourceRequirements: 'Every value needs source title plus URL/date and evidence status. Missing, conflicting, sensitive, or weak-source claims remain To Verify or go to Research Result Review.',
    priority: 'high',
    schedulePreference: 'Custom',
    scheduledJobId: jobId,
    schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    context: 'Chemicon China Feasibility',
    status: 'Scheduled Hermes Job',
  })
}

async function ensureDefaultModelForAutopilot(): Promise<{ configured: boolean; model: string; provider: string }> {
  const models = await fetchAvailableModels()
  if (models.default?.trim()) {
    return { configured: false, model: models.default.trim(), provider: models.default_provider || '' }
  }

  const fallbackGroup = (models.groups || []).find(group => group.models.length > 0) ||
    (models.allProviders || []).find(group => group.models.length > 0)
  const model = fallbackGroup?.models[0] || ''
  const provider = fallbackGroup?.provider || ''
  if (!model) {
    throw new Error('No available Hermes model is configured for Full Dashboard Autopilot')
  }

  await updateDefaultModel({ default: model, provider })
  return { configured: true, model, provider }
}

function refreshDataTypeForScreen(screen: AutopilotScreen): TrustedSourceDataType {
  if (screen === 'executive') return 'internal_activity'
  if (screen === 'investment') return 'financial_data'
  if (screen === 'competitor') return 'competitor_data'
  if (screen === 'rawMaterials') return 'supplier_quote'
  if (screen === 'exportMarkets') return 'trade_data'
  if (screen === 'regulatory') return 'regulatory_data'
  if (screen === 'investorReadiness' || screen === 'presentation') return 'document_evidence'
  return 'market_size'
}

function refreshAreaForScreen(screen: AutopilotScreen): EvidenceArea {
  if (screen === 'investment') return 'financial'
  if (screen === 'rawMaterials') return 'factory'
  if (screen === 'regulatory') return 'regulatory'
  if (screen === 'investorReadiness' || screen === 'presentation' || screen === 'executive') return 'presentation'
  return 'market'
}

function refreshIsSensitive(screen: AutopilotScreen): boolean {
  return screen === 'investment' || screen === 'rawMaterials' || screen === 'regulatory'
}

function createRefreshSnapshot(screen: AutopilotScreen, jobId?: string): TrustedSourceRefreshResult {
  ensureLoaded()
  const intelligence = useFeasibilityIntelligence()
  const internalSource: SourceReference = {
    title: screen === 'executive' ? 'Hermes internal workspace activity' : 'Trusted Source Autopilot refresh job',
    date: nowIso().slice(0, 10),
  }
  const source = registerCandidate({
    name: internalSource.title,
    domain: screen === 'executive' ? 'internal.hermes.local' : 'scheduled.hermes.local',
    dataType: refreshDataTypeForScreen(screen),
    screen,
  })
  const refreshEvidenceStatus: IntelligenceEvidenceStatus = screen === 'executive' ? 'Reference Only' : 'To Verify'
  const refreshDataType = refreshDataTypeForScreen(screen)
  const update = buildDashboardUpdateCandidate({
    screen,
    field: `${screenLabel(screen)} refresh status`,
    value: jobId ? 'Scheduled Hermes Job' : 'Task fallback',
    source: internalSource,
    sourceId: source.source_id,
    fetchedAt: nowIso(),
    evidenceStatus: refreshEvidenceStatus,
    confidence: screen === 'executive' ? 'medium' : 'low',
    reviewRequired: screen !== 'executive',
    dataType: refreshDataType,
    sensitive: refreshIsSensitive(screen),
  }, source)
  const claim: TrustedSourceSnapshotClaim = {
    id: idFrom('claim', `${screen}-refresh`),
    fieldKey: update.fieldKey,
    label: `${screenLabel(screen)} refresh status`,
    value: jobId ? 'Scheduled Hermes Job' : 'Task fallback',
    evidenceStatus: refreshEvidenceStatus,
    confidence: screen === 'executive' ? 'medium' : 'low',
    source: internalSource,
    sourceTier: update.sourceTier,
    sourceTierLabel: update.sourceTierLabel,
    lastChecked: update.lastChecked,
    riskReason: update.riskReason,
    dataType: refreshDataType,
    reviewRequired: update.reviewRequired,
    sensitive: update.sensitive,
    notes: [screenRefreshPrompt(screen), `Dashboard field: ${update.fieldKey}`, `Autopilot action: ${update.action}`, `Risk reason: ${update.riskReason}`].join('\n'),
  }
  const snapshot = createSnapshot({
    screen,
    claims: [claim],
    sourceIds: [source.source_id],
    jobId,
    reviewRequired: claim.reviewRequired,
  })
  if (claim.reviewRequired) {
    intelligence.addResearchFinding({
      summary: [
        `${screenLabel(screen)} trusted-source refresh needs review.`,
        `Refresh status: ${claim.value}`,
        `Source: ${internalSource.title}`,
        'No dashboard facts were marked verified automatically.',
      ].join('\n'),
      keyClaim: `${screenLabel(screen)} trusted-source refresh needs review`,
      area: refreshAreaForScreen(screen),
      evidenceStatus: 'To Verify',
      confidence: claim.confidence,
      source: internalSource,
      suggestedTask: 'Review trusted source refresh output and attach source-backed values before investor use.',
      riskNote: 'Autopilot refresh does not approve facts or overwrite investor-approved material.',
    })
  }
  return {
    snapshot,
    researchJobCreated: !!jobId,
    message: jobId ? 'Trusted source refresh job scheduled' : 'Trusted source refresh fallback recorded',
  }
}

function reviewLineForNormalizedClaim(claim: NormalizedTrustedSourceClaim): string {
  const sourceRecord = state.value.sources.find(source => source.source_id === claim.source_id) || null
  const update = buildDashboardUpdateCandidate({
    screen: claim.screen,
    field: claim.field,
    value: claim.value,
    source: {
      title: claim.source_name,
      url: claim.source_url,
      date: claim.source_date,
    },
    sourceId: claim.source_id,
    fetchedAt: claim.fetched_at,
    evidenceStatus: claim.evidence_status,
    confidence: claim.confidence,
    reviewRequired: claim.review_required,
    dataType: claim.data_type,
    sensitive: claim.sensitive,
  }, sourceRecord)
  return [
    `- ${update.fieldKey}: ${claim.value}`,
    `source=${claim.source_name}`,
    claim.source_url ? `url=${claim.source_url}` : '',
    `tier=${update.sourceTierLabel}`,
    `confidence=${claim.confidence}`,
    `status=${claim.evidence_status}`,
    `risk=${update.riskReason}`,
  ].filter(Boolean).join(' | ')
}

function normalizedClaimNeedsDashboardReview(claim: NormalizedTrustedSourceClaim): boolean {
  const sourceRecord = state.value.sources.find(source => source.source_id === claim.source_id) || null
  return buildDashboardUpdateCandidate({
    screen: claim.screen,
    field: claim.field,
    value: claim.value,
    source: {
      title: claim.source_name,
      url: claim.source_url,
      date: claim.source_date,
    },
    sourceId: claim.source_id,
    fetchedAt: claim.fetched_at,
    evidenceStatus: claim.evidence_status,
    confidence: claim.confidence,
    reviewRequired: claim.review_required,
    dataType: claim.data_type,
    sensitive: claim.sensitive,
  }, sourceRecord).reviewRequired
}

async function runTrustedSourceDataEngine(screen: AutopilotScreen, jobId?: string): Promise<TrustedSourceRefreshResult> {
  ensureLoaded()
  const intelligence = useFeasibilityIntelligence()
  const normalizedClaims: NormalizedTrustedSourceClaim[] = []
  const sourceIds = new Set<string>()
  let researchJobFallbacks = 0

  for (const mapping of SCREEN_FIELD_MAPPINGS[screen]) {
    const internal = internalClaimForField(screen, mapping.field)
    if (internal) {
      normalizedClaims.push(internal)
      sourceIds.add(internal.source_id)
      continue
    }

    const source = preferredSourceForField(screen, mapping.field, state.value.sources)
    if (source && mapping.autoUpdateAllowed && source.auto_update_allowed && source.connector_type === 'API') {
      const { claims } = await runConnector({
        screen,
        field: mapping.field,
        source,
      })
      normalizedClaims.push(...claims.map(claim => ({ ...claim, sensitive: claim.sensitive || mapping.sensitive })))
      sourceIds.add(source.source_id)
      updateSource(source.source_id, { last_checked: nowIso(), last_failure: null })
      continue
    }

    if (source) {
      const missing = createMissingFieldClaim(screen, mapping.field)
      normalizedClaims.push({
        ...missing,
        source_id: source.source_id,
        source_name: source.name,
        source_url: source.url,
        source_date: nowIso().slice(0, 10),
        notes: `${missing.notes} Preferred source: ${source.name}. Connector type ${source.connector_type} requires Hermes research job/manual review before field update.`,
      })
      sourceIds.add(source.source_id)
      researchJobFallbacks += 1
      continue
    }

    normalizedClaims.push(createMissingFieldClaim(screen, mapping.field))
    researchJobFallbacks += 1
  }

  const snapshotClaims = normalizedClaims.map(claimFromNormalized)
  const snapshot = createSnapshot({
    screen,
    claims: snapshotClaims,
    sourceIds: Array.from(sourceIds).filter(id => id !== 'missing-source'),
    jobId,
    reviewRequired: snapshotClaims.some(claim => claim.reviewRequired),
  })

  const reviewNeeded = normalizedClaims.filter(normalizedClaimNeedsDashboardReview)
  if (reviewNeeded.length) {
    const reviewRows = reviewNeeded.slice(0, 10).map(reviewLineForNormalizedClaim)
    intelligence.addResearchFinding({
      summary: [
        `${screenLabel(screen)} trusted-source data engine run.`,
        `Fields checked: ${normalizedClaims.length}`,
        `Review/fallback items: ${reviewNeeded.length}`,
        `Research job fallbacks: ${researchJobFallbacks}`,
        '',
        'Proposed dashboard updates:',
        ...reviewRows,
        'No fake values were inserted. Missing fields remain To Verify/Missing or Trade Proxy.',
      ].join('\n'),
      keyClaim: `${screenLabel(screen)} trusted-source refresh produced review items`,
      area: refreshAreaForScreen(screen),
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: {
        title: 'Trusted Source Data Engine',
        date: nowIso().slice(0, 10),
      },
      suggestedTask: 'Review source-backed claims, connector fallbacks, sensitive visibility, and missing fields before investor use.',
      riskNote: 'Autopilot does not mark unsupported data Verified and does not overwrite investor-approved material automatically.',
    })
  }

  return {
    snapshot,
    researchJobCreated: !!jobId,
    message: jobId
      ? 'Trusted source data engine scheduled and snapshot created'
      : researchJobFallbacks
        ? 'Trusted source data engine created review/fallback items'
        : 'Trusted source data engine refreshed source-backed fields',
  }
}

async function runFullDashboardDataEngine(jobId?: string): Promise<FullDashboardAutopilotResult> {
  ensureLoaded()
  const intelligence = useFeasibilityIntelligence()
  const results: TrustedSourceRefreshResult[] = []

  for (const screen of FULL_DASHBOARD_SCREENS) {
    results.push(await runTrustedSourceDataEngine(screen, jobId))
  }

  const snapshots = results.map(result => result.snapshot)
  const reviewItemCount = snapshots.reduce((total, snapshot) => (
    total + snapshot.claims.filter(claim => claim.reviewRequired).length + snapshot.conflicts.length
  ), 0)

  intelligence.addResearchFinding({
    summary: [
      'Full dashboard trusted-source autopilot run.',
      `Screens checked: ${FULL_DASHBOARD_SCREENS.map(screenLabel).join(', ')}`,
      `Snapshots created: ${snapshots.length}`,
      `Review/fallback items: ${reviewItemCount}`,
      jobId ? `Hermes scheduled job id: ${jobId}` : 'No scheduled job id; local source snapshot only.',
      '',
      'Raw material, supplier, export market, regulatory, investor readiness, and presentation research are included in the scheduled Hermes job prompt.',
      'No fake values were inserted. Missing fields remain Missing / To Verify, Trade Proxy, or Derived from Assumptions.',
    ].join('\n'),
    keyClaim: 'Full dashboard autopilot produced review-ready source snapshots',
    area: 'market',
    evidenceStatus: 'To Verify',
    confidence: 'medium',
    source: {
      title: 'Full Dashboard Trusted Source Autopilot',
      date: nowIso().slice(0, 10),
    },
    suggestedTask: 'Review source-backed claims and fallback items before using them in investor-ready material.',
    riskNote: 'Autopilot researches automatically, but unsupported or sensitive values are not promoted to verified dashboard facts.',
  })

  return {
    snapshots,
    researchJobCreated: !!jobId,
    reviewItemCount,
    message: jobId
      ? 'Full dashboard autopilot scheduled and source snapshots created'
      : 'Full dashboard source snapshot created; schedule a Hermes job for online research',
  }
}

function asText(value: unknown, fallback = 'To Verify'): string {
  if (typeof value === 'string') return value.trim() || fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return fallback
    }
  }
  return fallback
}

function isAutopilotScreen(value: unknown): value is AutopilotScreen {
  return value === 'executive' ||
    value === 'market' ||
    value === 'investment' ||
    value === 'competitor' ||
    value === 'rawMaterials' ||
    value === 'exportMarkets' ||
    value === 'regulatory' ||
    value === 'investorReadiness' ||
    value === 'presentation'
}

function groupDefaultScreen(group: DashboardResearchUpdateGroup, item: DashboardResearchUpdateItem): AutopilotScreen {
  if (isAutopilotScreen(item.screen)) return item.screen
  if (group === 'financialEvidence') return 'investment'
  if (group === 'competitorRecords') return 'competitor'
  if (group === 'rawMaterialSignals' || group === 'supplierScorecards') return 'rawMaterials'
  if (group === 'regulatoryFindings') return 'regulatory'
  if (group === 'investorMaterialCandidates') return 'presentation'
  if (group === 'evidenceGaps' || group === 'suggestedTasks') return 'investorReadiness'
  return 'market'
}

function groupDefaultDataType(group: DashboardResearchUpdateGroup): TrustedSourceDataType {
  if (group === 'competitorRecords') return 'competitor_data'
  if (group === 'financialEvidence') return 'financial_data'
  if (group === 'supplierScorecards') return 'supplier_quote'
  if (group === 'rawMaterialSignals') return 'price_data'
  if (group === 'regulatoryFindings') return 'regulatory_data'
  if (group === 'investorMaterialCandidates') return 'document_evidence'
  if (group === 'suggestedTasks' || group === 'evidenceGaps') return 'document_evidence'
  return 'market_size'
}

function groupDefaultArea(group: DashboardResearchUpdateGroup, item: DashboardResearchUpdateItem): EvidenceArea {
  const text = [
    item.field,
    item.label,
    item.title,
    item.section,
    item.content,
    item.notes,
    item.recommendedAction,
  ].map(value => asText(value, '')).join(' ').toLowerCase()

  if (group === 'financialEvidence') return 'financial'
  if (group === 'regulatoryFindings' || text.includes('regulatory') || text.includes('dms') || text.includes('permit')) return 'regulatory'
  if (group === 'investorMaterialCandidates') return 'presentation'
  if (text.includes('factory') || text.includes('plant') || text.includes('machine')) return 'factory'
  if (text.includes('sds') || text.includes('tds') || text.includes('cas') || text.includes('product') || text.includes('cwas') || text.includes('cwms')) return 'product'
  if (text.includes('company') || text.includes('license') || text.includes('bank')) return 'companyLegal'
  return 'market'
}

function sourceFromDashboardItem(item: DashboardResearchUpdateItem, fallbackTitle: string): SourceReference {
  return {
    title: asText(item.sourceTitle || item.sourceName, fallbackTitle),
    url: asText(item.sourceUrl, ''),
    date: asText(item.sourceDate || item.lastChecked, nowIso().slice(0, 10)),
  }
}

function dashboardItemField(group: DashboardResearchUpdateGroup, item: DashboardResearchUpdateItem, index: number): string {
  const explicit = item.proposedDashboardField || item.field || item.label || item.title || item.section
  if (explicit) return asText(explicit)
  if (group === 'competitorRecords') return `Competitor record: ${asText(item.companyName, `record ${index + 1}`)}`
  if (group === 'supplierScorecards') return `Supplier scorecard: ${asText(item.supplier, `supplier ${index + 1}`)}`
  if (group === 'rawMaterialSignals') return `Raw material signal: ${asText(item.material, `material ${index + 1}`)}`
  return `${group} item ${index + 1}`
}

function dashboardItemValue(group: DashboardResearchUpdateGroup, item: DashboardResearchUpdateItem): string {
  if (item.value != null) return asText(item.value)
  if (group === 'competitorRecords') {
    return [
      item.companyName ? `Company: ${asText(item.companyName)}` : '',
      item.countryRegion ? `Region: ${asText(item.countryRegion)}` : '',
      item.productEquivalent ? `Product equivalent: ${asText(item.productEquivalent)}` : '',
      item.marketShare ? `Market share: ${asText(item.marketShare)}` : '',
      item.pricingEvidence ? `Pricing: ${asText(item.pricingEvidence)}` : '',
    ].filter(Boolean).join('; ') || 'To Verify'
  }
  if (group === 'supplierScorecards') {
    return [
      item.supplier ? `Supplier: ${asText(item.supplier)}` : '',
      item.material ? `Material: ${asText(item.material)}` : '',
      item.pricingEvidence ? `Pricing: ${asText(item.pricingEvidence)}` : 'Pricing: To Verify',
    ].filter(Boolean).join('; ') || 'To Verify'
  }
  return asText(item.content || item.notes || item.recommendedAction)
}

function groupHumanLabel(group: DashboardResearchUpdateGroup): string {
  if (group === 'marketClaims') return 'Market claims'
  if (group === 'competitorRecords') return 'Competitor records'
  if (group === 'rawMaterialSignals') return 'Raw material signals'
  if (group === 'supplierScorecards') return 'Supplier scorecards'
  if (group === 'regulatoryFindings') return 'Regulatory findings'
  if (group === 'financialEvidence') return 'Financial evidence'
  if (group === 'evidenceGaps') return 'Evidence gaps'
  if (group === 'suggestedTasks') return 'Suggested tasks'
  return 'Investor material candidates'
}

function dashboardItemLooksSensitive(group: DashboardResearchUpdateGroup, item: DashboardResearchUpdateItem): boolean {
  if (group === 'financialEvidence' || group === 'supplierScorecards' || group === 'rawMaterialSignals') return true
  const text = [
    item.field,
    item.label,
    item.title,
    item.value,
    item.pricingEvidence,
    item.marketShare,
    item.notes,
    item.content,
  ].map(value => asText(value, '')).join(' ').toLowerCase()
  return /price|pricing|cost|quote|supplier price|landed|margin|formula|ratio|irr|npv|payback|investment|market share|dms|cas|regulatory/.test(text)
}

function researchFindingSummary(input: {
  group: DashboardResearchUpdateGroup
  claim: TrustedSourceSnapshotClaim
  item: DashboardResearchUpdateItem
}): string {
  return [
    `Imported by Full Dashboard Trusted Source Autopilot from ${groupHumanLabel(input.group)}.`,
    `Dashboard field: ${input.claim.fieldKey || input.claim.label}`,
    `Proposed value: ${input.claim.value}`,
    `Source: ${input.claim.source.title}`,
    input.claim.source.url ? `Source URL: ${input.claim.source.url}` : '',
    input.claim.source.date ? `Source date: ${input.claim.source.date}` : '',
    input.claim.sourceTierLabel ? `Source tier: ${input.claim.sourceTierLabel}` : '',
    `Confidence: ${input.claim.confidence}`,
    `Evidence status: ${input.claim.evidenceStatus}`,
    input.claim.riskReason ? `Risk reason: ${input.claim.riskReason}` : '',
    input.item.notes ? `Notes: ${input.item.notes}` : '',
    input.item.recommendedAction ? `Recommended action: ${input.item.recommendedAction}` : '',
  ].filter(Boolean).join('\n')
}

function prepareDashboardResearchClaim(
  group: DashboardResearchUpdateGroup,
  item: DashboardResearchUpdateItem,
  index: number,
): { claim: TrustedSourceSnapshotClaim; sourceId: string; screen: AutopilotScreen; area: EvidenceArea; action: 'auto-fill' | 'stage-review' } {
  const screen = groupDefaultScreen(group, item)
  const dataType = coerceDashboardDataType(item.dataType, groupDefaultDataType(group))
  const field = dashboardItemField(group, item, index)
  const value = dashboardItemValue(group, item)
  const source = sourceFromDashboardItem(item, 'Hermes trusted-source research output')
  const sourceRecord = findSourceByReference(source) || registerCandidate({
    name: source.title,
    url: source.url,
    dataType,
    screen,
  })
  const evidenceStatus = coerceDashboardEvidenceStatus(item.evidenceStatus, evidenceStatusForTier(sourceRecord.tier))
  const update = buildDashboardUpdateCandidate({
    screen,
    field,
    value,
    source,
    sourceId: sourceRecord.source_id,
    fetchedAt: asText(item.lastChecked, nowIso()),
    evidenceStatus,
    confidence: coerceDashboardConfidence(item.confidence || sourceRecord.confidence_default),
    reviewRequired: item.reviewRequired,
    dataType,
    sensitive: !!item.sensitive || dashboardItemLooksSensitive(group, item),
    investorApprovedImpact: group === 'investorMaterialCandidates',
  }, sourceRecord)
  const claim: TrustedSourceSnapshotClaim = {
    id: idFrom('claim', `${group}-${field}`),
    fieldKey: update.fieldKey,
    label: field,
    value,
    evidenceStatus,
    confidence: update.confidence,
    source,
    sourceTier: update.sourceTier,
    sourceTierLabel: update.sourceTierLabel,
    lastChecked: update.lastChecked,
    riskReason: update.riskReason,
    dataType,
    reviewRequired: update.reviewRequired,
    sensitive: update.sensitive,
    notes: [
      `Imported group: ${group}`,
      item.riskReason ? `Research risk reason: ${item.riskReason}` : '',
      item.notes ? `Research notes: ${item.notes}` : '',
      item.recommendedAction ? `Recommended action: ${item.recommendedAction}` : '',
      `Autopilot action: ${update.action}`,
      `Risk reason: ${update.riskReason}`,
    ].filter(Boolean).join('\n'),
  }
  return {
    claim,
    sourceId: sourceRecord.source_id,
    screen,
    area: groupDefaultArea(group, item),
    action: update.action,
  }
}

function applySafeDashboardResearchItem(group: DashboardResearchUpdateGroup, item: DashboardResearchUpdateItem, claim: TrustedSourceSnapshotClaim): boolean {
  if (claim.reviewRequired || claim.sensitive) return false
  const intelligence = useFeasibilityIntelligence()

  if (group === 'marketClaims' || group === 'rawMaterialSignals') {
    intelligence.addMarketClaim({
      label: claim.label,
      value: claim.value,
      evidenceStatus: claim.evidenceStatus,
      confidence: claim.confidence,
      source: claim.source,
      lastChecked: claim.lastChecked?.slice(0, 10) || nowIso().slice(0, 10),
    })
    return true
  }

  if (group === 'competitorRecords' && item.companyName) {
    intelligence.addCompetitor({
      companyName: asText(item.companyName),
      countryRegion: asText(item.countryRegion, 'To Verify'),
      productEquivalent: asText(item.productEquivalent, 'To Verify'),
      activeContent: asText(item.activeContent, 'To Verify'),
      pricingEvidence: asText(item.pricingEvidence, 'To Verify'),
      certifications: asText(item.certifications, 'To Verify'),
      distributionPresence: asText(item.distributionPresence, 'To Verify'),
      marketShare: '',
      evidenceStatus: claim.evidenceStatus,
      source: claim.source,
      notes: [
        item.notes ? asText(item.notes) : '',
        'Imported by Full Dashboard Trusted Source Autopilot. Market share remains To Verify unless separately source-backed and reviewed.',
      ].filter(Boolean).join('\n'),
    })
    return true
  }

  return false
}

function stageDashboardResearchItem(
  group: DashboardResearchUpdateGroup,
  item: DashboardResearchUpdateItem,
  claim: TrustedSourceSnapshotClaim,
  area: EvidenceArea,
) {
  useFeasibilityIntelligence().addResearchFinding({
    summary: researchFindingSummary({ group, claim, item }),
    keyClaim: `Dashboard update: ${claim.label}`,
    area,
    evidenceStatus: claim.evidenceStatus,
    confidence: claim.confidence,
    source: claim.source,
    suggestedTask: asText(item.recommendedAction, `Review ${claim.label} and approve only source-backed dashboard changes.`),
    suggestedInvestorMaterial: group === 'investorMaterialCandidates' ? asText(item.content || item.value, '') : '',
    riskNote: claim.riskReason || 'Review required by trusted-source policy.',
  })
}

function importDashboardResearchOutput(content: string, jobId?: string): DashboardResearchImportResult {
  ensureLoaded()
  const payload = extractDashboardResearchUpdates(content)
  if (!payload) {
    return {
      parsedItemCount: 0,
      autoFilledCount: 0,
      reviewItemCount: 0,
      snapshotCount: 0,
      runImported: false,
      runKey: undefined,
      message: 'No dashboard_updates JSON block found in Hermes research output',
      errors: ['Missing dashboard_updates JSON block'],
    }
  }

  const claimsByScreen = new Map<AutopilotScreen, TrustedSourceSnapshotClaim[]>()
  const sourceIdsByScreen = new Map<AutopilotScreen, Set<string>>()
  let parsedItemCount = 0
  let autoFilledCount = 0
  let reviewItemCount = 0
  const errors: string[] = []

  for (const group of DASHBOARD_RESEARCH_GROUPS) {
    const items = payload[group] || []
    items.forEach((item, index) => {
      parsedItemCount += 1
      try {
        const prepared = prepareDashboardResearchClaim(group, item, index)
        const existing = claimsByScreen.get(prepared.screen) || []
        claimsByScreen.set(prepared.screen, [...existing, prepared.claim])
        const sourceIds = sourceIdsByScreen.get(prepared.screen) || new Set<string>()
        sourceIds.add(prepared.sourceId)
        sourceIdsByScreen.set(prepared.screen, sourceIds)

        if (prepared.action === 'auto-fill' && applySafeDashboardResearchItem(group, item, prepared.claim)) {
          autoFilledCount += 1
        } else {
          stageDashboardResearchItem(group, item, prepared.claim, prepared.area)
          reviewItemCount += 1
        }
      } catch (err) {
        errors.push(`${group}[${index}]: ${err instanceof Error ? err.message : 'Unknown import error'}`)
      }
    })
  }

  const snapshots: TrustedSourceSnapshot[] = []
  for (const [screen, claims] of claimsByScreen.entries()) {
    snapshots.push(createSnapshot({
      screen,
      claims,
      sourceIds: Array.from(sourceIdsByScreen.get(screen) || []),
      jobId,
      reviewRequired: claims.some(claim => claim.reviewRequired),
    }))
  }

  useFeasibilityIntelligence().addResearchFinding({
    summary: [
      'Full dashboard trusted-source research output imported.',
      `Parsed items: ${parsedItemCount}`,
      `Auto-filled low-risk items: ${autoFilledCount}`,
      `Review-gated items: ${reviewItemCount}`,
      `Snapshots created: ${snapshots.length}`,
      jobId ? `Hermes scheduled job id: ${jobId}` : '',
      'Critical or sensitive claims were not silently approved.',
    ].filter(Boolean).join('\n'),
    keyClaim: 'Full dashboard research output imported into source-gated dashboard pipeline',
    area: 'market',
    evidenceStatus: reviewItemCount > 0 ? 'To Verify' : 'Source-backed',
    confidence: reviewItemCount > 0 ? 'medium' : 'high',
    source: {
      title: 'Hermes scheduled trusted-source research output',
      date: nowIso().slice(0, 10),
    },
    suggestedTask: reviewItemCount > 0
      ? 'Review staged dashboard updates before using them in investor material.'
      : 'Check auto-filled source labels and keep investor material approval separate.',
    riskNote: 'Importer applies official-first source ranking and review-gates critical dashboard truth.',
  })

  return {
    parsedItemCount,
    autoFilledCount,
    reviewItemCount,
    snapshotCount: snapshots.length,
    runImported: true,
    runKey: undefined,
    message: `Imported ${parsedItemCount} dashboard update item${parsedItemCount === 1 ? '' : 's'} from Hermes research output`,
    errors,
  }
}

async function importLatestFullDashboardRunOutput(jobId?: string): Promise<DashboardResearchImportResult> {
  ensureLoaded()
  if (!jobId) {
    return {
      parsedItemCount: 0,
      autoFilledCount: 0,
      reviewItemCount: 0,
      snapshotCount: 0,
      runImported: false,
      runKey: undefined,
      message: 'No scheduled Hermes job id is available yet',
      errors: ['Missing scheduled job id'],
    }
  }

  const runs = await listCronRuns(jobId)
  const latest = runs.find(run => run.hasOutput !== false && !run.synthetic)
  if (!latest) {
    const recordedRun = runs[0]
    const detail = recordedRun?.status || recordedRun?.error || 'No readable output artifact found yet'
    return {
      parsedItemCount: 0,
      autoFilledCount: 0,
      reviewItemCount: 0,
      snapshotCount: 0,
      runImported: false,
      runKey: undefined,
      message: `No readable Hermes research output found yet. ${detail}`,
      errors: [detail],
    }
  }

  const runKey = `${latest.jobId}/${latest.fileName}`
  if (state.value.importedRunKeys.includes(runKey)) {
    return {
      parsedItemCount: 0,
      autoFilledCount: 0,
      reviewItemCount: 0,
      snapshotCount: 0,
      runImported: false,
      runKey,
      message: 'Latest Hermes research output was already imported',
      errors: [],
    }
  }

  const detail = await readCronRun(latest.jobId, latest.fileName)
  const result = importDashboardResearchOutput(detail.content, jobId)
  if (result.runImported) {
    state.value.importedRunKeys = [runKey, ...state.value.importedRunKeys.filter(key => key !== runKey)].slice(0, 100)
    persist()
  }
  return { ...result, runKey }
}

async function importEnabledFullDashboardRunOutput(): Promise<DashboardResearchImportResult | null> {
  const status = loadFullDashboardAutopilotStatus()
  if (!status.enabled || !status.scheduledJobId) return null

  try {
    const result = await importLatestFullDashboardRunOutput(status.scheduledJobId)
    if (result.runImported) {
      persistFullDashboardAutopilotStatus({
        lastRun: new Date().toISOString(),
        lastStatus: `${result.message}. Auto-filled: ${result.autoFilledCount}. Needs review: ${result.reviewItemCount}.`,
      })
    } else if (result.errors.length > 0 && !result.message.includes('already imported')) {
      persistFullDashboardAutopilotStatus({
        lastStatus: `Waiting for trusted-source research output: ${result.message}`,
      })
    }
    return result
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown import error'
    persistFullDashboardAutopilotStatus({
      lastStatus: `Automatic trusted-source import failed: ${detail}`,
    })
    return {
      parsedItemCount: 0,
      autoFilledCount: 0,
      reviewItemCount: 0,
      snapshotCount: 0,
      runImported: false,
      message: `Automatic trusted-source import failed: ${detail}`,
      errors: [detail],
    }
  }
}

function emptyFullDashboardServerStatus(message = 'Full dashboard autopilot schedule has not been found yet'): FullDashboardServerStatus {
  return {
    scheduled: false,
    jobId: '',
    jobName: '',
    schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    enabled: false,
    state: 'missing',
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: '',
    lastError: '',
    outputCount: 0,
    latestOutputAt: '',
    latestOutputFile: '',
    importedRunCount: state.value.importedRunKeys.length,
    skippedRunCount: 0,
    latestOutputImported: false,
    latestOutputSkipped: false,
    latestOutputParseStatus: 'none',
    latestOutputCandidateCount: 0,
    latestOutputParseError: '',
    latestDueSlotAt: '',
    latestDueSlotSatisfied: false,
    latestDueSlotAttemptedAt: '',
    latestDueSlotRunError: '',
    dashboardRecordCount: 0,
    pendingReviewCount: 0,
    message,
    errors: [],
  }
}

function dashboardRecordCounts(): { dashboardRecordCount: number; pendingReviewCount: number } {
  const intelligence = useFeasibilityIntelligence()
  const dashboardRecordCount =
    intelligence.state.value.marketClaims.length +
    intelligence.state.value.competitors.length +
    intelligence.state.value.dataRoomSources.length +
    intelligence.state.value.researchJobs.length
  const pendingReviewCount = intelligence.pendingResearchFindings.value.length
  return { dashboardRecordCount, pendingReviewCount }
}

function fullDashboardStatusMessage(status: FullDashboardServerStatus): string {
  if (!status.scheduled) return 'Hermes has not found the twice-daily Full Dashboard Autopilot job yet.'
  if (!status.enabled) return 'Full Dashboard Autopilot exists but is disabled. Enable or resume it before relying on automatic updates.'
  if (status.lastError) return `Full Dashboard Autopilot is scheduled but the last run reported an error: ${status.lastError}`
  if (status.latestDueSlotRunError) return `The server attempted the latest due autopilot slot, but Hermes reported: ${status.latestDueSlotRunError}`
  if (status.latestOutputParseStatus === 'unreadable') return `The latest Hermes output exists but could not be read: ${status.latestOutputParseError || 'unknown read error'}`
  if (status.latestOutputSkipped) return 'The latest Hermes output was checked and skipped because it did not contain source-backed dashboard update data. The next run will try again automatically.'
  if (status.latestOutputParseStatus === 'unparseable') return 'The latest Hermes output exists, but it did not contain source-backed JSON, Markdown tables, or delimited findings that the dashboard can safely import.'
  if (status.latestOutputParseStatus === 'ready') return `The latest Hermes output has ${status.latestOutputCandidateCount} source-backed candidate item${status.latestOutputCandidateCount === 1 ? '' : 's'} ready for the source-gated importer.`
  if (status.latestDueSlotAt && !status.latestDueSlotSatisfied && status.latestDueSlotAttemptedAt) return 'The server has kicked the latest due autopilot slot and is waiting for a readable Hermes output artifact.'
  if (status.latestDueSlotAt && !status.latestDueSlotSatisfied) return 'A twice-daily autopilot slot is due; the server will kick the Hermes research job automatically after the safety grace period.'
  if (!status.outputCount) return 'Full Dashboard Autopilot is scheduled. Waiting for the first readable research output.'
  if (!status.latestOutputImported) return 'A readable Hermes research output exists and is ready to import into the source-gated dashboard pipeline.'
  if (status.pendingReviewCount > 0) return 'Full Dashboard Autopilot is filling the dashboard and has review-gated findings waiting for approval.'
  return 'Full Dashboard Autopilot is scheduled and imported outputs are reflected in dashboard intelligence.'
}

async function refreshFullDashboardServerStatus(): Promise<FullDashboardServerStatus> {
  ensureLoaded()
  const counts = dashboardRecordCounts()

  try {
    const [jobs, importEnvelope] = await Promise.all([
      listJobs(),
      fetchDashboardAutopilotImportStatus().catch(() => null),
    ])
    const serverImport = importEnvelope?.autopilotImport
    const job = jobs.find(isFullDashboardAutopilotJob)
    const jobId = job ? fullDashboardJobId(job) : ''
    if (!job || !jobId) {
      return {
        ...emptyFullDashboardServerStatus(),
        ...counts,
      }
    }

    const runs = await listCronRuns(jobId)
    const readableRuns = runs.filter(run => run.hasOutput !== false && !run.synthetic)
    const latest = readableRuns[0] || runs[0] || null
    const latestRunKey = serverImport?.latestOutputRunKey ||
      (latest?.jobId && latest?.fileName ? `${latest.jobId}/${latest.fileName}` : '')
    const next: FullDashboardServerStatus = {
      scheduled: true,
      jobId,
      jobName: job.name || FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      schedule: job.schedule_display || scheduleToDisplayText(job.schedule, FULL_DASHBOARD_AUTOPILOT_SCHEDULE),
      enabled: job.enabled !== false,
      state: job.state || '',
      lastRunAt: job.last_run_at || latest?.runTime || '',
      nextRunAt: job.next_run_at || '',
      lastStatus: job.last_status || latest?.status || '',
      lastError: job.last_error || latest?.error || '',
      outputCount: serverImport?.outputCount ?? readableRuns.length,
      latestOutputAt: serverImport?.latestOutputAt || latest?.runTime || '',
      latestOutputFile: serverImport?.latestOutputFile || latest?.fileName || '',
      importedRunCount: serverImport?.importedRunCount ?? state.value.importedRunKeys.length,
      skippedRunCount: serverImport?.skippedRunCount ?? 0,
      latestOutputImported: latestRunKey
        ? Boolean(serverImport?.latestOutputImported ?? state.value.importedRunKeys.includes(latestRunKey))
        : false,
      latestOutputSkipped: Boolean(serverImport?.latestOutputSkipped),
      latestOutputParseStatus: serverImport?.latestOutputParseStatus || 'none',
      latestOutputCandidateCount: serverImport?.latestOutputCandidateCount || 0,
      latestOutputParseError: serverImport?.latestOutputParseError || '',
      latestDueSlotAt: serverImport?.latestDueSlotAt || '',
      latestDueSlotSatisfied: Boolean(serverImport?.latestDueSlotSatisfied),
      latestDueSlotAttemptedAt: serverImport?.latestDueSlotAttemptedAt || '',
      latestDueSlotRunError: serverImport?.latestDueSlotRunError || '',
      ...counts,
      message: '',
      errors: [],
    }
    next.message = fullDashboardStatusMessage(next)
    return next
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Could not read server autopilot status'
    return {
      ...emptyFullDashboardServerStatus(`Could not read server autopilot status: ${detail}`),
      ...counts,
      errors: [detail],
    }
  }
}

async function ensureFullDashboardAutopilotScheduled(options: { startFirstRun?: boolean } = {}): Promise<FullDashboardAutopilotBootstrapResult> {
  const defaultModel = await ensureDefaultModelForAutopilot()
  const status = loadFullDashboardAutopilotStatus()
  const jobs = await listJobs()
  const existing = jobs.find(isFullDashboardAutopilotJob)
  let scheduledJobId = existing ? fullDashboardJobId(existing) : status.scheduledJobId
  let created = false
  let firstRunStarted = false
  const previousModelError = Boolean(
    existing &&
    String(existing.last_error || '').toLowerCase().includes('model') &&
    String(existing.last_error || '').toLowerCase().includes('non-empty'),
  )

  if (!existing || !scheduledJobId) {
    const job = await createJob({
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      prompt: fullDashboardAutopilotPrompt(),
      deliver: 'local',
    })
    scheduledJobId = fullDashboardJobId(job)
    created = true
  }

  if (!scheduledJobId) {
    throw new Error('Hermes did not return a scheduled Full Dashboard Autopilot job id')
  }

  recordFullDashboardResearchJob(scheduledJobId)
  persistFullDashboardAutopilotStatus({
    enabled: true,
    scheduledJobId,
    lastRun: status.lastRun,
    lastStatus: created
      ? `${defaultModel.configured ? `Default Hermes model set to ${defaultModel.model}. ` : ''}Full dashboard autopilot schedule created automatically; starting the first trusted-source run.`
      : `${defaultModel.configured ? `Default Hermes model set to ${defaultModel.model}. ` : ''}Full dashboard autopilot schedule confirmed automatically.`,
  })

  if (options.startFirstRun && (created || !status.enabled || !status.lastRun || (defaultModel.configured && previousModelError))) {
    try {
      await runJob(scheduledJobId)
      firstRunStarted = true
      persistFullDashboardAutopilotStatus({
        lastRun: new Date().toISOString(),
        lastStatus: 'Full dashboard autopilot is enabled and the first Hermes trusted-source research run has started. Output will import automatically when available.',
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown run error'
      persistFullDashboardAutopilotStatus({
        lastStatus: `Full dashboard autopilot is scheduled. Immediate trusted-source run could not start yet: ${detail}`,
      })
    }
  }

  return {
    scheduledJobId,
    created,
    firstRunStarted,
    defaultModelConfigured: defaultModel.configured,
    message: firstRunStarted
      ? 'Full dashboard autopilot scheduled and first run started'
      : created
        ? 'Full dashboard autopilot scheduled automatically'
        : 'Full dashboard autopilot schedule already exists',
  }
}

function screenLabel(screen: AutopilotScreen): string {
  if (screen === 'executive') return 'Executive Overview'
  if (screen === 'market') return 'Market Intelligence'
  if (screen === 'investment') return 'Investment Analysis'
  if (screen === 'competitor') return 'Competitor Intelligence'
  if (screen === 'rawMaterials') return 'Raw Material Sourcing'
  if (screen === 'exportMarkets') return 'Export Market Opportunity'
  if (screen === 'regulatory') return 'Regulatory Intelligence'
  if (screen === 'investorReadiness') return 'Investor Readiness'
  return 'Investor Presentation Builder'
}

function resetTrustedSourceAutopilotForTests() {
  state.value = {
    sources: DEFAULT_TRUSTED_SOURCES.map(source => ({ ...source })),
    snapshots: [],
    importedRunKeys: [],
  }
  loaded = true
  persist()
}

export function useTrustedSourceAutopilot() {
  ensureLoaded()

  const activeSources = computed(() => state.value.sources.filter(source => source.enabled))
  const needsReviewSnapshots = computed(() => state.value.snapshots.filter(snapshot => snapshot.review_required || snapshot.conflicts.length))

  function snapshotsForScreen(screen: AutopilotScreen): TrustedSourceSnapshot[] {
    return state.value.snapshots.filter(snapshot => snapshot.screen === screen)
  }

  function lastSnapshotForScreen(screen: AutopilotScreen): TrustedSourceSnapshot | null {
    return snapshotsForScreen(screen)[0] || null
  }

  function activeSourcesForScreen(screen: AutopilotScreen): TrustedSourceRecord[] {
    return activeSources.value.filter(source => source.allowed_for.includes(screen))
  }

  return {
    state,
    activeSources,
    needsReviewSnapshots,
    screenRefreshPrompt,
    snapshotsForScreen,
    lastSnapshotForScreen,
    activeSourcesForScreen,
    fullDashboardAutopilotPrompt,
    runFullDashboardDataEngine,
    hydrateSnapshotsFromServerIntelligenceState,
    registerCandidate,
    updateSource,
    applyTrustedSourceClaim,
    createRefreshSnapshot,
    ensureFullDashboardAutopilotScheduled,
    importDashboardResearchOutput,
    importEnabledFullDashboardRunOutput,
    importLatestFullDashboardRunOutput,
    refreshFullDashboardServerStatus,
    runTrustedSourceDataEngine,
    resetTrustedSourceAutopilotForTests,
  }
}
