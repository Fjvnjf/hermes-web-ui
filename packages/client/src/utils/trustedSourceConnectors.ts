import {
  evidenceStatusForTier,
  type AutopilotScreen,
  type TrustedSourceConnectorType,
  type TrustedSourceDataType,
  type TrustedSourceRecord,
} from '@/utils/trustedSources'
import { sortSourcesByDashboardPolicy } from '@/utils/dashboardAutopilotPolicy'
import type { IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'

export interface NormalizedTrustedSourceClaim {
  claim_id: string
  screen: AutopilotScreen
  field: string
  value: string
  unit?: string
  source_id: string
  source_name: string
  source_url?: string
  source_date?: string
  fetched_at: string
  evidence_status: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  method: 'internal' | 'API' | 'source research' | 'supplier quote' | 'manual' | 'fallback'
  notes: string
  review_required: boolean
  data_type: TrustedSourceDataType
  sensitive?: boolean
}

export interface TrustedSourceConnector {
  id: string
  sourceId: string
  type: TrustedSourceConnectorType
  fetch: (request: TrustedSourceConnectorRequest) => Promise<unknown>
  parse: (raw: unknown, request: TrustedSourceConnectorRequest) => Promise<Partial<NormalizedTrustedSourceClaim>[]>
  normalize: (parsed: Partial<NormalizedTrustedSourceClaim>[], request: TrustedSourceConnectorRequest) => NormalizedTrustedSourceClaim[]
  validate: (claims: NormalizedTrustedSourceClaim[]) => NormalizedTrustedSourceClaim[]
  classify_evidence: (claim: NormalizedTrustedSourceClaim) => IntelligenceEvidenceStatus
  map_to_dashboard_fields: (claims: NormalizedTrustedSourceClaim[]) => NormalizedTrustedSourceClaim[]
  log_result: (claims: NormalizedTrustedSourceClaim[]) => TrustedSourceConnectorLog
}

export interface TrustedSourceConnectorRequest {
  screen: AutopilotScreen
  field: string
  source: TrustedSourceRecord
  query?: string
  fetchImpl?: typeof fetch
  now?: string
}

export interface TrustedSourceConnectorLog {
  connector_id: string
  source_id: string
  fetched_at: string
  claim_count: number
  review_required: boolean
  notes: string
}

export const SCREEN_FIELD_MAPPINGS: Record<AutopilotScreen, Array<{
  field: string
  preferredDataTypes: TrustedSourceDataType[]
  fallbackDataTypes: TrustedSourceDataType[]
  unavailableStatus: IntelligenceEvidenceStatus
  autoUpdateAllowed: boolean
  sensitive?: boolean
}>> = {
  executive: [
    { field: 'Revenue Target', preferredDataTypes: ['financial_data', 'internal_activity'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true, sensitive: true },
    { field: 'EQ Capacity MT/YR', preferredDataTypes: ['financial_data', 'internal_activity'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Projected IRR', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['internal_activity'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Payback Period', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['internal_activity'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Blended ASP/MT', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['supplier_quote'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'NPV @ 12%', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['internal_activity'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Hermes Daily Brief', preferredDataTypes: ['internal_activity'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Reference Only', autoUpdateAllowed: true },
    { field: 'Today’s Priorities', preferredDataTypes: ['internal_activity'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Top Risk', preferredDataTypes: ['internal_activity'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
  ],
  market: [
    { field: 'Market Size / Scope', preferredDataTypes: ['trade_data', 'market_size'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Trade Proxy', autoUpdateAllowed: true },
    { field: 'Growth Rate', preferredDataTypes: ['market_size', 'company_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Import Dependence', preferredDataTypes: ['trade_data'], fallbackDataTypes: ['market_size'], unavailableStatus: 'Trade Proxy', autoUpdateAllowed: true },
    { field: 'Our Target', preferredDataTypes: ['internal_activity', 'financial_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Opportunity Score', preferredDataTypes: ['market_size', 'trade_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false },
    { field: 'Market Segmentation', preferredDataTypes: ['market_size'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Target Countries / Provinces', preferredDataTypes: ['trade_data', 'company_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
  ],
  investment: [
    { field: 'Total Investment', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Derived from Assumptions', autoUpdateAllowed: false, sensitive: true },
    { field: 'Project IRR', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Derived from Assumptions', autoUpdateAllowed: false, sensitive: true },
    { field: 'NPV @ 12%', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Derived from Assumptions', autoUpdateAllowed: false, sensitive: true },
    { field: 'Payback Period', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Derived from Assumptions', autoUpdateAllowed: false, sensitive: true },
    { field: 'Profitability Index', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Derived from Assumptions', autoUpdateAllowed: false, sensitive: true },
    { field: '5-Year ROI', preferredDataTypes: ['financial_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Derived from Assumptions', autoUpdateAllowed: false, sensitive: true },
    { field: 'Investment Breakdown', preferredDataTypes: ['financial_data', 'supplier_quote'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
  ],
  competitor: [
    { field: 'Competitors Profiled', preferredDataTypes: ['competitor_data', 'company_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'EU Average Price', preferredDataTypes: ['price_data'], fallbackDataTypes: ['supplier_quote'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Our Target Price', preferredDataTypes: ['financial_data', 'supplier_quote'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Price Edge', preferredDataTypes: ['price_data', 'financial_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Source Coverage / Confidence', preferredDataTypes: ['competitor_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Competitor Landscape Table', preferredDataTypes: ['competitor_data', 'company_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Market Share Chart', preferredDataTypes: ['competitor_data', 'market_size'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false },
  ],
  rawMaterials: [
    { field: 'Supplier Scorecards', preferredDataTypes: ['supplier_quote', 'document_evidence'], fallbackDataTypes: ['price_data'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Stearic Acid Source / Quote', preferredDataTypes: ['supplier_quote', 'price_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Triethanolamine / TEA Source', preferredDataTypes: ['supplier_quote', 'price_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Dimethyl Sulfate / DMS Source', preferredDataTypes: ['supplier_quote', 'regulatory_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'PDMS Silicone Oil Source', preferredDataTypes: ['supplier_quote', 'price_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'SDS / TDS / COA Evidence', preferredDataTypes: ['document_evidence', 'regulatory_data'], fallbackDataTypes: ['supplier_quote'], unavailableStatus: 'To Verify', autoUpdateAllowed: false },
  ],
  exportMarkets: [
    { field: 'Country-wise Consumption Growth', preferredDataTypes: ['trade_data', 'market_size'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Trade Proxy', autoUpdateAllowed: true },
    { field: 'HS Code Candidates', preferredDataTypes: ['trade_data', 'regulatory_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Trade Proxy', autoUpdateAllowed: true },
    { field: 'Import / Export Signals', preferredDataTypes: ['trade_data'], fallbackDataTypes: ['market_size'], unavailableStatus: 'Trade Proxy', autoUpdateAllowed: true },
    { field: 'Target Countries', preferredDataTypes: ['trade_data', 'market_size'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Export Evidence Gaps', preferredDataTypes: ['document_evidence'], fallbackDataTypes: ['trade_data'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
  ],
  regulatory: [
    { field: 'DMS Regulatory Status', preferredDataTypes: ['regulatory_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'China Import / Storage / Use Requirements', preferredDataTypes: ['regulatory_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'Factory Chemical Approval Requirements', preferredDataTypes: ['regulatory_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false, sensitive: true },
    { field: 'IECSC / China Inventory References', preferredDataTypes: ['regulatory_data'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'To Verify', autoUpdateAllowed: false },
    { field: 'SDS / CAS Evidence Coverage', preferredDataTypes: ['regulatory_data', 'document_evidence'], fallbackDataTypes: ['supplier_quote'], unavailableStatus: 'To Verify', autoUpdateAllowed: false },
  ],
  investorReadiness: [
    { field: 'Verified Facts Coverage', preferredDataTypes: ['document_evidence', 'internal_activity'], fallbackDataTypes: ['market_size'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Evidence Gaps', preferredDataTypes: ['document_evidence', 'internal_activity'], fallbackDataTypes: ['market_size'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Risk Register', preferredDataTypes: ['document_evidence', 'internal_activity'], fallbackDataTypes: ['regulatory_data'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Data Room Checklist', preferredDataTypes: ['document_evidence', 'internal_activity'], fallbackDataTypes: ['supplier_quote'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Financial Model Status', preferredDataTypes: ['financial_data', 'internal_activity'], fallbackDataTypes: ['document_evidence'], unavailableStatus: 'Derived from Assumptions', autoUpdateAllowed: false, sensitive: true },
  ],
  presentation: [
    { field: 'Approved Investor Material', preferredDataTypes: ['document_evidence', 'internal_activity'], fallbackDataTypes: ['market_size'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Presentation Snippets', preferredDataTypes: ['document_evidence'], fallbackDataTypes: ['market_size'], unavailableStatus: 'To Verify', autoUpdateAllowed: false },
    { field: 'Unsupported Claims', preferredDataTypes: ['document_evidence', 'internal_activity'], fallbackDataTypes: ['market_size'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Missing Proof Tasks', preferredDataTypes: ['document_evidence', 'internal_activity'], fallbackDataTypes: ['market_size'], unavailableStatus: 'To Verify', autoUpdateAllowed: true },
    { field: 'Investor Export Readiness', preferredDataTypes: ['document_evidence', 'internal_activity'], fallbackDataTypes: ['financial_data'], unavailableStatus: 'To Verify', autoUpdateAllowed: false },
  ],
}

function nowIso(request?: TrustedSourceConnectorRequest): string {
  return request?.now || new Date().toISOString()
}

function methodForSource(source: TrustedSourceRecord): NormalizedTrustedSourceClaim['method'] {
  if (source.connector_type === 'API') return 'API'
  if (source.connector_type === 'supplier_quote') return 'supplier quote'
  if (source.connector_type === 'manual_upload') return 'manual'
  if (source.connector_type === 'research_job') return 'source research'
  return 'fallback'
}

function connectorId(source: TrustedSourceRecord): string {
  return `${source.connector_type.toLowerCase()}-${source.source_id}`
}

function baseConnector(source: TrustedSourceRecord): TrustedSourceConnector {
  return {
    id: connectorId(source),
    sourceId: source.source_id,
    type: source.connector_type,
    async fetch(request) {
      return {
        source: request.source.name,
        query: request.query || request.field,
        note: 'Connector skeleton created; use research job fallback if source blocks direct access.',
      }
    },
    async parse(raw, request) {
      return [{
        field: request.field,
        value: request.source.connector_type === 'API' ? 'API-ready / To Verify' : 'Research Required / To Verify',
        notes: typeof raw === 'object' && raw ? 'Source reachable by connector skeleton; no source-backed value extracted yet.' : 'No raw data returned.',
      }]
    },
    normalize(parsed, request) {
      return parsed.map(item => normalizeClaim({
        screen: request.screen,
        field: item.field || request.field,
        source_id: request.source.source_id,
        source_name: request.source.name,
        source_url: request.source.url,
        source_date: nowIso(request).slice(0, 10),
        fetched_at: nowIso(request),
        data_type: request.source.data_type,
        evidence_status: request.source.connector_type === 'API' && request.source.auto_update_allowed
          ? evidenceStatusForTier(request.source.tier)
          : request.source.tier === 'tier4-public-listing'
            ? 'Reference Only'
            : 'To Verify',
        confidence: request.source.confidence_default,
        method: methodForSource(request.source),
        review_required: request.source.requires_review || !request.source.auto_update_allowed,
        ...item,
      }, request.source))
    },
    validate(claims) {
      return claims.filter(claim => !!claim.field && !!claim.value && !!claim.source_id)
    },
    classify_evidence(claim) {
      return claim.evidence_status
    },
    map_to_dashboard_fields(claims) {
      return claims
    },
    log_result(claims) {
      return {
        connector_id: connectorId(source),
        source_id: source.source_id,
        fetched_at: new Date().toISOString(),
        claim_count: claims.length,
        review_required: claims.some(claim => claim.review_required),
        notes: claims.length ? 'Connector returned normalized claims.' : 'No claim extracted; fallback review required.',
      }
    },
  }
}

function normalizeClaim(input: Partial<NormalizedTrustedSourceClaim>, source: TrustedSourceRecord): NormalizedTrustedSourceClaim {
  const fetchedAt = input.fetched_at || new Date().toISOString()
  return {
    claim_id: input.claim_id || `${source.source_id}-${(input.field || 'claim').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
    screen: input.screen || source.allowed_for[0] || 'market',
    field: input.field || 'To Verify',
    value: input.value || 'To Verify',
    unit: input.unit,
    source_id: input.source_id || source.source_id,
    source_name: input.source_name || source.name,
    source_url: input.source_url || source.url,
    source_date: input.source_date || fetchedAt.slice(0, 10),
    fetched_at: fetchedAt,
    evidence_status: input.evidence_status || evidenceStatusForTier(source.tier),
    confidence: input.confidence || source.confidence_default,
    method: input.method || methodForSource(source),
    notes: input.notes || source.notes,
    review_required: input.review_required ?? source.requires_review,
    data_type: input.data_type || source.data_type,
    sensitive: input.sensitive,
  }
}

export function createConnectorForSource(source: TrustedSourceRecord): TrustedSourceConnector {
  if (source.source_id === 'world-bank-indicators-api') return worldBankApiConnector(source)
  if (source.source_id === 'un-comtrade' || source.source_id === 'un-comtrade-plus') return apiReadyConnector(source, 'UN Comtrade API requires exact HS code and API/rate-limit handling before exact consumption claims.')
  if (source.source_id === 'oecd-data-api') return apiReadyConnector(source, 'OECD connector is API-ready; dataset selection must be reviewed before dashboard values are trusted.')
  if (source.source_id.includes('sunsirs')) return referenceConnector(source, 'SunSirs reference connector does not scrape blocked pages; it creates source-backed research tasks or review claims.')
  if (source.source_id.includes('echemi')) return referenceConnector(source, 'ECHEMI reference connector does not scrape blocked pages; it creates source-backed research tasks or review claims.')
  if (source.category === 'competitor') return referenceConnector(source, 'Official competitor website connector skeleton. It requires cited product page/catalog extraction before market-share or pricing use.')
  if (source.connector_type === 'supplier_quote') return referenceConnector(source, 'Supplier quote connector expects uploaded quote, PI, invoice, SDS, or TDS evidence.')
  return baseConnector(source)
}

function apiReadyConnector(source: TrustedSourceRecord, note: string): TrustedSourceConnector {
  const connector = baseConnector(source)
  connector.parse = async (_raw, request) => [{
    field: request.field,
    value: request.field.includes('Import') || request.field.includes('Market Size') ? 'Trade Proxy / To Verify' : 'API-ready / To Verify',
    notes: note,
    evidence_status: request.field.includes('Import') || request.field.includes('Market Size') ? 'Trade Proxy' : 'To Verify',
    review_required: true,
  }]
  return connector
}

function referenceConnector(source: TrustedSourceRecord, note: string): TrustedSourceConnector {
  const connector = baseConnector(source)
  connector.parse = async (_raw, request) => [{
    field: request.field,
    value: 'Research Required / To Verify',
    notes: note,
    evidence_status: source.tier === 'tier4-public-listing' ? 'Reference Only' : 'To Verify',
    review_required: true,
  }]
  return connector
}

const WORLD_BANK_COUNTRY_NAMES: Record<string, string> = {
  CHN: 'China',
  BGD: 'Bangladesh',
  IND: 'India',
  VNM: 'Vietnam',
  IDN: 'Indonesia',
  PAK: 'Pakistan',
  TUR: 'Turkiye',
}

function worldBankIndicatorForField(field: string): {
  code: string
  label: string
  sourceUrl: string
  proxyNote: string
} {
  if (/country-wise|consumption/i.test(field)) {
    return {
      code: 'NE.CON.PRVT.KD.ZG',
      label: 'Households and NPISHs final consumption expenditure (annual % growth)',
      sourceUrl: 'https://data.worldbank.org/indicator/NE.CON.PRVT.KD.ZG',
      proxyNote: 'Official household consumption growth macro proxy. It is not product-specific textile softener demand.',
    }
  }
  if (/manufacturing|industry|industrial/i.test(field)) {
    return {
      code: 'NV.IND.MANF.KD.ZG',
      label: 'Manufacturing, value added (annual % growth)',
      sourceUrl: 'https://data.worldbank.org/indicator/NV.IND.MANF.KD.ZG',
      proxyNote: 'Official manufacturing growth macro proxy. It is not product-specific textile chemical demand.',
    }
  }
  return {
    code: 'NY.GDP.MKTP.KD.ZG',
    label: 'GDP growth (annual %)',
    sourceUrl: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG',
    proxyNote: 'Official macro growth reference. Map to product demand only after review.',
  }
}

function worldBankCountriesForField(field: string): string[] {
  if (/country-wise|target countries|export|consumption/i.test(field)) {
    return ['CHN', 'BGD', 'IND', 'VNM', 'IDN', 'PAK', 'TUR']
  }
  return ['CHN']
}

function worldBankRows(raw: unknown): Array<{
  countryiso3code?: string
  country?: { id?: string; value?: string }
  date?: string | number
  value?: number | null
}> {
  if (Array.isArray(raw) && Array.isArray(raw[1])) return raw[1]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { rows?: unknown[] }).rows)) {
    return (raw as { rows: ReturnType<typeof worldBankRows> }).rows
  }
  return []
}

function latestWorldBankRowsByCountry(rows: ReturnType<typeof worldBankRows>) {
  const byCountry = new Map<string, { country: string; year: string; value: number }>()
  for (const row of rows) {
    if (typeof row.value !== 'number') continue
    const code = String(row.countryiso3code || row.country?.id || '').toUpperCase()
    const country = WORLD_BANK_COUNTRY_NAMES[code] || row.country?.value || code || 'Country'
    if (!country) continue
    const year = String(row.date || '')
    const existing = byCountry.get(country)
    if (!existing || Number(year) > Number(existing.year)) {
      byCountry.set(country, { country, year, value: row.value })
    }
  }
  return Array.from(byCountry.values())
}

function worldBankApiConnector(source: TrustedSourceRecord): TrustedSourceConnector {
  const connector = baseConnector(source)
  connector.fetch = async (request) => {
    const fetchImpl = request.fetchImpl || fetch
    const indicator = worldBankIndicatorForField(request.field)
    const countries = worldBankCountriesForField(request.field)
    const endpoint = `https://api.worldbank.org/v2/country/${countries.join(';')}/indicator/${indicator.code}?format=json&per_page=100`
    const response = await fetchImpl(endpoint)
    if (!response.ok) throw new Error(`World Bank API returned ${response.status}`)
    const raw = await response.json()
    return {
      indicator,
      countries,
      rows: Array.isArray(raw) && Array.isArray(raw[1]) ? raw[1] : [],
    }
  }
  connector.parse = async (raw, request) => {
    const indicator = raw && typeof raw === 'object' && 'indicator' in raw
      ? (raw as { indicator: ReturnType<typeof worldBankIndicatorForField> }).indicator
      : worldBankIndicatorForField(request.field)
    const rows = worldBankRows(raw)
    const latestByCountry = latestWorldBankRowsByCountry(rows)

    if (/country-wise|consumption/i.test(request.field) && latestByCountry.length) {
      return [{
        field: request.field,
        value: latestByCountry
          .map(row => `${row.country}: ${row.value.toFixed(2)}% (${row.year})`)
          .join('; '),
        unit: '% annual growth',
        source_url: indicator.sourceUrl,
        source_date: latestByCountry
          .map(row => row.year)
          .filter(Boolean)
          .sort()
          .at(-1) || nowIso(request).slice(0, 10),
        notes: `${indicator.label}. ${indicator.proxyNote} Keep as Trade Proxy / To Verify until linked to textile or softener-specific evidence.`,
        evidence_status: 'Trade Proxy',
        confidence: 'high',
        review_required: true,
      }]
    }

    const latest = latestByCountry[0]
    if (!latest) {
      return [{
        field: request.field,
        value: 'World Bank API reachable / To Verify',
        source_url: indicator.sourceUrl,
        notes: `No usable ${indicator.label} row returned for the requested field.`,
        evidence_status: 'To Verify',
        review_required: true,
      }]
    }
    return [{
      field: request.field,
      value: `${latest.value.toFixed(2)}%`,
      unit: '%',
      source_url: indicator.sourceUrl,
      source_date: latest.year || nowIso(request).slice(0, 10),
      notes: `${indicator.label}. ${indicator.proxyNote}`,
      evidence_status: 'Official Data',
      review_required: true,
    }]
  }
  return connector
}

export async function runConnector(request: TrustedSourceConnectorRequest): Promise<{
  claims: NormalizedTrustedSourceClaim[]
  log: TrustedSourceConnectorLog
}> {
  const connector = createConnectorForSource(request.source)
  try {
    const raw = await connector.fetch(request)
    const parsed = await connector.parse(raw, request)
    const normalized = connector.normalize(parsed, request)
    const validated = connector.validate(normalized)
    return { claims: connector.map_to_dashboard_fields(validated), log: connector.log_result(validated) }
  } catch (err) {
    const fallback = normalizeClaim({
      screen: request.screen,
      field: request.field,
      value: 'Research Required / To Verify',
      evidence_status: 'To Verify',
      confidence: 'low',
      method: 'fallback',
      notes: `Connector unavailable: ${err instanceof Error ? err.message : 'unknown error'}. Create Hermes research job/fallback task.`,
      review_required: true,
    }, request.source)
    return { claims: [fallback], log: connector.log_result([fallback]) }
  }
}

export function preferredSourceForField(
  screen: AutopilotScreen,
  field: string,
  sources: TrustedSourceRecord[],
): TrustedSourceRecord | null {
  const mapping = SCREEN_FIELD_MAPPINGS[screen].find(item => item.field === field)
  if (!mapping) return null
  const allowed = sources.filter(source =>
    source.enabled &&
    source.allowed_for.includes(screen) &&
    (mapping.preferredDataTypes.some(type => source.data_types_supported.includes(type)) ||
      mapping.fallbackDataTypes.some(type => source.data_types_supported.includes(type))),
  )
  return sortSourcesByDashboardPolicy(allowed, mapping.preferredDataTypes, mapping.fallbackDataTypes)[0] || null
}

export function createMissingFieldClaim(screen: AutopilotScreen, field: string): NormalizedTrustedSourceClaim {
  const mapping = SCREEN_FIELD_MAPPINGS[screen].find(item => item.field === field)
  const fetchedAt = new Date().toISOString()
  return {
    claim_id: `missing-${screen}-${field.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    screen,
    field,
    value: mapping?.unavailableStatus === 'Trade Proxy' ? 'Trade Proxy / To Verify' : 'Missing / To Verify',
    source_id: 'missing-source',
    source_name: 'Source missing',
    fetched_at: fetchedAt,
    evidence_status: mapping?.unavailableStatus || 'Missing',
    confidence: 'low',
    method: 'fallback',
    notes: 'No trusted source or internal value is available yet. Create research job or task.',
    review_required: true,
    data_type: mapping?.preferredDataTypes[0] || 'document_evidence',
    sensitive: mapping?.sensitive,
  }
}
