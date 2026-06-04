import type { IntelligenceEvidenceStatus, SourceReference } from '@/utils/investorIntelligence'
import type {
  AutopilotScreen,
  TrustedSourceDataType,
  TrustedSourceRecord,
} from '@/utils/trustedSources'

export type DashboardAutopilotSourceTier =
  | 'tier1-official'
  | 'tier2-company-official'
  | 'tier3-supplier-evidence'
  | 'tier4-market-reference'
  | 'tier5-public-listing'
  | 'candidate-source'

export type DashboardAutopilotAction = 'auto-fill' | 'stage-review'

export interface DashboardAutopilotClaimInput {
  screen: AutopilotScreen
  field: string
  value: string
  source: SourceReference
  sourceId?: string
  fetchedAt?: string
  evidenceStatus: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  reviewRequired?: boolean
  dataType: TrustedSourceDataType
  sensitive?: boolean
  hasConflict?: boolean
  largeChange?: boolean
  investorApprovedImpact?: boolean
  overwritesUserApprovedAssumption?: boolean
}

export interface DashboardUpdateCandidate {
  fieldKey: string
  screen: AutopilotScreen
  field: string
  value: string
  sourceTitle: string
  sourceUrl?: string
  sourceTier: DashboardAutopilotSourceTier
  sourceTierLabel: string
  lastChecked: string
  confidence: 'low' | 'medium' | 'high'
  evidenceStatus: IntelligenceEvidenceStatus
  reviewRequired: boolean
  riskReason: string
  action: DashboardAutopilotAction
  dataType: TrustedSourceDataType
  sensitive: boolean
}

export type DashboardResearchUpdateGroup =
  | 'marketClaims'
  | 'competitorRecords'
  | 'rawMaterialSignals'
  | 'supplierScorecards'
  | 'regulatoryFindings'
  | 'financialEvidence'
  | 'evidenceGaps'
  | 'suggestedTasks'
  | 'investorMaterialCandidates'

export interface DashboardResearchUpdateItem {
  fieldKey?: string
  screen?: AutopilotScreen
  field?: string
  label?: string
  title?: string
  value?: unknown
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
  material?: string
  supplier?: string
  section?: string
  content?: string
  sourceTitle?: string
  sourceName?: string
  sourceUrl?: string
  sourceDate?: string
  sourceTier?: string
  lastChecked?: string
  confidence?: string
  evidenceStatus?: string
  reviewRequired?: boolean
  riskReason?: string
  dataType?: string
  sensitive?: boolean
  notes?: string
  recommendedAction?: string
  proposedDashboardField?: string
}

export type DashboardResearchUpdatesPayload = Partial<Record<DashboardResearchUpdateGroup, DashboardResearchUpdateItem[]>>

const DASHBOARD_UPDATE_GROUPS: DashboardResearchUpdateGroup[] = [
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

const VALID_EVIDENCE_STATUSES: IntelligenceEvidenceStatus[] = [
  'Missing',
  'To Verify',
  'Assumption',
  'Powerful Assumption',
  'Source-backed',
  'Official Data',
  'Trusted Source Auto-Updated',
  'Supplier Evidence',
  'Market Reference',
  'Trade Proxy',
  'Candidate Source',
  'Conflict Detected',
  'Derived from Assumptions',
  'Hypothesis',
  'Reference Only',
  'User Provided',
  'User Approved',
  'Investor Approved',
  'Approved Assumption',
  'Verified',
]

const VALID_DATA_TYPES: TrustedSourceDataType[] = [
  'trade_data',
  'market_size',
  'price_data',
  'competitor_data',
  'company_data',
  'regulatory_data',
  'financial_data',
  'supplier_quote',
  'document_evidence',
  'internal_activity',
]

const TRUSTED_AUTO_STATUSES: IntelligenceEvidenceStatus[] = [
  'Trusted Source Auto-Updated',
  'Official Data',
  'Source-backed',
  'Supplier Evidence',
]

const PLACEHOLDER_PATTERN = /to verify|missing|research required|api-ready|reference only|trade proxy/i
const CRITICAL_FIELD_PATTERN = /market size|growth|cagr|market share|share chart|price|cost|supplier|score|payment|quality|reliability|irr|npv|payback|profitability|roi|investment|revenue target|asp|regulatory|dms|cas|formula|investor/i
const SENSITIVE_DATA_TYPES: TrustedSourceDataType[] = ['price_data', 'financial_data', 'supplier_quote', 'regulatory_data']
const SCREENSHOT_FAKE_VALUES = ['$3.2B', '$120M', '$16M', '$49.8M', '60%', '7.2%', '38%', '$34/kg', '$24/kg', '20-25%']

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function dashboardFieldKey(screen: AutopilotScreen, field: string): string {
  return `${screen}.${slug(field)}`
}

export function dashboardSourceTier(source?: TrustedSourceRecord | null): DashboardAutopilotSourceTier {
  if (!source) return 'candidate-source'
  if (source.tier === 'tier1-official') return 'tier1-official'
  if (source.tier === 'tier3-supplier-evidence' || source.connector_type === 'supplier_quote' || source.connector_type === 'manual_upload') return 'tier3-supplier-evidence'
  if (source.tier === 'tier4-public-listing') return 'tier5-public-listing'
  if (source.tier === 'candidate-source') return 'candidate-source'
  if (
    source.category === 'competitor' ||
    source.category === 'supplier' ||
    source.category === 'chemical' ||
    source.name.toLowerCase().includes('official')
  ) {
    return 'tier2-company-official'
  }
  return 'tier4-market-reference'
}

export function dashboardSourceTierLabel(tier: DashboardAutopilotSourceTier): string {
  if (tier === 'tier1-official') return 'Tier 1 - Official / regulator / trade source'
  if (tier === 'tier2-company-official') return 'Tier 2 - Official company / product source'
  if (tier === 'tier3-supplier-evidence') return 'Tier 3 - Uploaded supplier evidence'
  if (tier === 'tier4-market-reference') return 'Tier 4 - Paid / reputable market reference'
  if (tier === 'tier5-public-listing') return 'Tier 5 - Public listing / weak reference'
  return 'Candidate Source - To Verify'
}

function dashboardSourceRank(source?: TrustedSourceRecord | null): number {
  const tier = dashboardSourceTier(source)
  if (tier === 'tier1-official') return 1
  if (tier === 'tier2-company-official') return 2
  if (tier === 'tier3-supplier-evidence') return 3
  if (tier === 'tier4-market-reference') return 4
  if (tier === 'tier5-public-listing') return 5
  return 6
}

export function sortSourcesByDashboardPolicy(
  sources: TrustedSourceRecord[],
  preferredDataTypes: TrustedSourceDataType[] = [],
  fallbackDataTypes: TrustedSourceDataType[] = [],
): TrustedSourceRecord[] {
  return [...sources].sort((a, b) => {
    const aPreferred = preferredDataTypes.some(type => a.data_types_supported.includes(type)) ? 0 : 1
    const bPreferred = preferredDataTypes.some(type => b.data_types_supported.includes(type)) ? 0 : 1
    if (aPreferred !== bPreferred) return aPreferred - bPreferred
    const aFallback = fallbackDataTypes.some(type => a.data_types_supported.includes(type)) ? 0 : 1
    const bFallback = fallbackDataTypes.some(type => b.data_types_supported.includes(type)) ? 0 : 1
    if (aFallback !== bFallback) return aFallback - bFallback
    const tierCompare = dashboardSourceRank(a) - dashboardSourceRank(b)
    if (tierCompare !== 0) return tierCompare
    if (a.auto_update_allowed !== b.auto_update_allowed) return a.auto_update_allowed ? -1 : 1
    if (a.requires_review !== b.requires_review) return a.requires_review ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

export function isCriticalDashboardClaim(input: Pick<DashboardAutopilotClaimInput, 'field' | 'dataType' | 'sensitive'>): boolean {
  return !!input.sensitive ||
    SENSITIVE_DATA_TYPES.includes(input.dataType) ||
    CRITICAL_FIELD_PATTERN.test(input.field)
}

function hasUsableSource(source: SourceReference): boolean {
  return Boolean(source.title?.trim() && (source.url?.trim() || source.date?.trim()))
}

function hasKnownFakeScreenshotValue(value: string): boolean {
  return SCREENSHOT_FAKE_VALUES.some(fakeValue => value.includes(fakeValue))
}

function riskReason(input: DashboardAutopilotClaimInput, tier: DashboardAutopilotSourceTier): string {
  const reasons: string[] = []
  if (!hasUsableSource(input.source)) reasons.push('source title plus URL/date is missing')
  if (input.reviewRequired) reasons.push('source or connector requires review')
  if (input.hasConflict) reasons.push('conflicts with an existing dashboard value')
  if (input.largeChange) reasons.push('large value movement detected')
  if (input.investorApprovedImpact) reasons.push('could affect investor-approved material')
  if (input.overwritesUserApprovedAssumption) reasons.push('could overwrite a user-approved assumption')
  if (input.sensitive || SENSITIVE_DATA_TYPES.includes(input.dataType)) reasons.push('sensitive price/cost/financial/regulatory data')
  if (CRITICAL_FIELD_PATTERN.test(input.field)) reasons.push('critical dashboard claim')
  if (PLACEHOLDER_PATTERN.test(input.value)) reasons.push('value is still Missing / To Verify / proxy')
  if (hasKnownFakeScreenshotValue(input.value)) reasons.push('matches old screenshot/template number and must be source-checked')
  if (tier === 'tier4-market-reference') reasons.push('market-reference sources need context review')
  if (tier === 'tier5-public-listing') reasons.push('public listings are weak references only')
  if (tier === 'candidate-source') reasons.push('candidate source is not trusted yet')
  return reasons.length ? reasons.join('; ') : 'low-risk source-backed field'
}

export function buildDashboardUpdateCandidate(
  input: DashboardAutopilotClaimInput,
  sourceRecord?: TrustedSourceRecord | null,
): DashboardUpdateCandidate {
  const sourceTier = dashboardSourceTier(sourceRecord)
  const critical = isCriticalDashboardClaim(input)
  const reason = riskReason(input, sourceTier)
  const hasTrustedStatus = TRUSTED_AUTO_STATUSES.includes(input.evidenceStatus)
  const trustedTier = sourceTier === 'tier1-official' || sourceTier === 'tier2-company-official' || sourceTier === 'tier3-supplier-evidence'
  const reviewRequired = Boolean(
    input.reviewRequired ||
    critical ||
    !hasUsableSource(input.source) ||
    !hasTrustedStatus ||
    !trustedTier ||
    PLACEHOLDER_PATTERN.test(input.value) ||
    input.hasConflict ||
    input.largeChange ||
    input.investorApprovedImpact ||
    input.overwritesUserApprovedAssumption ||
    hasKnownFakeScreenshotValue(input.value),
  )

  return {
    fieldKey: dashboardFieldKey(input.screen, input.field),
    screen: input.screen,
    field: input.field,
    value: input.value,
    sourceTitle: input.source.title,
    sourceUrl: input.source.url,
    sourceTier,
    sourceTierLabel: dashboardSourceTierLabel(sourceTier),
    lastChecked: input.fetchedAt || new Date().toISOString(),
    confidence: input.confidence,
    evidenceStatus: input.evidenceStatus,
    reviewRequired,
    riskReason: reviewRequired ? reason : 'low-risk source-backed field',
    action: reviewRequired ? 'stage-review' : 'auto-fill',
    dataType: input.dataType,
    sensitive: !!input.sensitive || SENSITIVE_DATA_TYPES.includes(input.dataType),
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return isPlainRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractBalancedObjectAfter(text: string, index: number): string | null {
  const start = text.indexOf('{', index)
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return text.slice(start, i + 1)
  }
  return null
}

function normalizeDashboardPayload(raw: Record<string, unknown>): DashboardResearchUpdatesPayload | null {
  const container = isPlainRecord(raw.dashboard_updates) ? raw.dashboard_updates : raw
  const payload: DashboardResearchUpdatesPayload = {}

  for (const group of DASHBOARD_UPDATE_GROUPS) {
    const value = container[group]
    if (!Array.isArray(value)) continue
    payload[group] = value.filter(isPlainRecord).map(item => ({ ...item })) as DashboardResearchUpdateItem[]
  }

  return DASHBOARD_UPDATE_GROUPS.some(group => (payload[group]?.length || 0) > 0) ? payload : null
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim()
  const withoutOuter = trimmed.startsWith('|') && trimmed.endsWith('|')
    ? trimmed.slice(1, -1)
    : trimmed
  return withoutOuter.split('|').map(cell => cell.trim())
}

function isMarkdownSeparator(line: string): boolean {
  const cells = parseMarkdownTableRow(line)
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
}

function getCell(row: Record<string, string>, ...headers: string[]): string {
  for (const header of headers) {
    const value = row[normalizeHeader(header)]
    if (value) return value
  }
  return ''
}

function parseMarkdownLink(value: string): { title: string, url: string } | null {
  const match = value.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/i)
  if (!match) return null
  return {
    title: match[1].trim(),
    url: match[2].trim(),
  }
}

function inferGroupFromMarkdownTable(headers: string[], context: string): DashboardResearchUpdateGroup {
  const text = `${headers.join(' ')} ${context}`.toLowerCase()
  if (/supplier|scorecard|raw material|material|quote|payment|quality|reliability/.test(text)) return 'supplierScorecards'
  if (/competitor|manufacturer|company|market share|strength|weakness|product equivalent/.test(text)) return 'competitorRecords'
  if (/investment|financial|irr|npv|payback|roi|capex|working capital|profitability/.test(text)) return 'financialEvidence'
  if (/regulatory|dms|cas|permit|sds|tds|iecs|echa|pubchem/.test(text)) return 'regulatoryFindings'
  if (/investor|presentation|slide|deck|brief/.test(text)) return 'investorMaterialCandidates'
  if (/evidence gap|missing proof|gap/.test(text)) return 'evidenceGaps'
  if (/task|action|next step/.test(text)) return 'suggestedTasks'
  return 'marketClaims'
}

function sectionContextForLine(lines: string[], index: number): string {
  for (let i = index - 1; i >= Math.max(0, index - 12); i -= 1) {
    const line = lines[i]
    if (/^\s{0,3}#{1,6}\s+/.test(line)) return line
  }
  return lines.slice(Math.max(0, index - 4), index).join('\n')
}

function markdownSourceFields(row: Record<string, string>): Pick<DashboardResearchUpdateItem, 'sourceTitle' | 'sourceUrl' | 'sourceDate'> {
  const explicitTitle = getCell(row, 'source title', 'source name', 'source')
  const explicitUrl = getCell(row, 'source url', 'url', 'link')
  const sourceDate = getCell(row, 'source date', 'date', 'last checked', 'checked')
  const markdownLink = parseMarkdownLink(explicitTitle)
  const sourceTitle = markdownLink?.title || (explicitTitle && /^https?:\/\//i.test(explicitTitle) ? 'Source link' : explicitTitle)
  const sourceUrl = explicitUrl || markdownLink?.url || (/^https?:\/\//i.test(explicitTitle) ? explicitTitle : '')
  return { sourceTitle, sourceUrl, sourceDate }
}

function markdownRowToDashboardItem(
  row: Record<string, string>,
  group: DashboardResearchUpdateGroup,
): DashboardResearchUpdateItem | null {
  const source = markdownSourceFields(row)
  if (!source.sourceTitle && !source.sourceUrl && !source.sourceDate) return null

  const field = getCell(row, 'field', 'metric', 'kpi', 'claim', 'indicator', 'segment', 'category', 'section', 'item')
  const title = getCell(row, 'title', 'question', 'finding')
  const label = getCell(row, 'label')
  const value = getCell(row, 'value', 'amount', 'size', 'growth', 'rate', 'status', 'target', 'scope', 'score')
  const notes = getCell(row, 'notes', 'note', 'strength', 'weakness', 'summary')
  const marketShare = getCell(row, 'market share', 'share')
  const pricingEvidence = getCell(row, 'pricing evidence', 'price', 'price/kg', 'price/t', 'cost')
  const fallbackValue = value || marketShare || pricingEvidence || notes
  const rowTitle = title || label || field || getCell(row, 'company', 'competitor', 'manufacturer', 'supplier', 'material')
  if (!rowTitle && !fallbackValue) return null

  const item: DashboardResearchUpdateItem = {
    field: field || rowTitle,
    label: label || rowTitle,
    title: title || rowTitle,
    value: fallbackValue,
    companyName: getCell(row, 'company', 'competitor', 'manufacturer'),
    countryRegion: getCell(row, 'country', 'region', 'hq', 'country/region'),
    productEquivalent: getCell(row, 'product equivalent', 'product', 'equivalent'),
    activeContent: getCell(row, 'active content', 'active', 'content'),
    pricingEvidence,
    certifications: getCell(row, 'certifications', 'certification'),
    distributionPresence: getCell(row, 'distribution', 'distribution presence', 'presence'),
    marketShare,
    supplier: getCell(row, 'supplier'),
    material: getCell(row, 'material', 'raw material'),
    section: getCell(row, 'section'),
    content: getCell(row, 'content', 'snippet', 'report snippet'),
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceDate: source.sourceDate,
    sourceTier: getCell(row, 'source tier', 'tier'),
    lastChecked: getCell(row, 'last checked', 'checked'),
    confidence: getCell(row, 'confidence'),
    evidenceStatus: getCell(row, 'evidence status', 'status'),
    reviewRequired: /^(yes|true|required|review)$/i.test(getCell(row, 'review required', 'review')),
    riskReason: getCell(row, 'risk reason', 'risk'),
    dataType: getCell(row, 'data type', 'datatype'),
    sensitive: /^(yes|true|sensitive)$/i.test(getCell(row, 'sensitive')),
    notes,
    recommendedAction: getCell(row, 'recommended action', 'next action', 'action'),
    proposedDashboardField: getCell(row, 'proposed dashboard field', 'dashboard field', 'target field'),
  }

  if (group === 'competitorRecords' && !item.companyName) item.companyName = rowTitle
  if (group === 'supplierScorecards' && !item.value) item.value = pricingEvidence || notes || 'To Verify'
  return item
}

function extractMarkdownDashboardTables(content: string): DashboardResearchUpdatesPayload | null {
  const lines = content.split(/\r?\n/)
  const payload: DashboardResearchUpdatesPayload = {}

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes('|') || !isMarkdownSeparator(lines[i + 1])) continue
    const headers = parseMarkdownTableRow(lines[i])
    const normalizedHeaders = headers.map(normalizeHeader)
    const hasFieldishColumn = normalizedHeaders.some(header =>
      ['field', 'metric', 'kpi', 'claim', 'indicator', 'segment', 'category', 'section', 'item', 'company', 'competitor', 'manufacturer', 'supplier', 'material'].includes(header),
    )
    const hasValueishColumn = normalizedHeaders.some(header =>
      ['value', 'amount', 'size', 'growth', 'rate', 'status', 'target', 'scope', 'score', 'marketshare', 'share', 'pricingevidence', 'price', 'cost', 'notes', 'summary'].includes(header),
    )
    const hasSourceColumn = normalizedHeaders.some(header =>
      ['sourcetitle', 'sourcename', 'source', 'sourceurl', 'url', 'link', 'sourcedate', 'date', 'lastchecked', 'checked'].includes(header),
    )
    if (!hasFieldishColumn || !hasValueishColumn || !hasSourceColumn) continue

    const context = sectionContextForLine(lines, i)
    const group = inferGroupFromMarkdownTable(headers, context)
    const items: DashboardResearchUpdateItem[] = []
    let rowIndex = i + 2
    for (; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex]
      if (!line.includes('|') || isMarkdownSeparator(line)) break
      const cells = parseMarkdownTableRow(line)
      if (cells.length < 2) break
      const row: Record<string, string> = {}
      headers.forEach((header, index) => {
        row[normalizeHeader(header)] = cells[index] || ''
      })
      const item = markdownRowToDashboardItem(row, group)
      if (item) items.push(item)
    }
    if (items.length) payload[group] = [...(payload[group] || []), ...items]
    i = Math.max(i, rowIndex - 1)
  }

  return DASHBOARD_UPDATE_GROUPS.some(group => (payload[group]?.length || 0) > 0) ? payload : null
}

function parseDelimitedBulletRow(line: string): Record<string, string> | null {
  const cleaned = line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
  if (!cleaned.includes('|') || !/source/i.test(cleaned)) return null

  const row: Record<string, string> = {}
  for (const segment of cleaned.split('|')) {
    const match = segment.match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/)
    if (!match) continue
    const key = normalizeHeader(match[1])
    const value = match[2].trim()
    if (key && value) row[key] = value
  }

  const hasFieldish = Boolean(getCell(row, 'field', 'metric', 'kpi', 'claim', 'indicator', 'segment', 'category', 'section', 'item', 'company', 'competitor', 'manufacturer', 'supplier', 'material'))
  const hasValueish = Boolean(getCell(row, 'value', 'amount', 'size', 'growth', 'rate', 'status', 'target', 'scope', 'score', 'market share', 'share', 'pricing evidence', 'price', 'cost', 'notes', 'summary'))
  const sourceFields = markdownSourceFields(row)
  const hasSource = Boolean(sourceFields.sourceTitle || sourceFields.sourceUrl || sourceFields.sourceDate)

  return hasFieldish && hasValueish && hasSource ? row : null
}

function extractDelimitedDashboardBullets(content: string): DashboardResearchUpdatesPayload | null {
  const lines = content.split(/\r?\n/)
  const payload: DashboardResearchUpdatesPayload = {}

  lines.forEach((line, index) => {
    if (!/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) return
    const row = parseDelimitedBulletRow(line)
    if (!row) return
    const context = sectionContextForLine(lines, index)
    const group = inferGroupFromMarkdownTable(Object.keys(row), context)
    const item = markdownRowToDashboardItem(row, group)
    if (!item) return
    payload[group] = [...(payload[group] || []), item]
  })

  return DASHBOARD_UPDATE_GROUPS.some(group => (payload[group]?.length || 0) > 0) ? payload : null
}

export function extractDashboardResearchUpdates(content: string): DashboardResearchUpdatesPayload | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  const direct = tryParseJsonObject(trimmed)
  const directPayload = direct ? normalizeDashboardPayload(direct) : null
  if (directPayload) return directPayload

  const fencedBlocks = [...trimmed.matchAll(/```(?:json|dashboard_updates)?\s*([\s\S]*?)```/gi)]
  for (const block of fencedBlocks) {
    const parsed = tryParseJsonObject(block[1].trim())
    const payload = parsed ? normalizeDashboardPayload(parsed) : null
    if (payload) return payload
  }

  const marker = trimmed.search(/["']?dashboard_updates["']?\s*[:=]/i)
  if (marker !== -1) {
    const json = extractBalancedObjectAfter(trimmed, marker)
    const parsed = json ? tryParseJsonObject(json) : null
    const payload = parsed ? normalizeDashboardPayload(parsed) : null
    if (payload) return payload
  }

  return extractMarkdownDashboardTables(trimmed) || extractDelimitedDashboardBullets(trimmed)
}

export function coerceDashboardEvidenceStatus(value: unknown, fallback: IntelligenceEvidenceStatus = 'To Verify'): IntelligenceEvidenceStatus {
  return VALID_EVIDENCE_STATUSES.includes(value as IntelligenceEvidenceStatus)
    ? value as IntelligenceEvidenceStatus
    : fallback
}

export function coerceDashboardConfidence(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

export function coerceDashboardDataType(value: unknown, fallback: TrustedSourceDataType): TrustedSourceDataType {
  return VALID_DATA_TYPES.includes(value as TrustedSourceDataType) ? value as TrustedSourceDataType : fallback
}
