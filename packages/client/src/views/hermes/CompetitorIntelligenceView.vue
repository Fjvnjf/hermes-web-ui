<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, useMessage } from 'naive-ui'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import {
  type CompetitorIntelligenceRecord,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { formatSourcedMarketShare, sourceIsUsable, type IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'
import { redactForEmployee, shouldRedactForEmployee } from '@/utils/accessControl'
import { defaultExecutiveRefreshState, nextTwiceDailyRefresh, type ExecutiveRefreshState } from '@/utils/executiveIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const creating = ref('')
const editingCompetitorId = ref<string | null>(null)
const redactSensitiveFields = computed(() => shouldRedactForEmployee())
const refreshState = ref<ExecutiveRefreshState>(defaultExecutiveRefreshState())

const competitorForm = ref({
  companyName: '',
  countryRegion: '',
  productEquivalent: '',
  activeContent: '',
  pricingEvidence: '',
  certifications: '',
  distributionPresence: '',
  marketShare: '',
  revenue: '',
  yearlyGrowth: '',
  evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus,
  sourceTitle: '',
  sourceUrl: '',
  sourceDate: '',
  notes: '',
})

const competitors = computed(() => intelligence.state.value.competitors)
const collapsedCompetitors = computed(() => collapseCompetitorRecords(competitors.value))
const competitorSubmitLabel = computed(() => editingCompetitorId.value ? 'Update competitor' : 'Save competitor')
const productContextRows = [
  'Cationic Softeners / CHEMISOFT',
  'Silicone Softeners / CHEMISIL',
  'CWAS',
  'CWMS',
  'CSLC',
  'CHEMISIL HS 200',
  'CHEMISIL 1800 CON',
].map(product => ({
  product,
  formType: 'TDS/SDS source required',
  dosing: 'Application guide required',
  ph: 'TDS/SDS source required',
  application: 'Product evidence required',
  evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus,
}))
const screenshotCompetitorKpis = [
  {
    label: 'Profiled Suppliers',
    value: 'No approved source-backed value',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    note: 'Reference template count removed from primary truth. Imported competitor records drive the main table.',
  },
  {
    label: 'EU Avg Price',
    value: 'No public source-backed benchmark',
    status: 'To Verify' as IntelligenceEvidenceStatus,
    note: 'Do not show a $/kg benchmark until source-backed distributor or quote evidence is attached.',
  },
  {
    label: 'Chemicon Target',
    value: 'No approved ASP/costing evidence',
    status: 'To Verify' as IntelligenceEvidenceStatus,
    note: 'Target price needs approved ASP/costing evidence before it appears as a number.',
  },
  {
    label: 'Price Edge',
    value: 'Requires verified competitor price and Chemicon target',
    status: 'To Verify' as IntelligenceEvidenceStatus,
    note: 'No edge percentage is shown until competitor price and Chemicon target are both verified.',
  },
]
const screenshotProductFamilies = [
  {
    title: 'Cationic Softeners - CHEMISOFT',
    subtitle: 'Ester quat / cationic softener comparison template',
    rows: [
      {
        product: 'CWAS',
        form: 'TDS/SDS source required',
        dosing: 'Application guide required',
        ph: 'TDS/SDS source required',
        application: 'Textile finishing softener context',
        status: 'To Verify' as IntelligenceEvidenceStatus,
      },
      {
        product: 'CWMS',
        form: 'TDS/SDS source required',
        dosing: 'Application guide required',
        ph: 'TDS/SDS source required',
        application: 'Textile softener comparison item',
        status: 'To Verify' as IntelligenceEvidenceStatus,
      },
      {
        product: 'CSLC',
        form: 'TDS/SDS source required',
        dosing: 'Application guide required',
        ph: 'TDS/SDS source required',
        application: 'Textile softener comparison item',
        status: 'To Verify' as IntelligenceEvidenceStatus,
      },
    ],
  },
  {
    title: 'Silicone Softeners - CHEMISIL',
    subtitle: 'Silicone finishing / hydrophilic softener comparison template',
    rows: [
      {
        product: 'CHEMISIL HS 200',
        form: 'TDS/SDS source required',
        dosing: 'Application guide required',
        ph: 'TDS/SDS source required',
        application: 'Hydrophilic silicone softener benchmark',
        status: 'To Verify' as IntelligenceEvidenceStatus,
      },
      {
        product: 'CHEMISIL 1800 CON',
        form: 'TDS/SDS source required',
        dosing: 'Application guide required',
        ph: 'TDS/SDS source required',
        application: 'Amino-modified silicone benchmark',
        status: 'To Verify' as IntelligenceEvidenceStatus,
      },
    ],
  },
]
const sourceBackedCompetitorTemplateRows = [
  {
    competitor: 'Transfar Chemicals',
    hq: 'China',
    share: 'Not published by cited source',
    price: 'Not published by cited source',
    strength: 'China textile chemicals / auxiliaries presence',
    weakness: 'Product equivalents, price, and share need source evidence',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    sourceTitle: 'Transfar Chemicals official site',
    sourceUrl: 'https://www.transfarchem.com/en/',
  },
  {
    competitor: 'WACKER',
    hq: 'Germany',
    share: 'Not published by cited source',
    price: 'Not published by cited source',
    strength: 'Silicone textile softener portfolio',
    weakness: 'China softener share and price need verification',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    sourceTitle: 'WACKER FINISH WR 1200 product page',
    sourceUrl: 'https://www.wacker.com/h/en-jo/c/wacker-finish-wr-1200/p/000010891',
  },
  {
    competitor: 'RUDOLF Group',
    hq: 'Germany',
    share: 'Not published by cited source',
    price: 'Not published by cited source',
    strength: 'High-performance silicone softeners for textile applications',
    weakness: 'China share, channel pricing, and equivalent grade need verification',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    sourceTitle: 'RUDOLF RUCOFIN technology page',
    sourceUrl: 'https://rudolf.com/tr/technologies/rucofin',
  },
  {
    competitor: 'CHT Group',
    hq: 'Germany',
    share: 'Not published by cited source',
    price: 'Not published by cited source',
    strength: 'Textile solutions and auxiliaries supplier',
    weakness: 'Equivalent products, price, and China distribution need verification',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    sourceTitle: 'CHT Group company page',
    sourceUrl: 'https://www.cht.com/en/cht-group/company',
  },
  {
    competitor: 'Archroma',
    hq: 'Switzerland',
    share: 'Not published by cited source',
    price: 'Not published by cited source',
    strength: 'Finishing portfolio includes silicone and non-yellowing softeners',
    weakness: 'Market share and local price need verification',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    sourceTitle: 'Archroma finishing solutions',
    sourceUrl: 'https://www.archroma.com/textile-effects/solutions/finishing',
  },
  {
    competitor: 'Zschimmer & Schwarz',
    hq: 'Germany',
    share: 'Not published by cited source',
    price: 'Not published by cited source',
    strength: 'Textile auxiliaries including softeners and finishing products',
    weakness: 'China share, product equivalent, and pricing need verification',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    sourceTitle: 'Zschimmer & Schwarz textile auxiliaries',
    sourceUrl: 'https://www.zschimmer-schwarz.com/en/fibre-textile-auxiliaries/textile-auxiliaries',
  },
  {
    competitor: 'Pulcra Chemicals',
    hq: 'Germany / global',
    share: 'Not published by cited source',
    price: 'Not published by cited source',
    strength: 'Specialty chemicals for fiber, textile, and leather industries',
    weakness: 'Softener equivalent, China pricing, and share need verification',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    sourceTitle: 'Pulcra Chemicals official site',
    sourceUrl: 'https://www.pulcra-chemicals.com/',
  },
  {
    competitor: 'Kao Chemicals Europe',
    hq: 'Japan / Europe',
    share: 'Not published by cited source',
    price: 'Not published by cited source',
    strength: 'Listed public esterquats company reference',
    weakness: 'Textile-softener relevance, China share, and price need verification',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    sourceTitle: 'Grand View Research esterquats report page',
    sourceUrl: 'https://www.grandviewresearch.com/industry-analysis/esterquats-market',
  },
]
const competitorResearchQueue = [
  'Liansheng local textile auxiliary suppliers',
  'Huangma ester / textile auxiliary suppliers',
  'Pulcra China textile finishing grades',
  'Kao esterquat textile relevance',
  'Transfar CWAS/CWMS equivalent products',
]
const autoVerifyingText = 'No source-backed value yet'
type CompetitorSortKey =
  | 'competitor'
  | 'product'
  | 'price'
  | 'marketShare'
  | 'revenue'
  | 'yoyGrowth'
  | 'traffic'
  | 'rating'
  | 'lastUpdated'
  | 'confidence'
type CompetitorEvidenceFilter = 'All' | 'Verified' | 'Auto-checking' | 'Review needed' | 'Restricted'

interface CompetitorComparisonRow {
  id: string
  competitor: string
  product: string
  category: string
  price: string
  marketShare: string
  revenue: string
  yoyGrowth: string
  traffic: string
  rating: string
  lastUpdated: string
  source: string
  sourceUrl?: string
  confidence: string
  evidenceState: CompetitorEvidenceFilter
  evidenceStatus: IntelligenceEvidenceStatus
  nextAction: string
  comparable: Partial<Record<'price' | 'marketShare' | 'revenue' | 'yoyGrowth' | 'traffic' | 'rating' | 'confidence', number>>
  badges: string[]
}

interface CompetitorMetricRow {
  id: string
  competitor: string
  hq: string
  productFocus: string
  priceKg: string
  marketShare: string
  revenue: string
  yearlyGrowth: string
  traffic: string
  rating: string
  lastUpdated: string
  confidence: string
  source: string
  sourceUrl?: string
  evidenceStatus: IntelligenceEvidenceStatus
  nextAction: string
}

interface CollapsedCompetitorRecord extends CompetitorIntelligenceRecord {
  records: CompetitorIntelligenceRecord[]
  productVariations: string
  sourceCount: number
}

const competitorCategoryOptions = [
  'All',
  'Cationic / Ester Quat',
  'Silicone Softener',
  'Textile Auxiliary',
  'China Local',
  'Global Reference',
]
const competitorEvidenceOptions: CompetitorEvidenceFilter[] = ['All', 'Verified', 'Auto-checking', 'Review needed', 'Restricted']
const competitorTableColumns: Array<{ key: CompetitorSortKey; label: string }> = [
  { key: 'competitor', label: 'Competitor' },
  { key: 'product', label: 'Product' },
  { key: 'price', label: 'Price' },
  { key: 'marketShare', label: 'Market Share' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'yoyGrowth', label: 'YoY Growth' },
  { key: 'traffic', label: 'Traffic' },
  { key: 'rating', label: 'Rating' },
  { key: 'lastUpdated', label: 'Last Updated' },
  { key: 'confidence', label: 'Confidence' },
]
const competitorCategoryFilter = ref('All')
const competitorEvidenceFilter = ref<CompetitorEvidenceFilter>('All')
const competitorSortKey = ref<CompetitorSortKey>('competitor')
const competitorSortDirection = ref<'asc' | 'desc'>('asc')
const competitorSourcePack = [
  {
    title: 'Transfar Chemicals official site',
    detail: 'Confirms Transfar textile-chemicals business presence. Product equivalents, price, and share still need evidence.',
    url: 'https://www.transfarchem.com/en/',
  },
  {
    title: 'WACKER textile softener product page',
    detail: 'WACKER FINISH WR 1200 is positioned as active substance in softener formulations for PES fibers/textiles.',
    url: 'https://www.wacker.com/h/en-jo/c/wacker-finish-wr-1200/p/000010891',
  },
  {
    title: 'RUDOLF RUCOFIN page',
    detail: 'RUDOLF identifies RUCOFIN as high-performance silicone softeners for textile applications.',
    url: 'https://rudolf.com/tr/technologies/rucofin',
  },
  {
    title: 'CHT Group company page',
    detail: 'CHT describes itself as a strategic partner of the textile industry and supplier for textile auxiliary formulators.',
    url: 'https://www.cht.com/en/cht-group/company',
  },
  {
    title: 'Archroma finishing solutions',
    detail: 'Archroma lists fabric finishing products including SILIGEN, SOLUSOFT, and ULTRATEX softener families.',
    url: 'https://www.archroma.com/textile-effects/solutions/finishing',
  },
  {
    title: 'Zschimmer & Schwarz textile auxiliaries',
    detail: 'Zschimmer & Schwarz lists textile auxiliaries, softeners, and finishing products.',
    url: 'https://www.zschimmer-schwarz.com/en/fibre-textile-auxiliaries/textile-auxiliaries',
  },
  {
    title: 'Pulcra Chemicals official site',
    detail: 'Pulcra describes specialty chemicals for fiber, textile, and leather industries.',
    url: 'https://www.pulcra-chemicals.com/',
  },
  {
    title: 'Grand View Research esterquats report page',
    detail: 'Lists key esterquats companies; textile-softener relevance, China market share, and pricing still need separate verification.',
    url: 'https://www.grandviewresearch.com/industry-analysis/esterquats-market',
  },
]
const globalCompetitorMatrixRows = [
  {
    company: 'Archroma',
    category: 'Global textile effects / finishing supplier',
    sourceBackedFact: 'Finishing portfolio includes silicone and non-yellowing softener families such as SILIGEN, SOLUSOFT, and ULTRATEX.',
    strategicThreat: 'Broad finishing portfolio, brand trust, sustainability positioning, and textile-mill relationships.',
    evidenceGaps: 'China softener share, distributor/channel pricing, exact CWAS/CWMS equivalent products.',
    nextAction: 'Collect Archroma TDS/SDS and local distributor price evidence.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'Archroma finishing solutions',
  },
  {
    company: 'WACKER',
    category: 'Silicone technology supplier',
    sourceBackedFact: 'WACKER FINISH WR 1200 is positioned as an active substance in softener formulations for PES fibers/textiles.',
    strategicThreat: 'Strong silicone chemistry capability and premium formulation inputs.',
    evidenceGaps: 'Finished softener competitor role, China channels, textile-mill adoption, pricing.',
    nextAction: 'Map WACKER silicone softener actives against CHEMISIL products.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'WACKER FINISH WR 1200 product page',
  },
  {
    company: 'RUDOLF Group',
    category: 'Textile auxiliary / finishing specialist',
    sourceBackedFact: 'RUCOFIN is presented as high-performance silicone softeners for textile applications.',
    strategicThreat: 'Application know-how, textile finishing reputation, and premium performance positioning.',
    evidenceGaps: 'China market share, equivalent grades, customer segments, quote evidence.',
    nextAction: 'Create a RUDOLF product-equivalence table with TDS/SDS sources.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'RUDOLF RUCOFIN page',
  },
  {
    company: 'CHT Group',
    category: 'Global textile auxiliaries supplier',
    sourceBackedFact: 'CHT describes itself as a strategic partner of the textile industry and supplier for textile auxiliary formulators.',
    strategicThreat: 'Broad textile value-chain coverage and formulation support.',
    evidenceGaps: 'Equivalent products, China softener share, local price, distributor strength.',
    nextAction: 'Research CHT China/Bangladesh/Vietnam textile softener product portfolio.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'CHT Group company page',
  },
  {
    company: 'Zschimmer & Schwarz',
    category: 'Textile auxiliaries / softeners',
    sourceBackedFact: 'Official textile auxiliaries pages list softeners and finishing products.',
    strategicThreat: 'Specialized textile auxiliary portfolio and product breadth.',
    evidenceGaps: 'China sales footprint, direct product equivalent, pricing and share.',
    nextAction: 'Verify Zschimmer product equivalents and local distributor evidence.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'Zschimmer & Schwarz textile auxiliaries',
  },
  {
    company: 'Pulcra Chemicals',
    category: 'Fiber, textile, and leather specialty chemicals',
    sourceBackedFact: 'Pulcra positions itself as a specialty-chemicals supplier for fiber, textile, and leather industries.',
    strategicThreat: 'Global textile network and application-focused chemical portfolio.',
    evidenceGaps: 'CWAS/CWMS equivalent grades, China/Bangladesh/Vietnam price proof, customer proof.',
    nextAction: 'Research Pulcra softener families and export-market distributor presence.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'Pulcra Chemicals official site',
  },
  {
    company: 'Transfar Chemicals',
    category: 'China local textile-chemicals competitor',
    sourceBackedFact: 'Official site supports Transfar Chemicals as a China chemicals/textile-chemicals research target.',
    strategicThreat: 'Local presence, potential cost/logistics advantage, and China customer familiarity.',
    evidenceGaps: 'Exact softener product equivalents, local price, quality/performance proof, share.',
    nextAction: 'Research Transfar CWAS/CWMS equivalents and customer references.',
    status: 'Source-backed' as IntelligenceEvidenceStatus,
    source: 'Transfar Chemicals official site',
  },
  {
    company: 'Stepan / Kao / Evonik / BASF / Syensqo',
    category: 'Esterquat active and global reference companies',
    sourceBackedFact: 'Grand View Research lists these as key esterquats companies.',
    strategicThreat: 'Upstream esterquat know-how, global brand, and active-ingredient supply references.',
    evidenceGaps: 'Textile-softener relevance, China textile market share, product equivalents, pricing.',
    nextAction: 'Separate home-care esterquat suppliers from textile-finishing competitors.',
    status: 'Reference Only' as IntelligenceEvidenceStatus,
    source: 'Grand View Research esterquats report page',
  },
]
const competitorAnalysisCategories = [
  {
    title: 'Global formulation houses',
    competitors: 'Archroma, CHT, RUDOLF, Zschimmer & Schwarz, Pulcra',
    whatToLearn: 'Product breadth, active content, application positioning, sustainability claims, local distributors, mill references.',
    risk: 'They may beat Chemicon on technical support and brand trust even if price is higher.',
  },
  {
    title: 'Silicone technology suppliers',
    competitors: 'WACKER plus silicone-focused product families from global auxiliary suppliers',
    whatToLearn: 'Hydrophilic silicone, amino silicone, softness/hand-feel claims, yellowing behavior, washing durability.',
    risk: 'CHEMISIL claims need TDS/SDS and test data before competing against premium silicone portfolios.',
  },
  {
    title: 'China local suppliers',
    competitors: 'Transfar and additional local suppliers still to verify',
    whatToLearn: 'Local price bands, batch sizes, lead time, customer trust, quality consistency, after-sales support.',
    risk: 'Local suppliers may define the price floor and buyer expectations in Zhejiang/Jiangsu clusters.',
  },
  {
    title: 'Esterquat active references',
    competitors: 'Stepan, Kao, Evonik, BASF, Syensqo and other listed esterquat companies',
    whatToLearn: 'Raw-material/active strategy, esterquat quality references, and whether textile finishing relevance exists.',
    risk: 'Home-care esterquat data can mislead textile-softener planning if not separated from CWAS/CWMS use cases.',
  },
]
const pdfChineseDistributorRows = [
  { company: 'Transfar Group / Transfar Chemicals', hq: 'Hangzhou, Zhejiang', focus: 'Textile auxiliaries, surfactants', scale: 'Reference value archived', relevance: 'China local textile-chemical target' },
  { company: 'Zhejiang Longsheng', hq: 'Shaoxing, Zhejiang', focus: 'Dyes, intermediates', scale: 'Reference value archived', relevance: 'Large textile-chemical ecosystem player' },
  { company: 'Zhejiang Runtu', hq: 'Shangyu, Zhejiang', focus: 'Dyes, textile chemicals', scale: 'Reference value archived', relevance: 'Regional textile chemical player' },
  { company: 'Dymatic Chemicals', hq: 'Foshan, Guangdong', focus: 'Textile auxiliaries', scale: 'Reference value archived', relevance: 'China textile auxiliary competitor/research target' },
  { company: 'Shanghai Anoky', hq: 'Shanghai', focus: 'Dyes, specialty chemicals', scale: 'Reference value archived', relevance: 'Specialty textile chemical reference' },
  { company: 'HT Fine Chemicals', hq: 'Dongguan, Guangdong', focus: 'Silicone, softeners', scale: 'Reference value archived', relevance: 'Possible softener-specific competitor' },
  { company: 'NICCA Chemical (China)', hq: 'Shanghai', focus: 'Japanese JV, surfactants', scale: 'Reference value archived', relevance: 'China surfactant/textile auxiliary reference' },
]
const pdfGlobalManufacturerShareRows = [
  { rank: 'Archived', manufacturer: 'Evonik Industries', hq: 'Germany', capacity: 'Reference value archived', share: 'Reference value archived' },
  { rank: 'Archived', manufacturer: 'Stepan Company', hq: 'USA', capacity: 'Reference value archived', share: 'Reference value archived' },
  { rank: 'Archived', manufacturer: 'Kao Corporation', hq: 'Japan', capacity: 'Reference value archived', share: 'Reference value archived' },
  { rank: 'Archived', manufacturer: 'Solvay / Syensqo', hq: 'Belgium', capacity: 'Reference value archived', share: 'Reference value archived' },
]
const marketShareChartRows = computed(() =>
  collapsedCompetitors.value
    .map(competitor => ({
      competitor,
      label: competitor.companyName,
      shareLabel: competitorMarketShareLabel(competitor),
      numericShare: Number.parseFloat((competitor.marketShare || '').replace(/[^\d.]/g, '')),
      isAssumption: competitor.evidenceStatus === 'Assumption' || competitor.evidenceStatus === 'Powerful Assumption',
      isSourceBacked: sourceIsUsable(competitor.source) && competitor.evidenceStatus !== 'To Verify' && competitor.evidenceStatus !== 'Missing',
    }))
    .filter(row => Number.isFinite(row.numericShare) && row.numericShare > 0 && (row.isAssumption || row.isSourceBacked)),
)
const competitorMetricsRows = computed<CompetitorMetricRow[]>(() => {
  const savedRows: CompetitorMetricRow[] = collapsedCompetitors.value.map(competitor => ({
    id: `saved-${competitor.id}`,
    competitor: competitor.companyName,
    hq: competitor.countryRegion || autoVerifyingText,
    productFocus: competitor.productVariations || competitor.productEquivalent || autoVerifyingText,
    priceKg: visibleSensitiveValue(competitor.pricingEvidence),
    marketShare: autoVerifyText(competitorMarketShareLabel(competitor)),
    revenue: autoVerifyText(competitor.revenue),
    yearlyGrowth: autoVerifyText(competitor.yearlyGrowth),
    traffic: autoVerifyText(competitor.traffic),
    rating: autoVerifyText(competitor.rating),
    lastUpdated: competitorLastUpdatedLabel(competitor),
    confidence: competitorConfidenceLabel(competitor),
    source: competitor.source?.title || 'Source search running',
    sourceUrl: competitor.source?.url,
    evidenceStatus: competitor.evidenceStatus,
    nextAction: competitor.notes || 'Hermes will keep checking product equivalent, price, market share, revenue, and growth evidence.',
  }))

  return collapseCompetitorMetricRows(savedRows)
})

function collapseCompetitorRecords(records: CompetitorIntelligenceRecord[]): CollapsedCompetitorRecord[] {
  const groups = new Map<string, CompetitorIntelligenceRecord[]>()
  for (const record of records) {
    const key = normalizedCompetitorKey(record.companyName)
    groups.set(key, [...(groups.get(key) || []), record])
  }

  return Array.from(groups.values()).map(group => {
    const sourceBacked = group.filter(record => sourceIsUsable(record.source))
    const primary = sourceBacked[0] || group[0]
    const productVariations = uniqueValues(group.map(record => record.productEquivalent)).sort((a, b) => a.localeCompare(b))
    const sourceRecords = sourceBacked.length ? sourceBacked : group.filter(record => record.source?.title)
    const sourceTitles = uniqueValues(sourceRecords.map(record => record.source?.title))
    const notes = uniqueValues(group.map(record => record.notes).filter(Boolean))

    return {
      ...primary,
      id: group.map(record => record.id).join('__'),
      companyName: primary.companyName,
      countryRegion: firstUsefulValue(group.map(record => record.countryRegion), primary.countryRegion),
      productEquivalent: productVariations.length > 1
        ? productVariations.join(' / ')
        : productVariations[0] || primary.productEquivalent,
      productVariations: productVariations.join(' / ') || primary.productEquivalent,
      activeContent: firstUsefulValue(group.map(record => record.activeContent), primary.activeContent),
      pricingEvidence: bestMetricValue(group.map(record => record.pricingEvidence), primary.pricingEvidence || autoVerifyingText, 'min'),
      certifications: firstUsefulValue(group.map(record => record.certifications), primary.certifications),
      distributionPresence: firstUsefulValue(group.map(record => record.distributionPresence), primary.distributionPresence),
      marketShare: bestMetricValue(group.map(record => record.marketShare || ''), primary.marketShare || '', 'max'),
      revenue: bestMetricValue(group.map(record => record.revenue || ''), primary.revenue || '', 'max'),
      yearlyGrowth: bestMetricValue(group.map(record => record.yearlyGrowth || ''), primary.yearlyGrowth || '', 'max'),
      traffic: bestMetricValue(group.map(record => record.traffic || ''), primary.traffic || '', 'max'),
      rating: bestMetricValue(group.map(record => record.rating || ''), primary.rating || '', 'max'),
      lastUpdated: firstUsefulValue(group.map(record => record.lastUpdated || record.updatedAt || ''), primary.lastUpdated || primary.updatedAt),
      confidence: bestConfidenceValue(group.map(record => record.confidence || ''), primary.confidence || ''),
      evidenceStatus: strongestEvidenceStatus(group.map(record => record.evidenceStatus)),
      source: sourceRecords[0]?.source || primary.source || null,
      notes: notes.length > 1 ? notes.join(' / ') : notes[0] || primary.notes,
      updatedAt: group
        .map(record => record.updatedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || primary.updatedAt,
      records: group,
      sourceCount: sourceTitles.length,
    }
  })
}
const competitorComparisonRows = computed<CompetitorComparisonRow[]>(() => {
  const rows = competitorMetricsRows.value.map(row => {
    const hasSource = sourceIsUsable({ title: row.source, url: row.sourceUrl })
    const hasComparableData = hasSource && [
      row.priceKg,
      row.marketShare,
      row.revenue,
      row.yearlyGrowth,
      row.traffic,
      row.rating,
    ].some(value => comparableNumber(value) !== null)
    const sourceMissing = !hasSource
    const comparable = hasSource
      ? {
          price: comparableNumber(row.priceKg) ?? undefined,
          marketShare: comparableNumber(row.marketShare) ?? undefined,
          revenue: comparableNumber(row.revenue) ?? undefined,
          yoyGrowth: comparableNumber(row.yearlyGrowth) ?? undefined,
          traffic: comparableNumber(row.traffic) ?? undefined,
          rating: comparableNumber(row.rating) ?? undefined,
          confidence: comparableNumber(row.confidence) ?? confidenceScoreForRow(row.evidenceStatus, hasSource, hasComparableData),
        }
      : {}

    return {
      id: row.id,
      competitor: row.competitor,
      product: row.productFocus,
      category: competitorCategoryFor(row.competitor, row.productFocus, row.hq),
      price: row.priceKg,
      marketShare: row.marketShare,
      revenue: row.revenue,
      yoyGrowth: row.yearlyGrowth,
      traffic: row.traffic,
      rating: row.rating,
      lastUpdated: row.lastUpdated,
      source: sourceMissing ? 'Hermes source search running' : row.source,
      sourceUrl: row.sourceUrl,
      confidence: row.confidence || confidenceLabelForRow(row.evidenceStatus, hasSource, hasComparableData),
      evidenceState: evidenceStateForRow(row.evidenceStatus, hasSource, hasComparableData, row.priceKg),
      evidenceStatus: row.evidenceStatus,
      nextAction: autoVerifyText(row.nextAction),
      comparable,
      badges: [],
    }
  })

  const leaders = {
    marketShare: leaderId(rows, 'marketShare', 'max'),
    yoyGrowth: leaderId(rows, 'yoyGrowth', 'max'),
    revenue: leaderId(rows, 'revenue', 'max'),
    price: leaderId(rows, 'price', 'min'),
  }

  const filtered = rows
    .map(row => ({
      ...row,
      badges: [
        leaders.marketShare === row.id ? '🥇 Market Leader' : '',
        leaders.yoyGrowth === row.id ? '📈 Fastest Growth' : '',
        leaders.revenue === row.id ? '💰 Highest Revenue' : '',
        leaders.price === row.id ? '🔥 Most Competitive Pricing' : '',
      ].filter(Boolean),
    }))
    .filter(row => competitorCategoryFilter.value === 'All' || row.category === competitorCategoryFilter.value)
    .filter(row => competitorEvidenceFilter.value === 'All' || row.evidenceState === competitorEvidenceFilter.value)

  return filtered.sort((a, b) => compareCompetitorRows(a, b))
})

function competitorCategoryFor(competitor: string, product: string, hq: string): string {
  const text = `${competitor} ${product} ${hq}`.toLowerCase()
  if (/transfar|zhejiang|dymatic|huangma|liansheng|shanghai|dongguan|china/.test(text)) return 'China Local'
  if (/wacker|silicone|chemisil|pdms|hydrophilic|amino/.test(text)) return 'Silicone Softener'
  if (/evonik|stepan|kao|basf|syensqo|solvay|esterquat|ester quat|cationic|cwas|cwms|chemisoft/.test(text)) return 'Cationic / Ester Quat'
  if (/archroma|rudolf|cht|zschimmer|pulcra|textile|auxiliar|finishing|softener/.test(text)) return 'Textile Auxiliary'
  return 'Global Reference'
}

function collapseCompetitorMetricRows(rows: CompetitorMetricRow[]): CompetitorMetricRow[] {
  const groups = new Map<string, CompetitorMetricRow[]>()
  for (const row of rows) {
    const key = normalizedCompetitorKey(row.competitor)
    groups.set(key, [...(groups.get(key) || []), row])
  }

  return Array.from(groups.values()).map(group => {
    if (group.length === 1) return group[0]
    const primary = group.find(row => row.id.startsWith('saved-')) || group[0]
    const productVariations = uniqueValues(group.map(row => row.productFocus)).sort((a, b) => a.localeCompare(b))
    const sources = uniqueValues(group.map(row => row.source).filter(source => source && !/source search running/i.test(source)))
    const nextActions = uniqueValues(group.map(row => row.nextAction).filter(Boolean))
    return {
      ...primary,
      id: group.map(row => row.id).join('__'),
      productFocus: productVariations.length > 1
        ? productVariations.join(' / ')
        : productVariations[0] || primary.productFocus,
      hq: firstUsefulValue(group.map(row => row.hq), primary.hq),
      priceKg: bestMetricValue(group.map(row => row.priceKg), autoVerifyingText, 'min'),
      marketShare: bestMetricValue(group.map(row => row.marketShare), autoVerifyingText, 'max'),
      revenue: bestMetricValue(group.map(row => row.revenue), autoVerifyingText, 'max'),
      yearlyGrowth: bestMetricValue(group.map(row => row.yearlyGrowth), autoVerifyingText, 'max'),
      traffic: bestMetricValue(group.map(row => row.traffic), autoVerifyingText, 'max'),
      rating: bestMetricValue(group.map(row => row.rating), autoVerifyingText, 'max'),
      lastUpdated: firstUsefulValue(group.map(row => row.lastUpdated), primary.lastUpdated),
      confidence: bestConfidenceValue(group.map(row => row.confidence), primary.confidence),
      source: sources.length > 1 ? `${sources.length} sources` : sources[0] || primary.source,
      sourceUrl: group.find(row => row.sourceUrl)?.sourceUrl,
      evidenceStatus: strongestEvidenceStatus(group.map(row => row.evidenceStatus)),
      nextAction: nextActions.length > 1 ? nextActions.join(' / ') : nextActions[0] || primary.nextAction,
    }
  })
}

function normalizedCompetitorKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(group|company|chemicals?|chemical|industries|industry|co|corp|corporation|limited|ltd|inc|gmbh|ag|plc)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function uniqueValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function firstUsefulValue(values: string[], fallback: string): string {
  return values.find(value => value && !/no source-backed value yet|source review needed|not published by cited source|source search running/i.test(value)) || fallback
}

function bestMetricValue(values: string[], fallback: string, mode: 'max' | 'min'): string {
  const candidates = values
    .map(value => ({ value, numeric: comparableNumber(value || '') }))
    .filter(candidate => candidate.numeric !== null) as Array<{ value: string; numeric: number }>
  if (!candidates.length) return firstUsefulValue(values, fallback)
  return candidates.reduce((best, candidate) => {
    return mode === 'max'
      ? candidate.numeric > best.numeric ? candidate : best
      : candidate.numeric < best.numeric ? candidate : best
  }).value
}

function bestConfidenceValue(values: string[], fallback: string): string {
  const score = (value: string): number => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return 0
    if (normalized === 'high') return 90
    if (normalized === 'medium') return 60
    if (normalized === 'low') return 30
    return comparableNumber(normalized) ?? 0
  }
  const candidates = values
    .map(value => ({ value, score: score(value) }))
    .filter(candidate => candidate.value && candidate.score > 0)
  if (!candidates.length) return firstUsefulValue(values, fallback)
  return candidates.reduce((best, candidate) => candidate.score > best.score ? candidate : best).value
}

function strongestEvidenceStatus(statuses: IntelligenceEvidenceStatus[]): IntelligenceEvidenceStatus {
  const order: IntelligenceEvidenceStatus[] = [
    'Verified',
    'User Approved',
    'Investor Approved',
    'Trusted Source Auto-Updated',
    'Official Data',
    'Source-backed',
    'User Provided',
    'Reference Only',
    'Candidate Source',
    'Assumption',
    'Powerful Assumption',
    'Hypothesis',
    'Conflict Detected',
    'To Verify',
    'Missing',
  ]
  return order.find(status => statuses.includes(status)) || statuses[0] || 'To Verify'
}

function evidenceStateForRow(
  status: IntelligenceEvidenceStatus,
  hasSource: boolean,
  hasComparableData: boolean,
  priceText: string,
): CompetitorEvidenceFilter {
  if (/restricted/i.test(priceText)) return 'Restricted'
  if (!hasSource) return 'Auto-checking'
  if (['Assumption', 'Powerful Assumption', 'Hypothesis', 'Conflict Detected'].includes(status)) return 'Review needed'
  if (
    hasComparableData &&
    ['Verified', 'User Approved', 'Investor Approved', 'Source-backed', 'Official Data', 'Trusted Source Auto-Updated'].includes(status)
  ) return 'Verified'
  return 'Auto-checking'
}

function confidenceLabelForRow(status: IntelligenceEvidenceStatus, hasSource: boolean, hasComparableData: boolean): string {
  if (!hasSource) return 'Auto-checking'
  if (hasComparableData && ['Verified', 'User Approved', 'Investor Approved', 'Source-backed', 'Official Data', 'Trusted Source Auto-Updated'].includes(status)) return 'High'
  if (['Assumption', 'Powerful Assumption', 'Hypothesis', 'Conflict Detected'].includes(status)) return 'Review'
  return 'Source found'
}

function confidenceScoreForRow(status: IntelligenceEvidenceStatus, hasSource: boolean, hasComparableData: boolean): number | undefined {
  if (!hasSource) return undefined
  if (hasComparableData && ['Verified', 'User Approved', 'Investor Approved', 'Source-backed', 'Official Data', 'Trusted Source Auto-Updated'].includes(status)) return 3
  if (['Assumption', 'Powerful Assumption', 'Hypothesis', 'Conflict Detected'].includes(status)) return 1
  return 2
}

function comparableNumber(value: string): number | null {
  const normalized = String(value || '').trim().replace(/\bFY\s*20\d{2}\b/gi, '').replace(/\b20\d{2}\b(?=\s+(?:company|net|sales|revenue|turnover|yoy))/gi, '')
  if (!normalized || /verify|missing|restricted|source search/i.test(normalized)) return null
  const percent = normalized.match(/([+-]?\d[\d,.]*)\s*%/)
  if (percent) {
    const value = Number.parseFloat(percent[1].replace(/,/g, ''))
    if (Number.isFinite(value)) return value
  }
  const money = normalized.match(/(?:US\$|USD|EUR|JPY|CNY|RMB|[$€¥])\s*([\d,.]+)\s*(billion|bn|b|million|mn|m|k)?/i)
  if (money) {
    const base = Number.parseFloat(money[1].replace(/,/g, ''))
    if (!Number.isFinite(base)) return null
    const unit = money[2]?.toLowerCase()
    if (unit === 'billion' || unit === 'bn' || unit === 'b') return base * 1000
    if (unit === 'million' || unit === 'mn' || unit === 'm') return base
    if (unit === 'k') return base / 1000
    if (base >= 100_000) return base / 1_000_000
    return base
  }
  const range = normalized.match(/([\d,.]+)\s*[-–]\s*([\d,.]+)/)
  if (range) {
    const left = Number.parseFloat(range[1].replace(/,/g, ''))
    const right = Number.parseFloat(range[2].replace(/,/g, ''))
    if (Number.isFinite(left) && Number.isFinite(right)) return (left + right) / 2
  }
  const match = normalized.match(/([\d,.]+)\s*([kmb])?/i)
  if (!match) return null
  const base = Number.parseFloat(match[1].replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const suffix = match[2]?.toLowerCase()
  if (suffix === 'b') return base * 1000
  if (suffix === 'm') return base
  if (suffix === 'k') return base / 1000
  return base
}

function leaderId(rows: CompetitorComparisonRow[], key: keyof CompetitorComparisonRow['comparable'], mode: 'max' | 'min'): string {
  const sourceBackedRows = rows.filter(row =>
    row.evidenceState === 'Verified' &&
    typeof row.comparable[key] === 'number' &&
    Number.isFinite(row.comparable[key])
  )
  if (!sourceBackedRows.length) return ''
  return sourceBackedRows.reduce((best, row) => {
    const current = row.comparable[key] ?? 0
    const bestValue = best.comparable[key] ?? 0
    return mode === 'max'
      ? current > bestValue ? row : best
      : current < bestValue ? row : best
  }).id
}

function compareCompetitorRows(a: CompetitorComparisonRow, b: CompetitorComparisonRow): number {
  const direction = competitorSortDirection.value === 'asc' ? 1 : -1
  const key = competitorSortKey.value
  const numericA = a.comparable[key as keyof CompetitorComparisonRow['comparable']]
  const numericB = b.comparable[key as keyof CompetitorComparisonRow['comparable']]
  if (typeof numericA === 'number' || typeof numericB === 'number') {
    return (((numericA ?? Number.NEGATIVE_INFINITY) - (numericB ?? Number.NEGATIVE_INFINITY)) || a.competitor.localeCompare(b.competitor)) * direction
  }
  return String(a[key] || '').localeCompare(String(b[key] || '')) * direction
}

function toggleCompetitorSort(key: CompetitorSortKey) {
  if (competitorSortKey.value === key) {
    competitorSortDirection.value = competitorSortDirection.value === 'asc' ? 'desc' : 'asc'
    return
  }
  competitorSortKey.value = key
  competitorSortDirection.value = ['price', 'competitor', 'product', 'lastUpdated'].includes(key) ? 'asc' : 'desc'
}

function sortIndicator(key: CompetitorSortKey): string {
  if (competitorSortKey.value !== key) return ''
  return competitorSortDirection.value === 'asc' ? ' ↑' : ' ↓'
}

function competitorMarketShareLabel(competitor: CompetitorIntelligenceRecord): string {
  return formatSourcedMarketShare(competitor.marketShare, competitor.source, competitor.evidenceStatus)
}

function competitorLastUpdatedLabel(competitor: CompetitorIntelligenceRecord): string {
  if (!sourceIsUsable(competitor.source)) return autoVerifyingText
  const value = competitor.lastUpdated || competitor.source?.date || competitor.updatedAt
  return value ? formatDateTime(value) : autoVerifyingText
}

function competitorConfidenceLabel(competitor: CompetitorIntelligenceRecord): string {
  const explicit = String(competitor.confidence || '').trim()
  if (explicit) return explicit
  return confidenceLabelForRow(
    competitor.evidenceStatus,
    sourceIsUsable(competitor.source),
    ['pricingEvidence', 'marketShare', 'revenue', 'yearlyGrowth', 'traffic', 'rating']
      .some(key => comparableNumber(String(competitor[key as keyof CompetitorIntelligenceRecord] || '')) !== null),
  )
}

function primaryCompetitorRecord(competitor: CompetitorIntelligenceRecord): CompetitorIntelligenceRecord {
  const collapsed = competitor as CollapsedCompetitorRecord
  return collapsed.records?.[0] || competitor
}

function autoVerifyText(value: string | null | undefined): string {
  const normalized = String(value || '').trim()
  if (!normalized || normalized === 'To Verify') return autoVerifyingText
  if (normalized === 'Missing') return autoVerifyingText
  return normalized
    .replace(/Missing\s*\/\s*To Verify/g, autoVerifyingText)
    .replace(/Trade Proxy\s*\/\s*To Verify/g, `Trade Proxy / ${autoVerifyingText}`)
    .replace(/\bTo Verify\b/g, autoVerifyingText)
}

function displayEvidenceStatus(status: IntelligenceEvidenceStatus): string {
  if (status === 'To Verify') return autoVerifyingText
  if (status === 'Missing') return autoVerifyingText
  return status
}

function visibleSensitiveValue(value: string): string {
  const visible = String(redactForEmployee(value || 'Missing'))
  return autoVerifyText(visible)
}

function statusClass(status: IntelligenceEvidenceStatus): string {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function syncCompetitorsNow() {
  const saved = intelligence.addResearchFinding({
    summary: [
      'Competitor Intelligence refresh draft',
      `Competitor records: ${competitors.value.length}`,
      'Unsupported market share, price, revenue, and yearly growth stay out of dashboard truth until usable source evidence is attached.',
      'Pricing and formula-sensitive fields remain restricted where required.',
    ].join('\n'),
    keyClaim: 'Competitor intelligence requires source review',
    area: 'market',
    evidenceStatus: 'To Verify',
    confidence: 'medium',
    source: null,
    suggestedTask: 'Review competitor evidence, product equivalents, pricing proof, source links, and market-share labels.',
    riskNote: 'No competitor market share or price should be used as fact until source-backed or visibly assumption-labeled.',
  })
  refreshState.value = {
    ...refreshState.value,
    lastRun: new Date().toISOString(),
    nextRun: nextTwiceDailyRefresh(),
    lastStatus: `Research review draft staged: ${saved.keyClaim}`,
    resultNeedsReviewCount: refreshState.value.resultNeedsReviewCount + 1,
  }
  message.success('Competitor refresh staged for research review')
}

function resetCompetitorForm() {
  competitorForm.value = {
    companyName: '',
    countryRegion: '',
    productEquivalent: '',
    activeContent: '',
    pricingEvidence: '',
    certifications: '',
    distributionPresence: '',
    marketShare: '',
    revenue: '',
    yearlyGrowth: '',
    evidenceStatus: 'To Verify',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
    notes: '',
  }
  editingCompetitorId.value = null
}

async function createResearchTask(competitor: CompetitorIntelligenceRecord) {
  creating.value = competitor.companyName
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Competitor research: ${competitor.companyName}`,
      body: [
        `Competitor: ${competitor.companyName}`,
        'Collect company name, country/region, product equivalent, active content, pricing evidence, certifications, distribution presence, source links, and notes.',
        'Market share, price, revenue, and yearly growth must stay in source review unless backed by a credible source.',
        'Tags: Competitor Intelligence, Research Job, Source Review',
      ].join('\n'),
      priority: 2,
      tenant: 'Chemicon China Feasibility',
    })
    intelligence.addResearchJob({
      title: `Competitor research: ${competitor.companyName}`,
      question: `Verify ${competitor.companyName} product equivalent, pricing evidence, distribution, certifications, and market-share source if available.`,
      scope: 'Competitor identity, region, product equivalent, active content, pricing proof, certifications, distribution presence, revenue, yearly growth, and source-backed market-share status.',
      expectedOutput: 'Structured competitor evidence record with sources, confidence, and source-review labels for unsupported claims.',
      sourceRequirements: 'Market share, price, revenue, and yearly growth must stay in source review unless supported by a credible source title plus URL or date.',
      priority: 'medium',
      schedulePreference: 'Tonight',
      context: 'Chemicon China Feasibility',
      status: 'Task Created',
    })
    message.success('Competitor research task created')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    creating.value = ''
  }
}

async function createGenericCompetitorTask(title: string, notes: string) {
  await createResearchTask({
    id: title.toLowerCase().replace(/\s+/g, '-'),
    companyName: title,
    countryRegion: 'To Verify',
    productEquivalent: 'To Verify',
    activeContent: 'To Verify',
    pricingEvidence: 'To Verify',
    certifications: 'To Verify',
    distributionPresence: 'To Verify',
    marketShare: '',
    revenue: '',
    yearlyGrowth: '',
    evidenceStatus: 'To Verify',
    source: null,
    notes,
    updatedAt: new Date().toISOString(),
  })
}

function stageCompetitorForReview(competitor: CompetitorIntelligenceRecord) {
  const usableSource = sourceIsUsable(competitor.source)
  const saved = intelligence.addResearchFinding({
    summary: [
      `Competitor: ${competitor.companyName}`,
      `Region: ${competitor.countryRegion}`,
      `Product equivalent: ${competitor.productEquivalent}`,
      `Active content: ${competitor.activeContent}`,
      `Pricing evidence: ${redactSensitiveFields.value ? 'Restricted' : competitor.pricingEvidence}`,
      `Certifications: ${competitor.certifications}`,
      `Distribution presence: ${competitor.distributionPresence}`,
      `Market share: ${competitorMarketShareLabel(competitor)}`,
      `Revenue: ${autoVerifyText(competitor.revenue)}`,
      `Yearly growth: ${autoVerifyText(competitor.yearlyGrowth)}`,
      `Notes: ${competitor.notes}`,
    ].join('\n'),
    keyClaim: `Competitor evidence: ${competitor.companyName}`,
    area: 'market',
    evidenceStatus: competitor.evidenceStatus,
    confidence: usableSource && (competitor.evidenceStatus === 'Verified' || competitor.evidenceStatus === 'User Approved')
      ? 'medium'
      : 'low',
    source: competitor.source || null,
    suggestedTask: usableSource
      ? `Review competitor evidence for ${competitor.companyName} before using it in investor material.`
      : `Collect usable source evidence for ${competitor.companyName}.`,
    suggestedInvestorMaterial: usableSource
      ? `Competitor evidence for ${competitor.companyName}: ${competitor.productEquivalent}. Pricing evidence: ${redactSensitiveFields.value ? 'Restricted' : competitor.pricingEvidence}. Market share: ${competitorMarketShareLabel(competitor)}. Revenue: ${autoVerifyText(competitor.revenue)}. Yearly growth: ${autoVerifyText(competitor.yearlyGrowth)}.`
      : '',
    riskNote: usableSource
      ? 'Review source quality before approving this competitor evidence for investor use.'
      : 'Competitor evidence remains in source review until a source title plus URL or date is attached.',
  })

  if (competitor.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Staged for source review because verified findings need usable source evidence')
  } else {
    message.success('Competitor evidence staged for research review')
  }
}

function removeCompetitor(competitor: CompetitorIntelligenceRecord) {
  if (!window.confirm(`Remove competitor record "${competitor.companyName}" from this browser workspace?`)) return
  const records = (competitor as CollapsedCompetitorRecord).records || [competitor]
  const removed = records
    .map(record => intelligence.removeCompetitor(record.id))
    .some(Boolean)
  if (removed) message.success('Competitor record removed from this browser workspace')
  else message.error('Competitor record was not found')
}

function startEditCompetitor(competitor: CompetitorIntelligenceRecord) {
  editingCompetitorId.value = competitor.id
  competitorForm.value = {
    companyName: competitor.companyName,
    countryRegion: competitor.countryRegion,
    productEquivalent: competitor.productEquivalent,
    activeContent: competitor.activeContent,
    pricingEvidence: competitor.pricingEvidence,
    certifications: competitor.certifications,
    distributionPresence: competitor.distributionPresence,
    marketShare: competitor.marketShare || '',
    revenue: competitor.revenue || '',
    yearlyGrowth: competitor.yearlyGrowth || '',
    evidenceStatus: competitor.evidenceStatus,
    sourceTitle: competitor.source?.title || '',
    sourceUrl: competitor.source?.url || '',
    sourceDate: competitor.source?.date || '',
    notes: competitor.notes,
  }
}

function addCompetitor() {
  const companyName = competitorForm.value.companyName.trim()
  if (!companyName) {
    message.warning('Add a company name or competitor placeholder first')
    return
  }
  const source = competitorForm.value.sourceTitle.trim()
    ? {
        title: competitorForm.value.sourceTitle.trim(),
        url: competitorForm.value.sourceUrl.trim() || undefined,
        date: competitorForm.value.sourceDate.trim() || undefined,
      }
    : null
  const payload = {
    companyName,
    countryRegion: competitorForm.value.countryRegion.trim() || 'To Verify',
    productEquivalent: competitorForm.value.productEquivalent.trim() || 'To Verify',
    activeContent: competitorForm.value.activeContent.trim() || 'To Verify',
    pricingEvidence: competitorForm.value.pricingEvidence.trim() || 'Missing',
    certifications: competitorForm.value.certifications.trim() || 'To Verify',
    distributionPresence: competitorForm.value.distributionPresence.trim() || 'To Verify',
    marketShare: competitorForm.value.marketShare.trim(),
    revenue: competitorForm.value.revenue.trim(),
    yearlyGrowth: competitorForm.value.yearlyGrowth.trim(),
    evidenceStatus: competitorForm.value.evidenceStatus,
    source,
    notes: competitorForm.value.notes.trim() || 'No competitor claim should be treated as real until source evidence is attached.',
  }
  const saved = editingCompetitorId.value
    ? intelligence.updateCompetitor(editingCompetitorId.value, payload)
    : intelligence.addCompetitor(payload)
  if (!saved) {
    message.error('Competitor record was not found')
    return
  }
  if (competitorForm.value.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Competitor saved for source review because verified records need usable source evidence')
  } else {
    message.success(editingCompetitorId.value ? 'Competitor record updated' : 'Competitor record saved in this browser workspace')
  }
  resetCompetitorForm()
}
</script>

<template>
  <div class="competitor-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Competitor intelligence</p>
        <h2 class="header-title">Evidence-Backed Competitor Tracking</h2>
        <p class="page-copy">
          Track product equivalents, certifications, distribution presence, and source links. Pricing/cost fields are
          restricted for employee-style roles. Unsupported market share, price, revenue, and growth stay out of
          dashboard truth until source-backed evidence is attached.
        </p>
        <p class="section-help-text">Market share must be source-backed or labeled as an assumption. Unknown values stay out of investor truth while scheduled source research continues.</p>
      </div>
      <div class="refresh-card">
        <span>Last updated: {{ formatDateTime(refreshState.lastRun) }}</span>
        <span>Next update: {{ formatDateTime(refreshState.nextRun) }}</span>
        <span>Status: {{ refreshState.lastStatus }}</span>
        <span>Needs review: {{ refreshState.resultNeedsReviewCount }}</span>
        <NButton size="tiny" type="primary" @click="syncCompetitorsNow">Sync Now</NButton>
        <RouterLink class="header-link" :to="{ name: 'hermes.marketIntelligence' }">Market Intelligence</RouterLink>
      </div>
    </header>

    <TrustedSourceAutopilotPanel screen="competitor" title="Competitor Auto Source Status" />

    <section class="comparison-command-panel" aria-label="Single competitor intelligence comparison table">
      <div class="comparison-hero">
        <div>
          <p class="eyebrow">Primary view</p>
          <h3>Single Competitor Intelligence Table</h3>
          <p>
            Hermes fills this table from trusted-source research and keeps unsupported values in automatic checking.
            Price, market share, revenue, growth, traffic, and rating are not treated as facts unless a usable source
            and confidence state exist.
          </p>
        </div>
        <div class="comparison-actions">
          <NButton size="small" type="primary" @click="syncCompetitorsNow">Sync Now</NButton>
          <RouterLink class="template-link" :to="{ name: 'hermes.researchResultReview' }">Review Queue</RouterLink>
          <RouterLink class="template-link" :to="{ name: 'hermes.trustedSources' }">Trusted Sources</RouterLink>
        </div>
      </div>

      <div class="comparison-filter-bar" aria-label="Competitor table controls">
        <label>
          Product category
          <select v-model="competitorCategoryFilter">
            <option v-for="option in competitorCategoryOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label>
          Evidence state
          <select v-model="competitorEvidenceFilter">
            <option v-for="option in competitorEvidenceOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <span class="comparison-filter-note">
          Sort active: {{ competitorTableColumns.find(column => column.key === competitorSortKey)?.label }}{{ sortIndicator(competitorSortKey) }}
        </span>
      </div>

      <div class="comparison-table-wrap">
        <div class="comparison-grid-row head">
          <button
            v-for="column in competitorTableColumns"
            :key="column.key"
            type="button"
            class="comparison-sort-button"
            @click="toggleCompetitorSort(column.key)"
          >
            {{ column.label }}{{ sortIndicator(column.key) }}
          </button>
          <span>Source</span>
          <span>Leader</span>
          <span>Next Action</span>
        </div>
        <div v-if="competitorComparisonRows.length === 0" class="comparison-empty">
          No competitor records match this filter. Hermes will keep researching twice daily and stage source-backed
          findings for review.
        </div>
        <div
          v-for="row in competitorComparisonRows"
          :key="row.id"
          class="comparison-grid-row"
          :class="row.evidenceState.toLowerCase().replace(/[^a-z0-9]+/g, '-')"
        >
          <strong>{{ row.competitor }}</strong>
          <span>{{ row.product }}</span>
          <span class="verify-pill">{{ row.price }}</span>
          <span class="verify-pill">{{ row.marketShare }}</span>
          <span class="verify-pill">{{ row.revenue }}</span>
          <span class="verify-pill">{{ row.yoyGrowth }}</span>
          <span class="verify-pill">{{ row.traffic }}</span>
          <span class="verify-pill">{{ row.rating }}</span>
          <span>{{ row.lastUpdated }}</span>
          <span class="confidence-pill" :class="row.evidenceState.toLowerCase().replace(/[^a-z0-9]+/g, '-')">{{ row.confidence }}</span>
          <span class="comparison-source-cell">
            <a v-if="row.sourceUrl" :href="row.sourceUrl" target="_blank" rel="noopener noreferrer">{{ row.source }}</a>
            <span v-else>{{ row.source }}</span>
            <small>{{ row.evidenceState }}</small>
          </span>
          <span class="leader-badge-stack">
            <small v-for="badge in row.badges" :key="badge">{{ badge }}</small>
            <em v-if="row.badges.length === 0">No source-backed leader badge</em>
          </span>
          <span class="weakness-label">{{ row.nextAction }}</span>
        </div>
      </div>
    </section>

    <details class="reference-details">
      <summary>
        <span>Reference templates, charts, and manual evidence tools</span>
        <small>Open only when you need the screenshot templates, PDF reference rows, source pack, or manual competitor record form.</small>
      </summary>

    <section class="screenshot-competitor-template" aria-label="Reference competitor dashboard template">
      <div class="template-hero">
        <div>
          <p class="eyebrow">Reference only template</p>
          <h3>Competitors Tab Template</h3>
          <p>
            Reference only. Not source-backed. Use Trusted Sources / Research Review to verify before use.
            The screenshot-style board stays secondary; the primary competitor table above uses imported intelligence,
            approved assumptions, or safe review-gated empty states.
          </p>
        </div>
        <RouterLink class="template-link" :to="{ name: 'hermes.researchResultReview' }">Review competitor evidence</RouterLink>
      </div>

      <div class="template-kpi-strip">
        <article v-for="kpi in screenshotCompetitorKpis" :key="kpi.label" class="template-kpi-card">
          <strong>{{ autoVerifyText(kpi.value) }}</strong>
          <span>{{ kpi.label }}</span>
          <small class="status-badge" :class="statusClass(kpi.status)">{{ displayEvidenceStatus(kpi.status) }}</small>
          <p>{{ kpi.note }}</p>
        </article>
      </div>

      <section class="template-panel competitor-metrics-panel" aria-label="Competitor product price share revenue growth table">
        <div class="template-panel-title">
          <div>
            <h3>Competitor Product / Price / Share / Revenue / Growth</h3>
            <p>
              One table for the numbers you asked for. Hermes fills cells from trusted-source output when available;
              unsupported or sensitive values stay out of dashboard truth instead of showing fake figures.
            </p>
          </div>
          <RouterLink class="template-link" :to="{ name: 'hermes.trustedSources' }">Source Autopilot</RouterLink>
        </div>
        <div class="competitor-metrics-table">
          <div class="competitor-metrics-row head">
            <span>Competitor</span><span>Product focus</span><span>Price/kg</span><span>Market share</span><span>Revenue</span><span>Yearly growth</span><span>Source</span><span>Status</span><span>Next Hermes action</span>
          </div>
          <div v-for="row in competitorMetricsRows" :key="row.id" class="competitor-metrics-row">
            <strong>{{ row.competitor }}</strong>
            <span>{{ row.productFocus }}</span>
            <span class="verify-pill">{{ row.priceKg }}</span>
            <span class="verify-pill">{{ row.marketShare }}</span>
            <span class="verify-pill">{{ row.revenue }}</span>
            <span class="verify-pill">{{ row.yearlyGrowth }}</span>
            <a v-if="row.sourceUrl" :href="row.sourceUrl" target="_blank" rel="noopener noreferrer">{{ row.source }}</a>
            <span v-else>{{ row.source }}</span>
            <span class="status-badge" :class="statusClass(row.evidenceStatus)">{{ displayEvidenceStatus(row.evidenceStatus) }}</span>
            <span class="weakness-label">{{ row.nextAction }}</span>
          </div>
        </div>
      </section>

      <div class="template-product-grid">
        <article v-for="family in screenshotProductFamilies" :key="family.title" class="template-panel product-family-panel">
          <div class="template-panel-title">
            <h3>{{ family.title }}</h3>
            <span>{{ family.subtitle }}</span>
          </div>
          <div class="template-product-row head">
            <span>Product</span><span>Form</span><span>Dosing</span><span>pH</span><span>Application</span><span>Status</span>
          </div>
          <div v-for="row in family.rows" :key="`${family.title}-${row.product}`" class="template-product-row">
            <strong>{{ row.product }}</strong>
            <span>{{ autoVerifyText(row.form) }}</span>
            <span>{{ autoVerifyText(row.dosing) }}</span>
            <span>{{ autoVerifyText(row.ph) }}</span>
            <span>{{ row.application }}</span>
            <span class="status-badge" :class="statusClass(row.status)">{{ displayEvidenceStatus(row.status) }}</span>
          </div>
        </article>
      </div>

      <section class="template-panel source-backed-landscape" aria-label="Source-backed competitor landscape">
        <div class="template-panel-title">
          <div>
            <h3>Competitor Landscape - China Softener Market</h3>
            <p>Public-source competitor presence; unsupported shares and prices stay queued for source review.</p>
          </div>
          <NButton size="small" secondary @click="syncCompetitorsNow">Sync / stage review</NButton>
        </div>
        <div class="template-landscape-table">
          <div class="template-landscape-row head">
            <span>Competitor</span><span>HQ</span><span>Share</span><span>Price/kg</span><span>Strength</span><span>Weakness / gap</span><span>Source</span>
          </div>
          <div v-for="row in sourceBackedCompetitorTemplateRows" :key="row.competitor" class="template-landscape-row">
            <strong>{{ row.competitor }}</strong>
            <span>{{ row.hq }}</span>
            <span class="verify-pill">{{ autoVerifyText(row.share) }}</span>
            <span class="verify-pill">{{ autoVerifyText(row.price) }}</span>
            <span>{{ row.strength }}</span>
            <span class="weakness-label">{{ row.weakness }}</span>
            <a :href="row.sourceUrl" target="_blank" rel="noopener noreferrer">{{ row.sourceTitle }}</a>
          </div>
        </div>
      </section>

      <section class="template-panel source-backed-share-panel" aria-label="Competitor market share evidence chart">
        <div class="template-panel-title">
          <div>
            <h3>Competitor Market Share</h3>
            <p>No market-share bars are treated as facts until source-backed evidence is approved.</p>
          </div>
          <RouterLink class="template-link" :to="{ name: 'hermes.marketIntelligence' }">Open Market Intelligence</RouterLink>
        </div>
        <div v-for="row in sourceBackedCompetitorTemplateRows" :key="`${row.competitor}-share`" class="template-share-row">
          <span>{{ row.competitor }}</span>
          <div class="template-share-track"><i></i></div>
          <strong>{{ autoVerifyingText }}</strong>
        </div>
      </section>

      <div class="template-source-grid">
        <article v-for="source in competitorSourcePack" :key="source.url" class="template-source-card">
          <h4>{{ source.title }}</h4>
          <p>{{ source.detail }}</p>
          <a :href="source.url" target="_blank" rel="noopener noreferrer">Open source</a>
        </article>
      </div>

      <section class="template-panel research-queue-panel" aria-label="Competitor verification queue">
        <div class="template-panel-title">
          <h3>Competitor Verification Queue</h3>
          <span>Hermes checks twice daily</span>
        </div>
        <div class="queue-list">
          <span v-for="item in competitorResearchQueue" :key="item">{{ item }}</span>
        </div>
      </section>
    </section>

    <section class="template-panel pdf-competitor-pack" aria-label="User PDF competitor reference tables">
      <div class="template-panel-title">
        <div>
          <h3>User PDF Competitor / Importer Tables</h3>
          <p>
            These rows reproduce the PDF you provided. Company presence is useful for research, but import volumes,
            supplier names, price, capacity, and market-share values stay in source review until a
            source title plus URL/date is attached.
          </p>
        </div>
        <NButton size="small" secondary @click="createGenericCompetitorTask('PDF competitor table verification', 'Verify Chinese distributor list, global ester-quat manufacturer capacity, and market-share figures from source-backed documents')">
          Verify PDF tables
        </NButton>
      </div>

      <div class="pdf-competitor-table">
        <div class="pdf-competitor-row head">
          <span>Company</span><span>HQ</span><span>Focus</span><span>Scale</span><span>Relevance</span><span>Status</span>
        </div>
        <div v-for="row in pdfChineseDistributorRows" :key="row.company" class="pdf-competitor-row">
          <strong>{{ row.company }}</strong>
          <span>{{ row.hq }}</span>
          <span>{{ row.focus }}</span>
          <span>{{ row.scale }}</span>
          <span>{{ row.relevance }}</span>
          <span class="verify-pill">User Provided</span>
        </div>
      </div>
      <p class="pdf-source-note">
        PDF note: company-specific import data, exact volumes, supplier names, and per-shipment prices require a paid China Customs database such as Panjiva, ImportGenius, or Descartes Datamyne.
      </p>

      <div class="pdf-share-table">
        <div class="pdf-share-row head">
          <span>Rank</span><span>Manufacturer</span><span>HQ</span><span>Capacity</span><span>Share</span><span>Status</span>
        </div>
        <div v-for="row in pdfGlobalManufacturerShareRows" :key="row.manufacturer" class="pdf-share-row">
          <strong>{{ row.rank }}</strong>
          <span>{{ row.manufacturer }}</span>
          <span>{{ row.hq }}</span>
          <span>{{ row.capacity }}</span>
          <span>{{ row.share }}</span>
          <span class="verify-pill">{{ autoVerifyingText }}</span>
        </div>
      </div>
    </section>

    <section class="global-competitor-analysis" aria-label="Global competitor analysis">
      <div class="template-hero">
        <div>
          <p class="eyebrow">Global competitor analysis</p>
          <h3>Supplier Types, Strategic Threats, and Evidence Gaps</h3>
          <p>
            This analysis separates confirmed public-source facts from still-missing market-share, price, and
            product-equivalence evidence. It should guide research and sales positioning, not replace verified proof.
          </p>
        </div>
        <NButton size="small" type="primary" secondary @click="createGenericCompetitorTask('Global competitor analysis', 'Verify competitor categories, product equivalents, price evidence, and source-backed market-share gaps')">
          Create competitor research task
        </NButton>
      </div>

      <div class="competitor-category-grid">
        <article v-for="category in competitorAnalysisCategories" :key="category.title">
          <h4>{{ category.title }}</h4>
          <strong>{{ category.competitors }}</strong>
          <p>{{ category.whatToLearn }}</p>
          <small>Risk: {{ category.risk }}</small>
        </article>
      </div>

      <article class="template-panel">
        <div class="template-panel-title">
          <div>
            <h3>Global Competitor Matrix</h3>
            <p>Source-backed public facts are separated from research gaps. Price, market share, revenue, and growth remain queued for source review.</p>
          </div>
        </div>
        <div class="global-competitor-table">
          <div class="global-competitor-row head">
            <span>Company / group</span><span>Category</span><span>Source-backed fact</span><span>Strategic threat</span><span>Evidence gaps</span><span>Next action</span><span>Status</span><span>Source</span>
          </div>
          <div v-for="row in globalCompetitorMatrixRows" :key="row.company" class="global-competitor-row">
            <strong>{{ row.company }}</strong>
            <span>{{ row.category }}</span>
            <span>{{ row.sourceBackedFact }}</span>
            <span>{{ row.strategicThreat }}</span>
            <span class="weakness-label">{{ row.evidenceGaps }}</span>
            <NButton size="tiny" secondary @click="createGenericCompetitorTask(row.company, row.nextAction)">
              {{ row.nextAction }}
            </NButton>
            <span class="status-badge" :class="statusClass(row.status)">{{ row.status }}</span>
            <span>{{ row.source }}</span>
          </div>
        </div>
      </article>
    </section>

    <section class="product-context-panel" aria-label="Product context panel">
      <div>
        <h3>Product Context Panel</h3>
        <p>Brochure-backed product context only. Missing form, dosing, pH, and application data stays queued for source review.</p>
      </div>
      <div class="product-context-row head">
        <span>Product</span><span>Form / Type</span><span>Dosing</span><span>pH</span><span>Application</span><span>Evidence Status</span>
      </div>
      <div v-for="row in productContextRows" :key="row.product" class="product-context-row">
        <span>{{ row.product }}</span>
        <span>{{ autoVerifyText(row.formType) }}</span>
        <span>{{ autoVerifyText(row.dosing) }}</span>
        <span>{{ autoVerifyText(row.ph) }}</span>
        <span>{{ row.application }}</span>
        <span class="status-badge to-verify">{{ displayEvidenceStatus(row.evidenceStatus) }}</span>
      </div>
    </section>

    <section class="competitor-form" aria-label="Add competitor record">
      <div>
        <h3>Add competitor evidence</h3>
        <p>Saved locally in this browser workspace. Unknown numbers stay blank of claims until a usable source is attached.</p>
      </div>
      <label>Company<input v-model="competitorForm.companyName" type="text" placeholder="Company name" /></label>
      <label>Region<input v-model="competitorForm.countryRegion" type="text" placeholder="Country / region" /></label>
      <label>Product equivalent<input v-model="competitorForm.productEquivalent" type="text" placeholder="Equivalent product" /></label>
      <label>Active content<input v-model="competitorForm.activeContent" type="text" placeholder="Active content" /></label>
      <label v-if="!redactSensitiveFields">Pricing evidence<input v-model="competitorForm.pricingEvidence" type="text" placeholder="Quote, source, or Missing" /></label>
      <label v-else>Pricing evidence<input type="text" value="Restricted" disabled /></label>
      <label>Certifications<input v-model="competitorForm.certifications" type="text" placeholder="Source review needed" /></label>
      <label>Distribution<input v-model="competitorForm.distributionPresence" type="text" placeholder="Source review needed" /></label>
      <label>Market share<input v-model="competitorForm.marketShare" type="text" placeholder="Leave blank unless sourced" /></label>
      <label>Revenue<input v-model="competitorForm.revenue" type="text" placeholder="Source review needed" /></label>
      <label>Yearly growth<input v-model="competitorForm.yearlyGrowth" type="text" placeholder="Source review needed" /></label>
      <label>
        Evidence status
        <select v-model="competitorForm.evidenceStatus">
          <option value="To Verify">No source-backed value yet</option>
          <option>Missing</option>
          <option>Assumption</option>
          <option>Powerful Assumption</option>
          <option>Source-backed</option>
          <option>User Approved</option>
          <option>Verified</option>
        </select>
      </label>
      <label>Source title<input v-model="competitorForm.sourceTitle" type="text" placeholder="Source title" /></label>
      <label>Source URL<input v-model="competitorForm.sourceUrl" type="url" placeholder="https://..." /></label>
      <label>Source date<input v-model="competitorForm.sourceDate" type="date" /></label>
      <label class="wide">Notes<input v-model="competitorForm.notes" type="text" placeholder="Evidence notes" /></label>
      <NButton secondary type="primary" @click="addCompetitor">{{ competitorSubmitLabel }}</NButton>
      <NButton v-if="editingCompetitorId" secondary @click="resetCompetitorForm">Cancel edit</NButton>
    </section>

    <section class="competitor-table" aria-label="Competitor list">
      <h3>Competitor Landscape Table</h3>
      <div class="competitor-row head">
        <span>Competitor</span><span>HQ / Country</span><span>Market Share</span><span>Price/kg</span><span>Strength</span><span>Weakness</span><span>Source</span><span>Evidence Status</span><span>Action</span>
      </div>
      <p v-if="collapsedCompetitors.length === 0" class="empty-state">
        No competitor records saved yet. Add sourced records above, or create research tasks for unknown competitors.
      </p>
      <div
        v-for="competitor in collapsedCompetitors"
        :key="competitor.id"
        class="competitor-row"
        :class="{ sourced: sourceIsUsable(competitor.source), verify: autoVerifyText(competitorMarketShareLabel(competitor)) === autoVerifyingText }"
      >
        <span>{{ competitor.companyName }}</span>
        <span>{{ competitor.countryRegion }}</span>
        <span class="market-share-label">{{ autoVerifyText(competitorMarketShareLabel(competitor)) }}</span>
        <span>{{ visibleSensitiveValue(competitor.pricingEvidence) }}</span>
        <span>{{ autoVerifyText(competitor.productVariations || competitor.productEquivalent) }}</span>
        <span class="weakness-label">{{ autoVerifyText(competitor.notes) }}</span>
        <span>
          {{ competitor.source?.title || 'Source search running' }}
          <small v-if="competitor.sourceCount > 1">+{{ competitor.sourceCount - 1 }} more</small>
        </span>
        <span class="status-badge" :class="competitor.evidenceStatus.toLowerCase().replace(/\s+/g, '-')">{{ displayEvidenceStatus(competitor.evidenceStatus) }}</span>
        <span class="row-actions">
          <NButton size="tiny" secondary @click="startEditCompetitor(primaryCompetitorRecord(competitor))">
            Edit
          </NButton>
          <NButton size="tiny" secondary @click="stageCompetitorForReview(competitor)">
            Stage for review
          </NButton>
          <NButton size="tiny" secondary type="primary" :loading="creating === competitor.companyName" @click="createResearchTask(competitor)">
            Research competitor
          </NButton>
          <NButton size="tiny" quaternary type="error" @click="removeCompetitor(competitor)">
            Remove
          </NButton>
        </span>
      </div>
    </section>

    <section class="market-share-panel" aria-label="Competitor market share chart">
      <div>
        <h3>Competitor Market Share Chart</h3>
        <p>Source-backed bars are green; assumption bars are amber. Unknown shares do not become fake bars.</p>
      </div>
      <p v-if="marketShareChartRows.length === 0" class="empty-state">
        No source-backed competitor share data yet. Sourced competitor-share claims are staged for review before charting.
      </p>
      <div v-for="row in marketShareChartRows" :key="row.competitor.id" class="share-row" :class="{ assumption: row.isAssumption }">
        <span>{{ row.label }}</span>
        <div class="share-track">
          <i :style="{ width: `${Math.min(row.numericShare, 100)}%` }"></i>
        </div>
        <strong>{{ row.shareLabel }}</strong>
      </div>
    </section>

    <section class="competitor-actions" aria-label="Competitor actions">
      <NButton size="small" secondary @click="createGenericCompetitorTask('Competitor to verify', 'Research competitor action')">
        Research Competitor
      </NButton>
      <NButton size="small" secondary @click="message.info('Add Source by editing or adding a competitor evidence record above')">Add Source</NButton>
      <NButton size="small" secondary @click="createGenericCompetitorTask('Competitor verification task', 'Create verification task action')">
        Create Verification Task
      </NButton>
      <RouterLink class="header-link" :to="{ name: 'hermes.researchResultReview' }">Add to Investor Review</RouterLink>
      <RouterLink class="header-link" :to="{ name: 'hermes.feasibility' }">Compare with CWAS/CWMS</RouterLink>
      <NButton size="small" secondary @click="syncCompetitorsNow">Schedule Deeper Research</NButton>
    </section>

    <section class="detail-grid">
      <article>
        <h3>Product equivalents</h3>
        <p>Hermes verifies product active content and source documents automatically; unresolved items stay out of investor truth.</p>
      </article>
      <article>
        <h3>Pricing evidence</h3>
        <p>Use quotes, invoices, screenshots, distributor proof, or cited public sources. No fake percentages.</p>
      </article>
      <article>
        <h3>Strengths / weaknesses</h3>
        <p>Use reviewed sources. Unsourced claims stay queued for source review instead of becoming dashboard truth.</p>
      </article>
      <article>
        <h3>Research jobs</h3>
        <p>Use Kanban tasks for competitor research until scheduled research jobs are safely integrated.</p>
      </article>
    </section>
    </details>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.competitor-view {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.product-context-panel,
.competitor-form,
.competitor-table,
.market-share-panel,
.competitor-actions,
.detail-grid article {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header,
.product-context-panel,
.competitor-form,
.competitor-table,
.market-share-panel,
.competitor-actions,
.detail-grid article {
  position: relative;
  overflow: hidden;
}

.product-context-panel::before,
.competitor-form::before,
.competitor-table::before,
.market-share-panel::before,
.competitor-actions::before,
.detail-grid article::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: $executive-strip;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  padding: 18px;
}

.competitor-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin: 14px 0;
  padding: 16px;

  > div,
  .wide {
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

.eyebrow {
  margin: 0 0 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.page-copy,
.detail-grid p {
  color: $text-secondary;
  line-height: 1.55;
}

.header-link,
.detail-grid a {
  color: $accent-info;
  font-weight: 800;
}

.refresh-card {
  display: grid;
  gap: 6px;
  min-width: 240px;
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

.comparison-command-panel,
.reference-details {
  border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
  border-radius: $radius-sm;
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.08), transparent 38%),
    $bg-card;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.16);
}

.comparison-command-panel {
  display: grid;
  gap: 14px;
  margin: 14px 0;
  padding: 16px;
  overflow: hidden;
}

.comparison-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 24px;
    letter-spacing: 0.02em;
  }

  p {
    max-width: 920px;
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.comparison-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.comparison-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: end;
  border-top: 1px solid $border-color;
  padding-top: 12px;

  label {
    display: grid;
    gap: 6px;
    min-width: min(260px, 100%);
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  select {
    min-height: 34px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-input;
    color: $text-primary;
    padding: 7px 10px;
  }
}

.comparison-filter-note {
  margin-left: auto;
  border: 1px solid rgba(var(--accent-info-rgb), 0.32);
  border-radius: 999px;
  padding: 7px 10px;
  color: $accent-info;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.comparison-table-wrap {
  overflow-x: auto;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: rgba(0, 0, 0, 0.16);
}

.comparison-grid-row {
  display: grid;
  grid-template-columns:
    minmax(170px, 0.95fr)
    minmax(220px, 1.15fr)
    minmax(130px, 0.62fr)
    minmax(140px, 0.68fr)
    minmax(140px, 0.68fr)
    minmax(140px, 0.68fr)
    minmax(130px, 0.62fr)
    minmax(120px, 0.58fr)
    minmax(130px, 0.64fr)
    minmax(130px, 0.64fr)
    minmax(190px, 0.95fr)
    minmax(180px, 0.95fr)
    minmax(280px, 1.4fr);
  gap: 10px;
  align-items: center;
  min-width: 1900px;
  padding: 11px 14px;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  &:first-child {
    border-top: 0;
  }

  &.head {
    color: $accent-primary;
    font-size: 11px;
    font-weight: 950;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  &.verified {
    background: rgba(var(--success-rgb), 0.04);
  }

  &.review-needed {
    background: rgba(var(--warning-rgb), 0.04);
  }

  &.restricted {
    background: rgba(var(--error-rgb), 0.04);
  }

  > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.comparison-sort-button {
  width: fit-content;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-align: left;
  text-transform: inherit;

  &:hover {
    color: $accent-info;
  }
}

.comparison-empty {
  min-width: 760px;
  padding: 16px;
  color: $text-secondary;
}

.confidence-pill {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  border: 1px solid rgba(var(--accent-info-rgb), 0.34);
  border-radius: 999px;
  padding: 3px 8px;
  color: $accent-info;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;

  &.verified {
    border-color: rgba(var(--success-rgb), 0.4);
    color: $success;
  }

  &.review-needed {
    border-color: rgba(var(--warning-rgb), 0.4);
    color: $warning;
  }

  &.restricted {
    border-color: rgba(var(--error-rgb), 0.4);
    color: $error;
  }
}

.comparison-source-cell {
  display: grid;
  gap: 4px;

  a {
    color: $accent-info;
    font-weight: 850;
    text-decoration: none;
  }

  small {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.leader-badge-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;

  small {
    border: 1px solid rgba(var(--accent-primary-rgb), 0.38);
    border-radius: 999px;
    padding: 3px 7px;
    color: $accent-primary;
    font-size: 10px;
    font-weight: 900;
  }

  em {
    color: $text-muted;
    font-size: 11px;
    font-style: normal;
  }
}

.reference-details {
  margin: 14px 0;

  > summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
    cursor: pointer;
    padding: 15px 16px;
    color: $text-primary;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    span {
      color: $accent-primary;
      font-size: 14px;
      font-weight: 950;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    small {
      color: $text-muted;
      line-height: 1.4;
    }
  }

  &[open] {
    padding: 0 14px 14px;

    > summary {
      margin: 0 -14px 12px;
      border-bottom: 1px solid $border-color;
    }
  }
}

.screenshot-competitor-template {
  display: grid;
  gap: 14px;
  margin: 14px 0;
}

.global-competitor-analysis {
  display: grid;
  gap: 14px;
  margin: 14px 0;
}

.template-hero,
.template-panel,
.template-kpi-card,
.template-source-card {
  border: 1px solid rgba(var(--accent-info-rgb), 0.24);
  border-radius: $radius-sm;
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.08), transparent 36%),
    $bg-card;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.16);
}

.template-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
  padding: 16px;
  border-color: rgba(var(--accent-primary-rgb), 0.38);

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 24px;
  }

  p {
    margin: 8px 0 0;
    max-width: 880px;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.template-link,
.template-source-card a,
.template-landscape-row a {
  color: $accent-info;
  font-weight: 900;
  text-decoration: none;
}

.template-kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.template-kpi-card {
  min-height: 150px;
  padding: 18px;
  border-color: rgba(var(--accent-primary-rgb), 0.32);

  strong {
    display: block;
    color: $accent-primary;
    font-size: clamp(24px, 3vw, 36px);
    line-height: 1.05;
  }

  span {
    display: block;
    margin-top: 10px;
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

.template-product-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.template-panel {
  position: relative;
  overflow: hidden;
  padding: 16px;

  &::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: $executive-strip;
  }
}

.template-panel-title {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
  border-bottom: 1px solid $border-color;
  padding-bottom: 12px;

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 17px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  p {
    margin: 6px 0 0;
    color: $text-secondary;
    line-height: 1.45;
  }

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.template-product-row,
.template-landscape-row {
  display: grid;
  gap: 10px;
  align-items: center;
  border-top: 1px solid $border-color;
  padding: 10px 0;
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

.template-product-row {
  grid-template-columns: minmax(120px, 1fr) repeat(4, minmax(80px, 0.8fr)) minmax(90px, auto);
}

.template-landscape-table {
  overflow-x: auto;
}

.competitor-metrics-table {
  overflow-x: auto;
}

.competitor-metrics-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.95fr) minmax(210px, 1.2fr) minmax(130px, 0.8fr) minmax(130px, 0.8fr) minmax(130px, 0.8fr) minmax(130px, 0.8fr) minmax(170px, 0.9fr) minmax(140px, 0.8fr) minmax(260px, 1.4fr);
  gap: 10px;
  align-items: center;
  min-width: 1580px;
  padding: 10px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  &.head {
    border-top: 0;
    color: $accent-primary;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  a {
    color: $accent-info;
    font-weight: 850;
    text-decoration: none;
  }
}

.template-landscape-row {
  grid-template-columns: minmax(150px, 1fr) minmax(90px, 0.65fr) minmax(95px, 0.65fr) minmax(95px, 0.65fr) minmax(180px, 1.15fr) minmax(200px, 1.25fr) minmax(160px, 0.95fr);
  min-width: 1120px;
}

.verify-pill,
.status-badge {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
  border-radius: 999px;
  padding: 3px 8px;
  color: $accent-primary;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.status-badge.source-backed {
  border-color: rgba(var(--success-rgb), 0.36);
  color: $success;
}

.status-badge.reference-only {
  border-color: rgba(var(--accent-info-rgb), 0.36);
  color: $accent-info;
}

.status-badge.to-verify {
  color: $accent-primary;
}

.template-share-row {
  display: grid;
  grid-template-columns: minmax(130px, 0.8fr) minmax(180px, 1fr) minmax(90px, auto);
  gap: 12px;
  align-items: center;
  padding: 9px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  strong {
    color: $accent-primary;
    font-size: 12px;
  }
}

.template-share-track {
  height: 12px;
  border: 1px dashed rgba(var(--accent-primary-rgb), 0.38);
  border-radius: 999px;
  background: rgba(var(--text-muted-rgb), 0.12);
  overflow: hidden;

  i {
    display: block;
    width: 8%;
    height: 100%;
    border-radius: inherit;
    background: repeating-linear-gradient(
      90deg,
      rgba(var(--accent-primary-rgb), 0.42),
      rgba(var(--accent-primary-rgb), 0.42) 6px,
      transparent 6px,
      transparent 12px
    );
  }
}

.template-source-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.template-source-card {
  padding: 14px;

  h4 {
    margin: 0 0 8px;
    color: $text-primary;
  }

  p {
    margin: 0 0 10px;
    color: $text-secondary;
    line-height: 1.45;
  }
}

.queue-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  span {
    border: 1px solid $border-color;
    border-radius: 999px;
    padding: 6px 10px;
    color: $text-secondary;
    font-size: 12px;
    font-weight: 800;
  }
}

.competitor-category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;

  article {
    display: grid;
    gap: 8px;
    padding: 14px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.26);
    border-radius: $radius-sm;
    background:
      linear-gradient(145deg, rgba(var(--accent-info-rgb), 0.08), transparent 44%),
      $bg-card;
  }

  h4 {
    margin: 0;
    color: $text-primary;
  }

  strong {
    color: $accent-primary;
  }

  p,
  small {
    color: $text-secondary;
    line-height: 1.45;
  }
}

.global-competitor-table {
  overflow-x: auto;
}

.global-competitor-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(190px, 1fr) minmax(260px, 1.35fr) minmax(240px, 1.25fr) minmax(230px, 1.2fr) minmax(210px, 1fr) minmax(120px, auto) minmax(170px, 0.9fr);
  gap: 10px;
  align-items: center;
  min-width: 1580px;
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

.product-context-panel,
.market-share-panel,
.competitor-actions {
  margin: 14px 0;
  padding: 16px;
}

.product-context-panel h3,
.market-share-panel h3,
.competitor-table h3 {
  margin: 0 0 8px;
  color: $text-primary;
}

.product-context-panel p,
.market-share-panel p {
  color: $text-secondary;
}

.product-context-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) repeat(4, minmax(90px, 0.8fr)) minmax(110px, auto);
  gap: 10px;
  align-items: center;
  padding: 9px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;
  font-size: 12px;

  &.head {
    color: $accent-primary;
    font-weight: 900;
    text-transform: uppercase;
  }

  > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.competitor-table {
  margin: 14px 0;
  padding: 16px;
  overflow-x: auto;
}

.competitor-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(100px, 0.75fr) minmax(120px, 0.9fr) minmax(110px, 0.85fr) minmax(140px, 1fr) minmax(140px, 1fr) minmax(120px, 0.9fr) minmax(110px, auto) minmax(220px, 1.15fr);
  gap: 10px;
  align-items: center;
  min-width: 1040px;
  padding: 10px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  &.head {
    border-top: 0;
    color: $accent-primary;
    font-size: 12px;
    font-weight: 900;
  }

  &.sourced {
    border-color: rgba(var(--success-rgb), 0.28);
  }

  &.verify {
    background: rgba(var(--accent-primary-rgb), 0.04);
  }
}

.weakness-label {
  color: $error;
  font-weight: 700;
}

.market-share-label {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  padding: 3px 8px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.36);
  border-radius: 999px;
  color: $accent-primary;
  font-size: 11px;
  font-weight: 900;
}

.competitor-row .status-badge {
  width: fit-content;
  padding: 3px 8px;
  font-size: 10px;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.empty-state {
  border-top: 1px solid $border-color;
  margin: 0;
  padding: 12px 0 0;
  color: $text-secondary;
}

.share-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(180px, 2fr) minmax(120px, auto);
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  &.assumption .share-track i {
    background: $warning;
  }

  strong {
    color: $accent-primary;
  }
}

.share-track {
  height: 10px;
  border-radius: 999px;
  background: rgba(var(--text-muted-rgb), 0.25);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: $success;
  }
}

.competitor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;

  article {
    padding: 16px;
  }

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }
}

.pdf-competitor-pack {
  display: grid;
  gap: 12px;
}

.pdf-competitor-table,
.pdf-share-table {
  display: grid;
  gap: 6px;
  overflow-x: auto;
}

.pdf-competitor-row {
  display: grid;
  grid-template-columns: minmax(190px, 1.05fr) minmax(150px, 0.85fr) minmax(190px, 1fr) minmax(130px, 0.65fr) minmax(220px, 1.15fr) minmax(120px, auto);
  gap: 9px;
  align-items: center;
  min-width: 980px;
  padding: 9px 10px;
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

.pdf-share-row {
  display: grid;
  grid-template-columns: 70px minmax(210px, 1fr) minmax(130px, 0.7fr) minmax(120px, 0.65fr) minmax(100px, 0.55fr) minmax(110px, auto);
  gap: 9px;
  align-items: center;
  min-width: 740px;
  padding: 9px 10px;
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

.pdf-source-note {
  margin: 0;
  color: $text-secondary;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 940px) {
  .page-header,
  .template-hero,
  .comparison-hero,
  .template-product-grid,
  .product-context-row,
  .competitor-row {
    grid-template-columns: 1fr;
    min-width: 0;
  }

  .comparison-actions {
    justify-content: flex-start;
  }

  .comparison-filter-note {
    margin-left: 0;
  }

  .template-kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .template-panel-title {
    display: grid;
  }

  .template-product-row,
  .template-landscape-row,
  .pdf-competitor-row,
  .pdf-share-row,
  .share-row {
    grid-template-columns: 1fr;
    min-width: 0;
  }
}

@media (max-width: 560px) {
  .competitor-view {
    padding: 12px;
  }

  .comparison-command-panel {
    padding: 12px;
  }

  .template-kpi-strip {
    grid-template-columns: 1fr;
  }

  .template-kpi-card {
    min-height: auto;
  }
}
</style>
