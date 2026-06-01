<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NTag, useMessage } from 'naive-ui'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import {
  canAccessRouteName,
  getFrontendAccessRole,
  shouldRedactForEmployee,
} from '@/utils/accessControl'
import { normalizedMarketClaimStatus, type IntelligenceEvidenceStatus, type MarketClaim } from '@/utils/investorIntelligence'
import {
  EXECUTIVE_INTELLIGENCE_STORAGE_KEY,
  EXECUTIVE_REFRESH_JOB_NAME,
  defaultExecutiveRefreshState,
  claimStatusOrToVerify,
  marketClaimSourceLabel,
  marketClaimValue,
  nextTwiceDailyRefresh,
  type ExecutiveRefreshState,
} from '@/utils/executiveIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const creating = ref('')
const creatingClaimTaskId = ref('')
const editingClaimId = ref<string | null>(null)
const refreshState = ref<ExecutiveRefreshState>(defaultExecutiveRefreshState())
const growthPeriod = ref('5 years')
const frontendRole = computed(() => getFrontendAccessRole())
const redactSensitiveFields = computed(() => shouldRedactForEmployee(frontendRole.value))
const sensitiveMarketTerms = /\b(price|pricing|cost|costing|supplier\s+quote|supplier\s+price|landed\s+cost|margin|irr|npv|payback|formula|cas\s+list|raw\s+material\s+ratio|investor\s+terms|valuation|equity)\b/i

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
  'Verified / To Verify Claims',
]

const claims = computed(() => intelligence.state.value.marketClaims)
const sourceReadyCount = intelligence.verifiedClaimCount
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
const marketSizeClaim = computed(() => findMarketClaim(['market size', 'demand', 'market value', 'consumption']))
const growthClaim = computed(() => findMarketClaim(['growth', 'cagr']))
const competitorClaimCount = computed(() => intelligence.state.value.competitors.length)
const executiveMarketMetrics = computed(() => [
  marketMetric('Market Size / Scope', marketSizeClaim.value),
  marketMetric('Growth Rate', growthClaim.value),
  marketMetric('Import Dependence', findMarketClaim(['import dependence', 'import share', 'import reliance'])),
  marketMetric('Our Target', findMarketClaim(['our target', 'target segment', 'target market'])),
  marketMetric('Opportunity Score', findMarketClaim(['opportunity score', 'market opportunity'])),
  {
    label: 'Competitor Records',
    value: competitorClaimCount.value ? String(competitorClaimCount.value) : 'To Verify',
    evidenceStatus: competitorClaimCount.value ? 'Reference Only' as IntelligenceEvidenceStatus : 'To Verify' as IntelligenceEvidenceStatus,
    sourceLabel: competitorClaimCount.value ? 'Competitor Intelligence records' : 'No competitor records',
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
])
const topCompetitorRows = computed(() => {
  const records = intelligence.state.value.competitors.slice(0, 5)
  if (!records.length) {
    return [{
      company: 'Competitor list missing',
      region: 'To Verify',
      product: 'To Verify',
      share: 'To Verify',
      source: 'Source missing',
      status: 'To Verify' as IntelligenceEvidenceStatus,
    }]
  }
  return records.map(record => ({
    company: record.companyName || 'To Verify',
    region: record.countryRegion || 'To Verify',
    product: record.productEquivalent || 'To Verify',
    share: record.marketShare?.trim() && record.source?.title ? record.marketShare : 'To Verify',
    source: record.source?.title || 'Source missing',
    status: record.evidenceStatus,
  }))
})
const sourceBackedTemplateKpis = [
  {
    label: 'China Market',
    value: 'Largest textile-chemicals consumer',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'S&P Global Textile Chemicals abstract, 2025',
    note: 'Mainland China accounts for nearly half of global textile chemicals value in 2024; not a textile-softener-only value.',
  },
  {
    label: 'Growth Rate',
    value: 'To Verify',
    status: 'To Verify' as IntelligenceEvidenceStatus,
    source: 'Exact China textile-softener CAGR not source-backed yet',
    note: 'Use paid/source-backed market report or approved research result before showing a percentage.',
  },
  {
    label: 'Import Dependence',
    value: 'To Verify',
    status: 'To Verify' as IntelligenceEvidenceStatus,
    source: 'UN Comtrade / China Customs HS mapping needed',
    note: 'No direct textile-softener HS code has been approved for this dashboard yet.',
  },
  {
    label: 'Chemicon Target',
    value: '15,000 MT Year 1',
    status: 'User Provided' as IntelligenceEvidenceStatus,
    source: 'Chemicon feasibility planning assumption',
    note: 'Volume target only; revenue target remains To Verify until ASP and source-backed model are approved.',
  },
]
const sourceBackedSegments = [
  {
    segment: 'Textile Chemicals - Mainland China',
    size: 'Nearly half of global value',
    growth: 'Growth slowing',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'S&P Global Textile Chemicals abstract, 2025',
  },
  {
    segment: 'Dyes & Pigments',
    size: 'Close to 35% of global textile-chemicals value',
    growth: 'Reference only',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'S&P Global Textile Chemicals abstract, 2025',
  },
  {
    segment: 'Global Esterquats',
    size: 'USD 2.69B market size value in 2024',
    growth: '10.3% CAGR 2024-2030',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'Grand View Research esterquats report page',
  },
  {
    segment: 'Fabric Care Esterquats',
    size: '90.8% of esterquats market share in 2023',
    growth: 'Reference only',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research esterquats report page',
  },
  {
    segment: 'Cationic / Ester Quat Textile Softeners',
    size: 'To Verify',
    growth: 'To Verify',
    status: 'To Verify' as IntelligenceEvidenceStatus,
    source: 'China textile-finishing segment source needed',
  },
  {
    segment: 'Silicone / Non-ionic Textile Softeners',
    size: 'To Verify',
    growth: 'To Verify',
    status: 'To Verify' as IntelligenceEvidenceStatus,
    source: 'Source-backed segment split needed',
  },
]
const sourceBackedTargetRegions = [
  {
    region: 'Zhejiang / Shaoxing / Keqiao',
    value: '8,000+ textile businesses; output value over RMB 100B',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'China gov / Xinhua, Mar 2024',
  },
  {
    region: 'Jiangsu + Zhejiang textile clusters',
    value: 'Most textile industrial clusters concentrated here',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'SWITCH-Asia / CNIS project page',
  },
  {
    region: 'Huzhou + Shaoxing circular-textile focus',
    value: 'EU-China circular economy textile project, 2022-2025',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'SWITCH-Asia / CNIS project page',
  },
  {
    region: 'Guangdong / Fujian / Shandong',
    value: 'To Verify',
    status: 'To Verify' as IntelligenceEvidenceStatus,
    source: 'Province-level textile-finishing demand evidence needed',
  },
]
const sourceBackedCompetitorReferences = [
  {
    rank: '1',
    manufacturer: 'Stepan Company',
    role: 'Listed key esterquats company',
    capacity: 'To Verify',
    share: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
  {
    rank: '2',
    manufacturer: 'Kao Chemicals Europe',
    role: 'Listed key esterquats company',
    capacity: 'To Verify',
    share: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
  {
    rank: '3',
    manufacturer: 'Evonik Industries',
    role: 'Listed key esterquats company',
    capacity: 'To Verify',
    share: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
  {
    rank: '4',
    manufacturer: 'BASF SE',
    role: 'Listed key esterquats company',
    capacity: 'To Verify',
    share: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
  {
    rank: '5',
    manufacturer: 'Solvay S.A.',
    role: 'Listed key esterquats company',
    capacity: 'To Verify',
    share: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research',
  },
]
const sourceBackedTemplateSources = [
  {
    title: 'China gov / Xinhua - Keqiao textile cluster',
    detail: 'Keqiao, Shaoxing has 8,000+ textile businesses and output value above RMB 100B.',
    url: 'https://english.www.gov.cn/news/202403/16/content_WS65f50107c6d0868f4e8e5257.html',
  },
  {
    title: 'SWITCH-Asia / CNIS circular-textile project',
    detail: 'Jiangsu and Zhejiang concentrate most textile industrial clusters; Shaoxing is an important production and distribution base.',
    url: 'https://switch-asia.eu/project/transitions-to-circular-economy-practices-in-textile-and-apparel-msmes-along-the-lifecycle-in-huzhou-and-shaoxing/',
  },
  {
    title: 'S&P Global - Textile Chemicals public abstract',
    detail: 'Mainland China remains the largest textile-chemicals consumer, nearly half of 2024 global value.',
    url: 'https://www.spglobal.com/content/dam/spglobal/ci/en/documents/products/pdf/CI_0825-SCUP-Textile-Chemicals-Abstract-TOC-June-2025.pdf',
  },
  {
    title: 'Grand View Research - Esterquats report page',
    detail: 'Global esterquats market size/growth and key company list. China textile-softener split still needs separate verification.',
    url: 'https://www.grandviewresearch.com/industry-analysis/esterquats-market',
  },
  {
    title: 'WTO / World Bank WITS - textile trade context',
    detail: 'Use trade datasets to prioritize export-market research. Treat textile/apparel trade as a proxy, not direct softener demand.',
    url: 'https://wits.worldbank.org/',
  },
  {
    title: 'OECD-FAO Agricultural Outlook - cotton consumption',
    detail: 'Country-wise cotton mill-use growth is a textile-demand proxy. It is not direct textile-softener consumption.',
    url: 'https://www.oecd.org/en/publications/oecd-fao-agricultural-outlook-2025-2034_601276cd-en/full-report/cotton_a0374fa8',
  },
]
const globalMarketIntelligenceRows = [
  {
    signal: 'China textile-chemicals anchor',
    finding: 'Mainland China is the largest textile-chemicals consumer and accounts for nearly half of global textile-chemicals value.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'S&P Global Textile Chemicals abstract, June 2025',
    businessMeaning: 'China is the right first validation market, but textile-softener-only demand remains a separate To Verify question.',
    nextAction: 'Validate China textile-softener demand by product family and province.',
  },
  {
    signal: 'Global esterquat reference market',
    finding: 'Grand View Research reports the global esterquats market at USD 2.441B in 2023, with 10.3% CAGR from 2024 to 2030; fabric care held 90.8% share in 2023.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'Grand View Research esterquats report page',
    businessMeaning: 'Useful for esterquat context only. It does not prove the China textile-softener market size or Chemicon revenue.',
    nextAction: 'Separate home-care esterquat demand from textile-finishing cationic softener demand.',
  },
  {
    signal: 'Keqiao textile cluster density',
    finding: 'Keqiao, Shaoxing has more than 8,000 textile businesses and output value above RMB 100B.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'China government / Xinhua, March 2024',
    businessMeaning: 'Strong target cluster for customer interviews, distributor mapping, and textile-finishing validation.',
    nextAction: 'Build a Keqiao customer interview list and evidence task queue.',
  },
  {
    signal: 'Textile export geography proxy',
    finding: 'China, Bangladesh, Vietnam, India, and Turkey are important textile/apparel export hubs in WTO/WITS trade datasets.',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'WTO / World Bank WITS textile and clothing trade data',
    businessMeaning: 'Export scale is a demand proxy, not direct softener consumption. It should guide research priority, not become a market-size claim.',
    nextAction: 'Use WITS/UN Comtrade plus local textile-finishing evidence to rank export markets.',
  },
]
const globalOpportunityRegions = [
  {
    region: 'China - Zhejiang / Jiangsu / Shaoxing-Keqiao',
    demandSignal: 'High-density textile manufacturing and finishing cluster.',
    verifiedEvidence: 'Keqiao 8,000+ textile businesses; Jiangsu/Zhejiang cluster concentration from circular-textile project source.',
    missingEvidence: 'Softener consumption by mill type, ASP, import dependence, local competitor quotes.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
  },
  {
    region: 'Bangladesh',
    demandSignal: 'Large garment export base and finishing/knitting ecosystem.',
    verifiedEvidence: 'WTO/WITS textile and clothing trade context.',
    missingEvidence: 'Textile softener import/local supply map, distributor list, buyer interviews, duty/tax route.',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
  },
  {
    region: 'Vietnam',
    demandSignal: 'Major apparel export hub and potential regional customer base.',
    verifiedEvidence: 'WTO/WITS textile and clothing trade context.',
    missingEvidence: 'Finishing chemical demand, existing suppliers, China export feasibility, landed cost.',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
  },
  {
    region: 'India / Turkey / Pakistan',
    demandSignal: 'Textile/apparel manufacturing countries for later export-market research.',
    verifiedEvidence: 'WTO/WITS trade context only.',
    missingEvidence: 'Product registration needs, textile-softener buyer segments, price benchmarks, distributor proof.',
    status: 'To Verify' as IntelligenceEvidenceStatus,
  },
]
const countryConsumptionGrowthRows = [
  {
    country: 'China',
    growthSignal: 'Largest base; cotton mill use projected near 2023/24 level',
    proxyMetric: 'Cotton mill-use proxy / textile-chemicals anchor',
    sourceBackedEvidence: 'Largest cotton-spinning country; mill use nearly one third of global consumption. Mainland China is also the largest textile-chemicals consumer.',
    directSoftenerConsumption: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'OECD-FAO Agricultural Outlook 2025-2034; S&P Global Textile Chemicals abstract',
    nextAction: 'Verify China textile-softener consumption by province, application, and product family.',
  },
  {
    country: 'India',
    growthSignal: 'Positive textile-mill demand signal; higher cotton use forecast in 2024/25',
    proxyMetric: 'Cotton mill-use proxy',
    sourceBackedEvidence: 'OECD-FAO expects higher cotton use in India to help drive the 2024/25 global recovery.',
    directSoftenerConsumption: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'OECD-FAO Agricultural Outlook 2025-2034',
    nextAction: 'Research India textile-finishing clusters, softener suppliers, and import/local supply route.',
  },
  {
    country: 'Vietnam',
    growthSignal: 'Fastest listed cotton mill-use growth signal: 2.7% p.a.',
    proxyMetric: 'Cotton mill-use proxy',
    sourceBackedEvidence: 'OECD-FAO says Vietnam will lead annual growth of cotton mill use at 2.7% p.a.',
    directSoftenerConsumption: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'OECD-FAO Agricultural Outlook 2025-2034',
    nextAction: 'Validate Vietnam textile-finishing chemical demand, buyer segments, and distributor routes.',
  },
  {
    country: 'Bangladesh',
    growthSignal: 'Strong cotton mill-use growth signal: 2.1% p.a.',
    proxyMetric: 'Cotton mill-use proxy / apparel export hub',
    sourceBackedEvidence: 'OECD-FAO projects Bangladesh cotton mill-use growth at 2.1% p.a.; Bangladesh is a major apparel manufacturing base.',
    directSoftenerConsumption: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'OECD-FAO Agricultural Outlook 2025-2034; WTO/WITS trade context',
    nextAction: 'Research Bangladesh wet-processing clusters, softener importers, and mill interviews.',
  },
  {
    country: 'Turkey',
    growthSignal: 'Short-term cotton-use/import signal; exact softener demand not confirmed',
    proxyMetric: 'Cotton mill-use and textile/apparel trade proxy',
    sourceBackedEvidence: 'OECD-FAO notes higher cotton use and import purchases in Turkey in the 2024/25 outlook context.',
    directSoftenerConsumption: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'OECD-FAO Agricultural Outlook 2025-2034; WTO/WITS trade context',
    nextAction: 'Verify Turkey textile-finishing demand, local competitors, regulatory route, and price evidence.',
  },
  {
    country: 'Pakistan',
    growthSignal: 'Near-term negative cotton-use signal from output decline; textile-softener demand still unknown',
    proxyMetric: 'Cotton mill-use proxy',
    sourceBackedEvidence: 'OECD-FAO says 2024/25 global cotton-use gains are partly offset by a significant Pakistan decline driven by output decline.',
    directSoftenerConsumption: 'To Verify',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'OECD-FAO Agricultural Outlook 2025-2034',
    nextAction: 'Check Pakistan textile output recovery, wet-processing demand, and chemical importer evidence.',
  },
  {
    country: 'Indonesia',
    growthSignal: 'Potential Southeast Asia textile-demand proxy; current exact growth needs update',
    proxyMetric: 'Older cotton mill-use proxy / textile manufacturing proxy',
    sourceBackedEvidence: 'Older OECD-FAO outlooks highlighted Indonesia mill-use growth, but a current country-specific update is needed before using a figure.',
    directSoftenerConsumption: 'To Verify',
    status: 'To Verify' as IntelligenceEvidenceStatus,
    source: 'OECD-FAO historical cotton outlook; current verification needed',
    nextAction: 'Research latest Indonesia cotton mill-use, textile output, and finishing chemical demand.',
  },
]
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
  if (status === 'Verified' || status === 'Source-backed' || status === 'User Approved' || status === 'Investor Approved') return 'success'
  if (status === 'Assumption' || status === 'Powerful Assumption' || status === 'Derived from Assumptions' || status === 'Reference Only') return 'warning'
  if (status === 'Missing' || status === 'To Verify') return 'error'
  return 'info'
}

function findMarketClaim(keywords: string[]): MarketClaim | null {
  return claims.value.find(claim => {
    const haystack = `${claim.label} ${claim.value || ''}`.toLowerCase()
    return keywords.some(keyword => haystack.includes(keyword))
  }) || null
}

function marketMetric(label: string, claim: MarketClaim | null) {
  return {
    label,
    value: isSensitiveMarketClaim(claim || { label, value: '', evidenceStatus: 'To Verify' }) ? 'Restricted' : marketClaimValue(claim),
    evidenceStatus: claim ? normalizedMarketClaimStatus(claim) : 'To Verify' as IntelligenceEvidenceStatus,
    sourceLabel: claim ? marketClaimSourceLabel(claim) : 'Source missing',
  }
}

function marketSegment(label: string, keywords: string[]) {
  const claim = findMarketClaim(keywords)
  return {
    label,
    value: marketClaimValue(claim),
    growth: claim?.value?.toLowerCase().includes('growth') ? claim.value : 'To Verify',
    source: marketClaimSourceLabel(claim),
    evidenceStatus: claimStatusOrToVerify(claim),
  }
}

function opportunityRow(label: string, keywords: string[]) {
  const claim = findMarketClaim(keywords)
  return {
    label,
    score: claim?.value?.trim() || 'To Verify',
    period: growthPeriod.value,
    source: marketClaimSourceLabel(claim),
    evidenceStatus: claimStatusOrToVerify(claim),
  }
}

function syncMarketNow() {
  const saved = intelligence.addResearchFinding({
    summary: [
      'Market Intelligence refresh draft',
      `Refresh job: ${EXECUTIVE_REFRESH_JOB_NAME}`,
      `Last updated: ${formatDateTime(refreshState.value.lastRun)}`,
      `Claims available: ${claims.value.length}`,
      `Competitor records: ${competitorClaimCount.value}`,
      'Every unsourced market value remains To Verify.',
    ].join('\n'),
    keyClaim: 'Market intelligence requires source review',
    area: 'market',
    evidenceStatus: 'To Verify',
    confidence: 'medium',
    source: null,
    suggestedTask: 'Review market size, growth, pricing, customer segment, and competitor evidence before investor use.',
    riskNote: 'Unsourced market values must not be used as verified investor claims.',
  })
  persistRefreshState({
    lastRun: new Date().toISOString(),
    nextRun: nextTwiceDailyRefresh(),
    lastStatus: 'Market refresh staged for Research Result Review',
    resultNeedsReviewCount: refreshState.value.resultNeedsReviewCount + 1,
    localOnly: true,
  })
  message.success(`Research review draft staged: ${saved.keyClaim}`)
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
  return claim.value || 'To Verify'
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
        'Tags: Market Intelligence, Research Job, To Verify',
      ].join('\n'),
      priority: 2,
      tenant: 'Chemicon China Feasibility',
    })
    intelligence.addResearchJob({
      title: `Market research: ${label}`,
      question: label,
      scope: 'Market question, product demand evidence, customer segments, pricing evidence, source library, and To Verify claims.',
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
    `Current value/note: ${claim.value?.trim() || 'To Verify'}`,
    `Evidence status: ${status}`,
    `Confidence: ${claim.confidence || 'low'}`,
    `Source trace: ${claim.source?.title || 'Source missing'}`,
    `Source URL/date: ${[claim.source?.url, claim.source?.date].filter(Boolean).join(' / ') || 'Missing'}`,
    `Last checked: ${claim.lastChecked || 'Not checked'}`,
    '',
    status === 'Verified'
      ? 'Recommended action: review whether the source supports the exact investor claim before approving downstream use.'
      : 'Recommended action: collect a usable source title plus URL/date, then stage this claim through Research Result Review before investor use.',
    'Source page: Market Intelligence / Verified-To Verify Claims',
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
    message.warning('Claim saved as To Verify because verified claims need a value and usable source')
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
  else message.info('Market evidence remains To Verify until value and source are complete')
}

function stageClaimForReview(claim: MarketClaim) {
  if (isSensitiveMarketClaim(claim) || !canUseRoute('hermes.researchResultReview')) {
    message.warning('Research review action is restricted for this role')
    return
  }
  const status = normalizedMarketClaimStatus(claim)
  const value = claim.value?.trim() || 'To Verify'
  const canSuggestInvestorMaterial = Boolean(claim.value?.trim()) &&
    (status === 'Verified' || status === 'User Approved' || status === 'Assumption')
  const saved = intelligence.addResearchFinding({
    summary: [
      `Market claim: ${claim.label}`,
      `Value: ${value}`,
      `Evidence status: ${status}`,
      `Confidence: ${claim.confidence || 'low'}`,
      `Source: ${claim.source?.title || 'Source missing'}`,
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
      : 'Market claim remains To Verify until value and usable source evidence are attached.',
  })

  if (claim.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Staged as To Verify because verified claims need value plus usable source evidence')
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

onMounted(loadRefreshState)
</script>

<template>
  <div class="intelligence-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Market intelligence</p>
        <h2 class="header-title">Source-Backed Market Research Workspace</h2>
        <p class="page-copy">
          Track market questions without fake market size, growth, CAGR, country ranking, or demand numbers. Claims
          stay To Verify until they have source evidence.
        </p>
        <p class="section-help-text">Market claims need source title, date, and review before investor use. Use the cards below to create research tasks, not unsupported claims.</p>
        <div class="research-permission-strip" aria-label="Owner research permission">
          <strong>Owner research permission active</strong>
          <span>Hermes may research trusted public, company, regulatory, supplier, and uploaded evidence sources.</span>
          <small>Important data needs source title, URL/date, confidence, evidence status, and review. Unknown or conflicting data remains To Verify.</small>
        </div>
      </div>
      <div class="summary-card">
        <strong>{{ sourceReadyCount }}</strong>
        <span>source-backed claims</span>
        <small>source required</small>
      </div>
      <div class="header-links">
        <RouterLink v-if="canUseRoute('hermes.rawMaterialSourcing')" :to="{ name: 'hermes.rawMaterialSourcing' }">Raw materials</RouterLink>
        <RouterLink :to="{ name: 'hermes.exportMarketOpportunity' }">Export markets</RouterLink>
      </div>
    </header>

    <TrustedSourceAutopilotPanel screen="market" title="Market Auto Source Status" />

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
          Create global research task
        </NButton>
      </div>

      <div class="global-signal-grid">
        <article v-for="row in globalMarketIntelligenceRows" :key="row.signal" class="global-signal-card">
          <div>
            <h4>{{ row.signal }}</h4>
            <NTag size="small" :type="statusType(row.status)">{{ row.status }}</NTag>
          </div>
          <p>{{ row.finding }}</p>
          <small>Source: {{ row.source }}</small>
          <strong>Business meaning</strong>
          <span>{{ row.businessMeaning }}</span>
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
        <div class="global-opportunity-table">
          <div class="global-opportunity-row head">
            <span>Region / cluster</span><span>Demand signal</span><span>Verified evidence</span><span>Missing evidence</span><span>Status</span>
          </div>
          <div v-for="region in globalOpportunityRegions" :key="region.region" class="global-opportunity-row">
            <strong>{{ region.region }}</strong>
            <span>{{ region.demandSignal }}</span>
            <span>{{ region.verifiedEvidence }}</span>
            <span>{{ region.missingEvidence }}</span>
            <NTag size="small" :type="statusType(region.status)">{{ region.status }}</NTag>
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
        <div class="country-growth-table">
          <div class="country-growth-row head">
            <span>Country</span><span>Growth signal</span><span>Proxy metric</span><span>Source-backed evidence</span><span>Direct softener consumption</span><span>Status</span><span>Next action</span>
          </div>
          <div v-for="row in countryConsumptionGrowthRows" :key="row.country" class="country-growth-row">
            <strong>{{ row.country }}</strong>
            <span>{{ row.growthSignal }}</span>
            <span>{{ row.proxyMetric }}</span>
            <span>{{ row.sourceBackedEvidence }} <small>Source: {{ row.source }}</small></span>
            <strong class="verify-text">{{ row.directSoftenerConsumption }}</strong>
            <NTag size="small" :type="statusType(row.status)">{{ row.status }}</NTag>
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
            <p>{{ item.why }}</p>
            <small>Evidence needed: {{ item.evidenceNeeded }}</small>
            <NButton size="tiny" secondary @click="createResearchTask(item.question)">Research this</NButton>
          </article>
        </div>
      </article>
    </section>

    <section class="screenshot-market-template" aria-label="Source-backed market intelligence template">
      <div class="template-header">
        <div>
          <p class="eyebrow">Chemicon China template</p>
          <h3>Market Intelligence Template</h3>
          <p>
            Screenshot-style market board populated only with source-backed public facts, user-provided assumptions,
            or To Verify gaps. Unsupported market size, share, CAGR, province split, and capacity values are not shown
            as facts.
          </p>
        </div>
        <RouterLink class="template-link" :to="{ name: 'hermes.researchResultReview' }">Review source gaps</RouterLink>
      </div>

      <div class="template-kpis">
        <article v-for="kpi in sourceBackedTemplateKpis" :key="kpi.label" class="template-kpi-card">
          <strong>{{ kpi.value }}</strong>
          <span>{{ kpi.label }}</span>
          <NTag size="small" :type="statusType(kpi.status)">{{ kpi.status }}</NTag>
          <small>{{ kpi.source }}</small>
          <p>{{ kpi.note }}</p>
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
              <span>{{ segment.size }}</span>
              <span>{{ segment.growth }}</span>
              <NTag size="small" :type="statusType(segment.status)">{{ segment.status }}</NTag>
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
              <span>{{ region.value }}</span>
              <small>{{ region.source }}</small>
              <NTag size="small" :type="statusType(region.status)">{{ region.status }}</NTag>
            </div>
          </div>
        </article>
      </div>

      <article class="template-panel competitor-template">
        <div class="template-panel-title">
          <div>
            <h3>Ester Quat Manufacturers & Market Share</h3>
            <p>Company presence is source-backed; capacity and market share remain To Verify until source evidence is attached.</p>
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
            <span>{{ competitor.capacity }}</span>
            <span>{{ competitor.share }}</span>
            <NTag size="small" :type="statusType(competitor.status)">{{ competitor.status }}</NTag>
            <span>{{ competitor.source }}</span>
          </div>
        </div>
      </article>

      <article class="template-panel source-template">
        <div class="template-panel-title">
          <h3>Verified Source Pack</h3>
          <span>used by this template</span>
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

    <section class="market-command-panel" aria-label="Market intelligence command panel">
      <div class="market-command-head">
        <div>
          <p class="eyebrow">Executive Market Panel</p>
          <h3>Market Size, Growth, Pricing, Competitors</h3>
          <p>
            This panel mirrors the executive dashboard style, but it refuses to invent market size, CAGR, pricing, or
            market-share values. Unsourced values stay To Verify.
          </p>
        </div>
        <div class="refresh-card">
          <span>Last updated: {{ formatDateTime(refreshState.lastRun) }}</span>
          <span>Next update: {{ formatDateTime(refreshState.nextRun) }}</span>
          <span>Status: {{ refreshState.lastStatus }}</span>
          <span>Needs review: {{ refreshState.resultNeedsReviewCount }}</span>
          <NButton size="tiny" type="primary" @click="syncMarketNow">Sync Now</NButton>
        </div>
      </div>

      <div class="market-kpi-grid">
        <article v-for="metric in executiveMarketMetrics" :key="metric.label" class="market-kpi-card">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
          <NTag size="small" :type="statusType(metric.evidenceStatus)">{{ metric.evidenceStatus }}</NTag>
          <small>{{ metric.sourceLabel }}</small>
        </article>
      </div>

      <div class="segmentation-panel">
        <div class="panel-heading-inline">
          <div>
            <h3>Market Segmentation Table</h3>
            <p>Segment values remain To Verify until a source title, source date, and review status are attached.</p>
          </div>
        </div>
        <div class="segmentation-row head">
          <span>Segment</span><span>Size / Value</span><span>Growth</span><span>Source</span><span>Evidence Status</span>
        </div>
        <div v-for="segment in marketSegments" :key="segment.label" class="segmentation-row">
          <span>{{ segment.label }}</span>
          <span>{{ segment.value }}</span>
          <span>{{ segment.growth }}</span>
          <span>{{ segment.source }}</span>
          <NTag size="small" :type="statusType(segment.evidenceStatus)">{{ segment.evidenceStatus }}</NTag>
        </div>
      </div>

      <div class="target-panel">
        <div class="panel-heading-inline">
          <div>
            <h3>Target Countries / Provinces</h3>
            <p>HS-code unknowns stay Trade Proxy / To Verify. Do not treat these rows as actual consumption without source proof.</p>
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
            <strong>{{ row.score }}</strong>
            <small>{{ row.period }} / {{ row.source }}</small>
            <NTag size="small" :type="statusType(row.evidenceStatus)">{{ row.evidenceStatus }}</NTag>
          </article>
        </div>
      </div>

      <div class="competitor-command-table">
        <div class="competitor-row head">
          <span>Manufacturer</span><span>Region</span><span>Product</span><span>Share</span><span>Source</span><span>Status</span>
        </div>
        <div v-for="(row, index) in topCompetitorRows" :key="`${row.company}-${row.product}-${index}`" class="competitor-row">
          <span>{{ row.company }}</span>
          <span>{{ row.region }}</span>
          <span>{{ row.product }}</span>
          <span>{{ row.share }}</span>
          <span>{{ row.source }}</span>
          <NTag size="small" :type="statusType(row.status)">{{ row.status }}</NTag>
        </div>
      </div>
    </section>

    <section class="section-grid">
      <article
        v-for="section in visibleSections"
        :key="section"
        class="workspace-card"
        :class="{ priority: section === 'Verified / To Verify Claims' || section === 'Source Library' }"
      >
        <span v-if="section === 'Verified / To Verify Claims' || section === 'Source Library'" class="priority-star" aria-label="Investor-relevant research area"></span>
        <h3>{{ section }}</h3>
        <p>Missing / To Verify until source-backed research is captured and approved.</p>
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
        <input v-model="claimForm.value" type="text" placeholder="Leave blank if still To Verify" />
      </label>
      <label>
        Evidence status
        <select v-model="claimForm.evidenceStatus">
          <option>To Verify</option>
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
      <h3>Verified / To Verify Claims</h3>
      <div class="claim-row head">
        <span>Claim</span><span>Value</span><span>Source</span><span>Status</span><span>Last checked</span><span>Action</span>
      </div>
      <p v-if="claims.length === 0" class="empty-state">
        No market claims saved yet. Add source-backed claims here, or create research tasks from the cards above.
      </p>
      <div v-for="{ claim, restricted } in visibleClaims" :key="claim.id || claim.label" class="claim-row">
        <span>{{ restricted ? 'Restricted market claim' : claim.label }}</span>
        <span>{{ visibleClaimValue(claim) }}</span>
        <span>{{ restricted ? 'Restricted' : (claim.source?.title || 'Source missing') }}</span>
        <span class="status-badge" :class="restricted ? 'restricted' : normalizedMarketClaimStatus(claim).toLowerCase().replace(/\s+/g, '-')">
          {{ restricted ? 'Restricted' : normalizedMarketClaimStatus(claim) }}
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

.global-market-intelligence {
  display: grid;
  gap: 14px;
  margin: 14px 0;
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

@media (max-width: 820px) {
  .page-header,
  .market-command-head,
  .template-main-grid,
  .claim-row,
  .segmentation-row {
    grid-template-columns: 1fr;
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

  .template-row {
    grid-template-columns: 1fr !important;
    min-width: 0;
  }
}
</style>
