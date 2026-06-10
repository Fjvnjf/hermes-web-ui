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
export const FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION = 'dashboard-autopilot-schema-v2026-06-10-dashboard-targets-v7'
export const FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME = 'Full Dashboard Missing Coverage Follow-up'
export const DASHBOARD_AUTOPILOT_IMPORTER_VERSION = 'dashboard-autopilot-ingest-v2026-06-07-world-bank-market-context-v22'

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
const MARKET_REFERENCE_REVIEW_ACTION = 'Review market-reference methodology and approve only if the source is acceptable for dashboard or investor use.'
const SOURCE_READER_PREFIX = 'https://r.jina.ai/http://'
const SOURCE_FETCH_TIMEOUT_MS = 12_000
const TRAFFIC_SOURCE_FETCH_TIMEOUT_MS = 3_500

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
  'euronext.com',
  'live.euronext.com',
  'hkexnews.hk',
  'echa.europa.eu',
  'pubchem.ncbi.nlm.nih.gov',
  'comptox.epa.gov',
  'epa.gov',
  'nite.go.jp',
]

const COMPANY_OFFICIAL_SOURCE_DOMAINS = [
  'evonik.com',
  'evonik.cn',
  'stepan.com',
  'kao.com',
  'kaochemicals-eu.com',
  'wacker.com',
  'rudolf.com',
  'rudolf.de',
  'cht.com',
  'archroma.com',
  'zschimmer-schwarz.com',
  'pulcra-chemicals.com',
  'transfarchem.com',
  'syensqo.com',
  'basf.com',
  'akzonobel.com',
  'dow.com',
  'pg.com',
  'us.pg.com',
  'shinetsu.co.jp',
  'momentive.com',
  'wilmar-international.com',
  'klkoleo.com',
]

const TRUSTED_CERTIFICATION_SOURCE_DOMAINS = [
  'sgs.com',
  'sgsgroup.com.cn',
  'sgsonline.com.cn',
  'ecovadis.com',
  'tuvsud.com',
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
  'fortunebusinessinsights.com',
  '360researchreports.com',
  'futuremarketinsights.com',
  'persistencemarketresearch.com',
  'marketsandmarkets.com',
  'researchandmarkets.com',
  'mordorintelligence.com',
  'statista.com',
  'euromonitor.com',
  'semrush.com',
  'tranco-list.eu',
  'stockanalysis.com',
  'mckinsey.com',
  'deloitte.com',
]

const WEAK_PUBLIC_LISTING_DOMAINS = [
  'alibaba.com',
  'made-in-china.com',
  '1688.com',
  'zauba.com',
  'wholesalesuppliesplus.com',
  'ekokoza.com',
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
  rawMaterialSignals: Record<string, unknown>[]
  supplierScorecards: Record<string, unknown>[]
  regulatoryFindings: Record<string, unknown>[]
  financialEvidence: Record<string, unknown>[]
  presentationMaterials: Record<string, unknown>[]
  suggestedTasks: Record<string, unknown>[]
  investorMaterialCandidates: Record<string, unknown>[]
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

type CompetitorMetricEvidenceMap = Partial<Record<CompetitorMetricField, Record<string, unknown>>>

interface SecCompetitorFinancialSource {
  companyName: string
  cik: string
  fieldKeySlug: string
  aliases: string[]
}

type OfficialCompanyFinancialParser =
  | 'basf-report-2025'
  | 'evonik-results-2025'
  | 'wacker-report-2025'
  | 'kao-glance-2025'
  | 'syensqo-results-2025'
  | 'cht-growth-2024'
  | 'zschimmer-turnover-2023'
  | 'pulcra-csrd-2023'
  | 'akzonobel-q1-2026'

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

interface OfficialCompetitorRecognitionSource {
  companyName: string
  fieldKeySlug: string
  countryRegion: string
  ratingLabel: string
  sourceTitle: string
  sourceUrl: string
  sourceTierLabel?: string
  requiredTerms: string[]
  recommendedAction: string
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

interface OfficialChemicalIdentitySource {
  material: string
  fieldKeySlug: string
  query: string
  aliases?: string[]
  proposedDashboardField: string
  recommendedAction: string
  sensitive?: boolean
}

type PublicCompetitorPriceParser = 'zauba-stepantex-sp90' | 'wholesale-varisoft-eq65'

interface PublicCompetitorPriceSource {
  companyName: string
  fieldKeySlug: string
  countryRegion: string
  productEquivalent: string
  sourceTitle: string
  sourceUrl: string
  parser: PublicCompetitorPriceParser
  requiredTerms: string[]
  riskReason: string
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

type WorldBankIndicatorKind =
  | 'gdp_annual_change'
  | 'manufacturing_value_added_usd'
  | 'manufacturing_value_added_share'
  | 'merchandise_exports_usd'
  | 'merchandise_imports_usd'
  | 'logistics_performance_index'

interface WorldBankIndicatorSource {
  country: string
  countryCode: string
  fieldKeySlug: string
  indicator: string
  indicatorKind: WorldBankIndicatorKind
  label: string
}

interface WorldBankIndicatorMetric {
  year: number
  value: number
  indicatorName: string
  countryName: string
  sourceUpdated: string
}

type MarketReferenceParser =
  | 'future-market-insights-esterquats'
  | 'persistence-esterquats'
  | 'grandview-esterquats'
  | 'fortune-esterquats'
  | 'research360-esterquat'

interface MarketReferenceSource {
  fieldKeySlug: string
  sourceTitle: string
  sourceUrl: string
  parser: MarketReferenceParser
}

interface MarketReferenceTrafficSource {
  companyName: string
  fieldKeySlug: string
  countryRegion: string
  domain: string
  sourceTitle: string
  sourceUrl: string
}

interface TrancoTrafficRankSource {
  companyName: string
  fieldKeySlug: string
  countryRegion: string
  domain: string
}

interface TrancoRankPayload {
  ranks?: Array<{
    date?: unknown
    rank?: unknown
  }>
}

type MarketReferenceCompetitorFinancialParser =
  | 'spglobal-archroma-2025'
  | 'stockanalysis-transfar-2025'

interface MarketReferenceCompetitorFinancialSource {
  companyName: string
  fieldKeySlug: string
  countryRegion: string
  sourceTitle: string
  sourceUrl: string
  parser: MarketReferenceCompetitorFinancialParser
}

interface ComtradeAnnualImportMetric {
  year: number
  primaryValue: number
  netWeightKg: number
  isReported: boolean
  isAggregate: boolean
}

interface PubChemIdentityPayload {
  chemicalName: string
  property: Record<string, unknown> | null
  synonyms: string[]
  substanceSid?: string
  lookupName?: string
  sourceKind?: 'compound' | 'substance'
}

interface OfficialCompanyFinancialMetric {
  year: number
  revenueValue: string
  growthValue?: string
}

interface MarketReferenceClaim {
  fieldKey: string
  label: string
  proposedDashboardField: string
  value: string
  confidence: Confidence
}

interface MarketReferenceCompetitorShareContext {
  companyName: string
  fieldKeySlug: string
  countryRegion: string
  marketShare: string
  productEquivalent: string
  riskReason: string
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
  {
    companyName: 'Procter & Gamble',
    cik: '0000080424',
    fieldKeySlug: 'procter_gamble',
    aliases: ['procter gamble', 'procter & gamble', 'pg', 'p&g'],
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
  {
    companyName: 'Syensqo / Solvay',
    fieldKeySlug: 'syensqo_solvay',
    countryRegion: 'Belgium / global',
    sourceTitle: 'Syensqo fourth quarter and full year 2025 results',
    sourceUrl: 'https://live.euronext.com/en/products/equities/company-news/2026-02-26-syensqo-fourth-quarter-and-full-year-2025-results',
    parser: 'syensqo-results-2025',
  },
  {
    companyName: 'CHT Group',
    fieldKeySlug: 'cht_group',
    countryRegion: 'Germany / global',
    sourceTitle: 'CHT Group expands Management Team and focuses on Sustainable Growth',
    sourceUrl: 'https://www.cht.com/en/news-media/article/cht-group-expands-management-team-and-focuses-on-sustainable-growth',
    parser: 'cht-growth-2024',
  },
  {
    companyName: 'Zschimmer & Schwarz',
    fieldKeySlug: 'zschimmer_schwarz',
    countryRegion: 'Germany / global',
    sourceTitle: 'Zschimmer & Schwarz initiates management change',
    sourceUrl: 'https://www.zschimmer-schwarz.com/en/news/news-details/zschimmer-schwarz-initiates-management-change',
    parser: 'zschimmer-turnover-2023',
  },
  {
    companyName: 'Pulcra Chemicals',
    fieldKeySlug: 'pulcra_chemicals',
    countryRegion: 'Germany / group context',
    sourceTitle: 'Pulcra Germany GmbH Sustainability Statement 2023',
    sourceUrl: 'https://www.pulcra-chemicals.com/wp-content/uploads/PULCRA_CSRD_2023.pdf',
    parser: 'pulcra-csrd-2023',
  },
  {
    companyName: 'AkzoNobel',
    fieldKeySlug: 'akzonobel',
    countryRegion: 'Netherlands / global',
    sourceTitle: 'AkzoNobel Q1 2026 report',
    sourceUrl: 'https://www.akzonobel.com/content/dam/akzonobel-corporate/global/en/investor-relations-images/result-center/reports---presentation/2026/report-q1-2026-akzonobel.pdf',
    parser: 'akzonobel-q1-2026',
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
    sourceUrl: 'https://www.kaochemicals-eu.com/industries/laundry-and-cleaning/tetranyl-l9-90',
    requiredTerms: ['TETRANYL L9-90', 'Esterquat'],
  },
  {
    companyName: 'Dow',
    fieldKeySlug: 'dow',
    countryRegion: 'United States / global',
    productLabel: 'DOWSIL 2202A Textile Finish',
    productEquivalent: 'DOWSIL 2202A Textile Finish reactive silicone textile-finishing product reference.',
    activeContent: 'Dispersion of a reactive silicone in white spirit for water-repellent fabric and leather finishing.',
    distributionPresence: 'Official Dow product page; direct fetch may require reader fallback when Dow blocks automated access.',
    sourceTitle: 'Dow DOWSIL 2202A Textile Finish official product page',
    sourceUrl: 'https://www.dow.com/en-us/pdp.dowsil-2202a-textile-finish.01484273z.html',
    requiredTerms: ['DOWSIL', '2202A Textile Finish', 'water repellent finishing'],
  },
  {
    companyName: 'Dow',
    fieldKeySlug: 'dow',
    countryRegion: 'United States / global',
    productLabel: 'XIAMETER OFX-8417 Fluid',
    productEquivalent: 'XIAMETER OFX-8417 Fluid amino-functional silicone fluid for textile-softener formulation context.',
    activeContent: 'Premium amino softener suitable for formulation into microemulsion for textile softener applications.',
    distributionPresence: 'Official Dow product page; direct fetch may require reader fallback when Dow blocks automated access.',
    sourceTitle: 'Dow XIAMETER OFX-8417 Fluid official product page',
    sourceUrl: 'https://www.dow.com/en-us/pdp.xiameter-ofx-8417-fluid.01812092z.html',
    requiredTerms: ['XIAMETER', 'Premium amino softener', 'textile softener'],
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
    requiredTerms: ['TUBINGAL GEP', 'silicone', 'textile'],
  },
  {
    companyName: 'CHT Group',
    fieldKeySlug: 'cht_group',
    countryRegion: 'Germany / global',
    productLabel: 'TUBINGAL RISE',
    productEquivalent: 'TUBINGAL RISE recycled silicone textile softener product reference.',
    activeContent: 'Textile softener based on recycled and reprocessed silicone waste and renewable bio-based emulsifiers.',
    distributionPresence: 'Official CHT textile-softener product page.',
    sourceTitle: 'CHT TUBINGAL RISE official textile softener page',
    sourceUrl: 'https://solutions.cht.com/cht/web.nsf/id/pa_tubingal-rise-softener.html',
    requiredTerms: ['TUBINGAL', 'recycled silicones', 'textile softener'],
  },
  {
    companyName: 'Transfar',
    fieldKeySlug: 'transfar',
    countryRegion: 'China / global',
    productLabel: 'TRANSOFT FLA TF-442',
    productEquivalent: 'TRANSOFT FLA TF-442 fatty-acid ester softener flake for textile reference.',
    activeContent: 'Fatty acid ester compound softener flake for textile.',
    distributionPresence: 'Official Zhejiang Transfar Chemicals product page.',
    sourceTitle: 'Transfar TRANSOFT FLA TF-442 official product page',
    sourceUrl: 'https://www.transfarchem.com/en/index.php/productinfo/index/60/155.html',
    requiredTerms: ['TRANSOFT FLA TF-442', 'fatty acid ester', 'softener flake'],
  },
  {
    companyName: 'Rudolf Group',
    fieldKeySlug: 'rudolf_group',
    countryRegion: 'Germany / global',
    productLabel: 'RUCOFIN',
    productEquivalent: 'RUCOFIN high-performance silicone softeners for textile applications.',
    activeContent: 'Polysiloxane/silicone softener technology for premium softness, hydrophilic softness, value softness, and sustainable softness.',
    distributionPresence: 'Official RUDOLF technology page.',
    sourceTitle: 'RUDOLF RUCOFIN official textile softener technology page',
    sourceUrl: 'https://rudolf.com/technologies/rucofin',
    requiredTerms: ['RUCOFIN', 'silicone softeners', 'textile'],
  },
  {
    companyName: 'Pulcra Chemicals',
    fieldKeySlug: 'pulcra_chemicals',
    countryRegion: 'Germany / global',
    productLabel: 'ADALIN / ADASIL / AQUASOFT / BELFASIN / BELSOFT / SETILON',
    productEquivalent: 'Pulcra textile softener brand family: ADALIN, ADASIL, AQUASOFT, BELFASIN, BELSOFT, SETILON.',
    activeContent: 'Textile finishing softeners for handle, surface smoothness, sewability, hydrophilicity, and elasticity.',
    distributionPresence: 'Official Pulcra textile-industry solutions page.',
    sourceTitle: 'Pulcra Chemicals textile-industry solutions official page',
    sourceUrl: 'https://www.pulcra-chemicals.com/kundenloesungen/textilindustrie/',
    requiredTerms: ['Softeners', 'ADALIN', 'textile'],
  },
  {
    companyName: 'Zschimmer & Schwarz',
    fieldKeySlug: 'zschimmer_schwarz',
    countryRegion: 'Germany / global',
    productLabel: 'Zschimmer & Schwarz textile softeners',
    productEquivalent: 'Textile softeners and finishing auxiliaries for soft handle and improved physical properties.',
    activeContent: 'Fatty acid condensate softeners based on silicone or polyethylene for textile finishing.',
    distributionPresence: 'Official Zschimmer & Schwarz textile auxiliaries page.',
    sourceTitle: 'Zschimmer & Schwarz textile auxiliaries official page',
    sourceUrl: 'https://www.zschimmer-schwarz.com/en/fibre-textile-auxiliaries/textile-auxiliaries',
    requiredTerms: ['SOFTENERS', 'textile finishing'],
  },
]

const OFFICIAL_COMPETITOR_RECOGNITION_SOURCES: OfficialCompetitorRecognitionSource[] = [
  {
    companyName: 'BASF',
    fieldKeySlug: 'basf',
    countryRegion: 'Germany / global',
    ratingLabel: '2026 CDP leadership recognition; official BASF page says BASF received A ratings for climate and forests, and A- for water security.',
    sourceTitle: 'CDP otorga a BASF el estatus de liderazgo',
    sourceUrl: 'https://www.basf.com/ar/es/media/news-releases/2026/Febrero/CDP-otorga-a-BASF-el-estatus-de-liderazgo',
    requiredTerms: ['CDP', 'calificación', 'estatus de liderazgo', 'A-'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Dow',
    fieldKeySlug: 'dow',
    countryRegion: 'United States / global',
    ratingLabel: 'Dow 2025 Sustainability Goals page says Dow aligned more than 89% of its innovation portfolio to sustainability outcomes and earned twelve Edison awards in 2024.',
    sourceTitle: 'Dow 2025 Sustainability Goals',
    sourceUrl: 'https://corporate.dow.com/en-us/purpose-in-action/2025-goals.html',
    requiredTerms: ['Dow aligned >89%', 'Record-setting twelve Edison awards', '2025 Sustainability Goals'],
    recommendedAction: 'Use this as official sustainability/innovation-recognition evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Evonik Industries',
    fieldKeySlug: 'evonik_industries',
    countryRegion: 'Germany / global',
    ratingLabel: '2025 EcoVadis Gold rating; official Evonik page says top 5% placement among globally assessed companies.',
    sourceTitle: 'EcoVadis ranks Evonik among the world’s most sustainable companies',
    sourceUrl: 'https://corporate.evonik.cn/en/media/news/ecovadis-ranks-evonik-among-the-worlds-most-sustainable-companies-289380.html',
    requiredTerms: ['EcoVadis', 'Gold rating', 'top five percent'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Stepan Company',
    fieldKeySlug: 'stepan_company',
    countryRegion: 'United States / global',
    ratingLabel: '2026 EcoVadis Silver medal; official Stepan page says top 15% globally and 89th percentile among manufacturers of chemical products.',
    sourceTitle: 'Stepan Achieves a Silver Medal in 2026 EcoVadis Assessment',
    sourceUrl: 'https://www.stepan.com/content/stepan-dot-com/en/news-events/news---events/Stepan-Achieves-Silver-Medal-in-2026-EcoVadis-Assessment.html',
    requiredTerms: ['Silver medal', 'top 15%', '89th percentile'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Kao Corporation',
    fieldKeySlug: 'kao_corporation',
    countryRegion: 'Japan / global',
    ratingLabel: 'Kao Sustainability Report 2025 release says Kao achieved CDP Triple-A in 2024 and World’s Most Ethical Companies 2025 recognition.',
    sourceTitle: 'Kao Releases Kao Sustainability Report 2025',
    sourceUrl: 'https://www.kao.com/global/en/newsroom/news/release/2025/20250613-002/',
    requiredTerms: ['Triple-A rating', 'World’s Most Ethical Companies', '2025'],
    recommendedAction: 'Use this as sustainability/ethics recognition evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Archroma',
    fieldKeySlug: 'archroma',
    countryRegion: 'Switzerland / global',
    ratingLabel: '2025 adidas adiFormulator Award: Champion status; official Archroma recognition page.',
    sourceTitle: 'Archroma recognized as top chemicals supplier for the second consecutive year',
    sourceUrl: 'https://www.archroma.com/news/archroma-recognized-as-top-chemicals-supplier-for-the-second-consecutive-year',
    requiredTerms: ['Champion status', '2025 adiFormulator Award', 'adidas'],
    recommendedAction: 'Use this as external-recognition evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Archroma',
    fieldKeySlug: 'archroma',
    countryRegion: 'Switzerland / global',
    ratingLabel: '2025 EcoVadis Gold rating; official Archroma sustainability page says top 5% in its industry.',
    sourceTitle: 'Archroma Sustainability',
    sourceUrl: 'https://www.archroma.com/sustainability',
    requiredTerms: ['EcoVadis', 'Gold', 'top 5%'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'CHT Group',
    fieldKeySlug: 'cht_group',
    countryRegion: 'Germany / global',
    ratingLabel: '2025 adidas adiFORMULATOR Award: Champion for the third time in a row; official CHT recognition page.',
    sourceTitle: 'CHT Group adiFORMULATOR AWARD 2025',
    sourceUrl: 'https://www.cht.com/en/news-media/article/adiformulator-award-2025',
    requiredTerms: ['champion', 'adiFORMULATOR AWARD', 'third time in a row'],
    recommendedAction: 'Use this as external-recognition evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'WACKER',
    fieldKeySlug: 'wacker',
    countryRegion: 'Germany / global',
    ratingLabel: 'WACKER Annual Report 2025 supplier-assessment evidence: average EcoVadis score across WACKER suppliers was 62 points.',
    sourceTitle: 'WACKER Annual Report 2025 - Upstream Value Chain',
    sourceUrl: 'https://reports.wacker.com/2025/annual-report/management-report/sustainability-report/esrs-s2-workers-in-the-value-chain/upstream-value-chain.html',
    requiredTerms: ['EcoVadis', '62 points', 'suppliers'],
    recommendedAction: 'Use this as official supplier-sustainability assessment evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'AkzoNobel',
    fieldKeySlug: 'akzonobel',
    countryRegion: 'Netherlands / global',
    ratingLabel: 'AkzoNobel 2025 sustainability progress page reports a CDP A score, 69% renewable electricity in own operations, and 84 locations using 100% renewable electricity.',
    sourceTitle: 'AkzoNobel energy use and renewable electricity',
    sourceUrl: 'https://www.akzonobel.com/en/about-us/sustainability/energy-use-and-renewable-electricity',
    requiredTerms: ['CDP A score', '69% renewable electricity', '84 locations'],
    recommendedAction: 'Use this as official sustainability-rating/progress evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Pulcra Chemicals',
    fieldKeySlug: 'pulcra_chemicals',
    countryRegion: 'Germany / global',
    ratingLabel: '2025 EcoVadis Silver Medal; official Pulcra page says 92nd percentile / top 8% of chemical companies evaluated by EcoVadis.',
    sourceTitle: 'Pulcra Chemicals Awarded EcoVadis Silver Medal for the Second Time',
    sourceUrl: 'https://www.pulcra-chemicals.com/pulcra-chemicals-awarded-ecovadis-silver-medal-for-the-second-time/',
    requiredTerms: ['EcoVadis Silver Medal', '92%', 'top 8%'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Procter & Gamble',
    fieldKeySlug: 'procter_gamble',
    countryRegion: 'United States / global',
    ratingLabel: 'P&G official awards page says P&G ranked #21 on Barron’s 100 Most Sustainable Companies in 2025 and the Advantage Report Global Scorecard ranked P&G the #1 manufacturer for the 10th consecutive year.',
    sourceTitle: 'P&G awards and recognitions',
    sourceUrl: 'https://us.pg.com/blogs/pg-awards-and-recognitions/',
    requiredTerms: ['Barron', '100 Most Sustainable Companies', '#21 ranking in 2025', 'Advantage Report Global Scorecard'],
    recommendedAction: 'Use this as official company-recognition evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Rudolf Group',
    fieldKeySlug: 'rudolf_group',
    countryRegion: 'Germany / global',
    ratingLabel: 'RUDOLF official PCF Program certification page says TÜV SÜD certified its Product Carbon Footprint program under PACT Methodology V3 and aligned it with TfS PCF Guideline V3.',
    sourceTitle: 'RUDOLF PCF Program certified under PACT and aligned with TfS',
    sourceUrl: 'https://rudolf.com/news/rudolf-pcf-program-certified-under-pact-and-aligned-with-tfs',
    sourceTierLabel: 'Tier 2 - Official company / certification source',
    requiredTerms: ['TÜV SÜD', 'PACT Methodology V3', 'TfS'],
    recommendedAction: 'Use this as official product-carbon-footprint program certification evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Transfar',
    fieldKeySlug: 'transfar',
    countryRegion: 'China / global',
    ratingLabel: 'SGS China CIIE 2024 release says SGS presented Transfar the first SGS Green Mark bio-based content certificate for a polyester FDY oil product in China, plus several ZDHC MRSL Level 3 certifications.',
    sourceTitle: 'SGS China - Supporting Key Sustainability Goals in China’s Textile Industry at CIIE',
    sourceUrl: 'https://www.sgsgroup.com.cn/en-cn/news/2024/12/supporting-key-sustainability-goals-in-chinas-textile-industry-at-ciie',
    sourceTierLabel: 'Tier 2 - Official certification / inspection source',
    requiredTerms: ['Transfar', 'first SGS green mark bio-based content certificate', 'ZDHC MRSL Level 3'],
    recommendedAction: 'Use this as third-party certification/recognition evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
  },
  {
    companyName: 'Zschimmer & Schwarz',
    fieldKeySlug: 'zschimmer_schwarz',
    countryRegion: 'Germany / global',
    ratingLabel: 'EcoVadis Silver for ZSL; official Zschimmer & Schwarz page says top 15% of companies assessed worldwide last year.',
    sourceTitle: 'Outstanding sustainability: ZSL awarded Silver by EcoVadis',
    sourceUrl: 'https://www.zschimmer-schwarz.com/en/news/news-details/outstanding-sustainability-zsl-awarded-silver-by-ecovadis',
    requiredTerms: ['EcoVadis', 'Silver', 'top 15 %'],
    recommendedAction: 'Use this as sustainability-rating evidence only. Do not treat it as customer rating, market share, price, or product-line performance.',
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

const OFFICIAL_CHEMICAL_IDENTITY_SOURCES: OfficialChemicalIdentitySource[] = [
  {
    material: 'DMS / dimethyl sulfate',
    fieldKeySlug: 'dms_dimethyl_sulfate',
    query: 'dimethyl sulfate',
    proposedDashboardField: 'DMS chemical identity / CAS evidence',
    recommendedAction: 'Use official identity only as CAS/formula context. Still collect SDS, TDS, China regulatory/import/storage/use guidance, and supplier documentation before any business or product-development decision.',
    sensitive: true,
  },
  {
    material: 'TEA / triethanolamine',
    fieldKeySlug: 'tea_triethanolamine',
    query: 'triethanolamine',
    proposedDashboardField: 'TEA chemical identity / CAS evidence',
    recommendedAction: 'Use official identity only as raw-material identity context. Still collect current quote, SDS, TDS, COA, and supplier delivery/payment terms before supplier scoring or costing.',
  },
  {
    material: 'Stearic acid',
    fieldKeySlug: 'stearic_acid',
    query: 'stearic acid',
    proposedDashboardField: 'Stearic acid chemical identity / CAS evidence',
    recommendedAction: 'Use official identity only as raw-material identity context. Still collect quote, grade, TDS, SDS, COA, and supplier evidence before price or supplier scoring.',
  },
  {
    material: 'PDMS / polydimethylsiloxane',
    fieldKeySlug: 'pdms_polydimethylsiloxane',
    query: 'polydimethylsiloxane',
    aliases: ['poly(dimethylsiloxane)', 'dimethicone', 'silicone oil'],
    proposedDashboardField: 'PDMS silicone oil chemical identity evidence',
    recommendedAction: 'Use official identity only as silicone-material context. Still collect exact viscosity/grade TDS, SDS, COA, quote, and supplier evidence before product or sourcing decisions.',
    sensitive: true,
  },
]

const PUBLIC_COMPETITOR_PRICE_SOURCES: PublicCompetitorPriceSource[] = [
  {
    companyName: 'Stepan Company',
    fieldKeySlug: 'stepan_company',
    countryRegion: 'United States / global',
    productEquivalent: 'STEPANTEX SP-90 public customs/import price reference; not a current industrial quote.',
    sourceTitle: 'Zauba - Stepantex SP 90 imports under HS Code 29051490',
    sourceUrl: 'https://www.zauba.com/import-STEPANTEX%2BSP%2B90/hs-code-29051490-hs-code.html',
    parser: 'zauba-stepantex-sp90',
    requiredTerms: ['stepantex sp 90', 'average import price'],
    riskReason: 'Zauba is a public customs/listing reference and the visible records are historical/import-unit specific. Use only as review-gated price context, not as a current industrial textile-softener quote.',
  },
  {
    companyName: 'Evonik Industries',
    fieldKeySlug: 'evonik_industries',
    countryRegion: 'Germany / global',
    productEquivalent: 'VARISOFT EQ 65 public retail/sample price reference; not an industrial textile softener quote.',
    sourceTitle: 'Wholesale Supplies Plus - Varisoft EQ 65',
    sourceUrl: 'https://www.wholesalesuppliesplus.com/products/varisoft-eq-65',
    parser: 'wholesale-varisoft-eq65',
    requiredTerms: ['varisoft eq 65', 'regular price'],
    riskReason: 'This is a retail/cosmetic-supply listing for small packaging. Use only as review-gated public price context, not as bulk industrial textile-auxiliary pricing.',
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

const WORLD_BANK_COUNTRY_CONTEXT_COUNTRIES = [
  { country: 'China', countryCode: 'CN', fieldKeySlug: 'china' },
  { country: 'Bangladesh', countryCode: 'BD', fieldKeySlug: 'bangladesh' },
  { country: 'India', countryCode: 'IN', fieldKeySlug: 'india' },
  { country: 'Vietnam', countryCode: 'VN', fieldKeySlug: 'vietnam' },
  { country: 'Pakistan', countryCode: 'PK', fieldKeySlug: 'pakistan' },
  { country: 'Turkey', countryCode: 'TR', fieldKeySlug: 'turkey' },
  { country: 'Indonesia', countryCode: 'ID', fieldKeySlug: 'indonesia' },
  { country: 'Germany', countryCode: 'DE', fieldKeySlug: 'germany' },
  { country: 'United States', countryCode: 'US', fieldKeySlug: 'united_states' },
  { country: 'Saudi Arabia', countryCode: 'SA', fieldKeySlug: 'saudi_arabia' },
]

const WORLD_BANK_COUNTRY_CONTEXT_INDICATORS: Array<Omit<WorldBankIndicatorSource, 'country' | 'countryCode' | 'fieldKeySlug'>> = [
  {
    indicator: 'NY.GDP.MKTP.KD.ZG',
    indicatorKind: 'gdp_annual_change',
    label: 'GDP annual change',
  },
  {
    indicator: 'NV.IND.MANF.CD',
    indicatorKind: 'manufacturing_value_added_usd',
    label: 'Manufacturing value added',
  },
  {
    indicator: 'NV.IND.MANF.ZS',
    indicatorKind: 'manufacturing_value_added_share',
    label: 'Manufacturing share of GDP',
  },
  {
    indicator: 'TX.VAL.MRCH.CD.WT',
    indicatorKind: 'merchandise_exports_usd',
    label: 'Merchandise exports',
  },
  {
    indicator: 'TM.VAL.MRCH.CD.WT',
    indicatorKind: 'merchandise_imports_usd',
    label: 'Merchandise imports',
  },
  {
    indicator: 'LP.LPI.OVRL.XQ',
    indicatorKind: 'logistics_performance_index',
    label: 'Logistics performance index',
  },
]

const WORLD_BANK_COUNTRY_CONTEXT_SOURCES: WorldBankIndicatorSource[] = WORLD_BANK_COUNTRY_CONTEXT_COUNTRIES.flatMap(country =>
  WORLD_BANK_COUNTRY_CONTEXT_INDICATORS.map(indicator => ({
    ...country,
    ...indicator,
  })),
)

const MARKET_REFERENCE_SOURCES: MarketReferenceSource[] = [
  {
    fieldKeySlug: 'future_market_insights_esterquats',
    sourceTitle: 'Future Market Insights - Esterquats Market',
    sourceUrl: 'https://www.futuremarketinsights.com/reports/esterquats-market',
    parser: 'future-market-insights-esterquats',
  },
  {
    fieldKeySlug: 'persistence_market_research_esterquats',
    sourceTitle: 'Persistence Market Research - Esterquats Market',
    sourceUrl: 'https://www.persistencemarketresearch.com/market-research/esterquats-market.asp',
    parser: 'persistence-esterquats',
  },
  {
    fieldKeySlug: 'grandview_esterquats',
    sourceTitle: 'Grand View Research - Esterquats Market Size, Share & Trends',
    sourceUrl: 'https://www.grandviewresearch.com/industry-analysis/esterquats-market',
    parser: 'grandview-esterquats',
  },
  {
    fieldKeySlug: 'fortune_esterquats',
    sourceTitle: 'Fortune Business Insights - Esterquats Market',
    sourceUrl: 'https://www.fortunebusinessinsights.com/esterquats-market-102891',
    parser: 'fortune-esterquats',
  },
  {
    fieldKeySlug: 'research360_esterquat',
    sourceTitle: '360 Research Reports - Esterquat Market',
    sourceUrl: 'https://www.360researchreports.com/market-reports/esterquat-market-204218',
    parser: 'research360-esterquat',
  },
]

const MARKET_REFERENCE_TRAFFIC_SOURCES: MarketReferenceTrafficSource[] = [
  {
    companyName: 'BASF',
    fieldKeySlug: 'basf',
    countryRegion: 'Germany / global',
    domain: 'basf.com',
    sourceTitle: 'Semrush website traffic overview - basf.com',
    sourceUrl: 'https://www.semrush.com/website/basf.com/overview/',
  },
  {
    companyName: 'Evonik Industries',
    fieldKeySlug: 'evonik_industries',
    countryRegion: 'Germany / global',
    domain: 'evonik.com',
    sourceTitle: 'Semrush website traffic overview - evonik.com',
    sourceUrl: 'https://www.semrush.com/website/evonik.com/overview/',
  },
  {
    companyName: 'Stepan Company',
    fieldKeySlug: 'stepan_company',
    countryRegion: 'United States / global',
    domain: 'stepan.com',
    sourceTitle: 'Semrush website traffic overview - stepan.com',
    sourceUrl: 'https://www.semrush.com/website/stepan.com/overview/',
  },
  {
    companyName: 'Dow',
    fieldKeySlug: 'dow',
    countryRegion: 'United States / global',
    domain: 'dow.com',
    sourceTitle: 'Semrush website traffic overview - dow.com',
    sourceUrl: 'https://www.semrush.com/website/dow.com/overview/',
  },
  {
    companyName: 'AkzoNobel',
    fieldKeySlug: 'akzonobel',
    countryRegion: 'Netherlands / global',
    domain: 'akzonobel.com',
    sourceTitle: 'Semrush website traffic overview - akzonobel.com',
    sourceUrl: 'https://www.semrush.com/website/akzonobel.com/overview/',
  },
  {
    companyName: 'Procter & Gamble',
    fieldKeySlug: 'procter_gamble',
    countryRegion: 'United States / global',
    domain: 'pg.com',
    sourceTitle: 'Semrush website traffic overview - pg.com',
    sourceUrl: 'https://www.semrush.com/website/pg.com/overview/',
  },
  {
    companyName: 'WACKER',
    fieldKeySlug: 'wacker',
    countryRegion: 'Germany / global',
    domain: 'wacker.com',
    sourceTitle: 'Semrush website traffic overview - wacker.com',
    sourceUrl: 'https://www.semrush.com/website/wacker.com/overview/',
  },
  {
    companyName: 'CHT Group',
    fieldKeySlug: 'cht_group',
    countryRegion: 'Germany / global',
    domain: 'cht.com',
    sourceTitle: 'Semrush website traffic overview - cht.com',
    sourceUrl: 'https://www.semrush.com/website/cht.com/overview/',
  },
  {
    companyName: 'Archroma',
    fieldKeySlug: 'archroma',
    countryRegion: 'Switzerland / global',
    domain: 'archroma.com',
    sourceTitle: 'Semrush website traffic overview - archroma.com',
    sourceUrl: 'https://www.semrush.com/website/archroma.com/overview/',
  },
  {
    companyName: 'Kao Corporation',
    fieldKeySlug: 'kao_corporation',
    countryRegion: 'Japan / global',
    domain: 'kao.com',
    sourceTitle: 'Semrush website traffic overview - kao.com',
    sourceUrl: 'https://www.semrush.com/website/kao.com/overview/',
  },
  {
    companyName: 'Transfar',
    fieldKeySlug: 'transfar',
    countryRegion: 'China / global',
    domain: 'transfarchem.com',
    sourceTitle: 'Semrush website traffic overview - transfarchem.com',
    sourceUrl: 'https://www.semrush.com/website/transfarchem.com/overview/',
  },
  {
    companyName: 'Rudolf Group',
    fieldKeySlug: 'rudolf_group',
    countryRegion: 'Germany / global',
    domain: 'rudolf.com',
    sourceTitle: 'Semrush website traffic overview - rudolf.com',
    sourceUrl: 'https://www.semrush.com/website/rudolf.com/overview/',
  },
  {
    companyName: 'Zschimmer & Schwarz',
    fieldKeySlug: 'zschimmer_schwarz',
    countryRegion: 'Germany / global',
    domain: 'zschimmer-schwarz.com',
    sourceTitle: 'Semrush website traffic overview - zschimmer-schwarz.com',
    sourceUrl: 'https://www.semrush.com/website/zschimmer-schwarz.com/overview/',
  },
  {
    companyName: 'Pulcra Chemicals',
    fieldKeySlug: 'pulcra_chemicals',
    countryRegion: 'Germany / global',
    domain: 'pulcra-chemicals.com',
    sourceTitle: 'Semrush website traffic overview - pulcra-chemicals.com',
    sourceUrl: 'https://www.semrush.com/website/pulcra-chemicals.com/overview/',
  },
  {
    companyName: 'Syensqo / Solvay',
    fieldKeySlug: 'syensqo_solvay',
    countryRegion: 'Belgium / global',
    domain: 'syensqo.com',
    sourceTitle: 'Semrush website traffic overview - syensqo.com',
    sourceUrl: 'https://www.semrush.com/website/syensqo.com/overview/',
  },
]

const TRANCO_TRAFFIC_RANK_SOURCES: TrancoTrafficRankSource[] = MARKET_REFERENCE_TRAFFIC_SOURCES.map(source => ({
  companyName: source.companyName,
  fieldKeySlug: source.fieldKeySlug,
  countryRegion: source.countryRegion,
  domain: source.domain,
}))

const MARKET_REFERENCE_COMPETITOR_FINANCIAL_SOURCES: MarketReferenceCompetitorFinancialSource[] = [
  {
    companyName: 'Archroma',
    fieldKeySlug: 'archroma',
    countryRegion: 'Switzerland / global',
    sourceTitle: 'S&P Global Ratings - Archroma research update',
    sourceUrl: 'https://www.spglobal.com/ratings/en/regulatory/article/-/view/type/HTML/id/3539926',
    parser: 'spglobal-archroma-2025',
  },
  {
    companyName: 'Transfar',
    fieldKeySlug: 'transfar',
    countryRegion: 'China / global',
    sourceTitle: 'StockAnalysis / S&P Global Market Intelligence - Transfar Zhilian revenue by segment',
    sourceUrl: 'https://stockanalysis.com/quote/she/002010/financials/metrics/',
    parser: 'stockanalysis-transfar-2025',
  },
]

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
  includeOfficialRecognitionConnectors?: boolean
  includeOfficialSupplierConnectors?: boolean
  includeOfficialChemicalIdentityConnectors?: boolean
  includePublicPriceEvidenceConnectors?: boolean
  includeOfficialTradeConnectors?: boolean
  includeOfficialWorldBankConnectors?: boolean
  includeMarketReferenceConnectors?: boolean
  includeMarketReferenceTrafficConnectors?: boolean
  includeTrancoTrafficConnectors?: boolean
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
    '- Preserve target identity on every item: dashboardGroup must match the containing array, fieldKey must be stable, and proposedDashboardField must name the exact dashboard cell/card to update or review.',
    '- Each item should include dashboardGroup, fieldKey when known, proposedDashboardField, field/title/label, value, sourceTitle, sourceUrl or sourceDate, sourceTier, lastChecked, confidence, evidenceStatus, reviewRequired, riskReason, dataType, and sensitive when applicable.',
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
  if (/no source-backed|awaiting trusted-source import|source search running|auto-checking|review required|restricted/i.test(text)) return false
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

function financialTargetSatisfied(state: DashboardIntelligenceState, target: CoverageTarget): boolean {
  if (state.financialModels.length === 0) return false
  const text = normalizeCoverageAlias(state.financialModels
    .map(item => [
      firstString(item.scenarioName),
      firstString(item.projectName),
      firstString(item.totalInvestment),
      firstString(item.irr),
      firstString(item.npv),
      firstString(item.paybackYear),
      firstString(item.profitabilityIndex),
      firstString(item.fiveYearRoi),
      firstString(item.yearOneRevenue),
      Array.isArray(item.warnings) ? item.warnings.join(' ') : '',
    ].join(' '))
    .join(' '))
  return target.aliases.some(alias => coverageTextHasAlias(text, alias))
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
  if (row.textScope === 'financial') {
    return financialTargetSatisfied(state, target)
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
    state.rawMaterialSignals.length > 0 ||
    state.supplierScorecards.length > 0 ||
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
  const reusableExisting = existing || beforeJobs.find(job => isMissingCoverageFollowUpJobRecord(job))
  let jobId = reusableExisting ? getJobId(reusableExisting) : ''

  if (jobId && reusableExisting && !isMissingCoverageFollowUpJobRecord(reusableExisting, signature)) {
    await runHermesCron(profile, [
      'cron',
      'edit',
      jobId,
      '--name',
      FULL_DASHBOARD_MISSING_COVERAGE_JOB_NAME,
      '--schedule',
      FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      '--deliver',
      'local',
      '--prompt',
      missingCoveragePrompt(missingRows, signature),
    ], CREATE_TIMEOUT_MS)
  }

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
  akzonobel: 'AkzoNobel',
  akzo_nobel: 'AkzoNobel',
  procter_gamble: 'Procter & Gamble',
  procter_and_gamble: 'Procter & Gamble',
  p_g: 'Procter & Gamble',
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
  if (text.includes('tier2') || text.includes('tier 2') || text.includes('company') || text.includes('catalog') || text.includes('product source') || text.includes('certification') || text.includes('inspection source')) return 'tier2-company-official'
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
  if (domainMatches(domain, TRUSTED_CERTIFICATION_SOURCE_DOMAINS)) return 'tier2-company-official'
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
  if (!title) return null
  const source: Record<string, unknown> = { title }
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
  const reviewGatedMarketShareContext =
    input.field === 'marketShare' &&
    input.evidenceStatus === 'Market Reference' &&
    input.reviewRequired === true &&
    input.tier === 'tier4-market-reference' &&
    /collective|collectively|not company-specific|individual share not|not published/i.test(input.value)
  const reviewGatedCompanyMarketShare =
    input.field === 'marketShare' &&
    input.evidenceStatus === 'Market Reference' &&
    input.reviewRequired === true &&
    input.tier === 'tier4-market-reference' &&
    /\b\d[\d,.]*\s*%/.test(input.value) &&
    /global esterquat share|company-specific|market-reference estimate/i.test(input.value) &&
    !/collective|collectively|individual company share not|not published/i.test(input.value)
  const reviewGatedPublicPriceReference =
    input.field === 'pricingEvidence' &&
    input.evidenceStatus === 'Reference Only' &&
    input.reviewRequired === true &&
    input.dataType === 'price_data' &&
    (input.tier === 'tier5-public-listing' || input.tier === 'tier4-market-reference') &&
    /price|\$|usd|\/lb|\/kg|quote|listing|customs|import/i.test(input.value)
  const lowRiskMarketReferenceMetric =
    (input.field === 'traffic' || input.field === 'rating' || input.field === 'lastUpdated') &&
    input.evidenceStatus === 'Market Reference'
  const companyFinancialMarketReferenceMetric =
    (input.field === 'revenue' || input.field === 'yearlyGrowth' || input.field === 'lastUpdated') &&
    input.evidenceStatus === 'Market Reference' &&
    input.reviewRequired === false &&
    input.tier === 'tier4-market-reference'
  if (!isTrustedMetricEvidence(input.evidenceStatus) && !lowRiskMarketReferenceMetric && !companyFinancialMarketReferenceMetric && !reviewGatedMarketShareContext && !reviewGatedCompanyMarketShare && !reviewGatedPublicPriceReference) return false
  if (input.confidence !== 'high' && !lowRiskMarketReferenceMetric && !companyFinancialMarketReferenceMetric && !reviewGatedMarketShareContext && !reviewGatedCompanyMarketShare && !reviewGatedPublicPriceReference) return false
  if ((input.tier === 'tier5-public-listing' || input.tier === 'candidate-source') && !reviewGatedPublicPriceReference) return false

  if (input.field === 'pricingEvidence') {
    return (input.reviewRequired === false && input.tier === 'tier3-supplier-evidence') ||
      reviewGatedPublicPriceReference
  }

  if (input.field === 'marketShare') {
    return reviewGatedMarketShareContext ||
      reviewGatedCompanyMarketShare ||
      (input.reviewRequired === false && (input.tier === 'tier1-official' || input.tier === 'tier2-company-official'))
  }

  if (input.field === 'traffic' || input.field === 'rating') {
    return input.reviewRequired === false
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
  const isSourceBackedCollectiveShareContext =
    /50\s*[-–]\s*60%/i.test(value) &&
    /collective|market-reference|individual company share not published/i.test(value)
  if (isSourceBackedCollectiveShareContext) {
    return SCREENSHOT_FAKE_VALUES
      .filter(fakeValue => fakeValue !== '60%')
      .some(fakeValue => value.includes(fakeValue))
  }
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
  const metricValue = COMPETITOR_SOURCE_BACKED_METRIC_FIELDS
    .map(field => competitorMetricText(item, field))
    .find(value => value)
  return firstString(
    metricValue,
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
    rawMaterialSignals: asArray(raw?.rawMaterialSignals),
    supplierScorecards: asArray(raw?.supplierScorecards),
    regulatoryFindings: asArray(raw?.regulatoryFindings),
    financialEvidence: asArray(raw?.financialEvidence),
    presentationMaterials: asArray(raw?.presentationMaterials),
    suggestedTasks: asArray(raw?.suggestedTasks),
    investorMaterialCandidates: asArray(raw?.investorMaterialCandidates),
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

function canonicalCompetitorCompanyName(value: unknown): string {
  const text = stringValue(value)
  if (!text) return ''
  return KNOWN_COMPETITOR_NAME_BY_SLUG[normalizeHeader(text)] || text
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
    const metricEvidence = mergeCompetitorMetricEvidence(...group)
    if (Object.keys(metricEvidence).length > 0) merged.metricEvidence = metricEvidence
    merged.companyName = canonicalCompetitorCompanyName(merged.companyName)
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

function pruneMalformedMarketReferenceClaims(state: DashboardIntelligenceState): number {
  const invalidValuePattern = /Review market-reference methodology and approve only if the source is acceptable/i
  const oversizedCompetitorSetPattern = /Frequently Asked Questions|Related Reports|Not Every Business|Get Your Customization/i
  const isMalformed = (record: Record<string, unknown>): boolean => {
    const value = stringValue(record.value)
    if (invalidValuePattern.test(value)) return true
    if (
      /key competitor set/i.test(stringValue(record.label)) &&
      (value.length > 800 || oversizedCompetitorSetPattern.test(value))
    ) return true
    return false
  }
  const beforeClaims = state.marketClaims.length
  state.marketClaims = state.marketClaims.filter(claim => {
    if (stringValue(claim.evidenceStatus) !== 'Market Reference') return true
    return !isMalformed(claim)
  })

  const beforeFindings = state.researchFindings.length
  state.researchFindings = state.researchFindings.filter(finding => {
    if (stringValue(finding.evidenceStatus) !== 'Market Reference') return true
    const keyClaim = stringValue(finding.keyClaim)
    if (invalidValuePattern.test(keyClaim)) return false
    if (/key competitor set/i.test(keyClaim) && (keyClaim.length > 900 || oversizedCompetitorSetPattern.test(keyClaim))) return false
    return true
  })

  return (beforeClaims - state.marketClaims.length) + (beforeFindings - state.researchFindings.length)
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
  const companyName = canonicalCompetitorCompanyName(firstString(input.item.companyName, input.item.title, input.item.label))
  if (!companyName) return false
  const topLevelReviewRequired = Boolean(input.reasons?.length || input.item.reviewRequired === true)
  const fallbackConfidence = coerceConfidence(input.item.confidence)
  const fallbackEvidenceStatus = trustedEvidenceStatus(input.evidenceStatus, input.evidenceStatus)
  const metricValues: Partial<Record<CompetitorMetricField, string>> = {}
  const metricEvidence: CompetitorMetricEvidenceMap = {}
  let primaryMetric: {
    source: Record<string, unknown> | null
    tier: SourceTier
    confidence: Confidence
    evidenceStatus: string
  } | null = null
  let hydratedMetricReviewRequired = false

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
    metricEvidence[field] = buildCompetitorMetricEvidence({
      value,
      source,
      tier,
      confidence,
      evidenceStatus,
      reviewRequired,
      dataType,
      lastChecked: input.lastChecked,
      riskReason: firstString(nestedMetricRecord(input.item, field)?.riskReason, input.item.riskReason),
    })
    if (reviewRequired) hydratedMetricReviewRequired = true
    if (!primaryMetric || field === 'revenue' || field === 'yearlyGrowth') {
      primaryMetric = { source, tier, confidence, evidenceStatus }
    }
  }

  const recordSource = primaryMetric?.source || input.source
  const recordTier = primaryMetric?.tier || input.tier
  const recordConfidence = primaryMetric?.confidence || fallbackConfidence
  const recordEvidenceStatus = primaryMetric?.evidenceStatus || fallbackEvidenceStatus
  const recordReviewRequired = hydratedMetricReviewRequired || (primaryMetric ? false : topLevelReviewRequired)
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
    if (competitorCompanyMergeKey(competitor.companyName) !== competitorCompanyMergeKey(companyName)) return false
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
    metricEvidence,
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
    const mergedMetricEvidence = mergeCompetitorMetricEvidence(existing, importedRecord)
    if (sources.length > 0) {
      merged.sources = sources
      merged.sourceCount = sources.length
      merged.source = sourceIsUsable(merged.source as Record<string, unknown> | null)
        ? merged.source
        : sources[0]
    }
    if (Object.keys(mergedMetricEvidence).length > 0) merged.metricEvidence = mergedMetricEvidence
    merged.evidenceStatus = strongestCompetitorEvidenceStatus(
      stringValue(existing.evidenceStatus),
      stringValue(importedRecord.evidenceStatus),
    )
    merged.confidence = strongestConfidence(
      stringValue(existing.confidence),
      stringValue(importedRecord.confidence),
    )
    merged.reviewRequired = Boolean(existing.reviewRequired || importedRecord.reviewRequired)
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

function competitorMetricEvidenceMap(record: Record<string, unknown>): CompetitorMetricEvidenceMap {
  return isPlainRecord(record.metricEvidence) ? record.metricEvidence as CompetitorMetricEvidenceMap : {}
}

function buildCompetitorMetricEvidence(input: {
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
  confidence: Confidence
  evidenceStatus: string
  reviewRequired: boolean
  dataType: string
  lastChecked: string
  riskReason?: string
}): Record<string, unknown> {
  return {
    value: input.value,
    source: input.source,
    sourceTier: input.tier,
    confidence: input.confidence,
    evidenceStatus: input.evidenceStatus,
    reviewRequired: input.reviewRequired,
    dataType: input.dataType,
    lastChecked: input.lastChecked,
    sourceDate: stringValue(input.source?.date),
    riskReason: input.riskReason,
  }
}

function isCollectiveMarketShareText(value: string): boolean {
  return /collective|collectively|individual company share not|not company-specific|not published/i.test(value)
}

function mergeCompetitorMetricEvidence(...records: Array<Record<string, unknown>>): CompetitorMetricEvidenceMap {
  const merged: CompetitorMetricEvidenceMap = {}
  for (const record of records) {
    const evidenceMap = competitorMetricEvidenceMap(record)
    for (const field of COMPETITOR_SOURCE_BACKED_METRIC_FIELDS) {
      const evidence = evidenceMap[field]
      if (!isPlainRecord(evidence)) continue
      const current = merged[field]
      const nextValue = stringValue(evidence.value)
      const currentValue = isPlainRecord(current) ? stringValue(current.value) : ''
      const shouldPreferCompanySpecificShare =
        field === 'marketShare' &&
        isUsefulDashboardValue(nextValue) &&
        isCollectiveMarketShareText(currentValue) &&
        !isCollectiveMarketShareText(nextValue)
      if (!current || (!isUsefulDashboardValue(currentValue) && isUsefulDashboardValue(nextValue)) || shouldPreferCompanySpecificShare) {
        merged[field] = evidence
      }
    }
  }
  return merged
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

function shouldHydrateSupplierScorecardCandidate(input: {
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
  dataType: string
}): boolean {
  if (!sourceIsUsable(input.source)) return false
  if (!input.value || PLACEHOLDER_PATTERN.test(input.value)) return false
  if (hasKnownFakeScreenshotValue(input.value)) return false
  if (input.dataType === 'supplier_quote' || input.dataType === 'price_data') return false
  return input.tier === 'tier1-official' || input.tier === 'tier2-company-official' || input.tier === 'tier3-supplier-evidence'
}

function rawMaterialSignalText(input: {
  item: DashboardResearchUpdateItem
  field: string
  value: string
  source: Record<string, unknown> | null
}): string {
  return [
    firstString(input.item.material),
    firstString(input.item.label),
    firstString(input.item.title),
    firstString(input.item.field),
    input.field,
    input.value,
    firstString(input.item.fieldKey),
    firstString(input.source?.title),
    firstString(input.source?.url),
  ].filter(Boolean).join(' ')
}

function rawMaterialNameFromSignal(input: {
  item: DashboardResearchUpdateItem
  field: string
  value: string
  source: Record<string, unknown> | null
}): string {
  const explicit = firstString(input.item.material)
  if (explicit) return explicit
  const text = rawMaterialSignalText(input).toLowerCase()
  if (/\btea\b|triethanolamine/.test(text)) return 'TEA'
  if (/\bdms\b|dimethyl\s+sulfate|dimethyl\s+sulphate/.test(text)) return 'DMS / dimethyl sulfate'
  if (/stearic|octadecanoic/.test(text)) return 'Stearic acid 1842'
  if (/pdms|polydimethylsiloxane|poly\(dimethylsiloxane\)|silicone\s+oil/.test(text)) return 'PDMS 1000 cSt'
  if (/acetic/.test(text)) return 'Acetic acid'
  return firstString(input.item.label, input.item.title, input.field, input.item.fieldKey, 'Raw material')
}

function extractCasSignal(text: string): string {
  return text.match(/\b\d{2,7}-\d{2}-\d\b/)?.[0] || ''
}

function extractFormulaSignal(text: string): string {
  const titleFormula = text.match(/\|\s*([A-Z][A-Za-z0-9()]+(?:[A-Z][A-Za-z0-9()]+)*)\s*\|/)?.[1]
  if (titleFormula && /[A-Z][a-z]?\d*/.test(titleFormula)) return titleFormula
  const formulaText = text.match(/(?:molecular\s+formula|formula)\s+([A-Z][A-Za-z0-9()]+)/i)?.[1]
  return formulaText || ''
}

function isOfficialChemicalIdentitySignal(input: {
  value: string
  source: Record<string, unknown> | null
  item: DashboardResearchUpdateItem
  field: string
}): boolean {
  const text = [
    input.value,
    input.field,
    firstString(input.item.fieldKey),
    firstString(input.item.label),
    firstString(input.item.title),
    firstString(input.source?.title),
    firstString(input.source?.url),
  ].filter(Boolean).join(' ').toLowerCase()
  const sourceUrl = firstString(input.source?.url).toLowerCase()
  const officialSource = sourceUrl.includes('pubchem.ncbi.nlm.nih.gov') || sourceUrl.includes('comptox.epa.gov')
  const identityLanguage = /pubchem|comptox|cid\s+\d+|cas\s+(?:signal\s+)?\d{2,7}-\d{2}-\d|chemical identity|molecular formula/.test(text)
  return officialSource && identityLanguage
}

function shouldHydrateRawMaterialSignalCandidate(input: {
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
  dataType: string
  item: DashboardResearchUpdateItem
  field: string
}): boolean {
  if (!sourceIsUsable(input.source)) return false
  if (!input.value || PLACEHOLDER_PATTERN.test(input.value)) return false
  if (hasKnownFakeScreenshotValue(input.value)) return false
  if (isOfficialChemicalIdentitySignal(input)) return true
  if (input.dataType === 'price_data' || input.dataType === 'supplier_quote' || input.dataType === 'financial_data') return false
  return input.tier === 'tier1-official' || input.tier === 'tier2-company-official'
}

function appendRawMaterialSignalCandidate(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
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
  if (!shouldHydrateRawMaterialSignalCandidate(input)) return false
  const material = rawMaterialNameFromSignal(input)
  const signalText = rawMaterialSignalText(input)
  const cas = extractCasSignal(signalText)
  const formula = extractFormulaSignal(signalText)
  if (includesExisting(state.rawMaterialSignals, row =>
    stringValue(row.material).toLowerCase() === material.toLowerCase() &&
    stringValue((row.source as Record<string, unknown> | undefined)?.title) === stringValue(input.source?.title),
  )) return false

  state.rawMaterialSignals.push({
    id: stableId('autopilot-raw-material-signal', input.runKey, material, stringValue(input.source?.title)),
    fieldKey: dashboardFieldKey(input.item, 'rawMaterialSignals', input.field),
    dashboardGroup: 'rawMaterialSignals',
    group: 'rawMaterialSignals',
    material,
    label: material,
    proposedDashboardField: firstString(input.item.proposedDashboardField, input.item.field, input.item.label, `${material} identity evidence`),
    value: input.value,
    cas,
    formula,
    source: input.source,
    sourceTier: input.tier,
    reportedSourceTier: firstString(input.item.sourceTier) || undefined,
    sourceDate: firstString(input.item.sourceDate) || input.lastChecked,
    lastChecked: input.lastChecked,
    confidence: input.confidence,
    evidenceStatus: safeCandidateStatus(input.evidenceStatus),
    reviewRequired: true,
    reportedReviewRequired: typeof input.item.reviewRequired === 'boolean' ? input.item.reviewRequired : undefined,
    dataType: isOfficialChemicalIdentitySignal(input) ? 'regulatory_data' : input.dataType,
    pricePerTon: '',
    priceStatus: 'No approved price yet',
    riskReason: firstString(input.item.riskReason) || input.reasons.join('; ') || 'Official source confirms raw-material identity context only. Price, landed cost, supplier quote, formula use, handling, import/storage/use permission, and product-development conclusions remain review-gated.',
    notes: [
      input.value,
      cas ? `CAS: ${cas}` : '',
      formula ? `Formula: ${formula}` : '',
      'Visible raw-material identity signal imported from trusted source.',
      'No price, landed cost, supplier score, product formula, regulatory permission, or investor claim was auto-approved.',
      firstString(input.item.recommendedAction),
    ].filter(Boolean).join('\n'),
    updatedAt: input.lastChecked,
  })
  return true
}

function appendSupplierScorecardCandidate(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
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
  const supplier = firstString(input.item.supplier, input.item.title, input.item.label)
  const material = firstString(input.item.material, input.field)
  if (!supplier || !material) return false
  if (!shouldHydrateSupplierScorecardCandidate(input)) return false
  if (includesExisting(state.supplierScorecards, row =>
    stringValue(row.supplier).toLowerCase() === supplier.toLowerCase() &&
    stringValue(row.material).toLowerCase() === material.toLowerCase() &&
    stringValue((row.source as Record<string, unknown> | undefined)?.title) === stringValue(input.source?.title),
  )) return false

  state.supplierScorecards.push({
    id: stableId('autopilot-supplier-scorecard', input.runKey, supplier, material, stringValue(input.source?.title)),
    fieldKey: dashboardFieldKey(input.item, 'supplierScorecards', input.field),
    dashboardGroup: 'supplierScorecards',
    group: 'supplierScorecards',
    supplier,
    material,
    proposedDashboardField: firstString(input.item.proposedDashboardField, input.item.field, input.item.label, `${supplier} / ${material}`),
    value: input.value,
    source: input.source,
    sourceTier: input.tier,
    reportedSourceTier: firstString(input.item.sourceTier) || undefined,
    sourceDate: firstString(input.item.sourceDate) || input.lastChecked,
    lastChecked: input.lastChecked,
    confidence: input.confidence,
    evidenceStatus: safeCandidateStatus(input.evidenceStatus),
    reviewRequired: true,
    reportedReviewRequired: typeof input.item.reviewRequired === 'boolean' ? input.item.reviewRequired : undefined,
    dataType: input.dataType,
    pricePerTon: '',
    quality: 'Quote/TDS/SDS/COA review needed',
    reliability: 'Quote/TDS/SDS/COA review needed',
    payment: 'Quote/payment terms needed',
    score: 'Review needed',
    riskReason: firstString(input.item.riskReason) || input.reasons.join('; ') || 'Supplier source confirms product/material context, but price, payment terms, quality, reliability, landed cost, and score still need quote/TDS/SDS/COA evidence.',
    notes: [
      input.value,
      'Visible supplier scorecard context imported from trusted source.',
      'No price, payment term, quality score, reliability score, landed cost, or supplier ranking was auto-approved.',
      firstString(input.item.recommendedAction),
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
    if (input.group === 'rawMaterialSignals') {
      appendRawMaterialSignalCandidate(state, input)
    }
    if (input.group === 'supplierScorecards') {
      appendSupplierScorecardCandidate(state, input)
    }
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

function sourceReaderUrl(sourceUrl: string): string {
  return `${SOURCE_READER_PREFIX}${sourceUrl}`
}

async function fetchTextCandidate(
  fetcher: typeof fetch,
  sourceUrl: string,
  headers: Record<string, string>,
  timeoutMs = SOURCE_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  const response = await fetchWithTimeout(fetcher, sourceReaderUrl(sourceUrl), { headers }, timeoutMs)
  if (!response.ok) return null
  return response.text()
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = SOURCE_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchOfficialTextCandidate(
  fetcher: typeof fetch,
  sourceUrl: string,
  headers: Record<string, string>,
  timeoutMs = SOURCE_FETCH_TIMEOUT_MS,
): Promise<{ text: string, ok: boolean, status: number, usedReader: boolean }> {
  if (/\.pdf(?:$|[?#])/i.test(sourceUrl)) {
    const readerText = await fetchTextCandidate(fetcher, sourceUrl, headers, timeoutMs)
    if (readerText) return { text: readerText, ok: true, status: 200, usedReader: true }
  }

  try {
    const response = await fetchWithTimeout(fetcher, sourceUrl, { headers }, timeoutMs)
    if (response.ok) {
      const text = await response.text()
      if (/^%PDF-/i.test(text.slice(0, 20))) {
        const readerText = await fetchTextCandidate(fetcher, sourceUrl, headers, timeoutMs)
        if (readerText) return { text: readerText, ok: true, status: response.status, usedReader: true }
      }
      return { text, ok: true, status: response.status, usedReader: false }
    }
    const readerText = await fetchTextCandidate(fetcher, sourceUrl, headers, timeoutMs)
    return { text: readerText || '', ok: Boolean(readerText), status: response.status, usedReader: Boolean(readerText) }
  } catch {
    const readerText = await fetchTextCandidate(fetcher, sourceUrl, headers, timeoutMs)
    return { text: readerText || '', ok: Boolean(readerText), status: 0, usedReader: Boolean(readerText) }
  }
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
    'https://comtradeapi.un.org/data/v1/get/C/A/HS',
    `?cmdCode=${COMTRADE_TEXTILE_FINISHING_HS_CODE}`,
    '&flowCode=M',
    `&reporterCode=${source.reporterCode}`,
    `&period=${period}`,
    '&partnerCode=0',
    '&partner2Code=0',
    '&customsCode=C00',
    '&motCode=0',
    '&maxRecords=100000',
    '&includeDesc=true',
  ].join('')
}

function comtradePublicPreviewApiUrl(source: ComtradeMarketProxySource, period = '2023,2024'): string {
  return [
    'https://comtradeapi.un.org/public/v1/preview/C/A/HS',
    `?cmdCode=${COMTRADE_TEXTILE_FINISHING_HS_CODE}`,
    '&flowCode=M',
    `&reporterCode=${source.reporterCode}`,
    `&period=${period}`,
    '&partnerCode=0',
    '&partner2Code=0',
    '&customsCode=C00',
    '&motCode=0',
    '&maxRecords=100000',
    '&includeDesc=true',
  ].join('')
}

function comtradeSubscriptionKey(): string {
  return firstString(
    process.env.UN_COMTRADE_SUBSCRIPTION_KEY,
    process.env.COMTRADE_SUBSCRIPTION_KEY,
    process.env.UN_COMTRADE_API_KEY,
    process.env.COMTRADE_API_KEY,
  )
}

function comtradeApiRequestUrl(source: ComtradeMarketProxySource, period = '2023,2024'): string {
  const key = comtradeSubscriptionKey()
  const baseUrl = key ? comtradeApiUrl(source, period) : comtradePublicPreviewApiUrl(source, period)
  return key ? `${baseUrl}&subscription-key=${encodeURIComponent(key)}` : baseUrl
}

function worldBankIndicatorApiUrl(source: WorldBankIndicatorSource): string {
  return `https://api.worldbank.org/v2/country/${encodeURIComponent(source.countryCode)}/indicator/${encodeURIComponent(source.indicator)}?format=json&per_page=80`
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

function worldBankIndicatorMetricsFromPayload(payload: unknown): WorldBankIndicatorMetric[] {
  const rows = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : []
  return rows
    .filter(isPlainRecord)
    .map(row => {
      const year = Number(row.date)
      const value = Number(row.value)
      const indicator = isPlainRecord(row.indicator) ? row.indicator : {}
      const country = isPlainRecord(row.country) ? row.country : {}
      return {
        year,
        value,
        indicatorName: firstString(indicator.value),
        countryName: firstString(country.value),
        sourceUpdated: firstString(row.lastupdated),
      }
    })
    .filter(metric => Number.isFinite(metric.year) && Number.isFinite(metric.value))
    .sort((left, right) => left.year - right.year)
}

function pubChemProperty(raw: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(raw)) return null
  const rows = isPlainRecord(raw.PropertyTable) && Array.isArray(raw.PropertyTable.Properties)
    ? raw.PropertyTable.Properties
    : []
  return isPlainRecord(rows[0]) ? rows[0] : null
}

function pubChemSynonyms(raw: unknown): string[] {
  return pubChemSynonymPayload(raw).synonyms
}

function pubChemSynonymPayload(raw: unknown): { synonyms: string[], sid: string } {
  if (!isPlainRecord(raw) || !isPlainRecord(raw.InformationList)) return { synonyms: [], sid: '' }
  const rows = Array.isArray(raw.InformationList.Information) ? raw.InformationList.Information : []
  const row = rows.find(isPlainRecord) || {}
  const synonyms = isPlainRecord(row) && Array.isArray(row.Synonym) ? row.Synonym : []
  return {
    synonyms: synonyms.map(stringValue).filter(Boolean).slice(0, 160),
    sid: firstString((row as Record<string, unknown>).SID),
  }
}

function firstCasNumber(values: string[]): string {
  for (const item of values) {
    const match = item.match(/\b\d{2,7}-\d{2}-\d\b/)
    if (match?.[0]) return match[0]
  }
  return ''
}

function pubChemLookupNames(source: OfficialChemicalIdentitySource): string[] {
  const seen = new Set<string>()
  const values = [source.query, ...(source.aliases || [])]
  return values.filter(value => {
    const normalized = value.trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchPubChemIdentityPayload(
  fetcher: typeof fetch,
  source: OfficialChemicalIdentitySource,
  headers: Record<string, string>,
): Promise<{ payload: PubChemIdentityPayload | null, error: string }> {
  let lastError = ''

  for (const lookupName of pubChemLookupNames(source)) {
    const encoded = encodeURIComponent(lookupName)
    const [propertyResponse, synonymsResponse] = await Promise.all([
      fetchWithTimeout(fetcher, `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/property/MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES/JSON`, { headers }),
      fetchWithTimeout(fetcher, `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/synonyms/JSON`, { headers }),
    ])

    if (propertyResponse.ok) {
      const propertyRaw = await propertyResponse.json()
      const synonymsRaw = synonymsResponse.ok ? await synonymsResponse.json() : { InformationList: { Information: [] } }
      const property = pubChemProperty(propertyRaw)
      if (property) {
        return {
          payload: {
            chemicalName: source.query,
            lookupName,
            property,
            synonyms: pubChemSynonyms(synonymsRaw),
            sourceKind: 'compound',
          },
          error: '',
        }
      }
      lastError = `PubChem compound property row empty for ${lookupName}`
    } else {
      lastError = `PubChem compound property API returned ${propertyResponse.status || 'unreachable'} for ${lookupName}`
    }

    const substanceResponse = await fetchWithTimeout(fetcher, `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/name/${encoded}/synonyms/JSON`, { headers })
    if (substanceResponse.ok) {
      const synonymPayload = pubChemSynonymPayload(await substanceResponse.json())
      if (synonymPayload.synonyms.length > 0) {
        return {
          payload: {
            chemicalName: source.query,
            lookupName,
            property: null,
            synonyms: synonymPayload.synonyms,
            substanceSid: synonymPayload.sid,
            sourceKind: 'substance',
          },
          error: '',
        }
      }
      lastError = `PubChem substance synonym row empty for ${lookupName}`
    } else {
      lastError = `PubChem substance synonym API returned ${substanceResponse.status || 'unreachable'} for ${lookupName}`
    }
  }

  return { payload: null, error: lastError || 'PubChem identity row unavailable' }
}

function pubChemIdentityValue(source: OfficialChemicalIdentitySource, payload: PubChemIdentityPayload): string {
  const property = payload.property || {}
  const cid = firstString(property.CID)
  const formula = firstString(property.MolecularFormula)
  const molecularWeight = firstString(property.MolecularWeight)
  const iupacName = firstString(property.IUPACName, source.query)
  const cas = firstCasNumber(payload.synonyms)
  if (!payload.property) {
    const synonymSample = payload.synonyms
      .filter(item => item !== cas)
      .slice(0, 3)
      .join('; ')
    return [
      `PubChem ${source.material}:`,
      payload.substanceSid ? `SID ${payload.substanceSid};` : 'substance synonym record;',
      cas ? `CAS signal ${cas};` : 'CAS signal To Verify;',
      'compound CID unavailable from PubChem name property lookup;',
      synonymSample ? `synonym evidence ${synonymSample}.` : `lookup ${payload.lookupName || payload.chemicalName}.`,
    ].filter(Boolean).join(' ')
  }
  return [
    `PubChem ${source.material}:`,
    cid ? `CID ${cid};` : '',
    cas ? `CAS signal ${cas};` : 'CAS signal To Verify;',
    formula ? `molecular formula ${formula};` : '',
    molecularWeight ? `MW ${molecularWeight};` : '',
    `IUPAC ${iupacName}.`,
  ].filter(Boolean).join(' ')
}

function pubChemIdentitySourceUrl(source: OfficialChemicalIdentitySource, payload: PubChemIdentityPayload): string {
  const cid = firstString(payload.property?.CID)
  if (cid) return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`
  const sid = firstString(payload.substanceSid)
  if (sid) return `https://pubchem.ncbi.nlm.nih.gov/substance/${sid}`
  return `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(payload.lookupName || source.query)}`
}

function pubChemIdentityPayloadToRawMaterialUpdate(
  source: OfficialChemicalIdentitySource,
  payload: PubChemIdentityPayload,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  if (!payload.property && payload.synonyms.length === 0) return null
  const value = pubChemIdentityValue(source, payload)
  return {
    fieldKey: `raw_material_identity.${source.fieldKeySlug}.pubchem`,
    label: source.material,
    material: source.material,
    proposedDashboardField: source.proposedDashboardField,
    field: `${source.material} chemical identity`,
    value,
    sourceTitle: payload.property
      ? `PubChem official chemical identity: ${source.material}`
      : `PubChem official substance synonym identity: ${source.material}`,
    sourceUrl: pubChemIdentitySourceUrl(source, payload),
    sourceTier: 'Tier 1 - Official / regulator / chemical database source',
    sourceDate: checkedAt,
    lastChecked: checkedAt,
    confidence: 'high',
    evidenceStatus: 'Official Data',
    reviewRequired: true,
    dataType: 'regulatory_data',
    sensitive: source.sensitive === true,
    recommendedAction: source.recommendedAction,
    riskReason: payload.property
      ? 'PubChem confirms chemical identity only. This is not SDS/TDS/COA evidence, not supplier quote evidence, not China regulatory approval, not formula approval, and not factory/import/storage/use permission.'
      : 'PubChem substance synonyms provide identity context only after compound CID lookup failed. This is not formula proof, SDS/TDS/COA evidence, supplier quote evidence, China regulatory approval, or factory/import/storage/use permission.',
  }
}

function officialCompanyFinancialMetricFromText(
  source: OfficialCompanyFinancialSource,
  text: string,
): OfficialCompanyFinancialMetric | null {
  const normalized = normalizeHtmlText(text)

  if (source.parser === 'basf-report-2025') {
    const match = normalized.match(/sales stood at\s*(?:€|EUR)\s*([\d,.]+)\s*million\s*,?\s*compared with\s*(?:€|EUR)\s*([\d,.]+)\s*million/i)
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
    const reportMatch = normalized.match(/Group[’']s\s*(?:€|EUR)\s*([\d,.]+)\s*billion in sales in 2025,?\s*\(2024:\s*(?:€|EUR)\s*([\d,.]+)\s*billion\s*\)/i)
    const releaseMatch = normalized.match(/Group sales total\s*(?:€|EUR)\s*([\d,.]+)\s*billion,?\s*down\s*([\d,.]+)\s*percent on prior-year level/i)
    const latest = Number((reportMatch?.[1] || releaseMatch?.[1] || '').replace(/,/g, ''))
    const previous = reportMatch ? Number(reportMatch[2].replace(/,/g, '')) : null
    const growth = reportMatch && previous
      ? ((latest - previous) / previous) * 100
      : releaseMatch
        ? -Math.abs(Number(releaseMatch[2].replace(/,/g, '')))
        : null
    if (!Number.isFinite(latest) || !Number.isFinite(growth)) return null
    return {
      year: 2025,
      revenueValue: `FY2025 company-wide sales: €${latest.toFixed(3).replace(/\.?0+$/, '')}B (official rounded figure)`,
      growthValue: reportMatch && Number.isFinite(previous)
        ? `FY2025 company-wide sales YoY: ${formatSignedPercent(growth as number)} vs FY2024 €${(previous as number).toFixed(3).replace(/\.?0+$/, '')}B`
        : `FY2025 company-wide sales YoY: ${formatSignedPercent(growth as number)} vs FY2024, per official WACKER report`,
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

  if (source.parser === 'syensqo-results-2025') {
    const revenueMatch = normalized.match(/FY\s*2025\s+Highlights\s+\*?\s*Net sales of €\s*([\d,.]+)\s*billion/i) ||
      normalized.match(/Net sales of €\s*([\d,.]+)\s*billion[^.]*FY\s*2025/i)
    if (!revenueMatch) return null
    const latest = Number(revenueMatch[1].replace(/,/g, ''))
    if (!Number.isFinite(latest)) return null
    const tableMatch = normalized.match(/Net sales\s+[\d,]+\s+[\d,]+\s+[\d,]+\s*-?[\d.]+%\s*-?[\d.]+%\s*-?[\d.]+%\s+([\d,]+)\s+([\d,]+)\s*(-?[\d.]+)%/i)
    const growth = tableMatch ? Number(tableMatch[3].replace(/,/g, '')) : null
    return {
      year: 2025,
      revenueValue: `FY2025 company-wide net sales: €${latest.toFixed(3).replace(/\.?0+$/, '')}B`,
      growthValue: Number.isFinite(growth)
        ? `FY2025 company-wide net sales YoY: ${formatSignedPercent(growth as number)} vs FY2024, per regulated Syensqo results release`
        : undefined,
    }
  }

  if (source.parser === 'cht-growth-2024') {
    const match = normalized.match(/recorded sales growth to EUR\s*([\d,.]+)\s*million\s*\(\+?([\d,.]+)%\)/i)
    if (!match) return null
    const latest = Number(match[1].replace(/,/g, ''))
    const growth = Number(match[2].replace(/,/g, ''))
    if (!Number.isFinite(latest) || !Number.isFinite(growth)) return null
    return {
      year: 2024,
      revenueValue: `FY2024 company-wide sales: €${latest.toFixed(1).replace(/\.?0+$/, '')}M (official preliminary figure)`,
      growthValue: `FY2024 company-wide sales YoY: ${formatSignedPercent(growth)} per official CHT press release`,
    }
  }

  if (source.parser === 'zschimmer-turnover-2023') {
    const match = normalized.match(/turnover increasing by\s*([\d,.]+)\s*million to almost\s*([\d,.]+)\s*million euros/i)
    if (!match) return null
    const increase = Number(match[1].replace(/,/g, ''))
    const latest = Number(match[2].replace(/,/g, ''))
    if (!Number.isFinite(latest) || !Number.isFinite(increase)) return null
    return {
      year: 2023,
      revenueValue: `Official company scale: turnover almost €${latest.toLocaleString('en-US')}M (Zschimmer & Schwarz release says turnover increased by €${increase.toLocaleString('en-US')}M over 15 years)`,
    }
  }

  if (source.parser === 'pulcra-csrd-2023') {
    const match = normalized.match(/revenue for the year decreased by EUR\s*([\d,.]+)\s*million\s*\(([\d,.]+)%\)\s*to EUR\s*([\d,.]+)\s*million\s*\(previous year:\s*EUR\s*([\d,.]+)\s*million\)/i) ||
      normalized.match(/Our revenue for the year decreased by EUR\s*([\d,.]+)\s*million\s*\(([\d,.]+)%\)\s*to EUR\s*([\d,.]+)\s*million\s*\(previous year:\s*EUR\s*([\d,.]+)\s*million\)/i)
    if (!match) return null
    const decrease = Number(match[1].replace(/,/g, ''))
    const decreasePercent = Number(match[2].replace(/,/g, ''))
    const latest = Number(match[3].replace(/,/g, ''))
    const previous = Number(match[4].replace(/,/g, ''))
    if (!Number.isFinite(latest) || !Number.isFinite(previous) || !Number.isFinite(decrease) || !Number.isFinite(decreasePercent)) return null
    return {
      year: 2023,
      revenueValue: `FY2023 Pulcra Germany GmbH net revenue: €${latest.toFixed(1).replace(/\.?0+$/, '')}M (CSRD statement; previous year €${previous.toFixed(1).replace(/\.?0+$/, '')}M)`,
      growthValue: `FY2023 Pulcra Germany GmbH revenue YoY: ${formatSignedPercent(-Math.abs(decreasePercent))}; decrease €${decrease.toFixed(1).replace(/\.?0+$/, '')}M per CSRD statement`,
    }
  }

  if (source.parser === 'akzonobel-q1-2026') {
    const match = normalized.match(/\bRevenue\s+([\d,.]+)\s+([\d,.]+)\s+\(?(-?[\d.]+)%\)?/i)
    if (!match) return null
    const previous = Number(match[1].replace(/,/g, ''))
    const latest = Number(match[2].replace(/,/g, ''))
    const rawGrowth = Number(match[3].replace(/,/g, ''))
    if (!Number.isFinite(latest) || !Number.isFinite(previous) || !Number.isFinite(rawGrowth)) return null
    const growth = /\([\d.]+%\)/.test(match[0]) ? -Math.abs(rawGrowth) : rawGrowth
    return {
      year: 2026,
      revenueValue: `Q1 2026 company-wide revenue: ${compactOfficialNumber(latest, '€')} (official reported €${latest.toLocaleString('en-US')} million)`,
      growthValue: `Q1 2026 company-wide revenue YoY: ${formatSignedPercent(growth)} vs Q1 2025 ${compactOfficialNumber(previous, '€')}`,
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
    lastUpdated: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.last_updated`,
      value: String(metric.year),
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 2 - Official company / financial report source',
      lastChecked: checkedAt,
      sourceDate: String(metric.year),
      confidence: 'high',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
      dataType: 'competitor_data',
      riskReason: 'Source date for official company financial evidence. This does not verify product-line pricing, market share, or investor-ready financial outputs.',
    },
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
    lastUpdated: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.last_updated`,
      value: checkedAt,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 2 - Official company / product source',
      sourceDate: checkedAt,
      lastChecked: checkedAt,
      confidence: 'high',
      evidenceStatus: 'Source-backed',
      reviewRequired: false,
      dataType: 'competitor_data',
      riskReason: 'Last checked date for official product/context source. This does not verify price, market share, revenue, or growth.',
    },
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

export function officialCompetitorRecognitionPageToUpdate(
  source: OfficialCompetitorRecognitionSource,
  html: string,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const normalized = normalizeHtmlText(html)
  const normalizedLower = normalized.toLowerCase()
  const hasRequiredTerms = source.requiredTerms.every(term => normalizedLower.includes(term.toLowerCase()))
  if (!hasRequiredTerms) return null

  return {
    fieldKey: `competitor_metrics.${source.fieldKeySlug}.official_recognition_rating`,
    companyName: source.companyName,
    countryRegion: source.countryRegion,
    productEquivalent: 'Official recognition context; product-wise equivalent still requires separate TDS/SDS/product evidence.',
    rating: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.rating`,
      value: source.ratingLabel,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: source.sourceTierLabel || 'Tier 2 - Official company / recognition source',
      lastChecked: checkedAt,
      sourceDate: checkedAt,
      confidence: 'high',
      evidenceStatus: 'Official Company Evidence',
      reviewRequired: false,
      dataType: 'competitor_data',
      riskReason: 'External-recognition evidence from official company source; not a customer review rating, price, market share, or product-line performance metric.',
    },
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceDate: checkedAt,
    sourceTier: source.sourceTierLabel || 'Tier 2 - Official company / recognition source',
    lastChecked: checkedAt,
    confidence: 'high',
    evidenceStatus: 'Official Company Evidence',
    reviewRequired: false,
    dataType: 'competitor_data',
    recommendedAction: source.recommendedAction,
    riskReason: 'Use this only as source-backed external-recognition evidence. It does not prove customer rating, market share, price, traffic, or product-line revenue.',
  }
}

export function publicCompetitorPricePageToUpdate(
  source: PublicCompetitorPriceSource,
  html: string,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const normalized = normalizeHtmlText(html)
  const normalizedLower = normalized.toLowerCase()
  const hasRequiredTerms = source.requiredTerms.every(term => normalizedLower.includes(term.toLowerCase()))
  if (!hasRequiredTerms) return null

  let priceValue = ''
  let sourceDate = checkedAt

  if (source.parser === 'zauba-stepantex-sp90') {
    const average = normalized.match(/average import price for stepantex sp 90[^$]{0,160}\$\s*([\d,.]+)/i)
    const recordDate = normalized.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\s+20\d{2}\b/i)
    if (!average) return null
    const price = average[1]
    sourceDate = recordDate?.[0] || checkedAt
    priceValue = `Public customs listing: average import price $${price} for STEPANTEX SP-90 under HS Code 29051490; historical/import-unit-specific reference, not a current industrial quote.`
  }

  if (source.parser === 'wholesale-varisoft-eq65') {
    const regularPrice = normalized.match(/regular price\s*\$?\s*([\d,.]+)/i)
    const perLb = normalized.match(/\(\s*\$?\s*([\d,.]+)\s*\/\s*lb\s*\)/i)
    if (!regularPrice && !perLb) return null
    priceValue = [
      'Public retail listing:',
      regularPrice ? `regular price $${regularPrice[1]}` : '',
      perLb ? `(${perLb[1]}/lb)` : '',
      'for VARISOFT EQ 65; sample/cosmetic-supply reference, not bulk industrial textile pricing.',
    ].filter(Boolean).join(' ')
  }

  if (!priceValue) return null

  return {
    fieldKey: `competitor_metrics.${source.fieldKeySlug}.public_price_reference`,
    companyName: source.companyName,
    countryRegion: source.countryRegion,
    productEquivalent: source.productEquivalent,
    pricingEvidence: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.pricing_evidence`,
      value: priceValue,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 5 - Public listing / weak price reference',
      lastChecked: checkedAt,
      sourceDate,
      confidence: 'low',
      evidenceStatus: 'Reference Only',
      reviewRequired: true,
      dataType: 'price_data',
      riskReason: source.riskReason,
    },
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceDate,
    sourceTier: 'Tier 5 - Public listing / weak price reference',
    lastChecked: checkedAt,
    confidence: 'low',
    evidenceStatus: 'Reference Only',
    reviewRequired: true,
    dataType: 'price_data',
    recommendedAction: 'Use this only as public price context. Request current quote, MOQ, incoterms, SDS/TDS, and contract terms before supplier, competitor, finance, or investor use.',
    riskReason: source.riskReason,
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
  const sourceUrl = comtradeSubscriptionKey()
    ? comtradeApiUrl(source, period)
    : comtradePublicPreviewApiUrl(source, period)
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

function worldBankIndicatorValueText(source: WorldBankIndicatorSource, metric: WorldBankIndicatorMetric): string {
  const country = metric.countryName || source.country
  if (source.indicatorKind === 'gdp_annual_change') {
    return `${country}: ${metric.year} GDP annual change ${formatSignedPercent(metric.value)} from World Bank official indicator ${source.indicator}. This is macro context, not direct textile-softener consumption.`
  }
  if (source.indicatorKind === 'manufacturing_value_added_usd') {
    return `${country}: ${metric.year} manufacturing value added ${formatUsdCompact(metric.value)} from World Bank official indicator ${source.indicator}. This is industrial-market context, not direct textile-softener demand.`
  }
  if (source.indicatorKind === 'manufacturing_value_added_share') {
    return `${country}: ${metric.year} manufacturing value added ${metric.value.toFixed(2).replace(/\.?0+$/, '')}% of GDP from World Bank official indicator ${source.indicator}. This is industrial-market context, not direct textile-softener demand.`
  }
  if (source.indicatorKind === 'merchandise_exports_usd') {
    return `${country}: ${metric.year} merchandise exports ${formatUsdCompact(metric.value)} from World Bank official indicator ${source.indicator}. This is trade context, not direct textile-softener demand.`
  }
  if (source.indicatorKind === 'merchandise_imports_usd') {
    return `${country}: ${metric.year} merchandise imports ${formatUsdCompact(metric.value)} from World Bank official indicator ${source.indicator}. This is trade context, not direct textile-softener demand.`
  }
  return `${country}: ${metric.year} logistics performance index ${metric.value.toFixed(2).replace(/\.?0+$/, '')} from World Bank official indicator ${source.indicator}. This is logistics context, not direct textile-softener demand.`
}

function worldBankIndicatorRiskReason(source: WorldBankIndicatorSource): string {
  if (source.indicatorKind === 'gdp_annual_change') {
    return 'World Bank GDP growth is official macro evidence. It helps country prioritization but does not prove textile-softener consumption or product-specific market growth.'
  }
  if (source.indicatorKind === 'manufacturing_value_added_usd' || source.indicatorKind === 'manufacturing_value_added_share') {
    return 'World Bank manufacturing value-added data is official industrial context. It does not prove textile-softener demand, customer readiness, or cationic/silicone softener segment size.'
  }
  if (source.indicatorKind === 'merchandise_exports_usd' || source.indicatorKind === 'merchandise_imports_usd') {
    return 'World Bank merchandise trade data is official country trade context. It is not an HS-specific textile-softener import/export value and should not be used as product demand proof.'
  }
  return 'World Bank logistics performance data is official logistics context. It does not prove delivery cost, supplier reliability, or product demand.'
}

export function worldBankIndicatorPayloadToMarketClaimUpdate(
  source: WorldBankIndicatorSource,
  payload: unknown,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const metrics = worldBankIndicatorMetricsFromPayload(payload)
  const latest = metrics[metrics.length - 1]
  if (!latest) return null
  const sourceUrl = worldBankIndicatorApiUrl(source)
  return {
    fieldKey: `market.country_context.${source.fieldKeySlug}.world_bank_${slug(source.indicatorKind)}`,
    label: `Country context - ${source.country}`,
    proposedDashboardField: `${source.country} World Bank ${source.label}`,
    value: worldBankIndicatorValueText(source, latest),
    sourceTitle: `World Bank API: ${source.country} - ${latest.indicatorName || source.label}`,
    sourceUrl,
    sourceTier: 'Tier 1 - Official / statistical source',
    sourceDate: String(latest.year),
    lastChecked: checkedAt,
    confidence: 'high',
    evidenceStatus: 'Official Data',
    reviewRequired: false,
    dataType: 'trade_data',
    riskReason: worldBankIndicatorRiskReason(source),
    recommendedAction: `Use as official ${source.country} context. Keep market size, country-specific textile-softener demand, competitor share, price, and investor claims in Research Review until directly sourced.`,
  }
}

function numberTextToCompactUsdMillions(value: string): string {
  const numeric = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(numeric)) return `USD ${value} million`
  if (numeric >= 1000) return `USD ${(numeric / 1000).toFixed(3).replace(/\.?0+$/, '')}B`
  return `USD ${numeric.toLocaleString('en-US')}M`
}

function decodeCommonHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;|&#160;/gi, ' ')
}

function parseMarketReferenceSourceDate(text: string): string {
  return firstString(
    text.match(/Page last updated on:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i)?.[1],
    text.match(/Last Updated:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i)?.[1],
    text.match(/Last Updated:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i)?.[1],
    text.match(/\b(ID:\s*[A-Z0-9]+\s*)?([A-Za-z]+\s+\d{4})\s+\d+\s+Pages/i)?.[2],
    text.match(/Last Updated:\s*([A-Za-z]+\s+\d{4})/i)?.[1],
    text.match(/Published:\s*([A-Za-z]+\s+\d{4})/i)?.[1],
  )
}

function pushMarketReferenceClaim(
  claims: MarketReferenceClaim[],
  fieldKey: string,
  label: string,
  proposedDashboardField: string,
  value: string,
  confidence: Confidence = 'high',
): void {
  const cleanValue = value.replace(/\s+/g, ' ').trim()
  if (!cleanValue) return
  if (claims.some(claim => claim.fieldKey === fieldKey && claim.value === cleanValue)) return
  claims.push({ fieldKey, label, proposedDashboardField, value: cleanValue, confidence })
}

function marketReferenceCompanyListAfterHeading(text: string, heading: string): string {
  const sections = text.split(new RegExp(heading, 'i')).slice(1)
  const companyLeadPattern = /^(?:BASF|Evonik|Stepan|Kao|Akzo|Clariant|Italmatch|ABITEC|Hangzhou|Dongnam|Langh|Seppic|Innospec|Floerger|Solvay|Lubrizol|Chemelco|Nouryon|Kemin|Croda|Miwon|Dongnam|ABITEC)/i
  for (const section of sections.reverse()) {
    const candidate = section
      .split(/Frequently Asked Questions|Related Reports|Esterquats Market Key Takeaways|Buy This Report|Get Free Sample|Get Your Customization/i)[0]
      .replace(/\s+/g, ' ')
      .trim()
    if (!candidate || candidate.length > 700) continue
    if (!companyLeadPattern.test(candidate)) continue
    return candidate
  }
  return ''
}

function marketReferenceClaimsFromText(
  source: MarketReferenceSource,
  text: string,
): { sourceDate: string, claims: MarketReferenceClaim[] } {
  const normalized = normalizeHtmlText(text)
  const sourceDate = parseMarketReferenceSourceDate(normalized)

  const claims: MarketReferenceClaim[] = []

  if (source.parser === 'future-market-insights-esterquats') {
    const marketSize = normalized.match(/projected to grow from USD\s*([\d,.]+)\s*billion in\s*(\d{4})\s*to USD\s*([\d,.]+)\s*billion by\s*(\d{4}),\s*at a CAGR of\s*([\d,.]+)%/i)
    if (marketSize) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fmi_market_size', 'Global esterquats market size', 'Market Size / Scope', `USD ${marketSize[1]}B in ${marketSize[2]} (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.fmi_forecast_value', 'Global esterquats forecast value', 'Market forecast', `USD ${marketSize[3]}B by ${marketSize[4]} (market-reference forecast)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.fmi_cagr', 'Global esterquats CAGR', 'Growth Rate', `${marketSize[5]}% CAGR from ${marketSize[2]} to ${marketSize[4]} (market-reference forecast)`)
    }

    const teaQuats = normalized.match(/TEA-quats segment is projected to hold\s*([\d,.]+)%\s*of the esterquats market revenue share in\s*(\d{4})/i)
    if (teaQuats) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fmi_tea_quats_share', 'TEA-quats product-type share', 'Market segmentation', `${teaQuats[1]}% TEA-quats revenue share in ${teaQuats[2]} (market-reference segment estimate)`)
    }

    const liquidForm = normalized.match(/liquid form segment is anticipated to account for\s*([\d,.]+)%\s*of the esterquats market revenue share in\s*(\d{4})/i)
    if (liquidForm) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fmi_liquid_form_share', 'Liquid esterquats form share', 'Market segmentation', `${liquidForm[1]}% liquid-form revenue share in ${liquidForm[2]} (market-reference segment estimate)`)
    }

    const personalCare = normalized.match(/personal care products application segment is expected to capture\s*([\d,.]+)%\s*of the esterquats market revenue share in\s*(\d{4})/i)
    if (personalCare) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fmi_personal_care_share', 'Personal-care application share', 'Market segmentation', `${personalCare[1]}% personal-care revenue share in ${personalCare[2]} (market-reference segment estimate)`)
    }

    const countryTable = normalized.match(/Analysis of Esterquats Market By Key Countries Country CAGR\s*([^.]*)/i)?.[1] || ''
    const countryMatches = [...countryTable.matchAll(/\b(China|India|Germany|France|UK|USA|Brazil)\s+([\d,.]+)%/gi)]
    for (const match of countryMatches) {
      const country = match[1]
      pushMarketReferenceClaim(
        claims,
        `market.esterquats.fmi_country_cagr.${slug(country)}`,
        `Country-wise esterquats market CAGR - ${country}`,
        `Country-wise growth - ${country}`,
        `${match[2]}% CAGR (market-reference country forecast)`,
        'medium',
      )
    }

    const players = marketReferenceCompanyListAfterHeading(normalized, 'Top Key Players in Esterquats Market:')
    if (players) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fmi_key_players', 'Esterquats key competitor set', 'Competitor landscape', players, 'medium')
    }
  } else if (source.parser === 'persistence-esterquats') {
    const marketSize = normalized.match(/projected to reach US\$\s*([\d,.]+)\s*billion in\s*(\d{4})\s*and US\$\s*([\d,.]+)\s*billion by\s*(\d{4}),\s*growing at a CAGR of\s*([\d,.]+)%/i)
    if (marketSize) {
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_market_size', 'Global esterquats market size', 'Market Size / Scope', `US$ ${marketSize[1]}B in ${marketSize[2]} (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_forecast_value', 'Global esterquats forecast value', 'Market forecast', `US$ ${marketSize[3]}B by ${marketSize[4]} (market-reference forecast)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_cagr', 'Global esterquats CAGR', 'Growth Rate', `${marketSize[5]}% CAGR from ${marketSize[2]} to ${marketSize[4]} (market-reference forecast)`)
    }

    const northAmerica = normalized.match(/North America[^.]*holding\s*([\d,.]+)%\s*share/i)
    if (northAmerica) {
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_north_america_share', 'North America esterquats regional share', 'Regional market share', `${northAmerica[1]}% North America share (market-reference regional estimate)`)
    }

    const countryGrowth = normalized.match(/Asia Pacific experiences the fastest regional growth at\s*([\d,.]+)%\s*CAGR in China and\s*([\d,.]+)%\s*CAGR in India/i)
    if (countryGrowth) {
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_country_cagr.china', 'Country-wise esterquats market CAGR - China', 'Country-wise growth - China', `${countryGrowth[1]}% CAGR (market-reference country forecast)`, 'medium')
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_country_cagr.india', 'Country-wise esterquats market CAGR - India', 'Country-wise growth - India', `${countryGrowth[2]}% CAGR (market-reference country forecast)`, 'medium')
    }

    const solidPaste = normalized.match(/Solid and paste esterquats account for approximately\s*([\d,.]+)%\s*of market share/i)
    if (solidPaste) {
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_solid_paste_share', 'Solid/paste esterquats form share', 'Market segmentation', `${solidPaste[1]}% solid/paste form share (market-reference segment estimate)`)
    }

    const tallow = normalized.match(/Tallow-based esterquats continue to dominate the market with approximately\s*([\d,.]+)%\s*share/i)
    if (tallow) {
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_tallow_share', 'Tallow-based esterquats feedstock share', 'Market segmentation', `${tallow[1]}% tallow-based feedstock share (market-reference segment estimate)`)
    }

    const vegetable = normalized.match(/vegetable oil-based esterquats[^.]*currently account for around\s*([\d,.]+)%\s*of the market/i)
    if (vegetable) {
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_vegetable_share', 'Vegetable-based esterquats feedstock share', 'Market segmentation', `${vegetable[1]}% vegetable-based feedstock share (market-reference segment estimate)`)
    }

    const fabricCare = normalized.match(/Fabric care remains the largest application segment, accounting for approximately\s*([\d,.]+)%\s*of total esterquat demand/i)
    if (fabricCare) {
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_fabric_care_share', 'Fabric-care application share', 'Market segmentation', `${fabricCare[1]}% fabric-care demand share (market-reference segment estimate)`)
    }

    const personalCareGrowth = normalized.match(/Personal care represents the fastest-growing application area, with estimated growth of\s*([\d,.]+)%\s*CAGR/i)
    if (personalCareGrowth) {
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_personal_care_cagr', 'Personal-care esterquats application CAGR', 'Application growth', `${personalCareGrowth[1]}% CAGR for personal-care application (market-reference forecast)`, 'medium')
    }

    const players = marketReferenceCompanyListAfterHeading(normalized, 'Companies Covered in Esterquats Market')
    if (players) {
      pushMarketReferenceClaim(claims, 'market.esterquats.pmr_key_players', 'Esterquats key competitor set', 'Competitor landscape', players, 'medium')
    }
  } else if (source.parser === 'grandview-esterquats') {
    const marketSize = normalized.match(/global esterquats market size was estimated at USD\s*([\d,.]+)\s*million in\s*(\d{4})/i)
    if (marketSize) {
      pushMarketReferenceClaim(claims, 'market.esterquats.grandview_market_size', 'Global esterquats market size', 'Market Size / Scope', `${numberTextToCompactUsdMillions(marketSize[1])} in ${marketSize[2]} (market-reference estimate)`)
    }

    const cagr = normalized.match(/(?:compound annual growth rate|CAGR) of\s*([\d,.]+)%\s*from\s*(\d{4})\s*to\s*(\d{4})/i)
    if (cagr) {
      pushMarketReferenceClaim(claims, 'market.esterquats.grandview_cagr', 'Global esterquats CAGR', 'Growth Rate', `${cagr[1]}% CAGR from ${cagr[2]} to ${cagr[3]} (market-reference forecast)`)
    }

    const forecast = normalized.match(/reach USD\s*([\d,.]+)\s*million by\s*(\d{4})/i)
    if (forecast) {
      pushMarketReferenceClaim(claims, 'market.esterquats.grandview_forecast_value', 'Global esterquats forecast value', 'Market forecast', `${numberTextToCompactUsdMillions(forecast[1])} by ${forecast[2]} (market-reference forecast)`)
    }

    const fabricCare = normalized.match(/Fabric care dominated the esterquats market with a share of\s*([\d,.]+)%\s*in\s*(\d{4})/i)
    if (fabricCare) {
      pushMarketReferenceClaim(claims, 'market.esterquats.grandview_fabric_care_share', 'Esterquats fabric-care segment share', 'Market segmentation', `${fabricCare[1]}% fabric-care share in ${fabricCare[2]} (market-reference segment estimate)`)
    }

    const keyPlayers = normalized.match(/Some key players operating in the esterquats market include\s*([\s\S]+?)\.\s*(?:$|[A-Z][a-z])/i)
    if (keyPlayers) {
      pushMarketReferenceClaim(claims, 'market.esterquats.grandview_key_players', 'Esterquats key competitor set', 'Competitor landscape', keyPlayers[1].replace(/\s+/g, ' ').trim(), 'medium')
    }
  } else if (source.parser === 'fortune-esterquats') {
    const valued = normalized.match(/global esterquats market size was valued at USD\s*([\d,.]+)\s*billion in\s*(\d{4})/i)
    if (valued) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_market_size', 'Global esterquats market size', 'Market Size / Scope', `USD ${valued[1]}B in ${valued[2]} (market-reference estimate)`)
    }

    const forecast = normalized.match(/grow from USD\s*([\d,.]+)\s*billion in\s*(\d{4})\s*to USD\s*([\d,.]+)\s*billion by\s*(\d{4}),\s*exhibiting a CAGR of\s*([\d,.]+)%/i) ||
      normalized.match(/projected to grow from USD\s*([\d,.]+)\s*billion in\s*(\d{4})\s*to USD\s*([\d,.]+)\s*billion by\s*(\d{4}),\s*(?:at|exhibiting)\s*a CAGR of\s*([\d,.]+)%/i)
    if (forecast) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_current_year_value', 'Global esterquats current-year value', 'Market Size / Scope', `USD ${forecast[1]}B in ${forecast[2]} (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_forecast_value', 'Global esterquats forecast value', 'Market forecast', `USD ${forecast[3]}B by ${forecast[4]} (market-reference forecast)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_cagr', 'Global esterquats CAGR', 'Growth Rate', `${forecast[5]}% CAGR from ${forecast[2]} to ${forecast[4]} (market-reference forecast)`)
    } else {
      const cagr = normalized.match(/CAGR\s*\(?\s*(?:\d{4}\s*[-–]\s*\d{4})?\s*\)?\s*[:|-]?\s*([\d,.]+)%/i)
      if (cagr) {
        pushMarketReferenceClaim(claims, 'market.esterquats.fortune_cagr', 'Global esterquats CAGR', 'Growth Rate', `${cagr[1]}% CAGR (market-reference forecast)`)
      }
    }

    const northAmerica = normalized.match(/North America[^.]*?(?:held|accounted for|captured)\s*([\d,.]+)%\s*(?:share)?\s*in\s*(\d{4})/i)
    if (northAmerica) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_north_america_share', 'North America esterquats regional share', 'Regional market share', `${northAmerica[1]}% North America share in ${northAmerica[2]} (market-reference regional estimate)`)
    }

    const canada = normalized.match(/Canada[^.]*?(?:captured|held|accounted for)\s*([\d,.]+)%[^.]*?global market share in\s*(\d{4})/i)
    if (canada) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_canada_share', 'Canada esterquats country share', 'Country-wise market share - Canada', `${canada[1]}% Canada share in ${canada[2]} (market-reference country estimate)`, 'medium')
    }

    const tea = normalized.match(/triethanolamine\s*\(?TEA\)?\s*segment accounted for\s*([\d,.]+)%\s*in\s*(\d{4})/i) ||
      normalized.match(/TEA[^.]*?segment accounted for\s*([\d,.]+)%\s*in\s*(\d{4})/i)
    if (tea) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_tea_share', 'TEA esterquats product-type share', 'Market segmentation', `${tea[1]}% TEA segment share in ${tea[2]} (market-reference segment estimate)`)
    }

    const liquid = normalized.match(/liquid form segment held\s*([\d,.]+)%\s*share in\s*(\d{4})/i) ||
      normalized.match(/liquid[^.]*?held\s*([\d,.]+)%\s*share in\s*(\d{4})/i)
    if (liquid) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_liquid_share', 'Liquid esterquats form share', 'Market segmentation', `${liquid[1]}% liquid-form share in ${liquid[2]} (market-reference segment estimate)`)
    }

    const fabric = normalized.match(/fabric softeners? segment held\s*([\d,.]+)%\s*share in\s*(\d{4})/i) ||
      normalized.match(/fabric care[^.]*?held\s*([\d,.]+)%\s*share in\s*(\d{4})/i)
    if (fabric) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_fabric_softener_share', 'Fabric-softener application share', 'Market segmentation', `${fabric[1]}% fabric-softener application share in ${fabric[2]} (market-reference segment estimate)`)
    }

    const players = marketReferenceCompanyListAfterHeading(normalized, 'List of Top Esterquats Companies') ||
      marketReferenceCompanyListAfterHeading(normalized, 'List of the Top Key Players in the Esterquats Market') ||
      marketReferenceCompanyListAfterHeading(normalized, 'Top Key Players in Esterquats Market')
    if (players) {
      pushMarketReferenceClaim(claims, 'market.esterquats.fortune_key_players', 'Esterquats key competitor set', 'Competitor landscape', players, 'medium')
    }
  } else if (source.parser === 'research360-esterquat') {
    const marketSize = normalized.match(/Global Esterquat market value is expected to rise from USD\s*([\d,.]+)\s*million in\s*(\d{4})\s*to approximately USD\s*([\d,.]+)\s*million by\s*(\d{4}),\s*progressing at a CAGR of\s*([\d,.]+)%/i)
    if (marketSize) {
      pushMarketReferenceClaim(claims, 'market.esterquats.360_market_size', 'Global esterquat market size', 'Market Size / Scope', `${numberTextToCompactUsdMillions(marketSize[1])} in ${marketSize[2]} (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.360_forecast_value', 'Global esterquat forecast value', 'Market forecast', `${numberTextToCompactUsdMillions(marketSize[3])} by ${marketSize[4]} (market-reference forecast)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.360_cagr', 'Global esterquat CAGR', 'Growth Rate', `${marketSize[5]}% CAGR from ${marketSize[2]} to ${marketSize[4]} (market-reference forecast)`)
    }

    const regionalShares = normalized.match(/Asia-Pacific holds\s*([\d,.]+)%\s*of global esterquat consumption[\s\S]{0,220}?Europe holds\s*([\d,.]+)%[\s\S]{0,160}?North America holds\s*([\d,.]+)%[\s\S]{0,260}?Middle East & Africa[\s\S]{0,120}?\b([\d,.]+)%/i)
    if (regionalShares) {
      pushMarketReferenceClaim(claims, 'market.esterquats.360_apac_consumption_share', 'Asia-Pacific esterquat consumption share', 'Regional market share', `${regionalShares[1]}% Asia-Pacific consumption share (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.360_europe_consumption_share', 'Europe esterquat consumption share', 'Regional market share', `${regionalShares[2]}% Europe consumption share (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.360_north_america_consumption_share', 'North America esterquat consumption share', 'Regional market share', `${regionalShares[3]}% North America consumption share (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.360_mea_consumption_share', 'Middle East & Africa esterquat consumption share', 'Regional market share', `${regionalShares[4]}% Middle East & Africa consumption share (market-reference estimate)`)
    }

    const segmentation = normalized.match(/segmented by type into\s*TEAQ,\s*DEEDMAC,\s*HEQ,\s*and Others,\s*representing\s*([\d,.]+)%,\s*([\d,.]+)%,\s*([\d,.]+)%,\s*and\s*([\d,.]+)%/i) ||
      normalized.match(/TEAQ[\s\S]{0,120}?([\d,.]+)%[\s\S]{0,120}?DEEDMAC[\s\S]{0,120}?([\d,.]+)%[\s\S]{0,120}?HEQ[\s\S]{0,120}?([\d,.]+)%[\s\S]{0,120}?Others[\s\S]{0,120}?([\d,.]+)%/i)
    if (segmentation) {
      pushMarketReferenceClaim(claims, 'market.esterquats.360_teaq_share', 'TEAQ product-type share', 'Market segmentation', `${segmentation[1]}% TEAQ global consumption share (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.360_deedmac_share', 'DEEDMAC product-type share', 'Market segmentation', `${segmentation[2]}% DEEDMAC global consumption share (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.360_heq_share', 'HEQ product-type share', 'Market segmentation', `${segmentation[3]}% HEQ global consumption share (market-reference estimate)`)
      pushMarketReferenceClaim(claims, 'market.esterquats.360_other_type_share', 'Other esterquat type share', 'Market segmentation', `${segmentation[4]}% other esterquat type share (market-reference estimate)`, 'medium')
    }

    const competitiveLandscape = normalized.match(/top 2 manufacturers hold\s*([\d,.]+)%\s*market share collectively,\s*while the top 5 control\s*([\d,.]+)%,\s*and the largest producer alone represents\s*([\d,.]+)%/i)
    if (competitiveLandscape) {
      pushMarketReferenceClaim(claims, 'market.esterquats.360_top_two_share', 'Top two esterquat producer share', 'Competitor landscape', `${competitiveLandscape[1]}% top-two collective share (market-reference estimate)`, 'medium')
      pushMarketReferenceClaim(claims, 'market.esterquats.360_top_five_share', 'Top five esterquat producer share', 'Competitor landscape', `${competitiveLandscape[2]}% top-five collective share (market-reference estimate)`, 'medium')
      pushMarketReferenceClaim(claims, 'market.esterquats.360_largest_producer_share', 'Largest esterquat producer share', 'Competitor landscape', `${competitiveLandscape[3]}% largest-producer share (market-reference estimate)`, 'medium')
    }

    const regionCountryBlocks: Array<{ region: string, countries: string }> = []
    const asiaCountries = normalized.match(/China leads with\s*([\d,.]+)\s*tons,\s*India with\s*([\d,.]+)\s*tons,\s*Japan with\s*([\d,.]+)\s*tons,\s*South Korea with\s*([\d,.]+)\s*tons,\s*and Indonesia with\s*([\d,.]+)\s*tons/i)
    if (asiaCountries) {
      regionCountryBlocks.push({ region: 'China', countries: `${asiaCountries[1]} tons esterquat consumption (market-reference estimate)` })
      regionCountryBlocks.push({ region: 'India', countries: `${asiaCountries[2]} tons esterquat consumption (market-reference estimate)` })
      regionCountryBlocks.push({ region: 'Japan', countries: `${asiaCountries[3]} tons esterquat consumption (market-reference estimate)` })
      regionCountryBlocks.push({ region: 'South Korea', countries: `${asiaCountries[4]} tons esterquat consumption (market-reference estimate)` })
      regionCountryBlocks.push({ region: 'Indonesia', countries: `${asiaCountries[5]} tons esterquat consumption (market-reference estimate)` })
    }
    const europeCountries = normalized.match(/Germany leads with\s*([\d,.]+)\s*tons,\s*followed by the U\.?K\.?\s*at\s*([\d,.]+)\s*tons,\s*France at\s*([\d,.]+)\s*tons,\s*Italy at\s*([\d,.]+)\s*tons,\s*and Spain at\s*([\d,.]+)\s*tons/i)
    if (europeCountries) {
      regionCountryBlocks.push({ region: 'Germany', countries: `${europeCountries[1]} tons esterquat consumption (market-reference estimate)` })
      regionCountryBlocks.push({ region: 'United Kingdom', countries: `${europeCountries[2]} tons esterquat consumption (market-reference estimate)` })
      regionCountryBlocks.push({ region: 'France', countries: `${europeCountries[3]} tons esterquat consumption (market-reference estimate)` })
      regionCountryBlocks.push({ region: 'Italy', countries: `${europeCountries[4]} tons esterquat consumption (market-reference estimate)` })
      regionCountryBlocks.push({ region: 'Spain', countries: `${europeCountries[5]} tons esterquat consumption (market-reference estimate)` })
    }
    for (const row of regionCountryBlocks) {
      pushMarketReferenceClaim(claims, `market.esterquats.360_country_consumption.${slug(row.region)}`, `Country-wise esterquat consumption - ${row.region}`, `Country-wise consumption - ${row.region}`, row.countries, 'medium')
    }

    const topCompanies = normalized.match(/List of Top Esterquat Companies\s*([\s\S]+?)Top Two Companies with Highest Share/i)
    if (topCompanies) {
      const players = topCompanies[1]
        .replace(/\s*\*\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .replace(/^,\s*/, '')
        .trim()
      pushMarketReferenceClaim(claims, 'market.esterquats.360_key_players', 'Esterquat key competitor set', 'Competitor landscape', players, 'medium')
    }
  }

  return { sourceDate, claims }
}

function marketReferenceCompetitorShareContextsFromText(
  source: MarketReferenceSource,
  text: string,
): { sourceDate: string, contexts: MarketReferenceCompetitorShareContext[] } {
  const normalized = normalizeHtmlText(text)
  const sourceDate = parseMarketReferenceSourceDate(normalized)
  const contexts: MarketReferenceCompetitorShareContext[] = []

  if (source.parser === 'persistence-esterquats') {
    const collectiveShare = normalized.match(/Tier\s*1 companies[^.]*BASF(?:\s+SE)?[^.]*Evonik(?:\s+Industries(?:\s+AG)?)?[^.]*Stepan(?:\s+Company)?[^.]*Kao(?:\s+Corporation)?[^.]*collectively account for approximately\s*([\d,.]+\s*[-–]\s*[\d,.]+%)\s*of global market share/i)
    if (!collectiveShare) return { sourceDate, contexts }

    const shareRange = collectiveShare[1].replace(/\s+/g, '')
    const marketShare = `Collective Tier-1 esterquats share ${shareRange}; individual company share not published by this source. Review required before ranking or investor use.`
    const productEquivalent = 'Esterquats / fabric-care softener competitor context; product-wise equivalence still requires official TDS/SDS evidence.'
    const riskReason = 'The source provides a collective Tier-1 market-share range for BASF, Evonik, Stepan, and Kao. It does not publish company-specific market share, so this must not drive leader badges or investor claims.'

    contexts.push(
      {
        companyName: 'BASF',
        fieldKeySlug: 'basf',
        countryRegion: 'Germany / global',
        marketShare,
        productEquivalent,
        riskReason,
      },
      {
        companyName: 'Evonik Industries',
        fieldKeySlug: 'evonik_industries',
        countryRegion: 'Germany / global',
        marketShare,
        productEquivalent,
        riskReason,
      },
      {
        companyName: 'Stepan Company',
        fieldKeySlug: 'stepan_company',
        countryRegion: 'United States / global',
        marketShare,
        productEquivalent,
        riskReason,
      },
      {
        companyName: 'Kao Corporation',
        fieldKeySlug: 'kao_corporation',
        countryRegion: 'Japan / global',
        marketShare,
        productEquivalent,
        riskReason,
      },
    )
  } else if (source.parser === 'fortune-esterquats') {
    const productEquivalent = 'Global esterquat/fabric-care competitor context; Chemicon-equivalent textile-softener product relevance still requires separate product/TDS evidence.'
    const companySharePatterns: Array<{
      companyName: string
      fieldKeySlug: string
      countryRegion: string
      pattern: RegExp
    }> = [
      {
        companyName: 'AkzoNobel',
        fieldKeySlug: 'akzonobel',
        countryRegion: 'Netherlands / global',
        pattern: /AkzoNobel\s*[:|-]?\s*([\d,.]+)%\s*Market Share/i,
      },
      {
        companyName: 'Procter & Gamble',
        fieldKeySlug: 'procter_gamble',
        countryRegion: 'United States / global',
        pattern: /Procter\s*&\s*Gamble\s*[:|-]?\s*([\d,.]+)%\s*Market Share/i,
      },
    ]
    for (const item of companySharePatterns) {
      const match = normalized.match(item.pattern)
      if (!match) continue
      contexts.push({
        companyName: item.companyName,
        fieldKeySlug: item.fieldKeySlug,
        countryRegion: item.countryRegion,
        marketShare: `${match[1]}% global esterquats share (Fortune Business Insights market-reference estimate; not textile-softener-specific).`,
        productEquivalent,
        riskReason: 'This is a Tier-4 market-reference company-share estimate. It is not official, not China-specific, and not direct Chemicon-equivalent textile-softener proof, so it must stay review-gated before ranking or investor use.',
      })
    }
  } else if (source.parser === 'research360-esterquat') {
    const productEquivalent = 'Global esterquat producer context; textile-softener and Chemicon-equivalent product relevance still requires separate product/TDS evidence.'
    const companySharePatterns: Array<{
      companyName: string
      fieldKeySlug: string
      countryRegion: string
      pattern: RegExp
    }> = [
      {
        companyName: 'Stepan Company',
        fieldKeySlug: 'stepan_company',
        countryRegion: 'United States / global',
        pattern: /Stepan Company:\s*Stepan Company holds\s*([\d,.]+)%\s*global esterquat share[^.]*\./i,
      },
      {
        companyName: 'Evonik Industries',
        fieldKeySlug: 'evonik_industries',
        countryRegion: 'Germany / global',
        pattern: /Evonik Industries:\s*Evonik Industries controls\s*([\d,.]+)%\s*global esterquat share[^.]*\./i,
      },
    ]
    for (const item of companySharePatterns) {
      const match = normalized.match(item.pattern)
      if (!match) continue
      const share = match[1]
      contexts.push({
        companyName: item.companyName,
        fieldKeySlug: item.fieldKeySlug,
        countryRegion: item.countryRegion,
        marketShare: `${share}% global esterquat share (market-reference estimate; not textile-softener-specific).`,
        productEquivalent,
        riskReason: 'This is a Tier-4 market-reference estimate for global esterquat share. It is company-specific, but it is not official, not China-specific, and not Chemicon product-equivalent proof, so it must stay review-gated before ranking or investor use.',
      })
    }
  }

  return { sourceDate, contexts }
}

function parseSemrushTrafficSourceDate(text: string, domain: string): string {
  return firstString(
    text.match(new RegExp(`${domain.replace(/\./g, '\\.')} Website Traffic, Ranking, Analytics \\[([^\\]]+)\\]`, 'i'))?.[1],
    text.match(/"displayDate":\[0,"(\d{4}-\d{2}-\d{2})"\]/i)?.[1],
  )
}

function parseSemrushAuthorityScore(text: string): string {
  return firstString(
    text.match(/"authorityScore"\s*:\s*\[0,\{"value":\[0,(\d+)\]/i)?.[1],
    text.match(/Authority Score\s+(\d+)/i)?.[1],
  )
}

export function marketReferenceTrafficPageToCompetitorUpdate(
  source: MarketReferenceTrafficSource,
  html: string,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const normalized = decodeCommonHtmlEntities(normalizeHtmlText(html))
  if (!new RegExp(`${source.domain.replace(/\./g, '\\.')} Website Traffic`, 'i').test(normalized)) return null

  const trafficMatch = normalized.match(new RegExp(`In\\s+([A-Za-z]+)\\s+${source.domain.replace(/\./g, '\\.')}\\s+received\\s+([\\d.]+[KMB]?)\\s+visits`, 'i')) ||
    normalized.match(/Visits\s+([\d.]+[KMB]?)/i)
  const trafficValue = trafficMatch
    ? (trafficMatch.length >= 3 ? trafficMatch[2] : trafficMatch[1])
    : ''
  const monthName = trafficMatch && trafficMatch.length >= 3 ? trafficMatch[1] : ''
  const sourceDate = parseSemrushTrafficSourceDate(normalized, source.domain) || (monthName ? `${monthName} traffic snapshot` : checkedAt)
  const monthlyChange = normalized.match(new RegExp(`Compared to\\s+([A-Za-z]+)\\s+traffic to\\s+${source.domain.replace(/\./g, '\\.')}\\s+has\\s+(increased|decreased)\\s+by\\s+(-?[\\d.]+)%`, 'i'))
  const authorityScore = parseSemrushAuthorityScore(normalized)

  if (!trafficValue && !authorityScore) return null

  const trafficSummary = trafficValue
    ? [
        `${sourceDate} Semrush website-traffic estimate: ${trafficValue} visits.`,
        monthlyChange ? `Compared to ${monthlyChange[1]}: ${monthlyChange[2]} by ${monthlyChange[3]}%.` : '',
      ].filter(Boolean).join(' ')
    : undefined
  const authoritySummary = authorityScore
    ? `Semrush Authority Score: ${authorityScore} (domain authority metric, not customer review rating).`
    : undefined

  return {
    fieldKey: `competitor_metrics.${source.fieldKeySlug}.semrush_traffic_authority`,
    companyName: source.companyName,
    countryRegion: source.countryRegion,
    value: trafficSummary || authoritySummary,
    traffic: trafficSummary ? {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.traffic`,
      value: trafficSummary,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 4 - Reputable web analytics reference',
      lastChecked: checkedAt,
      sourceDate,
      confidence: 'high',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      dataType: 'competitor_data',
      riskReason: 'Semrush traffic is a third-party estimate for website visits; use as directional digital-interest evidence only.',
    } : undefined,
    rating: authoritySummary ? {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.rating`,
      value: authoritySummary,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 4 - Reputable web analytics reference',
      lastChecked: checkedAt,
      sourceDate,
      confidence: 'high',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      dataType: 'competitor_data',
      riskReason: 'Authority Score is a Semrush domain authority metric; it is not a product/customer rating.',
    } : undefined,
    lastUpdated: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.last_updated`,
      value: sourceDate || checkedAt,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 4 - Reputable web analytics reference',
      lastChecked: checkedAt,
      sourceDate,
      confidence: 'high',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      dataType: 'competitor_data',
    },
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceTier: 'Tier 4 - Reputable web analytics reference',
    sourceDate,
    lastChecked: checkedAt,
    confidence: 'high',
    evidenceStatus: 'Market Reference',
    reviewRequired: false,
    dataType: 'competitor_data',
    recommendedAction: 'Use traffic/authority as directional market-interest evidence only; do not treat it as chemical market share, revenue, or customer rating.',
    riskReason: 'Traffic and authority are market-reference estimates from Semrush and remain separate from verified market share, price, and product-line performance.',
  }
}

function trancoTrafficRankApiUrl(domain: string): string {
  return `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`
}

function validTrancoDate(value: unknown): string {
  const text = firstString(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

export function trancoRanksPayloadToCompetitorUpdate(
  source: TrancoTrafficRankSource,
  payload: TrancoRankPayload,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const ranks = Array.isArray(payload?.ranks) ? payload.ranks : []
  const latest = ranks
    .map(item => ({
      date: validTrancoDate(item.date),
      rank: Number(item.rank),
    }))
    .filter(item => item.date && Number.isFinite(item.rank) && item.rank > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!latest) return null

  const sourceTitle = `Tranco daily domain rank - ${source.domain}`
  const sourceUrl = trancoTrafficRankApiUrl(source.domain)
  const rankText = latest.rank.toLocaleString('en-US')
  const value = `Tranco daily traffic-rank signal: #${rankText} for ${source.domain} on ${latest.date}. Lower rank means higher observed web popularity; this is not monthly visit volume.`

  return {
    fieldKey: `competitor_metrics.${source.fieldKeySlug}.tranco_traffic_rank`,
    companyName: source.companyName,
    countryRegion: source.countryRegion,
    value,
    traffic: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.traffic`,
      value,
      sourceTitle,
      sourceUrl,
      sourceTier: 'Tier 4 - Reputable web ranking reference',
      sourceDate: latest.date,
      lastChecked: checkedAt,
      confidence: 'high',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      dataType: 'competitor_data',
      riskReason: 'Tranco provides a daily domain popularity rank, not monthly visit volume. Use it as directional web-presence evidence only.',
    },
    lastUpdated: {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.last_updated`,
      value: latest.date,
      sourceTitle,
      sourceUrl,
      sourceTier: 'Tier 4 - Reputable web ranking reference',
      sourceDate: latest.date,
      lastChecked: checkedAt,
      confidence: 'high',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      dataType: 'competitor_data',
      riskReason: 'Latest Tranco rank date for this domain.',
    },
    sourceTitle,
    sourceUrl,
    sourceTier: 'Tier 4 - Reputable web ranking reference',
    sourceDate: latest.date,
    lastChecked: checkedAt,
    confidence: 'high',
    evidenceStatus: 'Market Reference',
    reviewRequired: false,
    dataType: 'competitor_data',
    recommendedAction: 'Use as source-backed web-presence rank only. Do not treat it as chemical market share, sales revenue, customer rating, or monthly visit volume.',
    riskReason: 'Tranco is a research-oriented daily domain ranking; it is useful for competitor digital presence but not for market-share or revenue claims.',
  }
}

function trancoFetchDelayMs(): number {
  return process.env.NODE_ENV === 'test' ? 0 : 1100
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

interface JsonFetchResult {
  ok: boolean
  status: number
  payload: unknown | null
  retryAfter: string
}

function retryAfterHeader(response: Response): string {
  const headers = response.headers as Headers | undefined
  if (!headers || typeof headers.get !== 'function') return ''
  return firstString(headers.get('retry-after'), headers.get('Retry-After'))
}

function comtradeFetchDelayMs(): number {
  return process.env.NODE_ENV === 'test' ? 0 : 1250
}

async function fetchJsonWithCache(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  cache: Map<string, Promise<JsonFetchResult>>,
  timeoutMs = SOURCE_FETCH_TIMEOUT_MS,
): Promise<JsonFetchResult> {
  const cached = cache.get(url)
  if (cached) return cached
  const request = (async () => {
    const response = await fetchWithTimeout(fetcher, url, init, timeoutMs)
    const retryAfter = retryAfterHeader(response)
    if (!response.ok) {
      return {
        ok: false,
        status: response.status || 0,
        payload: null,
        retryAfter,
      }
    }
    return {
      ok: true,
      status: response.status || 200,
      payload: await response.json(),
      retryAfter,
    }
  })()
  cache.set(url, request)
  return request
}

function financialMetricEvidence(input: {
  fieldKey: string
  value: string
  source: MarketReferenceCompetitorFinancialSource
  checkedAt: string
  sourceDate: string
  confidence?: Confidence
}): Record<string, unknown> {
  return {
    fieldKey: input.fieldKey,
    value: input.value,
    sourceTitle: input.source.sourceTitle,
    sourceUrl: input.source.sourceUrl,
    sourceTier: 'Tier 4 - Reputable market/financial reference',
    lastChecked: input.checkedAt,
    sourceDate: input.sourceDate,
    confidence: input.confidence || 'medium',
    evidenceStatus: 'Market Reference',
    reviewRequired: false,
    dataType: 'competitor_data',
    riskReason: 'Reputable third-party financial reference. Treat as company-wide context, not product-line textile-softener revenue, pricing, market share, or investor-approved proof.',
  }
}

export function marketReferenceFinancialPageToCompetitorUpdate(
  source: MarketReferenceCompetitorFinancialSource,
  html: string,
  checkedAt: string,
): DashboardResearchUpdateItem | null {
  const normalized = decodeCommonHtmlEntities(normalizeHtmlText(html))
    .replace(/\\u0026lt;/g, '<')
    .replace(/\\u0026gt;/g, '>')
    .replace(/\\u0026amp;/g, '&')

  if (source.parser === 'spglobal-archroma-2025') {
    const revenue = normalized.match(/reported about\s*\$([\d.]+)\s*billion in sales in fiscal\s*(20\d{2})/i)
    if (!revenue) return null
    const value = `FY${revenue[2]} company-wide sales: about US$${revenue[1]}B (S&P Global Ratings research update)`
    return {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.market_reference_financials`,
      companyName: source.companyName,
      countryRegion: source.countryRegion,
      value,
      revenue: financialMetricEvidence({
        fieldKey: `competitor_metrics.${source.fieldKeySlug}.revenue`,
        value,
        source,
        checkedAt,
        sourceDate: `Fiscal ${revenue[2]}`,
      }),
      lastUpdated: financialMetricEvidence({
        fieldKey: `competitor_metrics.${source.fieldKeySlug}.last_updated`,
        value: checkedAt,
        source,
        checkedAt,
        sourceDate: checkedAt,
      }),
      productEquivalent: 'Textile Effects / specialty-chemicals competitor context; exact Chemicon-equivalent product revenue still requires product-line evidence.',
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 4 - Reputable market/financial reference',
      sourceDate: `Fiscal ${revenue[2]}`,
      lastChecked: checkedAt,
      confidence: 'medium',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      dataType: 'competitor_data',
      recommendedAction: 'Use as company-wide revenue context only. Keep product-line revenue, pricing, and market share review-gated until exact sources are imported.',
      riskReason: 'S&P Global Ratings gives company-wide sales context. It does not prove textile-softener product-line revenue, price, market share, or investor material.',
    }
  }

  if (source.parser === 'stockanalysis-transfar-2025') {
    const sourceDate = firstString(
      normalized.match(/Last checked:\s*([A-Za-z]+\s+\d{1,2},\s*20\d{2})/i)?.[1],
      normalized.match(/Period Ending\s+Dec '?(\d{2})/i)?.[1] ? `Fiscal 20${normalized.match(/Period Ending\s+Dec '?(\d{2})/i)?.[1]}` : '',
      checkedAt,
    )
    const total = normalized.match(/Total\s+([\d.]+[BM])\s+[\d.]+[BM][\s\S]{0,160}?Total Growth\s+([+-]?[\d.]+)%/i)
    if (!total) return null
    const segment = normalized.match(/Textile Printing and Dyeing Auxiliaries\s+([\d.]+[BM])[\s\S]{0,160}?Textile Printing and Dyeing Auxiliaries Growth\s+([+-]?[\d.]+)%/i)
    const revenueValue = `FY2025 company-wide revenue: CNY ${total[1]} (StockAnalysis / S&P Global Market Intelligence)`
    const growthValue = `FY2025 company-wide revenue YoY: ${total[2]}%`
    const segmentText = segment
      ? `Textile Printing and Dyeing Auxiliaries segment: CNY ${segment[1]} in FY2025; segment YoY ${segment[2]}%.`
      : 'Textile Printing and Dyeing Auxiliaries segment source found; segment value parser needs review.'
    return {
      fieldKey: `competitor_metrics.${source.fieldKeySlug}.market_reference_financials`,
      companyName: source.companyName,
      countryRegion: source.countryRegion,
      value: revenueValue,
      revenue: financialMetricEvidence({
        fieldKey: `competitor_metrics.${source.fieldKeySlug}.revenue`,
        value: revenueValue,
        source,
        checkedAt,
        sourceDate,
      }),
      yearlyGrowth: financialMetricEvidence({
        fieldKey: `competitor_metrics.${source.fieldKeySlug}.yoy_growth`,
        value: growthValue,
        source,
        checkedAt,
        sourceDate,
      }),
      lastUpdated: financialMetricEvidence({
        fieldKey: `competitor_metrics.${source.fieldKeySlug}.last_updated`,
        value: sourceDate,
        source,
        checkedAt,
        sourceDate,
      }),
      productEquivalent: `China textile-auxiliaries competitor context. ${segmentText}`,
      activeContent: segmentText,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceTier: 'Tier 4 - Reputable market/financial reference',
      sourceDate,
      lastChecked: checkedAt,
      confidence: 'medium',
      evidenceStatus: 'Market Reference',
      reviewRequired: false,
      dataType: 'competitor_data',
      recommendedAction: 'Use as company-wide and segment financial context. Keep actual Chemicon-equivalent product price and market share review-gated until exact sources are imported.',
      riskReason: 'StockAnalysis reports S&P Global Market Intelligence financial data. This is useful company/segment context but not a current quote, product-line price, or market-share proof.',
    }
  }

  return null
}

export function marketReferencePageToMarketClaimUpdates(
  source: MarketReferenceSource,
  html: string,
  checkedAt: string,
): DashboardResearchUpdateItem[] {
  const parsed = marketReferenceClaimsFromText(source, html)
  return parsed.claims.map(claim => ({
    fieldKey: claim.fieldKey,
    label: claim.label,
    proposedDashboardField: claim.proposedDashboardField,
    value: claim.value,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceTier: 'Tier 4 - Paid/reputable market reference',
    sourceDate: parsed.sourceDate || checkedAt,
    lastChecked: checkedAt,
    confidence: claim.confidence,
    evidenceStatus: 'Market Reference',
    reviewRequired: true,
    dataType: 'market_size',
    recommendedAction: MARKET_REFERENCE_REVIEW_ACTION,
    riskReason: 'Market-reference data is useful for dashboard context, but market size, CAGR, segmentation, and competitor landscape claims require owner review before investor use.',
  }))
}

export function marketReferencePageToCompetitorContextUpdates(
  source: MarketReferenceSource,
  html: string,
  checkedAt: string,
): DashboardResearchUpdateItem[] {
  const parsed = marketReferenceCompetitorShareContextsFromText(source, html)
  return parsed.contexts.map(context => ({
    fieldKey: `competitor_metrics.${context.fieldKeySlug}.collective_esterquats_share_context`,
    companyName: context.companyName,
    countryRegion: context.countryRegion,
    productEquivalent: context.productEquivalent,
    marketShare: context.marketShare,
    value: context.marketShare,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceTier: 'Tier 4 - Paid/reputable market reference',
    sourceDate: parsed.sourceDate || checkedAt,
    lastChecked: checkedAt,
    confidence: 'medium',
    evidenceStatus: 'Market Reference',
    reviewRequired: true,
    dataType: 'competitor_data',
    recommendedAction: 'Use as competitor-landscape context only. Do not rank companies, label a market leader, or use in investor material until an individual company-specific market-share source is approved.',
    riskReason: context.riskReason,
  }))
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
      const response = await fetchWithTimeout(fetcher, `https://data.sec.gov/api/xbrl/companyfacts/CIK${source.cik}.json`, {
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
      const headers = {
        'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      }
      const fetched = await fetchOfficialTextCandidate(fetcher, source.sourceUrl, headers)
      const html = fetched.text
      let update = html ? officialCompanyPageToCompetitorFinancialUpdate(source, html, checkedAt) : null
      if (!update) {
        errors.push(`${source.companyName}: ${fetched.ok ? 'official financial metrics unavailable' : `official financial source returned ${fetched.status || 'unreachable'}`}`)
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
      const headers = {
        'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf',
      }
      const fetched = await fetchOfficialTextCandidate(fetcher, source.sourceUrl, headers)
      const html = fetched.text
      let update = html ? officialCompetitorProductPageToUpdate(source, html, checkedAt) : null
      if (!update) {
        errors.push(`${source.companyName}: ${fetched.ok ? 'official product evidence unavailable' : `official product source returned ${fetched.status || 'unreachable'}`}`)
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

async function applyOfficialCompetitorRecognitionEvidence(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['official competitor recognition connector: fetch is unavailable'] }

  for (const source of OFFICIAL_COMPETITOR_RECOGNITION_SOURCES) {
    try {
      const headers = {
        'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      }
      const fetched = await fetchOfficialTextCandidate(fetcher, source.sourceUrl, headers)
      const html = fetched.text
      let update = html ? officialCompetitorRecognitionPageToUpdate(source, html, checkedAt) : null
      if (!update) {
        errors.push(`${source.companyName}: ${fetched.ok ? 'official recognition evidence unavailable' : `official recognition source returned ${fetched.status || 'unreachable'}`}`)
        continue
      }
      const runKey = `official-competitor-recognition/${source.fieldKeySlug}/${checkedAt}`
      const result = applyDashboardUpdates(state, { competitorRecords: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.companyName}: ${err instanceof Error ? err.message : 'official competitor recognition connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyPublicCompetitorPriceEvidence(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['public competitor price connector: fetch is unavailable'] }

  for (const source of PUBLIC_COMPETITOR_PRICE_SOURCES) {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; Hermes Web UI dashboard intelligence connector; +http://localhost)',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      }
      const fetched = await fetchOfficialTextCandidate(fetcher, source.sourceUrl, headers, SOURCE_FETCH_TIMEOUT_MS)
      const html = fetched.text
      const update = html ? publicCompetitorPricePageToUpdate(source, html, checkedAt) : null
      if (!update) continue
      const runKey = `public-competitor-price/${source.fieldKeySlug}/${firstString(update.sourceDate, checkedAt)}`
      const result = applyDashboardUpdates(state, { competitorRecords: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.companyName}: ${err instanceof Error ? err.message : 'public competitor price connector failed'}`)
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
      const headers = {
        'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf',
      }
      const fetched = await fetchOfficialTextCandidate(fetcher, source.sourceUrl, headers)
      const html = fetched.text
      let update = html ? officialSupplierEvidencePageToUpdate(source, html, checkedAt) : null
      if (!update) {
        errors.push(`${source.supplier}: ${fetched.ok ? 'official supplier evidence unavailable' : `official supplier source returned ${fetched.status || 'unreachable'}`}`)
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

async function applyOfficialChemicalIdentityEvidence(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['official chemical identity connector: fetch is unavailable'] }

  for (const source of OFFICIAL_CHEMICAL_IDENTITY_SOURCES) {
    try {
      const headers = {
        'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
        Accept: 'application/json',
      }
      const identity = await fetchPubChemIdentityPayload(fetcher, source, headers)
      if (!identity.payload) {
        errors.push(`${source.material}: ${identity.error}`)
        continue
      }
      const update = pubChemIdentityPayloadToRawMaterialUpdate(source, identity.payload, checkedAt)
      if (!update) {
        errors.push(`${source.material}: PubChem identity row unavailable`)
        continue
      }
      const runKey = `official-pubchem-identity/${source.fieldKeySlug}/${firstString(update.sourceDate, checkedAt)}`
      const result = applyDashboardUpdates(state, { rawMaterialSignals: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.material}: ${err instanceof Error ? err.message : 'PubChem connector failed'}`)
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

  const responseCache = new Map<string, Promise<JsonFetchResult>>()
  let requestCount = 0
  let rateLimited = false

  for (const source of COMTRADE_TEXTILE_FINISHING_IMPORT_SOURCES) {
    if (rateLimited) break
    let imported = false
    let lastError = ''
    try {
      for (const period of latestComtradeCandidatePeriods()) {
        if (requestCount > 0) await sleep(comtradeFetchDelayMs())
        const response = await fetchJsonWithCache(fetcher, comtradeApiRequestUrl(source, period), {
          headers: {
            'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
            Accept: 'application/json',
          },
        }, responseCache)
        requestCount += 1
        if (response.status === 429) {
          const retryAfter = response.retryAfter ? ` Retry after ${response.retryAfter}.` : ''
          errors.push(`${source.country}: UN Comtrade rate limited (HTTP 429) for period ${period}; paused remaining Comtrade fetches for this import cycle.${retryAfter}`)
          rateLimited = true
          break
        }
        if (!response.ok) {
          lastError = `UN Comtrade returned ${response.status} for period ${period}`
          continue
        }
        const update = comtradeImportPayloadToMarketClaimUpdate(source, response.payload, checkedAt, period)
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
      if (!imported && !rateLimited && lastError) errors.push(`${source.country}: ${lastError}`)
    } catch (err) {
      errors.push(`${source.country}: ${err instanceof Error ? err.message : 'UN Comtrade connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyOfficialWorldBankMarketContext(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['official World Bank connector: fetch is unavailable'] }

  const fetchedUpdates = await Promise.all(WORLD_BANK_COUNTRY_CONTEXT_SOURCES.map(async (source) => {
    try {
      const response = await fetchWithTimeout(fetcher, worldBankIndicatorApiUrl(source), {
        headers: {
          'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
          Accept: 'application/json',
        },
      })
      if (!response.ok) {
        return { source, update: null, error: `${source.country} ${source.label}: World Bank API returned ${response.status}` }
      }
      const payload = await response.json()
      const update = worldBankIndicatorPayloadToMarketClaimUpdate(source, payload, checkedAt)
      if (!update) {
        return { source, update: null, error: `${source.country} ${source.label}: World Bank API did not return a usable annual value` }
      }
      return { source, update, error: '' }
    } catch (err) {
      return {
        source,
        update: null,
        error: `${source.country} ${source.label}: ${err instanceof Error ? err.message : 'World Bank connector failed'}`,
      }
    }
  }))

  for (const item of fetchedUpdates) {
    if (item.error) {
      errors.push(item.error)
      continue
    }
    if (!item.update) continue
    try {
      const runKey = `official-world-bank/${item.source.fieldKeySlug}/${item.source.indicator}/${firstString(item.update.sourceDate, checkedAt)}`
      const result = applyDashboardUpdates(state, { marketClaims: [item.update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${item.source.country} ${item.source.label}: ${err instanceof Error ? err.message : 'World Bank connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyMarketReferenceEvidence(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['market reference connector: fetch is unavailable'] }

  for (const source of MARKET_REFERENCE_SOURCES) {
    try {
      const headers = {
        'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      }
      const fetched = await fetchOfficialTextCandidate(fetcher, source.sourceUrl, headers)
      const html = fetched.text
      let updates = html ? marketReferencePageToMarketClaimUpdates(source, html, checkedAt) : []
      let competitorContextUpdates = html ? marketReferencePageToCompetitorContextUpdates(source, html, checkedAt) : []
      if (updates.length === 0 && competitorContextUpdates.length === 0) {
        errors.push(`${source.sourceTitle}: ${fetched.ok ? 'market reference facts unavailable' : `market reference source returned ${fetched.status || 'unreachable'}`}`)
        continue
      }
      const runKey = `market-reference/${source.fieldKeySlug}/${firstString(updates[0]?.sourceDate, competitorContextUpdates[0]?.sourceDate, checkedAt)}`
      const result = applyDashboardUpdates(state, {
        marketClaims: updates,
        competitorRecords: competitorContextUpdates,
      }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.sourceTitle}: ${err instanceof Error ? err.message : 'market reference connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyMarketReferenceTrafficEvidence(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['market reference traffic connector: fetch is unavailable'] }

  const fetchedUpdates = await Promise.all(MARKET_REFERENCE_TRAFFIC_SOURCES.map(async (source) => {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; Hermes Web UI dashboard intelligence connector; +http://localhost)',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      }
      const fetched = await fetchOfficialTextCandidate(fetcher, source.sourceUrl, headers, TRAFFIC_SOURCE_FETCH_TIMEOUT_MS)
      const html = fetched.text
      const update = html ? marketReferenceTrafficPageToCompetitorUpdate(source, html, checkedAt) : null
      if (!update) return { source, update: null, error: '' }
      return { source, update, error: '' }
    } catch (err) {
      return {
        source,
        update: null,
        error: `${source.companyName}: ${err instanceof Error ? err.message : 'market reference traffic connector failed'}`,
      }
    }
  }))

  for (const item of fetchedUpdates) {
    if (item.error) {
      errors.push(item.error)
      continue
    }
    if (!item.update) continue
    try {
      const update = item.update
      const source = item.source
      const runKey = `market-reference-traffic/${source.fieldKeySlug}/${firstString(update.sourceDate, checkedAt)}`
      const result = applyDashboardUpdates(state, { competitorRecords: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${item.source.companyName}: ${err instanceof Error ? err.message : 'market reference traffic connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyTrancoTrafficRankEvidence(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['Tranco traffic rank connector: fetch is unavailable'] }

  const delayMs = trancoFetchDelayMs()
  for (const [index, source] of TRANCO_TRAFFIC_RANK_SOURCES.entries()) {
    if (index > 0) await sleep(delayMs)
    try {
      const response = await fetchWithTimeout(fetcher, trancoTrafficRankApiUrl(source.domain), {
        headers: {
          'User-Agent': 'Hermes Web UI dashboard intelligence connector admin@localhost',
          Accept: 'application/json',
        },
      }, SOURCE_FETCH_TIMEOUT_MS)
      if (!response.ok) {
        errors.push(`${source.companyName}: Tranco returned ${response.status}`)
        continue
      }
      const payload = await response.json()
      const update = trancoRanksPayloadToCompetitorUpdate(source, payload, checkedAt)
      if (!update) {
        errors.push(`${source.companyName}: Tranco rank unavailable`)
        continue
      }
      const runKey = `tranco-traffic-rank/${source.fieldKeySlug}/${firstString(update.sourceDate, checkedAt)}`
      const result = applyDashboardUpdates(state, { competitorRecords: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.companyName}: ${err instanceof Error ? err.message : 'Tranco traffic rank connector failed'}`)
    }
  }

  return { autoFilledCount, stagedReviewCount, errors }
}

async function applyMarketReferenceCompetitorFinancialEvidence(
  state: DashboardIntelligenceState,
  checkedAt: string,
): Promise<OfficialConnectorResult> {
  let autoFilledCount = 0
  let stagedReviewCount = 0
  const errors: string[] = []
  const fetcher = globalThis.fetch
  if (typeof fetcher !== 'function') return { autoFilledCount, stagedReviewCount, errors: ['market reference financial connector: fetch is unavailable'] }

  for (const source of MARKET_REFERENCE_COMPETITOR_FINANCIAL_SOURCES) {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; Hermes Web UI dashboard intelligence connector; +http://localhost)',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      }
      const fetched = await fetchOfficialTextCandidate(fetcher, source.sourceUrl, headers, SOURCE_FETCH_TIMEOUT_MS)
      const html = fetched.text
      const update = html ? marketReferenceFinancialPageToCompetitorUpdate(source, html, checkedAt) : null
      if (!update) {
        errors.push(`${source.companyName}: ${fetched.ok ? 'market reference financial metrics unavailable' : `market reference financial source returned ${fetched.status || 'unreachable'}`}`)
        continue
      }
      const runKey = `market-reference-financials/${source.fieldKeySlug}/${firstString(update.sourceDate, checkedAt)}`
      const result = applyDashboardUpdates(state, { competitorRecords: [update] }, runKey, checkedAt)
      autoFilledCount += result.autoFilledCount
      stagedReviewCount += result.stagedReviewCount
    } catch (err) {
      errors.push(`${source.companyName}: ${err instanceof Error ? err.message : 'market reference financial connector failed'}`)
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
  const prunedMalformedMarketReferenceClaims = pruneMalformedMarketReferenceClaims(state)
  const officialConnectorsEnabled = options.includeOfficialConnectors ?? process.env.NODE_ENV !== 'test'
  const officialCompanyFinancialConnectorsEnabled = options.includeOfficialCompanyFinancialConnectors ?? officialConnectorsEnabled
  const officialProductConnectorsEnabled = options.includeOfficialProductConnectors ?? officialConnectorsEnabled
  const officialRecognitionConnectorsEnabled = options.includeOfficialRecognitionConnectors ?? officialConnectorsEnabled
  const officialSupplierConnectorsEnabled = options.includeOfficialSupplierConnectors ?? officialConnectorsEnabled
  const officialChemicalIdentityConnectorsEnabled = options.includeOfficialChemicalIdentityConnectors ?? officialConnectorsEnabled
  const publicPriceEvidenceConnectorsEnabled = options.includePublicPriceEvidenceConnectors ?? officialConnectorsEnabled
  const officialTradeConnectorsEnabled = options.includeOfficialTradeConnectors ?? officialConnectorsEnabled
  const officialWorldBankConnectorsEnabled = options.includeOfficialWorldBankConnectors ?? officialConnectorsEnabled
  const marketReferenceConnectorsEnabled = options.includeMarketReferenceConnectors ?? process.env.NODE_ENV !== 'test'
  const marketReferenceTrafficConnectorsEnabled = options.includeMarketReferenceTrafficConnectors ?? marketReferenceConnectorsEnabled
  const trancoTrafficConnectorsEnabled = options.includeTrancoTrafficConnectors ?? marketReferenceTrafficConnectorsEnabled
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
  if (officialRecognitionConnectorsEnabled) {
    const officialRecognition = await applyOfficialCompetitorRecognitionEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += officialRecognition.autoFilledCount
    result.stagedReviewCount += officialRecognition.stagedReviewCount
    result.errors.push(...officialRecognition.errors.map(error => `official source connector: ${error}`))
  }
  if (officialSupplierConnectorsEnabled) {
    const officialSupplier = await applyOfficialSupplierEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += officialSupplier.autoFilledCount
    result.stagedReviewCount += officialSupplier.stagedReviewCount
    result.errors.push(...officialSupplier.errors.map(error => `official source connector: ${error}`))
  }
  if (officialChemicalIdentityConnectorsEnabled) {
    const officialChemicalIdentity = await applyOfficialChemicalIdentityEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += officialChemicalIdentity.autoFilledCount
    result.stagedReviewCount += officialChemicalIdentity.stagedReviewCount
    result.errors.push(...officialChemicalIdentity.errors.map(error => `official source connector: ${error}`))
  }
  if (publicPriceEvidenceConnectorsEnabled) {
    const publicPriceEvidence = await applyPublicCompetitorPriceEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += publicPriceEvidence.autoFilledCount
    result.stagedReviewCount += publicPriceEvidence.stagedReviewCount
    result.errors.push(...publicPriceEvidence.errors.map(error => `public price connector: ${error}`))
  }
  if (officialTradeConnectorsEnabled) {
    const officialTrade = await applyOfficialComtradeMarketProxies(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += officialTrade.autoFilledCount
    result.stagedReviewCount += officialTrade.stagedReviewCount
    result.errors.push(...officialTrade.errors.map(error => `official source connector: ${error}`))
  }
  if (officialWorldBankConnectorsEnabled) {
    const officialWorldBank = await applyOfficialWorldBankMarketContext(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += officialWorldBank.autoFilledCount
    result.stagedReviewCount += officialWorldBank.stagedReviewCount
    result.errors.push(...officialWorldBank.errors.map(error => `official source connector: ${error}`))
  }
  if (marketReferenceConnectorsEnabled) {
    const marketReference = await applyMarketReferenceEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += marketReference.autoFilledCount
    result.stagedReviewCount += marketReference.stagedReviewCount
    result.errors.push(...marketReference.errors.map(error => `market reference connector: ${error}`))
    const marketReferenceFinancial = await applyMarketReferenceCompetitorFinancialEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += marketReferenceFinancial.autoFilledCount
    result.stagedReviewCount += marketReferenceFinancial.stagedReviewCount
    result.errors.push(...marketReferenceFinancial.errors.map(error => `market reference connector: ${error}`))
  }
  if (marketReferenceTrafficConnectorsEnabled) {
    const marketReferenceTraffic = await applyMarketReferenceTrafficEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += marketReferenceTraffic.autoFilledCount
    result.stagedReviewCount += marketReferenceTraffic.stagedReviewCount
    result.errors.push(...marketReferenceTraffic.errors.map(error => `market reference connector: ${error}`))
  }
  if (trancoTrafficConnectorsEnabled) {
    const trancoTraffic = await applyTrancoTrafficRankEvidence(state, new Date().toISOString().slice(0, 10))
    result.autoFilledCount += trancoTraffic.autoFilledCount
    result.stagedReviewCount += trancoTraffic.stagedReviewCount
    result.errors.push(...trancoTraffic.errors.map(error => `market reference connector: ${error}`))
  }

  if (discoveredOutputs.outputFiles.length === 0) {
    try {
      result.missingCoverageFollowUpStarted = await ensureMissingCoverageFollowUp(profile, state)
    } catch (err) {
      result.errors.push(`missing coverage follow-up: ${err instanceof Error ? err.message : 'failed to start follow-up research'}`)
    }

    if (
      result.autoFilledCount > 0 ||
      result.stagedReviewCount > 0 ||
      prunedMalformedMarketReferenceClaims > 0 ||
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
    prunedMalformedMarketReferenceClaims > 0 ||
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
