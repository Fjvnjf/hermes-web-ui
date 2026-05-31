<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NTag, useMessage } from 'naive-ui'
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
          <NButton size="tiny" secondary @click="createResearchTask(section)">
            Research This Market
          </NButton>
          <NButton size="tiny" secondary type="primary" :loading="creating === section" @click="createResearchTask(section)">
            Yes, do deeper analysis
          </NButton>
          <button type="button" @click="createResearchTask(section)">Run Tonight</button>
          <RouterLink :to="{ name: 'hermes.kanban' }">Create task</RouterLink>
          <RouterLink v-if="canUseRoute('hermes.researchResultReview')" :to="{ name: 'hermes.researchResultReview' }">Later</RouterLink>
          <RouterLink v-if="canUseRoute('hermes.investorReadiness')" :to="{ name: 'hermes.investorReadiness' }">Add claim to investor review</RouterLink>
          <NButton size="tiny" secondary @click="createResearchTask(`Schedule deeper research: ${section}`)">
            Schedule Deeper Research
          </NButton>
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

.market-command-panel {
  display: grid;
  gap: 12px;
  margin: 14px 0;
  padding: 16px;
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

  a {
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
  .claim-row,
  .segmentation-row {
    grid-template-columns: 1fr;
  }

  .panel-heading-inline {
    display: grid;
  }

  .competitor-row {
    grid-template-columns: 1fr;
  }
}
</style>
