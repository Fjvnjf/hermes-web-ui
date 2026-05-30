import { computed, ref } from 'vue'
import {
  calculateInvestorReadinessScore,
  isPresentationMaterialAllowed,
  normalizedMarketClaimStatus,
  presentationSectionForEvidence,
  type IntelligenceEvidenceStatus,
  type MarketClaim,
  type PresentationMaterial,
  type ReadinessItem,
  type SourceReference,
} from '@/utils/investorIntelligence'

export type EvidenceArea =
  | 'companyLegal'
  | 'product'
  | 'factory'
  | 'regulatory'
  | 'market'
  | 'financial'
  | 'presentation'

export interface FeasibilityEvidenceItem extends ReadinessItem {
  id: EvidenceArea
  description: string
  nextAction: string
  source?: SourceReference | null
  sourceRecordId?: string | null
  updatedAt?: string
}

export interface CompetitorIntelligenceRecord {
  id: string
  companyName: string
  countryRegion: string
  productEquivalent: string
  activeContent: string
  pricingEvidence: string
  certifications: string
  distributionPresence: string
  marketShare?: string
  evidenceStatus: IntelligenceEvidenceStatus
  source?: SourceReference | null
  notes: string
  updatedAt: string
}

export interface ResearchJobRecord {
  id: string
  title: string
  question: string
  scope?: string
  expectedOutput?: string
  sourceRequirements?: string
  priority?: 'high' | 'medium' | 'low'
  schedulePreference?: 'Tonight' | 'Tomorrow morning' | 'Custom'
  scheduledJobId?: string
  schedule?: string
  context: string
  status: 'Task Created' | 'Manual Research Job' | 'Later' | 'Scheduled Hermes Job'
  createdAt: string
}

export type ResearchReviewStatus = 'Pending Review' | 'Approved' | 'Rejected' | 'To Verify'

export interface ResearchReviewFinding {
  id: string
  summary: string
  keyClaim: string
  area: EvidenceArea
  evidenceStatus: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  source?: SourceReference | null
  suggestedTask?: string
  suggestedInvestorMaterial?: string
  riskNote?: string
  status: ResearchReviewStatus
  createdAt: string
  reviewedAt?: string
}

export interface FinancialModelSnapshot {
  id: string
  scenarioName: string
  projectName: string
  currency: string
  evidenceStatus: IntelligenceEvidenceStatus
  npv: number
  irr: number | null
  mirr: number | null
  investorIrr?: number | null
  investorMoic?: number | null
  investorExitProceeds?: number | null
  fundingGap?: number
  paybackYear: number | null
  breakEvenVolumeTon: number | null
  capexTotal: number
  yearOneRevenue: number
  warnings: string[]
  source?: SourceReference | null
  createdAt: string
}

export interface DataRoomSourceRecord {
  id: string
  checklistLabel: string
  area: EvidenceArea
  evidenceStatus: IntelligenceEvidenceStatus
  source: SourceReference | null
  notes: string
  updatedAt: string
}

export interface FeasibilityIntelligenceState {
  evidenceItems: FeasibilityEvidenceItem[]
  marketClaims: MarketClaim[]
  competitors: CompetitorIntelligenceRecord[]
  presentationMaterials: PresentationMaterial[]
  researchJobs: ResearchJobRecord[]
  researchFindings: ResearchReviewFinding[]
  financialModels: FinancialModelSnapshot[]
  dataRoomSources: DataRoomSourceRecord[]
}

const STORAGE_KEY = 'hermes.feasibilityIntelligence.v1'

const defaultEvidenceItems: FeasibilityEvidenceItem[] = [
  {
    id: 'companyLegal',
    label: 'Company / legal evidence',
    evidenceStatus: 'To Verify',
    description: 'Business license, company name, business scope, bank confirmation, import/export permission.',
    nextAction: 'Upload source documents or create evidence tasks before using this in investor material.',
    weight: 1.2,
  },
  {
    id: 'product',
    label: 'Product evidence',
    evidenceStatus: 'To Verify',
    description: 'TDS/SDS, formula/CAS list, product equivalents, and verified launch-product scope.',
    nextAction: 'Collect and source product documents for CWAS 90%+ and CWMS 70%.',
    weight: 1.2,
  },
  {
    id: 'factory',
    label: 'Factory evidence',
    evidenceStatus: 'Missing',
    description: 'Location shortlist, rent offers, chemical approval, machine quotes, utilities, waste treatment.',
    nextAction: 'Create tasks for quote collection and site approval checks.',
    weight: 1.1,
  },
  {
    id: 'regulatory',
    label: 'Regulatory evidence',
    evidenceStatus: 'Missing',
    description: 'DMS status, product handling, China chemical permissions, safety/fire and environmental requirements.',
    nextAction: 'Run source-backed regulatory research and track every gap as a task.',
    weight: 1.3,
  },
  {
    id: 'market',
    label: 'Market evidence',
    evidenceStatus: 'To Verify',
    description: 'Customer interviews, distributor responses, competitor price proof, and sourced demand claims.',
    nextAction: 'Use Market and Competitor Intelligence to collect source-backed claims only.',
    weight: 1.2,
  },
  {
    id: 'financial',
    label: 'Financial model completeness',
    evidenceStatus: 'Assumption',
    description: 'Year 1 15,000 MT model, working capital, capex, opex, pricing, tax, and IRR sensitivity.',
    nextAction: 'Use the IRR calculator and label every input by evidence status.',
    weight: 1.2,
  },
  {
    id: 'presentation',
    label: 'Investor presentation completeness',
    evidenceStatus: 'Missing',
    description: 'Executive story, evidence-backed claims, use of funds, risks, and data-room readiness.',
    nextAction: 'Build draft slides only from verified or user-approved material.',
    weight: 1,
  },
]

function emptyState(): FeasibilityIntelligenceState {
  return {
    evidenceItems: defaultEvidenceItems.map(item => ({ ...item })),
    marketClaims: [],
    competitors: [],
    presentationMaterials: [],
    researchJobs: [],
    researchFindings: [],
    financialModels: [],
    dataRoomSources: [],
  }
}

const state = ref<FeasibilityIntelligenceState>(emptyState())
let loaded = false

function nowIso(): string {
  return new Date().toISOString()
}

function mergeState(raw: Partial<FeasibilityIntelligenceState> | null): FeasibilityIntelligenceState {
  const fallback = emptyState()
  if (!raw || typeof raw !== 'object') return fallback
  const evidenceById = new Map(fallback.evidenceItems.map(item => [item.id, item]))
  for (const item of Array.isArray(raw.evidenceItems) ? raw.evidenceItems : []) {
    if (!item || typeof item !== 'object') continue
    const id = (item as FeasibilityEvidenceItem).id
    if (evidenceById.has(id)) {
      evidenceById.set(id, { ...evidenceById.get(id)!, ...item })
    }
  }
  return {
    evidenceItems: Array.from(evidenceById.values()),
    marketClaims: Array.isArray(raw.marketClaims)
      ? raw.marketClaims.map((claim, index) => ({
          ...claim,
          id: (claim as MarketClaim).id || idFrom('market', `${(claim as MarketClaim).label || 'claim'}-${index}`),
        }))
      : [],
    competitors: Array.isArray(raw.competitors) ? raw.competitors : [],
    presentationMaterials: Array.isArray(raw.presentationMaterials)
      ? raw.presentationMaterials.map((material, index) => normalizePresentationMaterial(material, index))
      : [],
    researchJobs: Array.isArray(raw.researchJobs)
      ? raw.researchJobs.map((record, index) => normalizeResearchJobRecord(record, index))
      : [],
    researchFindings: Array.isArray(raw.researchFindings) ? raw.researchFindings : [],
    financialModels: Array.isArray(raw.financialModels) ? raw.financialModels : [],
    dataRoomSources: Array.isArray(raw.dataRoomSources)
      ? raw.dataRoomSources.map((record, index) => normalizeDataRoomSourceRecord(record, index))
      : [],
  }
}

function loadState(): FeasibilityIntelligenceState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return mergeState(raw ? JSON.parse(raw) : null)
  } catch {
    return emptyState()
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

function idFrom(prefix: string, label: string): string {
  return `${prefix}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`
}

function sourceIsUsable(source?: SourceReference | null): boolean {
  return Boolean(source?.title?.trim() && (source.url?.trim() || source.date?.trim()))
}

function sourceReferencesEqual(a?: SourceReference | null, b?: SourceReference | null): boolean {
  if (!a?.title || !b?.title) return false
  return a.title.trim() === b.title.trim() &&
    (a.url || '').trim() === (b.url || '').trim() &&
    (a.date || '').trim() === (b.date || '').trim()
}

function normalizePresentationMaterial(material: PresentationMaterial, index = 0): PresentationMaterial {
  return {
    ...material,
    id: material.id || idFrom('deck', `${material.section || 'material'}-${index}`),
    evidenceStatus: material.evidenceStatus === 'Verified' && !sourceIsUsable(material.source)
      ? 'To Verify'
      : material.evidenceStatus,
    source: material.source || null,
    updatedAt: material.updatedAt || nowIso(),
  }
}

function normalizeDataRoomSourceRecord(record: DataRoomSourceRecord, index = 0): DataRoomSourceRecord {
  return {
    ...record,
    id: record.id || idFrom('source', `${record.checklistLabel || 'data-room'}-${index}`),
    evidenceStatus: record.evidenceStatus === 'Verified' && !sourceIsUsable(record.source)
      ? 'To Verify'
      : record.evidenceStatus,
    source: record.source || null,
    notes: record.notes || '',
    updatedAt: record.updatedAt || nowIso(),
  }
}

function normalizeResearchJobRecord(record: ResearchJobRecord, index = 0): ResearchJobRecord {
  return {
    ...record,
    id: record.id || idFrom('research', `${record.title || 'job'}-${index}`),
    title: record.title || 'Untitled research job',
    question: record.question || 'Research question to define.',
    context: record.context || 'General Research',
    status: record.status || 'Manual Research Job',
    createdAt: record.createdAt || nowIso(),
  }
}

export function useFeasibilityIntelligence() {
  ensureLoaded()

  const readinessScore = computed(() => calculateInvestorReadinessScore(state.value.evidenceItems))
  const evidenceGaps = computed(() =>
    state.value.evidenceItems.filter(item => item.evidenceStatus === 'Missing' || item.evidenceStatus === 'To Verify'),
  )
  const verifiedClaimCount = computed(() =>
    state.value.marketClaims.filter(item => normalizedMarketClaimStatus(item) === 'Verified').length,
  )
  const approvedPresentationCount = computed(() =>
    state.value.presentationMaterials.filter(isPresentationMaterialAllowed).length,
  )
  const pendingResearchFindings = computed(() =>
    state.value.researchFindings.filter(item => item.status === 'Pending Review' || item.status === 'To Verify'),
  )
  const latestFinancialModel = computed(() => state.value.financialModels[0] || null)
  const verifiedDataRoomSourceCount = computed(() =>
    state.value.dataRoomSources.filter(item => item.evidenceStatus === 'Verified').length,
  )

  function updateEvidenceStatus(
    id: EvidenceArea,
    evidenceStatus: IntelligenceEvidenceStatus,
    source?: SourceReference | null,
    sourceRecordId: string | null = null,
  ) {
    state.value.evidenceItems = state.value.evidenceItems.map(item => {
      if (item.id !== id) return item
      const nextStatus = evidenceStatus === 'Verified' && !sourceIsUsable(source) ? 'To Verify' : evidenceStatus
      return {
        ...item,
        evidenceStatus: nextStatus,
        source: source || item.source || null,
        sourceRecordId,
        updatedAt: nowIso(),
      }
    })
    persist()
  }

  function addMarketClaim(claim: Omit<MarketClaim, 'lastChecked'> & { lastChecked?: string }) {
    const normalized: MarketClaim = {
      ...claim,
      id: claim.id || idFrom('market', claim.label || 'claim'),
      evidenceStatus: normalizedMarketClaimStatus(claim),
      lastChecked: claim.lastChecked || nowIso().slice(0, 10),
    }
    state.value.marketClaims = [normalized, ...state.value.marketClaims]
    persist()
    return normalized
  }

  function removeMarketClaim(id: string): boolean {
    const before = state.value.marketClaims.length
    state.value.marketClaims = state.value.marketClaims.filter(item => item.id !== id)
    const removed = state.value.marketClaims.length !== before
    if (removed) persist()
    return removed
  }

  function updateMarketClaim(id: string, patch: Partial<Omit<MarketClaim, 'id'>>): MarketClaim | null {
    const index = state.value.marketClaims.findIndex(item => item.id === id)
    if (index === -1) return null
    const merged: MarketClaim = {
      ...state.value.marketClaims[index],
      ...patch,
      id,
      lastChecked: patch.lastChecked || nowIso().slice(0, 10),
    }
    const updated: MarketClaim = {
      ...merged,
      evidenceStatus: normalizedMarketClaimStatus(merged),
    }
    state.value.marketClaims = [
      ...state.value.marketClaims.slice(0, index),
      updated,
      ...state.value.marketClaims.slice(index + 1),
    ]
    persist()
    return updated
  }

  function addCompetitor(record: Omit<CompetitorIntelligenceRecord, 'id' | 'updatedAt'>) {
    const saved: CompetitorIntelligenceRecord = {
      ...record,
      id: idFrom('competitor', record.companyName || 'unknown'),
      marketShare: record.marketShare?.trim() || '',
      evidenceStatus: record.evidenceStatus === 'Verified' && !sourceIsUsable(record.source) ? 'To Verify' : record.evidenceStatus,
      updatedAt: nowIso(),
    }
    state.value.competitors = [saved, ...state.value.competitors]
    persist()
    return saved
  }

  function updateCompetitor(
    id: string,
    patch: Partial<Omit<CompetitorIntelligenceRecord, 'id' | 'updatedAt'>>,
  ): CompetitorIntelligenceRecord | null {
    const index = state.value.competitors.findIndex(item => item.id === id)
    if (index === -1) return null
    const merged: CompetitorIntelligenceRecord = {
      ...state.value.competitors[index],
      ...patch,
      id,
      marketShare: patch.marketShare?.trim() ?? state.value.competitors[index].marketShare,
      updatedAt: nowIso(),
    }
    const updated: CompetitorIntelligenceRecord = {
      ...merged,
      evidenceStatus: merged.evidenceStatus === 'Verified' && !sourceIsUsable(merged.source)
        ? 'To Verify'
        : merged.evidenceStatus,
    }
    state.value.competitors = [
      ...state.value.competitors.slice(0, index),
      updated,
      ...state.value.competitors.slice(index + 1),
    ]
    persist()
    return updated
  }

  function removeCompetitor(id: string): boolean {
    const before = state.value.competitors.length
    state.value.competitors = state.value.competitors.filter(item => item.id !== id)
    const removed = state.value.competitors.length !== before
    if (removed) persist()
    return removed
  }

  function addPresentationMaterial(material: PresentationMaterial) {
    const saved = normalizePresentationMaterial(material)
    state.value.presentationMaterials = [saved, ...state.value.presentationMaterials]
    persist()
    return saved
  }

  function updatePresentationMaterial(id: string, patch: Partial<Omit<PresentationMaterial, 'id'>>): PresentationMaterial | null {
    const index = state.value.presentationMaterials.findIndex(item => item.id === id)
    if (index === -1) return null
    const updated = normalizePresentationMaterial({
      ...state.value.presentationMaterials[index],
      ...patch,
      id,
      updatedAt: nowIso(),
    }, index)
    state.value.presentationMaterials = [
      ...state.value.presentationMaterials.slice(0, index),
      updated,
      ...state.value.presentationMaterials.slice(index + 1),
    ]
    persist()
    return updated
  }

  function removePresentationMaterial(id: string): boolean {
    const before = state.value.presentationMaterials.length
    state.value.presentationMaterials = state.value.presentationMaterials.filter(item => item.id !== id)
    const removed = state.value.presentationMaterials.length !== before
    if (removed) persist()
    return removed
  }

  function addResearchJob(job: Omit<ResearchJobRecord, 'id' | 'createdAt'>) {
    const saved = normalizeResearchJobRecord({
      ...job,
      id: idFrom('research', job.title),
      createdAt: nowIso(),
    })
    state.value.researchJobs = [saved, ...state.value.researchJobs]
    persist()
    return saved
  }

  function updateResearchJobStatus(id: string, status: ResearchJobRecord['status']): ResearchJobRecord | null {
    const index = state.value.researchJobs.findIndex(item => item.id === id)
    if (index === -1) return null
    const updated: ResearchJobRecord = {
      ...state.value.researchJobs[index],
      status,
    }
    state.value.researchJobs = [
      ...state.value.researchJobs.slice(0, index),
      updated,
      ...state.value.researchJobs.slice(index + 1),
    ]
    persist()
    return updated
  }

  function addResearchFinding(finding: Omit<ResearchReviewFinding, 'id' | 'createdAt' | 'status'> & { status?: ResearchReviewStatus }) {
    const evidenceStatus = finding.evidenceStatus === 'Verified' && !sourceIsUsable(finding.source)
      ? 'To Verify'
      : finding.evidenceStatus
    const saved: ResearchReviewFinding = {
      ...finding,
      id: idFrom('finding', finding.keyClaim || finding.summary),
      evidenceStatus,
      status: finding.status || 'Pending Review',
      createdAt: nowIso(),
    }
    state.value.researchFindings = [saved, ...state.value.researchFindings]
    persist()
    return saved
  }

  function approveResearchFinding(
    id: string,
    options: {
      evidenceStatus?: IntelligenceEvidenceStatus
      updateReadiness?: boolean
      addToPresentation?: boolean
    } = {},
  ): ResearchReviewFinding | null {
    const index = state.value.researchFindings.findIndex(item => item.id === id)
    if (index === -1) return null
    const current = state.value.researchFindings[index]
    const requestedStatus = options.evidenceStatus || current.evidenceStatus
    const evidenceStatus = requestedStatus === 'Verified' && !sourceIsUsable(current.source)
      ? 'To Verify'
      : requestedStatus
    const approved: ResearchReviewFinding = {
      ...current,
      evidenceStatus,
      status: evidenceStatus === 'Missing' || evidenceStatus === 'To Verify' ? 'To Verify' : 'Approved',
      reviewedAt: nowIso(),
    }
    state.value.researchFindings = [
      ...state.value.researchFindings.slice(0, index),
      approved,
      ...state.value.researchFindings.slice(index + 1),
    ]
    if (options.updateReadiness) {
      updateEvidenceStatus(approved.area, approved.evidenceStatus, approved.source || null)
    }
    if (
      options.addToPresentation &&
      approved.suggestedInvestorMaterial?.trim() &&
      (approved.evidenceStatus === 'Verified' ||
        approved.evidenceStatus === 'User Provided' ||
        approved.evidenceStatus === 'User Approved' ||
        approved.evidenceStatus === 'Approved Assumption' ||
        approved.evidenceStatus === 'Assumption')
    ) {
      addPresentationMaterial({
        section: presentationSectionForEvidence(
          approved.area,
          `${approved.keyClaim} ${approved.summary} ${approved.suggestedInvestorMaterial}`,
        ),
        content: approved.suggestedInvestorMaterial,
        evidenceStatus: approved.evidenceStatus === 'Assumption'
          ? 'Approved Assumption'
          : approved.evidenceStatus === 'User Provided'
            ? 'User Approved'
            : approved.evidenceStatus,
        source: approved.source || null,
      })
      updateEvidenceStatus('presentation', 'User Approved')
    }
    persist()
    return approved
  }

  function rejectResearchFinding(id: string): ResearchReviewFinding | null {
    const index = state.value.researchFindings.findIndex(item => item.id === id)
    if (index === -1) return null
    const rejected: ResearchReviewFinding = {
      ...state.value.researchFindings[index],
      status: 'Rejected',
      reviewedAt: nowIso(),
    }
    state.value.researchFindings = [
      ...state.value.researchFindings.slice(0, index),
      rejected,
      ...state.value.researchFindings.slice(index + 1),
    ]
    persist()
    return rejected
  }

  function saveFinancialModelSnapshot(snapshot: Omit<FinancialModelSnapshot, 'id' | 'createdAt'>) {
    const saved: FinancialModelSnapshot = {
      ...snapshot,
      id: idFrom('financial', `${snapshot.scenarioName}-${snapshot.projectName}`),
      createdAt: nowIso(),
    }
    state.value.financialModels = [saved, ...state.value.financialModels].slice(0, 12)
    updateEvidenceStatus('financial', saved.evidenceStatus, saved.source || null)
    persist()
    return saved
  }

  function addDataRoomSource(record: Omit<DataRoomSourceRecord, 'id' | 'updatedAt'>) {
    const saved = normalizeDataRoomSourceRecord({
      ...record,
      id: idFrom('source', record.checklistLabel || record.area),
      updatedAt: nowIso(),
    })
    state.value.dataRoomSources = [saved, ...state.value.dataRoomSources]
    updateEvidenceStatus(saved.area, saved.evidenceStatus, saved.source || null, saved.id)
    persist()
    return saved
  }

  function reconcileEvidenceAfterDataRoomSourceRemoval(removed: DataRoomSourceRecord) {
    const evidenceIndex = state.value.evidenceItems.findIndex(item => item.id === removed.area)
    if (evidenceIndex === -1) return

    const current = state.value.evidenceItems[evidenceIndex]
    const linkedToRemovedSource = current.sourceRecordId === removed.id ||
      (!current.sourceRecordId && sourceReferencesEqual(current.source, removed.source))

    if (!linkedToRemovedSource) return

    const fallback = state.value.dataRoomSources.find(record => record.area === removed.area)
    const nextStatus = fallback?.evidenceStatus || 'To Verify'
    const nextSource = fallback?.source || null

    state.value.evidenceItems = [
      ...state.value.evidenceItems.slice(0, evidenceIndex),
      {
        ...current,
        evidenceStatus: nextStatus === 'Verified' && !sourceIsUsable(nextSource) ? 'To Verify' : nextStatus,
        source: nextSource,
        sourceRecordId: fallback?.id || null,
        updatedAt: nowIso(),
      },
      ...state.value.evidenceItems.slice(evidenceIndex + 1),
    ]
  }

  function removeDataRoomSource(id: string): boolean {
    const removedRecord = state.value.dataRoomSources.find(item => item.id === id)
    const before = state.value.dataRoomSources.length
    state.value.dataRoomSources = state.value.dataRoomSources.filter(item => item.id !== id)
    const removed = state.value.dataRoomSources.length !== before
    if (removed && removedRecord) reconcileEvidenceAfterDataRoomSourceRemoval(removedRecord)
    if (removed) persist()
    return removed
  }

  function resetFeasibilityIntelligenceForTests() {
    state.value = emptyState()
    loaded = true
    persist()
  }

  return {
    state,
    readinessScore,
    evidenceGaps,
    verifiedClaimCount,
    approvedPresentationCount,
    pendingResearchFindings,
    latestFinancialModel,
    verifiedDataRoomSourceCount,
    updateEvidenceStatus,
    addMarketClaim,
    updateMarketClaim,
    removeMarketClaim,
    addCompetitor,
    updateCompetitor,
    removeCompetitor,
    addPresentationMaterial,
    updatePresentationMaterial,
    removePresentationMaterial,
    addResearchJob,
    updateResearchJobStatus,
    addResearchFinding,
    approveResearchFinding,
    rejectResearchFinding,
    saveFinancialModelSnapshot,
    addDataRoomSource,
    removeDataRoomSource,
    resetFeasibilityIntelligenceForTests,
  }
}
