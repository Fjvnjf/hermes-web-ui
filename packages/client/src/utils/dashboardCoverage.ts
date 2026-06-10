import type { FeasibilityIntelligenceState } from '@/composables/useFeasibilityIntelligence'
import { normalizedMarketClaimStatus } from '@/utils/investorIntelligence'

export interface CoverageTarget {
  label: string
  aliases: string[]
  metric?: CompetitorMetricField
  companyAliases?: string[]
}

export type CoverageTextScope = 'market' | 'competitor' | 'supplier' | 'regulatory' | 'financial' | 'investor'

export interface CoverageRequirement {
  area: string
  fills: string
  review: string
  textScope: CoverageTextScope
  targets: CoverageTarget[]
}

export interface CoverageRow extends CoverageRequirement {
  coveredCount: number
  totalTargets: number
  missingTargets: CoverageTarget[]
  status: 'covered' | 'partial' | 'missing'
}

export function normalizeCoverageAlias(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function target(label: string, ...aliases: string[]): CoverageTarget {
  return {
    label,
    aliases: [label, ...aliases].map(normalizeCoverageAlias),
  }
}

type CompetitorMetricField =
  | 'pricingEvidence'
  | 'marketShare'
  | 'revenue'
  | 'yearlyGrowth'
  | 'traffic'
  | 'rating'
  | 'lastUpdated'
  | 'source'
  | 'confidence'
  | 'recommendedAction'

const PLACEHOLDER_PATTERN = /^(to verify|missing|missing \/ to verify|research required|api-ready|reference only|trade proxy|no source-backed value yet|no approved source-backed value|awaiting trusted-source import|source search running|auto-checking|review required|restricted)$/i

const COMPETITOR_METRIC_REQUIREMENTS: Array<{
  label: string
  field: CompetitorMetricField
  aliases: string[]
}> = [
  { label: 'Price evidence', field: 'pricingEvidence', aliases: ['price', 'pricing evidence', 'price kg', 'price per kg'] },
  { label: 'Market share', field: 'marketShare', aliases: ['market share', 'share'] },
  { label: 'Revenue', field: 'revenue', aliases: ['revenue', 'sales', 'turnover'] },
  { label: 'YoY growth', field: 'yearlyGrowth', aliases: ['yoy growth', 'yearly growth', 'annual growth'] },
  { label: 'Traffic', field: 'traffic', aliases: ['traffic', 'website traffic', 'monthly visits'] },
  { label: 'Rating', field: 'rating', aliases: ['rating', 'review rating', 'customer rating'] },
  { label: 'Last updated / source date', field: 'lastUpdated', aliases: ['last updated', 'source date', 'last checked'] },
  { label: 'Source metadata', field: 'source', aliases: ['source', 'source title', 'source url', 'source metadata'] },
  { label: 'Confidence', field: 'confidence', aliases: ['confidence', 'confidence score'] },
  { label: 'Next action', field: 'recommendedAction', aliases: ['next action', 'recommended action', 'suggested task'] },
]

type EvidenceBackedCompetitorMetricField = Exclude<CompetitorMetricField, 'source' | 'confidence' | 'recommendedAction'>
const EVIDENCE_BACKED_COMPETITOR_METRICS: EvidenceBackedCompetitorMetricField[] = [
  'pricingEvidence',
  'marketShare',
  'revenue',
  'yearlyGrowth',
  'traffic',
  'rating',
  'lastUpdated',
]

function isEvidenceBackedCompetitorMetricField(field: CompetitorMetricField | undefined): field is EvidenceBackedCompetitorMetricField {
  return Boolean(field && EVIDENCE_BACKED_COMPETITOR_METRICS.includes(field as EvidenceBackedCompetitorMetricField))
}

const COMPETITOR_COMPANY_TARGETS = [
  target('Evonik Industries', 'evonik'),
  target('Stepan Company', 'stepan'),
  target('Kao Corporation', 'kao'),
  target('WACKER', 'wacker'),
  target('Rudolf Group', 'rudolf'),
  target('CHT Group', 'cht'),
  target('Archroma', 'archroma'),
  target('Transfar', 'transfar'),
  target('Zschimmer & Schwarz', 'zschimmer', 'schwarz'),
  target('Pulcra Chemicals', 'pulcra'),
  target('Syensqo / Solvay', 'syensqo', 'solvay'),
]

export const dashboardCoverageRequirements: CoverageRequirement[] = [
  {
    area: 'Market Intelligence',
    fills: 'Trade proxies, country signals, market questions, source-backed segments',
    review: 'Market size, CAGR, consumption, and target claims stay To Verify unless strong evidence exists',
    textScope: 'market',
    targets: [
      target('China', 'china', 'zhejiang', 'guangdong', 'jiangsu'),
      target('Bangladesh', 'bangladesh'),
      target('India', 'india'),
      target('Vietnam', 'vietnam'),
      target('Pakistan', 'pakistan'),
      target('Turkey', 'turkey', 'turkiye'),
      target('Indonesia', 'indonesia'),
      target('EU / Germany', 'eu', 'europe', 'germany'),
      target('United States', 'united states', 'usa', 'u.s.'),
      target('GCC / Middle East', 'gcc', 'middle east', 'saudi', 'uae'),
    ],
  },
  {
    area: 'Competitor Intelligence',
    fills: 'Company presence, product equivalents, certifications, distribution evidence',
    review: 'Market share, pricing, strengths/weaknesses, and unsupported rankings are staged for review',
    textScope: 'competitor',
    targets: COMPETITOR_COMPANY_TARGETS,
  },
  {
    area: 'Raw Materials / Supplier Scorecards',
    fills: 'Supplier evidence candidates, material signals, SDS/TDS/COA/quote references',
    review: 'Supplier prices, payment terms, quality/reliability scores, and cost data remain sensitive',
    textScope: 'supplier',
    targets: [
      target('Stearic acid', 'stearic'),
      target('Triethanolamine / TEA', 'triethanolamine', 'tea'),
      target('Dimethyl sulfate / DMS', 'dimethyl sulfate', 'dms'),
      target('PDMS silicone oil', 'pdms', 'silicone oil'),
      target('Acetic acid', 'acetic acid'),
      target('Ethoxylates', 'ethoxylate'),
      target('Packaging', 'packaging'),
      target('Wilmar', 'wilmar'),
      target('KLK OLEO', 'klk'),
      target('BASF', 'basf'),
      target('Dow', 'dow'),
      target('WACKER', 'wacker'),
    ],
  },
  {
    area: 'Investment / IRR',
    fills: 'Approved internal scenario snapshots and finance evidence candidates',
    review: 'IRR, NPV, payback, ROI, capex, costing, and investor claims are never silently approved',
    textScope: 'financial',
    targets: [
      target('Lean scenario', 'lean'),
      target('Base scenario', 'base'),
      target('Conservative scenario', 'conservative'),
      target('Aggressive scenario', 'aggressive'),
      target('Total investment', 'total investment'),
      target('IRR', 'irr'),
      target('NPV', 'npv'),
      target('Payback', 'payback'),
      target('ROI', 'roi'),
      target('Working capital', 'working capital'),
      target('Capex breakdown', 'capex', 'investment breakdown'),
    ],
  },
  {
    area: 'Regulatory / Data Room',
    fills: 'Regulatory findings, source gaps, document evidence candidates',
    review: 'DMS, CAS, formula, permit, factory approval, and safety claims require owner review',
    textScope: 'regulatory',
    targets: [
      target('DMS safety / regulatory status', 'dms', 'dimethyl sulfate'),
      target('SDS / TDS / CAS evidence', 'sds', 'tds', 'cas'),
      target('China import / storage / transport / use', 'china import', 'storage', 'transport', 'use requirements'),
      target('Factory chemical approvals', 'factory approval', 'chemical approval', 'permit'),
      target('IECSC / China inventory', 'iecsc', 'china chemical inventory'),
    ],
  },
  {
    area: 'Reports / Presentation',
    fills: 'Investor material candidates only after evidence labels are preserved',
    review: 'Investor-approved material remains approval-gated and excludes unsupported claims',
    textScope: 'investor',
    targets: [
      target('Approved facts', 'approved fact', 'source-backed'),
      target('Approved assumptions', 'approved assumption'),
      target('Risk register', 'risk register', 'risk'),
      target('Data-room gaps', 'data-room', 'data room'),
      target('Presentation snippets', 'presentation', 'slide', 'snippet'),
    ],
  },
]

export function coverageTextHasAlias(text: string, alias: string): boolean {
  if (!alias) return false
  if (alias.length <= 3) {
    return new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(text)
  }
  return text.includes(alias)
}

function sourceIsUsable(source?: { title?: string; url?: string; date?: string } | null): boolean {
  const title = source?.title?.trim()
  if (!title || /^source missing$/i.test(title)) return false
  return Boolean(source?.url?.trim() || source?.date?.trim())
}

function coverageStatusIsSourceBacked(status?: string | null): boolean {
  return [
    'Verified',
    'User Approved',
    'Investor Approved',
    'Approved Assumption',
    'Source-backed',
    'Official Data',
    'Trusted Source Auto-Updated',
    'Supplier Evidence',
    'Official Company Evidence',
  ].includes(String(status || '').trim())
}

function coverageValueIsUsable(value: unknown): boolean {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return false
  if (PLACEHOLDER_PATTERN.test(text)) return false
  return true
}

function recordMatchesCompanyTarget(
  record: {
    companyName?: string
    title?: string
    label?: string
    productEquivalent?: string
    notes?: string
  },
  target: CoverageTarget,
): boolean {
  const text = normalizeCoverageAlias([
    record.companyName,
    record.title,
    record.label,
    record.productEquivalent,
    record.notes,
  ].filter(Boolean).join(' '))
  const aliases = target.companyAliases?.length ? target.companyAliases : target.aliases
  return aliases.some(alias => coverageTextHasAlias(text, alias))
}

function dashboardTargetMatchesCompanyTarget(
  record: {
    companyName?: string
    title?: string
    label?: string
    productEquivalent?: string
    field?: string
    proposedDashboardField?: string
  },
  target: CoverageTarget,
): boolean {
  const text = normalizeCoverageAlias([
    record.companyName,
    record.title,
    record.label,
    record.productEquivalent,
    record.field,
    record.proposedDashboardField,
  ].filter(Boolean).join(' '))
  const aliases = target.companyAliases?.length ? target.companyAliases : target.aliases
  return aliases.some(alias => coverageTextHasAlias(text, alias))
}

function competitorMetricValue(
  record: {
    pricingEvidence?: string
    marketShare?: string
    revenue?: string
    yearlyGrowth?: string
    traffic?: string
    rating?: string
    lastUpdated?: string
    updatedAt?: string
    source?: { title?: string; url?: string; date?: string } | null
    confidence?: string
    recommendedAction?: string
    suggestedTask?: string
  },
  field: CompetitorMetricField,
): string {
  if (field === 'source') return record.source?.title || record.source?.date || ''
  if (field === 'confidence') return record.confidence || ''
  if (field === 'recommendedAction') return record.recommendedAction || record.suggestedTask || ''
  if (field === 'lastUpdated') return record.lastUpdated || record.updatedAt || record.source?.date || ''
  return String(record[field] || '')
}

function competitorMetricCandidateHasStrongCoverageEvidence(
  finding: unknown,
  dashboardTarget: unknown,
): boolean {
  const findingRecord = (finding && typeof finding === 'object') ? finding as Record<string, unknown> : {}
  const targetRecord = (dashboardTarget && typeof dashboardTarget === 'object') ? dashboardTarget as Record<string, unknown> : {}
  const tier = String(
    findingRecord.sourceTier ||
    targetRecord.sourceTier ||
    findingRecord.reportedSourceTier ||
    targetRecord.reportedSourceTier ||
    '',
  ).toLowerCase()
  if (!tier) return false
  if (/tier4|tier 4|tier5|tier 5|candidate|public listing|market reference|weak/i.test(tier)) return false
  if (!/(tier1|tier 1|tier2|tier 2|tier3|tier 3|official|supplier evidence|company official)/i.test(tier)) return false
  return String(findingRecord.confidence || targetRecord.confidence || '').toLowerCase() !== 'low'
}

function competitorMetricEvidenceCovered(
  record: FeasibilityIntelligenceState['competitors'][number],
  field: EvidenceBackedCompetitorMetricField,
): boolean {
  const evidence = record.metricEvidence?.[field]
  if (!evidence || evidence.reviewRequired) return false
  return sourceIsUsable(evidence.source) &&
    coverageStatusIsSourceBacked(String(evidence.evidenceStatus || record.evidenceStatus)) &&
    coverageValueIsUsable(competitorMetricValue({
      ...record,
      [field]: evidence.value || '',
      source: evidence.source || record.source,
    }, field))
}

function competitorMetricCovered(state: FeasibilityIntelligenceState, target: CoverageTarget): boolean {
  const targetMetric = target.metric
  if (!targetMetric) return false

  const approvedRecord = state.competitors.some(record => {
    if (!recordMatchesCompanyTarget(record, target)) return false
    if (targetMetric === 'source') return sourceIsUsable(record.source) ||
      Object.values(record.metricEvidence || {}).some(evidence => sourceIsUsable(evidence?.source))
    if (targetMetric === 'confidence') return sourceIsUsable(record.source) &&
      coverageValueIsUsable(record.confidence)
    if (targetMetric === 'recommendedAction') return coverageValueIsUsable(record.recommendedAction || record.riskReason || record.notes)
    return isEvidenceBackedCompetitorMetricField(targetMetric) &&
      competitorMetricEvidenceCovered(record, targetMetric)
  })
  if (approvedRecord) return true

  return state.researchFindings.some(finding => {
    if (finding.status !== 'Pending Review' && finding.status !== 'To Verify') return false
    const dashboardTarget = finding.dashboardTarget
    if (!dashboardTarget || dashboardTarget.group !== 'competitorRecords') return false
    const dashboardMetricRecord = {
      ...(dashboardTarget as unknown as Record<string, unknown>),
      source: finding.source,
      confidence: finding.confidence,
      recommendedAction: dashboardTarget.recommendedAction || finding.suggestedTask,
    }
    return dashboardTargetMatchesCompanyTarget(dashboardTarget, target) &&
      sourceIsUsable(finding.source) &&
      competitorMetricCandidateHasStrongCoverageEvidence(finding, dashboardTarget) &&
      coverageValueIsUsable(competitorMetricValue(dashboardMetricRecord, targetMetric))
  })
}

function textRecordMatchesTarget(values: Array<string | undefined | null>, target: CoverageTarget): boolean {
  const text = normalizeCoverageAlias(values.filter(Boolean).join(' '))
  return target.aliases.some(alias => coverageTextHasAlias(text, alias))
}

function marketTargetCovered(state: FeasibilityIntelligenceState, target: CoverageTarget): boolean {
  const sourceBackedClaim = state.marketClaims.some(claim =>
    textRecordMatchesTarget([
      claim.label,
      claim.value,
      claim.fieldKey,
      claim.proposedDashboardField,
      claim.source?.title,
    ], target) &&
    sourceIsUsable(claim.source) &&
    claim.reviewRequired !== true &&
    coverageStatusIsSourceBacked(normalizedMarketClaimStatus(claim)),
  )
  if (sourceBackedClaim) return true

  const sourceBackedDataRoomRecord = state.dataRoomSources.some(record =>
    (record.area === 'market' || record.dashboardGroup === 'marketClaims') &&
    textRecordMatchesTarget([
      record.checklistLabel,
      record.proposedValue,
      record.fieldKey,
      record.proposedDashboardField,
      record.notes,
      record.source?.title,
    ], target) &&
    sourceIsUsable(record.source) &&
    record.reviewRequired !== true &&
    coverageStatusIsSourceBacked(record.evidenceStatus),
  )
  if (sourceBackedDataRoomRecord) return true

  return state.researchFindings.some(finding =>
    (finding.area === 'market' || finding.dashboardTarget?.group === 'marketClaims') &&
    finding.status === 'Approved' &&
    textRecordMatchesTarget([
      finding.keyClaim,
      finding.summary,
      finding.dashboardTarget?.value,
      finding.dashboardTarget?.field,
      finding.dashboardTarget?.fieldKey,
      finding.dashboardTarget?.proposedDashboardField,
      finding.source?.title,
    ], target) &&
    sourceIsUsable(finding.source) &&
    finding.dashboardTarget?.reviewRequired !== true &&
    coverageStatusIsSourceBacked(finding.evidenceStatus),
  )
}

function coverageTargetSatisfied(
  state: FeasibilityIntelligenceState,
  target: CoverageTarget,
  text: string,
  scope: CoverageTextScope,
): boolean {
  if (target.metric) return competitorMetricCovered(state, target)
  if (scope === 'market') return marketTargetCovered(state, target)
  return target.aliases.some(alias => coverageTextHasAlias(text, alias))
}

function competitorMetricCoverageTargetsForState(state: FeasibilityIntelligenceState): CoverageTarget[] {
  const companyTargets = new Map<string, CoverageTarget>()
  for (const item of COMPETITOR_COMPANY_TARGETS) {
    companyTargets.set(item.label, item)
  }
  for (const record of state.competitors) {
    const companyName = record.companyName?.trim()
    if (!companyName) continue
    const normalized = normalizeCoverageAlias(companyName)
    if (!normalized) continue
    if (!companyTargets.has(companyName)) {
      companyTargets.set(companyName, target(companyName, normalized, ...normalized.split(' ').filter(Boolean)))
    }
  }

  return [...companyTargets.values()].flatMap(company =>
    COMPETITOR_METRIC_REQUIREMENTS.map(metric => ({
      label: `${company.label} - ${metric.label}`,
      aliases: metric.aliases.map(normalizeCoverageAlias),
      metric: metric.field,
      companyAliases: company.aliases,
    })),
  )
}

export function coverageTextForScope(
  state: FeasibilityIntelligenceState,
  scope: CoverageTextScope,
): string {
  const marketParts = [
    ...state.marketClaims.map(item => `${item.label} ${item.value} ${item.evidenceStatus} ${item.source?.title || ''}`),
    ...state.dataRoomSources
      .filter(item => item.area === 'market' || item.dashboardGroup === 'rawMaterialSignals')
      .map(item => `${item.checklistLabel} ${item.proposedValue || ''} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.area === 'market' || item.dashboardTarget?.group === 'marketClaims')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.proposedDashboardField || ''}`),
  ]
  const competitorParts = [
    ...state.competitors.map(item => `${item.companyName} ${item.countryRegion} ${item.productEquivalent} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.dashboardTarget?.group === 'competitorRecords')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.companyName || ''} ${item.dashboardTarget?.productEquivalent || ''}`),
  ]
  const supplierParts = [
    ...state.dataRoomSources
      .filter(item => item.area === 'factory' || item.dashboardGroup === 'supplierScorecards' || item.dashboardGroup === 'rawMaterialSignals')
      .map(item => `${item.checklistLabel} ${item.supplier || ''} ${item.material || ''} ${item.proposedValue || ''} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.dashboardTarget?.group === 'supplierScorecards' || item.dashboardTarget?.group === 'rawMaterialSignals')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.supplier || ''} ${item.dashboardTarget?.material || ''}`),
  ]
  const regulatoryParts = [
    ...state.dataRoomSources
      .filter(item => item.area === 'regulatory' || item.dashboardGroup === 'regulatoryFindings')
      .map(item => `${item.checklistLabel} ${item.proposedValue || ''} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.area === 'regulatory' || item.dashboardTarget?.group === 'regulatoryFindings')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.proposedDashboardField || ''}`),
  ]
  const financialParts = [
    ...state.financialModels.map(item => `${item.scenarioName} ${item.projectName} IRR NPV payback ROI capex working capital ${item.warnings.join(' ')}`),
    ...state.dataRoomSources
      .filter(item => item.area === 'financial' || item.dashboardGroup === 'financialEvidence')
      .map(item => `${item.checklistLabel} ${item.proposedValue || ''} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.area === 'financial' || item.dashboardTarget?.group === 'financialEvidence')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.proposedDashboardField || ''}`),
  ]
  const investorParts = [
    ...state.presentationMaterials.map(item => `${item.section} ${item.content} ${item.evidenceStatus}`),
    ...state.researchFindings
      .filter(item => item.area === 'presentation' || item.dashboardTarget?.group === 'investorMaterialCandidates')
      .map(item => `${item.keyClaim} ${item.summary} ${item.suggestedInvestorMaterial || ''}`),
    ...state.dataRoomSources.map(item => `${item.checklistLabel} ${item.area} ${item.evidenceStatus}`),
  ]

  const byScope: Record<CoverageTextScope, string[]> = {
    market: marketParts,
    competitor: competitorParts,
    supplier: supplierParts,
    regulatory: regulatoryParts,
    financial: financialParts,
    investor: investorParts,
  }
  return normalizeCoverageAlias(byScope[scope].join(' '))
}

export function buildDashboardCoverageRows(
  state: FeasibilityIntelligenceState,
  requirements: CoverageRequirement[] = dashboardCoverageRequirements,
): CoverageRow[] {
  const rows = requirements.map(row => {
    const text = coverageTextForScope(state, row.textScope)
    const missingTargets = row.targets.filter(item => !coverageTargetSatisfied(state, item, text, row.textScope))
    const coveredCount = row.targets.length - missingTargets.length
    const status: CoverageRow['status'] = missingTargets.length === 0 ? 'covered' : coveredCount > 0 ? 'partial' : 'missing'
    return {
      ...row,
      coveredCount,
      totalTargets: row.targets.length,
      missingTargets,
      status,
    }
  })

  const competitorMetricTargets = competitorMetricCoverageTargetsForState(state)
  if (competitorMetricTargets.length) {
    const missingTargets = competitorMetricTargets.filter(item => !coverageTargetSatisfied(state, item, '', 'competitor'))
    rows.push({
      area: 'Competitor Metric Columns',
      fills: 'Source-backed competitor price, share, revenue, growth, traffic, rating, date, and confidence fields',
      review: 'Critical competitor metrics stay staged until a usable source is attached or the user approves them',
      textScope: 'competitor',
      targets: competitorMetricTargets,
      totalTargets: competitorMetricTargets.length,
      coveredCount: competitorMetricTargets.length - missingTargets.length,
      missingTargets,
      status: missingTargets.length === 0
        ? 'covered'
        : missingTargets.length < competitorMetricTargets.length ? 'partial' : 'missing',
    })
  }

  return rows
}

export function missingDashboardCoverageTargetCount(rows: CoverageRow[]): number {
  return rows.reduce((sum, row) => sum + row.missingTargets.length, 0)
}
