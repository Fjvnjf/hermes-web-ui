<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, useMessage } from 'naive-ui'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { useJobsStore } from '@/stores/hermes/jobs'
import {
  useFeasibilityIntelligence,
  type SupplierScorecardRecord,
} from '@/composables/useFeasibilityIntelligence'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import { EXECUTIVE_REFRESH_SCHEDULE } from '@/utils/executiveIntelligence'
import {
  RAW_MATERIALS_STORAGE_KEY,
  calculatePriceAlert,
  createDefaultRawMaterials,
  isDmsMaterial,
  nowIsoDate,
  sourceTypeStatus,
  type RawMaterialPriceEntry,
  type RawMaterialRecord,
  type RawMaterialSourceType,
} from '@/utils/intelligenceWorkflow'
import {
  displayAutomaticVerificationText,
  displayEvidenceStatus,
  displayUnresolvedValue,
  type IntelligenceEvidenceStatus,
} from '@/utils/investorIntelligence'
import { accessControlWarning, shouldRedactForEmployee } from '@/utils/accessControl'

interface SupplierScorecardRow {
  supplier: string
  region: string
  material: string
  pricePerTon: string
  quality: string
  reliability: string
  payment: string
  score: string
  evidenceStatus: IntelligenceEvidenceStatus
  sourceTitle: string
  sourceUrl?: string
  sourceMeta: string
  sourceSummary: string
  reviewState: string
  nextAction: string
  highRisk?: boolean
}

interface RawMaterialIdentitySignalRow {
  material: string
  value: string
  cas: string
  formula: string
  evidenceStatus: IntelligenceEvidenceStatus
  confidence: string
  sourceTitle: string
  sourceUrl?: string
  lastChecked: string
  riskReason: string
}

const SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME = 'Supplier Scorecard Autopilot - Key Raw Materials'

const message = useMessage()
const kanbanStore = useKanbanStore()
const jobsStore = useJobsStore()
const intelligence = useFeasibilityIntelligence()

const materials = ref<RawMaterialRecord[]>(loadMaterials())
const selectedMaterialId = ref(materials.value[0]?.id || '')
const savingKey = ref('')
const supplierAutopilotStatus = ref('Supplier scorecard autopilot keeps findings review-gated until approved')
const supplierAutopilotJobId = ref('')
const employeeRedaction = computed(() => shouldRedactForEmployee())

function displaySupplierValue(value?: string | number | null): string {
  return displayUnresolvedValue(value)
}

function displaySupplierStatus(status?: string | null): string {
  return displayEvidenceStatus(status)
}

function displaySupplierText(text?: string | null): string {
  return displayAutomaticVerificationText(text)
}

const sourceTypes: RawMaterialSourceType[] = [
  'SunSirs',
  'ECHEMI',
  'Supplier quote',
  'Alibaba/Made-in-China reference',
  'Manual entry',
  'Paid source',
]

const REVIEW_GATED_PRICE_COPY = 'Cost-sensitive: quote evidence required'
const REVIEW_GATED_PAYMENT_COPY = 'Cost-sensitive: payment evidence required'
const REVIEW_GATED_QUALITY_COPY = 'Review-gated: TDS/SDS/COA evidence required'
const REVIEW_GATED_RELIABILITY_COPY = 'Review-gated: reliability evidence required'
const REVIEW_GATED_SCORE_COPY = 'Review-gated: scoring evidence required'
const DISPLAYABLE_PRICE_STATUSES: IntelligenceEvidenceStatus[] = [
  'Verified',
  'Source-backed',
  'User Approved',
  'Investor Approved',
]
const APPROVED_SUPPLIER_EVIDENCE_STATUSES: IntelligenceEvidenceStatus[] = [
  'Verified',
  'User Approved',
  'Investor Approved',
]
const TRUSTED_SUPPLIER_CONTEXT_STATUSES: IntelligenceEvidenceStatus[] = [
  'Verified',
  'Source-backed',
  'Official Data',
  'Trusted Source Auto-Updated',
  'Supplier Evidence',
  'User Approved',
  'Investor Approved',
]

const supplierScorecardRows: SupplierScorecardRow[] = [
  {
    supplier: 'Wilmar Oleochemicals',
    region: 'Malaysia / Singapore',
    material: 'Stearic Acid TP / Stearic acid 1842',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'Wilmar Oleochemicals official source',
    sourceUrl: 'https://www.wilmar-international.com/oleochemicals',
    sourceMeta: 'Reference-only supplier target template',
    sourceSummary: 'Reference-only target row. Use imported trusted-source records before this affects sourcing decisions.',
    reviewState: 'Review state: reference-only template',
    nextAction: 'Request quote, TDS, SDS, COA, MOQ, lead time, and payment terms for stearic acid.',
  },
  {
    supplier: 'KLK OLEO',
    region: 'Malaysia / Global',
    material: 'Stearic Acid TP / PALMERA stearic acid',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'KLK OLEO product source',
    sourceUrl: 'https://www.klkoleo.com/products/',
    sourceMeta: 'Reference-only supplier target template',
    sourceSummary: 'Reference-only target row. Use imported trusted-source records before this affects sourcing decisions.',
    reviewState: 'Review state: reference-only template',
    nextAction: 'Confirm stearic acid grade match, China delivery route, quote validity, and payment terms.',
  },
  {
    supplier: 'BASF',
    region: 'Germany / Asia supply network',
    material: 'Triethanolamine / TEA',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'BASF amines / triethanolamine source',
    sourceUrl: 'https://products.basf.com/global/en/ci/triethanolamine',
    sourceMeta: 'Reference-only supplier target template',
    sourceSummary: 'Reference-only target row. Use imported trusted-source records before this affects sourcing decisions.',
    reviewState: 'Review state: reference-only template',
    nextAction: 'Verify TEA grade, SDS, China availability, distributor channel, quote, and lead time.',
  },
  {
    supplier: 'Dow',
    region: 'United States / Global',
    material: 'PDMS Silicone Oil / 1000 cSt target',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'Dow silicone product search',
    sourceUrl: 'https://www.dow.com/en-us/pdp.dowsil-sh-200-fluid-1000-cst.850505z.html',
    sourceMeta: 'Reference-only supplier target template',
    sourceSummary: 'Reference-only target row. Use imported trusted-source records before this affects sourcing decisions.',
    reviewState: 'Review state: reference-only template',
    nextAction: 'Confirm PDMS viscosity, textile softener suitability, distributor quote, and technical documents.',
  },
  {
    supplier: 'WACKER',
    region: 'Germany / China',
    material: 'PDMS Silicone Oil / Silicone fluid target',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'WACKER silicone fluids source',
    sourceUrl: 'https://www.wacker.com/h/en-gb/silicone-fluids-emulsions/linear-silicone-fluids/wacker-eco-ak-1000/p/000100490',
    sourceMeta: 'Reference-only supplier target template',
    sourceSummary: 'Reference-only target row. Use imported trusted-source records before this affects sourcing decisions.',
    reviewState: 'Review state: reference-only template',
    nextAction: 'Confirm matching silicone fluid grade, China supply, quote, SDS, TDS, and application notes.',
  },
  {
    supplier: 'Nantong DMS supplier candidate',
    region: 'China',
    material: 'Dimethyl Sulfate / DMS',
    pricePerTon: 'To Verify',
    quality: 'SDS/regulatory proof needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending regulatory review',
    evidenceStatus: 'To Verify',
    sourceTitle: 'PubChem identity and hazard reference',
    sourceUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/Dimethyl-sulfate',
    sourceMeta: 'Reference-only supplier target template',
    sourceSummary: 'Reference-only high-risk raw-material identity target. Supplier use requires regulatory and quote evidence.',
    reviewState: 'Review state: reference-only template',
    nextAction: 'Verify supplier identity, exact CAS, legal status, transport/storage rules, SDS, and permit requirements before any quote is used.',
    highRisk: true,
  },
  {
    supplier: 'Bangladesh local acetic acid supplier shortlist',
    region: 'Bangladesh',
    material: 'Acetic Acid',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending supplier shortlist',
    evidenceStatus: 'To Verify',
    sourceTitle: 'Local quote and document evidence needed',
    sourceMeta: 'Reference-only supplier target template',
    sourceSummary: 'Reference-only local sourcing target. Upload or import supplier quote evidence before use.',
    reviewState: 'Review state: reference-only template',
    nextAction: 'Identify local suppliers, request quote, SDS, TDS, COA, delivery terms, and tax/VAT details.',
  },
]

function isAutopilotSupplierRecord(record: typeof intelligence.state.value.dataRoomSources[number]): boolean {
  const group = record.dashboardGroup || ''
  return group === 'supplierScorecards' && Boolean(record.supplier?.trim() && record.material?.trim())
}

function supplierRecordKey(row: Pick<SupplierScorecardRow, 'supplier' | 'material'>): string {
  return `${row.supplier}::${row.material}`.toLowerCase().replace(/\s+/g, ' ').trim()
}

function materialIdentityKey(text: string): string {
  const lower = text.toLowerCase()
  if (/\btea\b|triethanolamine/.test(lower)) return 'tea'
  if (/\bdms\b|dimethyl\s+sulfate|dimethyl\s+sulphate/.test(lower)) return 'dms'
  if (/stearic|octadecanoic/.test(lower)) return 'stearic'
  if (/pdms|polydimethylsiloxane|poly\(dimethylsiloxane\)|silicone\s+oil/.test(lower)) return 'pdms'
  if (/acetic/.test(lower)) return 'acetic'
  return lower.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function casFromText(text: string): string {
  return text.match(/\b\d{2,7}-\d{2}-\d\b/)?.[0] || ''
}

function formulaFromText(text: string): string {
  return text.match(/(?:formula|molecular formula)\s+([A-Z][A-Za-z0-9()]+)/i)?.[1] ||
    text.match(/\|\s*([A-Z][A-Za-z0-9()]+)\s*\|/)?.[1] ||
    ''
}

function normalizeSupplierText(value?: string | number | null): string {
  return String(value ?? '').trim()
}

function isUnresolvedSupplierValue(value?: string | number | null): boolean {
  const normalized = normalizeSupplierText(value).toLowerCase().replace(/\s+/g, ' ')
  return !normalized ||
    normalized === 'to verify' ||
    normalized === 'missing' ||
    normalized === 'missing / to verify' ||
    normalized === 'no approved quote yet' ||
    normalized === 'quote/payment terms needed' ||
    normalized === 'review needed' ||
    normalized === 'pending quote' ||
    normalized === 'pending regulatory review' ||
    normalized === 'pending supplier shortlist' ||
    normalized === 'tds/sds needed' ||
    normalized === 'sds/regulatory proof needed' ||
    normalized === 'quote/tds/sds/coa review needed' ||
    normalized === 'source review needed' ||
    normalized === 'material to verify' ||
    normalized === 'n/a'
}

function hasSupplierSourceMetadata(record: SupplierScorecardRecord): boolean {
  return Boolean(
    record.source?.title?.trim() ||
    record.source?.url?.trim() ||
    record.sourceDate?.trim() ||
    record.lastChecked?.trim() ||
    record.updatedAt?.trim(),
  )
}

function supplierRecordSourceDate(record: SupplierScorecardRecord): string {
  return record.sourceDate || record.source?.date || record.lastChecked || record.updatedAt || ''
}

function supplierSourceMeta(record: SupplierScorecardRecord, identitySignal?: RawMaterialIdentitySignalRow | null): string {
  const metadata = [
    record.sourceTier || record.reportedSourceTier,
    record.confidence ? `confidence: ${record.confidence}` : '',
    supplierRecordSourceDate(record) ? `date: ${supplierRecordSourceDate(record)}` : '',
  ].filter(Boolean).join(' / ')
  const identity = identitySignal
    ? `Raw-material identity source: ${identitySignal.sourceTitle}${identitySignal.lastChecked ? ` / ${identitySignal.lastChecked}` : ''}`
    : ''
  return [metadata ? `Source metadata: ${metadata}` : 'Source metadata pending review', identity]
    .filter(Boolean)
    .join('. ')
}

function supplierEvidenceLooksQuoteBacked(record: SupplierScorecardRecord): boolean {
  const evidenceText = supplierEvidenceText(record)
  return /supplier[_ -]?quote|quotation|quote|invoice|proforma|purchase order|\bpi\b|price offer|commercial offer|distributor quote|paid source/.test(evidenceText)
}

function supplierEvidenceLooksQualityBacked(record: SupplierScorecardRecord): boolean {
  const evidenceText = supplierEvidenceText(record)
  return /\bcoa\b|\btds\b|\bsds\b|certificate of analysis|technical data sheet|safety data sheet|quality|grade|specification|supplier evidence|official product page/.test(evidenceText)
}

function supplierEvidenceLooksReliabilityBacked(record: SupplierScorecardRecord): boolean {
  const evidenceText = supplierEvidenceText(record)
  return /reliability|supplier audit|scorecard|approved supplier|supplier performance|shipment record|on-time|delivery record/.test(evidenceText)
}

function supplierEvidenceLooksPaymentBacked(record: SupplierScorecardRecord): boolean {
  const evidenceText = supplierEvidenceText(record)
  return supplierEvidenceLooksQuoteBacked(record) &&
    /payment terms|\blc\b|letter of credit|\btt\b|telegraphic transfer|credit terms|invoice|proforma|purchase order|\bpi\b|commercial offer/.test(evidenceText)
}

function supplierEvidenceLooksScoreBacked(record: SupplierScorecardRecord): boolean {
  const evidenceText = supplierEvidenceText(record)
  return /supplier audit|scorecard|approved supplier score|vendor rating|supplier performance|quality score|reliability score/.test(evidenceText)
}

function supplierEvidenceText(record: SupplierScorecardRecord): string {
  const evidenceText = [
    record.dataType,
    record.sourceTier,
    record.reportedSourceTier,
    record.source?.title,
    record.source?.url,
    record.proposedDashboardField,
    record.value,
    record.notes,
  ].filter(Boolean).join(' ').toLowerCase()
  return evidenceText
}

function supplierTierText(record: SupplierScorecardRecord): string {
  return String(record.sourceTier || record.reportedSourceTier || '').toLowerCase()
}

function isReviewOnlySupplierStatus(record: SupplierScorecardRecord): boolean {
  return /reference only|candidate source|hypothesis|assumption|missing/i.test(record.evidenceStatus || '')
}

function supplierRecordLooksUploaded(record: SupplierScorecardRecord): boolean {
  const text = supplierEvidenceText(record)
  return /supplier[_ -]?quote|quotation|quote|invoice|proforma|purchase order|\bpi\b|price offer|commercial offer|distributor quote|uploaded|upload|supplier evidence|audit packet|quote packet|manual_upload|manual upload/.test(text)
}

function supplierRecordLooksApproved(record: SupplierScorecardRecord): boolean {
  const text = supplierEvidenceText(record)
  if (/unapproved|not\s+approved|not\s+owner-approved|not\s+owner\s+approved|not\s+investor-approved|not\s+investor\s+approved|without\s+approval|pending\s+approval|needs\s+approval/.test(text)) {
    return false
  }
  return /approved|owner-reviewed|owner reviewed|reviewed by owner|investor-approved|investor approved|verified for dashboard|approved for dashboard/.test(text)
}

function isApprovedSupplierEvidenceRecord(record: SupplierScorecardRecord): boolean {
  if (record.reviewRequired || record.reportedReviewRequired) return false
  if (!hasSupplierSourceMetadata(record)) return false
  if (isReviewOnlySupplierStatus(record)) return false
  if (APPROVED_SUPPLIER_EVIDENCE_STATUSES.includes(record.evidenceStatus)) return true
  return record.evidenceStatus === 'Supplier Evidence' &&
    supplierTierText(record).includes('tier3') &&
    supplierRecordLooksUploaded(record) &&
    supplierRecordLooksApproved(record)
}

function isTrustedSupplierContextRecord(record: SupplierScorecardRecord): boolean {
  if (record.reviewRequired || record.reportedReviewRequired) return false
  if (!hasSupplierSourceMetadata(record)) return false
  if (isReviewOnlySupplierStatus(record)) return false
  if (!TRUSTED_SUPPLIER_CONTEXT_STATUSES.includes(record.evidenceStatus)) return false
  return /tier1|tier2|tier3|official|supplier|company|trusted/.test(supplierTierText(record)) ||
    /official|supplier evidence|uploaded|quote packet|\bcoa\b|\btds\b|\bsds\b|trusted/.test(supplierEvidenceText(record))
}

function supplierValueContainsBlockedLogisticsCost(value?: string | number | null): boolean {
  return /landed\s+cost|freight|dut(?:y|ies)|tariff|customs|vat|tax|cif|fob|exw|dap|ddp|logistics\s+cost|shipping\s+cost|delivery\s+time|lead\s+time|eta|etd|\b\d+\s*(?:business\s+)?days?\b/i.test(String(value || ''))
}

function supplierValueLooksLikeQualityOrReliabilityScore(value?: string | number | null): boolean {
  return /quality\s+(?:score|rating)|reliability\s+(?:score|rating)|supplier\s+rating|\b\d+\s*\/\s*(?:10|100)\b|\b\d{1,3}\s*%\b/i.test(String(value || ''))
}

function supplierReviewState(record: SupplierScorecardRecord): string {
  if (record.reviewRequired || record.reportedReviewRequired || isReviewOnlySupplierStatus(record)) {
    return 'Review state: review-gated'
  }
  if (isApprovedSupplierEvidenceRecord(record)) return 'Review state: approved supplier evidence'
  if (isTrustedSupplierContextRecord(record)) return 'Review state: source-backed context only'
  return 'Review state: source review needed'
}

function canDisplaySensitiveSupplierValue(record: SupplierScorecardRecord, value?: string | number | null): boolean {
  if (isUnresolvedSupplierValue(value)) return false
  if (!isApprovedSupplierEvidenceRecord(record)) return false
  if (supplierValueContainsBlockedLogisticsCost(value)) return false
  return supplierEvidenceLooksQuoteBacked(record)
}

function canDisplaySupplierQualityValue(record: SupplierScorecardRecord, value?: string | number | null): boolean {
  if (isUnresolvedSupplierValue(value)) return false
  if (supplierValueContainsBlockedLogisticsCost(value)) return false
  if (supplierValueLooksLikeQualityOrReliabilityScore(value) && !isApprovedSupplierEvidenceRecord(record)) return false
  if (!isTrustedSupplierContextRecord(record)) return false
  return supplierEvidenceLooksQualityBacked(record)
}

function canDisplaySupplierReliabilityValue(record: SupplierScorecardRecord, value?: string | number | null): boolean {
  if (isUnresolvedSupplierValue(value)) return false
  if (!isApprovedSupplierEvidenceRecord(record)) return false
  if (supplierValueContainsBlockedLogisticsCost(value)) return false
  if (supplierValueLooksLikeQualityOrReliabilityScore(value)) return false
  return supplierEvidenceLooksReliabilityBacked(record)
}

function canDisplaySupplierPaymentValue(record: SupplierScorecardRecord, value?: string | number | null): boolean {
  if (isUnresolvedSupplierValue(value)) return false
  if (!isApprovedSupplierEvidenceRecord(record)) return false
  if (supplierValueContainsBlockedLogisticsCost(value)) return false
  return supplierEvidenceLooksPaymentBacked(record)
}

function canDisplaySupplierScoreValue(record: SupplierScorecardRecord, value?: string | number | null): boolean {
  if (isUnresolvedSupplierValue(value)) return false
  if (!isApprovedSupplierEvidenceRecord(record)) return false
  if (supplierValueContainsBlockedLogisticsCost(value)) return false
  return supplierEvidenceLooksScoreBacked(record)
}

function importedSupplierQualityField(record: SupplierScorecardRecord, value: string | number | null | undefined, fallback: string): string {
  if (!canDisplaySupplierQualityValue(record, value)) return fallback
  return displaySupplierValue(value)
}

function importedSupplierReliabilityField(record: SupplierScorecardRecord, value: string | number | null | undefined, fallback: string): string {
  if (!canDisplaySupplierReliabilityValue(record, value)) return fallback
  return displaySupplierValue(value)
}

function importedSensitiveSupplierField(record: SupplierScorecardRecord, value: string | number | null | undefined, fallback: string): string {
  if (!canDisplaySensitiveSupplierValue(record, value)) return fallback
  return displaySupplierValue(value)
}

function importedSupplierPaymentField(record: SupplierScorecardRecord, value: string | number | null | undefined): string {
  if (!canDisplaySupplierPaymentValue(record, value)) return REVIEW_GATED_PAYMENT_COPY
  return displaySupplierValue(value)
}

function importedSupplierScoreField(record: SupplierScorecardRecord, value: string | number | null | undefined): string {
  if (!canDisplaySupplierScoreValue(record, value)) return REVIEW_GATED_SCORE_COPY
  return displaySupplierValue(value)
}

function supplierTextContainsCommercialValue(text?: string | null): boolean {
  return /(?:usd|us\$|\$|rmb|cny|¥|eur|€|\/\s*t|\/\s*mt|per\s+(?:ton|mt)|landed cost|freight|dut(?:y|ies)|tariff|customs|vat|tax|cif|fob|exw|dap|ddp|logistics|lead time|delivery time|delivery terms|delivery record|shipment|moq|price|quote|quotation|invoice|proforma|payment|payment terms|\blc\b|letter of credit|\btt\b|credit days|quality rating|quality score|reliability rating|reliability score|supplier rating|\d+\s*\/\s*10|\d+\s*\/\s*100|\bscore\b|scorecard)/i.test(text || '')
}

function safeSupplierSourceSummary(record: SupplierScorecardRecord): string {
  const text = [record.value, record.notes].filter(Boolean).join(' ')
  if (!text.trim()) return 'Imported supplier/material context. Missing price, payment, score, quality, and reliability fields stay review-gated.'
  if (record.reviewRequired || record.reportedReviewRequired || supplierTextContainsCommercialValue(text)) {
    return 'Supplier evidence imported. Commercial, logistics, and scoring values are hidden until approved for dashboard use.'
  }
  return text
}

function safeSupplierRiskSummary(record: SupplierScorecardRecord): string {
  if (!record.riskReason?.trim()) return ''
  if (supplierTextContainsCommercialValue(record.riskReason)) {
    return 'Commercial/logistics risk detail hidden pending source review.'
  }
  return record.riskReason
}

const importedRawMaterialIdentitySignals = computed<RawMaterialIdentitySignalRow[]>(() => {
  const directSignals = intelligence.state.value.rawMaterialSignals.map(record => {
    const sourceTitle = record.source?.title || 'Trusted raw-material source'
    const sourceUrl = record.source?.url
    const value = record.value || record.notes || ''
    const searchText = `${record.material} ${record.label || ''} ${record.value || ''} ${record.notes || ''} ${sourceTitle}`
    return {
      material: record.material || record.label || 'Raw material',
      value,
      cas: record.cas || casFromText(searchText),
      formula: record.formula || formulaFromText(searchText),
      evidenceStatus: record.evidenceStatus,
      confidence: record.confidence || 'medium',
      sourceTitle,
      sourceUrl,
      lastChecked: record.lastChecked || record.sourceDate || record.source?.date || record.updatedAt || '',
      riskReason: record.riskReason || 'Official source confirms raw-material identity only. Price, landed cost, supplier quote, formula use, and regulatory permission remain review-gated.',
    }
  })

  const fallbackSignals = intelligence.state.value.dataRoomSources
    .filter(record => record.dashboardGroup === 'rawMaterialSignals' && record.source?.url && /pubchem|comptox|cas|cid|chemical identity/i.test(`${record.proposedValue || ''} ${record.source?.title || ''} ${record.source?.url || ''}`))
    .map(record => {
      const sourceTitle = record.source?.title || 'Trusted raw-material source'
      const value = record.proposedValue || record.notes || ''
      const searchText = `${record.checklistLabel} ${record.proposedDashboardField || ''} ${value} ${sourceTitle}`
      return {
        material: materialIdentityKey(searchText) === 'tea'
          ? 'TEA'
          : materialIdentityKey(searchText) === 'dms'
            ? 'DMS / dimethyl sulfate'
            : materialIdentityKey(searchText) === 'stearic'
              ? 'Stearic acid 1842'
              : materialIdentityKey(searchText) === 'pdms'
                ? 'PDMS 1000 cSt'
                : materialIdentityKey(searchText) === 'acetic'
                  ? 'Acetic acid'
                  : record.checklistLabel,
        value,
        cas: casFromText(searchText),
        formula: formulaFromText(searchText),
        evidenceStatus: record.evidenceStatus,
        confidence: record.confidence || 'medium',
        sourceTitle,
        sourceUrl: record.source?.url,
        lastChecked: record.updatedAt || record.source?.date || '',
        riskReason: record.riskReason || 'Official source confirms raw-material identity only. Price, landed cost, supplier quote, formula use, and regulatory permission remain review-gated.',
      }
    })

  const byKey = new Map<string, RawMaterialIdentitySignalRow>()
  for (const signal of [...directSignals, ...fallbackSignals]) {
    const key = `${materialIdentityKey(signal.material)}::${signal.sourceTitle}`
    if (!byKey.has(key)) byKey.set(key, signal)
  }
  return Array.from(byKey.values())
})

function identitySignalForMaterial(material?: RawMaterialRecord | null): RawMaterialIdentitySignalRow | null {
  if (!material) return null
  return identitySignalForMaterialName(material.name)
}

function identitySignalForMaterialName(material: string): RawMaterialIdentitySignalRow | null {
  const key = materialIdentityKey(material)
  return importedRawMaterialIdentitySignals.value.find(signal => materialIdentityKey(signal.material) === key) || null
}

const importedSupplierScorecardRows = computed<SupplierScorecardRow[]>(() =>
  intelligence.state.value.supplierScorecards
    .filter(record => record.supplier?.trim() && record.material?.trim())
    .map(record => {
      const identitySignal = identitySignalForMaterialName(record.material)
      const sourceTitle = record.source?.title || record.proposedDashboardField || 'Source metadata pending review'
      const sourceUrl = record.source?.url
      return {
        supplier: record.supplier,
        region: 'Trusted-source import',
        material: record.material,
        pricePerTon: importedSensitiveSupplierField(record, record.pricePerTon, REVIEW_GATED_PRICE_COPY),
        quality: importedSupplierQualityField(record, record.quality, REVIEW_GATED_QUALITY_COPY),
        reliability: importedSupplierReliabilityField(record, record.reliability, REVIEW_GATED_RELIABILITY_COPY),
        payment: importedSupplierPaymentField(record, record.payment),
        score: importedSupplierScoreField(record, record.score),
        evidenceStatus: record.evidenceStatus,
        sourceTitle,
        sourceUrl,
        sourceMeta: supplierSourceMeta(record, identitySignal),
        sourceSummary: [
          safeSupplierSourceSummary(record),
          safeSupplierRiskSummary(record),
        ].filter(Boolean).join(' '),
        reviewState: supplierReviewState(record),
        nextAction: record.riskReason || record.notes || `Review quote, TDS, SDS, COA, payment terms, and delivery evidence for ${record.supplier} / ${record.material}.`,
        highRisk: isDmsMaterial(`${record.supplier} ${record.material}`),
      }
    }),
)

const sourceReviewSupplierScorecardRows = computed<SupplierScorecardRow[]>(() =>
  intelligence.state.value.dataRoomSources
    .filter(isAutopilotSupplierRecord)
    .map(record => {
      const sourceTitle = record.source?.title || record.proposedDashboardField || 'Source metadata pending review'
      const sourceUrl = record.source?.url
      const sourceDate = record.source?.date || record.updatedAt || ''
      const confidence = record.confidence ? `confidence: ${record.confidence}` : ''
      const sourceTier = record.sourceTier || 'source tier pending review'
      const proposedText = [record.proposedValue, record.notes].filter(Boolean).join(' ')
      const proposed = record.reviewRequired ||
        record.dataType === 'supplier_quote' ||
        record.dataType === 'price_data' ||
        supplierTextContainsCommercialValue(proposedText)
        ? 'Supplier evidence staged for review. Commercial values are hidden until approved for dashboard use.'
        : record.proposedValue || record.notes || 'Source-backed supplier/material candidate staged for review.'
      return {
        supplier: record.supplier || 'Supplier candidate',
        region: 'Research review candidate',
        material: record.material || 'Raw material candidate',
        pricePerTon: REVIEW_GATED_PRICE_COPY,
        quality: REVIEW_GATED_QUALITY_COPY,
        reliability: REVIEW_GATED_RELIABILITY_COPY,
        payment: REVIEW_GATED_PAYMENT_COPY,
        score: REVIEW_GATED_SCORE_COPY,
        evidenceStatus: record.evidenceStatus,
        sourceTitle,
        sourceUrl,
        sourceMeta: [
          `Source metadata: ${sourceTier}`,
          confidence,
          sourceDate ? `date: ${sourceDate}` : '',
        ].filter(Boolean).join(' / '),
        sourceSummary: `Source found - review required: ${proposed}`,
        reviewState: 'Review state: review-gated',
        nextAction: record.riskReason || `Review supplier evidence before using price, payment, reliability, or score for ${record.supplier} / ${record.material}.`,
        highRisk: isDmsMaterial(`${record.supplier || ''} ${record.material || ''}`),
      }
    }),
)

const sourceReviewSupplierCandidateCount = computed(() =>
  intelligence.state.value.dataRoomSources.filter(isAutopilotSupplierRecord).length,
)

const displayedSupplierScorecardRows = computed(() => {
  const byKey = new Map<string, SupplierScorecardRow>()
  for (const row of [...importedSupplierScorecardRows.value, ...sourceReviewSupplierScorecardRows.value]) {
    const key = supplierRecordKey(row)
    if (!byKey.has(key)) byKey.set(key, row)
  }
  return Array.from(byKey.values())
})

const priceForm = ref({
  rmbPrice: null as number | null,
  usdPrice: null as number | null,
  unit: 'MT',
  source: '',
  sourceType: 'Supplier quote' as RawMaterialSourceType,
  sourceDate: nowIsoDate(),
  confidence: 'medium' as RawMaterialPriceEntry['confidence'],
  notes: '',
})

function loadMaterials(): RawMaterialRecord[] {
  if (typeof window === 'undefined') return createDefaultRawMaterials()
  try {
    const raw = window.localStorage.getItem(RAW_MATERIALS_STORAGE_KEY)
    if (!raw) return createDefaultRawMaterials()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return createDefaultRawMaterials()
    const byId = new Map(createDefaultRawMaterials().map(item => [item.id, item]))
    for (const item of parsed) {
      if (!item?.id || !byId.has(item.id)) continue
      byId.set(item.id, {
        ...byId.get(item.id)!,
        ...item,
        highRisk: isDmsMaterial(item.name || byId.get(item.id)!.name),
        priceHistory: Array.isArray(item.priceHistory) ? item.priceHistory : [],
      })
    }
    return Array.from(byId.values())
  } catch {
    return createDefaultRawMaterials()
  }
}

function persist() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(RAW_MATERIALS_STORAGE_KEY, JSON.stringify(materials.value))
}

const selectedMaterial = computed(() =>
  materials.value.find(item => item.id === selectedMaterialId.value) || materials.value[0],
)

const selectedApprovedPriceHistory = computed(() =>
  selectedMaterial.value ? displayablePriceHistory(selectedMaterial.value) : [],
)
const selectedLatest = computed(() => selectedApprovedPriceHistory.value[0] || null)
const selectedAlert = computed(() =>
  selectedMaterial.value ? priceAlertForHistory(selectedApprovedPriceHistory.value, selectedMaterial.value.alertThresholdPct) : calculatePriceAlert(null, null),
)
const selectedIdentitySignal = computed(() => identitySignalForMaterial(selectedMaterial.value))

const summaryCards = computed(() => {
  const identityKeys = new Set(importedRawMaterialIdentitySignals.value.map(signal => materialIdentityKey(signal.material)))
  const sourced = materials.value.filter(item =>
    item.evidenceStatus === 'Source-backed' ||
    item.evidenceStatus === 'Verified' ||
    identityKeys.has(materialIdentityKey(item.name)),
  ).length
  const toVerify = Math.max(0, materials.value.length - sourced)
  const alerts = materials.value.filter(item => visibleMaterialPriceAlert(item).triggered).length
  return [
    { label: 'Tracked materials', value: materials.value.length, note: 'No live prices are hardcoded' },
    { label: 'Source-backed identity', value: sourced, note: 'Official identity source; price still needs quote evidence' },
    { label: 'Needs source review', value: toVerify, note: 'Missing or weak evidence checked twice daily' },
    { label: '5% alerts', value: alerts, note: 'Based on approved/source-backed price history' },
  ]
})

const supplierAutopilotCards = computed(() => [
  {
    icon: '🔎',
    label: 'Search',
    value: supplierAutopilotJobId.value ? 'Scheduled' : 'Review-gated',
    note: 'Uses the Hermes job scheduler when available; no supplier facts are promoted without approval.',
  },
  {
    icon: '📥',
    label: 'Stage',
    value: `${importedSupplierScorecardRows.value.length} rows`,
    note: `${importedRawMaterialIdentitySignals.value.length} raw-material signals linked; candidates keep commercial values hidden.`,
  },
  {
    icon: '✅',
    label: 'Verify',
    value: 'Owner approval',
    note: 'Only approved uploaded supplier evidence can reveal price, payment, reliability, or score fields.',
  },
])

function priceDisplay(value: number | null | undefined, currency: string): string {
  if (employeeRedaction.value) return 'Restricted in Employee View'
  if (!value) return displaySupplierStatus('To Verify')
  return `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function canDisplayRawMaterialPriceEntry(entry?: RawMaterialPriceEntry | null): boolean {
  if (!entry) return false
  if (!DISPLAYABLE_PRICE_STATUSES.includes(entry.evidenceStatus)) return false
  return Boolean((entry.rmbPrice || entry.usdPrice) && (entry.source || '').trim() && (entry.sourceDate || '').trim())
}

function displayablePriceHistory(material: RawMaterialRecord): RawMaterialPriceEntry[] {
  return material.priceHistory.filter(canDisplayRawMaterialPriceEntry)
}

function priceAlertForHistory(history: RawMaterialPriceEntry[], thresholdPct: number) {
  const latest = history[0]
  const previous = history[1]
  return calculatePriceAlert(previous?.rmbPrice ?? previous?.usdPrice, latest?.rmbPrice ?? latest?.usdPrice, thresholdPct)
}

function visibleMaterialPriceAlert(material: RawMaterialRecord) {
  return priceAlertForHistory(displayablePriceHistory(material), material.alertThresholdPct)
}

function sensitiveSupplierDisplay(value: string): string {
  if (employeeRedaction.value) return 'Restricted in Employee View'
  return value
}

function trendLabel(material: RawMaterialRecord, days: number): string {
  const history = displayablePriceHistory(material)
  const latest = history[0]
  if (!latest) return 'Limited data available'
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const baseline = history.find(entry => Date.parse(entry.createdAt) <= cutoff) || history[history.length - 1]
  const alert = calculatePriceAlert(baseline?.rmbPrice ?? baseline?.usdPrice, latest.rmbPrice ?? latest.usdPrice, 0)
  if (!baseline || !alert.percentChange) return 'Limited data available'
  return `${alert.percentChange > 0 ? '+' : ''}${alert.percentChange.toFixed(1)}%`
}

function graphWidth(entry: RawMaterialPriceEntry, history: RawMaterialPriceEntry[]): string {
  const values = history.map(item => item.rmbPrice || item.usdPrice || 0).filter(Boolean)
  const max = Math.max(...values, 1)
  const value = entry.rmbPrice || entry.usdPrice || 0
  return `${Math.max(6, Math.round((value / max) * 100))}%`
}

function addPriceEntry() {
  const material = selectedMaterial.value
  if (!material) return
  const hasPrice = Boolean(priceForm.value.rmbPrice || priceForm.value.usdPrice)
  const evidenceStatus = sourceTypeStatus(
    priceForm.value.sourceType,
    priceForm.value.source,
    priceForm.value.sourceDate,
    hasPrice,
  )
  const entry: RawMaterialPriceEntry = {
    id: `${material.id}-${Date.now().toString(36)}`,
    materialName: material.name,
    unit: priceForm.value.unit.trim() || material.unit,
    rmbPrice: priceForm.value.rmbPrice,
    usdPrice: priceForm.value.usdPrice,
    source: priceForm.value.source.trim(),
    sourceType: priceForm.value.sourceType,
    sourceDate: priceForm.value.sourceDate.trim(),
    confidence: priceForm.value.confidence,
    evidenceStatus,
    notes: priceForm.value.notes.trim(),
    createdAt: new Date().toISOString(),
  }
  material.priceHistory = [entry, ...material.priceHistory].slice(0, 60)
  material.unit = entry.unit
  material.source = entry.source
  material.sourceType = entry.sourceType
  material.sourceDate = entry.sourceDate
  material.confidence = entry.confidence
  material.evidenceStatus = evidenceStatus
  material.notes = [
    entry.sourceType === 'Alibaba/Made-in-China reference' ? 'Supplier listing only - confirmation required.' : '',
    material.highRisk ? 'DMS/dimethyl sulfate is high regulatory/safety risk.' : '',
    entry.notes,
  ].filter(Boolean).join(' ')
  persist()
  if (evidenceStatus === 'To Verify' || evidenceStatus === 'Reference Only') {
    message.warning('Price saved, but Hermes will keep verifying it twice daily until stronger evidence is attached')
  } else {
    message.success('Raw material price entry saved in this browser workspace')
  }
}

function taskBody(material: RawMaterialRecord, reason: string): string {
  const latest = displayablePriceHistory(material)[0]
  return [
    reason,
    `Material: ${material.name}`,
    `CAS: ${material.cas || 'To Verify'}`,
    `Unit: ${material.unit}`,
    `Latest RMB price: ${latest?.rmbPrice ?? 'Missing / To Verify'}`,
    `Latest USD price: ${latest?.usdPrice ?? 'Missing / To Verify'}`,
    `Source type: ${material.sourceType}`,
    `Source: ${material.source || 'Missing'}`,
    `Source date: ${material.sourceDate || 'Missing'}`,
    `Evidence status: ${material.evidenceStatus}`,
    `Confidence: ${material.confidence}`,
    material.highRisk ? 'Risk flag: DMS/dimethyl sulfate is high regulatory/safety risk.' : '',
    'Impact on CWAS/CWMS cost: To Verify. Do not calculate product cost without approved formula and sourced inputs.',
    'Tags: Raw Material Sourcing, Price Intelligence, Chemicon China Feasibility',
  ].filter(Boolean).join('\n')
}

async function createTask(material: RawMaterialRecord, reason: string) {
  savingKey.value = `${material.id}-task`
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Raw material evidence: ${material.name}`,
      body: taskBody(material, reason),
      priority: material.highRisk || visibleMaterialPriceAlert(material).triggered ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Raw material task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    savingKey.value = ''
  }
}

function supplierScorecardTaskBody(row: SupplierScorecardRow): string {
  return [
    `Verify supplier scorecard evidence for ${row.supplier}.`,
    `Supplier: ${row.supplier}`,
    `Region: ${row.region}`,
    `Material: ${row.material}`,
    `Current price/T: ${row.pricePerTon}`,
    `Quality evidence: ${row.quality}`,
    `Reliability evidence: ${row.reliability}`,
    `Payment terms: ${row.payment}`,
    `Score: ${row.score}`,
    `Evidence status: ${row.evidenceStatus}`,
    `Source: ${row.sourceTitle}`,
    `Source URL: ${row.sourceUrl || 'Missing / upload supplier document'}`,
    `Source summary: ${row.sourceSummary}`,
    row.highRisk ? 'Risk flag: DMS/dimethyl sulfate requires regulatory, safety, transport, and permit verification before use.' : '',
    `Recommended next action: ${row.nextAction}`,
    'Do not use screenshot prices, payment terms, quality scores, reliability scores, or supplier rankings until quote/TDS/SDS/COA evidence is attached.',
    'Tags: Supplier Scorecard, Raw Material Sourcing, Chemicon China Feasibility',
  ].filter(Boolean).join('\n')
}

function supplierScorecardAutopilotPrompt(): string {
  const rows = supplierScorecardRows.map(row => [
    `Supplier: ${row.supplier}`,
    `Region: ${row.region}`,
    `Material: ${row.material}`,
    `Current dashboard price/T: ${row.pricePerTon}`,
    `Current dashboard score: ${row.score}`,
    `Evidence status: ${row.evidenceStatus}`,
    `Starting source: ${row.sourceTitle} ${row.sourceUrl || ''}`.trim(),
    `Required action: ${row.nextAction}`,
  ].join('\n')).join('\n\n')

  return [
    'Supplier Scorecards - Key Raw Materials Autopilot',
    '',
    'Research all supplier scorecard rows for Chemicon China feasibility using trusted online sources and supplier evidence.',
    '',
    rows,
    '',
    'Trusted source rules:',
    '- Official supplier/company product pages and catalogs can identify supplier/product candidates.',
    '- Quote, PI, invoice, email quote, TDS, SDS, COA, distributor letter, or paid/source-backed price reference is required before filling price/T, payment terms, quality score, reliability score, or total score.',
    '- Public listings such as Alibaba/Made-in-China are Reference Only and must not become procurement truth.',
    '- DMS / dimethyl sulfate requires chemical identity, CAS, SDS, regulatory/safety, transport/storage, and permit checks before any quote is used.',
    '',
    'Output requirements:',
    '- Return a supplier scorecard table with supplier, material, price/T, quality evidence, reliability evidence, payment terms, score, source title, URL/date, confidence, and evidence status.',
    '- Use Missing / To Verify where evidence is absent.',
    '- Recommend Kanban tasks for missing quote/TDS/SDS/COA/regulatory evidence.',
    '- Do not invent supplier prices, scores, payment terms, delivery terms, quality ratings, or reliability ratings.',
    '- Do not expose formula ratios, formula costs, or supplier confidential data in employee-safe output.',
  ].join('\n')
}

async function createSupplierScorecardTask(row: SupplierScorecardRow) {
  savingKey.value = `${row.supplier}-${row.material}-scorecard`
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Supplier scorecard: ${row.supplier} / ${row.material}`,
      body: supplierScorecardTaskBody(row),
      priority: row.highRisk ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Supplier scorecard task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create supplier task: ${detail}`)
  } finally {
    savingKey.value = ''
  }
}

function recordSupplierAutopilotResearchJob(jobId: string, schedule: string) {
  const existing = intelligence.state.value.researchJobs.find(job => job.title === SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME)
  if (existing) {
    intelligence.updateResearchJobSchedule(existing.id, {
      scheduledJobId: jobId,
      schedule,
      status: 'Scheduled Hermes Job',
    })
    return
  }

  intelligence.addResearchJob({
    title: SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME,
    question: 'Automatically research source-backed supplier scorecards for Chemicon key raw materials.',
    scope: 'Stearic acid, TEA, PDMS silicone oil, DMS, acetic acid, supplier price/quality/reliability/payment evidence, source gaps, and regulatory risk.',
    expectedOutput: 'Supplier scorecard table with source title, URL/date, confidence, evidence status, and tasks for missing supplier evidence.',
    sourceRequirements: 'Quote/TDS/SDS/COA/distributor evidence required for supplier score, price, payment, quality, and reliability. Public listings are Reference Only.',
    priority: 'high',
    schedulePreference: 'Custom',
    scheduledJobId: jobId,
    schedule,
    context: 'Chemicon China Feasibility',
    status: 'Scheduled Hermes Job',
  })
}

async function ensureSupplierScorecardAutopilot(options: { silent?: boolean } = {}) {
  if (!options.silent) savingKey.value = 'supplier-scorecard-autopilot'
  supplierAutopilotStatus.value = 'Hermes is checking the supplier scorecard schedule automatically'
  try {
    await jobsStore.fetchJobs()
    const existingJob = jobsStore.jobs.find(job => job.name === SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME)
    const existingJobId = existingJob?.job_id || existingJob?.id || ''

    if (existingJobId) {
      supplierAutopilotJobId.value = existingJobId
      supplierAutopilotStatus.value = 'Supplier scorecard research is scheduled automatically'
      recordSupplierAutopilotResearchJob(existingJobId, EXECUTIVE_REFRESH_SCHEDULE)
      if (!options.silent) message.success('Supplier scorecard research is already scheduled')
      return
    }

    const job = await jobsStore.createJob({
      name: SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME,
      schedule: EXECUTIVE_REFRESH_SCHEDULE,
      prompt: supplierScorecardAutopilotPrompt(),
      deliver: 'local',
    })
    const jobId = job.job_id || job.id || ''
    supplierAutopilotJobId.value = jobId
    supplierAutopilotStatus.value = 'Supplier scorecard research scheduled automatically'
    recordSupplierAutopilotResearchJob(jobId, EXECUTIVE_REFRESH_SCHEDULE)
    if (!options.silent) message.success('Supplier scorecard research scheduled')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown scheduling error'
    supplierAutopilotStatus.value = `Supplier scorecard research needs attention: ${detail}`
    if (!options.silent) message.error(`Could not schedule supplier autopilot: ${detail}`)
  } finally {
    if (!options.silent) savingKey.value = ''
  }
}

function tonightSchedule(): string {
  const date = new Date()
  date.setHours(22, 0, 0, 0)
  if (date <= new Date()) date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 19)
}

async function scheduleResearch(material: RawMaterialRecord) {
  savingKey.value = `${material.id}-research`
  const prompt = [
    `Research raw material sourcing and daily price intelligence for ${material.name}.`,
    'Expected output: source-backed price references, source date, country, confidence, supplier confirmation needs, 7/30 day movement if available, and CWAS/CWMS cost impact caveat.',
    'Source rules: Alibaba/Made-in-China is supplier reference only; supplier quotes are stronger; DMS/dimethyl sulfate requires regulatory/safety notes.',
    'Do not invent prices, price movements, formula ratios, cost impact, or supplier claims.',
  ].join('\n')
  try {
    const job = await jobsStore.createJob({
      name: `Raw material research: ${material.name}`,
      schedule: tonightSchedule(),
      prompt,
      deliver: 'local',
      repeat: 1,
    })
    intelligence.addResearchJob({
      title: `Raw material research: ${material.name}`,
      question: `What source-backed price and supplier evidence exists for ${material.name}?`,
      scope: 'Price references, source dates, supplier confirmation, risk notes, and evidence gaps.',
      expectedOutput: 'Research result for review before dashboard updates.',
      sourceRequirements: 'Every price or claim needs source title plus URL/date. Unknown values stay in source review until source evidence is approved.',
      priority: material.highRisk ? 'high' : 'medium',
      schedulePreference: 'Tonight',
      scheduledJobId: job.job_id || job.id,
      schedule: tonightSchedule(),
      context: 'Chemicon China Feasibility',
      status: 'Scheduled Hermes Job',
    })
    message.success('Hermes research job scheduled')
  } catch {
    await createTask(material, 'Schedule failed or Jobs unavailable. Create a manual research task instead.')
  } finally {
    savingKey.value = ''
  }
}

onMounted(() => {
  void ensureSupplierScorecardAutopilot({ silent: true })
})
</script>

<template>
  <div class="sourcing-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Raw material sourcing</p>
        <h2 class="header-title">Daily Price Intelligence</h2>
        <p class="page-copy">
          Track TEA, DMS, ethoxylates, acids, silicone inputs, stearic acid, and packaging without inventing prices.
          Every saved value stays labeled by evidence status and source type.
        </p>
        <p class="section-help-text">Track source-backed prices. Unsourced values stay in source review and high-risk inputs should become tasks before they influence feasibility outputs.</p>
      </div>
      <div class="header-actions">
        <RouterLink class="shell-link" :to="{ name: 'hermes.files' }">Documents</RouterLink>
        <RouterLink class="shell-link" :to="{ name: 'hermes.kanban' }">Tasks</RouterLink>
      </div>
    </header>

    <p class="warning">{{ accessControlWarning() }}</p>

    <TrustedSourceAutopilotPanel screen="rawMaterials" title="Raw Material Auto Source Status" />

    <section class="summary-grid">
      <article v-for="card in summaryCards" :key="card.label" class="summary-card">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <small>{{ card.note }}</small>
      </article>
    </section>

    <section class="supplier-scorecard-panel" aria-label="Supplier scorecards - key raw materials">
      <header class="scorecard-header">
        <div>
          <p class="eyebrow">Supplier scorecards</p>
          <h3>Supplier Scorecards - Key Raw Materials</h3>
          <p>
            Imported supplier/material records for stearic acid, TEA, PDMS silicone oil, DMS, and acetic acid.
            Prices, quality scores, reliability, payment terms, and total scores stay review-gated unless source-backed
            quote/TDS/SDS/COA evidence is imported with metadata.
          </p>
          <p v-if="importedSupplierScorecardRows.length || importedRawMaterialIdentitySignals.length" class="autopilot-note">
            Hermes Autopilot has imported {{ importedSupplierScorecardRows.length }} supplier scorecard rows and
            {{ importedRawMaterialIdentitySignals.length }} raw-material signals with source metadata.
          </p>
          <p v-if="sourceReviewSupplierCandidateCount" class="autopilot-note">
            {{ sourceReviewSupplierCandidateCount }} supplier candidate{{ sourceReviewSupplierCandidateCount === 1 ? '' : 's' }}
            {{ sourceReviewSupplierCandidateCount === 1 ? 'is' : 'are' }} shown as review-gated scorecard context until trusted-source import or uploaded supplier evidence creates a fully actionable supplierScorecards record.
          </p>
          <p class="autopilot-note">
            {{ supplierAutopilotStatus }}<span v-if="supplierAutopilotJobId"> · Job {{ supplierAutopilotJobId }}</span>
          </p>
          <div class="supplier-autopilot-strip" aria-label="Automatic supplier research workflow">
            <article v-for="card in supplierAutopilotCards" :key="card.label">
              <span aria-hidden="true">{{ card.icon }}</span>
              <div>
                <small>{{ card.label }}</small>
                <strong>{{ displaySupplierValue(card.value) }}</strong>
                <em>{{ displaySupplierText(card.note) }}</em>
              </div>
            </article>
          </div>
        </div>
        <div class="scorecard-actions">
          <NButton
            size="small"
            type="primary"
            :loading="savingKey === 'supplier-scorecard-autopilot'"
            @click="ensureSupplierScorecardAutopilot({ silent: false })"
          >
            Check Supplier Autopilot
          </NButton>
          <RouterLink class="shell-link" :to="{ name: 'hermes.files' }">Upload supplier evidence</RouterLink>
          <RouterLink class="shell-link" :to="{ name: 'hermes.kanban' }">Open supplier tasks</RouterLink>
          <RouterLink class="shell-link" :to="{ name: 'hermes.trustedSources' }">Full dashboard autopilot</RouterLink>
        </div>
      </header>

      <div class="supplier-scorecard-table-wrap">
        <div class="supplier-scorecard-table">
          <div class="supplier-scorecard-row head">
            <span>Supplier</span>
            <span>Material</span>
            <span>Price/T</span>
            <span>Quality</span>
            <span>Reliability</span>
            <span>Payment</span>
            <span>Score</span>
            <span>Source / Evidence</span>
            <span>Action</span>
          </div>
          <div v-if="!displayedSupplierScorecardRows.length" class="supplier-scorecard-empty">
            <strong>No imported supplier scorecard rows yet.</strong>
            <span>Run Supplier Scorecard Autopilot or upload quote/TDS/SDS/COA evidence. Primary rows appear only after Hermes imports supplierScorecards records with source metadata.</span>
          </div>
          <div
            v-for="row in displayedSupplierScorecardRows"
            :key="`${row.supplier}-${row.material}`"
            class="supplier-scorecard-row"
            :class="{ risk: row.highRisk }"
          >
            <div>
              <strong>{{ row.supplier }}</strong>
              <small>{{ row.region }}</small>
            </div>
            <span>{{ row.material }}</span>
            <span class="verify-value">{{ sensitiveSupplierDisplay(displaySupplierValue(row.pricePerTon)) }}</span>
            <span>{{ sensitiveSupplierDisplay(displaySupplierValue(row.quality)) }}</span>
            <span>{{ sensitiveSupplierDisplay(displaySupplierValue(row.reliability)) }}</span>
            <span>{{ sensitiveSupplierDisplay(displaySupplierValue(row.payment)) }}</span>
            <span class="score-pill">{{ sensitiveSupplierDisplay(displaySupplierValue(row.score)) }}</span>
            <div>
              <a v-if="row.sourceUrl" class="supplier-source-link" :href="row.sourceUrl" target="_blank" rel="noopener noreferrer">
                {{ displaySupplierStatus(row.evidenceStatus) }}
              </a>
              <span v-else class="verify-value">{{ displaySupplierStatus(row.evidenceStatus) }}</span>
              <small>{{ row.sourceTitle }}</small>
              <small>{{ displaySupplierText(row.sourceMeta) }}</small>
              <small>{{ displaySupplierText(row.reviewState) }}</small>
              <small>{{ displaySupplierText(row.sourceSummary) }}</small>
            </div>
            <NButton
              size="tiny"
              secondary
              :loading="savingKey === `${row.supplier}-${row.material}-scorecard`"
              @click="createSupplierScorecardTask(row)"
            >
              Verify Supplier
            </NButton>
          </div>
        </div>
      </div>

      <p class="scorecard-footnote">
        Do not use screenshot prices or supplier scores as verified facts. Supplier scorecards become actionable
        through Kanban tasks and uploaded evidence, not through unsourced dashboard numbers.
      </p>

      <details class="reference-template-archive">
        <summary>Collapsed reference-only supplier target template</summary>
        <p>
          These are planning targets only. They are not source-backed dashboard truth and must be checked through
          Trusted Sources, Research Review, supplier quotes, TDS, SDS, COA, and uploaded evidence before use.
        </p>
        <div class="reference-template-grid">
          <span v-for="row in supplierScorecardRows" :key="`${row.supplier}-${row.material}-reference`">
            {{ row.supplier }} / {{ row.material }}
          </span>
        </div>
      </details>
    </section>

    <section class="workspace-grid">
      <aside class="material-list">
        <button
          v-for="material in materials"
          :key="material.id"
          class="material-row"
          :class="{ active: selectedMaterial?.id === material.id, risk: material.highRisk, alerting: visibleMaterialPriceAlert(material).triggered }"
          @click="selectedMaterialId = material.id"
        >
          <strong>{{ material.name }}</strong>
          <span class="status-badge" :class="material.evidenceStatus.toLowerCase().replace(/\s+/g, '-')">{{ displaySupplierStatus(material.evidenceStatus) }}</span>
          <small v-if="identitySignalForMaterial(material)">Official identity evidence imported</small>
          <small v-else-if="material.highRisk">High regulatory/safety risk</small>
          <small v-else>{{ material.sourceType }}</small>
        </button>
      </aside>

      <main v-if="selectedMaterial" class="detail-panel">
        <header class="detail-header">
          <div>
            <p class="eyebrow">Selected material</p>
            <h3>{{ selectedMaterial.name }}</h3>
            <p>{{ selectedMaterial.highRisk ? 'High regulatory/safety risk. Verify DMS handling and legal status before use.' : 'No price is treated as fact until sourced.' }}</p>
          </div>
          <span class="status-pill">{{ displaySupplierStatus(selectedMaterial.evidenceStatus) }}</span>
        </header>

        <section v-if="selectedMaterial.highRisk" class="risk-banner">
          <strong>DMS / dimethyl sulfate high-risk checkpoint</strong>
          <span>Verify exact chemical identity, regulatory status, handling rules, and source evidence before using this material in costing, process, or investor material.</span>
        </section>

        <section v-if="selectedIdentitySignal" class="identity-signal-panel">
          <div>
            <p class="eyebrow">Official identity evidence</p>
            <h3>{{ selectedIdentitySignal.material }}</h3>
            <p>{{ displaySupplierText(selectedIdentitySignal.value) }}</p>
          </div>
          <div class="identity-signal-grid">
            <article>
              <span>CAS</span>
              <strong>{{ selectedIdentitySignal.cas || 'Review source' }}</strong>
            </article>
            <article>
              <span>Formula</span>
              <strong>{{ selectedIdentitySignal.formula || 'Review source' }}</strong>
            </article>
            <article>
              <span>Evidence</span>
              <strong>{{ displaySupplierStatus(selectedIdentitySignal.evidenceStatus) }}</strong>
            </article>
            <article>
              <span>Confidence</span>
              <strong>{{ selectedIdentitySignal.confidence }}</strong>
            </article>
          </div>
          <p class="identity-source">
            <a v-if="selectedIdentitySignal.sourceUrl" :href="selectedIdentitySignal.sourceUrl" target="_blank" rel="noopener noreferrer">
              {{ selectedIdentitySignal.sourceTitle }}
            </a>
            <span v-else>{{ selectedIdentitySignal.sourceTitle }}</span>
            <small v-if="selectedIdentitySignal.lastChecked">Last checked {{ selectedIdentitySignal.lastChecked }}</small>
          </p>
          <p class="scorecard-footnote">{{ selectedIdentitySignal.riskReason }}</p>
        </section>

        <section class="price-grid">
          <article>
            <span>Latest RMB</span>
            <strong>{{ priceDisplay(selectedLatest?.rmbPrice, 'RMB') }}</strong>
          </article>
          <article>
            <span>Latest USD</span>
            <strong>{{ priceDisplay(selectedLatest?.usdPrice, 'USD') }}</strong>
          </article>
          <article>
            <span>7-day trend</span>
            <strong>{{ trendLabel(selectedMaterial, 7) }}</strong>
          </article>
          <article>
            <span>30-day trend</span>
            <strong>{{ trendLabel(selectedMaterial, 30) }}</strong>
          </article>
        </section>

        <p v-if="selectedAlert.triggered" class="alert">
          {{ selectedAlert.direction === 'increase' ? 'Increase' : 'Decrease' }} alert:
          {{ selectedAlert.percentChange.toFixed(1) }}% from previous saved price.
        </p>

        <section class="form-panel">
          <h3>Add manual price/source entry</h3>
          <div class="form-grid">
            <label>RMB price <input v-model.number="priceForm.rmbPrice" type="number" min="0" placeholder="Hermes verifies if blank" /></label>
            <label>USD price <input v-model.number="priceForm.usdPrice" type="number" min="0" placeholder="Hermes verifies if blank" /></label>
            <label>Unit <input v-model="priceForm.unit" /></label>
            <label>
              Source type
              <select v-model="priceForm.sourceType">
                <option v-for="type in sourceTypes" :key="type" :value="type">{{ type }}</option>
              </select>
            </label>
            <label>Source / supplier <input v-model="priceForm.source" placeholder="Source title, supplier, URL, or document ref" /></label>
            <label>Source date <input v-model="priceForm.sourceDate" type="date" /></label>
            <label>
              Confidence
              <select v-model="priceForm.confidence">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>Notes <input v-model="priceForm.notes" placeholder="Confirmation need, country, supplier note" /></label>
          </div>
          <NButton type="primary" @click="addPriceEntry">Save price entry</NButton>
        </section>

        <section class="history-panel">
          <h3>Price history graph</h3>
          <p v-if="!selectedApprovedPriceHistory.length" class="empty-state-panel">
            No approved or source-backed price history yet. Reference listings and unapproved manual prices stay hidden until source review.
          </p>
          <p v-if="selectedMaterial.priceHistory.length && !selectedApprovedPriceHistory.length" class="scorecard-footnote">
            Saved reference prices exist for this material, but they are not shown as dashboard facts.
          </p>
          <div v-for="entry in selectedApprovedPriceHistory.slice(0, 10)" :key="entry.id" class="history-row">
            <span>{{ entry.sourceDate || entry.createdAt.slice(0, 10) }}</span>
            <div class="bar-track"><div class="bar" :style="{ width: graphWidth(entry, selectedApprovedPriceHistory) }" /></div>
            <strong>{{ priceDisplay(entry.rmbPrice || entry.usdPrice, entry.rmbPrice ? 'RMB' : 'USD') }}</strong>
            <small>{{ displaySupplierStatus(entry.evidenceStatus) }} / {{ entry.sourceType }}</small>
          </div>
        </section>

        <section class="action-panel">
          <div>
            <h3>Hermes actions</h3>
            <p>
              Alibaba/Made-in-China references stay Reference Only / To Confirm. Supplier quote tasks and research jobs
              do not update dashboard facts until you review the source.
            </p>
          </div>
          <div class="action-row">
            <NButton :loading="savingKey === `${selectedMaterial.id}-task`" @click="createTask(selectedMaterial, 'Verify supplier quote, source date, and price evidence.')">Add supplier confirmation task</NButton>
            <NButton :loading="savingKey === `${selectedMaterial.id}-research`" @click="scheduleResearch(selectedMaterial)">Schedule deeper research</NButton>
            <RouterLink class="shell-link" :to="{ name: 'hermes.files' }">Upload quote in Documents</RouterLink>
          </div>
        </section>
      </main>
    </section>
  </div>
</template>

<style scoped>
.sourcing-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-header,
.summary-card,
.supplier-scorecard-panel,
.material-list,
.detail-panel,
.form-panel,
.history-panel,
.action-panel {
  border: 1px solid rgba(128, 162, 190, 0.26);
  background: rgba(5, 14, 24, 0.84);
  border-radius: 8px;
}

.page-header,
.summary-card,
.detail-panel,
.form-panel,
.history-panel,
.action-panel {
  position: relative;
  overflow: hidden;
}

.summary-card::before,
.supplier-scorecard-panel::before,
.detail-panel::before,
.form-panel::before,
.history-panel::before,
.action-panel::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, #f2c86b, rgba(242, 200, 107, 0.18));
}

.page-header,
.supplier-scorecard-panel,
.detail-panel,
.form-panel,
.history-panel,
.action-panel {
  padding: 18px;
}

.page-header,
.detail-header,
.action-panel,
.scorecard-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.header-actions,
.action-row,
.scorecard-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.eyebrow,
.summary-card span {
  color: #38d5ff;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0;
}

.header-title,
h3 {
  color: #f2c86b;
}

.page-copy,
p,
small,
label,
.material-row span {
  color: #a8b6c7;
}

.warning,
.alert {
  color: #f5bf5a;
}

.identity-signal-panel {
  border: 1px solid rgba(56, 213, 255, 0.24);
  border-radius: 8px;
  padding: 14px;
  background:
    linear-gradient(135deg, rgba(56, 213, 255, 0.08), transparent 70%),
    rgba(0, 0, 0, 0.16);
}

.identity-signal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
  margin: 12px 0;
}

.identity-signal-grid article {
  border: 1px solid rgba(128, 162, 190, 0.22);
  border-radius: 8px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.identity-signal-grid span,
.identity-source small {
  display: block;
  color: #7f91ad;
  font-size: 11px;
  text-transform: uppercase;
}

.identity-signal-grid strong {
  display: block;
  margin-top: 4px;
  color: #f6fbff;
}

.identity-source {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}

.summary-grid,
.price-grid,
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.summary-card,
.price-grid article {
  padding: 14px;
}

.summary-card strong,
.price-grid strong {
  display: block;
  margin-top: 6px;
  color: #f6fbff;
}

.supplier-scorecard-panel {
  border-color: rgba(242, 200, 107, 0.55);
  background:
    linear-gradient(135deg, rgba(242, 200, 107, 0.06), transparent 42%),
    rgba(5, 14, 24, 0.9);
}

.autopilot-note {
  margin: 10px 0 0;
  border: 1px solid rgba(56, 213, 255, 0.22);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(56, 213, 255, 0.06);
  color: #c8d4e3;
}

.supplier-autopilot-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.supplier-autopilot-strip article {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  min-height: 104px;
  border: 1px solid rgba(56, 213, 255, 0.2);
  border-radius: 8px;
  padding: 11px;
  background:
    linear-gradient(135deg, rgba(56, 213, 255, 0.08), transparent 70%),
    rgba(0, 0, 0, 0.14);
}

.supplier-autopilot-strip article > span {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(242, 200, 107, 0.34);
  border-radius: 999px;
  background: rgba(242, 200, 107, 0.08);
}

.supplier-autopilot-strip small {
  color: #7f91ad;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.supplier-autopilot-strip strong {
  display: block;
  margin-top: 3px;
  color: #38d5ff;
  font-size: 15px;
}

.supplier-autopilot-strip em {
  display: block;
  margin-top: 5px;
  color: #a8b6c7;
  font-size: 12px;
  font-style: normal;
  line-height: 1.4;
}

.supplier-scorecard-table-wrap {
  margin-top: 16px;
  overflow-x: auto;
}

.supplier-scorecard-table {
  min-width: 1180px;
}

.supplier-scorecard-row {
  display: grid;
  grid-template-columns: 1.45fr 1.55fr 0.85fr 0.95fr 0.95fr 0.85fr 1fr 1.35fr 128px;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid rgba(128, 162, 190, 0.18);
  padding: 12px 14px;
  color: #c8d4e3;
}

.supplier-scorecard-empty {
  display: grid;
  gap: 6px;
  padding: 18px;
  border-bottom: 1px solid rgba(128, 162, 190, 0.18);
  color: #a8b6c7;
}

.supplier-scorecard-empty strong {
  color: #f6fbff;
}

.supplier-scorecard-row.head {
  border-bottom: 2px solid rgba(242, 200, 107, 0.78);
  color: #f2c86b;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.supplier-scorecard-row.risk {
  background: rgba(255, 94, 94, 0.06);
}

.supplier-scorecard-row strong {
  color: #f6fbff;
}

.supplier-scorecard-row small {
  display: block;
  margin-top: 3px;
}

.verify-value {
  color: #f5bf5a;
  font-weight: 700;
}

.score-pill {
  width: fit-content;
  border: 1px solid rgba(245, 191, 90, 0.36);
  border-radius: 999px;
  padding: 4px 9px;
  color: #f5bf5a;
  font-size: 12px;
}

.supplier-source-link {
  color: #38d5ff;
  font-weight: 700;
  text-decoration: none;
}

.scorecard-footnote {
  margin: 14px 0 0;
  border-top: 1px solid rgba(242, 200, 107, 0.25);
  padding-top: 12px;
  color: #f5bf5a;
}

.reference-template-archive {
  margin-top: 12px;
  border: 1px solid rgba(128, 162, 190, 0.24);
  border-radius: 8px;
  padding: 12px;
  color: #a8b6c7;
}

.reference-template-archive summary {
  color: #38d5ff;
  cursor: pointer;
  font-weight: 800;
}

.reference-template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.reference-template-grid span {
  border: 1px solid rgba(128, 162, 190, 0.18);
  border-radius: 7px;
  padding: 8px;
  background: rgba(128, 162, 190, 0.06);
  color: #c8d4e3;
  font-size: 12px;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr;
  gap: 14px;
}

.material-list {
  padding: 8px;
  max-height: 78vh;
  overflow: auto;
}

.material-row {
  display: grid;
  width: 100%;
  gap: 4px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #f6fbff;
  text-align: left;
}

.material-row.risk {
  border-color: rgba(245, 191, 90, 0.36);
}

.material-row.alerting {
  background: rgba(245, 191, 90, 0.08);
}

.material-row.active,
.material-row:hover {
  border-color: rgba(56, 213, 255, 0.45);
  background: rgba(56, 213, 255, 0.08);
}

.material-row .status-badge {
  width: fit-content;
  padding: 2px 7px;
  font-size: 10px;
}

.detail-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-pill {
  align-self: start;
  border: 1px solid rgba(56, 213, 255, 0.45);
  border-radius: 999px;
  padding: 4px 10px;
  color: #38d5ff;
}

input,
select {
  width: 100%;
  margin-top: 6px;
  border: 1px solid rgba(128, 162, 190, 0.28);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.24);
  color: #f6fbff;
  padding: 8px;
}

.history-row {
  display: grid;
  grid-template-columns: 90px minmax(80px, 1fr) minmax(110px, max-content) minmax(140px, max-content);
  gap: 10px;
  align-items: center;
  padding: 8px 0;
}

.bar-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(128, 162, 190, 0.18);
}

.bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #38d5ff, #f2c86b);
}

.shell-link {
  color: #38d5ff;
  text-decoration: none;
}

@media (max-width: 900px) {
  .workspace-grid,
  .page-header,
  .scorecard-header,
  .detail-header,
  .action-panel {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .supplier-autopilot-strip {
    grid-template-columns: 1fr;
  }

  .history-row {
    grid-template-columns: 1fr;
  }
}
</style>
