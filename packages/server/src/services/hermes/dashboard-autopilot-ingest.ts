import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { logger } from '../logger'
import { getHermesBin } from './hermes-path'
import { getActiveProfileName, getProfileDir } from './hermes-profile'
import { PROVIDER_ENV_MAP, readConfigYamlForProfile, updateConfigYamlForProfile } from '../config-helpers'
import { PROVIDER_PRESETS } from '../../shared/providers'
import {
  readDashboardIntelligenceState,
  writeDashboardIntelligenceState,
} from './intelligence-state'

export const FULL_DASHBOARD_AUTOPILOT_JOB_NAME = 'Full Dashboard Trusted Source Autopilot'
export const FULL_DASHBOARD_AUTOPILOT_SCHEDULE = '0 7,19 * * *'
export const FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION = 'dashboard-autopilot-schema-v2026-06-05-competitor-metrics-v4'
export const FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME = 'Full Dashboard Missing Coverage Follow-up'
export const DASHBOARD_AUTOPILOT_IMPORTER_VERSION = 'dashboard-autopilot-ingest-v2026-06-06-official-product-evidence-v10'

const execFileAsync = promisify(execFile)
const CREATE_TIMEOUT_MS = 60_000
const RUN_TIMEOUT_MS = 15 * 60_000

const DASHBOARD_UPDATE_GROUPS = [
  'marketClaims',
  'competitorRecords',
  'rawMaterialSignals',
  'supplierScorecards',
  'regulatoryFindings',
  'financialEvidence',
  'evidenceGaps',
  'suggestedTasks',
  'investorMaterialCandidates',
] as const

const AUTO_TRUSTED_STATUSES = new Set([
  'Trusted Source Auto-Updated',
  'Official Data',
  'Official Company Evidence',
  'Source-backed',
  'Supplier Evidence',
])

const VALID_CONFIDENCE = new Set(['low', 'medium', 'high'])
const VALID_EVIDENCE_STATUSES = new Set([
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
  'Official Company Evidence',
])

const VALID_DATA_TYPES = new Set([
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
])

const GROUP_DEFAULT_DATA_TYPE: Record<DashboardResearchUpdateGroup, string> = {
  marketClaims: 'market_size',
  competitorRecords: 'competitor_data',
  rawMaterialSignals: 'price_data',
  supplierScorecards: 'supplier_quote',
  regulatoryFindings: 'regulatory_data',
  financialEvidence: 'financial_data',
  evidenceGaps: 'document_evidence',
  suggestedTasks: 'internal_activity',
  investorMaterialCandidates: 'document_evidence',
}

const GROUP_SCREEN: Record<DashboardResearchUpdateGroup, string> = {
  marketClaims: 'market',
  competitorRecords: 'competitor',
  rawMaterialSignals: 'raw-material-sourcing',
  supplierScorecards: 'raw-material-sourcing',
  regulatoryFindings: 'regulatory',
  financialEvidence: 'investment',
  evidenceGaps: 'research-review',
  suggestedTasks: 'kanban',
  investorMaterialCandidates: 'presentation',
}

const CRITICAL_GROUPS = new Set<DashboardResearchUpdateGroup>([
  'rawMaterialSignals',
  'supplierScorecards',
  'regulatoryFindings',
  'financialEvidence',
  'investorMaterialCandidates',
])

const CRITICAL_FIELD_PATTERN = /market size|growth|cagr|consumption|market share|share chart|price|cost|supplier|score|payment|quality|reliability|irr|npv|payback|profitability|roi|investment|revenue target|asp|regulatory|dms|cas|formula|investor/i
const SENSITIVE_DATA_TYPES = new Set(['price_data', 'financial_data', 'supplier_quote', 'regulatory_data'])
const PLACEHOLDER_PATTERN = /to verify|missing|research required|api-ready|reference only|trade proxy/i
const SCREENSHOT_FAKE_VALUES = ['$3.2B', '$120M', '$16M', '$49.8M', '60%', '7.2%', '38%', '$34/kg', '$24/kg', '20-25%']
const MAX_IMPORTED_RUN_KEYS = 500

type DashboardResearchUpdateGroup = typeof DASHBOARD_UPDATE_GROUPS[number]
type SourceTier =
  | 'tier1-official'
  | 'tier2-company-official'
  | 'tier3-supplier-evidence'
  | 'tier4-market-reference'
  | 'tier5-public-listing'
  | 'candidate-source'

type Confidence = 'low' | 'medium' | 'high'
type ResearchReviewStatus = 'Pending Review' | 'Approved' | 'Rejected' | 'To Verify'

const OFFICIAL_SOURCE_DOMAINS = [
  'comtradeapi.un.org',
  'comtradeplus.un.org',
  'comtrade.un.org',
  'uncomtrade.org',
  'trademap.org',
  'intracen.org',
  'worldbank.org',
  'wits.worldbank.org',
  'wto.org',
  'imf.org',
  'oecd.org',
  'stat.unido.org',
  'unctadstat.unctad.org',
  'ilostat.ilo.org',
  'fao.org',
  'europa.eu',
  'census.gov',
  'usitc.gov',
  'fred.stlouisfed.org',
  'bls.gov',
  'stats.gov.cn',
  'customs.gov.cn',
  'mofcom.gov.cn',
  'mee.gov.cn',
  'english.www.gov.cn',
  'samr.gov.cn',
  'mem.gov.cn',
  'miit.gov.cn',
  'pbc.gov.cn',
  'safe.gov.cn',
  'bb.org.bd',
  'epb.gov.bd',
  'sec.gov',
  'hkexnews.hk',
  'echa.europa.eu',
  'pubchem.ncbi.nlm.nih.gov',
  'comptox.epa.gov',
  'epa.gov',
  'nite.go.jp',
]

const COMPANY_OFFICIAL_SOURCE_DOMAINS = [
  'evonik.com',
  'stepan.com',
  'kao.com',
  'kaochemicals-eu.com',
  'wacker.com',
  'rudolf.de',
  'cht.com',
  'archroma.com',
  'zschimmer-schwarz.com',
  'pulcra-chemicals.com',
  'transfarchem.com',
  'syensqo.com',
  'basf.com',
  'dow.com',
  'shinetsu.co.jp',
  'momentive.com',
  'wilmar-international.com',
  'klkoleo.com',
]

const MARKET_REFERENCE_SOURCE_DOMAINS = [
  'icis.com',
  'argusmedia.com',
  'spglobal.com',
  'chemanalyst.com',
  'chemorbis.com',
  'polymerupdate.com',
  'asianmetal.com',
  'itmf.org',
  'textileexchange.org',
  'iafnet.eu',
  'fibre2fashion.com',
  'just-style.com',
  'grandviewresearch.com',
  'marketsandmarkets.com',
  'researchandmarkets.com',
  'mordorintelligence.com',
  'statista.com',
  'euromonitor.com',
  'mckinsey.com',
  'deloitte.com',
]

const WEAK_PUBLIC_LISTING_DOMAINS = [
  'alibaba.com',
  'made-in-china.com',
  '1688.com',
  'lookchem.com',
  'guidechem.com',
  'chembk.com',
  'specialchem.com',
  'globalsources.com',
  'indiamart.com',
  'dhgate.com',
  'go4worldbusiness.com',
]

interface CronJobRecord {
  id?: unknown
  job_id?: unknown
  name?: unknown
  prompt?: unknown
  prompt_preview?: unknown
}

interface DashboardResearchUpdateItem {
  [key: string]: unknown
  fieldKey?: unknown
  screen?: unknown
  field?: unknown
  label?: unknown
  title?: unknown
  value?: unknown
  companyName?: unknown
  countryRegion?: unknown
  productEquivalent?: unknown
  activeContent?: unknown
  pricingEvidence?: unknown
  certifications?: unknown
  distributionPresence?: unknown
  marketShare?: unknown
  revenue?: unknown
  yearlyGrowth?: unknown
  traffic?: unknown
  rating?: unknown
  section?: unknown
  content?: unknown
  sourceTitle?: unknown
  sourceName?: unknown
  sourceUrl?: unknown
  sourceDate?: unknown
  sourceTier?: unknown
  lastChecked?: unknown
  confidence?: unknown
  evidenceStatus?: unknown
  reviewRequired?: unknown
  riskReason?: unknown
  dataType?: unknown
  sensitive?: unknown
  notes?: unknown
  recommendedAction?: unknown
  proposedDashboardField?: unknown
}

type DashboardResearchUpdatesPayload = Partial<Record<DashboardResearchUpdateGroup, DashboardResearchUpdateItem[]>>

function countDashboardPayloadItems(payload: DashboardResearchUpdatesPayload | null | undefined): number {
  if (!payload) return 0
  return DASHBOARD_UPDATE_GROUPS.reduce((count, group) => count + (payload[group]?.length || 0), 0)
}

interface DashboardIntelligenceState {
  evidenceItems: Record<string, unknown>[]
  marketClaims: Record<string, unknown>[]
  competitors: Record<string, unknown>[]
  presentationMaterials: Record<string, unknown>[]
  researchJobs: Record<string, unknown>[]
  researchFindings: Record<string, unknown>[]
  financialModels: Record<string, unknown>[]
  dataRoomSources: Record<string, unknown>[]
}

interface CoverageTarget {
  label: string
  aliases: string[]
  metric?: CompetitorMetricField
  companyAliases?: string[]
}

interface CoverageRequirement {
  area: string
  textScope: 'market' | 'competitor' | 'supplier' | 'regulatory' | 'financial' | 'investor'
  targets: CoverageTarget[]
}

type CompetitorMetricField =
  | 'pricingEvidence'
  | 'marketShare'
  | 'revenue'
  | 'yearlyGrowth'
  | 'traffic'
  | 'rating'
  | 'lastUpdated'

interface SecCompetitorFinancialSource {
  companyName: string
  cik: string
  fieldKeySlug: string
  aliases: string[]
}

type OfficialCompanyFinancialParser = 'basf-report-2025' | 'evonik-results-2025' | 'wacker-report-2025' | 'kao-glance-2025'

interface OfficialCompanyFinancialSource {
  companyName: string
  fieldKeySlug: string
  countryRegion: string
  sourceTitle: string
  sourceUrl: string
  parser: OfficialCompanyFinancialParser
}

interface OfficialCompetitorProductSource {
  companyName: string
  fieldKeySlug: string
  countryRegion: string
  productLabel: string
  productEquivalent: string
  activeContent: string
  certifications?: string
  distributionPresence?: string
  sourceTitle: string
  sourceUrl: string
  requiredTerms: string[]
}

interface OfficialSupplierEvidenceSource {
  supplier: string
  material: string
  fieldKeySlug: string
  sourceTitle: string
  sourceUrl: string
  value: string
  requiredTerms: string[]
  recommendedAction: string
}

interface SecAnnualRevenueMetric {
  year: number
  value: number
  filed: string
  accession: string
  concept: string
  entityName: string
}

interface ComtradeMarketProxySource {
  country: string
  reporterCode: string
  fieldKeySlug: string
}

interface ComtradeAnnualImportMetric {
  year: number
  primaryValue: number
  netWeightKg: number
  isReported: boolean
  isAggregate: boolean
}

interface OfficialCompanyFinancialMetric {
  year: number
  revenueValue: string
  growthValue?: string
}

interface OfficialConnectorResult {
  autoFilledCount: number
  stagedReviewCount: number
  errors: string[]
}

const COMPETITOR_SOURCE_BACKED_METRIC_FIELDS: CompetitorMetricField[] = [
  'pricingEvidence',
  'marketShare',
  'revenue',
  'yearlyGrowth',
  'traffic',
  'rating',
  'lastUpdated',
]

const SEC_COMPETITOR_FINANCIAL_SOURCES: SecCompetitorFinancialSource[] = [
  {
    companyName: 'Stepan Company',
    cik: '0000094049',
    fieldKeySlug: 'stepan_company',
    aliases: ['stepan', 'stepan company'],
  },
  {
    companyName: 'Dow',
    cik: '0001751788',
    fieldKeySlug: 'dow',
    aliases: ['dow', 'dow inc', 'dow inc.'],
  },
]

const SEC_REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
]

const OFFICIAL_COMPANY_FINANCIAL_SOURCES: OfficialCompanyFinancialSource[] = [
  {
    companyName: 'BASF',
    fieldKeySlug: 'basf',
    countryRegion: 'Germany / global',
    sourceTitle: 'BASF Report 2025 - Results of Operations',
    sourceUrl: 'https://report.basf.com/2025/en/combined-managements-report/basf-groups-business-year/results-of-operations.html',
    parser: 'basf-report-2025',
  },
  {
    companyName: 'Evonik Industries',
    fieldKeySlug: 'evonik_industries',
    countryRegion: 'Germany / global',
    sourceTitle: 'Evonik 2025 results release',
    sourceUrl: 'https://www.evonik.com/en/news/press-releases/2026/03/Q4-reporting-2025.html',
    parser: 'evonik-results-2025',
  },
  {
    companyName: 'WACKER',
    fieldKeySlug: 'wacker',
    countryRegion: 'Germany / global',
    sourceTitle: 'WACKER Annual Report 2025 - Regions',
    sourceUrl: 'https://reports.wacker.com/2025/annual-report/management-report/segments/regions.html',
    parser: 'wacker-report-2025',
  },
  {
    companyName: 'Kao Corporation',
    fieldKeySlug: 'kao_corporation',
    countryRegion: 'Japan / global',
    sourceTitle: 'Kao at a Glance',
    sourceUrl: 'https://www.kao.com/global/en/corporate/data/',
    parser: 'kao-glance-2025',
  },
]

const OFFICIAL_COMPETITOR_PRODUCT_SOURCES: OfficialCompetitorProductSource[] = [
  {
    companyName: 'Stepan Company',
    fieldKeySlug: 'stepan_company',
    countryRegion: 'United States / global',
    productLabel: 'STEPANTEX SP-90',
    productEquivalent: 'STEPANTEX SP-90 esterquat softener product reference',
    activeContent: 'Dialkylester fabric-softener chemistry; official page source confirms STEPANTEX SP-90 product identity.',
    distributionPresence: 'Official Stepan product page.',
    sourceTitle: 'Stepan STEPANTEX SP-90 official product page',
    sourceUrl: 'https://pt.stepan.com/content/stepan-dot-com/pt_br/products-markets/product/STEPANTEXSP90.html',
    requiredTerms: ['STEPANTEX', 'SP-90'],
  },
  {
    companyName: 'WACKER',
    fieldKeySlug: 'wacker',
    countryRegion: 'Germany / global',
    productLabel: 'WACKER FINISH WR 1200',
    productEquivalent: 'WACKER FINISH WR 1200 functional silicone fluid for textile finishing context',
    activeContent: 'Reactive aminoethyl-aminopropyl functional polydimethylsiloxane.',
    distributionPresence: 'Official WACKER product page states global production, sales, and distributor network context.',
    sourceTitle: 'WACKER FINISH WR 1200 official product page',
    sourceUrl: 'https://www.wacker.com/h/en-jo/c/wacker-finish-wr-1200/p/000010891',
    requiredTerms: ['FINISH WR 1200', 'polydimethylsiloxane'],
  },
  {
    companyName: 'Kao Corporation',
    fieldKeySlug: 'kao_corporation',
    countryRegion: 'Japan / Europe',
    productLabel: 'TETRANYL L9-90',
    productEquivalent: 'TETRANYL L9-90 esterquat softener-market product reference',
    activeContent: 'Esterquat based on European vegetable sources.',
    distributionPresence: 'Official Kao Chemicals EU product page.',
    sourceTitle: 'Kao TETRANYL L9-90 official product page',
    sourceUrl: 'https://www.kaochemicals-eu.com/industries/textile-and-leather-chemicals/products/tetranyl-l9-90',
    requiredTerms: ['TETRANYL L9-90', 'Esterquat'],
  },
  {
    companyName: 'Archroma',
    fieldKeySlug: 'archroma',
    countryRegion: 'Switzerland / global',
    productLabel: 'SILIGEN D2W LIQ C',
    productEquivalent: 'SILIGEN D2W LIQ C durable silicone softener for cotton.',
    activeContent: 'Patent-pending cross-linkable silicone emulsion.',
    distributionPresence: 'Official Archroma textile-effects product page.',
    sourceTitle: 'Archroma SILIGEN D2W LIQ C official product page',
    sourceUrl: 'https://www.archroma.com/textile-effects/innovations/siligen-d2w-liq-c',
    requiredTerms: ['SILIGEN', 'silicone softener', 'cotton'],
  },
  {
    companyName: 'CHT Group',
    fieldKeySlug: 'cht_group',
    countryRegion: 'Germany / global',
    productLabel: 'TUBINGAL GEP',
    productEquivalent: 'TUBINGAL GEP silicone-based textile softener.',
    activeContent: 'Silicone-based softener for textile finishing.',
    distributionPresence: 'Official CHT textile-softener product page.',
    sourceTitle: 'CHT TUBINGAL GEP official textile softener page',
    sourceUrl: 'https://solutions.cht.com/cht/web.nsf/id/li_tubingal-gep-textile-softener.html',
    requiredTerms: ['TUBINGAL GEP', 'silicone-based softener', 'textile finishing'],
  },
]

const OFFICIAL_SUPPLIER_EVIDENCE_SOURCES: OfficialSupplierEvidenceSource[] = [
  {
    supplier: 'Wilmar Oleochemicals',
    material: 'Rubber grade stearic acid / WILFARIN fatty acids',
    fieldKeySlug: 'wilmar_stearic_acid',
    sourceTitle: 'Wilmar Rubber Grade Stearic Acid 1807 official product page',
    sourceUrl: 'https://www.wilmar-international.com/oleochemicals/products/home-care/rubber-grade-stearic-acid-1807',
    value: 'Official Wilmar product page confirms Rubber Grade Stearic Acid 1807 and WILFARIN fatty-acid product context.',
    requiredTerms: ['RUBBER GRADE STEARIC ACID 1807', 'Wilfarin fatty acids'],
    recommendedAction: 'Request current quote, TDS, SDS, COA, MOQ, lead time, delivery route, and payment terms before scoring Wilmar for Chemicon raw-material sourcing.',
  },
  {
    supplier: 'KLK OLEO',
    material: 'Fatty acids / oleo basics',
    fieldKeySlug: 'klk_oleo_fatty_acids',
    sourceTitle: 'KLK OLEO official products page',
    sourceUrl: 'https://www.klkoleo.com/products-banner/',
    value: 'Official KLK OLEO products page confirms Fatty Acids as a product category.',
    requiredTerms: ['KLK OLEO', 'Fatty Acids'],
    recommendedAction: 'Request KLK OLEO stearic-acid grade details, current quote, TDS, SDS, COA, delivery route, and payment terms before supplier scoring.',
  },
  {
    supplier: 'BASF',
    material: 'Triethanolamine / TEOA',
    fieldKeySlug: 'basf_triethanolamine',
    sourceTitle: 'BASF Triethanolamine official product page',
    sourceUrl: 'https://products.basf.com/global/en/ci/triethanolamine',
    value: 'Official BASF product page confirms Triethanolamine CAS No. 102-71-6 and states TEOA forms quat salts with fatty acids used in fabric softener formulations.',
    requiredTerms: ['Triethanolamine', '102-71-6', 'fabric softener formulations'],
    recommendedAction: 'Request BASF TEA quote, TDS, SDS, COA, China/Bangladesh delivery route, and payment terms before using in cost or supplier scorecards.',
  },
  {
    supplier: 'WACKER',
    material: 'WACKER FINISH WR 1200 / functional silicone fluid',
    fieldKeySlug: 'wacker_finish_wr_1200',
    sourceTitle: 'WACKER FINISH WR 1200 official product page',
    sourceUrl: 'https://www.wacker.com/h/en-jo/c/wacker-finish-wr-1200/p/000010891',
    value: 'Official WACKER product page confirms WACKER FINISH WR 1200 as a functional silicone fluid and reactive aminoethyl-aminopropyl functional polydimethylsiloxane.',
    requiredTerms: ['FINISH WR 1200', 'polydimethylsiloxane'],
    recommendedAction: 'Request WACKER quote, TDS, SDS, COA, recommended application fit, delivery route, and payment terms before supplier scoring.',
  },
]

const COMTRADE_TEXTILE_FINISHING_IMPORT_SOURCES: ComtradeMarketProxySource[] = [
  { country: 'China', reporterCode: '156', fieldKeySlug: 'china' },
  { country: 'Bangladesh', reporterCode: '50', fieldKeySlug: 'bangladesh' },
  { country: 'India', reporterCode: '699', fieldKeySlug: 'india' },
  { country: 'Vietnam', reporterCode: '704', fieldKeySlug: 'vietnam' },
  { country: 'Pakistan', reporterCode: '586', fieldKeySlug: 'pakistan' },
  { country: 'Turkey', reporterCode: '792', fieldKeySlug: 'turkey' },
  { country: 'Indonesia', reporterCode: '360', fieldKeySlug: 'indonesia' },
  { country: 'EU / Germany', reporterCode: '276', fieldKeySlug: 'eu_germany' },
  { country: 'United States', reporterCode: '842', fieldKeySlug: 'united_states' },
  { country: 'GCC / Saudi Arabia', reporterCode: '682', fieldKeySlug: 'gcc_saudi_arabia' },
]

const COMTRADE_TEXTILE_FINISHING_HS_CODE = '380991'

interface ImportRegistry {
  version: 1
  importerVersion: string
  importedRunKeys: string[]
  skippedRunKeys: string[]
  updatedAt: string
}

interface DueRunRegistry {
  version: 1
  slots: Record<string, {
    jobId: string
    dueSlotAt: string
    attemptedAt: string
    outputSeen: boolean
    error: string
  }>
  updatedAt: string
}

interface OutputFile {
  jobId: string
  fileName: string
  path: string
  mtimeMs: number
}

export interface DashboardAutopilotIngestResult {
  profile: string
  jobsChecked: number
  filesChecked: number
  importedRuns: number
  skippedRuns: number
  autoFilledCount: number
  stagedReviewCount: number
  missingCoverageFollowUpStarted: boolean
  errors: string[]
}

interface IngestOptions {
  jobId?: string
  maxFilesPerJob?: number
  includeOfficialConnectors?: boolean
  includeOfficialCompanyFinancialConnectors?: boolean
  includeOfficialProductConnectors?: boolean
  includeOfficialSupplierConnectors?: boolean
  includeOfficialTradeConnectors?: boolean
}

export interface FullDashboardAutopilotScheduleResult {
  profile: string
  jobId: string | null
  created: boolean
  repaired: boolean
  recordedResearchJob: boolean
  firstRunStarted: boolean
  firstRunError: string
}

export interface FullDashboardAutopilotDueRunResult {
  profile: string
  jobId: string | null
  dueSlotAt: string
  dueSlotKey: string
  outputAlreadyPresent: boolean
  skippedRecentAttempt: boolean
  runStarted: boolean
  runError: string
  importedRuns: number
  autoFilledCount: number
  stagedReviewCount: number
}

export interface DashboardAutopilotImportStatus {
  profile: string
  jobCount: number
  outputCount: number
  importedRunCount: number
  skippedRunCount: number
  pendingOutputCount: number
  latestOutputRunKey: string
  latestOutputFile: string
  latestOutputAt: string
  latestOutputImported: boolean
  latestOutputSkipped: boolean
  latestOutputParseStatus: 'none' | 'imported' | 'ready' | 'unparseable' | 'unreadable'
  latestOutputCandidateCount: number
  latestOutputParseError: string
  latestImportedRunKey: string
  registryUpdatedAt: string
  latestDueSlotAt: string
  latestDueSlotSatisfied: boolean
  latestDueSlotAttemptedAt: string
  latestDueSlotRunError: string
}

interface ScheduleOptions {
  startFirstRun?: boolean
}

interface AutopilotDefaultModelResult {
  configured: boolean
  model: string
  provider: string
}

interface DueRunOptions {
  now?: Date
  graceMs?: number
  retryAfterMs?: number
  maxFilesPerJob?: number
}

let intervalTimer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let ingestRunning = false

const DUE_RUN_GRACE_MS = 15 * 60_000
const DUE_RUN_RETRY_AFTER_MS = 60 * 60_000

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function providerKeyForCustom(name: string): string {
  return `custom:${name.trim().toLowerCase().replace(/ /g, '-')}`
}

function envValue(envContent: string, key: string): string {
  if (!key) return ''
  const match = envContent.match(new RegExp(`^${key}\\s*=\\s*(.+)`, 'm'))
  const value = match?.[1]?.trim() || ''
  return value && !value.startsWith('#') ? value : ''
}

async function readProfileText(profile: string, relativePath: string): Promise<string> {
  try {
    return await readFile(join(getProfileDir(profile), relativePath), 'utf-8')
  } catch {
    return ''
  }
}

function authHasProviderToken(authContent: string, providerKey: string): boolean {
  if (!authContent.trim()) return false
  try {
    const auth = JSON.parse(authContent)
    const provider = auth?.providers?.[providerKey]
    const pool = auth?.credential_pool?.[providerKey]
    return Boolean(
      provider?.tokens?.access_token ||
      provider?.access_token ||
      (Array.isArray(pool) && pool.some((entry: any) => entry?.access_token)),
    )
  } catch {
    return false
  }
}

function configuredDefaultModel(config: Record<string, any>): AutopilotDefaultModelResult | null {
  const modelSection = config.model
  if (typeof modelSection === 'object' && modelSection !== null) {
    const model = firstString(modelSection.default)
    if (model) return { configured: false, model, provider: firstString(modelSection.provider) }
  }
  if (typeof modelSection === 'string') {
    const model = modelSection.trim()
    if (model) return { configured: false, model, provider: '' }
  }
  return null
}

async function firstAutopilotModelCandidate(
  profile: string,
  config: Record<string, any>,
): Promise<Omit<AutopilotDefaultModelResult, 'configured'> | null> {
  const customProviders = Array.isArray(config.custom_providers)
    ? config.custom_providers as Array<{ name?: unknown; model?: unknown }>
    : []
  for (const provider of customProviders) {
    const name = firstString(provider.name)
    const model = firstString(provider.model)
    if (name && model) return { model, provider: providerKeyForCustom(name) }
  }

  const [envContent, authContent] = await Promise.all([
    readProfileText(profile, '.env'),
    readProfileText(profile, 'auth.json'),
  ])
  for (const preset of PROVIDER_PRESETS) {
    const envMapping = PROVIDER_ENV_MAP[preset.value]
    if (!envMapping || !preset.models.length) continue
    const hasCredentials = envMapping.api_key_env
      ? Boolean(envValue(envContent, envMapping.api_key_env))
      : authHasProviderToken(authContent, preset.value)
    if (hasCredentials) return { model: preset.models[0], provider: preset.value }
  }

  return null
}

async function ensureDefaultModelForAutopilot(profile: string): Promise<AutopilotDefaultModelResult> {
  const config = await readConfigYamlForProfile(profile)
  const existing = configuredDefaultModel(config)
  if (existing) return existing

  const candidate = await firstAutopilotModelCandidate(profile, config)
  if (!candidate) {
    return { configured: false, model: '', provider: '' }
  }

  const result = await updateConfigYamlForProfile<AutopilotDefaultModelResult>(profile, (latestConfig) => {
    const latestExisting = configuredDefaultModel(latestConfig)
    if (latestExisting) return { data: latestConfig, result: latestExisting, write: false }
    latestConfig.model = {
      ...(isPlainRecord(latestConfig.model) ? latestConfig.model : {}),
      default: candidate.model,
      provider: candidate.provider,
    }
    return {
      data: latestConfig,
      result: { configured: true, model: candidate.model, provider: candidate.provider },
    }
  })

  return result || { configured: true, model: candidate.model, provider: candidate.provider }
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return ''
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return ''
}

function normalizeCoverageAlias(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function target(label: string, ...aliases: string[]): CoverageTarget {
  return {
    label,
    aliases: aliases.map(normalizeCoverageAlias),
  }
}

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
]

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

const coverageRequirements: CoverageRequirement[] = [
  {
    area: 'Market Intelligence',
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
    textScope: 'competitor',
    targets: COMPETITOR_COMPANY_TARGETS,
  },
  {
    area: 'Raw Materials / Supplier Scorecards',
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

function getJobId(job: CronJobRecord): string {
  return firstString(job.job_id, job.id)
}

function fullDashboardAutopilotPrompt(): string {
  return [
    'Full Dashboard Trusted Source Autopilot',
    `Prompt version: ${FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION}`,
    '',
    'Mission: automatically research and refresh the Hermes feasibility intelligence dashboard using trusted online sources and existing Hermes workspace evidence.',
    'Do the online research yourself using available web/search/source tools. Do not ask the user to manually search, copy, or paste source data.',
    'If browsing/search is unavailable, state that limitation and return evidence gaps/tasks instead of fabricating data.',
    '',
    'Dashboard areas to cover:',
    '- Executive Overview: revenue target, EQ capacity MT/YR, projected IRR, payback period, blended ASP/MT, NPV @ 12%, daily brief, priorities, top risk.',
    '- Market Intelligence: market size/scope, growth rate, import dependence, target countries/provinces, country-wise consumption/growth, segmentation, opportunity score.',
    '- Competitor Intelligence: cationic softeners/CHEMISOFT, silicone softeners/CHEMISIL, competitor landscape, product equivalents, pricing evidence, revenue, yearly growth, certifications, distribution, and market share only when source-backed.',
    '- Investment Analysis: total investment, IRR, NPV, payback, profitability index, 5-year ROI, investment breakdown, working capital, scenarios.',
    '- Raw Material Sourcing and Supplier Scorecards: TEA, DMS/dimethyl sulfate, stearic acid, PDMS silicone oil, acetic acid, ethoxylates, packaging, supplier quotes/evidence.',
    '- Export Market Opportunity: country-wise textile/chemical trade proxies, HS-code candidates, growth indicators, import/export signals.',
    '- Regulatory: SDS/TDS/CAS, DMS safety/regulatory status, China import/storage/use requirements, factory chemical approvals.',
    '- Investor Readiness and Presentation Builder: evidence gaps, risk register, data-room checklist, presentation-ready material only when source-backed or user approved.',
    '',
    'Required coverage checklist:',
    '- Every twice-daily run must attempt every dashboard area and every JSON array group. Do not omit a group silently.',
    '- If a source-backed value cannot be found for a required target, return an evidenceGaps item and a suggestedTasks item for that target with proposedDashboardField, Missing / To Verify status, and the best trusted source to check next.',
    '- Country-wise market/consumption targets: China, Bangladesh, India, Vietnam, Pakistan, Turkey, Indonesia, EU / Germany, United States, GCC / Middle East.',
    '- Competitor targets: Evonik Industries, Stepan Company, Kao Corporation, WACKER, Rudolf Group, CHT Group, Archroma, Transfar, Zschimmer & Schwarz, Pulcra Chemicals, Syensqo / Solvay, and any source-backed China/Bangladesh/Vietnam local competitors.',
    '- Supplier/raw-material targets: stearic acid, triethanolamine / TEA, dimethyl sulfate / DMS, PDMS silicone oil, acetic acid, ethoxylates, packaging, Wilmar, KLK OLEO, BASF, Dow, WACKER, DMS candidate suppliers, and local Bangladesh suppliers.',
    '- Regulatory targets: DMS safety/regulatory status, SDS/TDS/CAS evidence, China chemical import/storage/transport/use requirements, factory chemical approvals, and IECSC/China chemical inventory references when relevant.',
    '- Financial/investment targets: Lean/Base/Conservative/Aggressive scenarios, total investment, IRR, NPV, payback, ROI, working capital, capex breakdown, and sensitivity gaps. External web sources cannot verify IRR/NPV; use only approved internal scenarios or mark Derived from Assumptions / To Verify.',
    '- Investor material targets: approved facts, approved assumptions, missing proof, risk register items, data-room gaps, and presentation snippets. Never mark investor material approved without review.',
    '',
    'Trusted source priority:',
    '1. Tier 1: official government/regulator/statistical/trade/price-index/company-filing sources such as UN Comtrade, ITC, World Bank, WTO, OECD, U.S. BLS PPI, SEC EDGAR Company Facts, China Customs/NBS/MOFCOM/MEE/MEM/MIIT, ECHA, PubChem, EPA CompTox, NITE.',
    '2. Tier 2: official company/product pages and catalogs such as BASF, Dow, WACKER, Wilmar, KLK OLEO, Evonik, Stepan, Kao, CHT, Archroma, Transfar, Zschimmer & Schwarz, Pulcra.',
    '3. Tier 3: uploaded supplier evidence such as quotes, PI, invoice, TDS, SDS, COA, email quote, distributor letter.',
    '4. Tier 4: paid/reputable market references such as ICIS, Argus, S&P Global, SunSirs, ECHEMI, ChemAnalyst, Trade Map. Treat as market reference, not final procurement truth.',
    '5. Tier 5: public listings/marketplaces such as Alibaba/Made-in-China are weak references only and must stay Reference Only / To Verify.',
    '',
    'Output requirements:',
    '- Produce a concise summary plus structured sections for each dashboard area.',
    '- Use Markdown tables, evidence-gap tables, source matrices, and Mermaid charts where useful.',
    '- Every claim must include value, source title, URL or publication/access date, source tier, confidence, evidence status, and last checked date.',
    '- Mark missing values as Missing / To Verify.',
    '- Mark trade proxies as Trade Proxy / To Verify until HS-code methodology is reviewed.',
    '- Mark financial outputs as Derived from Assumptions unless tied to an approved internal IRR scenario.',
    '- Mark supplier prices, payment terms, quality scores, and reliability scores as To Verify unless quote/TDS/SDS/COA evidence is attached.',
    '- Mark competitor market share as To Verify unless the source explicitly supports it.',
    '',
    'Machine-readable dashboard_updates schema:',
    '- Put the appendix in one fenced ```json block.',
    '- The top-level object must be: { "dashboard_updates": { ... } }.',
    '- Use these arrays only: marketClaims, competitorRecords, rawMaterialSignals, supplierScorecards, regulatoryFindings, financialEvidence, evidenceGaps, suggestedTasks, investorMaterialCandidates.',
    '- Each item should include fieldKey when known, field/title/label, value, sourceTitle, sourceUrl or sourceDate, sourceTier, lastChecked, confidence, evidenceStatus, reviewRequired, riskReason, dataType, and sensitive when applicable.',
    '- For missing checklist targets, include proposedDashboardField and recommendedAction so Research Result Review and Kanban can show exactly what still needs evidence.',
    '- For country-wise growth/consumption, use marketClaims with field or label like "Country-wise consumption growth - <country/region>" and keep proxy values To Verify.',
    '- For supplier scorecards, use supplierScorecards with supplier, material, value, sourceTitle, sourceUrl/sourceDate, confidence, evidenceStatus, and reviewRequired.',
    '- For competitor analysis, use competitorRecords with companyName, countryRegion, productEquivalent, activeContent, pricingEvidence, marketShare, revenue, yearlyGrowth, traffic, rating, certifications, distributionPresence, sourceTitle, sourceUrl/sourceDate, lastChecked, confidence, evidenceStatus, reviewRequired, and recommendedAction.',
    '- If the JSON appendix fails, still include source-backed Markdown tables with Field/Value/Source Title/Source URL/Source Tier/Confidence/Evidence Status/Review Required columns.',
    '- If tables are not possible, use source-backed delimited bullets such as: Field: Country-wise consumption growth - China | Value: Trade proxy found | Source: [WITS / World Bank Comtrade](https://wits.worldbank.org/) | Source Tier: Tier 1 - Official / regulator / trade source | Evidence Status: Official Data | Confidence: high | Review Required: yes.',
    '- Do not output unsupported plain numbers without source metadata; unstructured or unsourced output will be ignored by the dashboard importer.',
    '',
    'Safety rules:',
    '- Do not invent market size, growth rate, consumption, pricing, supplier score, market share, IRR, NPV, payback, formula, CAS list, or regulatory status.',
    '- Do not treat paid reports, public listings, or unsourced snippets as verified facts.',
    '- Do not expose formulas, raw material ratios, supplier confidential pricing, investor terms, product-development secrets, API keys, or system secrets.',
    '- Do not silently approve investor material.',
    '- Unsupported, weak-source, conflicting, sensitive, financial, supplier-price, regulatory, market-share, and investor-impact findings must be review-ready, not automatically approved.',
  ].join('\n')
}

export function isFullDashboardAutopilotJobRecord(job: CronJobRecord | null | undefined): boolean {
  if (!job) return false
  const text = [
    job.name,
    job.prompt,
    job.prompt_preview,
  ].map(stringValue).join('\n').toLowerCase()
  return text.includes(FULL_DASHBOARD_AUTOPILOT_JOB_NAME.toLowerCase()) ||
    (text.includes('dashboard_updates') && text.includes('trusted-source') && text.includes('full dashboard'))
}

function isDashboardAutopilotOutputJobRecord(job: CronJobRecord | null | undefined): boolean {
  return isFullDashboardAutopilotJobRecord(job) || isMissingCoverageFollowUpJobRecord(job)
}

function autopilotScheduleText(job: CronJobRecord): string {
  const schedule = isPlainRecord((job as any).schedule) ? (job as any).schedule : null
  return [
    (schedule as any)?.expr,
    (schedule as any)?.display,
    (job as any).schedule_display,
  ].map(stringValue).join('\n')
}

function autopilotJobNeedsRepair(job: CronJobRecord): boolean {
  const prompt = stringValue(job.prompt)
  if (!prompt.includes(FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION)) return true
  const schedule = autopilotScheduleText(job)
  return Boolean(schedule && !schedule.includes(FULL_DASHBOARD_AUTOPILOT_SCHEDULE) && !schedule.includes('07:00 / 19:00'))
}

function normalizeJobsPayload(payload: unknown): CronJobRecord[] {
  if (Array.isArray(payload)) return payload.filter(isPlainRecord)
  if (isPlainRecord(payload) && Array.isArray(payload.jobs)) return payload.jobs.filter(isPlainRecord)
  return []
}

async function readCronJobs(profile: string): Promise<CronJobRecord[]> {
  const jobsFile = join(getProfileDir(profile), 'cron', 'jobs.json')
  if (!existsSync(jobsFile)) return []
  try {
    const raw = await readFile(jobsFile, 'utf-8')
    return normalizeJobsPayload(JSON.parse(raw))
  } catch (err) {
    logger.warn(err, '[dashboard-autopilot] failed to read cron jobs')
    return []
  }
}

function findCreatedJob(beforeJobs: CronJobRecord[], afterJobs: CronJobRecord[]): CronJobRecord | null {
  const beforeIds = new Set(beforeJobs.map(getJobId).filter(Boolean))
  return afterJobs.find(job => isFullDashboardAutopilotJobRecord(job) && !beforeIds.has(getJobId(job))) ||
    afterJobs.find(isFullDashboardAutopilotJobRecord) ||
    null
}

async function recordFullDashboardAutopilotResearchJob(profile: string, jobId: string): Promise<boolean> {
  if (!jobId) return false
  const envelope = await readDashboardIntelligenceState(profile)
  const state = normalizeState(envelope?.state)
  const existingIndex = state.researchJobs.findIndex(job =>
    firstString(job.scheduledJobId) === jobId ||
    firstString(job.title) === FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
  )
  const now = new Date().toISOString()
  const record = {
    id: existingIndex >= 0
      ? firstString(state.researchJobs[existingIndex].id) || stableId('research', FULL_DASHBOARD_AUTOPILOT_JOB_NAME, jobId)
      : stableId('research', FULL_DASHBOARD_AUTOPILOT_JOB_NAME, jobId),
    title: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
    question: 'Automatically research trusted online sources and existing Hermes evidence to refresh the full feasibility dashboard.',
    scope: 'Executive Overview, Market Intelligence, Competitor Intelligence, Investment Analysis, Raw Material Sourcing, Supplier Scorecards, Export Market Opportunity, Regulatory, Investor Readiness, and Presentation Builder.',
    expectedOutput: 'Source-backed dashboard update candidates, evidence gaps, suggested tasks, and review-ready investor material candidates.',
    sourceRequirements: 'Official-first trusted sources with source title plus URL/date, confidence, evidence status, and review gating for critical claims.',
    priority: 'high',
    schedulePreference: 'Custom',
    scheduledJobId: jobId,
    schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    context: 'Chemicon China Feasibility',
    status: 'Scheduled Hermes Job',
    createdAt: existingIndex >= 0 ? firstString(state.researchJobs[existingIndex].createdAt) || now : now,
  }

  if (existingIndex >= 0) {
    const current = state.researchJobs[existingIndex]
    const changed = firstString(current.scheduledJobId) !== jobId ||
      firstString(current.schedule) !== FULL_DASHBOARD_AUTOPILOT_SCHEDULE ||
      firstString(current.status) !== 'Scheduled Hermes Job'
    state.researchJobs = [
      ...state.researchJobs.slice(0, existingIndex),
      { ...current, ...record },
      ...state.researchJobs.slice(existingIndex + 1),
    ]
    if (!changed) return false
  } else {
    state.researchJobs = [record, ...state.researchJobs]
  }

  await writeDashboardIntelligenceState({
    profile,
    state,
    savedBy: {
      username: 'Full Dashboard Autopilot',
      role: 'system',
    },
  })
  return true
}

async function runHermesCron(profile: string, args: string[], timeoutMs: number): Promise<void> {
  const profileDir = getProfileDir(profile || 'default')
  try {
    await execFileAsync(getHermesBin(), args, {
      cwd: process.cwd(),
      env: { ...process.env, HERMES_HOME: profileDir },
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
  } catch (error: any) {
    const stderr = String(error?.stderr || '').trim()
    const stdout = String(error?.stdout || '').trim()
    throw new Error(stderr || stdout || error?.message || 'Hermes cron command failed')
  }
}

function coverageTextHasAlias(text: string, alias: string): boolean {
  if (!alias) return false
  if (alias.length <= 3) {
    return new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(text)
  }
  return text.includes(alias)
}

function coverageValueIsUsable(value: unknown): boolean {
  const text = firstString(value)
  if (!text) return false
  if (PLACEHOLDER_PATTERN.test(text)) return false
  if (/no source-backed|source search running|auto-checking|review required|restricted/i.test(text)) return false
  return true
}

function sourceFromRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  const source = record.source
  return isPlainRecord(source) ? source : null
}

function recordMatchesCompanyTarget(record: Record<string, unknown>, target: CoverageTarget): boolean {
  const text = normalizeCoverageAlias([
    firstString(record.companyName),
    firstString(record.title),
    firstString(record.label),
    firstString(record.productEquivalent),
    firstString(record.notes),
  ].join(' '))
  const aliases = target.companyAliases?.length ? target.companyAliases : target.aliases
  return aliases.some(alias => coverageTextHasAlias(text, alias))
}

function dashboardTargetMatchesCompanyTarget(targetRecord: Record<string, unknown>, target: CoverageTarget): boolean {
  const text = normalizeCoverageAlias([
    firstString(targetRecord.companyName),
    firstString(targetRecord.title),
    firstString(targetRecord.label),
    firstString(targetRecord.productEquivalent),
    firstString(targetRecord.field),
    firstString(targetRecord.proposedDashboardField),
  ].join(' '))
  const aliases = target.companyAliases?.length ? target.companyAliases : target.aliases
  return aliases.some(alias => coverageTextHasAlias(text, alias))
}

function competitorMetricValue(record: Record<string, unknown>, field: CompetitorMetricField): unknown {
  if (field === 'lastUpdated') {
    return firstString(record.lastUpdated, record.updatedAt, (sourceFromRecord(record) || {}).date)
  }
  return record[field]
}

function competitorMetricCandidateHasStrongCoverageEvidence(
  finding: Record<string, unknown>,
  dashboardTarget: Record<string, unknown>,
): boolean {
  const tier = firstString(finding.sourceTier, dashboardTarget.sourceTier, finding.reportedSourceTier, dashboardTarget.reportedSourceTier).toLowerCase()
  if (!tier) return false
  if (/tier4|tier 4|tier5|tier 5|candidate|public listing|market reference|weak/i.test(tier)) return false
  if (!/(tier1|tier 1|tier2|tier 2|tier3|tier 3|official|supplier evidence|company official)/i.test(tier)) return false
  return coerceConfidence(firstString(finding.confidence, dashboardTarget.confidence)) !== 'low'
}

function competitorMetricCovered(state: DashboardIntelligenceState, target: CoverageTarget): boolean {
  if (!target.metric) return false
  return state.competitors.some(record =>
    recordMatchesCompanyTarget(record, target) &&
    sourceIsUsable(sourceFromRecord(record)) &&
    coverageValueIsUsable(competitorMetricValue(record, target.metric!)),
  ) || state.researchFindings.some(finding => {
    const dashboardTarget = finding.dashboardTarget
    if (!isPlainRecord(dashboardTarget)) return false
    if (firstString(dashboardTarget.group, dashboardTarget.dashboardGroup) !== 'competitorRecords') return false
    return dashboardTargetMatchesCompanyTarget(dashboardTarget, target) &&
      sourceIsUsable(sourceFromRecord(finding)) &&
      competitorMetricCandidateHasStrongCoverageEvidence(finding, dashboardTarget) &&
      coverageValueIsUsable(competitorMetricValue(dashboardTarget, target.metric!))
  })
}

function coverageTargetSatisfied(
  state: DashboardIntelligenceState,
  row: CoverageRequirement,
  target: CoverageTarget,
  text: string,
): boolean {
  if (row.textScope === 'competitor' && target.metric) {
    return competitorMetricCovered(state, target)
  }
  return target.aliases.some(alias => coverageTextHasAlias(text, alias))
}

function coverageTextForScope(state: DashboardIntelligenceState, scope: CoverageRequirement['textScope']): string {
  const marketParts = [
    ...state.marketClaims.map(item => `${firstString(item.label)} ${firstString(item.value)} ${firstString(item.evidenceStatus)} ${firstString((item.source as Record<string, unknown> | undefined)?.title)}`),
    ...state.dataRoomSources
      .filter(item => firstString(item.area) === 'market' || firstString(item.dashboardGroup) === 'rawMaterialSignals')
      .map(item => `${firstString(item.checklistLabel)} ${firstString(item.proposedValue)} ${firstString(item.notes)} ${firstString((item.source as Record<string, unknown> | undefined)?.title)}`),
    ...state.researchFindings
      .filter(item => firstString(item.area) === 'market' || firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).group) === 'marketClaims')
      .map(item => `${firstString(item.keyClaim)} ${firstString(item.summary)} ${firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).proposedDashboardField)}`),
  ]
  const competitorParts = [
    ...state.competitors.map(item => `${firstString(item.companyName)} ${firstString(item.countryRegion)} ${firstString(item.productEquivalent)} ${firstString(item.notes)} ${firstString((item.source as Record<string, unknown> | undefined)?.title)}`),
    ...state.researchFindings
      .filter(item => firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).group) === 'competitorRecords')
      .map(item => `${firstString(item.keyClaim)} ${firstString(item.summary)} ${firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).companyName)} ${firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).productEquivalent)}`),
  ]
  const supplierParts = [
    ...state.dataRoomSources
      .filter(item => firstString(item.area) === 'factory' || firstString(item.dashboardGroup) === 'supplierScorecards' || firstString(item.dashboardGroup) === 'rawMaterialSignals')
      .map(item => `${firstString(item.checklistLabel)} ${firstString(item.supplier)} ${firstString(item.material)} ${firstString(item.proposedValue)} ${firstString(item.notes)} ${firstString((item.source as Record<string, unknown> | undefined)?.title)}`),
    ...state.researchFindings
      .filter(item => {
        const group = firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).group)
        return group === 'supplierScorecards' || group === 'rawMaterialSignals'
      })
      .map(item => `${firstString(item.keyClaim)} ${firstString(item.summary)} ${firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).supplier)} ${firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).material)}`),
  ]
  const regulatoryParts = [
    ...state.dataRoomSources
      .filter(item => firstString(item.area) === 'regulatory' || firstString(item.dashboardGroup) === 'regulatoryFindings')
      .map(item => `${firstString(item.checklistLabel)} ${firstString(item.proposedValue)} ${firstString(item.notes)} ${firstString((item.source as Record<string, unknown> | undefined)?.title)}`),
    ...state.researchFindings
      .filter(item => firstString(item.area) === 'regulatory' || firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).group) === 'regulatoryFindings')
      .map(item => `${firstString(item.keyClaim)} ${firstString(item.summary)} ${firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).proposedDashboardField)}`),
  ]
  const financialParts = [
    ...state.financialModels.map(item => `${firstString(item.scenarioName)} ${firstString(item.projectName)} IRR NPV payback ROI capex working capital ${Array.isArray(item.warnings) ? item.warnings.join(' ') : ''}`),
    ...state.dataRoomSources
      .filter(item => firstString(item.area) === 'financial' || firstString(item.dashboardGroup) === 'financialEvidence')
      .map(item => `${firstString(item.checklistLabel)} ${firstString(item.proposedValue)} ${firstString(item.notes)} ${firstString((item.source as Record<string, unknown> | undefined)?.title)}`),
    ...state.researchFindings
      .filter(item => firstString(item.area) === 'financial' || firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).group) === 'financialEvidence')
      .map(item => `${firstString(item.keyClaim)} ${firstString(item.summary)} ${firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).proposedDashboardField)}`),
  ]
  const investorParts = [
    ...state.presentationMaterials.map(item => `${firstString(item.section)} ${firstString(item.content)} ${firstString(item.evidenceStatus)}`),
    ...state.researchFindings
      .filter(item => firstString(item.area) === 'presentation' || firstString(item.dashboardTarget && (item.dashboardTarget as Record<string, unknown>).group) === 'investorMaterialCandidates')
      .map(item => `${firstString(item.keyClaim)} ${firstString(item.summary)} ${firstString(item.suggestedInvestorMaterial)}`),
    ...state.dataRoomSources.map(item => `${firstString(item.checklistLabel)} ${firstString(item.area)} ${firstString(item.evidenceStatus)}`),
  ]

  const byScope: Record<CoverageRequirement['textScope'], string[]> = {
    market: marketParts,
    competitor: competitorParts,
    supplier: supplierParts,
    regulatory: regulatoryParts,
    financial: financialParts,
    investor: investorParts,
  }
  return normalizeCoverageAlias(byScope[scope].join(' '))
}

function competitorMetricCoverageTargetsForState(state: DashboardIntelligenceState): CoverageTarget[] {
  const companyTargets = new Map<string, CoverageTarget>()
  for (const target of COMPETITOR_COMPANY_TARGETS) {
    companyTargets.set(target.label, target)
  }
  for (const competitor of state.competitors) {
    const companyName = firstString(competitor.companyName)
    if (!companyName) continue
    const key = normalizeCoverageAlias(companyName)
    if (!companyTargets.has(companyName)) {
      companyTargets.set(companyName, target(companyName, key, ...key.split(' ').filter(Boolean)))
    }
  }
  return Array.from(companyTargets.values()).flatMap(companyTarget =>
    COMPETITOR_METRIC_REQUIREMENTS.map(metric => ({
      label: `${companyTarget.label} - ${metric.label}`,
      aliases: metric.aliases.map(normalizeCoverageAlias),
      metric: metric.field,
      companyAliases: companyTarget.aliases,
    })),
  )
}

function missingCoverageRowsForState(state: DashboardIntelligenceState): Array<CoverageRequirement & { missingTargets: CoverageTarget[] }> {
  const staticRows = coverageRequirements
    .map(row => {
      const text = coverageTextForScope(state, row.textScope)
      const missingTargets = row.targets.filter(item => !coverageTargetSatisfied(state, row, item, text))
      return { ...row, missingTargets }
    })
    .filter(row => row.missingTargets.length > 0)
  const competitorMetricTargets = competitorMetricCoverageTargetsForState(state)
  if (competitorMetricTargets.length === 0) return staticRows
  const competitorMetricRow: CoverageRequirement & { missingTargets: CoverageTarget[] } = {
    area: 'Competitor Metric Columns',
    textScope: 'competitor',
    targets: competitorMetricTargets,
    missingTargets: competitorMetricTargets.filter(item =>
      !coverageTargetSatisfied(state, { area: 'Competitor Metric Columns', textScope: 'competitor', targets: competitorMetricTargets }, item, ''),
    ),
  }
  return competitorMetricRow.missingTargets.length > 0
    ? [...staticRows, competitorMetricRow]
    : staticRows
}

function dashboardHasImportedIntelligence(state: DashboardIntelligenceState): boolean {
  return state.marketClaims.length > 0 ||
    state.competitors.length > 0 ||
    state.dataRoomSources.length > 0 ||
    state.researchFindings.length > 0 ||
    state.financialModels.length > 0 ||
    state.presentationMaterials.length > 0
}

function hasFullDashboardAutopilotResearchRecord(state: DashboardIntelligenceState): boolean {
  return state.researchJobs.some(job =>
    firstString(job.title) === FULL_DASHBOARD_AUTOPILOT_JOB_NAME ||
    firstString(job.question).toLowerCase().includes('refresh the full feasibility dashboard'),
  )
}

function missingCoverageScope(rows: Array<CoverageRequirement & { missingTargets: CoverageTarget[] }>): string {
  return rows
    .map(row => `${row.area}: ${row.missingTargets.map(item => item.label).join(', ')}`)
    .join('\n')
}

function missingCoverageSignature(scope: string): string {
  return stableId('missing-coverage', scope)
}

function missingCoveragePrompt(rows: Array<CoverageRequirement & { missingTargets: CoverageTarget[] }>, signature: string): string {
  const missingTargets = missingCoverageScope(rows) || 'None'
  return [
    'You are Hermes Full Dashboard Missing Coverage Research.',
    'Do the online research yourself using trusted and verified sources. Do not ask the user to manually search, copy, or paste data.',
    `Missing coverage signature: ${signature}`,
    '',
    'Objective:',
    'Fill the missing dashboard coverage targets below with source-backed evidence candidates for the Hermes dashboard.',
    '',
    'Missing targets:',
    missingTargets,
    '',
    'Competitor metric instructions:',
    '- For each "Company - Price evidence" target, search official price lists, distributor quote evidence, uploaded supplier evidence, or reputable price references. Public marketplace listings are weak and must be reviewRequired.',
    '- For each "Company - Market share" target, return a value only when the source explicitly states the market, geography, year, and share basis. Otherwise return an evidenceGaps item for that exact company/field.',
    '- For each "Company - Revenue" and "Company - YoY growth" target, prefer official annual reports, filings, investor-relations pages, stock-exchange filings, or audited financial statements. Label diversified company-wide revenue clearly; do not pretend it is product-line revenue.',
    '- For each "Company - Traffic" target, use a cited traffic/analytics source only when available and keep it reviewRequired. Do not estimate traffic from memory.',
    '- For each "Company - Rating" target, use a cited review/rating source for the exact company/product only when available and keep it reviewRequired if weak.',
    '- For each "Company - Last updated / source date" target, include lastChecked and sourceDate from the evidence source or access date.',
    '- Use one competitorRecords item per company when possible; put product-wise variations in productEquivalent and metric fields rather than duplicating the same company name.',
    '- Keep companyName clean. Never put words such as Metrics, Market, Share, Price, Traffic, Rating, Revenue, Growth, or Last Updated inside companyName.',
    '- Prefer flat metric fieldKey values exactly like competitor_metrics.dow.market_share, competitor_metrics.basf.revenue, competitor_metrics.stepan_company.traffic, and competitor_metrics.syensqo_solvay.rating.',
    '- If you use a flat metric fieldKey, the metric word belongs in fieldKey/proposedDashboardField only; companyName must remain the real company name.',
    '- If a metric cannot be sourced, return evidenceGaps and suggestedTasks with proposedDashboardField like "Archroma - Market share" instead of leaving the field vague.',
    '',
    'Dashboard areas to update when evidence exists:',
    '- Executive Overview',
    '- Market Intelligence',
    '- Competitor Intelligence',
    '- Investment Analysis / IRR',
    '- Raw Material Sourcing / Supplier Scorecards',
    '- Export Market Opportunity',
    '- Regulatory / Data Room',
    '- Investor Readiness',
    '- Presentation Builder',
    '',
    'Source priority:',
    '1. Government, regulator, customs, statistical, trade, and official standards sources.',
    '2. Official company, product, catalog, SDS, TDS, annual report, or investor-relations sources.',
    '3. Uploaded supplier evidence such as quote, SDS, TDS, COA, invoice, or internal file reference.',
    '4. Paid or reputable market references, labeled as market reference and usually review-gated.',
    '5. Public listings or marketplaces only as weak references, never as verified facts.',
    '',
    'Safety rules:',
    '- No fake values and no unsupported claims.',
    '- Missing values stay Missing or To Verify.',
    '- Market size, CAGR, consumption growth, competitor share, supplier prices, financial outputs, regulatory status, and investor claims must be staged for owner review unless evidence is strong and official.',
    '- Formula, cost-sensitive, product-development, supplier-price, and investor-sensitive details must remain protected.',
    '- Financial outputs remain Derived from Assumptions unless tied to approved inputs.',
    '',
    'Return only structured dashboard_updates JSON compatible with the Full Dashboard Autopilot importer.',
    'Each candidate must include fieldKey, value, sourceTitle, sourceUrl, sourceTier, lastChecked, confidence, evidenceStatus, reviewRequired, and riskReason.',
    'Competitor records must include companyName, productEquivalent, pricingEvidence, marketShare, revenue, yearlyGrowth, traffic, rating, lastChecked, sourceTitle, sourceUrl, confidence, evidenceStatus, reviewRequired, and recommendedAction where available.',
    'For competitor metrics, companyName must be the actual company only; do not return companyName values such as "Metrics Dow Market" or "Evonik Market Share".',
  ].join('\n')
}

function isMissingCoverageFollowUpJobRecord(job: CronJobRecord | null | undefined, signature?: string): boolean {
  if (!job) return false
  const text = [
    job.name,
    job.prompt,
    job.prompt_preview,
  ].map(stringValue).join('\n')
  if (!text.includes(FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME)) return false
  return signature ? text.includes(signature) : true
}

function findCreatedMissingCoverageJob(beforeJobs: CronJobRecord[], afterJobs: CronJobRecord[], signature: string): CronJobRecord | null {
  const beforeIds = new Set(beforeJobs.map(getJobId).filter(Boolean))
  return afterJobs.find(job => isMissingCoverageFollowUpJobRecord(job, signature) && !beforeIds.has(getJobId(job))) ||
    afterJobs.find(job => isMissingCoverageFollowUpJobRecord(job, signature)) ||
    null
}

function recordMissingCoverageResearchJob(
  state: DashboardIntelligenceState,
  input: {
    jobId: string
    scope: string
    signature: string
    status: 'Scheduled Hermes Job' | 'Manual Research Job'
  },
): boolean {
  const existingIndex = state.researchJobs.findIndex(job =>
    firstString(job.title) === FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME &&
    firstString(job.sourceRequirements).includes(input.signature),
  )
  const now = new Date().toISOString()
  const record = {
    id: existingIndex >= 0
      ? firstString(state.researchJobs[existingIndex].id) || stableId('research', FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME, input.signature)
      : stableId('research', FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME, input.signature),
    title: FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
    question: 'Automatically research the missing trusted-source dashboard coverage targets.',
    scope: input.scope,
    expectedOutput: 'dashboard_updates JSON with source metadata for the Full Dashboard Autopilot importer.',
    sourceRequirements: [
      `Missing coverage signature: ${input.signature}`,
      'Official-first trusted sources; weak, sensitive, conflicting, financial, market-share, supplier-price, regulatory, and investor-impact findings stay review-gated.',
    ].join('\n'),
    priority: 'high',
    schedulePreference: 'Custom',
    scheduledJobId: input.jobId,
    schedule: 'Immediate one-time follow-up from Trusted Sources coverage audit',
    context: 'Full Dashboard Trusted Source Autopilot',
    status: input.status,
    createdAt: existingIndex >= 0 ? firstString(state.researchJobs[existingIndex].createdAt) || now : now,
  }

  if (existingIndex >= 0) {
    state.researchJobs = [
      ...state.researchJobs.slice(0, existingIndex),
      { ...state.researchJobs[existingIndex], ...record },
      ...state.researchJobs.slice(existingIndex + 1),
    ]
    return false
  }

  state.researchJobs = [record, ...state.researchJobs]
  return true
}

async function ensureMissingCoverageFollowUp(profile: string, state: DashboardIntelligenceState): Promise<boolean> {
  if (!dashboardHasImportedIntelligence(state)) return false
  if (!hasFullDashboardAutopilotResearchRecord(state)) return false

  const missingRows = missingCoverageRowsForState(state)
  if (missingRows.length === 0) return false

  const scope = missingCoverageScope(missingRows)
  const signature = missingCoverageSignature(scope)
  if (state.researchJobs.some(job =>
    firstString(job.title) === FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME &&
    firstString(job.sourceRequirements).includes(signature),
  )) return false

  const beforeJobs = await readCronJobs(profile)
  const existing = beforeJobs.find(job => isMissingCoverageFollowUpJobRecord(job, signature))
  let jobId = existing ? getJobId(existing) : ''

  if (!jobId) {
    await runHermesCron(profile, [
      'cron',
      'create',
      '--name',
      FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
      '--deliver',
      'local',
      '--repeat',
      '1',
      FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      missingCoveragePrompt(missingRows, signature),
    ], CREATE_TIMEOUT_MS)
    const createdJob = findCreatedMissingCoverageJob(beforeJobs, await readCronJobs(profile), signature)
    jobId = createdJob ? getJobId(createdJob) : ''
  }

  if (!jobId) {
    return recordMissingCoverageResearchJob(state, {
      jobId: '',
      scope,
      signature,
      status: 'Manual Research Job',
    })
  }

  await runHermesCron(profile, ['cron', 'run', jobId], RUN_TIMEOUT_MS)
  return recordMissingCoverageResearchJob(state, {
    jobId,
    scope,
    signature,
    status: 'Scheduled Hermes Job',
  })
}

export async function ensureFullDashboardAutopilotScheduled(
  profileInput?: string,
  options: ScheduleOptions = {},
): Promise<FullDashboardAutopilotScheduleResult> {
  const profile = profileInput || getActiveProfileName() || 'default'
  const beforeJobs = await readCronJobs(profile)
  const existing = beforeJobs.find(isFullDashboardAutopilotJobRecord)
  const existingJobId = existing ? getJobId(existing) : ''
  if (existing && existingJobId) {
    let repaired = false
    let firstRunStarted = false
    let firstRunError = ''
    if (autopilotJobNeedsRepair(existing)) {
      try {
        await runHermesCron(profile, [
          'cron',
          'edit',
          existingJobId,
          '--name',
          FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
          '--schedule',
          FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
          '--deliver',
          'local',
          '--prompt',
          fullDashboardAutopilotPrompt(),
        ], CREATE_TIMEOUT_MS)
        repaired = true
      } catch (err) {
        firstRunError = err instanceof Error ? err.message : 'Hermes cron edit failed'
        logger.warn({ err, profile, jobId: existingJobId }, '[dashboard-autopilot] existing trusted-source job could not be repaired')
      }
    }
    if (options.startFirstRun && repaired && !firstRunError) {
      try {
        const defaultModel = await ensureDefaultModelForAutopilot(profile)
        if (defaultModel.configured) {
          logger.info({
            profile,
            model: defaultModel.model,
            provider: defaultModel.provider || undefined,
          }, '[dashboard-autopilot] configured default model before repaired trusted-source run')
        }
        await runHermesCron(profile, ['cron', 'run', existingJobId], RUN_TIMEOUT_MS)
        firstRunStarted = true
        await ingestFullDashboardAutopilotOutputs(profile, { jobId: existingJobId, maxFilesPerJob: 5 })
      } catch (err) {
        firstRunError = err instanceof Error ? err.message : 'Hermes cron run failed'
        logger.warn({ err, profile, jobId: existingJobId }, '[dashboard-autopilot] repaired trusted-source job could not start')
      }
    }
    const recordedResearchJob = await recordFullDashboardAutopilotResearchJob(profile, existingJobId)
    return {
      profile,
      jobId: existingJobId,
      created: false,
      repaired,
      recordedResearchJob,
      firstRunStarted,
      firstRunError,
    }
  }

  await runHermesCron(profile, [
    'cron',
    'create',
    '--name',
    FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
    '--deliver',
    'local',
    FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    fullDashboardAutopilotPrompt(),
  ], CREATE_TIMEOUT_MS)

  const createdJob = findCreatedJob(beforeJobs, await readCronJobs(profile))
  const jobId = createdJob ? getJobId(createdJob) : ''
  const recordedResearchJob = jobId ? await recordFullDashboardAutopilotResearchJob(profile, jobId) : false
  let firstRunStarted = false
  let firstRunError = ''

  if (options.startFirstRun && jobId) {
    try {
      const defaultModel = await ensureDefaultModelForAutopilot(profile)
      if (defaultModel.configured) {
        logger.info({
          profile,
          model: defaultModel.model,
          provider: defaultModel.provider || undefined,
        }, '[dashboard-autopilot] configured default model before first trusted-source run')
      }
      await runHermesCron(profile, ['cron', 'run', jobId], RUN_TIMEOUT_MS)
      firstRunStarted = true
      await ingestFullDashboardAutopilotOutputs(profile, { jobId, maxFilesPerJob: 5 })
    } catch (err) {
      firstRunError = err instanceof Error ? err.message : 'Hermes cron run failed'
      logger.warn({ err, profile, jobId }, '[dashboard-autopilot] first trusted-source run could not start')
    }
  }

  return {
    profile,
    jobId: jobId || null,
    created: true,
    repaired: false,
    recordedResearchJob,
    firstRunStarted,
    firstRunError,
  }
}

async function listOutputFiles(profile: string, jobId: string, maxFiles: number): Promise<OutputFile[]> {
  const outputDir = join(getProfileDir(profile), 'cron', 'output', jobId)
  if (!existsSync(outputDir)) return []
  const files: OutputFile[] = []
  try {
    for (const fileName of await readdir(outputDir)) {
      if (!fileName.endsWith('.md') || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) continue
      const filePath = join(outputDir, fileName)
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) continue
      files.push({
        jobId,
        fileName,
        path: filePath,
        mtimeMs: fileStat.mtimeMs,
      })
    }
  } catch (err) {
    logger.warn({ err, jobId }, '[dashboard-autopilot] failed to list output files')
  }
  return files.sort((a, b) => b.fileName.localeCompare(a.fileName) || b.mtimeMs - a.mtimeMs).slice(0, maxFiles)
}

async function listCronOutputJobIds(profile: string): Promise<string[]> {
  const outputRoot = join(getProfileDir(profile), 'cron', 'output')
  if (!existsSync(outputRoot)) return []
  try {
    const entries = await readdir(outputRoot, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory() && !entry.name.includes('/') && !entry.name.includes('\\') && !entry.name.includes('..'))
      .map(entry => entry.name)
  } catch (err) {
    logger.warn({ err }, '[dashboard-autopilot] failed to list cron output job directories')
    return []
  }
}

async function outputFileLooksLikeDashboardAutopilot(output: OutputFile): Promise<boolean> {
  try {
    const content = await readFile(output.path, 'utf-8')
    const lower = content.slice(0, 80_000).toLowerCase()
    if (lower.includes(FULL_DASHBOARD_AUTOPILOT_JOB_NAME.toLowerCase())) return true
    if (lower.includes(FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME.toLowerCase())) return true
    return lower.includes('dashboard_updates') &&
      (lower.includes('full dashboard') || lower.includes('trusted-source') || lower.includes('missing coverage'))
  } catch (err) {
    logger.warn({ err, jobId: output.jobId, fileName: output.fileName }, '[dashboard-autopilot] failed to inspect cron output file')
    return false
  }
}

async function listDashboardAutopilotOutputFiles(
  profile: string,
  jobs: CronJobRecord[],
  maxFilesPerJob: number,
  options: Pick<IngestOptions, 'jobId'> = {},
): Promise<{ jobsChecked: number, outputFiles: OutputFile[] }> {
  const outputFiles: OutputFile[] = []
  const includedJobIds = new Set<string>()
  const seenRunKeys = new Set<string>()

  const addOutputs = (outputs: OutputFile[]) => {
    for (const output of outputs) {
      const runKey = `${output.jobId}/${output.fileName}`
      if (seenRunKeys.has(runKey)) continue
      seenRunKeys.add(runKey)
      outputFiles.push(output)
    }
  }

  for (const job of jobs) {
    const jobId = getJobId(job)
    if (!jobId) continue
    includedJobIds.add(jobId)
    addOutputs(await listOutputFiles(profile, jobId, maxFilesPerJob))
  }

  if (options.jobId && !includedJobIds.has(options.jobId)) {
    includedJobIds.add(options.jobId)
    addOutputs(await listOutputFiles(profile, options.jobId, maxFilesPerJob))
  }

  if (!options.jobId) {
    for (const jobId of await listCronOutputJobIds(profile)) {
      if (includedJobIds.has(jobId)) continue
      const candidateOutputs = await listOutputFiles(profile, jobId, maxFilesPerJob)
      const dashboardOutputs: OutputFile[] = []
      for (const output of candidateOutputs) {
        if (await outputFileLooksLikeDashboardAutopilot(output)) dashboardOutputs.push(output)
      }
      if (dashboardOutputs.length > 0) {
        includedJobIds.add(jobId)
        addOutputs(dashboardOutputs)
      }
    }
  }

  outputFiles.sort((a, b) => b.fileName.localeCompare(a.fileName) || b.mtimeMs - a.mtimeMs)
  return { jobsChecked: includedJobIds.size, outputFiles }
}

function registryPath(profile: string): string {
  return join(getProfileDir(profile), 'dashboard-intelligence', 'imported-runs.json')
}

async function readImportRegistry(profile: string): Promise<ImportRegistry> {
  try {
    const raw = await readFile(registryPath(profile), 'utf-8')
    const parsed = JSON.parse(raw)
    if (isPlainRecord(parsed) && Array.isArray(parsed.importedRunKeys)) {
      return {
        version: 1,
        importedRunKeys: parsed.importedRunKeys.map(stringValue).filter(Boolean),
        skippedRunKeys: Array.isArray(parsed.skippedRunKeys)
          ? parsed.skippedRunKeys.map(stringValue).filter(Boolean)
          : [],
        importerVersion: stringValue(parsed.importerVersion),
        updatedAt: stringValue(parsed.updatedAt) || new Date().toISOString(),
      }
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') logger.warn(err, '[dashboard-autopilot] failed to read import registry')
  }
  return { version: 1, importerVersion: '', importedRunKeys: [], skippedRunKeys: [], updatedAt: '' }
}

async function writeImportRegistry(profile: string, registry: ImportRegistry): Promise<void> {
  const filePath = registryPath(profile)
  const next: ImportRegistry = {
    version: 1,
    importerVersion: DASHBOARD_AUTOPILOT_IMPORTER_VERSION,
    importedRunKeys: registry.importedRunKeys.slice(-MAX_IMPORTED_RUN_KEYS),
    skippedRunKeys: registry.skippedRunKeys.slice(-MAX_IMPORTED_RUN_KEYS),
    updatedAt: new Date().toISOString(),
  }
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf-8')
  await rename(tempPath, filePath)
}

function dueRunRegistryPath(profile: string): string {
  return join(getProfileDir(profile), 'dashboard-intelligence', 'autopilot-due-runs.json')
}

async function readDueRunRegistry(profile: string): Promise<DueRunRegistry> {
  try {
    const raw = await readFile(dueRunRegistryPath(profile), 'utf-8')
    const parsed = JSON.parse(raw)
    if (isPlainRecord(parsed) && isPlainRecord(parsed.slots)) {
      return {
        version: 1,
        slots: Object.fromEntries(Object.entries(parsed.slots).filter(([, value]) => isPlainRecord(value))) as DueRunRegistry['slots'],
        updatedAt: stringValue(parsed.updatedAt) || new Date().toISOString(),
      }
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') logger.warn(err, '[dashboard-autopilot] failed to read due-run registry')
  }
  return { version: 1, slots: {}, updatedAt: '' }
}

async function writeDueRunRegistry(profile: string, registry: DueRunRegistry): Promise<void> {
  const filePath = dueRunRegistryPath(profile)
  const entries = Object.entries(registry.slots)
    .sort(([, a], [, b]) => stringValue(b.attemptedAt).localeCompare(stringValue(a.attemptedAt)))
    .slice(0, MAX_IMPORTED_RUN_KEYS)
  const next: DueRunRegistry = {
    version: 1,
    slots: Object.fromEntries(entries),
    updatedAt: new Date().toISOString(),
  }
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf-8')
  await rename(tempPath, filePath)
}

function latestReadyFullDashboardSlot(now: Date, graceMs: number): Date {
  const threshold = new Date(now.getTime() - graceMs)
  const seven = new Date(threshold)
  seven.setHours(7, 0, 0, 0)
  const nineteen = new Date(threshold)
  nineteen.setHours(19, 0, 0, 0)

  if (threshold.getTime() >= nineteen.getTime()) return nineteen
  if (threshold.getTime() >= seven.getTime()) return seven

  const previous = new Date(threshold)
  previous.setDate(previous.getDate() - 1)
  previous.setHours(19, 0, 0, 0)
  return previous
}

function outputSatisfiesDueSlot(output: OutputFile, dueSlotAt: Date): boolean {
  return output.mtimeMs >= dueSlotAt.getTime()
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

function dashboardGroupFromValue(value: unknown): DashboardResearchUpdateGroup | null {
  const text = stringValue(value)
  return (DASHBOARD_UPDATE_GROUPS as readonly string[]).includes(text) ? text as DashboardResearchUpdateGroup : null
}

const COMPETITOR_METRIC_FIELD_ALIASES: Record<string, CompetitorMetricField> = {
  price: 'pricingEvidence',
  pricing: 'pricingEvidence',
  priceevidence: 'pricingEvidence',
  pricingevidence: 'pricingEvidence',
  pricekg: 'pricingEvidence',
  priceperkg: 'pricingEvidence',
  marketshare: 'marketShare',
  share: 'marketShare',
  revenue: 'revenue',
  sales: 'revenue',
  turnover: 'revenue',
  yoygrowth: 'yearlyGrowth',
  yearlygrowth: 'yearlyGrowth',
  annualgrowth: 'yearlyGrowth',
  growth: 'yearlyGrowth',
  traffic: 'traffic',
  websitetraffic: 'traffic',
  monthlyvisits: 'traffic',
  rating: 'rating',
  reviewrating: 'rating',
  lastupdated: 'lastUpdated',
  lastchecked: 'lastUpdated',
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
  basf: 'BASF',
  basf_se: 'BASF',
}

const COMPETITOR_METRIC_LABEL: Record<CompetitorMetricField, string> = {
  pricingEvidence: 'Price evidence',
  marketShare: 'Market share',
  revenue: 'Revenue',
  yearlyGrowth: 'YoY growth',
  traffic: 'Traffic',
  rating: 'Rating',
  lastUpdated: 'Last updated',
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

const COMPANY_NAME_NOISE_TOKENS = new Set([
  'competitor',
  'competitors',
  'competitormetrics',
  'metric',
  'metrics',
])

function competitorMetricSuffix(parts: string[], start: number): {
  metricStart: number
  metricField: CompetitorMetricField
} | null {
  for (let index = start + 1; index < parts.length; index += 1) {
    const suffix = normalizeHeader(parts.slice(index).join(' '))
    const metricField = COMPETITOR_METRIC_FIELD_ALIASES[suffix]
    if (metricField) return { metricStart: index, metricField }
  }
  return null
}

function normalizeCompetitorCompanySlug(parts: string[]): string {
  const clean = [...parts]
  while (clean.length && COMPANY_NAME_NOISE_TOKENS.has(clean[0])) clean.shift()
  while (clean.length && COMPANY_NAME_NOISE_TOKENS.has(clean[clean.length - 1])) clean.pop()
  return clean.join('_')
}

function competitorCompanyNameFromSlug(slugValue: string): string {
  const normalized = normalizeHeader(slugValue).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  return KNOWN_COMPETITOR_NAME_BY_SLUG[slugValue] ||
    KNOWN_COMPETITOR_NAME_BY_SLUG[normalized] ||
    KNOWN_COMPETITOR_NAME_BY_SLUG[slugValue.replace(/(^metrics_|_metrics$)/g, '')] ||
    titleCaseSlug(slugValue)
}

function isNoisyCompetitorCompanyName(value: unknown): boolean {
  const text = firstString(value).toLowerCase()
  if (!text) return false
  return /^metrics?\b/.test(text) ||
    /\b(market share|price evidence|pricing evidence|yoy growth|yearly growth|website traffic|review rating|last updated|source date)\b/.test(text)
}

function competitorMetricFromFlatFieldKey(item: DashboardResearchUpdateItem): {
  companyName: string
  metricField: CompetitorMetricField
  label: string
} | null {
  const fieldKey = firstString(item.fieldKey, item.proposedDashboardField, item.field, item.label, item.title)
  if (!fieldKey) return null
  const normalized = fieldKey
    .toLowerCase()
    .replace(/competitor metric columns:\s*/i, 'competitor_metrics.')
    .replace(/\s+-\s+/g, '.')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/(^\.|\.$)/g, '')
  const parts = normalized.split('.').filter(Boolean)
  const metricIndex = parts.findIndex(part => part === 'competitor' || part === 'competitors' || part === 'competitormetrics' || part === 'competitor_metrics')
  let start = metricIndex >= 0 ? metricIndex + 1 : (parts[0] === 'competitor' || parts[0] === 'competitors' ? 1 : -1)
  if (start < 0 && (parts[0] === 'metrics' || parts[0] === 'metric')) start = 1
  if (parts[start] === 'metrics' || parts[start] === 'metric') start += 1
  if (start < 0 || start >= parts.length - 1) return null

  const suffix = competitorMetricSuffix(parts, start)
  if (!suffix) return null

  const companySlug = normalizeCompetitorCompanySlug(parts.slice(start, suffix.metricStart))
  if (!companySlug) return null
  const companyName = competitorCompanyNameFromSlug(companySlug)
  const label = `${companyName} - ${COMPETITOR_METRIC_LABEL[suffix.metricField]}`
  return { companyName, metricField: suffix.metricField, label }
}

function flatDashboardGroupForItem(item: DashboardResearchUpdateItem): DashboardResearchUpdateGroup {
  const explicit = dashboardGroupFromValue(item.dashboardGroup) || dashboardGroupFromValue(item.group)
  if (explicit) return explicit
  if (competitorMetricFromFlatFieldKey(item)) return 'competitorRecords'
  const text = [
    item.fieldKey,
    item.proposedDashboardField,
    item.field,
    item.label,
    item.title,
    item.section,
    item.companyName,
    item.supplier,
    item.material,
    item.value,
  ].map(stringValue).join(' ').toLowerCase()
  if (firstString(item.companyName, item.productEquivalent, item.marketShare, item.pricingEvidence, item.revenue, item.yearlyGrowth, item.traffic, item.rating)) return 'competitorRecords'
  if (/competitor|market share|traffic|rating|price evidence|yoy growth/.test(text)) return 'competitorRecords'
  if (/supplier|scorecard|raw material|quote|payment|quality|reliability|price\/t|price per ton/.test(text)) return 'supplierScorecards'
  if (/regulatory|cas|sds|tds|dms|iecs|echa|pubchem/.test(text)) return 'regulatoryFindings'
  if (/investment|financial|irr|npv|payback|roi|capex|working capital|profitability/.test(text)) return 'financialEvidence'
  if (/investor|presentation|slide|deck|brief/.test(text)) return 'investorMaterialCandidates'
  if (/evidence gap|missing proof|gap/.test(text)) return 'evidenceGaps'
  if (/task|action|next step|follow.?up/.test(text)) return 'suggestedTasks'
  return 'marketClaims'
}

function enrichFlatDashboardItem(item: DashboardResearchUpdateItem, group: DashboardResearchUpdateGroup): DashboardResearchUpdateItem {
  const next: DashboardResearchUpdateItem = { ...item }
  const metric = group === 'competitorRecords' ? competitorMetricFromFlatFieldKey(next) : null
  if (metric) {
    if (!firstString(next.companyName) || isNoisyCompetitorCompanyName(next.companyName)) {
      next.companyName = metric.companyName
    }
    next.field = firstString(next.field) || metric.label
    next.label = firstString(next.label) || metric.label
    next.title = firstString(next.title) || metric.label
    next.proposedDashboardField = firstString(next.proposedDashboardField) || metric.label
    if (!isPlainRecord(next[metric.metricField])) {
      next[metric.metricField] = {
        fieldKey: firstString(next.fieldKey, metric.label),
        value: firstString(next.value),
        sourceTitle: next.sourceTitle,
        sourceUrl: next.sourceUrl,
        sourceDate: next.sourceDate,
        sourceTier: next.sourceTier,
        lastChecked: next.lastChecked,
        confidence: next.confidence,
        evidenceStatus: next.evidenceStatus,
        reviewRequired: next.reviewRequired,
        riskReason: next.riskReason,
        dataType: next.dataType,
      }
    }
  }
  return next
}

function normalizeFlatDashboardArray(items: unknown[]): DashboardResearchUpdatesPayload {
  const payload: DashboardResearchUpdatesPayload = {}
  for (const rawItem of items) {
    if (!isPlainRecord(rawItem)) continue
    const item = rawItem as DashboardResearchUpdateItem
    const group = flatDashboardGroupForItem(item)
    payload[group] = [...(payload[group] || []), enrichFlatDashboardItem(item, group)]
  }
  return payload
}

function normalizeDashboardPayload(raw: Record<string, unknown>): DashboardResearchUpdatesPayload | null {
  const container = Array.isArray(raw.dashboard_updates)
    ? normalizeFlatDashboardArray(raw.dashboard_updates)
    : isPlainRecord(raw.dashboard_updates)
      ? raw.dashboard_updates
      : raw
  const payload: DashboardResearchUpdatesPayload = {}

  for (const group of DASHBOARD_UPDATE_GROUPS) {
    const value = container[group]
    if (!Array.isArray(value)) continue
    payload[group] = value.filter(isPlainRecord).map(item => ({ ...item }))
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
  const match = value.match(/\[([^\]]+)\]\(((?:https?|file):\/\/[^)\s]+)\)/i)
  if (!match) return null
  return {
    title: match[1].trim(),
    url: match[2].trim(),
  }
}

function normalizeCitationKey(value: string): string {
  return value.trim().replace(/^[\[(\s]+|[\])\s.:-]+$/g, '')
}

function citationKeysFromValue(value: string): string[] {
  const keys = new Set<string>()
  const bracketed = value.matchAll(/\[(\d{1,3})\]/g)
  for (const match of bracketed) keys.add(match[1])
  const bare = normalizeCitationKey(value)
  if (/^\d{1,3}$/.test(bare)) keys.add(bare)
  return [...keys]
}

function stripCitationMarkers(value: string): string {
  return value.replace(/\s*\[\d{1,3}\]/g, '').trim()
}

function parseCitationReferences(content: string): Map<string, { title: string, url: string, date?: string }> {
  const references = new Map<string, { title: string, url: string, date?: string }>()
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    const match = trimmed.match(/^(?:[-*]\s*)?(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+(.+?)$/)
    if (!match) continue
    const key = match[1] || match[2]
    const body = match[3].trim()
    const markdownLink = parseMarkdownLink(body)
    const urlMatch = body.match(/(?:https?|file):\/\/[^\s)\]]+/i)
    const url = markdownLink?.url || urlMatch?.[0]?.trim() || ''
    if (!url) continue
    const dateMatch = body.match(/\b(20\d{2}(?:-\d{2})?(?:-\d{2})?|accessed\s+[^|,;]+)/i)
    const withoutUrl = body
      .replace(/\[([^\]]+)\]\(((?:https?|file):\/\/[^)\s]+)\)/i, '$1')
      .replace(url, '')
      .replace(dateMatch?.[1] || '', '')
      .replace(/\s*[—–-]\s*$/, '')
      .trim()
    const title = markdownLink?.title || withoutUrl || `Source ${key}`
    references.set(key, { title, url, ...(dateMatch ? { date: dateMatch[1].trim() } : {}) })
  }
  return references
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

function markdownSourceFields(
  row: Record<string, string>,
  references: Map<string, { title: string, url: string, date?: string }> = new Map(),
): Pick<DashboardResearchUpdateItem, 'sourceTitle' | 'sourceUrl' | 'sourceDate'> {
  const explicitTitle = getCell(
    row,
    'source title',
    'source name',
    'source',
    'sources',
    'reference',
    'references',
    'citation',
    'citations',
    'evidence source',
    'verified source',
  )
  const explicitUrl = getCell(
    row,
    'source url',
    'source link',
    'url',
    'link',
    'reference url',
    'reference link',
    'citation url',
    'citation link',
    'evidence url',
    'evidence link',
  )
  const sourceDate = getCell(
    row,
    'source date',
    'date',
    'last checked',
    'checked',
    'publication date',
    'access date',
    'accessed',
    'retrieved',
  )
  const markdownLink = parseMarkdownLink(explicitTitle)
  const reference = citationKeysFromValue(`${explicitTitle} ${explicitUrl}`)
    .map(key => references.get(key))
    .find(Boolean)
  const explicitSourceUrl = citationKeysFromValue(explicitUrl).length > 0 ? '' : explicitUrl
  const sourceTitle = markdownLink?.title || reference?.title || (explicitTitle && /^https?:\/\//i.test(explicitTitle) ? 'Source link' : explicitTitle)
  const sourceUrl = explicitSourceUrl || markdownLink?.url || (/^(?:https?|file):\/\//i.test(explicitTitle) ? explicitTitle : '')
  return {
    sourceTitle: stripCitationMarkers(sourceTitle || ''),
    sourceUrl: sourceUrl || reference?.url || '',
    sourceDate: sourceDate || reference?.date || '',
  }
}

function markdownRowToDashboardItem(
  row: Record<string, string>,
  group: DashboardResearchUpdateGroup,
  references: Map<string, { title: string, url: string, date?: string }> = new Map(),
): DashboardResearchUpdateItem | null {
  const source = markdownSourceFields(row, references)
  if (!source.sourceTitle && !source.sourceUrl && !source.sourceDate) return null

  const field = getCell(row, 'field', 'metric', 'kpi', 'claim', 'indicator', 'segment', 'category', 'section', 'item')
  const title = getCell(row, 'title', 'question', 'finding')
  const label = getCell(row, 'label')
  const value = getCell(row, 'value', 'amount', 'size', 'growth', 'rate', 'status', 'target', 'scope', 'score')
  const notes = getCell(row, 'notes', 'note', 'strength', 'weakness', 'summary')
  const marketShare = getCell(row, 'market share', 'share')
  const pricingEvidence = getCell(row, 'pricing evidence', 'price', 'price/kg', 'price/t', 'cost')
  const revenue = getCell(row, 'revenue', 'annual revenue', 'sales', 'turnover')
  const yearlyGrowth = getCell(row, 'yearly growth', 'annual growth', 'growth yoy', 'yoy growth', 'growth rate')
  const traffic = getCell(row, 'traffic', 'website traffic', 'web traffic', 'monthly traffic', 'visits')
  const rating = getCell(row, 'rating', 'review rating', 'customer rating', 'reviews')
  const fallbackValue = value || marketShare || pricingEvidence || revenue || yearlyGrowth || traffic || rating || notes
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
    revenue,
    yearlyGrowth,
    traffic,
    rating,
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
    sourceTier: getCell(row, 'source tier', 'tier', 'source type', 'source class', 'tier label'),
    lastChecked: getCell(row, 'last checked', 'last updated', 'updated', 'checked', 'access date', 'accessed', 'retrieved'),
    confidence: getCell(row, 'confidence', 'confidence level', 'source confidence'),
    evidenceStatus: getCell(row, 'evidence status', 'status', 'evidence', 'verification status', 'claim status'),
    reviewRequired: /^(yes|true|required|review|needed)$/i.test(getCell(row, 'review required', 'review', 'needs review', 'review needed')),
    riskReason: getCell(row, 'risk reason', 'risk', 'risk note', 'why review', 'review reason'),
    dataType: getCell(row, 'data type', 'datatype', 'claim type', 'data category'),
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
  const references = parseCitationReferences(content)
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
      [
        'sourcetitle',
        'sourcename',
        'source',
        'sources',
        'reference',
        'references',
        'citation',
        'citations',
        'evidencesource',
        'verifiedsource',
        'sourceurl',
        'sourcelink',
        'url',
        'link',
        'referenceurl',
        'referencelink',
        'citationurl',
        'citationlink',
        'evidenceurl',
        'evidencelink',
        'sourcedate',
        'date',
        'lastchecked',
        'checked',
        'publicationdate',
        'accessdate',
        'accessed',
        'retrieved',
      ].includes(header),
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
      const item = markdownRowToDashboardItem(row, group, references)
      if (item) items.push(item)
    }
    if (items.length) payload[group] = [...(payload[group] || []), ...items]
    i = Math.max(i, rowIndex - 1)
  }

  return DASHBOARD_UPDATE_GROUPS.some(group => (payload[group]?.length || 0) > 0) ? payload : null
}

function parseDelimitedBulletRow(
  line: string,
  references: Map<string, { title: string, url: string, date?: string }> = new Map(),
): Record<string, string> | null {
  const cleaned = line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
  if (!cleaned.includes('|') || !/(source|reference|citation|evidence)/i.test(cleaned)) return null

  const row: Record<string, string> = {}
  for (const segment of cleaned.split('|')) {
    const match = segment.match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/)
    if (!match) continue
    const key = normalizeHeader(match[1])
    const value = match[2].trim()
    if (key && value) row[key] = value
  }

  const hasFieldish = Boolean(getCell(row, 'field', 'metric', 'kpi', 'claim', 'indicator', 'segment', 'category', 'section', 'item', 'company', 'competitor', 'manufacturer', 'supplier', 'material'))
  const hasValueish = Boolean(getCell(row, 'value', 'amount', 'size', 'growth', 'rate', 'status', 'target', 'scope', 'score', 'market share', 'share', 'pricing evidence', 'price', 'cost', 'revenue', 'annual revenue', 'yearly growth', 'annual growth', 'growth yoy', 'yoy growth', 'notes', 'summary'))
  const sourceFields = markdownSourceFields(row, references)
  const hasSource = Boolean(sourceFields.sourceTitle || sourceFields.sourceUrl || sourceFields.sourceDate)

  return hasFieldish && hasValueish && hasSource ? row : null
}

function extractDelimitedDashboardBullets(content: string): DashboardResearchUpdatesPayload | null {
  const lines = content.split(/\r?\n/)
  const references = parseCitationReferences(content)
  const payload: DashboardResearchUpdatesPayload = {}

  lines.forEach((line, index) => {
    if (!/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) return
    const row = parseDelimitedBulletRow(line, references)
    if (!row) return
    const context = sectionContextForLine(lines, index)
    const group = inferGroupFromMarkdownTable(Object.keys(row), context)
    const item = markdownRowToDashboardItem(row, group, references)
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
  for (const block of fencedBlocks.reverse()) {
    const candidate = block[1].trim()
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue
    const parsed = tryParseJsonObject(candidate)
    const payload = parsed ? normalizeDashboardPayload(parsed) : null
    if (payload) return payload
  }

  const rawDashboardObjects = [...trimmed.matchAll(/\{\s*["']dashboard_updates["']\s*:/gi)]
  for (const marker of rawDashboardObjects.reverse()) {
    const json = extractBalancedObjectAfter(trimmed, marker.index || 0)
    const parsed = json ? tryParseJsonObject(json) : null
    const payload = parsed ? normalizeDashboardPayload(parsed) : null
    if (payload) return payload
  }

  const markers = [...trimmed.matchAll(/["']?dashboard_updates["']?\s*[:=]/gi)]
  for (const marker of markers.reverse()) {
    const json = extractBalancedObjectAfter(trimmed, marker.index || 0)
    const parsed = json ? tryParseJsonObject(json) : null
    const payload = parsed ? normalizeDashboardPayload(parsed) : null
    if (payload) return payload
  }

  return extractMarkdownDashboardTables(trimmed) || extractDelimitedDashboardBullets(trimmed)
}

function normalizeSourceTier(value: unknown): SourceTier {
  const text = stringValue(value).toLowerCase()
  if (text.includes('tier1') || text.includes('tier 1') || text.includes('government') || text.includes('regulator') || text.includes('statistical') || text.includes('trade source')) return 'tier1-official'
  if (text.includes('tier2') || text.includes('tier 2') || text.includes('company') || text.includes('catalog') || text.includes('product source')) return 'tier2-company-official'
  if (text.includes('tier3') || text.includes('tier 3') || text.includes('supplier evidence') || text.includes('quote') || text.includes('sds') || text.includes('tds') || text.includes('coa') || text.includes('invoice')) return 'tier3-supplier-evidence'
  if (text.includes('tier4') || text.includes('tier 4') || text.includes('market reference') || text.includes('paid')) return 'tier4-market-reference'
  if (text.includes('tier5') || text.includes('tier 5') || text.includes('marketplace') || text.includes('public listing')) return 'tier5-public-listing'
  return 'candidate-source'
}

function sourceDomain(value: unknown): string {
  const text = stringValue(value)
  if (!text || !/^https?:\/\//i.test(text)) return ''
  try {
    return new URL(text).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function domainMatches(domain: string, allowed: string[]): boolean {
  return allowed.some(item => domain === item || domain.endsWith(`.${item}`))
}

function isGovernmentDomain(domain: string): boolean {
  return /(^|\.)gov(?:\.[a-z]{2,})?$/.test(domain) || domain.includes('.gov.')
}

function inferSourceTierFromDomain(item: DashboardResearchUpdateItem): SourceTier {
  const url = stringValue(item.sourceUrl)
  if (/^file:\/\//i.test(url)) return 'tier3-supplier-evidence'

  const domain = sourceDomain(url)
  if (!domain) return 'candidate-source'
  if (domainMatches(domain, WEAK_PUBLIC_LISTING_DOMAINS)) return 'tier5-public-listing'
  if (isGovernmentDomain(domain) || domainMatches(domain, OFFICIAL_SOURCE_DOMAINS)) return 'tier1-official'
  if (domainMatches(domain, COMPANY_OFFICIAL_SOURCE_DOMAINS)) return 'tier2-company-official'
  if (domainMatches(domain, MARKET_REFERENCE_SOURCE_DOMAINS)) return 'tier4-market-reference'
  return 'candidate-source'
}

function inferSourceTierFromText(item: DashboardResearchUpdateItem): SourceTier {
  const text = [
    item.sourceTitle,
    item.sourceName,
    item.sourceTier,
  ].map(stringValue).join(' ').toLowerCase()

  if (
    text.includes('supplier evidence') ||
    text.includes('supplier quote') ||
    text.includes('uploaded') ||
    text.includes('sds') ||
    text.includes('tds') ||
    text.includes('coa') ||
    text.includes('invoice')
  ) {
    return 'tier3-supplier-evidence'
  }

  if (
    text.includes('wits / world bank') ||
    text.includes('world bank') ||
    text.includes('un comtrade') ||
    text.includes('comtrade') ||
    text.includes('china customs') ||
    text.includes('national bureau of statistics') ||
    text.includes('echa') ||
    text.includes('pubchem') ||
    text.includes('oecd') ||
    text.includes('wto')
  ) {
    return 'tier1-official'
  }

  return 'candidate-source'
}

function normalizeSourceTierForItem(item: DashboardResearchUpdateItem): SourceTier {
  const explicit = normalizeSourceTier(item.sourceTier)
  const domainTier = inferSourceTierFromDomain(item)
  if (domainTier !== 'candidate-source') return domainTier

  if (sourceDomain(item.sourceUrl)) {
    if (explicit === 'tier5-public-listing') return explicit
    if (explicit === 'tier3-supplier-evidence') return explicit
    return 'candidate-source'
  }

  const textTier = inferSourceTierFromText(item)
  if (textTier !== 'candidate-source') return textTier
  return explicit
}

export function dashboardSourceTierRank(tier: SourceTier): number {
  if (tier === 'tier1-official') return 1
  if (tier === 'tier2-company-official') return 2
  if (tier === 'tier3-supplier-evidence') return 3
  if (tier === 'tier4-market-reference') return 4
  if (tier === 'tier5-public-listing') return 5
  return 6
}

function sourceTierDowngradeReason(item: DashboardResearchUpdateItem, effectiveTier: SourceTier): string {
  const explicit = normalizeSourceTier(item.sourceTier)
  if (explicit === 'candidate-source') return ''
  if (dashboardSourceTierRank(effectiveTier) <= dashboardSourceTierRank(explicit)) return ''
  if (sourceDomain(item.sourceUrl)) return 'source URL/domain policy downgraded the claimed source tier'
  return 'source policy downgraded the claimed source tier'
}

function coerceConfidence(value: unknown): Confidence {
  const text = stringValue(value).toLowerCase()
  return VALID_CONFIDENCE.has(text) ? text as Confidence : 'medium'
}

function coerceEvidenceStatus(value: unknown, fallback = 'To Verify'): string {
  const text = stringValue(value)
  return VALID_EVIDENCE_STATUSES.has(text) ? text : fallback
}

function trustedEvidenceStatus(value: unknown, fallback = 'To Verify'): string {
  const text = stringValue(value)
  if (/official.*(company|filing|annual|data|evidence)/i.test(text)) return 'Official Data'
  if (/source.?backed/i.test(text)) return 'Source-backed'
  if (/trusted.*auto/i.test(text)) return 'Trusted Source Auto-Updated'
  if (/supplier.*evidence/i.test(text)) return 'Supplier Evidence'
  return coerceEvidenceStatus(text, fallback)
}

function coerceDataType(value: unknown, fallback: string): string {
  const text = stringValue(value)
  return VALID_DATA_TYPES.has(text) ? text : fallback
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function sourceFromItem(item: DashboardResearchUpdateItem): Record<string, unknown> | null {
  const title = firstString(item.sourceTitle, item.sourceName)
  const url = firstString(item.sourceUrl)
  const date = firstString(item.sourceDate, item.lastChecked)
  if (!title && !url && !date) return null
  const source: Record<string, unknown> = { title: title || 'Source missing' }
  if (url) source.url = url
  if (date) source.date = date
  return source
}

function nestedMetricRecord(item: DashboardResearchUpdateItem, field: CompetitorMetricField): DashboardResearchUpdateItem | null {
  const value = item[field]
  return isPlainRecord(value) ? value as DashboardResearchUpdateItem : null
}

function competitorMetricText(item: DashboardResearchUpdateItem, field: CompetitorMetricField): string {
  const nested = nestedMetricRecord(item, field)
  return firstString(nested?.value, item[field])
}

function competitorMetricSource(
  item: DashboardResearchUpdateItem,
  field: CompetitorMetricField,
  fallback: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const nested = nestedMetricRecord(item, field)
  return nested ? sourceFromItem(nested) || fallback : fallback
}

function competitorMetricTier(item: DashboardResearchUpdateItem, field: CompetitorMetricField, fallback: SourceTier): SourceTier {
  const nested = nestedMetricRecord(item, field)
  return nested ? normalizeSourceTierForItem(nested) : fallback
}

function competitorMetricConfidence(item: DashboardResearchUpdateItem, field: CompetitorMetricField, fallback: Confidence): Confidence {
  const nested = nestedMetricRecord(item, field)
  return nested ? coerceConfidence(nested.confidence) : fallback
}

function competitorMetricEvidenceStatus(item: DashboardResearchUpdateItem, field: CompetitorMetricField, fallback: string): string {
  const nested = nestedMetricRecord(item, field)
  return nested ? trustedEvidenceStatus(nested.evidenceStatus, fallback) : trustedEvidenceStatus(fallback, fallback)
}

function competitorMetricReviewRequired(item: DashboardResearchUpdateItem, field: CompetitorMetricField, fallback: boolean): boolean {
  const nested = nestedMetricRecord(item, field)
  return typeof nested?.reviewRequired === 'boolean' ? nested.reviewRequired : fallback
}

function isUsefulDashboardValue(value: string): boolean {
  return Boolean(value && !PLACEHOLDER_PATTERN.test(value) && !hasKnownFakeScreenshotValue(value))
}

function isTrustedMetricEvidence(status: string): boolean {
  return AUTO_TRUSTED_STATUSES.has(status) || status === 'Official Company Evidence'
}

function shouldHydrateCompetitorMetric(input: {
  field: CompetitorMetricField
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
  confidence: Confidence
  evidenceStatus: string
  reviewRequired: boolean
  dataType: string
}): boolean {
  if (!isUsefulDashboardValue(input.value)) return false
  if (!sourceIsUsable(input.source)) return false
  if (!isTrustedMetricEvidence(input.evidenceStatus)) return false
  if (input.confidence !== 'high') return false
  if (input.tier === 'tier5-public-listing' || input.tier === 'candidate-source') return false

  if (input.field === 'pricingEvidence') {
    return input.reviewRequired === false && input.tier === 'tier3-supplier-evidence'
  }

  if (input.field === 'marketShare') {
    return input.reviewRequired === false && (input.tier === 'tier1-official' || input.tier === 'tier2-company-official')
  }

  if (input.field === 'traffic' || input.field === 'rating') {
    return input.reviewRequired === false && input.tier !== 'tier4-market-reference'
  }

  if (input.field === 'revenue' || input.field === 'yearlyGrowth' || input.field === 'lastUpdated') {
    return input.reviewRequired === false || input.tier === 'tier1-official' || input.tier === 'tier2-company-official'
  }

  return false
}

function sourceIsUsable(source: Record<string, unknown> | null): boolean {
  return Boolean(stringValue(source?.title) && (stringValue(source?.url) || stringValue(source?.date)))
}

function hasKnownFakeScreenshotValue(value: string): boolean {
  return SCREENSHOT_FAKE_VALUES.some(fakeValue => value.includes(fakeValue))
}

function fieldLabel(item: DashboardResearchUpdateItem, group: DashboardResearchUpdateGroup): string {
  return firstString(
    item.field,
    item.label,
    item.title,
    item.companyName,
    item.supplier,
    item.material,
    group,
  )
}

function dashboardFieldKey(item: DashboardResearchUpdateItem, group: DashboardResearchUpdateGroup, field: string): string {
  return firstString(item.fieldKey) || stableId('field', GROUP_SCREEN[group], field).replace(/^field-/, '')
}

function itemValueText(item: DashboardResearchUpdateItem): string {
  return firstString(
    item.value,
    item.content,
    item.marketShare,
    item.pricingEvidence,
    item.revenue,
    item.yearlyGrowth,
    item.traffic,
    item.rating,
    item.notes,
    item.recommendedAction,
  )
}

function riskReasons(input: {
  item: DashboardResearchUpdateItem
  group: DashboardResearchUpdateGroup
  field: string
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
  evidenceStatus: string
  dataType: string
  confidence: Confidence
}): string[] {
  const reasons: string[] = []
  const fieldAndValue = `${input.field} ${input.value}`
  const downgradeReason = sourceTierDowngradeReason(input.item, input.tier)
  if (!sourceIsUsable(input.source)) reasons.push('source title plus URL/date is missing')
  if (downgradeReason) reasons.push(downgradeReason)
  if (input.item.reviewRequired === true) reasons.push('Hermes marked this finding review-required')
  if (CRITICAL_GROUPS.has(input.group)) reasons.push('dashboard area is critical or sensitive')
  if (input.item.sensitive === true || SENSITIVE_DATA_TYPES.has(input.dataType)) reasons.push('sensitive price/cost/financial/regulatory data')
  if (CRITICAL_FIELD_PATTERN.test(fieldAndValue)) reasons.push('critical dashboard claim')
  if (PLACEHOLDER_PATTERN.test(input.value)) reasons.push('value is still Missing / To Verify / proxy')
  if (hasKnownFakeScreenshotValue(input.value)) reasons.push('matches old screenshot/template number and must be source-checked')
  if (!AUTO_TRUSTED_STATUSES.has(input.evidenceStatus)) reasons.push('evidence status is not trusted enough for auto-fill')
  if (input.confidence !== 'high') reasons.push('confidence is not high')
  if (input.tier === 'tier4-market-reference') reasons.push('market-reference sources need context review')
  if (input.tier === 'tier5-public-listing') reasons.push('public listings are weak references only')
  if (input.tier === 'candidate-source') reasons.push('candidate source is not trusted yet')
  return reasons
}

function areaForGroup(group: DashboardResearchUpdateGroup): string {
  if (group === 'financialEvidence') return 'financial'
  if (group === 'regulatoryFindings') return 'regulatory'
  if (group === 'competitorRecords' || group === 'marketClaims') return 'market'
  if (group === 'rawMaterialSignals' || group === 'supplierScorecards') return 'factory'
  if (group === 'investorMaterialCandidates') return 'presentation'
  return 'market'
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isPlainRecord) : []
}

function normalizeState(raw: Record<string, unknown> | null | undefined): DashboardIntelligenceState {
  return {
    evidenceItems: asArray(raw?.evidenceItems),
    marketClaims: asArray(raw?.marketClaims),
    competitors: compactCompetitorStateRecords(asArray(raw?.competitors)),
    presentationMaterials: asArray(raw?.presentationMaterials),
    researchJobs: asArray(raw?.researchJobs),
    researchFindings: asArray(raw?.researchFindings),
    financialModels: asArray(raw?.financialModels),
    dataRoomSources: asArray(raw?.dataRoomSources),
  }
}

function competitorCompanyMergeKey(value: unknown): string {
  const text = stringValue(value)
  if (!text) return ''
  const known = KNOWN_COMPETITOR_NAME_BY_SLUG[normalizeHeader(text)]
  const normalized = known || text
  return normalized
    .toLowerCase()
    .replace(/\b(group|company|chemicals?|chemical|industries|industry|co|corp|corporation|limited|ltd|inc|gmbh|ag|plc)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compactCompetitorStateRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const groups = new Map<string, Record<string, unknown>[]>()
  const passthrough: Record<string, unknown>[] = []
  for (const record of records) {
    const key = competitorCompanyMergeKey(record.companyName)
    if (!key) {
      passthrough.push(record)
      continue
    }
    groups.set(key, [...(groups.get(key) || []), record])
  }

  const compacted = Array.from(groups.values()).map(group => {
    if (group.length === 1) return group[0]
    const primary = group.find(record => sourceIsUsable(record.source as Record<string, unknown> | null)) || group[0]
    const productVariations = mergeUniqueStrings(group.flatMap(record => competitorProductVariationValues(record)))
    const sources = mergeCompetitorSources(...group)
    const merged: Record<string, unknown> = { ...primary }
    for (const record of group.slice(1)) {
      for (const field of ['countryRegion', 'activeContent', 'certifications', 'distributionPresence', 'pricingEvidence', 'marketShare', 'revenue', 'yearlyGrowth', 'traffic', 'rating', 'lastUpdated'] as const) {
        const current = stringValue(merged[field])
        const next = stringValue(record[field])
        if (!isUsefulDashboardValue(current) && isUsefulDashboardValue(next)) merged[field] = next
      }
      merged.evidenceStatus = strongestCompetitorEvidenceStatus(
        stringValue(merged.evidenceStatus),
        stringValue(record.evidenceStatus),
      )
      merged.confidence = strongestConfidence(
        stringValue(merged.confidence),
        stringValue(record.confidence),
      )
      merged.updatedAt = [stringValue(merged.updatedAt), stringValue(record.updatedAt)].filter(Boolean).sort().at(-1) || merged.updatedAt
    }
    if (productVariations.length > 0) {
      merged.productVariationList = productVariations
      merged.productVariations = productVariations.join(' / ')
      merged.productEquivalent = productVariations.join(' / ')
    }
    if (sources.length > 0) {
      merged.sources = sources
      merged.sourceCount = sources.length
      merged.source = sourceIsUsable(merged.source as Record<string, unknown> | null) ? merged.source : sources[0]
    }
    merged.id = group.map(record => stringValue(record.id)).filter(Boolean).join('__') || stringValue(primary.id) || stableId('competitor', stringValue(primary.companyName))
    return merged
  })

  return [...passthrough, ...compacted]
}

function stableId(prefix: string, ...values: string[]): string {
  const text = values.filter(Boolean).join('-') || `${Date.now()}`
  return `${prefix}-${slug(text).slice(0, 80)}`
}

function includesExisting(list: Record<string, unknown>[], predicate: (item: Record<string, unknown>) => boolean): boolean {
  return list.some(predicate)
}

function appendMarketClaim(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
    group: DashboardResearchUpdateGroup
    field: string
    value: string
    source: Record<string, unknown> | null
    confidence: Confidence
    evidenceStatus: string
    lastChecked: string
    runKey: string
    tier: SourceTier
    dataType: string
    reasons?: string[]
  },
): boolean {
  const label = firstString(input.item.label, input.item.field, input.item.title, input.field)
  if (!label || !input.value) return false
  if (includesExisting(state.marketClaims, claim =>
    stringValue(claim.label).toLowerCase() === label.toLowerCase() &&
    stringValue(claim.value) === input.value &&
    stringValue((claim.source as Record<string, unknown> | undefined)?.title) === stringValue(input.source?.title),
  )) return false

  state.marketClaims.push({
    id: stableId('autopilot-market', input.runKey, label, input.value),
    label,
    value: input.value,
    fieldKey: dashboardFieldKey(input.item, input.group, input.field),
    dashboardGroup: input.group,
    group: input.group,
    proposedDashboardField: firstString(input.item.proposedDashboardField, input.item.field, input.item.label, label, input.item.fieldKey),
    source: input.source,
    sourceTier: input.tier,
    reportedSourceTier: firstString(input.item.sourceTier) || undefined,
    dataType: input.dataType,
    confidence: input.confidence,
    evidenceStatus: input.evidenceStatus,
    reviewRequired: Boolean(input.reasons?.length || input.item.reviewRequired === true),
    reportedReviewRequired: typeof input.item.reviewRequired === 'boolean' ? input.item.reviewRequired : undefined,
    riskReason: firstString(input.item.riskReason) || (input.reasons?.join('; ') || undefined),
    lastChecked: input.lastChecked,
  })
  return true
}

function appendCompetitorRecord(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
    value: string
    source: Record<string, unknown> | null
    evidenceStatus: string
    lastChecked: string
    runKey: string
    tier: SourceTier
    dataType: string
    field: string
    reasons?: string[]
  },
): boolean {
  const companyName = firstString(input.item.companyName, input.item.title, input.item.label)
  if (!companyName) return false
  const topLevelReviewRequired = Boolean(input.reasons?.length || input.item.reviewRequired === true)
  const fallbackConfidence = coerceConfidence(input.item.confidence)
  const fallbackEvidenceStatus = trustedEvidenceStatus(input.evidenceStatus, input.evidenceStatus)
  const metricValues: Partial<Record<CompetitorMetricField, string>> = {}
  let primaryMetric: {
    source: Record<string, unknown> | null
    tier: SourceTier
    confidence: Confidence
    evidenceStatus: string
  } | null = null

  for (const field of COMPETITOR_SOURCE_BACKED_METRIC_FIELDS) {
    const value = competitorMetricText(input.item, field)
    const source = competitorMetricSource(input.item, field, input.source)
    const tier = competitorMetricTier(input.item, field, input.tier)
    const confidence = competitorMetricConfidence(input.item, field, fallbackConfidence)
    const evidenceStatus = competitorMetricEvidenceStatus(input.item, field, fallbackEvidenceStatus)
    const reviewRequired = competitorMetricReviewRequired(input.item, field, topLevelReviewRequired)
    const dataType = coerceDataType(nestedMetricRecord(input.item, field)?.dataType, input.dataType)
    if (!shouldHydrateCompetitorMetric({
      field,
      value,
      source,
      tier,
      confidence,
      evidenceStatus,
      reviewRequired,
      dataType,
    })) continue
    metricValues[field] = value
    if (!primaryMetric || field === 'revenue' || field === 'yearlyGrowth') {
      primaryMetric = { source, tier, confidence, evidenceStatus }
    }
  }

  const recordSource = primaryMetric?.source || input.source
  const recordTier = primaryMetric?.tier || input.tier
  const recordConfidence = primaryMetric?.confidence || fallbackConfidence
  const recordEvidenceStatus = primaryMetric?.evidenceStatus || fallbackEvidenceStatus
  const recordReviewRequired = primaryMetric ? false : topLevelReviewRequired
  const recordSources = recordSource ? [recordSource] : []
  const hasUsefulProductContext = isUsefulDashboardValue(firstString(
    input.item.productEquivalent,
    input.item.activeContent,
    input.item.distributionPresence,
    input.item.certifications,
  ))
  const canImportProductContext = sourceIsUsable(input.source) &&
    hasUsefulProductContext &&
    recordTier !== 'tier5-public-listing' &&
    recordTier !== 'candidate-source'
  if (!primaryMetric && topLevelReviewRequired && !canImportProductContext) return false
  const existingIndex = state.competitors.findIndex(competitor => {
    if (stringValue(competitor.companyName).toLowerCase() !== companyName.toLowerCase()) return false
    return true
  })
  const importedProductVariations = competitorProductVariationValues({
    productEquivalent: firstString(input.item.productEquivalent),
  })
  const importedRecord = {
    id: stableId('autopilot-competitor', input.runKey, companyName, stringValue(recordSource?.title)),
    companyName,
    fieldKey: dashboardFieldKey(input.item, 'competitorRecords', input.field),
    dashboardGroup: 'competitorRecords',
    group: 'competitorRecords',
    proposedDashboardField: firstString(input.item.proposedDashboardField, input.item.field, input.item.label, companyName, input.item.fieldKey),
    countryRegion: firstString(input.item.countryRegion) || 'To Verify',
    productEquivalent: firstString(input.item.productEquivalent) || 'To Verify',
    activeContent: firstString(input.item.activeContent) || 'To Verify',
    pricingEvidence: metricValues.pricingEvidence || '',
    certifications: firstString(input.item.certifications) || 'To Verify',
    distributionPresence: firstString(input.item.distributionPresence) || 'To Verify',
    marketShare: metricValues.marketShare || '',
    revenue: metricValues.revenue || '',
    yearlyGrowth: metricValues.yearlyGrowth || '',
    traffic: metricValues.traffic || '',
    rating: metricValues.rating || '',
    lastUpdated: metricValues.lastUpdated || firstString(input.item.lastChecked, input.item.sourceDate) || '',
    evidenceStatus: recordEvidenceStatus,
    source: recordSource,
    sources: recordSources,
    sourceCount: recordSources.length,
    sourceTier: recordTier,
    reportedSourceTier: firstString(input.item.sourceTier) || undefined,
    dataType: input.dataType,
    confidence: recordConfidence,
    reviewRequired: recordReviewRequired,
    reportedReviewRequired: typeof input.item.reviewRequired === 'boolean' ? input.item.reviewRequired : undefined,
    riskReason: firstString(input.item.riskReason) || (input.reasons?.join('; ') || undefined),
    notes: firstString(input.item.notes, input.item.recommendedAction, input.value) ||
      'Imported by Full Dashboard Autopilot from source-backed competitor evidence. Product-line revenue, pricing, market share, traffic, and ratings remain separate evidence-gated fields.',
    productVariationList: importedProductVariations,
    productVariations: importedProductVariations.join(' / '),
    updatedAt: input.lastChecked,
  }

  if (existingIndex >= 0) {
    const existing = state.competitors[existingIndex]
    const merged = { ...existing, ...importedRecord }
    for (const field of ['countryRegion', 'productEquivalent', 'activeContent', 'certifications', 'distributionPresence', 'pricingEvidence', 'marketShare', 'revenue', 'yearlyGrowth', 'traffic', 'rating', 'lastUpdated'] as const) {
      if (!isUsefulDashboardValue(stringValue(importedRecord[field])) && isUsefulDashboardValue(stringValue(existing[field]))) {
        ;(merged as Record<string, unknown>)[field] = existing[field]
      }
    }
    const productVariations = mergeUniqueStrings([
      ...competitorProductVariationValues(existing),
      ...competitorProductVariationValues(importedRecord),
    ])
    if (productVariations.length > 0) {
      merged.productVariationList = productVariations
      merged.productVariations = productVariations.join(' / ')
      merged.productEquivalent = productVariations.join(' / ')
    }
    const sources = mergeCompetitorSources(existing, importedRecord)
    if (sources.length > 0) {
      merged.sources = sources
      merged.sourceCount = sources.length
      merged.source = sourceIsUsable(merged.source as Record<string, unknown> | null)
        ? merged.source
        : sources[0]
    }
    merged.evidenceStatus = strongestCompetitorEvidenceStatus(
      stringValue(existing.evidenceStatus),
      stringValue(importedRecord.evidenceStatus),
    )
    merged.confidence = strongestConfidence(
      stringValue(existing.confidence),
      stringValue(importedRecord.confidence),
    )
    merged.reviewRequired = Boolean(existing.reviewRequired && importedRecord.reviewRequired)
    if (JSON.stringify(existing) === JSON.stringify(merged)) return false
    state.competitors[existingIndex] = merged
    return true
  }

  state.competitors.push(importedRecord)
  return true
}

function mergeUniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = stringValue(value)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function isUsefulCompetitorProductVariation(value: string): boolean {
  const text = stringValue(value)
  if (!isUsefulDashboardValue(text)) return false
  if (/company-wide financial context|not textile-softener product-line revenue|financial context/i.test(text)) return false
  if (/automated ssl verification failed|page access failed|certificate-chain issue blocked|url identified|candidate identified|category presence only/i.test(text)) return false
  return true
}

function competitorProductVariationValues(record: Record<string, unknown>): string[] {
  const values: string[] = []
  if (Array.isArray(record.productVariationList)) {
    values.push(...record.productVariationList.flatMap(splitCompetitorProductVariationText))
  }
  values.push(...splitCompetitorProductVariationText(record.productVariations))
  values.push(...splitCompetitorProductVariationText(record.productEquivalent))
  return mergeUniqueStrings(values.filter(isUsefulCompetitorProductVariation))
}

function splitCompetitorProductVariationText(value: unknown): string[] {
  return stringValue(value)
    .split(/\s+\/\s+|\s+;\s+|\n+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function mergeCompetitorSources(...records: Array<Record<string, unknown>>): Record<string, unknown>[] {
  const sources: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const candidates = [
      ...(Array.isArray(record.sources) ? record.sources.filter(isPlainRecord) : []),
      isPlainRecord(record.source) ? record.source : null,
    ].filter(isPlainRecord)
    for (const source of candidates) {
      if (!sourceIsUsable(source)) continue
      const key = [
        stringValue(source.title).toLowerCase(),
        stringValue(source.url).toLowerCase(),
        stringValue(source.date),
      ].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      sources.push(source)
    }
  }
  return sources
}

function strongestCompetitorEvidenceStatus(...statuses: string[]): string {
  const order = [
    'Verified',
    'User Approved',
    'Investor Approved',
    'Trusted Source Auto-Updated',
    'Official Data',
    'Official Company Evidence',
    'Source-backed',
    'Supplier Evidence',
    'Market Reference',
    'Trade Proxy',
    'Reference Only',
    'Candidate Source',
    'Assumption',
    'Powerful Assumption',
    'Hypothesis',
    'Conflict Detected',
    'To Verify',
    'Missing',
  ]
  return order.find(status => statuses.includes(status)) || statuses.find(Boolean) || 'To Verify'
}

function strongestConfidence(...values: string[]): Confidence {
  const order: Confidence[] = ['high', 'medium', 'low']
  const normalized = values.map(value => stringValue(value).toLowerCase()).filter(Boolean)
  return order.find(value => normalized.includes(value)) || 'medium'
}

function safeCandidateStatus(status: string): string {
  if (status === 'Verified' || status === 'Investor Approved') return 'To Verify'
  return coerceEvidenceStatus(status, 'To Verify')
}

function shouldShowMarketCandidate(input: {
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
  dataType: string
  item: DashboardResearchUpdateItem
}): boolean {
  if (!sourceIsUsable(input.source)) return false
  if (!input.value || PLACEHOLDER_PATTERN.test(input.value)) return false
  if (input.item.sensitive === true || SENSITIVE_DATA_TYPES.has(input.dataType)) return false
  if (input.tier === 'tier5-public-listing' || input.tier === 'candidate-source') return false
  return true
}

function shouldShowCompetitorCandidate(input: {
  item: DashboardResearchUpdateItem
  source: Record<string, unknown> | null
  tier: SourceTier
  dataType: string
}): boolean {
  if (!sourceIsUsable(input.source)) return false
  if (input.item.sensitive === true || SENSITIVE_DATA_TYPES.has(input.dataType)) return false
  if (input.tier === 'tier5-public-listing' || input.tier === 'candidate-source') return false
  const companyName = firstString(input.item.companyName, input.item.title, input.item.label)
  const productEquivalent = firstString(input.item.productEquivalent)
  return Boolean(companyName && productEquivalent && !PLACEHOLDER_PATTERN.test(productEquivalent))
}

function shouldShowDataRoomCandidate(input: {
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
}): boolean {
  if (!sourceIsUsable(input.source)) return false
  if (!input.value || PLACEHOLDER_PATTERN.test(input.value)) return false
  if (hasKnownFakeScreenshotValue(input.value)) return false
  return input.tier === 'tier1-official' || input.tier === 'tier2-company-official' || input.tier === 'tier3-supplier-evidence'
}

function appendDataRoomCandidate(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
    group: DashboardResearchUpdateGroup
    field: string
    value: string
    source: Record<string, unknown> | null
    evidenceStatus: string
    lastChecked: string
    runKey: string
    tier: SourceTier
    dataType: string
    reasons: string[]
  },
): boolean {
  const checklistLabel = firstString(input.item.proposedDashboardField, input.item.field, input.item.label, input.item.title, input.item.fieldKey)
  if (!checklistLabel) return false
  if (includesExisting(state.dataRoomSources, record =>
    stringValue(record.checklistLabel).toLowerCase() === checklistLabel.toLowerCase() &&
    stringValue((record.source as Record<string, unknown> | undefined)?.title) === stringValue(input.source?.title),
  )) return false

  state.dataRoomSources.push({
    id: stableId('autopilot-source', input.runKey, checklistLabel),
    checklistLabel,
    fieldKey: dashboardFieldKey(input.item, input.group, input.field),
    area: areaForGroup(input.group),
    dashboardGroup: input.group,
    group: input.group,
    proposedDashboardField: firstString(input.item.proposedDashboardField, input.item.field, input.item.label, checklistLabel, input.item.fieldKey),
    supplier: firstString(input.item.supplier),
    material: firstString(input.item.material),
    proposedValue: input.value,
    sourceTier: input.tier,
    reportedSourceTier: firstString(input.item.sourceTier) || undefined,
    dataType: input.dataType,
    confidence: input.item.confidence,
    evidenceStatus: safeCandidateStatus(input.evidenceStatus),
    reviewRequired: Boolean(input.reasons.length || input.item.reviewRequired === true),
    reportedReviewRequired: typeof input.item.reviewRequired === 'boolean' ? input.item.reviewRequired : undefined,
    riskReason: firstString(input.item.riskReason) || (input.reasons.join('; ') || undefined),
    source: input.source,
    notes: [
      `Autopilot candidate from ${input.group}.`,
      `Proposed value: ${input.value}`,
      `Source tier: ${input.tier}`,
      `Data type: ${input.dataType}`,
      input.reasons.length ? `Review reason: ${input.reasons.join('; ')}` : '',
      'This record was auto-staged to make the dashboard useful without manual copy-paste. It is not investor-approved.',
    ].filter(Boolean).join('\n'),
    updatedAt: input.lastChecked,
  })
  return true
}

function appendVisibleDashboardCandidate(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
    group: DashboardResearchUpdateGroup
    field: string
    value: string
    source: Record<string, unknown> | null
    evidenceStatus: string
    confidence: Confidence
    lastChecked: string
    runKey: string
    tier: SourceTier
    dataType: string
    reasons: string[]
  },
): boolean {
  if (input.group === 'marketClaims' && shouldShowMarketCandidate(input)) {
    return appendMarketClaim(state, {
      item: input.item,
      group: input.group,
      field: input.field,
      value: input.value,
      source: input.source,
      confidence: input.confidence,
      evidenceStatus: safeCandidateStatus(input.evidenceStatus),
      lastChecked: input.lastChecked,
      runKey: input.runKey,
      tier: input.tier,
      dataType: input.dataType,
      reasons: input.reasons,
    })
  }

  if (input.group === 'competitorRecords' && shouldShowCompetitorCandidate(input)) {
    return appendCompetitorRecord(state, {
      item: input.item,
      value: input.value,
      source: input.source,
      evidenceStatus: safeCandidateStatus(input.evidenceStatus),
      lastChecked: input.lastChecked,
      runKey: input.runKey,
      tier: input.tier,
      dataType: input.dataType,
      field: input.field,
      reasons: input.reasons,
    })
  }

  if (
    (input.group === 'rawMaterialSignals' ||
      input.group === 'supplierScorecards' ||
      input.group === 'regulatoryFindings' ||
      input.group === 'financialEvidence') &&
    shouldShowDataRoomCandidate(input)
  ) {
    return appendDataRoomCandidate(state, input)
  }

  return false
}

function appendReviewFinding(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
    group: DashboardResearchUpdateGroup
    field: string
    value: string
    source: Record<string, unknown> | null
    evidenceStatus: string
    confidence: Confidence
    lastChecked: string
    runKey: string
    tier: SourceTier
    dataType: string
    reasons: string[]
  },
): boolean {
  const title = firstString(input.item.title, input.item.label, input.item.field, input.field)
  const value = input.value || firstString(input.item.notes, input.item.recommendedAction, 'Review source-backed dashboard finding')
  const keyClaim = `${title}: ${value}`
  if (includesExisting(state.researchFindings, finding =>
    stringValue(finding.keyClaim) === keyClaim &&
    stringValue((finding.source as Record<string, unknown> | undefined)?.title) === stringValue(input.source?.title),
  )) return false

  state.researchFindings.push({
    id: stableId('autopilot-review', input.runKey, input.group, title, value),
    summary: `Hermes found a ${input.group} update for ${GROUP_SCREEN[input.group]}. It is staged for owner review before any critical dashboard or investor material changes.`,
    keyClaim,
    area: areaForGroup(input.group),
    evidenceStatus: input.evidenceStatus,
    confidence: input.confidence,
    source: input.source,
    suggestedTask: firstString(input.item.recommendedAction) || `Review source and decide whether to approve ${title}.`,
    suggestedInvestorMaterial: input.group === 'investorMaterialCandidates'
      ? firstString(input.item.content, input.item.value)
      : undefined,
    dashboardGroup: input.group,
    sourceTier: input.tier,
    dataType: input.dataType,
    reviewRequired: true,
    riskReason: firstString(input.item.riskReason) || (input.reasons.join('; ') || undefined),
    riskNote: firstString(input.item.riskReason) || input.reasons.join('; ') || 'Review required by dashboard autopilot policy',
    status: 'Pending Review' satisfies ResearchReviewStatus,
    createdAt: input.lastChecked,
    dashboardTarget: {
      group: input.group,
      dashboardGroup: input.group,
      screen: GROUP_SCREEN[input.group],
      fieldKey: dashboardFieldKey(input.item, input.group, title),
      field: title,
      value,
      proposedDashboardField: firstString(input.item.proposedDashboardField, input.item.field, input.item.label, title, input.item.fieldKey),
      companyName: firstString(input.item.companyName, input.item.title, input.item.label),
      countryRegion: firstString(input.item.countryRegion),
      productEquivalent: firstString(input.item.productEquivalent),
      activeContent: firstString(input.item.activeContent),
      pricingEvidence: firstString(input.item.pricingEvidence) || competitorMetricText(input.item, 'pricingEvidence'),
      certifications: firstString(input.item.certifications),
      distributionPresence: firstString(input.item.distributionPresence),
      marketShare: firstString(input.item.marketShare) || competitorMetricText(input.item, 'marketShare'),
      revenue: firstString(input.item.revenue) || competitorMetricText(input.item, 'revenue'),
      yearlyGrowth: firstString(input.item.yearlyGrowth) || competitorMetricText(input.item, 'yearlyGrowth'),
      traffic: firstString(input.item.traffic) || competitorMetricText(input.item, 'traffic'),
      rating: firstString(input.item.rating) || competitorMetricText(input.item, 'rating'),
      lastUpdated: firstString(input.item.lastChecked, input.item.sourceDate),
      supplier: firstString(input.item.supplier),
      material: firstString(input.item.material),
      section: firstString(input.item.section),
      content: firstString(input.item.content, input.item.value),
      sourceTier: input.tier,
      reportedSourceTier: firstString(input.item.sourceTier) || undefined,
      dataType: input.dataType,
      reviewRequired: true,
      reportedReviewRequired: typeof input.item.reviewRequired === 'boolean' ? input.item.reviewRequired : undefined,
      riskReason: firstString(input.item.riskReason) || (input.reasons.join('; ') || undefined),
      sensitive: input.item.sensitive === true,
      runKey: input.runKey,
    },
  })
  return true
}

function applyDashboardUpdates(
  state: DashboardIntelligenceState,
  payload: DashboardResearchUpdatesPayload,
  runKey: string,
  fallbackCheckedAt: string,
): { autoFilledCount: number, stagedReviewCount: number } {
  let autoFilledCount = 0
  let stagedReviewCount = 0

  for (const group of DASHBOARD_UPDATE_GROUPS) {
    for (const item of payload[group] || []) {
      const field = fieldLabel(item, group)
      const value = itemValueText(item)
      const source = sourceFromItem(item)
      const tier = normalizeSourceTierForItem(item)
      const confidence = coerceConfidence(item.confidence)
      const evidenceStatus = coerceEvidenceStatus(item.evidenceStatus, 'To Verify')
      const dataType = coerceDataType(item.dataType, GROUP_DEFAULT_DATA_TYPE[group])
      const lastChecked = firstString(item.lastChecked, item.sourceDate) || fallbackCheckedAt
      const reasons = riskReasons({ item, group, field, value, source, tier, evidenceStatus, dataType, confidence })
      const reviewRequired = reasons.length > 0

      if (reviewRequired) {
        if (group === 'competitorRecords') {
          const competitorAdded = appendCompetitorRecord(state, {
            item,
            value,
            source,
            evidenceStatus,
            lastChecked,
            runKey,
            tier,
            dataType,
            field,
            reasons,
          })
          if (competitorAdded) autoFilledCount += 1
        }
        appendVisibleDashboardCandidate(state, {
          item,
          group,
          field,
          value,
          source,
          evidenceStatus,
          confidence,
          lastChecked,
          runKey,
          tier,
          dataType,
          reasons,
        })
        if (appendReviewFinding(state, {
          item,
          group,
          field,
          value,
          source,
          evidenceStatus,
          confidence,
          lastChecked,
          runKey,
          tier,
          dataType,
          reasons,
        })) stagedReviewCount += 1
        continue
      }

      const added = group === 'competitorRecords'
        ? appendCompetitorRecord(state, { item, value, source, evidenceStatus, lastChecked, runKey, tier, dataType, field, reasons })
        : appendMarketClaim(state, { item, group, field, value, source, confidence, evidenceStatus, lastChecked, runKey, tier, dataType, reasons })
      if (added) autoFilledCount += 1
    }
  }

  return { autoFilledCount, stagedReviewCount }
}

function formatUsdCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `US$${(value / 1_000_000_000).toFixed(3).replace(/\.?0+$/, '')}B`
  if (abs >= 1_000_000) return `US$${(value / 1_000_000).toFixed(3).replace(/\.?0+$/, '')}M`
  return `US$${value.toLocaleString('en-US')}`
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2).replace(/\.?0+$/, '')}%`
}

function compactOfficialNumber(value: number, currencySymbol: string): string {
  if (value >= 1_000) return `${currencySymbol}${(value / 1_000).toFixed(3).replace(/\.?0+$/, '')}B`
  return `${currencySymbol}${value.toFixed(3).replace(/\.?0+$/, '')}M`
}

function normalizeHtmlText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&euro;/gi, '€')
    .replace(/&yen;/gi, '¥')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatMetricTonsFromKg(value: number): string {
  return `${Math.round(value / 1000).toLocaleString('en-US')} MT`
}

function latestComtradeCandidatePeriods(now = new Date()): string[] {
  const currentYear = Number.isFinite(now.getUTCFullYear()) ? now.getUTCFullYear() : 2026
  const latestFullYear = Math.max(2025, currentYear - 1)
  const candidates = [
    `${latestFullYear - 1},${latestFullYear}`,
    `${latestFullYear - 2},${latestFullYear - 1}`,
    '2023,2024',
  ]
  return [...new Set(candidates)]
}

function comtradeApiUrl(source: ComtradeMarketProxySource, period = '2023,2024'): string {
  return [
    'https://comtradeapi.un.org/public/v1/preview/C/A/HS',
    `?cmdCode=${COMTRADE_TEXTILE_FINISHING_HS_CODE}`,
    '&flowCode=M',
    `&reporterCode=${source.reporterCode}`,
    `&period=${period}`,
    '&partnerCode=0',
    '&max=100000',
  ].join('')
}

function annualRevenueMetricsFromSecCompanyfacts(
  source: SecCompetitorFinancialSource,
  payload: unknown,
): SecAnnualRevenueMetric[] {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.facts)) return []
  const facts = payload.facts
  const usGaap = isPlainRecord(facts['us-gaap']) ? facts['us-gaap'] : {}
  const entityName = firstString(payload.entityName, source.companyName)
  const candidates = SEC_REVENUE_CONCEPTS
    .map((concept, priority) => {
      const fact = isPlainRecord(usGaap[concept]) ? usGaap[concept] : null
      const units = isPlainRecord(fact?.units) && Array.isArray(fact.units.USD) ? fact.units.USD : []
      const byYear = new Map<number, SecAnnualRevenueMetric>()
      for (const entry of units) {
        if (!isPlainRecord(entry)) continue
        if (firstString(entry.form) !== '10-K') continue
        const frame = firstString(entry.frame)
        const match = frame.match(/^CY(\d{4})$/)
        const value = Number(entry.val)
        if (!match || !Number.isFinite(value)) continue
        const year = Number(match[1])
        const metric: SecAnnualRevenueMetric = {
          year,
          value,
          filed: firstString(entry.filed),
          accession: firstString(entry.accn),
          concept,
          entityName,
        }
        const existing = byYear.get(year)
        if (!existing || metric.filed > existing.filed) byYear.set(year, metric)
      }
      return {
        priority,
        rows: Array.from(byYear.values()).sort((left, right) => left.year - right.year),
      }
    })
    .filter(candidate => candidate.rows.length >= 2)
    .sort((left, right) => {
      const leftLatest = left.rows[left.rows.length - 1]?.year || 0
      const rightLatest = right.rows[right.rows.length - 1]?.year || 0
      return rightLatest - leftLatest || left.priority - right.priority
    })

  return candidates[0]?.rows || []
}

function annualImportMetricsFromComtrade(payload: unknown): ComtradeAnnualImportMetric[] {
  if (!isPlainRecord(payload) || !Array.isArray(payload.data)) return []
  const byYear = new Map<number, ComtradeAnnualImportMetric>()
  for (const entry of payload.data) {
    if (!isPlainRecord(entry)) continue
    const year = Number(entry.refYear)
    const primaryValue = Number(entry.primaryValue)
    const netWeightKg = Number(entry.netWgt || entry.qty || 0)
    if (!Number.isFinite(year) || !Number.isFinite(primaryValue) || !Number.isFinite(netWeightKg)) continue
    const metric: ComtradeAnnualImportMetric = {
      year,
      primaryValue,
      netWeightKg,
      isReported: entry.isReported === true,
      isAggregate: entry.isAggregate === true,
    }
    const existing = byYear.get(year)
    if (!existing || metric.primaryValue > existing.primaryValue) byYear.set(year, metric)
  }
  return Array.from(byYear.values()).sort((left, right) => left.year - right.year)
}

function officialCompanyFinancialMetricFromText(
  source: OfficialCompanyFinancialSource,
  text: string,
): OfficialCompanyFinancialMetric | null {
  const normalized = normalizeHtmlText(text)

  if (source.parser === 'basf-report-2025') {
    const match = normalized.match(/sales stood at €\s*([\d,.]+)\s*million,\s*compared with €\s*([\d,.]+)\s*million/i)
    if (!match) return null
    const latest = Number(match[1].replace(/,/g, ''))
    const previous = Number(match[2].replace(/,/g, ''))
    if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) return null
    const growth = ((latest - previous) / previous) * 100
    return {
      year: 2025,
      revenueValue: `FY2025 company-wide sales: ${compactOfficialNumber(latest, '€')} (official reported €${latest.toLocaleString('en-US')} million)`,
      growthValue: `FY2025 company-wide sales YoY: ${formatSignedPercent(growth)} vs FY2024 ${compactOfficialNumber(previous, '€')}`,
    }
  }

  if (source.parser === 'evonik-results-2025') {
    const match = normalized.match(/Sales in 2025 decreased by\s*([\d,.]+)\s*percent to €\s*([\d,.]+)\s*billion/i)
    if (!match) return null
    const growth = -Math.abs(Number(match[1].replace(/,/g, '')))
    const latest = Number(match[2].replace(/,/g, ''))
    if (!Number.isFinite(latest) || !Number.isFinite(growth)) return null
    return {
      year: 2025,
      revenueValue: `FY2025 company-wide sales: €${latest.toFixed(3).replace(/\.?0+$/, '')}B`,
      growthValue: `FY2025 company-wide sales YoY: ${formatSignedPercent(growth)} vs FY2024, per official Evonik results release`,
    }
  }

  if (source.parser === 'wacker-report-2025') {
    const match = normalized.match(/Group[’']s €\s*([\d,.]+)\s*billion in sales in 2025,?\s*\(2024:\s*€\s*([\d,.]+)\s*billion\)/i)
    if (!match) return null
    const latest = Number(match[1].replace(/,/g, ''))
    const previous = Number(match[2].replace(/,/g, ''))
    if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) return null
    const growth = ((latest - previous) / previous) * 100
    return {
      year: 2025,
      revenueValue: `FY2025 company-wide sales: €${latest.toFixed(3).replace(/\.?0+$/, '')}B (official rounded figure)`,
      growthValue: `FY2025 company-wide sales YoY: ${formatSignedPercent(growth)} vs FY2024 €${previous.toFixed(3).replace(/\.?0+$/, '')}B`,
    }
  }

  if (source.parser === 'kao-glance-2025') {
    const match = normalized.match(/Consolidated net sales\s*([\d,.]+)\s*billion yen/i)
    if (!match || !/FY2025 ended December 31/i.test(normalized)) return null
    const latest = Number(match[1].replace(/,/g, ''))
    if (!Number.isFinite(latest)) return null
    return {
      year: 2025,
      revenueValue: `FY2025 company-wide net sales: ¥${latest.toLocaleString('en-US')}B (official reported ${latest.toLocaleString('en-US')} billion yen)`,
    }
  }

  return null
}

export function secCompanyfactsToCompetitorFinancialUpdate(
  source: SecCompetitorFinancialSource,
  payload: unknown,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const annualRows = annualRevenueMetricsFromSecCompanyfacts(source, payload)
  const latest = annualRows[annualRows.length - 1]
  const previous = annualRows[annualRows.length - 2]
  if (!latest || !previous || previous.value === 0) return null

  const sourceUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${source.cik}.json`
  const sourceTitle = `SEC Companyfacts: ${latest.entityName} ${latest.concept}`
  const revenueValue = `FY${latest.year} company-wide revenue: ${formatUsdCompact(latest.value)} (SEC reported US$${latest.value.toLocaleString('en-US')})`
  const growth = ((latest.value - previous.value) / previous.value) * 100
  const growthValue = `FY${latest.year} company-wide revenue YoY: ${formatSignedPercent(growth)} vs FY${previous.year} ${formatUsdCompact(previous.value)}`

  return {
    fieldKey: `competitor_metrics.${source.fieldKeySlug}.official_financials`,
    companyName: source.companyName,
    productEquivalent: 'Company-wide financial context; not textile-softener product-line revenue.',
    countryRegion: 'Company-wide',
    revenue: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.revenue`,
      value: revenueValue,
      sourceTitle,
      sourceUrl,
      sourceTier: 'Tier 1 official SEC companyfacts',
      lastChecked: checkedAt,
      sourceDate: latest.filed,
      confidence: 'high',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
      dataType: 'company_data',
      riskReason: 'Company-wide revenue from official SEC XBRL companyfacts; not product-line revenue.',
    },
    yearlyGrowth: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.yoy_growth`,
      value: growthValue,
      sourceTitle,
      sourceUrl,
      sourceTier: 'Tier 1 official SEC companyfacts',
      lastChecked: checkedAt,
      sourceDate: latest.filed,
      confidence: 'high',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
      dataType: 'company_data',
      riskReason: 'Calculated from two SEC-reported annual company-wide revenue values.',
    },
    lastUpdated: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.last_updated`,
      value: latest.filed || checkedAt,
      sourceTitle,
      sourceUrl,
      sourceTier: 'Tier 1 official SEC companyfacts',
      lastChecked: checkedAt,
      sourceDate: latest.filed,
      confidence: 'high',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
      dataType: 'company_data',
    },
    sourceTitle,
    sourceUrl,
    sourceTier: 'Tier 1 official SEC companyfacts',
    sourceDate: latest.filed,
    lastChecked: checkedAt,
    confidence: 'high',
    evidenceStatus: 'Official Company Evidence',
    reviewRequired: false,
    dataType: 'company_data',
    recommendedAction: 'Use as company-wide financial context only. Do not present as product-line, China, or textile-softener revenue.',
  }
}

export function officialCompanyPageToCompetitorFinancialUpdate(
  source: OfficialCompanyFinancialSource,
  html: string,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const metric = officialCompanyFinancialMetricFromText(source, html)
  if (!metric) return null
  return {
    fieldKey: `competitor_metrics.${source.fieldKeySlug}.official_financials`,
    companyName: source.companyName,
    countryRegion: source.countryRegion,
    productEquivalent: 'Company-wide financial context; not textile-softener product-line revenue.',
    value: metric.revenueValue,
    revenue: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.revenue`,
      value: metric.revenueValue,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 2 - Official company / financial report source',
      lastChecked: checkedAt,
      sourceDate: String(metric.year),
      confidence: 'high',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
      dataType: 'competitor_data',
      riskReason: 'Company-wide revenue from official company financial source; not product-line revenue.',
    },
    yearlyGrowth: metric.growthValue ? {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.yoy_growth`,
      value: metric.growthValue,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 2 - Official company / financial report source',
      lastChecked: checkedAt,
      sourceDate: String(metric.year),
      confidence: 'high',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
      dataType: 'competitor_data',
      riskReason: 'Company-wide YoY sales movement from official company financial source; not product-line growth.',
    } : undefined,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceDate: String(metric.year),
    sourceTier: 'Tier 2 - Official company / financial report source',
    lastChecked: checkedAt,
    confidence: 'high',
    evidenceStatus: 'Official Company Evidence',
    reviewRequired: false,
    dataType: 'competitor_data',
    recommendedAction: 'Use revenue/YoY as company-wide context only; keep pricing, market share, traffic, and rating review-gated until exact sources are available.',
  }
}

export function officialCompetitorProductPageToUpdate(
  source: OfficialCompetitorProductSource,
  html: string,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const normalized = normalizeHtmlText(html)
  const normalizedLower = normalized.toLowerCase()
  const hasRequiredTerms = source.requiredTerms.every(term => normalizedLower.includes(term.toLowerCase()))
  if (!hasRequiredTerms) return null

  return {
    fieldKey: `competitor_products.${source.fieldKeySlug}.${slug(source.productLabel)}`,
    companyName: source.companyName,
    countryRegion: source.countryRegion,
    productEquivalent: source.productEquivalent,
    activeContent: source.activeContent,
    certifications: source.certifications || 'No certification claim imported from this official product source.',
    distributionPresence: source.distributionPresence || 'Official company/product page source-backed presence.',
    value: source.productEquivalent,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceTier: 'Tier 2 - Official company / product source',
    sourceDate: checkedAt,
    lastChecked: checkedAt,
    confidence: 'high',
    evidenceStatus: 'Source-backed',
    reviewRequired: false,
    dataType: 'competitor_data',
    recommendedAction: 'Use as source-backed product-equivalence context only; keep pricing, market share, traffic, rating, and product-line revenue review-gated until exact metric sources are available.',
  }
}

export function officialSupplierEvidencePageToUpdate(
  source: OfficialSupplierEvidenceSource,
  html: string,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const normalized = normalizeHtmlText(html)
  const normalizedLower = normalized.toLowerCase()
  const hasRequiredTerms = source.requiredTerms.every(term => normalizedLower.includes(term.toLowerCase()))
  if (!hasRequiredTerms) return null

  return {
    fieldKey: `supplier_scorecards.${source.fieldKeySlug}.official_product_evidence`,
    label: `${source.supplier} / ${source.material}`,
    supplier: source.supplier,
    material: source.material,
    proposedDashboardField: `${source.supplier} / ${source.material} official source evidence`,
    value: source.value,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceTier: 'Tier 2 - Official company / product source',
    sourceDate: checkedAt,
    lastChecked: checkedAt,
    confidence: 'high',
    evidenceStatus: 'Source-backed',
    reviewRequired: true,
    dataType: 'document_evidence',
    recommendedAction: source.recommendedAction,
    riskReason: 'Supplier/product presence is official-source-backed, but price, payment terms, quality, reliability, score, landed cost, and supplier ranking still require quote/TDS/SDS/COA or owner-approved evidence.',
  }
}

export function comtradeImportPayloadToMarketClaimUpdate(
  source: ComtradeMarketProxySource,
  payload: unknown,
  checkedAt: string,
  period = '2023,2024',
): DashboardResearchUpdateItem | null {
  const annualRows = annualImportMetricsFromComtrade(payload)
  const latest = annualRows[annualRows.length - 1]
  const previous = annualRows[annualRows.length - 2]
  if (!latest || !previous || previous.primaryValue === 0 || previous.netWeightKg === 0) return null

  const valueGrowth = ((latest.primaryValue - previous.primaryValue) / previous.primaryValue) * 100
  const weightGrowth = ((latest.netWeightKg - previous.netWeightKg) / previous.netWeightKg) * 100
  const sourceUrl = comtradeApiUrl(source, period)
  const value = [
    `FY${latest.year} official HS ${COMTRADE_TEXTILE_FINISHING_HS_CODE} import proxy:`,
    `${formatUsdCompact(latest.primaryValue)} import value;`,
    `${formatMetricTonsFromKg(latest.netWeightKg)} net weight;`,
    `YoY value ${formatSignedPercent(valueGrowth)} and weight ${formatSignedPercent(weightGrowth)} vs FY${previous.year}.`,
    latest.isReported ? 'Reported by reporter.' : 'UN Comtrade marks this row as estimated/aggregate.',
  ].join(' ')

  return {
    fieldKey: `market.country_consumption_growth.${source.fieldKeySlug}.hs_${COMTRADE_TEXTILE_FINISHING_HS_CODE}`,
    label: `Country-wise consumption growth - ${source.country}`,
    proposedDashboardField: `${source.country} HS ${COMTRADE_TEXTILE_FINISHING_HS_CODE} import proxy`,
    value,
    sourceTitle: `UN Comtrade API: ${source.country} HS ${COMTRADE_TEXTILE_FINISHING_HS_CODE} imports`,
    sourceUrl,
    sourceTier: 'Tier 1 official UN Comtrade trade source',
    sourceDate: String(latest.year),
    lastChecked: checkedAt,
    confidence: 'medium',
    evidenceStatus: 'Trade Proxy',
    reviewRequired: true,
    dataType: 'trade_data',
    riskReason: 'Official import data is useful market evidence, but it is not direct textile-softener consumption or product-line demand proof.',
    recommendedAction: `Review HS ${COMTRADE_TEXTILE_FINISHING_HS_CODE} fit and collect direct textile-softener demand evidence for ${source.country}.`,
  }
}

async function applyOfficialCompetitorFinancialMetrics(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['official SEC connector: fetch is unavailable'] }

  for (const source of SEC_COMPETITOR_FINANCIAL_SOURCES) {
    try {
      const response = await fetcher(`https://data.sec.gov/api/xbrl/companyfacts/CIK${source.cik}.json`, {
        headers: {
          'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
          Accept: 'application/json',
        },
      })
      if (!response.ok) {
        errors.push(`${source.companyName}: SEC companyfacts returned ${response.status}`)
        continue
      }
      const payload = await response.json()
      const update = secCompanyfactsToCompetitorFinancialUpdate(source, payload, checkedAt)
      if (!update) {
        errors.push(`${source.companyName}: SEC revenue metrics unavailable`)
        continue
      }
      const runKey = `official-sec/${source.fieldKeySlug}/${firstString(update.sourceDate, checkedAt)}`
      const result = applyDashboardUpdates(state, { competitorRecords: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.companyName}: ${err instanceof Error ? err.message : 'SEC connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyOfficialCompanyPageFinancialMetrics(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['official company financial connector: fetch is unavailable'] }

  for (const source of OFFICIAL_COMPANY_FINANCIAL_SOURCES) {
    try {
      const response = await fetcher(source.sourceUrl, {
        headers: {
          'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
          Accept: 'text/html,application/xhtml+xml,text/plain',
        },
      })
      if (!response.ok) {
        errors.push(`${source.companyName}: official financial source returned ${response.status}`)
        continue
      }
      const html = await response.text()
      const update = officialCompanyPageToCompetitorFinancialUpdate(source, html, checkedAt)
      if (!update) {
        errors.push(`${source.companyName}: official financial metrics unavailable`)
        continue
      }
      const runKey = `official-company-financials/${source.fieldKeySlug}/${firstString(update.sourceDate, checkedAt)}`
      const result = applyDashboardUpdates(state, { competitorRecords: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.companyName}: ${err instanceof Error ? err.message : 'official company financial connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyOfficialCompetitorProductEvidence(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['official competitor product connector: fetch is unavailable'] }

  for (const source of OFFICIAL_COMPETITOR_PRODUCT_SOURCES) {
    try {
      const response = await fetcher(source.sourceUrl, {
        headers: {
          'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
          Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf',
        },
      })
      if (!response.ok) {
        errors.push(`${source.companyName}: official product source returned ${response.status}`)
        continue
      }
      const html = await response.text()
      const update = officialCompetitorProductPageToUpdate(source, html, checkedAt)
      if (!update) {
        errors.push(`${source.companyName}: official product evidence unavailable`)
        continue
      }
      const runKey = `official-competitor-products/${source.fieldKeySlug}/${slug(source.productLabel)}/${checkedAt}`
      const result = applyDashboardUpdates(state, { competitorRecords: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.companyName}: ${err instanceof Error ? err.message : 'official competitor product connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyOfficialSupplierEvidence(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['official supplier evidence connector: fetch is unavailable'] }

  for (const source of OFFICIAL_SUPPLIER_EVIDENCE_SOURCES) {
    try {
      const response = await fetcher(source.sourceUrl, {
        headers: {
          'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
          Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf',
        },
      })
      if (!response.ok) {
        errors.push(`${source.supplier}: official supplier source returned ${response.status}`)
        continue
      }
      const html = await response.text()
      const update = officialSupplierEvidencePageToUpdate(source, html, checkedAt)
      if (!update) {
        errors.push(`${source.supplier}: official supplier evidence unavailable`)
        continue
      }
      const runKey = `official-supplier-evidence/${source.fieldKeySlug}/${checkedAt}`
      const result = applyDashboardUpdates(state, { supplierScorecards: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.supplier}: ${err instanceof Error ? err.message : 'official supplier evidence connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyOfficialComtradeMarketProxies(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['official Comtrade connector: fetch is unavailable'] }

  for (const source of COMTRADE_TEXTILE_FINISHING_IMPORT_SOURCES) {
    let imported = false
    let lastError = ''
    try {
      for (const period of latestComtradeCandidatePeriods()) {
        const response = await fetcher(comtradeApiUrl(source, period), {
          headers: {
            'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
            Accept: 'application/json',
          },
        })
        if (!response.ok) {
          lastError = `UN Comtrade returned ${response.status} for period ${period}`
          continue
        }
        const payload = await response.json()
        const update = comtradeImportPayloadToMarketClaimUpdate(source, payload, checkedAt, period)
        if (!update) {
          lastError = `UN Comtrade did not return two usable annual rows for period ${period}`
          continue
        }
        const runKey = `official-comtrade/${source.fieldKeySlug}/${COMTRADE_TEXTILE_FINISHING_HS_CODE}/${firstString(update.sourceDate, checkedAt)}`
        const result = applyDashboardUpdates(state, { marketClaims: [update] }, runKey, checkedAt)
        autoFilledCount += result.autoFilledCount
        stagedReviewCount += result.stagedReviewCount
        imported = true
        break
      }
      if (!imported && lastError) errors.push(`${source.country}: ${lastError}`)
    } catch (err) {
      errors.push(`${source.country}: ${err instanceof Error ? err.message : 'UN Comtrade connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

export async function ingestFullDashboardAutopilotOutputs(
  profileInput?: string,
  options: IngestOptions = {},
): Promise<DashboardAutopilotIngestResult> {
  const profile = profileInput || getActiveProfileName() || 'default'
  const result: DashboardAutopilotIngestResult = {
    profile,
    jobsChecked: 0,
    filesChecked: 0,
    importedRuns: 0,
    skippedRuns: 0,
    autoFilledCount: 0,
    stagedReviewCount: 0,
    missingCoverageFollowUpStarted: false,
    errors: [],
  }
  const maxFilesPerJob = options.maxFilesPerJob ?? 10
  const jobs = (await readCronJobs(profile)).filter(job => {
    const id = getJobId(job)
    if (options.jobId && id !== options.jobId) return false
    return isDashboardAutopilotOutputJobRecord(job)
  })
  const discoveredOutputs = await listDashboardAutopilotOutputFiles(profile, jobs, maxFilesPerJob, { jobId: options.jobId })
  result.jobsChecked = discoveredOutputs.jobsChecked
  const envelope = await readDashboardIntelligenceState(profile)
  const state = normalizeState(envelope?.state)
  const officialConnectorsEnabled = options.includeOfficialConnectors ?? process.env.NODE_ENV !== 'test'
  const officialCompanyFinancialConnectorsEnabled = options.includeOfficialCompanyFinancialConnectors ?? officialConnectorsEnabled
  const officialProductConnectorsEnabled = options.includeOfficialProductConnectors ?? officialConnectorsEnabled
  const officialSupplierConnectorsEnabled = options.includeOfficialSupplierConnectors ?? officialConnectorsEnabled
  const officialTradeConnectorsEnabled = options.includeOfficialTradeConnectors ?? officialConnectorsEnabled
  if (officialConnectorsEnabled) {
    const official = await applyOfficialCompetitorFinancialMetrics(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += official.autoFilledCount
    result.stagedReviewCount += official.stagedReviewCount
    result.errors.push(...official.errors.map(error => `official source connector: ${error}`))
  }
  if (officialCompanyFinancialConnectorsEnabled) {
    const officialCompany = await applyOfficialCompanyPageFinancialMetrics(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += officialCompany.autoFilledCount
    result.stagedReviewCount += officialCompany.stagedReviewCount
    result.errors.push(...officialCompany.errors.map(error => `official source connector: ${error}`))
  }
  if (officialProductConnectorsEnabled) {
    const officialProduct = await applyOfficialCompetitorProductEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += officialProduct.autoFilledCount
    result.stagedReviewCount += officialProduct.stagedReviewCount
    result.errors.push(...officialProduct.errors.map(error => `official source connector: ${error}`))
  }
  if (officialSupplierConnectorsEnabled) {
    const officialSupplier = await applyOfficialSupplierEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += officialSupplier.autoFilledCount
    result.stagedReviewCount += officialSupplier.stagedReviewCount
    result.errors.push(...officialSupplier.errors.map(error => `official source connector: ${error}`))
  }
  if (officialTradeConnectorsEnabled) {
    const officialTrade = await applyOfficialComtradeMarketProxies(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += officialTrade.autoFilledCount
    result.stagedReviewCount += officialTrade.stagedReviewCount
    result.errors.push(...officialTrade.errors.map(error => `official source connector: ${error}`))
  }

  if (discoveredOutputs.outputFiles.length === 0) {
    if (result.autoFilledCount > 0 || result.stagedReviewCount > 0) {
      await writeDashboardIntelligenceState({
        profile,
        state,
        savedBy: {
          username: 'Full Dashboard Autopilot',
          role: 'system',
        },
      })
    }
    return result
  }

  const registry = await readImportRegistry(profile)
  const shouldReplayImportedRuns = registry.importerVersion !== DASHBOARD_AUTOPILOT_IMPORTER_VERSION
  const importedRunKeys = new Set(shouldReplayImportedRuns ? [] : registry.importedRunKeys)
  const skippedRunKeys = new Set(shouldReplayImportedRuns ? [] : registry.skippedRunKeys)

  for (const output of discoveredOutputs.outputFiles) {
    const runKey = `${output.jobId}/${output.fileName}`
    if (importedRunKeys.has(runKey) || skippedRunKeys.has(runKey)) continue
    result.filesChecked += 1
    try {
      const content = await readFile(output.path, 'utf-8')
      const payload = extractDashboardResearchUpdates(content)
      if (!payload) {
        skippedRunKeys.add(runKey)
        result.skippedRuns += 1
        continue
      }
      importedRunKeys.add(runKey)
      skippedRunKeys.delete(runKey)
      const applied = applyDashboardUpdates(state, payload, runKey, new Date(output.mtimeMs || Date.now()).toISOString())
      result.autoFilledCount += applied.autoFilledCount
      result.stagedReviewCount += applied.stagedReviewCount
      result.importedRuns += 1
    } catch (err: any) {
      result.errors.push(`${runKey}: ${err?.message || 'failed to import output'}`)
    }
  }

  try {
    result.missingCoverageFollowUpStarted = await ensureMissingCoverageFollowUp(profile, state)
  } catch (err) {
    result.errors.push(`missing coverage follow-up: ${err instanceof Error ? err.message : 'failed to start follow-up research'}`)
  }

  if (
    result.importedRuns > 0 ||
    result.autoFilledCount > 0 ||
    result.stagedReviewCount > 0 ||
    result.missingCoverageFollowUpStarted
  ) {
    await writeDashboardIntelligenceState({
      profile,
      state,
      savedBy: {
        username: 'Full Dashboard Autopilot',
        role: 'system',
      },
    })
  }

  await writeImportRegistry(profile, {
    version: 1,
    importerVersion: DASHBOARD_AUTOPILOT_IMPORTER_VERSION,
    importedRunKeys: [...importedRunKeys],
    skippedRunKeys: [...skippedRunKeys],
    updatedAt: new Date().toISOString(),
  })

  return result
}

export async function readFullDashboardAutopilotImportStatus(profileInput?: string): Promise<DashboardAutopilotImportStatus> {
  const profile = profileInput || getActiveProfileName() || 'default'
  const jobs = (await readCronJobs(profile)).filter(isDashboardAutopilotOutputJobRecord)
  const registry = await readImportRegistry(profile)
  const dueRegistry = await readDueRunRegistry(profile)
  const registryMatchesImporter = registry.importerVersion === DASHBOARD_AUTOPILOT_IMPORTER_VERSION
  const importedRunKeys = new Set(registryMatchesImporter ? registry.importedRunKeys : [])
  const skippedRunKeys = new Set(registryMatchesImporter ? registry.skippedRunKeys : [])
  const discoveredOutputs = await listDashboardAutopilotOutputFiles(profile, jobs, 50)
  const outputFiles = discoveredOutputs.outputFiles

  outputFiles.sort((a, b) => b.fileName.localeCompare(a.fileName) || b.mtimeMs - a.mtimeMs)
  const latestOutput = outputFiles[0] || null
  const latestOutputRunKey = latestOutput ? `${latestOutput.jobId}/${latestOutput.fileName}` : ''
  const latestOutputImported = latestOutputRunKey ? importedRunKeys.has(latestOutputRunKey) : false
  const latestOutputSkipped = latestOutputRunKey ? skippedRunKeys.has(latestOutputRunKey) : false
  let latestOutputParseStatus: DashboardAutopilotImportStatus['latestOutputParseStatus'] = latestOutput ? 'unparseable' : 'none'
  let latestOutputCandidateCount = 0
  let latestOutputParseError = ''
  if (latestOutputImported) {
    latestOutputParseStatus = 'imported'
  } else if (latestOutputSkipped) {
    latestOutputParseStatus = 'unparseable'
  } else if (latestOutput) {
    try {
      const latestContent = await readFile(latestOutput.path, 'utf-8')
      latestOutputCandidateCount = countDashboardPayloadItems(extractDashboardResearchUpdates(latestContent))
      latestOutputParseStatus = latestOutputCandidateCount > 0 ? 'ready' : 'unparseable'
    } catch (err) {
      latestOutputParseStatus = 'unreadable'
      latestOutputParseError = err instanceof Error ? err.message : 'Could not read latest output'
    }
  }
  const pendingOutputCount = outputFiles.filter(output => {
    const runKey = `${output.jobId}/${output.fileName}`
    return !importedRunKeys.has(runKey) && !skippedRunKeys.has(runKey)
  }).length
  const primaryJobId = jobs[0] ? getJobId(jobs[0]) : ''
  const dueSlot = primaryJobId ? latestReadyFullDashboardSlot(new Date(), DUE_RUN_GRACE_MS) : null
  const dueSlotAt = dueSlot ? dueSlot.toISOString() : ''
  const dueSlotKey = primaryJobId && dueSlotAt ? `${primaryJobId}/${dueSlotAt}` : ''
  const dueAttempt = dueSlotKey ? dueRegistry.slots[dueSlotKey] : null
  const latestDueSlotSatisfied = Boolean(dueSlot && primaryJobId && outputFiles.some(output =>
    output.jobId === primaryJobId && outputSatisfiesDueSlot(output, dueSlot),
  ))

  return {
    profile,
    jobCount: discoveredOutputs.jobsChecked,
    outputCount: outputFiles.length,
    importedRunCount: registryMatchesImporter ? registry.importedRunKeys.length : 0,
    skippedRunCount: registryMatchesImporter ? registry.skippedRunKeys.length : 0,
    pendingOutputCount,
    latestOutputRunKey,
    latestOutputFile: latestOutput?.fileName || '',
    latestOutputAt: latestOutput ? new Date(latestOutput.mtimeMs || Date.now()).toISOString() : '',
    latestOutputImported,
    latestOutputSkipped,
    latestOutputParseStatus,
    latestOutputCandidateCount,
    latestOutputParseError,
    latestImportedRunKey: registryMatchesImporter ? registry.importedRunKeys[registry.importedRunKeys.length - 1] || '' : '',
    registryUpdatedAt: registry.updatedAt || '',
    latestDueSlotAt: dueSlotAt,
    latestDueSlotSatisfied,
    latestDueSlotAttemptedAt: stringValue(dueAttempt?.attemptedAt),
    latestDueSlotRunError: stringValue(dueAttempt?.error),
  }
}

export async function runDueFullDashboardAutopilot(
  profileInput?: string,
  options: DueRunOptions = {},
): Promise<FullDashboardAutopilotDueRunResult> {
  const profile = profileInput || getActiveProfileName() || 'default'
  const now = options.now || new Date()
  const graceMs = options.graceMs ?? DUE_RUN_GRACE_MS
  const retryAfterMs = options.retryAfterMs ?? DUE_RUN_RETRY_AFTER_MS
  const dueSlot = latestReadyFullDashboardSlot(now, graceMs)
  const dueSlotAt = dueSlot.toISOString()
  const jobs = (await readCronJobs(profile)).filter(isFullDashboardAutopilotJobRecord)
  const job = jobs[0] || null
  const jobId = job ? getJobId(job) : ''
  const dueSlotKey = jobId ? `${jobId}/${dueSlotAt}` : ''

  const result: FullDashboardAutopilotDueRunResult = {
    profile,
    jobId: jobId || null,
    dueSlotAt,
    dueSlotKey,
    outputAlreadyPresent: false,
    skippedRecentAttempt: false,
    runStarted: false,
    runError: '',
    importedRuns: 0,
    autoFilledCount: 0,
    stagedReviewCount: 0,
  }
  if (!jobId) return result

  const importRegistry = await readImportRegistry(profile)
  const skippedRunKeys = new Set(importRegistry.skippedRunKeys)
  const outputs = await listOutputFiles(profile, jobId, 50)
  if (outputs.some(output =>
    outputSatisfiesDueSlot(output, dueSlot) &&
    !skippedRunKeys.has(`${output.jobId}/${output.fileName}`),
  )) {
    result.outputAlreadyPresent = true
    return result
  }

  const dueRegistry = await readDueRunRegistry(profile)
  const previousAttempt = dueRegistry.slots[dueSlotKey]
  const previousAttemptAt = previousAttempt ? Date.parse(stringValue(previousAttempt.attemptedAt)) : 0
  if (previousAttemptAt && Number.isFinite(previousAttemptAt) && now.getTime() - previousAttemptAt < retryAfterMs) {
    result.skippedRecentAttempt = true
    result.runError = stringValue(previousAttempt.error)
    return result
  }

  try {
    const defaultModel = await ensureDefaultModelForAutopilot(profile)
    if (defaultModel.configured) {
      logger.info({
        profile,
        model: defaultModel.model,
        provider: defaultModel.provider || undefined,
      }, '[dashboard-autopilot] configured default model before due trusted-source run')
    }
    await runHermesCron(profile, ['cron', 'run', jobId], RUN_TIMEOUT_MS)
    result.runStarted = true
    const ingest = await ingestFullDashboardAutopilotOutputs(profile, {
      jobId,
      maxFilesPerJob: options.maxFilesPerJob ?? 5,
    })
    result.importedRuns = ingest.importedRuns
    result.autoFilledCount = ingest.autoFilledCount
    result.stagedReviewCount = ingest.stagedReviewCount
    if (ingest.errors.length > 0) result.runError = ingest.errors.join('; ')
  } catch (err) {
    result.runError = err instanceof Error ? err.message : 'Hermes cron run failed'
  }

  const refreshedOutputs = await listOutputFiles(profile, jobId, 50)
  const refreshedImportRegistry = await readImportRegistry(profile)
  const refreshedSkippedRunKeys = new Set(refreshedImportRegistry.skippedRunKeys)
  dueRegistry.slots[dueSlotKey] = {
    jobId,
    dueSlotAt,
    attemptedAt: now.toISOString(),
    outputSeen: refreshedOutputs.some(output =>
      outputSatisfiesDueSlot(output, dueSlot) &&
      !refreshedSkippedRunKeys.has(`${output.jobId}/${output.fileName}`),
    ),
    error: result.runError,
  }
  await writeDueRunRegistry(profile, dueRegistry)

  return result
}

async function safeIngestActiveProfile(): Promise<void> {
  if (ingestRunning) return
  ingestRunning = true
  try {
    const profile = getActiveProfileName()
    const schedule = await ensureFullDashboardAutopilotScheduled(profile, { startFirstRun: true })
    if (schedule.created) {
      logger.info({
        profile: schedule.profile,
        jobId: schedule.jobId,
        firstRunStarted: schedule.firstRunStarted,
        firstRunError: schedule.firstRunError || undefined,
      }, '[dashboard-autopilot] ensured trusted-source schedule')
    }
    const dueRun = await runDueFullDashboardAutopilot(profile)
    if (dueRun.runStarted || dueRun.outputAlreadyPresent || dueRun.skippedRecentAttempt || dueRun.runError) {
      logger.info({
        profile: dueRun.profile,
        jobId: dueRun.jobId,
        dueSlotAt: dueRun.dueSlotAt,
        outputAlreadyPresent: dueRun.outputAlreadyPresent,
        skippedRecentAttempt: dueRun.skippedRecentAttempt,
        runStarted: dueRun.runStarted,
        runError: dueRun.runError || undefined,
        importedRuns: dueRun.importedRuns,
        autoFilledCount: dueRun.autoFilledCount,
        stagedReviewCount: dueRun.stagedReviewCount,
      }, '[dashboard-autopilot] due trusted-source run checked')
    }
    const result = await ingestFullDashboardAutopilotOutputs(profile, { maxFilesPerJob: 10 })
    if (result.importedRuns > 0 || result.autoFilledCount > 0 || result.stagedReviewCount > 0) {
      logger.info({
        profile: result.profile,
        importedRuns: result.importedRuns,
        autoFilledCount: result.autoFilledCount,
        stagedReviewCount: result.stagedReviewCount,
      }, '[dashboard-autopilot] imported trusted-source output')
    }
    if (result.errors.length > 0) {
      logger.warn({ errors: result.errors }, '[dashboard-autopilot] import completed with errors')
    }
  } catch (err) {
    logger.warn(err, '[dashboard-autopilot] background import failed')
  } finally {
    ingestRunning = false
  }
}

export function startDashboardAutopilotIngestor(options: { initialDelayMs?: number, intervalMs?: number } = {}): void {
  if (intervalTimer || initialTimer) return
  const initialDelayMs = options.initialDelayMs ?? 30_000
  const intervalMs = options.intervalMs ?? 10 * 60_000
  initialTimer = setTimeout(() => {
    initialTimer = null
    void safeIngestActiveProfile()
    intervalTimer = setInterval(() => {
      void safeIngestActiveProfile()
    }, intervalMs)
    intervalTimer.unref?.()
  }, initialDelayMs)
  initialTimer.unref?.()
}

export function stopDashboardAutopilotIngestor(): void {
  if (initialTimer) clearTimeout(initialTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  initialTimer = null
  intervalTimer = null
  ingestRunning = false
}
