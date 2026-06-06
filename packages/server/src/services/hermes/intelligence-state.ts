import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getActiveProfileName, getProfileDir } from './hermes-profile'

export interface DashboardIntelligenceEnvelope {
  version: 1
  profile: string
  savedAt: string
  savedBy?: {
    id?: number
    username?: string
    role?: string
  }
  state: Record<string, unknown>
}

const STATE_VERSION = 1
const MAX_STATE_BYTES = 10_000_000
const TOP_LEVEL_ARRAY_KEYS = [
  'evidenceItems',
  'marketClaims',
  'competitors',
  'rawMaterialSignals',
  'supplierScorecards',
  'regulatoryFindings',
  'financialEvidence',
  'presentationMaterials',
  'suggestedTasks',
  'investorMaterialCandidates',
  'researchJobs',
  'researchFindings',
  'financialModels',
  'dataRoomSources',
]
const SECRET_KEY_PATTERN = /api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer|cookie|password|secret|jwt/i
const COMPETITOR_METRIC_FIELD_ALIASES: Record<string, string> = {
  price: 'Price evidence',
  pricing: 'Price evidence',
  priceevidence: 'Price evidence',
  pricingevidence: 'Price evidence',
  pricekg: 'Price evidence',
  priceperkg: 'Price evidence',
  marketshare: 'Market share',
  share: 'Market share',
  revenue: 'Revenue',
  sales: 'Revenue',
  turnover: 'Revenue',
  yoygrowth: 'YoY growth',
  yearlygrowth: 'YoY growth',
  annualgrowth: 'YoY growth',
  growth: 'YoY growth',
  traffic: 'Traffic',
  websitetraffic: 'Traffic',
  monthlyvisits: 'Traffic',
  rating: 'Rating',
  reviewrating: 'Rating',
  lastupdated: 'Last updated',
  lastchecked: 'Last updated',
  sourcedate: 'Last updated',
}
const KNOWN_COMPETITOR_NAME_BY_SLUG: Record<string, string> = {
  evonik: 'Evonik Industries',
  evonik_industries: 'Evonik Industries',
  stepan: 'Stepan Company',
  stepan_company: 'Stepan Company',
  kao: 'Kao Corporation',
  kao_corporation: 'Kao Corporation',
  kao_chemicals: 'Kao Corporation',
  wacker: 'WACKER',
  wacker_chemie: 'WACKER',
  rudolf: 'Rudolf Group',
  rudolf_group: 'Rudolf Group',
  cht: 'CHT Group',
  cht_group: 'CHT Group',
  archroma: 'Archroma',
  transfar: 'Transfar',
  transfar_group: 'Transfar',
  transfar_chemicals: 'Transfar',
  zschimmer: 'Zschimmer & Schwarz',
  zschimmer_schwarz: 'Zschimmer & Schwarz',
  zschimmer_and_schwarz: 'Zschimmer & Schwarz',
  pulcra: 'Pulcra Chemicals',
  pulcra_chemicals: 'Pulcra Chemicals',
  syensqo: 'Syensqo / Solvay',
  solvay: 'Syensqo / Solvay',
  syensqo_solvay: 'Syensqo / Solvay',
  solvay_syensqo: 'Syensqo / Solvay',
  dow: 'Dow',
  dow_inc: 'Dow',
  dow_chemical: 'Dow',
  dow_chemical_company: 'Dow',
  akzonobel: 'AkzoNobel',
  akzo_nobel: 'AkzoNobel',
  procter_gamble: 'Procter & Gamble',
  procter_and_gamble: 'Procter & Gamble',
  p_g: 'Procter & Gamble',
  basf: 'BASF',
  basf_se: 'BASF',
}
const COMPANY_NAME_NOISE_TOKENS = new Set(['competitor', 'competitors', 'competitormetrics', 'metric', 'metrics'])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function statePath(profile?: string): string {
  const name = profile || getActiveProfileName() || 'default'
  return join(getProfileDir(name), 'dashboard-intelligence', 'state.json')
}

function redactSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretKeys)
  if (!isPlainRecord(value)) return value

  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    next[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecretKeys(child)
  }
  return next
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeMetricToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function titleCaseSlug(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.length <= 4 && part === part.toLowerCase()
      ? part.toUpperCase()
      : `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')
}

function isNoisyCompetitorCompanyName(value: unknown): boolean {
  const text = stringValue(value).toLowerCase()
  if (!text) return false
  return /^metrics?\b/.test(text) ||
    /\b(market share|price evidence|pricing evidence|yoy growth|yearly growth|website traffic|review rating|last updated|source date)\b/.test(text)
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
}

function canonicalCompetitorCompanyName(value: unknown): string {
  const text = stringValue(value)
  if (!text) return ''
  return KNOWN_COMPETITOR_NAME_BY_SLUG[normalizeHeader(text)] || text
}

function researchFindingDedupeKey(value: unknown): string {
  if (!isPlainRecord(value)) return JSON.stringify(value)
  const source = isPlainRecord(value.source) ? value.source : {}
  const target = isPlainRecord(value.dashboardTarget) ? value.dashboardTarget : {}
  return [
    stringValue(value.status),
    stringValue(value.evidenceStatus),
    stringValue(value.keyClaim),
    stringValue(value.summary),
    stringValue(source.title),
    stringValue(source.url),
    stringValue(target.group),
    stringValue(target.fieldKey),
    stringValue(target.proposedDashboardField),
    stringValue(target.companyName),
    stringValue(target.value),
    stringValue(target.marketShare),
    stringValue(target.pricingEvidence),
    stringValue(target.revenue),
    stringValue(target.yearlyGrowth),
    stringValue(target.traffic),
    stringValue(target.rating),
  ].join('\u001f')
}

function compactResearchFindingsForWrite(value: unknown[]): unknown[] {
  const seen = new Set<string>()
  const compacted: unknown[] = []

  for (let index = value.length - 1; index >= 0; index -= 1) {
    const item = value[index]
    const key = researchFindingDedupeKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    compacted.push(item)
  }

  return compacted.reverse()
}

function parseCompetitorMetricTarget(fieldKey: unknown): { companyName: string; metricLabel: string } | null {
  const text = stringValue(fieldKey)
  if (!text) return null
  const parts = text
    .toLowerCase()
    .replace(/competitor metric columns:\s*/i, 'competitor_metrics.')
    .replace(/\s+-\s+/g, '.')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/(^\.|\.$)/g, '')
    .split('.')
    .filter(Boolean)
  const metricIndex = parts.findIndex(part => part === 'competitor' || part === 'competitors' || part === 'competitormetrics')
  let start = metricIndex >= 0 ? metricIndex + 1 : (parts[0] === 'competitor' || parts[0] === 'competitors' ? 1 : -1)
  if (start < 0 && (parts[0] === 'metrics' || parts[0] === 'metric')) start = 1
  if (parts[start] === 'metrics' || parts[start] === 'metric') start += 1
  if (start < 0 || start >= parts.length - 1) return null

  for (let index = start + 1; index < parts.length; index += 1) {
    const metricLabel = COMPETITOR_METRIC_FIELD_ALIASES[normalizeMetricToken(parts.slice(index).join(' '))]
    if (!metricLabel) continue
    const companySlug = parts
      .slice(start, index)
      .filter(part => !COMPANY_NAME_NOISE_TOKENS.has(part))
      .join('_')
    if (!companySlug) return null
    return {
      companyName: KNOWN_COMPETITOR_NAME_BY_SLUG[companySlug] || titleCaseSlug(companySlug),
      metricLabel,
    }
  }
  return null
}

function normalizeStoredDashboardStateForRead(state: Record<string, unknown>): Record<string, unknown> {
  const competitors = Array.isArray(state.competitors)
    ? state.competitors.map(competitor => {
      if (!isPlainRecord(competitor)) return competitor
      const companyName = canonicalCompetitorCompanyName(competitor.companyName)
      return companyName ? { ...competitor, companyName } : competitor
    })
    : state.competitors
  const findings = Array.isArray(state.researchFindings)
    ? state.researchFindings.map(finding => {
      if (!isPlainRecord(finding) || !isPlainRecord(finding.dashboardTarget)) return finding
      const parsed = parseCompetitorMetricTarget(finding.dashboardTarget.fieldKey)
      if (!parsed) return finding
      const target = { ...finding.dashboardTarget }
      if (!stringValue(target.companyName) || isNoisyCompetitorCompanyName(target.companyName)) {
        target.companyName = parsed.companyName
      }
      if (!stringValue(target.field) || isNoisyCompetitorCompanyName(target.field)) {
        target.field = `${parsed.companyName} - ${parsed.metricLabel}`
      }
      if (!stringValue(target.proposedDashboardField) || isNoisyCompetitorCompanyName(target.proposedDashboardField)) {
        target.proposedDashboardField = `${parsed.companyName} - ${parsed.metricLabel}`
      }
      return { ...finding, dashboardTarget: target }
    })
    : state.researchFindings
  return { ...state, competitors, researchFindings: findings }
}

export function sanitizeDashboardIntelligenceState(input: unknown): Record<string, unknown> {
  if (!isPlainRecord(input)) {
    throw Object.assign(new Error('Dashboard intelligence state must be a JSON object'), { code: 'invalid_state' })
  }

  const sanitized: Record<string, unknown> = {}
  for (const key of TOP_LEVEL_ARRAY_KEYS) {
    const value = input[key]
    const redacted = Array.isArray(value) ? redactSecretKeys(value) : []
    sanitized[key] = key === 'researchFindings' && Array.isArray(redacted)
      ? compactResearchFindingsForWrite(redacted)
      : redacted
  }
  return sanitized
}

export async function readDashboardIntelligenceState(profile?: string): Promise<DashboardIntelligenceEnvelope | null> {
  try {
    const raw = await readFile(statePath(profile), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<DashboardIntelligenceEnvelope>
    if (!parsed || parsed.version !== STATE_VERSION || !isPlainRecord(parsed.state)) return null
    return {
      version: STATE_VERSION,
      profile: parsed.profile || profile || getActiveProfileName() || 'default',
      savedAt: parsed.savedAt || '',
      savedBy: parsed.savedBy,
      state: normalizeStoredDashboardStateForRead(parsed.state),
    }
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

export async function writeDashboardIntelligenceState(input: {
  profile?: string
  state: unknown
  savedBy?: DashboardIntelligenceEnvelope['savedBy']
}): Promise<DashboardIntelligenceEnvelope> {
  const profile = input.profile || getActiveProfileName() || 'default'
  const state = sanitizeDashboardIntelligenceState(input.state)
  const envelope: DashboardIntelligenceEnvelope = {
    version: STATE_VERSION,
    profile,
    savedAt: new Date().toISOString(),
    savedBy: input.savedBy,
    state,
  }
  const serialized = JSON.stringify(envelope, null, 2)
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_STATE_BYTES) {
    throw Object.assign(new Error('Dashboard intelligence state is too large'), { code: 'state_too_large' })
  }

  const filePath = statePath(profile)
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, serialized, 'utf-8')
  await rename(tempPath, filePath)
  return envelope
}
