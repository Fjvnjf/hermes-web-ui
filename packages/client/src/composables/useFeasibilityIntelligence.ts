import { computed, ref } from 'vue'
import {
  fetchDashboardIntelligenceState,
  saveDashboardIntelligenceState,
} from '@/api/hermes/intelligence-state'
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
  fieldKey?: string
  dashboardGroup?: string
  proposedDashboardField?: string
  countryRegion: string
  productEquivalent: string
  productVariations?: string
  productVariationList?: string[]
  activeContent: string
  pricingEvidence: string
  certifications: string
  distributionPresence: string
  marketShare?: string
  revenue?: string
  yearlyGrowth?: string
  traffic?: string
  rating?: string
  lastUpdated?: string
  metricEvidence?: Partial<Record<
    'pricingEvidence' | 'marketShare' | 'revenue' | 'yearlyGrowth' | 'traffic' | 'rating' | 'lastUpdated',
    {
      value?: string
      source?: SourceReference | null
      sourceTier?: string
      evidenceStatus?: IntelligenceEvidenceStatus | string
      confidence?: 'low' | 'medium' | 'high' | string
      reviewRequired?: boolean
      dataType?: string
      lastChecked?: string
      sourceDate?: string
      riskReason?: string
    }
  >>
  evidenceStatus: IntelligenceEvidenceStatus
  source?: SourceReference | null
  sources?: SourceReference[]
  sourceCount?: number
  sourceTier?: string
  dataType?: string
  confidence?: 'low' | 'medium' | 'high' | string
  reviewRequired?: boolean
  riskReason?: string
  recommendedAction?: string
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
  dashboardGroup?: ResearchReviewDashboardTargetGroup
  sourceTier?: string
  dataType?: string
  reviewRequired?: boolean
  riskReason?: string
  riskNote?: string
  status: ResearchReviewStatus
  createdAt: string
  reviewedAt?: string
  dashboardTarget?: ResearchReviewDashboardTarget
  dashboardAppliedAt?: string
}

export type ResearchReviewDashboardTargetGroup =
  | 'marketClaims'
  | 'competitorRecords'
  | 'rawMaterialSignals'
  | 'supplierScorecards'
  | 'regulatoryFindings'
  | 'financialEvidence'
  | 'evidenceGaps'
  | 'suggestedTasks'
  | 'investorMaterialCandidates'

export interface ResearchReviewDashboardTarget {
  group: ResearchReviewDashboardTargetGroup
  dashboardGroup?: ResearchReviewDashboardTargetGroup
  screen?: string
  fieldKey?: string
  field?: string
  value?: string
  proposedDashboardField?: string
  companyName?: string
  countryRegion?: string
  productEquivalent?: string
  activeContent?: string
  pricingEvidence?: string
  certifications?: string
  distributionPresence?: string
  marketShare?: string
  revenue?: string
  yearlyGrowth?: string
  traffic?: string
  rating?: string
  lastUpdated?: string
  recommendedAction?: string
  supplier?: string
  material?: string
  section?: string
  content?: string
  sourceTier?: string
  reportedSourceTier?: string
  dataType?: string
  reviewRequired?: boolean
  reportedReviewRequired?: boolean
  riskReason?: string
  sensitive?: boolean
  runKey?: string
}

export type InvestorRiskEvidenceStatus = IntelligenceEvidenceStatus | 'Pending Review' | 'Unsupported'

export interface InvestorRiskRegisterItem {
  id: string
  title: string
  origin: string
  area: EvidenceArea
  evidenceStatus: InvestorRiskEvidenceStatus
  detail: string
  routeName: string
  priority: 1 | 2 | 3
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
  fieldKey?: string
  area: EvidenceArea
  evidenceStatus: IntelligenceEvidenceStatus
  source: SourceReference | null
  notes: string
  updatedAt: string
  dashboardGroup?: string
  proposedDashboardField?: string
  supplier?: string
  material?: string
  proposedValue?: string
  sourceTier?: string
  dataType?: string
  confidence?: 'low' | 'medium' | 'high' | string
  reviewRequired?: boolean
  riskReason?: string
}

export interface SupplierScorecardRecord {
  id: string
  fieldKey?: string
  dashboardGroup?: string
  group?: string
  supplier: string
  material: string
  proposedDashboardField?: string
  value?: string
  source?: SourceReference | null
  sourceTier?: string
  reportedSourceTier?: string
  sourceDate?: string
  lastChecked?: string
  confidence?: 'low' | 'medium' | 'high' | string
  evidenceStatus: IntelligenceEvidenceStatus
  reviewRequired?: boolean
  reportedReviewRequired?: boolean
  dataType?: string
  pricePerTon?: string
  quality?: string
  reliability?: string
  payment?: string
  score?: string
  riskReason?: string
  notes?: string
  updatedAt?: string
}

export interface RawMaterialSignalRecord {
  id: string
  fieldKey?: string
  dashboardGroup?: string
  group?: string
  material: string
  label?: string
  proposedDashboardField?: string
  value?: string
  cas?: string
  formula?: string
  source?: SourceReference | null
  sourceTier?: string
  reportedSourceTier?: string
  sourceDate?: string
  lastChecked?: string
  confidence?: 'low' | 'medium' | 'high' | string
  evidenceStatus: IntelligenceEvidenceStatus
  reviewRequired?: boolean
  reportedReviewRequired?: boolean
  dataType?: string
  pricePerTon?: string
  priceStatus?: string
  riskReason?: string
  notes?: string
  updatedAt?: string
}

export interface FeasibilityIntelligenceState {
  evidenceItems: FeasibilityEvidenceItem[]
  marketClaims: MarketClaim[]
  competitors: CompetitorIntelligenceRecord[]
  presentationMaterials: PresentationMaterial[]
  researchJobs: ResearchJobRecord[]
  researchFindings: ResearchReviewFinding[]
  financialModels: FinancialModelSnapshot[]
  rawMaterialSignals: RawMaterialSignalRecord[]
  supplierScorecards: SupplierScorecardRecord[]
  dataRoomSources: DataRoomSourceRecord[]
}

const STORAGE_KEY = 'hermes.feasibilityIntelligence.v1'
const LOCAL_STORAGE_TEXT_LIMIT = 480
const LOCAL_STORAGE_LONG_TEXT_LIMIT = 900
const LOCAL_STORAGE_SOURCE_LIMIT = 12
const LOCAL_STORAGE_LIMITS = {
  marketClaims: 240,
  competitors: 80,
  presentationMaterials: 120,
  researchJobs: 80,
  researchFindings: 120,
  financialModels: 16,
  rawMaterialSignals: 100,
  supplierScorecards: 80,
  dataRoomSources: 200,
}
const LOCAL_STORAGE_FALLBACK_LIMITS = {
  marketClaims: 120,
  competitors: 40,
  presentationMaterials: 40,
  researchJobs: 30,
  researchFindings: 40,
  financialModels: 8,
  rawMaterialSignals: 50,
  supplierScorecards: 40,
  dataRoomSources: 80,
}

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
    rawMaterialSignals: [],
    supplierScorecards: [],
    dataRoomSources: [],
  }
}

const state = ref<FeasibilityIntelligenceState>(emptyState())
const serverSyncStatus = ref({
  enabled: false,
  hydrated: false,
  saving: false,
  lastLoadedAt: '',
  lastSavedAt: '',
  error: '',
})
let loaded = false
let idSequence = 0
let serverSyncEnabled = false
let serverHydratePromise: Promise<FeasibilityIntelligenceState> | null = null
let serverPersistTimer: number | null = null

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
    competitors: Array.isArray(raw.competitors)
      ? raw.competitors.map((record, index) => normalizeCompetitorRecord(record, index))
      : [],
    presentationMaterials: Array.isArray(raw.presentationMaterials)
      ? raw.presentationMaterials.map((material, index) => normalizePresentationMaterial(material, index))
      : [],
    researchJobs: Array.isArray(raw.researchJobs)
      ? raw.researchJobs.map((record, index) => normalizeResearchJobRecord(record, index))
      : [],
    researchFindings: Array.isArray(raw.researchFindings) ? raw.researchFindings : [],
    financialModels: Array.isArray(raw.financialModels) ? raw.financialModels : [],
    rawMaterialSignals: Array.isArray((raw as Partial<FeasibilityIntelligenceState>).rawMaterialSignals)
      ? (raw as Partial<FeasibilityIntelligenceState>).rawMaterialSignals!.map((record, index) => ({
          ...record,
          id: record.id || idFrom('raw-material-signal', `${record.material || record.label || 'material'}-${index}`),
          material: record.material || record.label || 'Raw material',
          evidenceStatus: record.evidenceStatus || 'To Verify',
          source: record.source || null,
        }))
      : [],
    supplierScorecards: Array.isArray((raw as Partial<FeasibilityIntelligenceState>).supplierScorecards)
      ? (raw as Partial<FeasibilityIntelligenceState>).supplierScorecards!.map((record, index) => ({
          ...record,
          id: record.id || idFrom('supplier-scorecard', `${record.supplier || 'supplier'}-${record.material || 'material'}-${index}`),
          evidenceStatus: record.evidenceStatus || 'To Verify',
          source: record.source || null,
        }))
      : [],
    dataRoomSources: Array.isArray(raw.dataRoomSources)
      ? raw.dataRoomSources.map((record, index) => normalizeDataRoomSourceRecord(record, index))
      : [],
  }
}

function truncateLocalStorageText(value: unknown, maxLength = LOCAL_STORAGE_TEXT_LIMIT): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function compactSourceForLocalStorage(source?: SourceReference | null): SourceReference | null {
  if (!source) return null
  return {
    title: truncateLocalStorageText(source.title, 240),
    url: truncateLocalStorageText(source.url, 360),
    date: truncateLocalStorageText(source.date, 80),
  }
}

function compactTargetForLocalStorage(target?: ResearchReviewDashboardTarget): ResearchReviewDashboardTarget | undefined {
  if (!target) return undefined
  return {
    ...target,
    fieldKey: truncateLocalStorageText(target.fieldKey, 240),
    field: truncateLocalStorageText(target.field, 240),
    value: truncateLocalStorageText(target.value, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    proposedDashboardField: truncateLocalStorageText(target.proposedDashboardField, 240),
    companyName: truncateLocalStorageText(target.companyName, 160),
    countryRegion: truncateLocalStorageText(target.countryRegion, 160),
    productEquivalent: truncateLocalStorageText(target.productEquivalent, 360),
    activeContent: truncateLocalStorageText(target.activeContent, 360),
    pricingEvidence: truncateLocalStorageText(target.pricingEvidence, 360),
    certifications: truncateLocalStorageText(target.certifications, 360),
    distributionPresence: truncateLocalStorageText(target.distributionPresence, 360),
    marketShare: truncateLocalStorageText(target.marketShare, 360),
    revenue: truncateLocalStorageText(target.revenue, 360),
    yearlyGrowth: truncateLocalStorageText(target.yearlyGrowth, 360),
    traffic: truncateLocalStorageText(target.traffic, 360),
    rating: truncateLocalStorageText(target.rating, 360),
    lastUpdated: truncateLocalStorageText(target.lastUpdated, 360),
    supplier: truncateLocalStorageText(target.supplier, 160),
    material: truncateLocalStorageText(target.material, 160),
    section: truncateLocalStorageText(target.section, 240),
    content: truncateLocalStorageText(target.content, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    sourceTier: truncateLocalStorageText(target.sourceTier, 160),
    reportedSourceTier: truncateLocalStorageText(target.reportedSourceTier, 160),
    dataType: truncateLocalStorageText(target.dataType, 160),
    riskReason: truncateLocalStorageText(target.riskReason, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    runKey: truncateLocalStorageText(target.runKey, 240),
  }
}

function compactMetricEvidenceForLocalStorage(
  metricEvidence: CompetitorIntelligenceRecord['metricEvidence'],
): CompetitorIntelligenceRecord['metricEvidence'] {
  if (!metricEvidence) return undefined
  const compacted: CompetitorIntelligenceRecord['metricEvidence'] = {}
  for (const [key, metric] of Object.entries(metricEvidence)) {
    if (!metric) continue
    compacted[key as keyof NonNullable<CompetitorIntelligenceRecord['metricEvidence']>] = {
      ...metric,
      value: truncateLocalStorageText(metric.value, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      source: compactSourceForLocalStorage(metric.source),
      sourceTier: truncateLocalStorageText(metric.sourceTier, 160),
      evidenceStatus: truncateLocalStorageText(metric.evidenceStatus, 120),
      confidence: truncateLocalStorageText(metric.confidence, 80),
      dataType: truncateLocalStorageText(metric.dataType, 160),
      lastChecked: truncateLocalStorageText(metric.lastChecked, 120),
      sourceDate: truncateLocalStorageText(metric.sourceDate, 120),
      riskReason: truncateLocalStorageText(metric.riskReason, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    }
  }
  return compacted
}

function compactCompetitorForLocalStorage(record: CompetitorIntelligenceRecord): CompetitorIntelligenceRecord {
  return {
    ...record,
    companyName: truncateLocalStorageText(record.companyName, 160),
    countryRegion: truncateLocalStorageText(record.countryRegion, 180),
    productEquivalent: truncateLocalStorageText(record.productEquivalent, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    productVariations: truncateLocalStorageText(record.productVariations, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    productVariationList: record.productVariationList?.slice(0, 16).map(item => truncateLocalStorageText(item, 260)),
    activeContent: truncateLocalStorageText(record.activeContent, 720),
    pricingEvidence: truncateLocalStorageText(record.pricingEvidence, 720),
    certifications: truncateLocalStorageText(record.certifications, 720),
    distributionPresence: truncateLocalStorageText(record.distributionPresence, 720),
    marketShare: truncateLocalStorageText(record.marketShare, 720),
    revenue: truncateLocalStorageText(record.revenue, 720),
    yearlyGrowth: truncateLocalStorageText(record.yearlyGrowth, 720),
    traffic: truncateLocalStorageText(record.traffic, 720),
    rating: truncateLocalStorageText(record.rating, 720),
    lastUpdated: truncateLocalStorageText(record.lastUpdated, 720),
    metricEvidence: compactMetricEvidenceForLocalStorage(record.metricEvidence),
    source: compactSourceForLocalStorage(record.source),
    sources: record.sources?.slice(0, LOCAL_STORAGE_SOURCE_LIMIT).map(compactSourceForLocalStorage).filter(Boolean) as SourceReference[] | undefined,
    sourceTier: truncateLocalStorageText(record.sourceTier, 160),
    dataType: truncateLocalStorageText(record.dataType, 160),
    confidence: truncateLocalStorageText(record.confidence, 80),
    riskReason: truncateLocalStorageText(record.riskReason, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    notes: truncateLocalStorageText(record.notes, LOCAL_STORAGE_LONG_TEXT_LIMIT),
  }
}

function compactStateForLocalStorage(
  input: FeasibilityIntelligenceState,
  limits = LOCAL_STORAGE_LIMITS,
): FeasibilityIntelligenceState {
  return {
    evidenceItems: input.evidenceItems.map(item => ({
      ...item,
      description: truncateLocalStorageText(item.description, 720),
      nextAction: truncateLocalStorageText(item.nextAction, 720),
      source: compactSourceForLocalStorage(item.source),
    })),
    marketClaims: input.marketClaims.slice(0, limits.marketClaims).map(claim => ({
      ...claim,
      label: truncateLocalStorageText(claim.label, 320),
      value: truncateLocalStorageText(claim.value, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      source: compactSourceForLocalStorage(claim.source),
      sourceTier: truncateLocalStorageText(claim.sourceTier, 160),
      dataType: truncateLocalStorageText(claim.dataType, 160),
      confidence: claim.confidence,
      riskReason: truncateLocalStorageText(claim.riskReason, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    })),
    competitors: input.competitors.slice(0, limits.competitors).map(compactCompetitorForLocalStorage),
    presentationMaterials: input.presentationMaterials.slice(0, limits.presentationMaterials).map(material => ({
      ...material,
      section: truncateLocalStorageText(material.section, 240),
      content: truncateLocalStorageText(material.content, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      source: compactSourceForLocalStorage(material.source),
    })),
    researchJobs: input.researchJobs.slice(0, limits.researchJobs).map(job => ({
      ...job,
      title: truncateLocalStorageText(job.title, 240),
      question: truncateLocalStorageText(job.question, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      scope: truncateLocalStorageText(job.scope, 720),
      expectedOutput: truncateLocalStorageText(job.expectedOutput, 720),
      sourceRequirements: truncateLocalStorageText(job.sourceRequirements, 720),
      context: truncateLocalStorageText(job.context, 240),
    })),
    researchFindings: input.researchFindings.slice(0, limits.researchFindings).map(finding => ({
      ...finding,
      summary: truncateLocalStorageText(finding.summary, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      keyClaim: truncateLocalStorageText(finding.keyClaim, 360),
      source: compactSourceForLocalStorage(finding.source),
      suggestedTask: truncateLocalStorageText(finding.suggestedTask, 720),
      suggestedInvestorMaterial: truncateLocalStorageText(finding.suggestedInvestorMaterial, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      sourceTier: truncateLocalStorageText(finding.sourceTier, 160),
      dataType: truncateLocalStorageText(finding.dataType, 160),
      riskReason: truncateLocalStorageText(finding.riskReason, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      riskNote: truncateLocalStorageText(finding.riskNote, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      dashboardTarget: compactTargetForLocalStorage(finding.dashboardTarget),
    })),
    financialModels: input.financialModels.slice(0, limits.financialModels).map(model => ({
      ...model,
      scenarioName: truncateLocalStorageText(model.scenarioName, 180),
      projectName: truncateLocalStorageText(model.projectName, 240),
      warnings: model.warnings.slice(0, 12).map(item => truncateLocalStorageText(item, 360)),
      source: compactSourceForLocalStorage(model.source),
    })),
    rawMaterialSignals: input.rawMaterialSignals.slice(0, limits.rawMaterialSignals).map(record => ({
      ...record,
      material: truncateLocalStorageText(record.material, 180),
      label: truncateLocalStorageText(record.label, 180),
      proposedDashboardField: truncateLocalStorageText(record.proposedDashboardField, 240),
      value: truncateLocalStorageText(record.value, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      cas: truncateLocalStorageText(record.cas, 80),
      formula: truncateLocalStorageText(record.formula, 120),
      source: compactSourceForLocalStorage(record.source),
      sourceTier: truncateLocalStorageText(record.sourceTier, 160),
      reportedSourceTier: truncateLocalStorageText(record.reportedSourceTier, 160),
      confidence: truncateLocalStorageText(record.confidence, 80),
      dataType: truncateLocalStorageText(record.dataType, 120),
      pricePerTon: truncateLocalStorageText(record.pricePerTon, 160),
      priceStatus: truncateLocalStorageText(record.priceStatus, 160),
      riskReason: truncateLocalStorageText(record.riskReason, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      notes: truncateLocalStorageText(record.notes, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    })),
    supplierScorecards: input.supplierScorecards.slice(0, limits.supplierScorecards).map(record => ({
      ...record,
      supplier: truncateLocalStorageText(record.supplier, 180),
      material: truncateLocalStorageText(record.material, 240),
      proposedDashboardField: truncateLocalStorageText(record.proposedDashboardField, 240),
      value: truncateLocalStorageText(record.value, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      source: compactSourceForLocalStorage(record.source),
      sourceTier: truncateLocalStorageText(record.sourceTier, 160),
      reportedSourceTier: truncateLocalStorageText(record.reportedSourceTier, 160),
      confidence: truncateLocalStorageText(record.confidence, 80),
      dataType: truncateLocalStorageText(record.dataType, 120),
      pricePerTon: truncateLocalStorageText(record.pricePerTon, 160),
      quality: truncateLocalStorageText(record.quality, 180),
      reliability: truncateLocalStorageText(record.reliability, 180),
      payment: truncateLocalStorageText(record.payment, 180),
      score: truncateLocalStorageText(record.score, 120),
      riskReason: truncateLocalStorageText(record.riskReason, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      notes: truncateLocalStorageText(record.notes, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    })),
    dataRoomSources: input.dataRoomSources.slice(0, limits.dataRoomSources).map(record => ({
      ...record,
      checklistLabel: truncateLocalStorageText(record.checklistLabel, 320),
      source: compactSourceForLocalStorage(record.source),
      notes: truncateLocalStorageText(record.notes, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      proposedValue: truncateLocalStorageText(record.proposedValue, LOCAL_STORAGE_LONG_TEXT_LIMIT),
      sourceTier: truncateLocalStorageText(record.sourceTier, 160),
      dataType: truncateLocalStorageText(record.dataType, 160),
      confidence: truncateLocalStorageText(record.confidence, 80),
      riskReason: truncateLocalStorageText(record.riskReason, LOCAL_STORAGE_LONG_TEXT_LIMIT),
    })),
  }
}

function writeLocalStorageState(value: FeasibilityIntelligenceState) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compactStateForLocalStorage(value)))
    return
  } catch (err) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compactStateForLocalStorage(value, LOCAL_STORAGE_FALLBACK_LIMITS)))
      return
    } catch {
      window.localStorage.removeItem(STORAGE_KEY)
      console.warn('[feasibility-intelligence] compact browser cache cleared after storage quota failure', err)
    }
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
  writeLocalStorageState(state.value)
  scheduleServerPersist()
}

function ensureLoaded() {
  if (loaded) return
  state.value = loadState()
  loaded = true
}

function persistLocalOnly() {
  writeLocalStorageState(state.value)
}

function scheduleServerPersist() {
  if (!serverSyncEnabled || typeof window === 'undefined') return
  if (serverPersistTimer) window.clearTimeout(serverPersistTimer)
  serverPersistTimer = window.setTimeout(() => {
    serverPersistTimer = null
    void persistFeasibilityIntelligenceToServer()
  }, 800)
}

async function persistFeasibilityIntelligenceToServer(): Promise<boolean> {
  if (!serverSyncEnabled) return false
  serverSyncStatus.value = {
    ...serverSyncStatus.value,
    enabled: true,
    saving: true,
    error: '',
  }
  try {
    const result = await saveDashboardIntelligenceState(state.value)
    serverSyncStatus.value = {
      ...serverSyncStatus.value,
      enabled: true,
      saving: false,
      lastSavedAt: result.savedAt || nowIso(),
      error: '',
    }
    return true
  } catch (err) {
    serverSyncStatus.value = {
      ...serverSyncStatus.value,
      enabled: true,
      saving: false,
      error: err instanceof Error ? err.message : 'Dashboard intelligence server sync failed',
    }
    return false
  }
}

async function hydrateFeasibilityIntelligenceFromServer(options: { seedServerIfEmpty?: boolean } = {}): Promise<FeasibilityIntelligenceState> {
  ensureLoaded()
  serverSyncEnabled = true
  serverSyncStatus.value = {
    ...serverSyncStatus.value,
    enabled: true,
    error: '',
  }

  if (serverHydratePromise) return serverHydratePromise

  serverHydratePromise = (async () => {
    try {
      const result = await fetchDashboardIntelligenceState()
      if (result.state) {
        state.value = mergeState(result.state as Partial<FeasibilityIntelligenceState>)
        loaded = true
        persistLocalOnly()
        serverSyncStatus.value = {
          ...serverSyncStatus.value,
          enabled: true,
          hydrated: true,
          lastLoadedAt: result.savedAt || nowIso(),
          error: '',
        }
        return state.value
      }

      serverSyncStatus.value = {
        ...serverSyncStatus.value,
        enabled: true,
        hydrated: true,
        lastLoadedAt: nowIso(),
        error: '',
      }
      if (options.seedServerIfEmpty !== false) {
        await persistFeasibilityIntelligenceToServer()
      }
      return state.value
    } catch (err) {
      serverSyncStatus.value = {
        ...serverSyncStatus.value,
        enabled: true,
        hydrated: false,
        error: err instanceof Error ? err.message : 'Dashboard intelligence server hydrate failed',
      }
      return state.value
    } finally {
      serverHydratePromise = null
    }
  })()

  return serverHydratePromise
}

function idFrom(prefix: string, label: string): string {
  idSequence += 1
  return `${prefix}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}-${idSequence.toString(36)}`
}

function sourceIsUsable(source?: SourceReference | null): boolean {
  return Boolean(source?.title?.trim() && (source.url?.trim() || source.date?.trim()))
}

function riskPriority(area: EvidenceArea, evidenceStatus: InvestorRiskEvidenceStatus): 1 | 2 | 3 {
  if (evidenceStatus === 'Missing' || evidenceStatus === 'Unsupported') return 3
  if (area === 'regulatory' || area === 'factory' || area === 'financial') return 3
  if (evidenceStatus === 'To Verify' || evidenceStatus === 'Pending Review' || evidenceStatus === 'Hypothesis') return 2
  return 1
}

function isWeakStatus(status: IntelligenceEvidenceStatus): boolean {
  return status === 'Missing' ||
    status === 'To Verify' ||
    status === 'Hypothesis' ||
    status === 'Reference Only'
}

function routeForRiskEvidenceArea(id: EvidenceArea): string {
  if (id === 'companyLegal' || id === 'product') return 'hermes.files'
  if (id === 'factory') return 'hermes.kanban'
  if (id === 'regulatory') return 'hermes.chat'
  if (id === 'market') return 'hermes.marketIntelligence'
  if (id === 'financial') return 'hermes.investmentCalculator'
  return 'hermes.investorPresentation'
}

function sourceReferencesEqual(a?: SourceReference | null, b?: SourceReference | null): boolean {
  if (!a?.title || !b?.title) return false
  return a.title.trim() === b.title.trim() &&
    (a.url || '').trim() === (b.url || '').trim() &&
    (a.date || '').trim() === (b.date || '').trim()
}

type CompetitorMetricKey = keyof NonNullable<CompetitorIntelligenceRecord['metricEvidence']>

const competitorMetricKeys: CompetitorMetricKey[] = [
  'pricingEvidence',
  'marketShare',
  'revenue',
  'yearlyGrowth',
  'traffic',
  'rating',
  'lastUpdated',
]

function normalizeCompetitorRecord(record: CompetitorIntelligenceRecord, index = 0): CompetitorIntelligenceRecord {
  const source = record.source || null
  const sources = Array.isArray(record.sources) ? record.sources.filter(sourceIsUsable) : []
  const metricEvidence = { ...(record.metricEvidence || {}) }
  const hasMetricSource = Object.values(metricEvidence).some(evidence =>
    sourceIsUsable(evidence?.source) && evidence?.reviewRequired !== true,
  )
  return {
    ...record,
    id: record.id || idFrom('competitor', `${record.companyName || 'competitor'}-${index}`),
    companyName: record.companyName || 'Competitor to verify',
    countryRegion: record.countryRegion || 'To Verify',
    productEquivalent: record.productEquivalent || 'To Verify',
    activeContent: record.activeContent || 'To Verify',
    pricingEvidence: record.pricingEvidence || '',
    certifications: record.certifications || 'To Verify',
    distributionPresence: record.distributionPresence || 'To Verify',
    marketShare: record.marketShare?.trim() || '',
    revenue: record.revenue?.trim() || '',
    yearlyGrowth: record.yearlyGrowth?.trim() || '',
    traffic: record.traffic?.trim() || '',
    rating: record.rating?.trim() || '',
    lastUpdated: record.lastUpdated?.trim() || '',
    metricEvidence,
    evidenceStatus: record.evidenceStatus === 'Verified' && !sourceIsUsable(source) && !hasMetricSource
      ? 'To Verify'
      : record.evidenceStatus || 'To Verify',
    source,
    sources,
    sourceCount: sources.length || record.sourceCount,
    updatedAt: record.updatedAt || nowIso(),
  }
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

function nonEmpty(value?: string | null): string {
  return value?.trim() || ''
}

function approvedFindingStatus(finding: ResearchReviewFinding, requestedStatus: IntelligenceEvidenceStatus): IntelligenceEvidenceStatus {
  if (requestedStatus === 'Verified' && !sourceIsUsable(finding.source)) return 'To Verify'
  if (requestedStatus === 'To Verify' && sourceIsUsable(finding.source)) return 'User Approved'
  return requestedStatus
}

function competitorMetricEvidenceFromTarget(
  target: ResearchReviewDashboardTarget,
  finding: ResearchReviewFinding,
): CompetitorIntelligenceRecord['metricEvidence'] {
  const source = finding.source || null
  const metricEvidence: CompetitorIntelligenceRecord['metricEvidence'] = {}
  for (const key of competitorMetricKeys) {
    const value = nonEmpty(target[key])
    if (!value) continue
    metricEvidence[key] = {
      value,
      source,
      sourceTier: target.sourceTier,
      evidenceStatus: finding.evidenceStatus,
      confidence: finding.confidence,
      reviewRequired: false,
      dataType: target.dataType,
      lastChecked: finding.reviewedAt || nowIso(),
      sourceDate: source?.date,
      riskReason: target.riskReason || finding.riskNote,
    }
  }
  return metricEvidence
}

function dataRoomLabelForTarget(finding: ResearchReviewFinding): string {
  const target = finding.dashboardTarget
  return nonEmpty(target?.proposedDashboardField) ||
    nonEmpty(target?.field) ||
    nonEmpty(target?.supplier && target?.material ? `${target.supplier} / ${target.material}` : '') ||
    finding.keyClaim
}

function dataRoomNotesForTarget(finding: ResearchReviewFinding): string {
  const target = finding.dashboardTarget
  return [
    finding.summary,
    target?.value ? `Proposed value: ${target.value}` : '',
    target?.supplier ? `Supplier: ${target.supplier}` : '',
    target?.material ? `Material: ${target.material}` : '',
    target?.sourceTier ? `Source tier: ${target.sourceTier}` : '',
    target?.dataType ? `Data type: ${target.dataType}` : '',
    target?.sensitive ? 'Sensitivity: review-gated sensitive dashboard update' : '',
    finding.riskNote ? `Risk note: ${finding.riskNote}` : '',
    'Saved automatically from an approved Full Dashboard Autopilot finding. Keep the displayed evidence status and source label with this item.',
  ].filter(Boolean).join('\n')
}

function targetIsCommercialReviewGated(target: ResearchReviewDashboardTarget): boolean {
  return target.sensitive === true ||
    target.dataType === 'supplier_quote' ||
    target.dataType === 'price_data' ||
    target.reviewRequired === true ||
    target.reportedReviewRequired === true
}

function safeDashboardValueForTarget(target: ResearchReviewDashboardTarget, fallback = 'Source-backed evidence approved; commercial value remains in data-room audit.'): string {
  if (targetIsCommercialReviewGated(target)) return fallback
  return nonEmpty(target.value)
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
  const riskRegisterItems = computed<InvestorRiskRegisterItem[]>(() => {
    const risks: InvestorRiskRegisterItem[] = []

    for (const item of state.value.evidenceItems) {
      if (!isWeakStatus(item.evidenceStatus)) continue
      risks.push({
        id: `evidence-${item.id}`,
        title: item.label,
        origin: 'Evidence gap',
        area: item.id,
        evidenceStatus: item.evidenceStatus,
        detail: item.nextAction,
        routeName: routeForRiskEvidenceArea(item.id),
        priority: riskPriority(item.id, item.evidenceStatus),
      })
    }

    for (const finding of state.value.researchFindings) {
      if (finding.status !== 'Pending Review' && finding.status !== 'To Verify') continue
      const evidenceStatus = finding.status === 'Pending Review' ? 'Pending Review' : finding.evidenceStatus
      risks.push({
        id: `finding-${finding.id}`,
        title: finding.keyClaim,
        origin: 'Research review',
        area: finding.area,
        evidenceStatus,
        detail: finding.riskNote || finding.summary,
        routeName: 'hermes.researchResultReview',
        priority: riskPriority(finding.area, evidenceStatus),
      })
    }

    for (const model of state.value.financialModels.slice(0, 2)) {
      for (const warning of model.warnings) {
        risks.push({
          id: `financial-${model.id}-${warning}`,
          title: `${model.scenarioName} financial warning`,
          origin: 'IRR calculator',
          area: 'financial',
          evidenceStatus: model.evidenceStatus,
          detail: warning,
          routeName: 'hermes.investmentCalculator',
          priority: riskPriority('financial', model.evidenceStatus),
        })
      }
    }

    for (const claim of state.value.marketClaims) {
      const evidenceStatus = normalizedMarketClaimStatus(claim)
      if (!isWeakStatus(evidenceStatus)) continue
      risks.push({
        id: `market-${claim.id || claim.label}`,
        title: claim.label,
        origin: 'Market Intelligence',
        area: 'market',
        evidenceStatus,
        detail: claim.value || 'Market claim needs value and source evidence.',
        routeName: 'hermes.marketIntelligence',
        priority: riskPriority('market', evidenceStatus),
      })
    }

    for (const competitor of state.value.competitors) {
      const evidenceStatus = isWeakStatus(competitor.evidenceStatus) ? competitor.evidenceStatus : 'To Verify'
      if (!isWeakStatus(competitor.evidenceStatus) && competitor.marketShare?.trim()) continue
      risks.push({
        id: `competitor-${competitor.id}`,
        title: competitor.companyName,
        origin: 'Competitor Intelligence',
        area: 'market',
        evidenceStatus,
        detail: competitor.marketShare?.trim()
          ? competitor.notes || 'Competitor record needs source-backed review.'
          : 'Market share is unknown and must stay To Verify.',
        routeName: 'hermes.competitorIntelligence',
        priority: riskPriority('market', evidenceStatus),
      })
    }

    for (const material of state.value.presentationMaterials) {
      if (isPresentationMaterialAllowed(material)) continue
      risks.push({
        id: `presentation-${material.id || material.section}`,
        title: material.section,
        origin: 'Investor Presentation',
        area: 'presentation',
        evidenceStatus: 'Unsupported',
        detail: material.evidenceStatus === 'Verified'
          ? 'Verified investor material is missing usable source evidence.'
          : `Material is marked ${material.evidenceStatus} and is excluded from investor drafts.`,
        routeName: 'hermes.investorPresentation',
        priority: riskPriority('presentation', 'Unsupported'),
      })
    }

    return risks.sort((a, b) => b.priority - a.priority).slice(0, 10)
  })

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
    const saved = normalizeCompetitorRecord({
      ...record,
      id: idFrom('competitor', record.companyName || 'unknown'),
      updatedAt: nowIso(),
    })
    state.value.competitors = [saved, ...state.value.competitors]
    persist()
    return saved
  }

  function addRawMaterialSignal(record: Omit<RawMaterialSignalRecord, 'id' | 'updatedAt'>) {
    const saved: RawMaterialSignalRecord = {
      ...record,
      id: idFrom('raw-material-signal', `${record.material || record.label || 'material'}-${record.fieldKey || record.proposedDashboardField || ''}`),
      dashboardGroup: record.dashboardGroup || 'rawMaterialSignals',
      evidenceStatus: record.evidenceStatus === 'Verified' && !sourceIsUsable(record.source)
        ? 'To Verify'
        : record.evidenceStatus,
      pricePerTon: record.pricePerTon?.trim() || '',
      priceStatus: record.priceStatus?.trim() || 'No approved price yet',
      updatedAt: nowIso(),
    }
    state.value.rawMaterialSignals = [saved, ...state.value.rawMaterialSignals]
    persist()
    return saved
  }

  function addSupplierScorecard(record: Omit<SupplierScorecardRecord, 'id' | 'updatedAt'>) {
    const saved: SupplierScorecardRecord = {
      ...record,
      id: idFrom('supplier-scorecard', `${record.supplier || 'supplier'}-${record.material || record.fieldKey || ''}`),
      dashboardGroup: record.dashboardGroup || 'supplierScorecards',
      evidenceStatus: record.evidenceStatus === 'Verified' && !sourceIsUsable(record.source)
        ? 'To Verify'
        : record.evidenceStatus,
      pricePerTon: record.pricePerTon?.trim() || '',
      quality: record.quality?.trim() || '',
      reliability: record.reliability?.trim() || '',
      payment: record.payment?.trim() || '',
      score: record.score?.trim() || '',
      updatedAt: nowIso(),
    }
    state.value.supplierScorecards = [saved, ...state.value.supplierScorecards]
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
      revenue: patch.revenue?.trim() ?? state.value.competitors[index].revenue,
      yearlyGrowth: patch.yearlyGrowth?.trim() ?? state.value.competitors[index].yearlyGrowth,
      traffic: patch.traffic?.trim() ?? state.value.competitors[index].traffic,
      rating: patch.rating?.trim() ?? state.value.competitors[index].rating,
      lastUpdated: patch.lastUpdated?.trim() ?? state.value.competitors[index].lastUpdated,
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

  function updateResearchJobSchedule(
    id: string,
    schedule: Pick<ResearchJobRecord, 'scheduledJobId' | 'schedule'> & { status?: ResearchJobRecord['status'] },
  ): ResearchJobRecord | null {
    const index = state.value.researchJobs.findIndex(item => item.id === id)
    if (index === -1) return null
    const updated: ResearchJobRecord = {
      ...state.value.researchJobs[index],
      scheduledJobId: schedule.scheduledJobId,
      schedule: schedule.schedule,
      status: schedule.status || 'Scheduled Hermes Job',
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

  function applyResearchFindingDashboardTarget(id: string): boolean {
    const current = state.value.researchFindings.find(item => item.id === id)
    if (!current?.dashboardTarget || current.dashboardAppliedAt || current.status !== 'Approved') return false

    const target = current.dashboardTarget
    let applied = false

    if (target.group === 'marketClaims') {
      addMarketClaim({
        fieldKey: nonEmpty(target.fieldKey),
        dashboardGroup: target.group,
        proposedDashboardField: nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || current.keyClaim,
        label: nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || current.keyClaim,
        value: nonEmpty(target.value) || current.summary,
        evidenceStatus: current.evidenceStatus,
        confidence: current.confidence,
        source: current.source || null,
        sourceTier: target.sourceTier,
        dataType: target.dataType,
        reviewRequired: false,
        riskReason: target.riskReason || current.riskNote,
        lastChecked: current.reviewedAt || nowIso(),
      })
      applied = true
    } else if (target.group === 'competitorRecords') {
      addCompetitor({
        fieldKey: nonEmpty(target.fieldKey),
        dashboardGroup: target.group,
        proposedDashboardField: nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || current.keyClaim,
        companyName: nonEmpty(target.companyName) || current.keyClaim.replace(/^Competitor(?: evidence| research)?:\s*/i, '') || 'Competitor to verify',
        countryRegion: nonEmpty(target.countryRegion) || 'To Verify',
        productEquivalent: nonEmpty(target.productEquivalent) || 'To Verify',
        activeContent: nonEmpty(target.activeContent) || 'To Verify',
        pricingEvidence: nonEmpty(target.pricingEvidence) || 'To Verify',
        certifications: nonEmpty(target.certifications) || 'To Verify',
        distributionPresence: nonEmpty(target.distributionPresence) || 'To Verify',
        marketShare: nonEmpty(target.marketShare),
        revenue: nonEmpty(target.revenue),
        yearlyGrowth: nonEmpty(target.yearlyGrowth),
        traffic: nonEmpty(target.traffic),
        rating: nonEmpty(target.rating),
        lastUpdated: nonEmpty(target.lastUpdated),
        metricEvidence: competitorMetricEvidenceFromTarget(target, current),
        evidenceStatus: current.evidenceStatus,
        source: current.source || null,
        sourceTier: target.sourceTier,
        dataType: target.dataType,
        confidence: current.confidence,
        reviewRequired: false,
        riskReason: target.riskReason || current.riskNote,
        recommendedAction: target.recommendedAction || current.suggestedTask,
        notes: [
          nonEmpty(target.value) || current.summary,
          `Approved from Research Result Review: ${current.keyClaim}`,
          target.sourceTier ? `Source tier: ${target.sourceTier}` : '',
          current.riskNote ? `Risk note: ${current.riskNote}` : '',
        ].filter(Boolean).join('\n'),
      })
      applied = true
    } else if (target.group === 'investorMaterialCandidates') {
      const content = nonEmpty(target.content) || nonEmpty(target.value) || nonEmpty(current.suggestedInvestorMaterial)
      if (content) {
        addPresentationMaterial({
          section: nonEmpty(target.section) || presentationSectionForEvidence(current.area, `${current.keyClaim} ${content}`),
          content,
          evidenceStatus: current.evidenceStatus === 'Assumption' ? 'Approved Assumption' : current.evidenceStatus,
          source: current.source || null,
        })
        applied = true
      }
    } else if (target.group === 'rawMaterialSignals') {
      const reviewGated = targetIsCommercialReviewGated(target)
      addRawMaterialSignal({
        fieldKey: nonEmpty(target.fieldKey),
        dashboardGroup: target.group,
        group: target.group,
        material: nonEmpty(target.material) || nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || current.keyClaim,
        label: nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || current.keyClaim,
        proposedDashboardField: nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || current.keyClaim,
        value: safeDashboardValueForTarget(target, 'Source-backed raw-material evidence approved; commercial value remains in data-room audit.'),
        source: current.source || null,
        sourceTier: target.sourceTier,
        lastChecked: current.reviewedAt || nowIso(),
        confidence: current.confidence,
        evidenceStatus: current.evidenceStatus,
        reviewRequired: reviewGated ? target.reviewRequired : false,
        reportedReviewRequired: target.reportedReviewRequired,
        dataType: target.dataType,
        pricePerTon: reviewGated ? '' : '',
        priceStatus: reviewGated ? 'Commercial value remains review-gated' : 'No approved price yet',
        riskReason: target.riskReason || current.riskNote,
        notes: reviewGated
          ? [
              current.summary,
              'Approved into raw-material signals without exposing price/cost text in primary dashboard fields.',
              target.sourceTier ? `Source tier: ${target.sourceTier}` : '',
              current.riskNote ? `Risk note: ${current.riskNote}` : '',
            ].filter(Boolean).join('\n')
          : dataRoomNotesForTarget(current),
      })
      addDataRoomSource({
        checklistLabel: dataRoomLabelForTarget(current),
        fieldKey: nonEmpty(target.fieldKey),
        area: current.area,
        dashboardGroup: target.group,
        proposedDashboardField: nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || dataRoomLabelForTarget(current),
        supplier: nonEmpty(target.supplier),
        material: nonEmpty(target.material),
        proposedValue: nonEmpty(target.value),
        sourceTier: target.sourceTier,
        dataType: target.dataType,
        confidence: current.confidence,
        reviewRequired: reviewGated ? target.reviewRequired : false,
        riskReason: target.riskReason || current.riskNote,
        evidenceStatus: current.evidenceStatus,
        source: current.source || null,
        notes: dataRoomNotesForTarget(current),
      })
      applied = true
    } else if (target.group === 'supplierScorecards') {
      const reviewGated = targetIsCommercialReviewGated(target)
      addSupplierScorecard({
        fieldKey: nonEmpty(target.fieldKey),
        dashboardGroup: target.group,
        group: target.group,
        supplier: nonEmpty(target.supplier) || 'Supplier candidate',
        material: nonEmpty(target.material) || nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || current.keyClaim,
        proposedDashboardField: nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || current.keyClaim,
        value: safeDashboardValueForTarget(target, 'Supplier evidence approved; price/payment/score remain in data-room audit.'),
        source: current.source || null,
        sourceTier: target.sourceTier,
        lastChecked: current.reviewedAt || nowIso(),
        confidence: current.confidence,
        evidenceStatus: current.evidenceStatus,
        reviewRequired: reviewGated ? target.reviewRequired : false,
        reportedReviewRequired: target.reportedReviewRequired,
        dataType: target.dataType,
        pricePerTon: '',
        quality: '',
        reliability: '',
        payment: '',
        score: '',
        riskReason: target.riskReason || current.riskNote,
        notes: reviewGated
          ? [
              current.summary,
              'Approved into supplier scorecards without exposing price/payment/score text in primary dashboard fields.',
              target.sourceTier ? `Source tier: ${target.sourceTier}` : '',
              current.riskNote ? `Risk note: ${current.riskNote}` : '',
            ].filter(Boolean).join('\n')
          : dataRoomNotesForTarget(current),
      })
      addDataRoomSource({
        checklistLabel: dataRoomLabelForTarget(current),
        fieldKey: nonEmpty(target.fieldKey),
        area: current.area,
        dashboardGroup: target.group,
        proposedDashboardField: nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || dataRoomLabelForTarget(current),
        supplier: nonEmpty(target.supplier),
        material: nonEmpty(target.material),
        proposedValue: nonEmpty(target.value),
        sourceTier: target.sourceTier,
        dataType: target.dataType,
        confidence: current.confidence,
        reviewRequired: reviewGated ? target.reviewRequired : false,
        riskReason: target.riskReason || current.riskNote,
        evidenceStatus: current.evidenceStatus,
        source: current.source || null,
        notes: dataRoomNotesForTarget(current),
      })
      applied = true
    } else if (
      target.group === 'regulatoryFindings' ||
      target.group === 'financialEvidence'
    ) {
      addDataRoomSource({
        checklistLabel: dataRoomLabelForTarget(current),
        fieldKey: nonEmpty(target.fieldKey),
        area: current.area,
        dashboardGroup: target.group,
        proposedDashboardField: nonEmpty(target.proposedDashboardField) || nonEmpty(target.field) || dataRoomLabelForTarget(current),
        supplier: nonEmpty(target.supplier),
        material: nonEmpty(target.material),
        proposedValue: nonEmpty(target.value),
        sourceTier: target.sourceTier,
        dataType: target.dataType,
        confidence: current.confidence,
        reviewRequired: target.sensitive === true ||
          target.dataType === 'supplier_quote' ||
          target.dataType === 'price_data'
          ? target.reviewRequired
          : false,
        riskReason: target.riskReason || current.riskNote,
        evidenceStatus: current.evidenceStatus,
        source: current.source || null,
        notes: dataRoomNotesForTarget(current),
      })
      applied = true
    }

    if (!applied) return false

    const index = state.value.researchFindings.findIndex(item => item.id === id)
    if (index !== -1) {
      state.value.researchFindings = [
        ...state.value.researchFindings.slice(0, index),
        { ...state.value.researchFindings[index], dashboardAppliedAt: nowIso() },
        ...state.value.researchFindings.slice(index + 1),
      ]
      persist()
    }
    return true
  }

  function approveResearchFinding(
    id: string,
    options: {
      evidenceStatus?: IntelligenceEvidenceStatus
      updateReadiness?: boolean
      addToPresentation?: boolean
      applyDashboardUpdate?: boolean
    } = {},
  ): ResearchReviewFinding | null {
    const index = state.value.researchFindings.findIndex(item => item.id === id)
    if (index === -1) return null
    const current = state.value.researchFindings[index]
    const requestedStatus = options.evidenceStatus || current.evidenceStatus
    const evidenceStatus = approvedFindingStatus(current, requestedStatus)
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
    if (options.applyDashboardUpdate && approved.status === 'Approved') {
      applyResearchFindingDashboardTarget(approved.id)
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
    if (serverPersistTimer && typeof window !== 'undefined') {
      window.clearTimeout(serverPersistTimer)
      serverPersistTimer = null
    }
    serverSyncEnabled = false
    serverHydratePromise = null
    serverSyncStatus.value = {
      enabled: false,
      hydrated: false,
      saving: false,
      lastLoadedAt: '',
      lastSavedAt: '',
      error: '',
    }
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
    riskRegisterItems,
    serverSyncStatus,
    hydrateFeasibilityIntelligenceFromServer,
    persistFeasibilityIntelligenceToServer,
    updateEvidenceStatus,
    addMarketClaim,
    updateMarketClaim,
    removeMarketClaim,
    addCompetitor,
    updateCompetitor,
    removeCompetitor,
    addRawMaterialSignal,
    addSupplierScorecard,
    addPresentationMaterial,
    updatePresentationMaterial,
    removePresentationMaterial,
    addResearchJob,
    updateResearchJobStatus,
    updateResearchJobSchedule,
    addResearchFinding,
    approveResearchFinding,
    applyResearchFindingDashboardTarget,
    rejectResearchFinding,
    saveFinancialModelSnapshot,
    addDataRoomSource,
    removeDataRoomSource,
    resetFeasibilityIntelligenceForTests,
  }
}
