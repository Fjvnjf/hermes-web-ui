import type { IntelligenceEvidenceStatus, SourceReference } from '@/utils/investorIntelligence'

export type TrustedSourceTier = 'tier1-official' | 'tier2-market-reference' | 'tier3-supplier-evidence' | 'tier4-public-listing' | 'candidate-source'

export type TrustedSourceDataType =
  | 'trade_data'
  | 'market_size'
  | 'price_data'
  | 'competitor_data'
  | 'company_data'
  | 'regulatory_data'
  | 'financial_data'
  | 'supplier_quote'
  | 'document_evidence'
  | 'internal_activity'

export type AutopilotScreen = 'executive' | 'market' | 'investment' | 'competitor'

export interface TrustedSourceRecord {
  source_id: string
  name: string
  domain: string
  tier: TrustedSourceTier
  data_type: TrustedSourceDataType
  allowed_for: AutopilotScreen[]
  confidence_default: 'low' | 'medium' | 'high'
  requires_review: boolean
  enabled: boolean
  last_checked?: string | null
  last_failure?: string | null
  notes: string
}

export interface TrustedSourceSnapshotClaim {
  id: string
  label: string
  value: string
  previousValue?: string
  changePercent?: number | null
  evidenceStatus: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  source: SourceReference
  dataType: TrustedSourceDataType
  reviewRequired: boolean
  sensitive?: boolean
  notes?: string
}

export interface TrustedSourceSnapshot {
  snapshot_id: string
  screen: AutopilotScreen
  generated_at: string
  source_ids: string[]
  claims: TrustedSourceSnapshotClaim[]
  evidence_status: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  changed_fields: string[]
  conflicts: string[]
  review_required: boolean
  job_id?: string
  user_visibility: 'owner-only' | 'employee-safe' | 'financial-only' | 'investor-blocked'
  redaction_rules: string[]
}

export interface TrustedSourceCandidate {
  name?: string
  url?: string
  domain?: string
  dataType: TrustedSourceDataType
  screen?: AutopilotScreen
}

const TIER1_DOMAINS = [
  'comtradeplus.un.org',
  'uncomtrade.org',
  'worldbank.org',
  'wto.org',
  'stats.gov.cn',
  'customs.gov.cn',
  'sec.gov',
  'hkexnews.hk',
  'ec.europa.eu',
  'echa.europa.eu',
]

const TIER2_DOMAINS = [
  'sunsirs.com',
  'echemi.com',
]

const TIER4_DOMAINS = [
  'alibaba.com',
  'made-in-china.com',
]

export const DEFAULT_TRUSTED_SOURCES: TrustedSourceRecord[] = [
  sourceRecord('un-comtrade', 'UN Comtrade', 'comtradeplus.un.org', 'tier1-official', 'trade_data', ['market'], 'high', false, 'Official trade/import/export data. Use exact HS-code evidence or label proxy/To Verify.'),
  sourceRecord('world-bank', 'World Bank', 'worldbank.org', 'tier1-official', 'company_data', ['market'], 'high', false, 'Official macro and country indicator source.'),
  sourceRecord('official-regulators', 'Official chemical regulator sources', 'gov / regulator domains', 'tier1-official', 'regulatory_data', ['executive', 'market', 'competitor'], 'high', false, 'Official government or regulator pages only.'),
  sourceRecord('official-company-sites', 'Official company websites and filings', 'company official domains', 'tier1-official', 'competitor_data', ['competitor'], 'high', false, 'Official product pages, catalogs, annual reports, exchange filings, SDS/TDS.'),
  sourceRecord('sunsirs', 'SunSirs', 'sunsirs.com', 'tier2-market-reference', 'price_data', ['market', 'competitor'], 'medium', false, 'Market reference only. Capture source/date and keep price-sensitive fields redacted.'),
  sourceRecord('echemi', 'ECHEMI', 'echemi.com', 'tier2-market-reference', 'price_data', ['market', 'competitor'], 'medium', false, 'Market reference only. Do not treat listings as final verified pricing.'),
  sourceRecord('supplier-documents', 'Supplier quotes / PI / invoice / SDS / TDS', 'uploaded supplier evidence', 'tier3-supplier-evidence', 'supplier_quote', ['executive', 'investment', 'competitor'], 'medium', false, 'Supplier evidence can update quote fields, but cost/formula visibility remains restricted.'),
  sourceRecord('alibaba', 'Alibaba marketplace listings', 'alibaba.com', 'tier4-public-listing', 'price_data', ['market', 'competitor'], 'low', true, 'Weak public listing. Reference Only / To Confirm, never Verified.'),
  sourceRecord('made-in-china', 'Made-in-China marketplace listings', 'made-in-china.com', 'tier4-public-listing', 'price_data', ['market', 'competitor'], 'low', true, 'Weak public listing. Reference Only / To Confirm, never Verified.'),
]

function sourceRecord(
  source_id: string,
  name: string,
  domain: string,
  tier: TrustedSourceTier,
  data_type: TrustedSourceDataType,
  allowed_for: AutopilotScreen[],
  confidence_default: 'low' | 'medium' | 'high',
  requires_review: boolean,
  notes: string,
): TrustedSourceRecord {
  return {
    source_id,
    name,
    domain,
    tier,
    data_type,
    allowed_for,
    confidence_default,
    requires_review,
    enabled: true,
    last_checked: null,
    last_failure: null,
    notes,
  }
}

export function normalizeDomain(input = ''): string {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return ''
  try {
    return new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, '')
  } catch {
    return trimmed.replace(/^www\./, '').split('/')[0]
  }
}

export function classifySourceCandidate(candidate: TrustedSourceCandidate): Omit<TrustedSourceRecord, 'source_id' | 'last_checked' | 'last_failure'> {
  const domain = normalizeDomain(candidate.domain || candidate.url || '')
  const isTier1 = TIER1_DOMAINS.some(item => domain.endsWith(item))
  const isTier2 = TIER2_DOMAINS.some(item => domain.endsWith(item))
  const isTier4 = TIER4_DOMAINS.some(item => domain.endsWith(item))
  const tier: TrustedSourceTier = isTier1
    ? 'tier1-official'
    : isTier2
      ? 'tier2-market-reference'
      : isTier4
        ? 'tier4-public-listing'
        : 'candidate-source'
  return {
    name: candidate.name?.trim() || domain || 'Candidate Source',
    domain: domain || 'unknown',
    tier,
    data_type: candidate.dataType,
    allowed_for: candidate.screen ? [candidate.screen] : ['executive', 'market', 'investment', 'competitor'],
    confidence_default: tier === 'tier1-official' ? 'high' : tier === 'tier2-market-reference' ? 'medium' : 'low',
    requires_review: tier === 'tier4-public-listing' || tier === 'candidate-source',
    enabled: true,
    notes: tier === 'candidate-source'
      ? 'Unknown source. Store as Candidate Source / To Verify until owner classifies it.'
      : 'Auto-classified from allowlisted domain.',
  }
}

export function evidenceStatusForTier(tier: TrustedSourceTier, hasConflict = false): IntelligenceEvidenceStatus {
  if (hasConflict) return 'Conflict Detected'
  if (tier === 'tier1-official') return 'Trusted Source Auto-Updated'
  if (tier === 'tier2-market-reference') return 'Market Reference'
  if (tier === 'tier3-supplier-evidence') return 'Supplier Evidence'
  if (tier === 'tier4-public-listing') return 'Reference Only'
  return 'Candidate Source'
}

export function sourceRequiresReview(source: TrustedSourceRecord, options: {
  hasConflict?: boolean
  investorApprovedImpact?: boolean
  largeChange?: boolean
  sensitiveVisibilityRisk?: boolean
  overwritesUserApprovedAssumption?: boolean
} = {}): boolean {
  return source.requires_review ||
    !!options.hasConflict ||
    !!options.investorApprovedImpact ||
    !!options.largeChange ||
    !!options.sensitiveVisibilityRisk ||
    !!options.overwritesUserApprovedAssumption
}

export function isSensitiveAutopilotDataType(dataType: TrustedSourceDataType): boolean {
  return dataType === 'price_data' ||
    dataType === 'financial_data' ||
    dataType === 'supplier_quote'
}

export function snapshotVisibility(screen: AutopilotScreen, dataTypes: TrustedSourceDataType[]): TrustedSourceSnapshot['user_visibility'] {
  if (screen === 'investment' || dataTypes.some(isSensitiveAutopilotDataType)) return 'financial-only'
  if (screen === 'executive') return 'owner-only'
  return 'employee-safe'
}
