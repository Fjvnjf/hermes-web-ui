import type { IntelligenceEvidenceStatus } from './investorIntelligence'

export type RawMaterialSourceType =
  | 'Missing'
  | 'SunSirs'
  | 'ECHEMI'
  | 'Supplier quote'
  | 'Alibaba/Made-in-China reference'
  | 'Manual entry'
  | 'Paid source'

export interface RawMaterialPriceEntry {
  id: string
  materialName: string
  unit: string
  rmbPrice: number | null
  usdPrice: number | null
  source: string
  sourceType: RawMaterialSourceType
  sourceDate: string
  confidence: 'low' | 'medium' | 'high'
  evidenceStatus: IntelligenceEvidenceStatus
  notes: string
  createdAt: string
}

export interface RawMaterialRecord {
  id: string
  name: string
  cas: string
  unit: string
  sourceType: RawMaterialSourceType
  evidenceStatus: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  alertThresholdPct: number
  source: string
  sourceDate: string
  notes: string
  highRisk: boolean
  priceHistory: RawMaterialPriceEntry[]
}

export interface PriceAlert {
  percentChange: number
  triggered: boolean
  direction: 'increase' | 'decrease' | 'flat'
}

export interface ExportMarketRecord {
  id: string
  country: string
  productScope: string
  hsCode: string
  rankingType: string
  dataMethod: string
  valueVolume: string
  growth: string
  source: string
  sourceDate: string
  confidence: 'low' | 'medium' | 'high'
  evidenceStatus: IntelligenceEvidenceStatus
  opportunityScore: string
  notes: string
  lastChecked: string
}

export interface EmployeeRedactionOptions {
  employeeMode: boolean
  replacement?: string
}

export const REQUESTED_EVIDENCE_STATUSES: IntelligenceEvidenceStatus[] = [
  'Verified',
  'Source-backed',
  'User Provided',
  'User Approved',
  'Investor Approved',
  'Assumption',
  'Powerful Assumption',
  'Derived from Assumptions',
  'To Verify',
  'Reference Only',
]

export const RAW_MATERIALS_STORAGE_KEY = 'hermes.rawMaterialSourcing.v1'
export const EXPORT_MARKET_STORAGE_KEY = 'hermes.exportMarketOpportunity.v1'

export const RAW_MATERIAL_NAMES = [
  'TEA',
  'DMS / dimethyl sulfate',
  'iTDA 8EO',
  'Isodecanol 5EO',
  'Isodecanol 7EO',
  'iTDA 5EO',
  'Crude palm oil',
  'iTDA',
  'DEA',
  'MDEA',
  'Formic acid',
  'Acetic acid',
  'Acrylic acid',
  'Butyl acrylate',
  'Epichlorohydrin',
  'PDMS 1000 cSt',
  'Precipitated silica dioxide',
  'DETA',
  'Ethylene oxide',
  'Ammonia',
  'C12-C14 secondary alcohol',
  'Amino silicone fluid amine value 0.8-0.9',
  'Stearic acid 1842',
  '25kg packaging bags',
]

export function nowIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isDmsMaterial(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('dms') || lower.includes('dimethyl sulfate')
}

export function createDefaultRawMaterials(): RawMaterialRecord[] {
  return RAW_MATERIAL_NAMES.map(name => ({
    id: slugify(name),
    name,
    cas: 'To Verify',
    unit: name.includes('bags') ? 'bags' : 'MT',
    sourceType: 'Missing',
    evidenceStatus: 'To Verify',
    confidence: 'low',
    alertThresholdPct: 5,
    source: '',
    sourceDate: '',
    notes: isDmsMaterial(name)
      ? 'High regulatory/safety risk. Do not treat handling, import, storage, or use status as verified until source-backed.'
      : '',
    highRisk: isDmsMaterial(name),
    priceHistory: [],
  }))
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function sourceTypeStatus(
  sourceType: RawMaterialSourceType,
  source: string,
  sourceDate: string,
  hasPrice: boolean,
): IntelligenceEvidenceStatus {
  if (!hasPrice) return 'To Verify'
  const hasUsableSource = Boolean(source.trim() && sourceDate.trim())
  if (!hasUsableSource) return 'To Verify'
  if (sourceType === 'Supplier quote' || sourceType === 'SunSirs' || sourceType === 'ECHEMI' || sourceType === 'Paid source') {
    return 'Source-backed'
  }
  if (sourceType === 'Alibaba/Made-in-China reference') return 'Reference Only'
  if (sourceType === 'Manual entry') return 'User Provided'
  return 'To Verify'
}

export function calculatePriceAlert(
  previousPrice: number | null | undefined,
  currentPrice: number | null | undefined,
  thresholdPct = 5,
): PriceAlert {
  const previous = Number(previousPrice || 0)
  const current = Number(currentPrice || 0)
  if (previous <= 0 || current <= 0) return { percentChange: 0, triggered: false, direction: 'flat' }
  const percentChange = ((current - previous) / previous) * 100
  return {
    percentChange,
    triggered: Math.abs(percentChange) >= thresholdPct,
    direction: percentChange > 0 ? 'increase' : percentChange < 0 ? 'decrease' : 'flat',
  }
}

export function latestPriceEntry(material: RawMaterialRecord): RawMaterialPriceEntry | null {
  return material.priceHistory[0] || null
}

export function previousPriceEntry(material: RawMaterialRecord): RawMaterialPriceEntry | null {
  return material.priceHistory[1] || null
}

export function materialPriceAlert(material: RawMaterialRecord): PriceAlert {
  const latest = latestPriceEntry(material)
  const previous = previousPriceEntry(material)
  return calculatePriceAlert(previous?.rmbPrice ?? previous?.usdPrice, latest?.rmbPrice ?? latest?.usdPrice, material.alertThresholdPct)
}

export function redactedValue(value: string | number | null | undefined, options: EmployeeRedactionOptions): string {
  if (options.employeeMode) return options.replacement || 'Restricted in Employee View'
  if (value === null || value === undefined || value === '') return 'To Verify'
  return String(value)
}

export function sourceBackedOrToVerify(
  value: string,
  source: string,
  sourceDate: string,
  requestedStatus: IntelligenceEvidenceStatus,
): IntelligenceEvidenceStatus {
  if (!value.trim()) return 'To Verify'
  if ((requestedStatus === 'Verified' || requestedStatus === 'Source-backed') && !(source.trim() && sourceDate.trim())) return 'To Verify'
  return requestedStatus
}

export function exportMarketStatusLabel(hsCode: string): string {
  return hsCode.trim() ? 'HS code supplied - verify source before relying on it' : 'Trade proxy / To Verify'
}

export function createExportMarketResearchTaskBody(productScope: string, rankingType: string, growthPeriod: string): string {
  return [
    `Research export market opportunity for ${productScope}.`,
    `Ranking type: ${rankingType}`,
    `Growth period: ${growthPeriod}`,
    'Confirm HS codes first. Until confirmed, label results as Trade proxy / To Verify.',
    'Use source-backed import/export volume or value, textile production proxy, dyeing/finishing proxy, confidence, source title, URL/date, and notes.',
    'Do not hardcode fake country rankings, market size, CAGR, or opportunity score.',
    'Tags: Export Market Opportunity, Market Intelligence, To Verify',
  ].join('\n')
}
