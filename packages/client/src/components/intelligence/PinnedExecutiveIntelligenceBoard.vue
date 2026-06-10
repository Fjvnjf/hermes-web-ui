<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NAlert, NButton, NTag, useMessage } from 'naive-ui'
import { getFrontendAccessRole, shouldRedactForEmployee } from '@/utils/accessControl'
import {
  EXPORT_MARKET_STORAGE_KEY,
  RAW_MATERIALS_STORAGE_KEY,
  type ExportMarketRecord,
  type RawMaterialRecord,
} from '@/utils/intelligenceWorkflow'
import {
  buildInvestmentBreakdownRows,
  buildInvestorEconomicsKpis,
  claimStatusOrToVerify,
  competitorMarketShare,
  defaultExecutiveRefreshState,
  EXECUTIVE_INTELLIGENCE_STORAGE_KEY,
  EXECUTIVE_REFRESH_JOB_NAME,
  EXECUTIVE_REFRESH_SCHEDULE,
  marketClaimValue,
  nextTwiceDailyRefresh,
  type ExecutiveKpi,
  type ExecutiveRefreshState,
} from '@/utils/executiveIntelligence'
import {
  displayEvidenceStatus,
  displayUnresolvedValue,
  formatSourceReference,
  normalizedMarketClaimStatus,
  sourceIsUsable,
  type IntelligenceEvidenceStatus,
  type MarketClaim,
  type SourceReference,
} from '@/utils/investorIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { useJobsStore } from '@/stores/hermes/jobs'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { listRecentCaptureActivities } from '@/composables/useSessionCapture'

const props = withDefaults(defineProps<{
  compact?: boolean
}>(), {
  compact: false,
})

const message = useMessage()
const intelligence = useFeasibilityIntelligence()
const kanbanStore = useKanbanStore()
const jobsStore = useJobsStore()

const refreshState = ref<ExecutiveRefreshState>(defaultExecutiveRefreshState())
const rawMaterials = ref<RawMaterialRecord[]>([])
const exportMarkets = ref<ExportMarketRecord[]>([])
const savingAction = ref('')

const role = computed(() => getFrontendAccessRole())
const isOwner = computed(() => role.value === 'owner')
const isInvestorViewer = computed(() => role.value === 'investor_viewer')
const isDeveloperAdmin = computed(() => role.value === 'developer_admin')
const isRestrictedBusinessRole = computed(() => !isOwner.value && !isInvestorViewer.value && !isDeveloperAdmin.value)
const redactsSensitiveValues = computed(() => shouldRedactForEmployee(role.value) || role.value !== 'owner')

const latestFinancialModel = intelligence.latestFinancialModel
const nextUpdateLabel = computed(() => formatDateTime(refreshState.value.nextRun))
const economicsKpis = computed(() => buildInvestorEconomicsKpis(latestFinancialModel.value, nextUpdateLabel.value))
type DisplayExecutiveKpi = ExecutiveKpi & { displayStatus?: string }
const visibleEconomicsKpis = computed<DisplayExecutiveKpi[]>(() =>
  economicsKpis.value.map(item => displayExecutiveKpi(
    redactsSensitiveValues.value && item.sensitive
      ? {
          ...item,
          value: 'Restricted',
          evidenceStatus: 'Reference Only',
          displayStatus: 'Review required',
          sourceLabel: 'Owner/internal only',
        }
      : item,
  )),
)
const investmentBreakdown = computed(() => buildInvestmentBreakdownRows())

const marketSizeClaim = computed(() => findMarketClaim(['market size', 'demand', 'market value', 'consumption']))
const growthClaim = computed(() => findMarketClaim(['growth', 'cagr']))
const importDependenceClaim = computed(() => findMarketClaim(['import', 'dependence', 'dependency']))
const marketSegments = computed(() => intelligence.state.value.marketClaims.filter(canDisplayBoardMarketClaim).slice(0, 5))
const competitorRows = computed(() => {
  const records = intelligence.state.value.competitors
    .filter(canDisplayBoardCompetitorShare)
    .slice(0, 5)
  return records.map((competitor, index) => ({
    rank: String(index + 1),
    manufacturer: competitor.companyName || 'No approved competitor name',
    hq: competitor.countryRegion || 'No approved source-backed value',
    productEquivalent: competitor.productEquivalent || 'No approved source-backed value',
    capacity: 'Not published by cited source',
    marketShare: canDisplayBoardCompetitorShare(competitor)
      ? competitorMarketShare(
          competitor.marketShare,
          competitor.metricEvidence?.marketShare?.source || competitor.source,
          (competitor.metricEvidence?.marketShare?.evidenceStatus || competitor.evidenceStatus) as IntelligenceEvidenceStatus,
        )
      : 'No approved source-backed value',
    sourceLabel: boardSourceMetadata(competitor),
    evidenceStatus: canDisplayBoardCompetitorShare(competitor) ? competitor.evidenceStatus : 'To Verify',
  }))
})
const topCountries = computed(() => exportMarkets.value.filter(canDisplayStoredEvidenceRecord).slice(0, 4))
const topRawMaterials = computed(() => rawMaterials.value.filter(canDisplayStoredEvidenceRecord).slice(0, 4))
const recentCaptures = computed(() => listRecentCaptureActivities(3))
const openResearchJobs = computed(() => intelligence.state.value.researchJobs.slice(0, 4))
const pendingReviewItems = computed(() => intelligence.pendingResearchFindings.value.slice(0, 4))
const evidenceGaps = computed(() => intelligence.evidenceGaps.value.slice(0, 4))
const topRisks = computed(() => intelligence.riskRegisterItems.value.slice(0, 4))

const briefItems = computed(() => [
  `${recentCaptures.value.length} recent session capture item${recentCaptures.value.length === 1 ? '' : 's'}`,
  `${pendingReviewItems.value.length} research result${pendingReviewItems.value.length === 1 ? '' : 's'} pending review`,
  `${openResearchJobs.value.length} research job record${openResearchJobs.value.length === 1 ? '' : 's'}`,
  `${evidenceGaps.value.length} priority evidence gap${evidenceGaps.value.length === 1 ? '' : 's'}`,
])
const hasDailyBriefSource = computed(() =>
  recentCaptures.value.length > 0 ||
  pendingReviewItems.value.length > 0 ||
  openResearchJobs.value.length > 0,
)

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
    schedule: EXECUTIVE_REFRESH_SCHEDULE,
    scheduleDisplay: '09:00 and 21:00 local time',
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(EXECUTIVE_INTELLIGENCE_STORAGE_KEY, JSON.stringify(refreshState.value))
  }
}

function loadLocalIntelligenceSources() {
  if (typeof window === 'undefined') return
  rawMaterials.value = parseStoredArray<RawMaterialRecord>(RAW_MATERIALS_STORAGE_KEY)
  exportMarkets.value = parseStoredArray<ExportMarketRecord>(EXPORT_MARKET_STORAGE_KEY)
}

function parseStoredArray<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function findMarketClaim(keywords: string[]): MarketClaim | null {
  return intelligence.state.value.marketClaims.find(claim => {
    const haystack = `${claim.label} ${claim.value || ''}`.toLowerCase()
    return keywords.some(keyword => haystack.includes(keyword))
  }) || null
}

function marketMetric(label: string, claim: MarketClaim | null) {
  const useClaim = canDisplayBoardMarketClaim(claim)
  return {
    label,
    value: useClaim ? boardMarketClaimValue(claim) : 'No approved source-backed value',
    evidenceStatus: useClaim ? claimStatusOrToVerify(claim) : 'To Verify',
    sourceLabel: useClaim ? boardSourceMetadata(claim) : boardSourceMetadata(null),
  }
}

function boardMarketClaimValue(claim: MarketClaim | null): string {
  if (canDisplayBoardMarketClaim(claim)) return marketClaimValue(claim)
  return claim?.value?.trim() ? 'No approved source-backed value' : marketClaimValue(claim)
}

function canDisplayBoardMarketClaim(claim: MarketClaim | null): boolean {
  if (!claim?.value?.trim()) return false
  if (claim.reviewRequired) return false
  const status = normalizedMarketClaimStatus(claim)
  if (['Verified', 'Source-backed', 'Official Data', 'Trusted Source Auto-Updated', 'Supplier Evidence', 'Trade Proxy'].includes(status)) {
    return sourceIsUsable(claim.source)
  }
  return ['User Approved', 'Investor Approved', 'Approved Assumption'].includes(status)
}

function canDisplayBoardCompetitorShare(competitor: {
  marketShare?: string | null
  reviewRequired?: boolean
  metricEvidence?: { marketShare?: { source?: SourceReference | null, evidenceStatus?: string, reviewRequired?: boolean } }
  source?: SourceReference | null
  evidenceStatus?: string
}): boolean {
  if (!competitor.marketShare?.trim() || competitor.reviewRequired) return false
  const shareEvidence = competitor.metricEvidence?.marketShare
  if (shareEvidence?.reviewRequired) return false
  const status = String(shareEvidence?.evidenceStatus || competitor.evidenceStatus || '')
  if (['Approved Assumption', 'User Approved', 'Investor Approved'].includes(status)) return true
  return sourceIsUsable(shareEvidence?.source || competitor.source) &&
    ['Verified', 'Source-backed', 'Official Data', 'Trusted Source Auto-Updated'].includes(status)
}

type BoardMetadataRecord = {
  source?: SourceReference | null
  evidenceStatus?: string | null
  confidence?: string | null
  lastChecked?: string | null
  updatedAt?: string | null
  createdAt?: string | null
}

function boardSourceMetadata(record?: BoardMetadataRecord | null): string {
  const sourceLabel = record?.source?.title?.trim()
    ? formatSourceReference(record.source)
    : 'Trusted Sources / Research Review'
  const confidence = record?.confidence || 'review gated'
  const lastChecked = record?.lastChecked || record?.updatedAt || record?.createdAt || record?.source?.date || 'Not available'
  return `Source: ${sourceLabel} / Confidence: ${confidence} / Last checked: ${lastChecked} / Review: ${displayBoardStatus(record?.evidenceStatus || 'To Verify')}`
}

type BoardKpiMetadata = {
  sourceLabel: string
  evidenceStatus: string
  displayStatus?: string
  lastUpdated: string
}

function boardKpiSourceMetadata(item?: BoardKpiMetadata | null): string {
  if (!item) return boardSourceMetadata(null)
  const confidence = ['Verified', 'Source-backed', 'User Approved', 'Investor Approved'].includes(item.evidenceStatus)
    ? 'source attached'
    : 'owner review required'
  return [
    `Source: ${item.sourceLabel}`,
    `Confidence: ${confidence}`,
    `Last checked: ${item.lastUpdated || 'Not available'}`,
    `Review: ${displayBoardStatus('displayStatus' in item && item.displayStatus ? item.displayStatus : item.evidenceStatus)}`,
  ].join(' / ')
}

function displayBoardValue(value?: string | number | null): string {
  return displayUnresolvedValue(value)
}

function displayBoardStatus(status?: string | null): string {
  const normalized = String(status || '').trim()
  if (/^(pending review|review required)$/i.test(normalized)) return 'Review required'
  return displayEvidenceStatus(status)
}

function displayExecutiveKpi<T extends { key: string; label: string }>(item: T): T {
  const labels: Record<string, string> = {
    revenueTarget: 'Revenue Target',
    capacity: 'EQ Capacity MT/YR',
    projectIrr: 'Projected IRR',
    payback: 'Payback Period',
    blendedAsp: 'Blended ASP/MT',
    npv: 'NPV @ 12%',
  }
  return {
    ...item,
    label: labels[item.key] || item.label,
  }
}

const marketMetrics = computed(() => {
  const revenueKpi = visibleEconomicsKpis.value.find(item => item.key === 'revenueTarget') || null
  return [
    marketMetric('Market size / status', marketSizeClaim.value),
    marketMetric('Growth / status', growthClaim.value),
    marketMetric('Import dependence / status', importDependenceClaim.value),
    {
      label: 'Target revenue',
      value: revenueKpi?.value || 'No approved source-backed scenario',
      evidenceStatus: revenueKpi?.evidenceStatus || 'To Verify',
      sourceLabel: boardKpiSourceMetadata(revenueKpi),
    },
  ]
})

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function statusType(status: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (/^(pending review|review required)$/i.test(status)) return 'warning'
  if (status === 'Verified' || status === 'Source-backed' || status === 'User Approved' || status === 'Investor Approved') return 'success'
  if (status === 'Assumption' || status === 'Powerful Assumption' || status === 'Derived from Assumptions' || status === 'Reference Only') return 'warning'
  if (status === 'Missing' || status === 'To Verify') return 'warning'
  return 'info'
}

function canDisplayStoredEvidenceRecord(record: {
  evidenceStatus?: string | null
  source?: string | null
  sourceDate?: string | null
}): boolean {
  const status = String(record.evidenceStatus || '').trim()
  if (['User Approved', 'Investor Approved', 'Approved Assumption'].includes(status)) return true
  if (!['Verified', 'Source-backed', 'Official Data', 'Trusted Source Auto-Updated', 'Supplier Evidence', 'Market Reference'].includes(status)) return false
  return Boolean(record.source?.trim() && record.sourceDate?.trim())
}

function refreshSummaryText(): string {
  return [
    'Executive Intelligence Refresh draft',
    `Schedule metadata: ${refreshState.value.scheduleDisplay}`,
    `Investor readiness score: ${intelligence.readinessScore.value}%`,
    `Evidence gaps: ${intelligence.evidenceGaps.value.length}`,
    `Pending research review items: ${intelligence.pendingResearchFindings.value.length}`,
    `Financial model status: ${displayBoardStatus(latestFinancialModel.value?.evidenceStatus || 'To Verify')}`,
    `Market claims available: ${intelligence.state.value.marketClaims.length}`,
    `Competitor records available: ${intelligence.state.value.competitors.length}`,
    `Raw material records available locally: ${rawMaterials.value.length}`,
    `Export market records available locally: ${exportMarkets.value.length}`,
    '',
    'This draft must be reviewed in Research Result Review before changing investor-approved material.',
  ].join('\n')
}

async function createBoardTask(title: string, body: string, priority = 2) {
  savingAction.value = title
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title,
      body,
      priority,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    savingAction.value = ''
  }
}

function addBoardToInvestorReview(area: 'market' | 'financial' | 'presentation' = 'presentation') {
  const saved = intelligence.addResearchFinding({
    summary: refreshSummaryText(),
    keyClaim: 'Executive intelligence board needs source review',
    area,
    evidenceStatus: 'To Verify',
    confidence: 'medium',
    source: null,
    suggestedTask: 'Review executive intelligence board claims and attach source evidence before investor use.',
    suggestedInvestorMaterial: '',
    riskNote: 'This is a review draft. It is not investor-approved and must not be treated as verified.',
  })
  persistRefreshState({
    lastRun: new Date().toISOString(),
    nextRun: nextTwiceDailyRefresh(),
    lastStatus: 'Draft staged for Research Result Review',
    resultNeedsReviewCount: refreshState.value.resultNeedsReviewCount + 1,
    localOnly: true,
  })
  message.success(`Research review draft staged: ${saved.keyClaim}`)
}

async function syncNow() {
  savingAction.value = 'sync-now'
  try {
    addBoardToInvestorReview('presentation')
  } finally {
    savingAction.value = ''
  }
}

async function enableTwiceDailyRefresh() {
  savingAction.value = 'enable-refresh'
  const prompt = [
    'Executive Intelligence Refresh',
    'Refresh Last 24 Hours, raw material price intelligence, market intelligence, competitor intelligence, investor readiness, financial model status, pending evidence gaps, and presentation improvement suggestions.',
    'Do not mark claims Verified automatically.',
    'Write outputs as review-ready findings for Research Result Review before investor-approved material changes.',
    'Every claim/value must include evidence status and source requirements.',
  ].join('\n')
  try {
    const job = await jobsStore.createJob({
      name: EXECUTIVE_REFRESH_JOB_NAME,
      schedule: EXECUTIVE_REFRESH_SCHEDULE,
      prompt,
      deliver: 'local',
    })
    intelligence.addResearchJob({
      title: EXECUTIVE_REFRESH_JOB_NAME,
      question: 'What changed in executive feasibility intelligence since the previous refresh?',
      scope: 'Last 24 Hours, raw materials, market, competitors, investor readiness, IRR status, evidence gaps, and presentation improvements.',
      expectedOutput: 'A review-ready result for Research Result Review, not investor-approved facts.',
      sourceRequirements: 'Every value or claim needs source title plus URL/date, or it stays in source review.',
      priority: 'high',
      schedulePreference: 'Custom',
      scheduledJobId: job.job_id || job.id,
      schedule: EXECUTIVE_REFRESH_SCHEDULE,
      context: 'Chemicon China Feasibility',
      status: 'Scheduled Hermes Job',
    })
    persistRefreshState({
      scheduledJobId: job.job_id || job.id,
      nextRun: nextTwiceDailyRefresh(),
      lastStatus: 'Twice daily Hermes job scheduled',
      localOnly: false,
    })
    message.success('Executive Intelligence Refresh job scheduled')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown scheduling error'
    await createBoardTask(
      'Set up Executive Intelligence Refresh',
      [
        'Create or repair twice daily Executive Intelligence Refresh.',
        `Target schedule: ${EXECUTIVE_REFRESH_SCHEDULE} / 09:00 and 21:00 local time.`,
        `Scheduling attempt failed: ${detail}`,
        'Fallback saved as Kanban task. Do not claim scheduled refresh is active until a Hermes Job exists.',
      ].join('\n'),
      3,
    )
    persistRefreshState({
      nextRun: nextTwiceDailyRefresh(),
      lastStatus: 'Scheduling failed; Kanban fallback task created',
      localOnly: true,
    })
  } finally {
    savingAction.value = ''
  }
}

async function runDeepAnalysis() {
  await createBoardTask(
    'Run deep executive intelligence analysis',
    [
      'Review economics, market, competitor, raw material, readiness, and presentation gaps.',
      'Expected output: Research Result Review draft only.',
      'Do not mark claims Verified without source evidence.',
      'Tags: Executive Intelligence, Deep Analysis, Research Result Review',
    ].join('\n'),
    3,
  )
}

async function createMissingDataTask() {
  await createBoardTask(
    'Fill missing executive intelligence data',
    [
      'Collect source-backed evidence for unresolved Executive Intelligence Board fields.',
      'Focus on financial model inputs, capacity, blended ASP, investment breakdown, market size, growth, competitor share, and source labels.',
      'Every value needs evidence status and source before investor use.',
      'Tags: Executive Intelligence, Evidence Gap, Hermes Automatic Verification',
    ].join('\n'),
    3,
  )
}

onMounted(() => {
  loadRefreshState()
  loadLocalIntelligenceSources()
})
</script>

<template>
  <section class="executive-board" :class="{ compact: props.compact }" aria-label="Pinned Executive Intelligence Board">
    <header class="board-header">
      <div>
        <p class="eyebrow">Pinned Executive Intelligence</p>
        <h3>Executive Intelligence Board</h3>
        <p>
          Owner/internal board for economics, market intelligence, competitor intelligence, daily brief, and action tracking.
        </p>
      </div>
      <div class="board-refresh">
        <span>Last review: {{ formatDateTime(refreshState.lastRun) }}</span>
        <span>{{ refreshState.localOnly ? 'Next review target' : 'Next source job' }}: {{ formatDateTime(refreshState.nextRun) }}</span>
        <span>Schedule: {{ refreshState.scheduleDisplay }}</span>
        <NTag size="small" :type="refreshState.localOnly ? 'warning' : 'success'">
          {{ refreshState.localOnly ? 'Review required' : 'Trusted-source job scheduled' }}
        </NTag>
      </div>
    </header>

    <NAlert v-if="isInvestorViewer" type="info" :bordered="false" class="board-notice">
      No approved investor board is available yet. Investor viewers can only see material that has been explicitly approved for the Investor Portal.
    </NAlert>

    <NAlert v-else-if="isDeveloperAdmin" type="warning" :bordered="false" class="board-notice">
      Developer Admin can use system tools, but raw business intelligence is not shown here unless the owner explicitly grants business-data access.
    </NAlert>

    <template v-else>
      <NAlert v-if="isRestrictedBusinessRole" type="warning" :bordered="false" class="board-notice">
        Restricted role view. Cost, price, formula, IRR assumptions, raw material prices, supplier costs, and confidential financials are hidden.
      </NAlert>
      <NAlert v-else type="info" :bordered="false" class="board-notice">
        This board is owner/internal only until backend category permissions and an approved investor data room are complete.
      </NAlert>

      <div class="board-toolbar">
        <NButton size="small" type="primary" :loading="savingAction === 'sync-now'" @click="syncNow">
          Sync Now
        </NButton>
        <NButton size="small" secondary :loading="savingAction === 'enable-refresh'" @click="enableTwiceDailyRefresh">
          Enable Twice Daily Refresh
        </NButton>
        <RouterLink class="board-link" :to="{ name: 'hermes.researchResultReview' }">
          Review Results
        </RouterLink>
        <RouterLink class="board-link" :to="{ name: 'hermes.jobs' }">
          Jobs
        </RouterLink>
      </div>

      <div class="panel-grid">
        <article class="board-panel economics-panel">
          <div class="panel-heading">
            <div>
              <h4>Investor Economics Panel</h4>
              <p>Financial outputs are never investor truth until source-backed or explicitly approved.</p>
            </div>
            <RouterLink :to="{ name: 'hermes.investmentCalculator' }">Open IRR Calculator</RouterLink>
          </div>

          <div class="economics-kpis">
            <div v-for="kpi in visibleEconomicsKpis" :key="kpi.key" class="economics-kpi">
              <span>{{ kpi.label }}</span>
              <strong>{{ displayBoardValue(kpi.value) }}</strong>
              <NTag size="small" :type="statusType(kpi.displayStatus || kpi.evidenceStatus)">{{ displayBoardStatus(kpi.displayStatus || kpi.evidenceStatus) }}</NTag>
              <small>{{ boardKpiSourceMetadata(kpi) }}</small>
            </div>
          </div>

          <div class="table-block">
            <h5>Investment Breakdown</h5>
            <div class="mini-table">
              <div class="mini-row mini-head">
                <span>Category</span>
                <span>Value</span>
                <span>Status</span>
              </div>
              <div v-for="row in investmentBreakdown" :key="row.label" class="mini-row">
                <span>{{ row.label }}</span>
                <span>{{ redactsSensitiveValues ? 'Restricted' : displayBoardValue(row.value) }}</span>
                <NTag size="small" :type="statusType(row.evidenceStatus)">{{ displayBoardStatus(row.evidenceStatus) }}</NTag>
              </div>
            </div>
          </div>

          <div class="panel-actions">
            <NButton size="tiny" secondary @click="addBoardToInvestorReview('financial')">Add to Investor Review</NButton>
            <NButton size="tiny" secondary :loading="savingAction === 'Fill missing executive intelligence data'" @click="createMissingDataTask">Create Missing Data Task</NButton>
            <NButton size="tiny" secondary :loading="savingAction === 'Run deep executive intelligence analysis'" @click="runDeepAnalysis">Run Deep Analysis</NButton>
          </div>
        </article>

        <article class="board-panel market-panel">
          <div class="panel-heading">
            <div>
              <h4>Market & Competitor Intelligence Panel</h4>
              <p>Unknown market share stays in source review. Assumptions stay visibly labeled.</p>
            </div>
            <RouterLink :to="{ name: 'hermes.marketIntelligence' }">Open Market Intelligence</RouterLink>
          </div>

          <div class="market-metrics">
            <div v-for="metric in marketMetrics" :key="metric.label" class="market-metric">
              <span>{{ metric.label }}</span>
              <strong>{{ displayBoardValue(metric.value) }}</strong>
              <NTag size="small" :type="statusType(metric.evidenceStatus)">{{ displayBoardStatus(metric.evidenceStatus) }}</NTag>
              <small>{{ metric.sourceLabel }}</small>
            </div>
          </div>

          <div class="table-block">
            <h5>Market Segmentation</h5>
            <div class="mini-table">
              <div class="mini-row mini-head">
                <span>Segment</span>
                <span>Size/value</span>
                <span>Source</span>
                <span>Status</span>
              </div>
              <div v-for="claim in marketSegments" :key="claim.id || claim.label" class="mini-row">
                <span>{{ claim.label }}</span>
                <span>{{ displayBoardValue(boardMarketClaimValue(claim)) }}</span>
                <span>{{ boardSourceMetadata(claim) }}</span>
                <NTag size="small" :type="statusType(canDisplayBoardMarketClaim(claim) ? normalizedMarketClaimStatus(claim) : 'To Verify')">{{ displayBoardStatus(canDisplayBoardMarketClaim(claim) ? normalizedMarketClaimStatus(claim) : 'To Verify') }}</NTag>
              </div>
              <div v-if="!marketSegments.length" class="mini-row">
                <span>No approved source-backed market segment</span>
                <span>Value hidden until source review</span>
                <span>{{ boardSourceMetadata(null) }}</span>
                <NTag size="small" type="warning">Reference only</NTag>
              </div>
            </div>
          </div>

          <div class="table-block">
            <h5>Competitor Table</h5>
            <div class="mini-table competitor-table">
              <div class="mini-row mini-head">
                <span>Rank</span>
                <span>Manufacturer</span>
                <span>HQ</span>
                <span>Product</span>
                <span>Capacity</span>
                <span>Share</span>
                <span>Status</span>
                <span>Source</span>
              </div>
              <div v-for="row in competitorRows" :key="`${row.rank}-${row.manufacturer}`" class="mini-row">
                <span>{{ row.rank }}</span>
                <span>{{ row.manufacturer }}</span>
                <span>{{ displayBoardValue(row.hq) }}</span>
                <span>{{ displayBoardValue(row.productEquivalent) }}</span>
                <span>{{ displayBoardValue(row.capacity) }}</span>
                <span>{{ displayBoardValue(row.marketShare) }}</span>
                <NTag size="small" :type="statusType(row.evidenceStatus)">{{ displayBoardStatus(row.evidenceStatus) }}</NTag>
                <span>{{ row.sourceLabel }}</span>
              </div>
              <div v-if="!competitorRows.length" class="mini-row">
                <span>-</span>
                <span>No approved source-backed competitor record</span>
                <span>Value hidden until source review</span>
                <span>Product evidence pending</span>
                <span>Capacity source required</span>
                <span>Share source required</span>
                <NTag size="small" type="warning">Reference only</NTag>
                <span>{{ boardSourceMetadata(null) }}</span>
              </div>
            </div>
          </div>

          <div v-if="topCountries.length" class="source-list">
            <strong>Country opportunity records</strong>
            <span v-for="record in topCountries" :key="record.id">
              {{ record.country }} / {{ displayBoardStatus(record.evidenceStatus) }} / {{ displayBoardValue(record.source) }}
            </span>
          </div>

          <div class="panel-actions">
            <RouterLink class="board-link" :to="{ name: 'hermes.competitorIntelligence' }">Open Competitors</RouterLink>
            <NButton size="tiny" secondary @click="addBoardToInvestorReview('market')">Add to Investor Review</NButton>
            <NButton size="tiny" secondary @click="createMissingDataTask">Create Verification Task</NButton>
          </div>
        </article>

        <article class="board-panel daily-panel">
          <div class="panel-heading">
            <div>
              <h4>Hermes Daily Brief / Executive Action Center</h4>
              <p>Brief uses existing activity, captures, jobs, tasks, evidence gaps, and review queues.</p>
            </div>
            <RouterLink :to="{ name: 'hermes.last24Hours' }">Last 24 Hours</RouterLink>
          </div>

          <div class="brief-grid">
            <div>
              <h5>Daily Hermes Brief</h5>
              <p v-if="!hasDailyBriefSource" class="empty-brief">No daily brief generated yet.</p>
              <ul v-if="hasDailyBriefSource">
                <li v-for="item in briefItems" :key="item">{{ item }}</li>
              </ul>
              <NButton v-if="!hasDailyBriefSource" size="tiny" secondary @click="syncNow">Generate Daily Brief</NButton>
            </div>
            <div>
              <h5>Today’s Priorities</h5>
              <ul>
                <li v-for="gap in evidenceGaps" :key="gap.id">{{ gap.label }} - {{ displayBoardStatus(gap.evidenceStatus) }}</li>
                <li v-if="!evidenceGaps.length">No evidence gaps in current local state.</li>
              </ul>
            </div>
            <div>
              <h5>Top Risk</h5>
              <ul>
                <li v-for="risk in topRisks" :key="risk.id">{{ risk.title }} - {{ displayBoardStatus(risk.evidenceStatus) }}</li>
                <li v-if="!topRisks.length">No current risks in local intelligence state.</li>
              </ul>
            </div>
          </div>

          <div v-if="topRawMaterials.length && isOwner" class="source-list">
            <strong>Raw material watchlist</strong>
            <span v-for="material in topRawMaterials" :key="material.id">
              {{ material.name }} / {{ displayBoardStatus(material.evidenceStatus) }} / {{ displayBoardValue(material.source) }}
            </span>
          </div>

          <h5 class="actions-heading">One-click Actions</h5>
          <div class="action-grid">
            <NButton size="small" secondary @click="addBoardToInvestorReview('presentation')">Generate Investor Brief</NButton>
            <RouterLink class="board-link" :to="{ name: 'hermes.investmentCalculator' }">Update Financial Model</RouterLink>
            <RouterLink class="board-link" :to="{ name: 'hermes.competitorIntelligence' }">Run Competitor Analysis</RouterLink>
            <RouterLink class="board-link" :to="{ name: 'hermes.rawMaterialSourcing' }">Review Raw Material Prices</RouterLink>
            <NButton size="small" secondary @click="enableTwiceDailyRefresh">Schedule Night Research</NButton>
            <RouterLink class="board-link" :to="{ name: 'hermes.investorReadiness' }">Open Evidence Gaps</RouterLink>
            <RouterLink class="board-link" :to="{ name: 'hermes.localBackupVault' }">Backup Now</RouterLink>
            <NButton size="small" secondary @click="createMissingDataTask">Create Task</NButton>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.executive-board {
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-card;
  padding: 16px;
  margin-bottom: 12px;
  color: $text-primary;
}

.board-header,
.panel-heading,
.board-toolbar,
.panel-actions,
.action-grid {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.board-header {
  margin-bottom: 12px;

  h3 {
    margin: 0;
    color: $warning;
    font-size: 18px;
  }

  p {
    margin: 4px 0 0;
    color: $text-secondary;
    font-size: 12px;
  }
}

.eyebrow {
  margin: 0 0 4px !important;
  color: $accent-primary !important;
  font-size: 11px !important;
  font-weight: 800;
  text-transform: uppercase;
}

.board-refresh {
  display: grid;
  gap: 4px;
  justify-items: end;
  color: $text-muted;
  font-size: 11px;
  white-space: nowrap;
}

.board-notice {
  margin-bottom: 12px;
}

.board-toolbar {
  justify-content: flex-start;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.board-link {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 5px 9px;
  border: 1px solid $border-color;
  border-radius: 6px;
  color: $accent-info;
  text-decoration: none;
  font-size: 12px;
  font-weight: 700;
  background: rgba(var(--accent-info-rgb), 0.08);
}

.panel-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 14px;
}

.board-panel {
  min-width: 0;
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-secondary;
  padding: 14px;
}

.daily-panel {
  grid-column: 1 / -1;
}

.panel-heading {
  margin-bottom: 12px;

  h4 {
    margin: 0;
    color: $text-primary;
    font-size: 15px;
  }

  p {
    margin: 4px 0 0;
    color: $text-secondary;
    font-size: 12px;
  }
}

.economics-kpis,
.market-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.economics-kpi,
.market-metric {
  display: grid;
  gap: 5px;
  min-width: 0;
  border: 1px solid $border-color;
  border-radius: 7px;
  padding: 10px;
  background: $bg-card;

  span,
  small {
    color: $text-muted;
    font-size: 11px;
  }

  strong {
    min-width: 0;
    color: $text-primary;
    font-size: 17px;
    overflow-wrap: anywhere;
  }
}

.table-block {
  margin-top: 12px;
  min-width: 0;
  overflow-x: auto;

  h5 {
    margin: 0 0 8px;
    color: $warning;
    font-size: 12px;
    text-transform: uppercase;
  }
}

.mini-table {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.mini-row {
  display: grid;
  grid-template-columns: minmax(120px, 1.2fr) minmax(100px, 1fr) minmax(90px, auto);
  gap: 8px;
  align-items: center;
  padding: 7px 8px;
  border-radius: 6px;
  background: $bg-card;
  color: $text-secondary;
  font-size: 12px;

  > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.market-panel .mini-row {
  grid-template-columns: minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(90px, auto);
}

.competitor-table .mini-row {
  grid-template-columns: 48px minmax(100px, 1fr) minmax(80px, 0.8fr) minmax(100px, 1fr) minmax(80px, 0.8fr) minmax(80px, 0.8fr) minmax(90px, auto) minmax(160px, 1.2fr);
  min-width: 780px;
}

.mini-head {
  color: $text-muted;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.source-list {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  color: $text-secondary;
  font-size: 12px;

  strong {
    color: $text-primary;
  }
}

.panel-actions,
.action-grid {
  justify-content: flex-start;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 12px;
}

.brief-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;

  > div {
    border: 1px solid $border-color;
    border-radius: 7px;
    background: $bg-card;
    padding: 10px;
  }

  h5 {
    margin: 0 0 8px;
    color: $warning;
    font-size: 12px;
  }

  ul {
    margin: 0;
    padding-left: 16px;
    color: $text-secondary;
    font-size: 12px;
  }
}

.empty-brief {
  margin: 0 0 8px;
  color: $text-secondary;
  font-size: 12px;
  font-weight: 700;
}

.compact {
  border: 0;
  border-radius: 0;
  background: transparent;
}

@media (max-width: 1100px) {
  .panel-grid,
  .brief-grid {
    grid-template-columns: 1fr;
  }

  .economics-kpis,
  .market-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .daily-panel {
    grid-column: auto;
  }
}

@media (max-width: 720px) {
  .board-header,
  .panel-heading {
    display: grid;
  }

  .board-refresh {
    justify-items: start;
    white-space: normal;
  }

  .economics-kpis,
  .market-metrics {
    grid-template-columns: 1fr;
  }

  .mini-row,
  .market-panel .mini-row,
  .competitor-table .mini-row {
    grid-template-columns: 1fr;
    min-width: 0;
  }
}
</style>
