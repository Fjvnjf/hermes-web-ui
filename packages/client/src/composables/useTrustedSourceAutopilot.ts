import { computed, ref } from 'vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
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
import type { IntelligenceEvidenceStatus, SourceReference } from '@/utils/investorIntelligence'

interface TrustedSourceAutopilotState {
  sources: TrustedSourceRecord[]
  snapshots: TrustedSourceSnapshot[]
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

const STORAGE_KEY = 'hermes.trustedSourceAutopilot.v1'

const state = ref<TrustedSourceAutopilotState>({
  sources: DEFAULT_TRUSTED_SOURCES.map(source => ({ ...source })),
  snapshots: [],
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
  if (!raw || typeof raw !== 'object') return { sources: defaults, snapshots: [] }
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
  }
}

function loadState(): TrustedSourceAutopilotState {
  if (typeof window === 'undefined') return { sources: DEFAULT_TRUSTED_SOURCES.map(source => ({ ...source })), snapshots: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return mergeState(raw ? JSON.parse(raw) : null)
  } catch {
    return { sources: DEFAULT_TRUSTED_SOURCES.map(source => ({ ...source })), snapshots: [] }
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
  return {
    id: claim.claim_id,
    label: claim.field,
    value: claim.value,
    evidenceStatus: claim.evidence_status,
    confidence: claim.confidence,
    source: {
      title: claim.source_name,
      url: claim.source_url,
      date: claim.source_date,
    },
    dataType: claim.data_type,
    reviewRequired: claim.review_required,
    sensitive: claim.sensitive,
    notes: [
      claim.notes,
      `Method: ${claim.method}`,
      `Fetched at: ${claim.fetched_at}`,
      claim.unit ? `Unit: ${claim.unit}` : '',
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
    const claim = intelligence.state.value.marketClaims.find(item => {
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
    const competitors = intelligence.state.value.competitors
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
  const reviewRequired = sourceRequiresReview(sourceRecord, {
    hasConflict,
    largeChange,
    investorApprovedImpact: input.investorApprovedImpact,
    sensitiveVisibilityRisk,
    overwritesUserApprovedAssumption: input.overwriteUserApprovedAssumption,
  })
  const evidenceStatus = evidenceStatusForTier(sourceRecord.tier, hasConflict)
  const claim: TrustedSourceSnapshotClaim = {
    id: idFrom('claim', input.label),
    label: input.label,
    value: input.value,
    previousValue: previous?.value,
    changePercent,
    evidenceStatus,
    confidence: sourceRecord.confidence_default,
    source: input.source,
    dataType: input.dataType,
    reviewRequired,
    sensitive: sensitiveVisibilityRisk,
    notes: input.notes,
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
        `Value: ${input.value}`,
        previous?.value ? `Previous value: ${previous.value}` : 'Previous value: none',
        `Source: ${input.source.title}`,
        `Evidence status: ${evidenceStatus}`,
      ].join('\n'),
      keyClaim: `${hasConflict ? 'Conflict Detected' : 'Trusted source review'}: ${input.label}`,
      area: input.screen === 'investment' ? 'financial' : input.screen === 'competitor' || input.screen === 'market' ? 'market' : 'presentation',
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
    'Use only trusted or cited sources. Do not invent values.',
    'Every claim must include source title, URL or date, evidence status, confidence, and extraction date.',
    'If source conflicts, unknown source, or large movement is detected, create Research Result Review item instead of approving material.',
    'Do not update investor-approved material silently.',
  ]
  if (screen === 'executive') return ['Refresh Executive Overview from internal Hermes activity: sessions, Kanban, Jobs, Files, Memory-safe summaries, Research Result Review, Investor Readiness, and IRR status.', ...common].join('\n')
  if (screen === 'market') return ['Refresh Market Intelligence using official trade/statistical sources first, then market references. Label uncertain HS-code data as Trade Proxy / To Verify.', ...common].join('\n')
  if (screen === 'investment') return ['Refresh Investment Analysis from saved IRR Calculator snapshots and user/source-backed files only. Never pull IRR/NPV/payback from random web sources.', ...common].join('\n')
  return ['Refresh Competitor Intelligence using official company/product pages, filings, catalogs, regulator/certification sources, and source-backed market reports. Unknown market share stays To Verify.', ...common].join('\n')
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
    dataType: screen === 'executive' ? 'internal_activity' : screen === 'investment' ? 'financial_data' : screen === 'competitor' ? 'competitor_data' : 'market_size',
    screen,
  })
  const claim: TrustedSourceSnapshotClaim = {
    id: idFrom('claim', `${screen}-refresh`),
    label: `${screenLabel(screen)} refresh status`,
    value: jobId ? 'Scheduled Hermes Job' : 'Task fallback',
    evidenceStatus: screen === 'executive' ? 'Reference Only' : 'To Verify',
    confidence: screen === 'executive' ? 'medium' : 'low',
    source: internalSource,
    dataType: screen === 'executive' ? 'internal_activity' : screen === 'investment' ? 'financial_data' : screen === 'competitor' ? 'competitor_data' : 'market_size',
    reviewRequired: screen !== 'executive',
    sensitive: screen === 'investment',
    notes: screenRefreshPrompt(screen),
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
      keyClaim: `${screen === 'market' ? 'Market intelligence' : screen === 'investment' ? 'Investment analysis' : screenLabel(screen)} trusted-source refresh needs review`,
      area: screen === 'investment' ? 'financial' : 'market',
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
    reviewRequired: normalizedClaims.some(claim => claim.review_required),
  })

  const reviewNeeded = normalizedClaims.filter(claim => claim.review_required)
  if (reviewNeeded.length) {
    intelligence.addResearchFinding({
      summary: [
        `${screenLabel(screen)} trusted-source data engine run.`,
        `Fields checked: ${normalizedClaims.length}`,
        `Review/fallback items: ${reviewNeeded.length}`,
        `Research job fallbacks: ${researchJobFallbacks}`,
        'No fake values were inserted. Missing fields remain To Verify/Missing or Trade Proxy.',
      ].join('\n'),
      keyClaim: `${screen === 'market' ? 'Market intelligence' : screen === 'investment' ? 'Investment analysis' : screenLabel(screen)} trusted-source refresh produced review items`,
      area: screen === 'investment' ? 'financial' : screen === 'executive' ? 'presentation' : 'market',
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

function screenLabel(screen: AutopilotScreen): string {
  if (screen === 'executive') return 'Executive Overview'
  if (screen === 'market') return 'Market Intelligence'
  if (screen === 'investment') return 'Investment Analysis'
  return 'Competitor Intelligence'
}

function resetTrustedSourceAutopilotForTests() {
  state.value = {
    sources: DEFAULT_TRUSTED_SOURCES.map(source => ({ ...source })),
    snapshots: [],
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
    registerCandidate,
    updateSource,
    applyTrustedSourceClaim,
    createRefreshSnapshot,
    runTrustedSourceDataEngine,
    resetTrustedSourceAutopilotForTests,
  }
}
