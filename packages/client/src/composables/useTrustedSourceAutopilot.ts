import { computed, ref } from 'vue'
import { type EvidenceArea, useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { listCronRuns, readCronRun } from '@/api/hermes/cron-history'
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
  message: string
  errors: string[]
}

const STORAGE_KEY = 'hermes.trustedSourceAutopilot.v1'
export const FULL_DASHBOARD_AUTOPILOT_JOB_NAME = 'Full Dashboard Trusted Source Autopilot'
export const FULL_DASHBOARD_AUTOPILOT_SCHEDULE = '0 7,19 * * *'
const FULL_DASHBOARD_SCREENS: AutopilotScreen[] = ['executive', 'market', 'investment', 'competitor']
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
  return ['Refresh Competitor Intelligence using official company/product pages, filings, catalogs, regulator/certification sources, and source-backed market reports. Unknown market share stays To Verify.', ...common].join('\n')
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
    '',
    'Mission: research and refresh the Hermes feasibility intelligence dashboard automatically using trusted online sources and existing Hermes workspace evidence.',
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
    'Trusted source priority:',
    '1. Official government/regulator/statistical/trade sources: UN Comtrade, ITC, World Bank, WTO, OECD, China Customs/NBS/MOFCOM/MEE/MEM/MIIT, ECHA, PubChem, EPA CompTox, NITE.',
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
  const refreshEvidenceStatus: IntelligenceEvidenceStatus = screen === 'executive' ? 'Reference Only' : 'To Verify'
  const refreshDataType: TrustedSourceDataType = screen === 'executive' ? 'internal_activity' : screen === 'investment' ? 'financial_data' : screen === 'competitor' ? 'competitor_data' : 'market_size'
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
    sensitive: screen === 'investment',
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

function groupDefaultScreen(group: DashboardResearchUpdateGroup, item: DashboardResearchUpdateItem): AutopilotScreen {
  if (item.screen === 'executive' || item.screen === 'market' || item.screen === 'investment' || item.screen === 'competitor') return item.screen
  if (group === 'financialEvidence') return 'investment'
  if (group === 'competitorRecords') return 'competitor'
  if (group === 'investorMaterialCandidates') return 'executive'
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
    message: `Imported ${parsedItemCount} dashboard update item${parsedItemCount === 1 ? '' : 's'} from Hermes research output`,
    errors,
  }
}

async function importLatestFullDashboardRunOutput(jobId?: string): Promise<DashboardResearchImportResult> {
  if (!jobId) {
    return {
      parsedItemCount: 0,
      autoFilledCount: 0,
      reviewItemCount: 0,
      snapshotCount: 0,
      runImported: false,
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
      message: `No readable Hermes research output found yet. ${detail}`,
      errors: [detail],
    }
  }

  const detail = await readCronRun(latest.jobId, latest.fileName)
  return importDashboardResearchOutput(detail.content, jobId)
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
    fullDashboardAutopilotPrompt,
    runFullDashboardDataEngine,
    registerCandidate,
    updateSource,
    applyTrustedSourceClaim,
    createRefreshSnapshot,
    importDashboardResearchOutput,
    importLatestFullDashboardRunOutput,
    runTrustedSourceDataEngine,
    resetTrustedSourceAutopilotForTests,
  }
}
