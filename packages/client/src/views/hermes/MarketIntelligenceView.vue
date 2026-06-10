<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NTag, useMessage } from 'naive-ui'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import {
  type CompetitorIntelligenceRecord,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import { useTrustedSourceAutopilot } from '@/composables/useTrustedSourceAutopilot'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import {
  canAccessRouteName,
  getFrontendAccessRole,
  shouldRedactForEmployee,
} from '@/utils/accessControl'
import {
  displayAutomaticVerificationText,
  displayEvidenceStatus,
  displayUnresolvedValue,
  normalizedMarketClaimStatus,
  sourceIsUsable,
  type IntelligenceEvidenceStatus,
  type MarketClaim,
} from '@/utils/investorIntelligence'
import {
  EXECUTIVE_INTELLIGENCE_STORAGE_KEY,
  EXECUTIVE_REFRESH_JOB_NAME,
  defaultExecutiveRefreshState,
  marketClaimSourceLabel,
  marketClaimValue,
  nextTwiceDailyRefresh,
  type ExecutiveRefreshState,
} from '@/utils/executiveIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const autopilot = useTrustedSourceAutopilot()
const creating = ref('')
const creatingClaimTaskId = ref('')
const editingClaimId = ref<string | null>(null)
const syncingMarket = ref(false)
const refreshState = ref<ExecutiveRefreshState>(defaultExecutiveRefreshState())
const growthPeriod = ref('5 years')
const frontendRole = computed(() => getFrontendAccessRole())
const redactSensitiveFields = computed(() => shouldRedactForEmployee(frontendRole.value))
const sensitiveMarketTerms = /\b(price|pricing|cost|costing|supplier\s+quote|supplier\s+price|landed\s+cost|margin|irr|npv|payback|formula|cas\s+list|raw\s+material\s+ratio|investor\s+terms|valuation|equity)\b/i

interface CountryConsumptionGrowthRow {
  country: string
  growthSignal: string
  proxyMetric: string
  sourceBackedEvidence: string
  directSoftenerConsumption: string
  status: IntelligenceEvidenceStatus
  source: string
  confidence: string
  lastChecked: string
  nextAction: string
  autoImported?: boolean
}

interface GlobalMarketSignalRow {
  signal: string
  finding: string
  status: IntelligenceEvidenceStatus
  source: string
  businessMeaning: string
  nextAction: string
}

interface GlobalOpportunityRegionRow {
  region: string
  demandSignal: string
  verifiedEvidence: string
  missingEvidence: string
  status: IntelligenceEvidenceStatus
}

type CompetitorMetricEvidence = NonNullable<CompetitorIntelligenceRecord['metricEvidence']>[keyof NonNullable<CompetitorIntelligenceRecord['metricEvidence']>]

const NO_APPROVED_SOURCE_VALUE = 'No approved source-backed value'
const MARKET_REVIEW_SOURCE_LABEL = 'Trusted Sources / Research Review'
const SOURCE_FOUND_REVIEW_REQUIRED = 'Source found - review required'
const REVIEW_REQUIRED_VALUE = 'Review required'
const approvedMarketTruthStatuses: IntelligenceEvidenceStatus[] = [
  'Verified',
  'Source-backed',
  'Official Data',
  'Trusted Source Auto-Updated',
  'User Approved',
  'Investor Approved',
  'Approved Assumption',
]
const trustedCountrySignalStatuses: IntelligenceEvidenceStatus[] = [
  ...approvedMarketTruthStatuses,
  'Trade Proxy',
]
const criticalMarketStatusBlocklist: IntelligenceEvidenceStatus[] = [
  'Missing',
  'To Verify',
  'Reference Only',
  'Candidate Source',
  'Conflict Detected',
  'Hypothesis',
  'Trade Proxy',
  'Market Reference',
]
const trackedCountryNames = [
  'China',
  'India',
  'Vietnam',
  'Bangladesh',
  'Turkey',
  'Turkiye',
  'Pakistan',
  'Indonesia',
  'United States',
  'USA',
  'Germany',
  'EU',
  'European Union',
  'Saudi Arabia',
  'GCC',
  'Middle East',
  'United Arab Emirates',
  'UAE',
]

const claimForm = ref({
  label: '',
  value: '',
  evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus,
  confidence: 'low' as NonNullable<MarketClaim['confidence']>,
  sourceTitle: '',
  sourceUrl: '',
  sourceDate: '',
})

const sections = [
  'Market Questions',
  'Product Demand Research',
  'Country/Region Growth Research',
  'Customer Segments',
  'Pricing Evidence',
  'Source Library',
  'Research Jobs',
  'Verified / Auto-Verification Claims',
]

const claims = computed(() => intelligence.state.value.marketClaims)
const sourceReadyCount = computed(() =>
  claims.value.filter(claim =>
    claimHasUsableSourceValue(claim) &&
    !isSensitiveMarketClaim(claim) &&
    !isPlaceholderOnlyClaim(claim),
  ).length,
)
const claimSubmitLabel = computed(() => editingClaimId.value ? 'Update claim' : 'Save claim')
const visibleSections = computed(() =>
  sections.filter(section => !redactSensitiveFields.value || !sensitiveMarketTerms.test(section)),
)
const visibleClaims = computed(() =>
  claims.value.map(claim => ({
    claim,
    restricted: isSensitiveMarketClaim(claim),
  })),
)
const marketSizeClaim = computed(() => findMarketClaim(['market size / scope', 'market size', 'market value', 'total addressable market', 'market scope']))
const growthClaim = computed(() => findMarketClaim(['growth rate', 'market growth', 'cagr']))
const competitorClaimCount = computed(() => intelligence.state.value.competitors.filter(competitorHasUsableDashboardEvidence).length)
const executiveMarketMetrics = computed(() => [
  marketMetric('Market Size / Scope', marketSizeClaim.value),
  marketMetric('Growth Rate', growthClaim.value),
  marketMetric('Import Dependence', findMarketClaim(['import dependence', 'import share', 'import reliance'])),
  marketMetric('Our Target', findMarketClaim(['our target', 'target segment', 'target market'])),
  marketMetric('Opportunity Score', findMarketClaim(['opportunity score', 'market opportunity'])),
  {
    label: 'Competitor Records',
    value: competitorClaimCount.value ? String(competitorClaimCount.value) : 'No approved source-backed value',
    evidenceStatus: competitorClaimCount.value ? 'Source-backed' as IntelligenceEvidenceStatus : 'Reference Only' as IntelligenceEvidenceStatus,
    sourceLabel: competitorClaimCount.value ? 'Competitor Intelligence records' : 'Trusted Sources / Research Review',
  },
])
const marketSegments = computed(() => [
  marketSegment('Textile Softeners Total', ['textile softeners total', 'textile softener market']),
  marketSegment('Cationic / Ester Quat', ['cationic', 'ester quat', 'esterquat']),
  marketSegment('Silicone Softeners', ['silicone softener']),
  marketSegment('Non-ionic', ['non-ionic', 'nonionic']),
  marketSegment('CWAS / CWMS Target Segment', ['cwas', 'cwms', 'target segment']),
  marketSegment('Export Opportunity', ['export opportunity', 'export market']),
])
const targetOpportunityRows = computed(() => [
  opportunityRow('China provinces', ['china province', 'jiangsu', 'zhejiang', 'guangdong']),
  opportunityRow('Bangladesh', ['bangladesh']),
  opportunityRow('Vietnam', ['vietnam']),
  opportunityRow('India', ['india']),
  opportunityRow('Pakistan', ['pakistan']),
  opportunityRow('Turkey', ['turkey', 'turkiye']),
  opportunityRow('Indonesia', ['indonesia']),
  opportunityRow('EU / Germany', ['eu', 'european union', 'germany']),
  opportunityRow('United States', ['united states', 'usa']),
  opportunityRow('GCC / Middle East', ['gcc', 'middle east', 'saudi arabia', 'united arab emirates', 'uae']),
])
const topCompetitorRows = computed(() => {
  const records = intelligence.state.value.competitors
    .filter(competitorHasUsableDashboardEvidence)
    .slice(0, 5)
  return records.map(record => {
    const shareEvidence = record.metricEvidence?.marketShare
    const share = shareEvidence?.value?.trim() &&
      competitorMetricCanDriveMarketDisplay(shareEvidence, record.evidenceStatus)
      ? shareEvidence.value
      : 'Not published by cited source'
    return {
      company: record.companyName || 'Hermes source search running',
      region: record.countryRegion || 'Hermes source search running',
      product: record.productEquivalent || 'Hermes source search running',
      share,
      source: record.source?.title || 'Source search running',
      status: record.evidenceStatus,
    }
  })
})
const marketAutopilotCards = computed(() => [
  {
    icon: '🔎',
    label: 'Research',
    value: 'Trusted sources',
    note: 'Hermes searches official, company, trade, regulatory, and uploaded evidence sources.',
  },
  {
    icon: '📊',
    label: 'Market data',
    value: sourceReadyCount.value ? `${sourceReadyCount.value} source-attached` : 'Waiting',
    note: sourceReadyCount.value
      ? 'Source-attached market records fill this page only through review-gated surfaces.'
      : 'No source-attached market records imported yet.',
  },
  {
    icon: '🌍',
    label: 'Country growth',
    value: autopilotCountryGrowthRows.value.length
      ? `${autopilotCountryGrowthRows.value.length} auto`
      : 'Waiting',
    note: autopilotCountryGrowthRows.value.length
      ? 'Official trade-proxy growth records are filling from trusted-source imports.'
      : 'Country rows appear only after trusted-source imports or review approval.',
  },
  {
    icon: '✅',
    label: 'Review gate',
    value: `${intelligence.pendingResearchFindings.value.filter(item => item.area === 'market').length} waiting`,
    note: 'Market size, CAGR, competitor share, prices, and investor claims wait for approval.',
  },
])
const sourceBackedTemplateKpis = [
  {
    label: 'China Market',
    value: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'S&P Global Textile Chemicals abstract, 2025',
    note: 'Reference only. Not source-backed dashboard truth until imported by Trusted Sources / Research Review.',
  },
  {
    label: 'Growth Rate',
    value: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research esterquats report page',
    note: 'Reference only. Do not use as market CAGR until imported as approved source-backed evidence.',
  },
  {
    label: 'Import Dependence',
    value: 'Trade-proxy source connected',
    status: 'Trade Proxy' as IntelligenceEvidenceStatus,
    source: 'WTO / World Bank WITS trade data',
    note: 'Use WITS/UN Comtrade for import/export research; no direct textile-softener HS code is approved yet.',
  },
  {
    label: 'Chemicon Target',
    value: 'Reference archived pending owner-approved claim import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Chemicon feasibility planning archive',
    note: 'Reference only. Do not use as a target until an owner-approved sourced claim is imported.',
  },
]
const sourceBackedSegments = [
  {
    segment: 'Textile Chemicals - Mainland China',
    size: 'Reference archived pending trusted-source import',
    growth: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'S&P Global Textile Chemicals abstract, 2025',
  },
  {
    segment: 'Dyes & Pigments',
    size: 'Reference archived pending trusted-source import',
    growth: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'S&P Global Textile Chemicals abstract, 2025',
  },
  {
    segment: 'Global Esterquats',
    size: 'Reference archived pending trusted-source import',
    growth: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research esterquats report page',
  },
  {
    segment: 'Fabric Care Esterquats',
    size: 'Reference archived pending trusted-source import',
    growth: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research esterquats report page',
  },
  {
    segment: 'Cationic / Ester Quat Textile Softeners',
    size: 'Reference archived pending trusted-source import',
    growth: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research esterquats report page',
  },
  {
    segment: 'Silicone / Non-ionic Textile Softeners',
    size: 'Official competitor product pages confirm active segment',
    growth: 'No cited public CAGR for this exact segment',
    status: 'Candidate Source' as IntelligenceEvidenceStatus,
    source: 'WACKER / RUDOLF / Archroma official product pages',
  },
]
const sourceBackedTargetRegions = [
  {
    region: 'Zhejiang / Shaoxing / Keqiao',
    value: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'China gov / Xinhua, Mar 2024',
  },
  {
    region: 'Jiangsu + Zhejiang textile clusters',
    value: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'SWITCH-Asia / CNIS project page',
  },
  {
    region: 'Huzhou + Shaoxing circular-textile focus',
    value: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'SWITCH-Asia / CNIS project page',
  },
  {
    region: 'Guangdong / Fujian / Shandong',
    value: 'Reference archived pending trusted-source import',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'WITS/UN Comtrade plus province cluster research required',
  },
]
const sourceBackedCompetitorReferences = [
  {
    rank: '1',
    manufacturer: 'Stepan Company',
    role: 'Listed key esterquats company',
    capacity: 'Not published by cited source',
    share: 'Not published by cited source',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
  {
    rank: '2',
    manufacturer: 'Kao Chemicals Europe',
    role: 'Listed key esterquats company',
    capacity: 'Not published by cited source',
    share: 'Not published by cited source',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
  {
    rank: '3',
    manufacturer: 'Evonik Industries',
    role: 'Listed key esterquats company',
    capacity: 'Not published by cited source',
    share: 'Not published by cited source',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
  {
    rank: '4',
    manufacturer: 'BASF SE',
    role: 'Listed key esterquats company',
    capacity: 'Not published by cited source',
    share: 'Not published by cited source',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
  {
    rank: '5',
    manufacturer: 'Solvay S.A.',
    role: 'Listed key esterquats company',
    capacity: 'Not published by cited source',
    share: 'Not published by cited source',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
]
const sourceBackedTemplateSources = [
  {
    title: 'China gov / Xinhua - Keqiao textile cluster',
    detail: 'Reference source archived for cluster research. Import a reviewed claim before showing any number as dashboard truth.',
    url: 'https://english.www.gov.cn/news/202403/16/content_WS65f50107c6d0868f4e8e5257.html',
  },
  {
    title: 'SWITCH-Asia / CNIS circular-textile project',
    detail: 'Reference source archived for province research. Import reviewed source-backed claims before use.',
    url: 'https://switch-asia.eu/project/transitions-to-circular-economy-practices-in-textile-and-apparel-msmes-along-the-lifecycle-in-huzhou-and-shaoxing/',
  },
  {
    title: 'S&P Global - Textile Chemicals public abstract',
    detail: 'Reference source archived for global market context. Numeric market claims must be imported and reviewed first.',
    url: 'https://www.spglobal.com/content/dam/spglobal/ci/en/documents/products/pdf/CI_0825-SCUP-Textile-Chemicals-Abstract-TOC-June-2025.pdf',
  },
  {
    title: 'Grand View Research - Esterquats report page',
    detail: 'Reference source archived for esterquat context. Market size and CAGR stay out of primary surfaces until reviewed.',
    url: 'https://www.grandviewresearch.com/industry-analysis/esterquats-market',
  },
  {
    title: 'WTO / World Bank WITS - textile trade context',
    detail: 'Use trade datasets to prioritize export-market research. Treat textile/apparel trade as a proxy, not direct softener demand.',
    url: 'https://wits.worldbank.org/',
  },
  {
    title: 'OECD-FAO Agricultural Outlook - cotton consumption',
    detail: 'Reference source archived for cotton-use proxy research. Country growth must come from imported trusted-source claims.',
    url: 'https://www.oecd.org/en/publications/oecd-fao-agricultural-outlook-2025-2034_601276cd-en/full-report/cotton_a0374fa8',
  },
]
const importedMarketClaims = computed(() =>
  claims.value.filter(claim =>
    claimHasUsableSourceValue(claim) &&
    !isSensitiveMarketClaim(claim) &&
    !isPlaceholderOnlyClaim(claim),
  ),
)
const trustedCountryGrowthClaims = computed(() =>
  importedMarketClaims.value.filter(claimCanDisplayCountryGrowthSignal),
)
const globalMarketIntelligenceRows = computed<GlobalMarketSignalRow[]>(() =>
  importedMarketClaims.value.slice(0, 6).map(claim => {
    const status = marketClaimDisplayStatus(claim)
    const displayAsEvidence = canDisplayMarketClaimAsDashboardTruth(claim) || claimCanDisplayCountryGrowthSignal(claim)
    return {
      signal: claim.proposedDashboardField || claim.label,
      finding: marketClaimValueForPrimarySurface(claim),
      status,
      source: marketClaimSourceLabel(claim),
      businessMeaning: displayAsEvidence
        ? 'Imported trusted-source signal. Confirm scope before treating it as product-specific demand.'
        : 'Source is attached, but this claim is review-gated before dashboard or investor use.',
      nextAction: `Review source scope for ${claim.proposedDashboardField || claim.label}.`,
    }
  }),
)
const globalOpportunityRegions = computed<GlobalOpportunityRegionRow[]>(() =>
  importedMarketClaims.value
    .filter(claim => /country|region|province|target|export|opportunit|trade proxy|import signal/i.test(claimSearchText(claim, true)))
    .slice(0, 6)
    .map(claim => ({
      region: opportunityRegionLabel(claim),
      demandSignal: marketClaimValueForPrimarySurface(claim),
      verifiedEvidence: marketClaimSourceLabel(claim),
      missingEvidence: criticalMarketClaimIsReviewGated(claim)
        ? 'Review approval required before use as a target, market size, CAGR, import-dependence, or opportunity claim.'
        : 'Direct textile-softener consumption proof still needs review unless the source explicitly proves it.',
      status: marketClaimDisplayStatus(claim),
    })),
)
const autopilotCountryGrowthRows = computed<CountryConsumptionGrowthRow[]>(() =>
  trustedCountryGrowthClaims.value.flatMap(countryGrowthRowsFromClaim),
)
const displayCountryConsumptionGrowthRows = computed<CountryConsumptionGrowthRow[]>(() => autopilotCountryGrowthRows.value)
const countryGrowthSummaryCards = computed(() => {
  const rows = displayCountryConsumptionGrowthRows.value
  const autoImported = rows.filter(row => row.autoImported).length
  const directDemandNeedingProof = rows.filter(row => /no direct/i.test(row.directSoftenerConsumption)).length
  const sourceBackedOrReference = rows.filter(row =>
    row.status === 'Source-backed' ||
    row.status === 'Trusted Source Auto-Updated' ||
    row.status === 'Official Data' ||
    row.status === 'Trade Proxy',
  ).length
  return [
    {
      icon: '🌍',
      label: 'Countries tracked',
      value: String(rows.length),
      detail: 'Global textile and trade-proxy signals Hermes is watching.',
    },
    {
      icon: '📥',
      label: 'Auto-imported',
      value: autoImported ? String(autoImported) : 'Waiting',
      detail: autoImported ? 'Official trade-proxy rows imported from trusted sources.' : 'Hermes will fill this when source runs return structured rows.',
    },
    {
      icon: '🧾',
      label: 'Source-attached signals',
      value: String(sourceBackedOrReference),
      detail: 'Rows with a source label, still not direct softener consumption unless stated.',
    },
    {
      icon: '🔍',
      label: 'Need direct proof',
      value: String(directDemandNeedingProof),
      detail: 'Country-level textile-softener consumption stays in source review until direct evidence is found.',
    },
  ]
})
const countryMarketMapRows = computed(() =>
  displayCountryConsumptionGrowthRows.value.slice(0, 10).map(row => ({
    ...row,
    flag: countryFlag(row.country),
    directDemandMissing: /no direct/i.test(row.directSoftenerConsumption),
  })),
)
const marketResearchQuestions = [
  {
    question: 'What is the actual China textile-softener demand by cationic, esterquat, silicone, and non-ionic category?',
    why: 'This is the core market-size question; global textile chemicals and esterquats are only proxies.',
    evidenceNeeded: 'Paid/source-backed market report, mill interviews, distributor quotes, or customs/trade proxy with clear HS mapping.',
  },
  {
    question: 'Which clusters should Chemicon validate first: Keqiao/Shaoxing, Changzhou/Jiangsu, Foshan/Guangdong, Quanzhou/Fujian, or Shandong?',
    why: 'Cluster prioritization decides sales travel, distributor outreach, and sample strategy.',
    evidenceNeeded: 'Cluster production data, finishing mill list, customer interviews, and competitor/distributor presence.',
  },
  {
    question: 'What competitor products are true CWAS/CWMS equivalents?',
    why: 'Without active content, application, form, and TDS/SDS comparison, pricing comparisons are misleading.',
    evidenceNeeded: 'TDS/SDS, active content, application guide, sample test results, and customer validation.',
  },
  {
    question: 'What price bands are source-backed and employee-safe to show?',
    why: 'Pricing can be cost-sensitive and must not appear as fake market proof.',
    evidenceNeeded: 'Quotes, invoices, distributor screenshots, public listings, source date, and confidentiality label.',
  },
]
const pdfChinaImportRows = [
  { rank: 'Archived', country: 'South Korea', t2022: 'Reference value archived', t2023: 'Reference value archived', t2024: 'Reference value archived', value2024: 'Reference value archived', usdPerKg: 'Reference value archived' },
  { rank: 'Archived', country: 'India', t2022: 'Reference value archived', t2023: 'Reference value archived', t2024: 'Reference value archived', value2024: 'Reference value archived', usdPerKg: 'Reference value archived' },
  { rank: 'Archived', country: 'Japan', t2022: 'Reference value archived', t2023: 'Reference value archived', t2024: 'Reference value archived', value2024: 'Reference value archived', usdPerKg: 'Reference value archived' },
  { rank: 'Archived', country: 'Malaysia', t2022: 'Reference value archived', t2023: 'Reference value archived', t2024: 'Reference value archived', value2024: 'Reference value archived', usdPerKg: 'Reference value archived' },
  { rank: 'Archived', country: 'Thailand', t2022: 'Reference value archived', t2023: 'Reference value archived', t2024: 'Reference value archived', value2024: 'Reference value archived', usdPerKg: 'Reference value archived' },
]
const pdfCountryConsumptionRows = [
  { country: 'China', kt2023: 'Reference value archived', kt2024: 'Reference value archived', change: 'Reference value archived' },
  { country: 'USA', kt2023: 'Reference value archived', kt2024: 'Reference value archived', change: 'Reference value archived' },
  { country: 'India', kt2023: 'Reference value archived', kt2024: 'Reference value archived', change: 'Reference value archived' },
  { country: 'Bangladesh', kt2023: 'Reference value archived', kt2024: 'Reference value archived', change: 'Reference value archived' },
  { country: 'Vietnam', kt2023: 'Reference value archived', kt2024: 'Reference value archived', change: 'Reference value archived' },
]
const pdfMarketSegmentRows = [
  { segment: 'Textile Softeners Total', size: 'Reference value archived', growth: 'Reference value archived' },
  { segment: 'Cationic / Ester Quat', size: 'Reference value archived', growth: 'Reference value archived' },
  { segment: 'Silicone Softeners', size: 'Reference value archived', growth: 'Reference value archived' },
  { segment: 'Non-ionic', size: 'Reference value archived', growth: 'Reference value archived' },
  { segment: 'SOM target scenario', size: 'Reference value archived', growth: 'Reference value archived' },
]

function canUseRoute(routeName: string): boolean {
  return canAccessRouteName(routeName, frontendRole.value)
}

function loadRefreshState() {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(EXECUTIVE_INTELLIGENCE_STORAGE_KEY)
    refreshState.value = raw
      ? { ...defaultExecutiveRefreshState(), ...JSON.parse(raw) }
      : defaultExecutiveRefreshState()
  } catch {
    refreshState.value = defaultExecutiveRefreshState()
  }
}

function persistRefreshState(patch: Partial<ExecutiveRefreshState>) {
  refreshState.value = {
    ...refreshState.value,
    ...patch,
    scheduleDisplay: '09:00 and 21:00 local time',
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(EXECUTIVE_INTELLIGENCE_STORAGE_KEY, JSON.stringify(refreshState.value))
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function statusType(status: IntelligenceEvidenceStatus): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (marketStatusIsApprovedDashboardTruth(status)) return 'success'
  if (status === 'Assumption' || status === 'Powerful Assumption' || status === 'Derived from Assumptions' || status === 'Reference Only') return 'warning'
  if (status === 'Missing' || status === 'To Verify') return 'error'
  return 'info'
}

function displayMarketValue(value?: string | number | null): string {
  return displayUnresolvedValue(value)
}

function displayMarketStatus(status?: string | null): string {
  return displayEvidenceStatus(status)
}

function displayMarketText(text?: string | null): string {
  return displayAutomaticVerificationText(text)
}

function claimHasUsableSourceValue(claim: MarketClaim | null | undefined): boolean {
  return Boolean(claim?.value?.trim() && sourceIsUsable(claim.source))
}

function marketStatusIsApprovedDashboardTruth(status?: string | null): boolean {
  return approvedMarketTruthStatuses.includes(status as IntelligenceEvidenceStatus)
}

function competitorMetricCanDriveMarketDisplay(item: CompetitorMetricEvidence | null | undefined, fallbackStatus?: IntelligenceEvidenceStatus): boolean {
  const status = (item?.evidenceStatus || fallbackStatus || 'To Verify') as IntelligenceEvidenceStatus
  return Boolean(sourceIsUsable(item?.source) && !item?.reviewRequired && marketStatusIsApprovedDashboardTruth(status))
}

function competitorHasUsableDashboardEvidence(record: CompetitorIntelligenceRecord): boolean {
  const metricEvidence = Object.values(record.metricEvidence || {})
  if (metricEvidence.some(item => competitorMetricCanDriveMarketDisplay(item, record.evidenceStatus))) return true
  return Boolean(sourceIsUsable(record.source) && !record.reviewRequired && marketStatusIsApprovedDashboardTruth(record.evidenceStatus))
}

function claimSearchText(claim: MarketClaim, includeValue = false): string {
  return [
    claim.fieldKey,
    claim.dashboardGroup,
    claim.proposedDashboardField,
    claim.label,
    claim.dataType,
    claim.sourceTier,
    claim.source?.title,
    includeValue ? claim.value : '',
  ].filter(Boolean).join(' ').toLowerCase()
}

function isPlaceholderOnlyClaim(claim: MarketClaim): boolean {
  const value = claim.value?.trim() || ''
  return !value || /^(to verify|missing|missing\s*\/\s*to verify|research required\s*\/\s*to verify)$/i.test(value)
}

function marketClaimDisplayStatus(claim: MarketClaim | null | undefined): IntelligenceEvidenceStatus {
  if (!claim) return 'To Verify'
  const normalized = normalizedMarketClaimStatus(claim)
  if (!claimHasUsableSourceValue(claim)) return normalized
  if (claim.reviewRequired) return 'Candidate Source'
  if (normalized !== 'To Verify' && normalized !== 'Missing') return normalized

  const trace = [
    claim.label,
    claim.value,
    claim.dataType,
    claim.sourceTier,
    claim.source?.title,
    claim.source?.url,
  ].filter(Boolean).join(' ').toLowerCase()

  if (/trade|proxy|import|export|hs\\s*\\d+|comtrade|wits/.test(trace)) return 'Trade Proxy'
  if (/tier\\s*1|tier1|official|government|regulator|statistical|un\\s+comtrade|world bank|wto/.test(trace)) return 'Official Data'
  return claim.reviewRequired ? 'Candidate Source' : 'Source-backed'
}

function canDisplayMarketClaimAsDashboardTruth(claim: MarketClaim | null | undefined): boolean {
  if (!claimHasUsableSourceValue(claim) || !claim) return false
  if (isPlaceholderOnlyClaim(claim)) return false
  if (isSensitiveMarketClaim(claim)) return false
  if (claim.reviewRequired) return false
  const status = marketClaimDisplayStatus(claim)
  return marketStatusIsApprovedDashboardTruth(status)
}

function claimCanDisplayCountryGrowthSignal(claim: MarketClaim | null | undefined): boolean {
  if (!claimHasUsableSourceValue(claim) || !claim) return false
  if (isPlaceholderOnlyClaim(claim) || isSensitiveMarketClaim(claim) || claim.reviewRequired) return false
  const status = marketClaimDisplayStatus(claim)
  if (!trustedCountrySignalStatuses.includes(status)) return false
  const text = `${claim.proposedDashboardField || ''} ${claim.label} ${claim.value || ''}`.trim()
  return /country|region|province|growth|consumption|trade proxy|import signal|export signal|import|export/i.test(text)
}

function criticalMarketClaimIsReviewGated(claim: MarketClaim): boolean {
  const text = claimSearchText(claim, true)
  const isCritical = /\b(market size|market value|growth rate|market growth|cagr|import dependence|import share|target market|our target|opportunity score|market opportunity)\b/i.test(text)
  if (!isCritical) return false
  const status = marketClaimDisplayStatus(claim)
  return claim.reviewRequired === true || criticalMarketStatusBlocklist.includes(status)
}

function primaryMarketClaimValue(claim: MarketClaim): string {
  if (criticalMarketClaimIsReviewGated(claim) && claimHasUsableSourceValue(claim)) {
    return `${SOURCE_FOUND_REVIEW_REQUIRED}: ${marketClaimValue(claim)}`
  }
  if (criticalMarketClaimIsReviewGated(claim)) return NO_APPROVED_SOURCE_VALUE
  return marketClaimValue(claim)
}

function marketClaimValueForPrimarySurface(claim: MarketClaim): string {
  if (canDisplayMarketClaimAsDashboardTruth(claim) || claimCanDisplayCountryGrowthSignal(claim)) return marketClaimValue(claim)
  return REVIEW_REQUIRED_VALUE
}

function marketClaimConfidence(claim: MarketClaim): string {
  return claim.confidence || 'low'
}

function marketClaimLastChecked(claim: MarketClaim): string {
  return claim.lastChecked || claim.source?.date || 'Not recorded'
}

function opportunityRegionLabel(claim: MarketClaim): string {
  const label = claim.proposedDashboardField || claim.label
  const country = trackedCountryNames.find(name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${label} ${claim.value || ''}`))
  return country || label.replace(/country-wise|consumption growth|export opportunity|target countries|target provinces|market/gi, '').trim() || label
}

function findMarketClaim(keywords: string[]): MarketClaim | null {
  const matches = claims.value.filter(claim => {
    if (!canDisplayMarketClaimAsDashboardTruth(claim)) return false
    const haystack = claimSearchText(claim)
    return keywords.some(keyword => haystack.includes(keyword))
  })
  if (!matches.length) return null
  return matches
    .map(claim => ({
      claim,
      score: (
        claimHasUsableSourceValue(claim) && !isPlaceholderOnlyClaim(claim) ? 1000 : 0
      ) + (
        keywords.some(keyword => String(claim.proposedDashboardField || '').toLowerCase().includes(keyword)) ? 120 : 0
      ) + (
        keywords.some(keyword => String(claim.fieldKey || '').toLowerCase().includes(keyword)) ? 80 : 0
      ) + (
        criticalMarketClaimIsReviewGated(claim) ? 30 : 0
      ),
    }))
    .sort((a, b) => b.score - a.score)[0].claim
}

function marketMetric(label: string, claim: MarketClaim | null) {
  const fallback = sourceBackedMarketMetric(label)
  const useClaim = Boolean(claim && claimHasUsableSourceValue(claim) && !isPlaceholderOnlyClaim(claim))
  const sensitivityClaim = claim || { label, value: fallback?.value || '', evidenceStatus: fallback?.evidenceStatus || 'Reference Only' as IntelligenceEvidenceStatus }
  return {
    label,
    value: isSensitiveMarketClaim(sensitivityClaim)
      ? 'Restricted'
      : useClaim
        ? primaryMarketClaimValue(claim!)
        : fallback?.value || NO_APPROVED_SOURCE_VALUE,
    evidenceStatus: useClaim ? marketClaimDisplayStatus(claim!) : fallback?.evidenceStatus || 'Reference Only' as IntelligenceEvidenceStatus,
    sourceLabel: useClaim ? marketClaimSourceLabel(claim!) : fallback?.sourceLabel || MARKET_REVIEW_SOURCE_LABEL,
  }
}

function marketSegment(label: string, keywords: string[]) {
  const claim = findMarketClaim(keywords)
  const fallback = sourceBackedMarketSegment(label)
  const useClaim = Boolean(claim && claimHasUsableSourceValue(claim) && !isPlaceholderOnlyClaim(claim))
  return {
    label,
    value: useClaim ? primaryMarketClaimValue(claim!) : fallback.value,
    growth: useClaim && claim?.value?.toLowerCase().includes('growth') ? primaryMarketClaimValue(claim!) : fallback.growth,
    source: useClaim ? marketClaimSourceLabel(claim!) : fallback.source,
    evidenceStatus: useClaim ? marketClaimDisplayStatus(claim!) : fallback.evidenceStatus,
  }
}

function opportunityRow(label: string, keywords: string[]) {
  const claim = findMarketClaim(keywords)
  const fallback = sourceBackedOpportunityRow(label)
  const useClaim = Boolean(claim && claimHasUsableSourceValue(claim) && !isPlaceholderOnlyClaim(claim))
  return {
    label,
    score: useClaim ? primaryMarketClaimValue(claim!) : fallback.score,
    period: growthPeriod.value,
    source: useClaim ? marketClaimSourceLabel(claim!) : fallback.source,
    evidenceStatus: useClaim ? marketClaimDisplayStatus(claim!) : fallback.evidenceStatus,
  }
}

function sourceBackedMarketMetric(label: string): { value: string; evidenceStatus: IntelligenceEvidenceStatus; sourceLabel: string } | null {
  if (/import/i.test(label)) {
    return {
      value: NO_APPROVED_SOURCE_VALUE,
      evidenceStatus: 'Reference Only',
      sourceLabel: MARKET_REVIEW_SOURCE_LABEL,
    }
  }
  if (/our target/i.test(label)) {
    return {
      value: NO_APPROVED_SOURCE_VALUE,
      evidenceStatus: 'Reference Only',
      sourceLabel: MARKET_REVIEW_SOURCE_LABEL,
    }
  }
  if (/opportunity/i.test(label)) {
    return {
      value: NO_APPROVED_SOURCE_VALUE,
      evidenceStatus: 'Reference Only',
      sourceLabel: MARKET_REVIEW_SOURCE_LABEL,
    }
  }
  return null
}

function sourceBackedMarketSegment(label: string): { value: string; growth: string; source: string; evidenceStatus: IntelligenceEvidenceStatus } {
  const normalized = label.toLowerCase()
  if (normalized.includes('silicone') || normalized.includes('non-ionic')) {
    return {
      value: NO_APPROVED_SOURCE_VALUE,
      growth: NO_APPROVED_SOURCE_VALUE,
      source: MARKET_REVIEW_SOURCE_LABEL,
      evidenceStatus: 'Reference Only',
    }
  }
  if (normalized.includes('cwas') || normalized.includes('cwms')) {
    return {
      value: NO_APPROVED_SOURCE_VALUE,
      growth: NO_APPROVED_SOURCE_VALUE,
      source: MARKET_REVIEW_SOURCE_LABEL,
      evidenceStatus: 'Reference Only',
    }
  }
  if (normalized.includes('export')) {
    return {
      value: NO_APPROVED_SOURCE_VALUE,
      growth: NO_APPROVED_SOURCE_VALUE,
      source: MARKET_REVIEW_SOURCE_LABEL,
      evidenceStatus: 'Reference Only',
    }
  }
  return {
    value: NO_APPROVED_SOURCE_VALUE,
    growth: NO_APPROVED_SOURCE_VALUE,
    source: MARKET_REVIEW_SOURCE_LABEL,
    evidenceStatus: 'Reference Only',
  }
}

function sourceBackedOpportunityRow(_label: string): { score: string; source: string; evidenceStatus: IntelligenceEvidenceStatus } {
  return {
    score: 'No approved source-backed value',
    source: 'Trusted Sources / Research Review',
    evidenceStatus: 'Reference Only',
  }
}

function countryFlag(country: string): string {
  const normalized = country.toLowerCase()
  if (normalized.includes('china')) return '🇨🇳'
  if (normalized.includes('india')) return '🇮🇳'
  if (normalized.includes('vietnam')) return '🇻🇳'
  if (normalized.includes('bangladesh')) return '🇧🇩'
  if (normalized.includes('turkey')) return '🇹🇷'
  if (normalized.includes('pakistan')) return '🇵🇰'
  if (normalized.includes('indonesia')) return '🇮🇩'
  if (normalized.includes('united states')) return '🇺🇸'
  if (normalized.includes('germany')) return '🇩🇪'
  if (normalized === 'eu' || normalized.includes('european union')) return '🇪🇺'
  if (normalized.includes('saudi arabia')) return '🇸🇦'
  if (normalized.includes('united arab emirates') || normalized === 'uae') return '🇦🇪'
  return '🌐'
}

function countryGrowthRowsFromClaim(claim: MarketClaim): CountryConsumptionGrowthRow[] {
  if (!claimHasUsableSourceValue(claim) || isSensitiveMarketClaim(claim) || isPlaceholderOnlyClaim(claim)) return []
  const text = `${claim.label} ${claim.value}`.trim()
  if (!/country|growth|consumption|trade proxy|import signal/i.test(text)) return []

  const source = marketClaimSourceLabel(claim)
  const status = marketClaimDisplayStatus(claim)
  const confidence = marketClaimConfidence(claim)
  const lastChecked = marketClaimLastChecked(claim)
  const rows: CountryConsumptionGrowthRow[] = []
  const countryGrowthPattern = new RegExp(`\\b(${trackedCountryNames.join('|')})\\b\\s*:\\s*([^;|]+)`, 'gi')
  for (const match of text.matchAll(countryGrowthPattern)) {
    const country = normalizeCountryName(match[1])
    const growthSignal = match[2].trim()
    rows.push({
      country,
      growthSignal,
      proxyMetric: inferCountryGrowthProxyMetric(claim),
      sourceBackedEvidence: `Auto-imported from ${source}. This is official trade data, not direct textile-softener consumption.`,
      directSoftenerConsumption: 'No direct public textile-softener consumption value in cited source',
      status,
      source,
      confidence,
      lastChecked,
      nextAction: `Review HS-code fit and direct textile-softener consumption evidence for ${country}.`,
      autoImported: true,
    })
  }

  if (rows.length) return rows

  const country = trackedCountryNames
    .map(normalizeCountryName)
    .find(name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
  if (!country || !/trade proxy|growth/i.test(text)) return []
  return [{
    country,
    growthSignal: claim.value || 'Trade-proxy growth in source review',
    proxyMetric: inferCountryGrowthProxyMetric(claim),
    sourceBackedEvidence: `Auto-imported market signal from ${source}. Direct softener consumption is still not proven.`,
    directSoftenerConsumption: 'No direct public textile-softener consumption value in cited source',
    status,
    source,
    confidence,
    lastChecked,
    nextAction: `Review direct textile-softener consumption evidence for ${country}.`,
    autoImported: true,
  }]
}

function normalizeCountryName(country: string): string {
  if (/^turkiye$/i.test(country)) return 'Turkey'
  if (/^usa$/i.test(country)) return 'United States'
  if (/^eu$/i.test(country)) return 'European Union'
  if (/^uae$/i.test(country)) return 'United Arab Emirates'
  return country
}

function inferCountryGrowthProxyMetric(claim: MarketClaim): string {
  const text = claimSearchText(claim, true)
  if (/world bank|household|macro/.test(text)) return 'World Bank macro growth proxy'
  if (/comtrade|wits|hs\s*\d+|import|export/.test(text)) return 'Official trade-proxy import/export signal'
  return 'Trusted-source market claim'
}

async function syncMarketNow() {
  syncingMarket.value = true
  try {
    const result = await autopilot.runFullDashboardImportNow()
    persistRefreshState({
      lastRun: new Date().toISOString(),
      nextRun: nextTwiceDailyRefresh(),
      lastStatus: result.message,
      resultNeedsReviewCount: refreshState.value.resultNeedsReviewCount + result.staged,
      localOnly: false,
    })
    if (result.errors.length) {
      message.warning(`${result.message} Some sources need attention: ${result.errors.slice(0, 2).join('; ')}`)
    } else {
      message.success(result.message)
    }
  } catch (err) {
    const saved = intelligence.addResearchFinding({
      summary: [
        'Market Intelligence refresh draft',
        `Refresh job: ${EXECUTIVE_REFRESH_JOB_NAME}`,
        `Last updated: ${formatDateTime(refreshState.value.lastRun)}`,
        `Claims available: ${claims.value.length}`,
        `Competitor records: ${competitorClaimCount.value}`,
        'The server trusted-source importer was unavailable, so this was staged for review instead of pretending data was imported.',
        'Every unsourced market value remains in source review.',
      ].join('\n'),
      keyClaim: 'Market intelligence requires source review',
      area: 'market',
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      source: null,
      suggestedTask: 'Review market size, growth, pricing, customer segment, and competitor evidence before investor use.',
      riskNote: err instanceof Error ? `Trusted-source import fallback: ${err.message}` : 'Trusted-source import fallback was used.',
    })
    persistRefreshState({
      lastRun: new Date().toISOString(),
      nextRun: nextTwiceDailyRefresh(),
      lastStatus: `Research review draft staged: ${saved.keyClaim}`,
      resultNeedsReviewCount: refreshState.value.resultNeedsReviewCount + 1,
      localOnly: true,
    })
    message.warning('Trusted-source import unavailable; market refresh staged for research review')
  } finally {
    syncingMarket.value = false
  }
}

function isSensitiveMarketClaim(claim: MarketClaim): boolean {
  return redactSensitiveFields.value && sensitiveMarketTerms.test([
    claim.label,
    claim.value,
    claim.source?.title,
    claim.source?.url,
  ].filter(Boolean).join('\n'))
}

function visibleClaimValue(claim: MarketClaim): string {
  if (isSensitiveMarketClaim(claim)) return 'Restricted'
  return displayMarketValue(claim.value)
}

function ensureEmployeeSafeMarketText(...parts: Array<string | null | undefined>): boolean {
  if (!redactSensitiveFields.value) return true
  return !sensitiveMarketTerms.test(parts.filter(Boolean).join('\n'))
}

function resetClaimForm() {
  claimForm.value = {
    label: '',
    value: '',
    evidenceStatus: 'To Verify',
    confidence: 'low',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
  }
  editingClaimId.value = null
}

async function createResearchTask(label: string) {
  if (!ensureEmployeeSafeMarketText(label)) {
    message.warning('Sensitive pricing/cost research is restricted for this role')
    return
  }
  creating.value = label
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Market research: ${label}`,
      body: [
        `Research this market question: ${label}`,
        'Source requirements: cite source title, URL/date where possible, confidence, last checked date, and evidence status.',
        'Do not add unsourced market size, CAGR, country ranking, or demand figures.',
        'Tags: Market Intelligence, Research Job, Automatic Verification',
      ].join('\n'),
      priority: 2,
      tenant: 'Chemicon China Feasibility',
    })
    intelligence.addResearchJob({
      title: `Market research: ${label}`,
      question: label,
      scope: 'Market question, product demand evidence, customer segments, pricing evidence, source library, and source-review claims.',
      expectedOutput: 'Source-backed market research note with evidence status, confidence, source title, URL/date, and recommended follow-up tasks.',
      sourceRequirements: 'Do not use unsourced market size, growth, country ranking, or demand figures. Include source title plus URL or date.',
      priority: 'medium',
      schedulePreference: 'Tonight',
      context: 'Chemicon China Feasibility',
      status: 'Task Created',
    })
    message.success('Market research task created')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    creating.value = ''
  }
}

function marketClaimTaskBody(claim: MarketClaim): string {
  if (isSensitiveMarketClaim(claim)) return 'Restricted market claim'
  const status = normalizedMarketClaimStatus(claim)
  return [
    `Market claim evidence gap: ${claim.label}`,
    `Current value/note: ${claim.value?.trim() || displayMarketStatus('To Verify')}`,
    `Evidence status: ${status}`,
    `Confidence: ${claim.confidence || 'low'}`,
    `Source trace: ${claim.source?.title || 'Source search running'}`,
    `Source URL/date: ${[claim.source?.url, claim.source?.date].filter(Boolean).join(' / ') || 'Missing'}`,
    `Last checked: ${claim.lastChecked || 'Not checked'}`,
    '',
    status === 'Verified'
      ? 'Recommended action: review whether the source supports the exact investor claim before approving downstream use.'
      : 'Recommended action: collect a usable source title plus URL/date, then stage this claim through Research Result Review before investor use.',
    'Source page: Market Intelligence / Verified / Automatic Verification Claims',
    'Tags: Market Intelligence, Evidence Gap, Chemicon China Feasibility',
    '',
    'Do not use market size, CAGR, demand, pricing, country ranking, or customer claims in investor material until the evidence status and source are reviewed.',
  ].join('\n')
}

function marketClaimTaskPriority(claim: MarketClaim): 1 | 2 | 3 {
  const status = normalizedMarketClaimStatus(claim)
  if (status === 'Missing' || status === 'To Verify' || status === 'Hypothesis') return 3
  if (!claim.source?.title) return 3
  return 2
}

async function createClaimEvidenceTask(claim: MarketClaim) {
  if (isSensitiveMarketClaim(claim)) {
    message.warning('Sensitive market claim tasks are restricted for this role')
    return
  }
  const key = claim.id || claim.label
  creatingClaimTaskId.value = key
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Market evidence: ${claim.label}`,
      body: marketClaimTaskBody(claim),
      priority: marketClaimTaskPriority(claim),
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Market evidence task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create market evidence task: ${detail}`)
  } finally {
    creatingClaimTaskId.value = ''
  }
}

function addClaim() {
  const label = claimForm.value.label.trim()
  if (!label) {
    message.warning('Add a claim or research question first')
    return
  }
  if (!ensureEmployeeSafeMarketText(label, claimForm.value.value, claimForm.value.sourceTitle, claimForm.value.sourceUrl)) {
    message.warning('Do not save price, cost, formula, or investor-sensitive claims from this role')
    return
  }
  const source = claimForm.value.sourceTitle.trim()
    ? {
        title: claimForm.value.sourceTitle.trim(),
        url: claimForm.value.sourceUrl.trim() || undefined,
        date: claimForm.value.sourceDate.trim() || undefined,
      }
    : null
  const payload = {
    label,
    value: claimForm.value.value.trim(),
    evidenceStatus: claimForm.value.evidenceStatus,
    confidence: claimForm.value.confidence,
    source,
  }
  const saved = editingClaimId.value
    ? intelligence.updateMarketClaim(editingClaimId.value, payload)
    : intelligence.addMarketClaim(payload)
  if (!saved) {
    message.error('Market claim was not found')
    return
  }
  if (claimForm.value.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Claim saved for source review because verified claims need a value and usable source')
  } else {
    message.success(editingClaimId.value ? 'Market claim updated' : 'Market claim saved in this browser workspace')
  }
  resetClaimForm()
}

function startEditClaim(claim: MarketClaim) {
  if (isSensitiveMarketClaim(claim)) {
    message.warning('Sensitive market claims are restricted for this role')
    return
  }
  if (!claim.id) {
    message.error('This older claim cannot be edited until the page is refreshed')
    return
  }
  editingClaimId.value = claim.id
  claimForm.value = {
    label: claim.label,
    value: claim.value || '',
    evidenceStatus: claim.evidenceStatus,
    confidence: claim.confidence || 'low',
    sourceTitle: claim.source?.title || '',
    sourceUrl: claim.source?.url || '',
    sourceDate: claim.source?.date || '',
  }
}

function addClaimToInvestorReview(claim: MarketClaim) {
  if (isSensitiveMarketClaim(claim) || !canUseRoute('hermes.investorReadiness')) {
    message.warning('Investor review actions are restricted for this role')
    return
  }
  const status = normalizedMarketClaimStatus(claim)
  intelligence.updateEvidenceStatus('market', status, claim.source || null)
  if (status === 'Verified') message.success('Market evidence marked verified for investor readiness')
  else message.info('Market evidence stays in source review until value and source are complete')
}

function stageClaimForReview(claim: MarketClaim) {
  if (isSensitiveMarketClaim(claim) || !canUseRoute('hermes.researchResultReview')) {
    message.warning('Research review action is restricted for this role')
    return
  }
  const status = normalizedMarketClaimStatus(claim)
  const value = claim.value?.trim() || displayMarketStatus('To Verify')
  const canSuggestInvestorMaterial = Boolean(claim.value?.trim()) &&
    (status === 'Verified' || status === 'User Approved' || status === 'Assumption')
  const saved = intelligence.addResearchFinding({
    summary: [
      `Market claim: ${claim.label}`,
      `Value: ${value}`,
      `Evidence status: ${status}`,
      `Confidence: ${claim.confidence || 'low'}`,
      `Source: ${claim.source?.title || 'Source search running'}`,
      `Last checked: ${claim.lastChecked || 'Not checked'}`,
    ].join('\n'),
    keyClaim: `Market claim: ${claim.label}`,
    area: 'market',
    evidenceStatus: status,
    confidence: claim.confidence || 'low',
    source: claim.source || null,
    suggestedTask: status === 'Verified' || status === 'User Approved'
      ? `Review market claim "${claim.label}" before using it in investor material.`
      : `Collect usable source evidence for market claim "${claim.label}".`,
    suggestedInvestorMaterial: canSuggestInvestorMaterial
      ? `Market evidence: ${claim.label}. Value/note: ${claim.value?.trim()}.`
      : '',
    riskNote: status === 'Verified'
      ? 'Review source quality before approving this market evidence for investor use.'
      : 'Market claim stays in source review until value and usable source evidence are attached.',
  })

  if (claim.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Staged for source review because verified claims need value plus usable source evidence')
  } else {
    message.success('Market claim staged for research review')
  }
}

function removeClaim(claim: MarketClaim) {
  if (isSensitiveMarketClaim(claim)) {
    message.warning('Sensitive market claims are restricted for this role')
    return
  }
  if (!claim.id) {
    message.error('This older claim cannot be removed until the page is refreshed')
    return
  }
  if (!window.confirm(`Remove market claim "${claim.label}" from this browser workspace?`)) return
  const removed = intelligence.removeMarketClaim(claim.id)
  if (removed) message.success('Market claim removed from this browser workspace')
  else message.error('Market claim was not found')
}

onMounted(() => {
  loadRefreshState()
  void intelligence.hydrateFeasibilityIntelligenceFromServer({ seedServerIfEmpty: false })
})
</script>

<template>
  <div class="intelligence-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Market intelligence</p>
        <h2 class="header-title">Source-Backed Market Research Workspace</h2>
        <p class="page-copy">
          Track market questions without fake market size, growth, CAGR, country ranking, or demand numbers. Hermes
          refreshes trusted-source research twice daily and shows only source-backed evidence as dashboard truth.
        </p>
        <p class="section-help-text">Market claims need source title, date, and review before investor use. Use the cards below to create research tasks, not unsupported claims.</p>
        <div class="research-permission-strip" aria-label="Owner research permission">
          <strong>Owner research permission active</strong>
          <span>Hermes may research trusted public, company, regulatory, supplier, and uploaded evidence sources.</span>
          <small>Important data needs source title, URL/date, confidence, evidence status, and review. Unknown or conflicting data stays in source review.</small>
        </div>
      </div>
      <div class="summary-card">
        <strong>{{ sourceReadyCount }}</strong>
        <span>source-attached claims</span>
        <small>source title plus URL/date required</small>
      </div>
      <div class="header-links">
        <RouterLink v-if="canUseRoute('hermes.rawMaterialSourcing')" :to="{ name: 'hermes.rawMaterialSourcing' }">Raw materials</RouterLink>
        <RouterLink :to="{ name: 'hermes.exportMarketOpportunity' }">Export markets</RouterLink>
      </div>
    </header>

    <section class="market-autopilot-brief" aria-label="Automatic market research summary">
      <div class="market-autopilot-copy">
        <p class="eyebrow">Automatic market research</p>
        <h3>Hermes researches the market and fills only source-backed evidence</h3>
        <p>
          Use this page as your global market command view. Hermes keeps looking for trusted sources, fills safe
          records, and leaves weak or investor-impacting values in source review until you approve the evidence.
        </p>
      </div>
      <div class="market-autopilot-grid">
        <article v-for="card in marketAutopilotCards" :key="card.label">
          <span aria-hidden="true">{{ card.icon }}</span>
          <div>
            <small>{{ card.label }}</small>
            <strong>{{ displayMarketValue(card.value) }}</strong>
            <em>{{ displayMarketText(card.note) }}</em>
          </div>
        </article>
      </div>
      <div class="market-autopilot-actions">
        <RouterLink :to="{ name: 'hermes.researchResultReview' }">Review staged market findings</RouterLink>
        <RouterLink :to="{ name: 'hermes.trustedSources' }">Autopilot status</RouterLink>
        <RouterLink :to="{ name: 'hermes.competitorIntelligence' }">Competitor analysis</RouterLink>
      </div>
    </section>

    <TrustedSourceAutopilotPanel screen="market" title="Market Auto Source Status" />

    <section class="market-map-brief" aria-label="Simple global market map">
      <div class="market-map-header">
        <div>
          <p class="eyebrow">Simple global market map</p>
          <h3>Where Hermes Should Focus Market Research Next</h3>
          <p>
            This is the easy view: country signals first, direct textile-softener proof clearly separated from proxy
            evidence. Hermes can research these automatically, but unsupported consumption stays in source review.
          </p>
        </div>
        <RouterLink class="template-link" :to="{ name: 'hermes.trustedSources' }">Autopilot coverage</RouterLink>
      </div>

      <div class="market-map-summary">
        <article v-for="card in countryGrowthSummaryCards" :key="card.label">
          <span aria-hidden="true">{{ card.icon }}</span>
          <div>
            <small>{{ card.label }}</small>
            <strong>{{ displayMarketValue(card.value) }}</strong>
            <em>{{ displayMarketText(card.detail) }}</em>
          </div>
        </article>
      </div>

      <p v-if="!countryMarketMapRows.length" class="empty-state">
        No imported trusted-source country growth rows yet. Country values stay blank until Research Review or Trusted Sources imports source-attached claims.
      </p>
      <div v-else class="country-map-grid">
        <article v-for="row in countryMarketMapRows" :key="`${row.country}-${row.source}`" class="country-map-card">
          <div class="country-map-title">
            <span aria-hidden="true">{{ row.flag }}</span>
            <div>
              <h4>{{ row.country }}</h4>
              <small v-if="row.autoImported">Auto-imported trusted-source row</small>
              <small v-else>Source-guided research target</small>
            </div>
            <NTag size="small" :type="statusType(row.status)">{{ displayMarketStatus(row.status) }}</NTag>
          </div>
          <p>{{ displayMarketText(row.growthSignal) }}</p>
          <dl>
            <div>
              <dt>Proxy</dt>
              <dd>{{ row.proxyMetric }}</dd>
            </div>
            <div>
              <dt>Direct demand</dt>
              <dd :class="{ warning: row.directDemandMissing }">{{ displayMarketValue(row.directSoftenerConsumption) }}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{{ row.source }}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{{ row.confidence }}</dd>
            </div>
            <div>
              <dt>Last checked</dt>
              <dd>{{ row.lastChecked }}</dd>
            </div>
          </dl>
          <NButton size="tiny" secondary @click="createResearchTask(row.nextAction)">Create research task</NButton>
        </article>
      </div>
    </section>

    <section class="global-market-intelligence" aria-label="Global market intelligence">
      <div class="template-header">
        <div>
          <p class="eyebrow">Global market intelligence</p>
          <h3>Textile Softeners, Esterquats, and Export-Market Signals</h3>
          <p>
            These rows separate source-backed global context from market-size questions that still need research.
            They are designed to help Hermes decide what to research next, not to turn proxies into investor facts.
          </p>
        </div>
        <NButton size="small" type="primary" secondary @click="createResearchTask('Global textile softener market validation')">
            Create research task
        </NButton>
      </div>

      <p v-if="!globalMarketIntelligenceRows.length" class="empty-state">
        No imported trusted-source global market claims yet. Market size, CAGR, segmentation, target, and opportunity values stay review-gated.
      </p>
      <div v-else class="global-signal-grid">
        <article v-for="row in globalMarketIntelligenceRows" :key="row.signal" class="global-signal-card">
          <div>
            <h4>{{ row.signal }}</h4>
            <NTag size="small" :type="statusType(row.status)">{{ displayMarketStatus(row.status) }}</NTag>
          </div>
          <p>{{ displayMarketText(row.finding) }}</p>
          <small>Source: {{ row.source }}</small>
          <strong>Business meaning</strong>
          <span>{{ displayMarketText(row.businessMeaning) }}</span>
          <NButton size="tiny" secondary @click="createResearchTask(row.nextAction)">
            {{ row.nextAction }}
          </NButton>
        </article>
      </div>

      <article class="template-panel">
        <div class="template-panel-title">
          <div>
            <h3>Global Opportunity Map</h3>
            <p>Demand signals are research priorities. They are not direct market-size claims until source-backed by product/category.</p>
          </div>
          <RouterLink class="template-link" :to="{ name: 'hermes.exportMarketOpportunity' }">Open Export Markets</RouterLink>
        </div>
        <p v-if="!globalOpportunityRegions.length" class="empty-state">
          No imported target-region or export-opportunity claims yet. Add evidence through Trusted Sources or approve a Research Review finding.
        </p>
        <div v-else class="global-opportunity-table">
          <div class="global-opportunity-row head">
            <span>Region / cluster</span><span>Demand signal</span><span>Verified evidence</span><span>Missing evidence</span><span>Status</span>
          </div>
          <div v-for="region in globalOpportunityRegions" :key="region.region" class="global-opportunity-row">
            <strong>{{ region.region }}</strong>
            <span>{{ displayMarketText(region.demandSignal) }}</span>
            <span>{{ displayMarketText(region.verifiedEvidence) }}</span>
            <span>{{ displayMarketText(region.missingEvidence) }}</span>
            <NTag size="small" :type="statusType(region.status)">{{ displayMarketStatus(region.status) }}</NTag>
          </div>
        </div>
      </article>

      <article class="template-panel">
        <div class="template-panel-title">
          <div>
            <h3>Country-wise Consumption Growth Tracker</h3>
            <p>
              Exact country-level textile-softener consumption growth is not shown as fact yet. Hermes can use online
              trusted sources to research it, but this table keeps cotton mill-use, textile-chemical, and trade data as
              proxy signals until direct softener evidence is found.
            </p>
          </div>
          <NButton size="small" type="primary" secondary @click="createResearchTask('Country-wise textile softener consumption growth')">
            Research country growth
          </NButton>
        </div>
        <p v-if="!displayCountryConsumptionGrowthRows.length" class="empty-state">
          No approved source-backed country growth value yet. Hermes will show country-wise growth here only after a trusted-source claim is imported with source metadata.
        </p>
        <div v-else class="country-growth-table">
          <div class="country-growth-row head">
            <span>Country</span><span>Growth signal</span><span>Proxy metric</span><span>Source metadata</span><span>Direct softener consumption</span><span>Status</span><span>Next action</span>
          </div>
          <div v-for="row in displayCountryConsumptionGrowthRows" :key="`${row.country}-${row.source}`" class="country-growth-row">
            <strong>{{ row.country }}<small v-if="row.autoImported">Auto-imported</small></strong>
            <span>{{ displayMarketText(row.growthSignal) }}</span>
            <span>{{ row.proxyMetric }}</span>
            <span>
              {{ displayMarketText(row.sourceBackedEvidence) }}
              <small>Source: {{ row.source }}</small>
              <small>Confidence: {{ row.confidence }}</small>
              <small>Last checked: {{ row.lastChecked }}</small>
            </span>
            <strong class="verify-text">{{ displayMarketValue(row.directSoftenerConsumption) }}</strong>
            <NTag size="small" :type="statusType(row.status)">{{ displayMarketStatus(row.status) }}</NTag>
            <NButton size="tiny" secondary @click="createResearchTask(row.nextAction)">{{ row.nextAction }}</NButton>
          </div>
        </div>
      </article>

      <article class="template-panel">
        <div class="template-panel-title">
          <div>
            <h3>Market Research Questions Hermes Should Answer</h3>
            <p>Use these as deeper-research prompts. Each answer must return source, date, confidence, and evidence status.</p>
          </div>
        </div>
        <div class="research-question-grid">
          <article v-for="item in marketResearchQuestions" :key="item.question">
            <h4>{{ item.question }}</h4>
            <p>{{ displayMarketText(item.why) }}</p>
            <small>Evidence needed: {{ displayMarketText(item.evidenceNeeded) }}</small>
            <NButton size="tiny" secondary @click="createResearchTask(item.question)">Research this</NButton>
          </article>
        </div>
      </article>
    </section>

    <details class="pdf-reference-pack" aria-label="User PDF market reference tables">
      <summary>
        <span>Archived user-document market tables</span>
        <small>Reference only. Not source-backed. Use Trusted Sources / Research Review to verify before use.</small>
      </summary>
      <div class="template-header">
        <div>
          <p class="eyebrow">User PDF reference</p>
          <h3>Imported Market Tables From Your Document</h3>
          <p>
            Reference only. Not source-backed. Use Trusted Sources / Research Review to verify before use.
            These archived rows are useful for planning, but they are not rendered as live dashboard facts.
          </p>
        </div>
        <NTag size="small" type="warning">Reference only / not source-backed</NTag>
      </div>

      <article class="template-panel pdf-table-panel">
        <div class="template-panel-title">
          <div>
            <h3>China Import Data - Quaternary Ammonium Textile Agents</h3>
            <p>PDF source note: UN Comtrade / China imports of ester quats and related quaternary ammonium finishing agents, HS 3809.91.</p>
          </div>
          <NButton size="small" secondary @click="createResearchTask('Verify HS 3809.91 China import data for quaternary ammonium textile agents')">
            Verify HS table
          </NButton>
        </div>
        <div class="pdf-import-table">
          <div class="pdf-import-row head">
            <span>Rank</span><span>Country</span><span>2022 (T)</span><span>2023 (T)</span><span>2024 (T)</span><span>2024 value</span><span>$/kg</span><span>Status</span>
          </div>
          <div v-for="row in pdfChinaImportRows" :key="`${row.rank}-${row.country}`" class="pdf-import-row">
            <strong>{{ row.rank }}</strong>
            <span>{{ row.country }}</span>
            <span>{{ row.t2022 }}</span>
            <span>{{ row.t2023 }}</span>
            <span>{{ row.t2024 }}</span>
            <span>{{ row.value2024 }}</span>
            <span>{{ row.usdPerKg }}</span>
            <NTag size="small" type="warning">Reference only</NTag>
          </div>
        </div>
        <p class="pdf-source-note">
          PDF interpretation archived. Import tonnage, growth, country ranking, and unit-price values through Trusted Sources / Research Review before showing them as dashboard evidence.
          Treat this collapsed table as a planning reference only.
        </p>
      </article>

      <div class="pdf-reference-grid">
        <article class="template-panel pdf-table-panel">
          <div class="template-panel-title compact">
            <h3>Country-wise Cationic Softener Consumption</h3>
            <span>voice research / verify source</span>
          </div>
          <div class="pdf-small-table">
            <div class="pdf-small-row head">
              <span>Country</span><span>2023 (KT)</span><span>2024 (KT)</span><span>Change</span><span>Status</span>
            </div>
            <div v-for="row in pdfCountryConsumptionRows" :key="row.country" class="pdf-small-row">
              <strong>{{ row.country }}</strong>
              <span>{{ row.kt2023 }}</span>
              <span>{{ row.kt2024 }}</span>
              <span>{{ row.change }}</span>
              <NTag size="small" type="warning">Reference only</NTag>
            </div>
          </div>
        </article>

        <article class="template-panel pdf-table-panel">
          <div class="template-panel-title compact">
            <h3>Market Segmentation Snapshot</h3>
            <span>PDF table / not investor-approved</span>
          </div>
          <div class="pdf-small-table">
            <div class="pdf-small-row head">
              <span>Segment</span><span>Size</span><span>Growth</span><span>Status</span>
            </div>
            <div v-for="row in pdfMarketSegmentRows" :key="row.segment" class="pdf-small-row four">
              <strong>{{ row.segment }}</strong>
              <span>{{ displayMarketValue(row.size) }}</span>
              <span>{{ displayMarketValue(row.growth) }}</span>
              <NTag size="small" type="warning">Reference only</NTag>
            </div>
          </div>
        </article>
      </div>
    </details>

    <details class="reference-details market-template-archive">
      <summary>
        <span>Reference Template / User PDF Archive</span>
        <small>Reference only. Not source-backed. Use Trusted Sources / Research Review to verify before use.</small>
      </summary>

    <section class="screenshot-market-template" aria-label="Reference market intelligence template">
      <div class="template-header">
        <div>
          <p class="eyebrow">Reference only template</p>
          <h3>Market Intelligence Template</h3>
          <p>
            Reference only. Not source-backed. Use Trusted Sources / Research Review to verify before use.
            This screenshot-style board shows the desired layout, but primary market values come from imported intelligence
            and approved assumptions only.
          </p>
        </div>
        <RouterLink class="template-link" :to="{ name: 'hermes.researchResultReview' }">Review source gaps</RouterLink>
      </div>

      <div class="template-kpis">
        <article v-for="kpi in sourceBackedTemplateKpis" :key="kpi.label" class="template-kpi-card">
          <strong>{{ displayMarketValue(kpi.value) }}</strong>
          <span>{{ kpi.label }}</span>
          <NTag size="small" :type="statusType(kpi.status)">{{ displayMarketStatus(kpi.status) }}</NTag>
          <small>{{ kpi.source }}</small>
          <p>{{ displayMarketText(kpi.note) }}</p>
        </article>
      </div>

      <div class="template-main-grid">
        <article class="template-panel segmentation-template">
          <div class="template-panel-title">
            <h3>Market Segmentation</h3>
            <span>source-backed / gaps visible</span>
          </div>
          <div class="template-table segmentation-template-table">
            <div class="template-row head">
              <span>Segment</span><span>Size / scope</span><span>Growth</span><span>Status</span><span>Source</span>
            </div>
            <div v-for="segment in sourceBackedSegments" :key="segment.segment" class="template-row">
              <span>{{ segment.segment }}</span>
              <span>{{ displayMarketValue(segment.size) }}</span>
              <span>{{ displayMarketValue(segment.growth) }}</span>
              <NTag size="small" :type="statusType(segment.status)">{{ displayMarketStatus(segment.status) }}</NTag>
              <span>{{ segment.source }}</span>
            </div>
          </div>
        </article>

        <article class="template-panel target-template">
          <div class="template-panel-title">
            <h3>Target Provinces</h3>
            <span>percent split not verified</span>
          </div>
          <div class="target-source-list">
            <div v-for="region in sourceBackedTargetRegions" :key="region.region" class="target-source-row">
              <strong>{{ region.region }}</strong>
              <span>{{ displayMarketValue(region.value) }}</span>
              <small>{{ region.source }}</small>
              <NTag size="small" :type="statusType(region.status)">{{ displayMarketStatus(region.status) }}</NTag>
            </div>
          </div>
        </article>
      </div>

      <article class="template-panel competitor-template">
        <div class="template-panel-title">
          <div>
            <h3>Ester Quat Manufacturers & Market Share</h3>
            <p>Company presence is source-backed; capacity and market share remain in source review until source evidence is attached.</p>
          </div>
          <RouterLink class="template-link" :to="{ name: 'hermes.competitorIntelligence' }">Open Competitors</RouterLink>
        </div>
        <div class="template-table competitor-template-table">
          <div class="template-row head">
            <span>Rank</span><span>Manufacturer</span><span>Source-backed role</span><span>Capacity</span><span>Share</span><span>Status</span><span>Source</span>
          </div>
          <div v-for="competitor in sourceBackedCompetitorReferences" :key="competitor.manufacturer" class="template-row">
            <span>{{ competitor.rank }}</span>
            <strong>{{ competitor.manufacturer }}</strong>
            <span>{{ competitor.role }}</span>
            <span>{{ displayMarketValue(competitor.capacity) }}</span>
            <span>{{ displayMarketValue(competitor.share) }}</span>
            <NTag size="small" :type="statusType(competitor.status)">{{ displayMarketStatus(competitor.status) }}</NTag>
            <span>{{ competitor.source }}</span>
          </div>
        </div>
      </article>

      <article class="template-panel source-template">
        <div class="template-panel-title">
          <h3>Reference Source Pack</h3>
          <span>reference only / collapsed archive</span>
        </div>
        <div class="source-template-grid">
          <a
            v-for="source in sourceBackedTemplateSources"
            :key="source.url"
            :href="source.url"
            target="_blank"
            rel="noreferrer"
          >
            <strong>{{ source.title }}</strong>
            <span>{{ source.detail }}</span>
          </a>
        </div>
      </article>
    </section>
    </details>

    <section class="market-command-panel" aria-label="Market intelligence command panel">
      <div class="market-command-head">
        <div>
          <p class="eyebrow">Executive Market Panel</p>
          <h3>Market Size, Growth, Pricing, Competitors</h3>
          <p>
            This panel mirrors the executive dashboard style, but it refuses to invent market size, CAGR, pricing, or
            market-share values. Unsourced values stay in source review.
          </p>
        </div>
        <div class="refresh-card">
          <span>Last updated: {{ formatDateTime(refreshState.lastRun) }}</span>
          <span>Next update: {{ formatDateTime(refreshState.nextRun) }}</span>
          <span>Status: {{ refreshState.lastStatus }}</span>
          <span>Needs review: {{ refreshState.resultNeedsReviewCount }}</span>
          <NButton size="tiny" type="primary" :loading="syncingMarket" @click="syncMarketNow">Sync Now</NButton>
        </div>
      </div>

      <div class="market-kpi-grid">
        <article v-for="metric in executiveMarketMetrics" :key="metric.label" class="market-kpi-card">
          <span>{{ metric.label }}</span>
          <strong>{{ displayMarketValue(metric.value) }}</strong>
          <NTag size="small" :type="statusType(metric.evidenceStatus)">{{ displayMarketStatus(metric.evidenceStatus) }}</NTag>
          <small>{{ metric.sourceLabel }}</small>
        </article>
      </div>

      <div class="segmentation-panel">
        <div class="panel-heading-inline">
          <div>
            <h3>Market Segmentation Table</h3>
            <p>Segment values remain in source review until a source title, source date, and review status are attached.</p>
          </div>
        </div>
        <div class="segmentation-row head">
          <span>Segment</span><span>Size / Value</span><span>Growth</span><span>Source</span><span>Evidence Status</span>
        </div>
        <div v-for="segment in marketSegments" :key="segment.label" class="segmentation-row">
          <span>{{ segment.label }}</span>
          <span>{{ displayMarketValue(segment.value) }}</span>
          <span>{{ displayMarketValue(segment.growth) }}</span>
          <span>{{ segment.source }}</span>
          <NTag size="small" :type="statusType(segment.evidenceStatus)">{{ displayMarketStatus(segment.evidenceStatus) }}</NTag>
        </div>
        <div v-if="!marketSegments.length" class="segmentation-row">
          <span>No approved source-backed segment</span>
          <span>No approved source-backed value</span>
          <span>Review required</span>
          <span>Trusted Sources / Research Review</span>
          <NTag size="small" type="warning">Reference only</NTag>
        </div>
      </div>

      <div class="target-panel">
        <div class="panel-heading-inline">
          <div>
            <h3>Target Countries / Provinces</h3>
            <p>HS-code proxy rows are trade context only. Do not treat them as actual textile-softener consumption without direct source proof.</p>
          </div>
          <label>
            Growth period
            <select v-model="growthPeriod">
              <option>1 year</option>
              <option>3 years</option>
              <option>5 years</option>
              <option>10 years</option>
            </select>
          </label>
        </div>
        <div class="target-grid">
          <article v-for="row in targetOpportunityRows" :key="row.label">
            <span>{{ row.label }}</span>
            <strong>{{ displayMarketValue(row.score) }}</strong>
            <small>{{ row.period }} / {{ row.source }}</small>
            <NTag size="small" :type="statusType(row.evidenceStatus)">{{ displayMarketStatus(row.evidenceStatus) }}</NTag>
          </article>
        </div>
      </div>

      <div class="competitor-command-table">
        <div class="competitor-row head">
          <span>Manufacturer</span><span>Region</span><span>Product</span><span>Share</span><span>Source</span><span>Status</span>
        </div>
        <div v-for="(row, index) in topCompetitorRows" :key="`${row.company}-${row.product}-${index}`" class="competitor-row">
          <span>{{ row.company }}</span>
          <span>{{ displayMarketValue(row.region) }}</span>
          <span>{{ displayMarketValue(row.product) }}</span>
          <span>{{ displayMarketValue(row.share) }}</span>
          <span>{{ row.source }}</span>
          <NTag size="small" :type="statusType(row.status)">{{ displayMarketStatus(row.status) }}</NTag>
        </div>
        <div v-if="!topCompetitorRows.length" class="competitor-row">
          <span>No approved source-backed competitor</span>
          <span>No approved source-backed value</span>
          <span>No approved source-backed value</span>
          <span>No approved source-backed value</span>
          <span>Trusted Sources / Research Review</span>
          <NTag size="small" type="warning">Reference only</NTag>
        </div>
      </div>
    </section>

    <section class="section-grid">
      <article
        v-for="section in visibleSections"
        :key="section"
        class="workspace-card"
        :class="{ priority: section === 'Verified / Auto-Verification Claims' || section === 'Source Library' }"
      >
        <span v-if="section === 'Verified / Auto-Verification Claims' || section === 'Source Library'" class="priority-star" aria-label="Investor-relevant research area"></span>
        <h3>{{ section }}</h3>
        <p>Hermes runs source checks twice daily and stages section-specific findings for review when evidence is needed.</p>
        <div class="actions">
          <NButton v-if="section === 'Market Questions'" size="tiny" secondary @click="createResearchTask('Research HS Codes')">
            Research HS Codes
          </NButton>
          <NButton size="tiny" secondary type="primary" :loading="creating === section" @click="createResearchTask(section)">
            Research This Market
          </NButton>
          <RouterLink :to="{ name: 'hermes.kanban' }">Create task</RouterLink>
          <RouterLink v-if="canUseRoute('hermes.investorReadiness')" :to="{ name: 'hermes.investorReadiness' }">Add claim to investor review</RouterLink>
        </div>
      </article>
    </section>

    <section class="claim-form" aria-label="Add market claim">
      <div>
        <h3>Add sourced market claim</h3>
        <p>Saved locally in this browser workspace. Verified status requires a claim value plus a source title and URL or date.</p>
      </div>
      <label>
        Claim
        <input v-model="claimForm.label" type="text" placeholder="Example: CWAS demand validation source" />
      </label>
      <label>
        Value
        <input v-model="claimForm.value" type="text" placeholder="Leave blank to stage for trusted-source review" />
      </label>
      <label>
        Evidence status
        <select v-model="claimForm.evidenceStatus">
          <option value="To Verify">{{ displayMarketStatus('To Verify') }}</option>
          <option>Assumption</option>
          <option>Powerful Assumption</option>
          <option>Source-backed</option>
          <option>User Approved</option>
          <option>Verified</option>
        </select>
      </label>
      <label>
        Confidence
        <select v-model="claimForm.confidence">
          <option>low</option>
          <option>medium</option>
          <option>high</option>
        </select>
      </label>
      <label>
        Source title
        <input v-model="claimForm.sourceTitle" type="text" placeholder="Source title" />
      </label>
      <label>
        Source URL
        <input v-model="claimForm.sourceUrl" type="url" placeholder="https://..." />
      </label>
      <label>
        Source date
        <input v-model="claimForm.sourceDate" type="text" placeholder="YYYY-MM-DD or publication date" />
      </label>
      <NButton secondary type="primary" @click="addClaim">{{ claimSubmitLabel }}</NButton>
      <NButton v-if="editingClaimId" secondary @click="resetClaimForm">Cancel edit</NButton>
    </section>

    <section class="claims-panel">
      <h3>Verified / Auto-Verification Claims</h3>
      <div class="claim-row head">
        <span>Claim</span><span>Value</span><span>Source</span><span>Status</span><span>Last checked</span><span>Action</span>
      </div>
      <p v-if="claims.length === 0" class="empty-state">
        No market claims saved yet. Add source-backed claims here, or create research tasks from the cards above.
      </p>
      <div v-for="{ claim, restricted } in visibleClaims" :key="claim.id || claim.label" class="claim-row">
        <span>{{ restricted ? 'Restricted market claim' : claim.label }}</span>
        <span>{{ visibleClaimValue(claim) }}</span>
        <span>{{ restricted ? 'Restricted' : (claim.source?.title || 'Source search running') }}</span>
        <span class="status-badge" :class="restricted ? 'restricted' : marketClaimDisplayStatus(claim).toLowerCase().replace(/\s+/g, '-')">
          {{ restricted ? 'Restricted' : displayMarketStatus(marketClaimDisplayStatus(claim)) }}
        </span>
        <span>{{ restricted ? 'Restricted' : (claim.lastChecked || 'Not checked') }}</span>
        <span class="row-actions">
          <span v-if="restricted" class="restricted-badge">Restricted</span>
          <button v-if="!restricted" type="button" @click="startEditClaim(claim)">Edit claim</button>
          <button v-if="!restricted && canUseRoute('hermes.researchResultReview')" type="button" @click="stageClaimForReview(claim)">Stage for review</button>
          <button
            v-if="!restricted"
            type="button"
            :disabled="creatingClaimTaskId === (claim.id || claim.label)"
            @click="createClaimEvidenceTask(claim)"
          >
            {{ creatingClaimTaskId === (claim.id || claim.label) ? 'Creating task' : 'Create evidence task' }}
          </button>
          <button v-if="!restricted && canUseRoute('hermes.investorReadiness')" type="button" @click="addClaimToInvestorReview(claim)">Add to investor review</button>
          <button v-if="!restricted" type="button" class="danger-link" @click="removeClaim(claim)">Remove claim</button>
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.intelligence-view {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.workspace-card,
.claim-form,
.claims-panel,
.summary-card,
.market-command-panel,
.market-kpi-card,
.segmentation-panel,
.target-panel {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header,
.workspace-card,
.claim-form,
.claims-panel,
.summary-card,
.market-command-panel,
.market-kpi-card,
.segmentation-panel,
.target-panel {
  position: relative;
  overflow: hidden;
}

.summary-card::before,
.workspace-card.priority::before,
.claim-form::before,
.claims-panel::before,
.market-command-panel::before,
.segmentation-panel::before,
.target-panel::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: $executive-strip;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 190px;
  gap: 16px;
  padding: 18px;
}

.eyebrow {
  margin: 0 0 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.page-copy,
.workspace-card p,
.summary-card small {
  color: $text-secondary;
  line-height: 1.55;
}

.summary-card {
  display: grid;
  place-items: center;
  padding: 16px;
  text-align: center;

  strong {
    color: $accent-primary;
    font-size: 38px;
  }
}

.header-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;

  a {
    color: $accent-primary;
    text-decoration: none;
  }
}

.research-permission-strip {
  display: grid;
  gap: 5px;
  max-width: 900px;
  margin-top: 12px;
  padding: 11px 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.32);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(var(--accent-info-rgb), 0.13), rgba(var(--warning-rgb), 0.07));

  strong {
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  span,
  small {
    color: $text-secondary;
    line-height: 1.5;
  }
}

.market-command-panel {
  display: grid;
  gap: 12px;
  margin: 14px 0;
  padding: 16px;
}

.market-autopilot-brief {
  display: grid;
  grid-template-columns: minmax(260px, 0.72fr) minmax(0, 1.28fr);
  gap: 16px;
  align-items: stretch;
  margin: 14px 0;
  padding: 16px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.4);
  border-radius: $radius-sm;
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.1), transparent 45%),
    $bg-card;
}

.market-autopilot-copy {
  display: grid;
  align-content: center;
  gap: 8px;

  h3 {
    margin: 0;
    color: $warning;
  }

  p {
    margin: 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.market-autopilot-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  article {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
    padding: 12px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-secondary;
  }

  span {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.25);
    border-radius: $radius-sm;
    background: rgba(var(--accent-info-rgb), 0.08);
    font-size: 18px;
  }

  div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    overflow-wrap: anywhere;
  }

  em {
    color: $text-secondary;
    font-size: 12px;
    font-style: normal;
    line-height: 1.45;
  }
}

.market-autopilot-actions {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  gap: 8px;

  a {
    display: inline-flex;
    align-items: center;
    min-height: 30px;
    padding: 6px 10px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.32);
    border-radius: $radius-sm;
    background: rgba(var(--accent-info-rgb), 0.08);
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
    text-decoration: none;
  }
}

.global-market-intelligence {
  display: grid;
  gap: 14px;
  margin: 14px 0;
}

.market-map-brief {
  display: grid;
  gap: 14px;
  margin: 14px 0;
  padding: 16px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.34);
  border-radius: $radius-sm;
  background:
    linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.08), rgba(var(--accent-primary-rgb), 0.045)),
    $bg-card;
}

.market-map-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;

  h3 {
    margin: 0;
    color: $warning;
  }

  p {
    max-width: 860px;
    margin: 6px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.market-map-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));
  gap: 10px;

  article {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
    padding: 12px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-secondary;
  }

  span {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.28);
    border-radius: $radius-sm;
    background: rgba(var(--accent-primary-rgb), 0.08);
    font-size: 18px;
  }

  div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 18px;
  }

  em {
    color: $text-secondary;
    font-size: 12px;
    font-style: normal;
    line-height: 1.4;
  }
}

.country-map-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.country-map-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.26);
  border-radius: $radius-sm;
  background: $bg-secondary;

  p,
  dd {
    color: $text-secondary;
    line-height: 1.45;
  }

  p {
    margin: 0;
  }

  dl {
    display: grid;
    gap: 8px;
    margin: 0;
  }

  dl > div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  dt {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;

    &.warning {
      color: $accent-primary;
      font-weight: 900;
    }
  }
}

.country-map-title {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;

  > span {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.28);
    border-radius: $radius-sm;
    background: rgba(var(--accent-info-rgb), 0.08);
    font-size: 20px;
  }

  h4 {
    margin: 0;
    color: $text-primary;
  }

  small {
    display: block;
    margin-top: 3px;
    color: $text-muted;
    line-height: 1.35;
  }
}

.global-signal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.global-signal-card {
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: $radius-sm;
  background:
    linear-gradient(145deg, rgba(var(--accent-info-rgb), 0.08), transparent 44%),
    $bg-card;

  > div {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
  }

  h4 {
    margin: 0;
    color: $text-primary;
  }

  p,
  span,
  small {
    color: $text-secondary;
    line-height: 1.45;
  }

  strong {
    color: $accent-primary;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.global-opportunity-table {
  overflow-x: auto;
}

.country-growth-table {
  overflow-x: auto;
}

.global-opportunity-row {
  display: grid;
  grid-template-columns: minmax(170px, 0.9fr) minmax(190px, 1fr) minmax(230px, 1.25fr) minmax(260px, 1.35fr) minmax(120px, auto);
  gap: 10px;
  align-items: center;
  min-width: 980px;
  padding: 10px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  &.head {
    border-top: 0;
    color: $accent-primary;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }

  > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.country-growth-row {
  display: grid;
  grid-template-columns: minmax(110px, 0.6fr) minmax(210px, 1fr) minmax(160px, 0.8fr) minmax(300px, 1.4fr) minmax(150px, 0.75fr) minmax(120px, auto) minmax(230px, 1.05fr);
  gap: 10px;
  align-items: center;
  min-width: 1320px;
  padding: 10px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  &.head {
    border-top: 0;
    color: $accent-primary;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }

  > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  small {
    display: block;
    margin-top: 5px;
    color: $text-muted;
    line-height: 1.35;
  }
}

.verify-text {
  color: $accent-primary;
}

.research-question-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;

  article {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-secondary;
  }

  h4 {
    margin: 0;
    color: $text-primary;
  }

  p,
  small {
    color: $text-secondary;
    line-height: 1.45;
  }
}

.screenshot-market-template {
  display: grid;
  gap: 16px;
  margin: 14px 0;
  padding: 16px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.42);
  border-radius: $radius-sm;
  background:
    linear-gradient(180deg, rgba(var(--accent-primary-rgb), 0.06), rgba(var(--accent-info-rgb), 0.035)),
    $bg-card;
}

.template-header,
.template-panel-title {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;

  h3 {
    margin: 0;
    color: $warning;
  }

  p {
    max-width: 860px;
    margin: 6px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.template-link {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 6px 10px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.32);
  border-radius: $radius-sm;
  background: rgba(var(--accent-info-rgb), 0.08);
  color: $accent-info;
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;
  white-space: nowrap;
}

.template-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.template-kpi-card {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: $radius-sm;
  background: $bg-secondary;
  text-align: center;

  strong {
    color: $accent-primary;
    font-size: 24px;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  span,
  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  p {
    margin: 0;
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

.template-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.85fr);
  gap: 16px;
}

.template-panel {
  min-width: 0;
  padding: 16px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-secondary;
}

.template-table {
  display: grid;
  margin-top: 14px;
  overflow-x: auto;
}

.template-row {
  display: grid;
  gap: 10px;
  align-items: center;
  min-width: 760px;
  padding: 10px 12px;
  border-top: 1px solid $border-color;
  color: $text-secondary;
  font-size: 12px;

  > span,
  > strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  &.head {
    border-top: 0;
    border-bottom: 2px solid rgba(var(--accent-primary-rgb), 0.75);
    color: $accent-primary;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.segmentation-template-table .template-row {
  grid-template-columns: minmax(210px, 1.4fr) minmax(180px, 1fr) minmax(140px, 0.8fr) minmax(120px, auto) minmax(190px, 1fr);
}

.competitor-template-table .template-row {
  grid-template-columns: 52px minmax(150px, 1fr) minmax(180px, 1.1fr) minmax(110px, 0.7fr) minmax(100px, 0.7fr) minmax(120px, auto) minmax(140px, 0.8fr);
}

.target-source-list,
.source-template-grid {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.target-source-row {
  display: grid;
  gap: 5px;
  padding: 10px 0;
  border-top: 1px solid $border-color;

  &:first-child {
    border-top: 0;
  }

  strong {
    color: $text-primary;
  }

  span,
  small {
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

.source-template-grid {
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));

  a {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 12px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-card;
    text-decoration: none;

    strong {
      color: $accent-info;
      font-size: 13px;
    }

    span {
      color: $text-secondary;
      font-size: 12px;
      line-height: 1.45;
    }
  }
}

.market-command-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
  gap: 14px;

  h3 {
    margin: 0;
    color: $warning;
  }

  p {
    margin: 6px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.refresh-card {
  display: grid;
  gap: 6px;
  align-content: start;
  padding: 10px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
  border-radius: $radius-sm;
  background: rgba(var(--accent-primary-rgb), 0.08);

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
}

.market-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.market-kpi-card {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  background: $bg-secondary;

  span,
  small {
    color: $text-secondary;
  }

  span {
    font-size: 11px;
    font-weight: 900;
  }

  strong {
    color: $accent-primary;
    font-size: 21px;
    overflow-wrap: anywhere;
  }
}

.segmentation-panel,
.target-panel {
  padding: 14px;
}

.panel-heading-inline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;

  h3 {
    margin: 0;
    color: $text-primary;
  }

  p {
    margin: 4px 0 0;
    color: $text-secondary;
  }

  label {
    display: grid;
    gap: 5px;
    min-width: 140px;
    color: $text-secondary;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  select {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-input;
    color: $text-primary;
    padding: 7px 9px;
  }
}

.segmentation-row {
  display: grid;
  grid-template-columns: minmax(150px, 1.2fr) minmax(110px, 0.8fr) minmax(90px, 0.7fr) minmax(140px, 1fr) minmax(120px, auto);
  gap: 10px;
  align-items: center;
  padding: 9px;
  border-top: 1px solid $border-color;
  color: $text-secondary;
  font-size: 12px;

  &.head {
    border-top: 0;
    color: $accent-primary;
    font-weight: 900;
    text-transform: uppercase;
  }

  > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.target-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;

  article {
    display: grid;
    gap: 6px;
    padding: 12px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-secondary;
  }

  span {
    color: $text-secondary;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 18px;
  }

  small {
    color: $text-muted;
  }
}

.competitor-command-table {
  display: grid;
  gap: 5px;
}

.competitor-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(90px, 0.8fr) minmax(120px, 1fr) minmax(80px, 0.7fr) minmax(120px, 1fr) minmax(90px, auto);
  gap: 8px;
  align-items: center;
  padding: 8px;
  border-radius: $radius-sm;
  background: $bg-secondary;
  color: $text-secondary;
  font-size: 12px;

  > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  &.head {
    color: $accent-primary;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
  margin: 14px 0;
}

.workspace-card,
.claim-form,
.claims-panel {
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }

  p {
    min-height: 42px;
  }
}

.workspace-card.priority {
  border-color: rgba(var(--accent-primary-rgb), 0.34);
  background: linear-gradient(145deg, rgba(var(--accent-primary-rgb), 0.08), rgba(19, 26, 40, 0.92));

  .priority-star {
    margin-bottom: 10px;
  }
}

.claim-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin: 14px 0;
  align-items: end;

  > div {
    grid-column: 1 / -1;
  }

  label {
    display: grid;
    gap: 6px;
    color: $text-secondary;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  input,
  select {
    min-width: 0;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-input;
    color: $text-primary;
    padding: 8px 10px;
    text-transform: none;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;

  a {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    padding: 5px 8px;
    color: $accent-info;
    font-size: 12px;
    font-weight: 800;
    text-decoration: none;
  }
}

.claim-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 130px 130px 170px;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  &.head {
    color: $accent-primary;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }

  button {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: transparent;
    color: $accent-info;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .danger-link {
    color: $error;
  }
}

.claim-row .status-badge {
  width: fit-content;
  padding: 3px 8px;
  font-size: 10px;
}

.row-actions {
  display: grid;
  gap: 8px;
}

.restricted-badge {
  display: inline-flex;
  width: fit-content;
  min-height: 26px;
  align-items: center;
  padding: 0 9px;
  border: 1px solid rgba(var(--warning-rgb), 0.45);
  border-radius: 999px;
  color: $warning;
  font-size: 11px;
  font-weight: 900;
}

.empty-state {
  border-top: 1px solid $border-color;
  margin: 0;
  padding: 12px 0 0;
  color: $text-secondary;
}

.pdf-reference-pack {
  display: grid;
  gap: 12px;
}

.pdf-table-panel {
  min-width: 0;
}

.pdf-import-table,
.pdf-small-table {
  display: grid;
  gap: 5px;
  overflow-x: auto;
}

.pdf-import-row {
  display: grid;
  grid-template-columns: 64px minmax(150px, 1fr) repeat(3, minmax(92px, 0.65fr)) minmax(110px, 0.7fr) minmax(80px, 0.55fr) minmax(116px, auto);
  gap: 8px;
  align-items: center;
  min-width: 900px;
  padding: 8px 10px;
  border-radius: 6px;
  background: $bg-secondary;
  color: $text-secondary;
  font-size: 12px;

  &.head {
    color: $accent-primary;
    font-weight: 900;
    text-transform: uppercase;
  }

  > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.pdf-reference-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 12px;
}

.pdf-small-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(92px, 0.55fr) minmax(92px, 0.55fr) minmax(92px, 0.55fr) minmax(110px, auto);
  gap: 8px;
  align-items: center;
  min-width: 640px;
  padding: 8px 10px;
  border-radius: 6px;
  background: $bg-secondary;
  color: $text-secondary;
  font-size: 12px;

  &.four {
    grid-template-columns: minmax(190px, 1fr) minmax(110px, 0.6fr) minmax(110px, 0.6fr) minmax(120px, auto);
  }

  &.head {
    color: $accent-primary;
    font-weight: 900;
    text-transform: uppercase;
  }

  > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.pdf-source-note {
  margin: 10px 0 0;
  color: $text-secondary;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 820px) {
  .page-header,
  .market-autopilot-brief,
  .market-command-head,
  .template-main-grid,
  .pdf-reference-grid,
  .claim-row,
  .segmentation-row {
    grid-template-columns: 1fr;
  }

  .market-autopilot-grid {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .template-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-heading-inline {
    display: grid;
  }

  .competitor-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .screenshot-market-template {
    padding: 12px;
  }

  .template-header,
  .template-panel-title {
    display: grid;
  }

  .template-kpis {
    grid-template-columns: 1fr;
  }

  .market-autopilot-grid {
    grid-template-columns: 1fr;
  }

  .template-row {
    grid-template-columns: 1fr !important;
    min-width: 0;
  }

  .pdf-import-row,
  .pdf-small-row,
  .pdf-small-row.four {
    grid-template-columns: 1fr;
    min-width: 0;
  }
}
</style>
