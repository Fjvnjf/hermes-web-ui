<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NAlert, NButton, NTag, useMessage } from 'naive-ui'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { useJobsStore } from '@/stores/hermes/jobs'
import { getFrontendAccessRole, shouldRedactForEmployee } from '@/utils/accessControl'
import {
  EXECUTIVE_INTELLIGENCE_STORAGE_KEY,
  EXECUTIVE_REFRESH_JOB_NAME,
  EXECUTIVE_REFRESH_SCHEDULE,
  buildInvestmentBreakdownRows,
  buildInvestorEconomicsKpis,
  defaultExecutiveRefreshState,
  nextTwiceDailyRefresh,
  type ExecutiveRefreshState,
} from '@/utils/executiveIntelligence'
import type { IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'

const message = useMessage()
const intelligence = useFeasibilityIntelligence()
const kanbanStore = useKanbanStore()
const jobsStore = useJobsStore()

const refreshState = ref<ExecutiveRefreshState>(defaultExecutiveRefreshState())
const savingAction = ref('')

const role = computed(() => getFrontendAccessRole())
const redactsFinancials = computed(() => shouldRedactForEmployee(role.value) || role.value === 'investor_viewer' || role.value === 'developer_admin')
const latestFinancialModel = intelligence.latestFinancialModel
const nextUpdateLabel = computed(() => formatDateTime(refreshState.value.nextRun))
const kpis = computed(() =>
  buildInvestorEconomicsKpis(latestFinancialModel.value, nextUpdateLabel.value)
    .filter(item => ['totalInvestment', 'projectIrr', 'npv', 'payback', 'profitabilityIndex', 'fiveYearRoi'].includes(item.key))
    .map(item => redactsFinancials.value
      ? { ...item, value: item.sensitive ? 'Restricted' : item.value, evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus, sourceLabel: item.sensitive ? 'Owner/financial only' : item.sourceLabel }
      : item),
)
const breakdownRows = computed(() =>
  buildInvestmentBreakdownRows().map(row => redactsFinancials.value ? { ...row, value: 'Restricted' } : row),
)
const financialWarnings = computed(() => latestFinancialModel.value?.warnings || ['No saved financial snapshot. Open the IRR Calculator and save a model before using investment outputs.'])
const evidenceStatus = computed(() => latestFinancialModel.value ? 'Derived from Assumptions' : 'To Verify')

const scenarioCards = computed(() => [
  { name: 'Lean', status: 'To Verify', detail: 'Needs sourced capex, operating cost, volume, and selling-price assumptions.' },
  { name: 'Base', status: latestFinancialModel.value?.scenarioName?.includes('Base') ? evidenceStatus.value : 'To Verify', detail: latestFinancialModel.value?.scenarioName || 'No saved base scenario snapshot.' },
  { name: 'Conservative', status: 'To Verify', detail: 'Use the IRR Calculator to save downside assumptions before investor use.' },
  { name: 'Aggressive', status: 'To Verify', detail: 'Upside case must stay assumption-labeled until source-backed.' },
])

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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function statusType(status: IntelligenceEvidenceStatus): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (status === 'Verified' || status === 'Source-backed' || status === 'User Approved' || status === 'Investor Approved') return 'success'
  if (status === 'Assumption' || status === 'Derived from Assumptions' || status === 'Approved Assumption' || status === 'Powerful Assumption') return 'warning'
  if (status === 'Missing' || status === 'To Verify') return 'error'
  return 'info'
}

function analysisReviewSummary(): string {
  const model = latestFinancialModel.value
  return [
    'Investment Analysis refresh draft',
    `Schedule metadata: ${refreshState.value.scheduleDisplay}`,
    `Scenario: ${model?.scenarioName || 'No saved scenario'}`,
    `Evidence status: ${model ? 'Derived from Assumptions' : 'To Verify'}`,
    `NPV: ${model ? model.npv : 'To Verify'}`,
    `IRR: ${model?.irr ?? 'To Verify'}`,
    `Payback: ${model?.paybackYear ?? 'To Verify'}`,
    '',
    'This is not investor-approved. Review sources and assumptions before presentation use.',
  ].join('\n')
}

function stageAnalysisReview() {
  const saved = intelligence.addResearchFinding({
    summary: analysisReviewSummary(),
    keyClaim: 'Investment analysis requires financial evidence review',
    area: 'financial',
    evidenceStatus: latestFinancialModel.value ? 'Derived from Assumptions' : 'To Verify',
    confidence: 'medium',
    source: latestFinancialModel.value?.source || null,
    suggestedTask: 'Review financial model inputs, source documents, and assumption labels before investor use.',
    suggestedInvestorMaterial: latestFinancialModel.value
      ? `Financial model draft: ${latestFinancialModel.value.scenarioName}. Outputs are Derived from Assumptions.`
      : '',
    riskNote: 'Financial outputs are sensitive and must not be treated as verified without source evidence.',
  })
  persistRefreshState({
    lastRun: new Date().toISOString(),
    nextRun: nextTwiceDailyRefresh(),
    lastStatus: 'Investment analysis staged for Research Result Review',
    resultNeedsReviewCount: refreshState.value.resultNeedsReviewCount + 1,
    localOnly: true,
  })
  message.success(`Research review draft staged: ${saved.keyClaim}`)
}

async function createMissingFinanceTask() {
  savingAction.value = 'finance-task'
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: 'Verify investment analysis assumptions',
      body: [
        'Resolve missing Investment Analysis data before investor use.',
        'Required evidence: capex quotes, working capital assumptions, raw material/cost support, revenue assumptions, tax/discount rate rationale, and investor return assumptions.',
        'Evidence status: To Verify / Derived from Assumptions',
        'Source page: Investment Analysis',
        'Tags: Investment Analysis, Financial Evidence, Chemicon China Feasibility',
      ].join('\n'),
      priority: 3,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Investment evidence task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create financial evidence task: ${detail}`)
  } finally {
    savingAction.value = ''
  }
}

async function scheduleRefreshJob() {
  savingAction.value = 'schedule-refresh'
  try {
    const job = await jobsStore.createJob({
      name: EXECUTIVE_REFRESH_JOB_NAME,
      schedule: EXECUTIVE_REFRESH_SCHEDULE,
      deliver: 'local',
      prompt: [
        'Refresh Investment Analysis only as a review draft.',
        'Check IRR Calculator snapshots, financial assumptions, missing evidence, source labels, and warnings.',
        'Do not mark any financial output Verified automatically.',
        'Write outputs for Research Result Review.',
      ].join('\n'),
    })
    intelligence.addResearchJob({
      title: EXECUTIVE_REFRESH_JOB_NAME,
      question: 'What changed in investment analysis and financial evidence status?',
      scope: 'IRR snapshot, investment breakdown, NPV/IRR/payback labels, financial evidence gaps, and investor-ready warnings.',
      expectedOutput: 'Review-ready financial intelligence note only.',
      sourceRequirements: 'Every value needs source title plus URL/date or explicit User Approved assumption.',
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
    message.success('Twice daily refresh job scheduled')
  } catch (err) {
    await createMissingFinanceTask()
    persistRefreshState({
      nextRun: nextTwiceDailyRefresh(),
      lastStatus: 'Scheduling failed; Kanban fallback task created',
      localOnly: true,
    })
  } finally {
    savingAction.value = ''
  }
}

onMounted(loadRefreshState)
</script>

<template>
  <div class="investment-analysis-view">
    <header class="analysis-hero">
      <div>
        <p class="eyebrow">Investment Analysis</p>
        <h2>Investor Economics Control Panel</h2>
        <p>
          IRR, NPV, payback, investment breakdown, and return analysis use saved IRR Calculator snapshots.
          Missing values stay To Verify, and financial outputs are labeled Derived from Assumptions until reviewed.
        </p>
      </div>
      <div class="refresh-card">
        <span>Last updated</span>
        <strong>{{ formatDateTime(refreshState.lastRun) }}</strong>
        <small>Next update: {{ formatDateTime(refreshState.nextRun) }}</small>
        <small>Status: {{ refreshState.lastStatus }}</small>
        <small>Needs review: {{ refreshState.resultNeedsReviewCount }}</small>
      </div>
    </header>

    <NAlert type="warning" :bordered="false" class="analysis-alert">
      Financial outputs are sensitive. Do not treat IRR, NPV, payback, cost, or investment values as verified facts
      until assumptions are source-backed or explicitly user-approved.
    </NAlert>

    <section class="analysis-toolbar">
      <NButton size="small" type="primary" :loading="savingAction === 'sync-now'" @click="stageAnalysisReview">
        Sync Now
      </NButton>
      <NButton size="small" secondary :loading="savingAction === 'schedule-refresh'" @click="scheduleRefreshJob">
        Enable Twice Daily Refresh
      </NButton>
      <NButton size="small" secondary :loading="savingAction === 'finance-task'" @click="createMissingFinanceTask">
        Create Missing Data Task
      </NButton>
      <RouterLink class="analysis-link" :to="{ name: 'hermes.investmentCalculator' }">Open IRR Calculator</RouterLink>
      <RouterLink class="analysis-link" :to="{ name: 'hermes.researchResultReview' }">Review Results</RouterLink>
    </section>

    <section class="kpi-grid" aria-label="Investment analysis KPI cards">
      <article v-for="kpi in kpis" :key="kpi.key" class="kpi-card">
        <span>{{ kpi.label }}</span>
        <strong>{{ kpi.value }}</strong>
        <NTag size="small" :type="statusType(kpi.evidenceStatus)">{{ kpi.evidenceStatus }}</NTag>
        <small>{{ kpi.sourceLabel }}</small>
      </article>
    </section>

    <section class="analysis-grid">
      <article class="analysis-panel">
        <div class="panel-title">
          <div>
            <h3>Investment Breakdown</h3>
            <p>Line items remain To Verify until source-backed storage exists.</p>
          </div>
        </div>
        <div class="table-grid">
          <div class="table-row head">
            <span>Category</span><span>Value</span><span>Status</span><span>Source</span>
          </div>
          <div v-for="row in breakdownRows" :key="row.label" class="table-row">
            <span>{{ row.label }}</span>
            <span>{{ row.value }}</span>
            <NTag size="small" :type="statusType(row.evidenceStatus)">{{ row.evidenceStatus }}</NTag>
            <span>{{ row.sourceLabel }}</span>
          </div>
        </div>
      </article>

      <article class="analysis-panel">
        <div class="panel-title">
          <div>
            <h3>Scenario Status</h3>
            <p>Lean, Base, Conservative, and Aggressive scenarios are connected through the IRR Calculator.</p>
          </div>
        </div>
        <div class="scenario-grid">
          <div v-for="scenario in scenarioCards" :key="scenario.name" class="scenario-card">
            <strong>{{ scenario.name }}</strong>
            <NTag size="small" :type="statusType(scenario.status as IntelligenceEvidenceStatus)">{{ scenario.status }}</NTag>
            <small>{{ scenario.detail }}</small>
          </div>
        </div>
      </article>

      <article class="analysis-panel">
        <div class="panel-title">
          <div>
            <h3>Warnings / Evidence Gaps</h3>
            <p>These should become tasks or review findings before presentation use.</p>
          </div>
        </div>
        <ul class="warning-list">
          <li v-for="warning in financialWarnings" :key="warning">{{ warning }}</li>
        </ul>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.investment-analysis-view {
  min-height: var(--app-content-height, 100%);
  padding: 18px;
  background: $bg-primary;
  color: $text-primary;
}

.analysis-hero,
.kpi-card,
.analysis-panel {
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-card;
}

.analysis-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(230px, 300px);
  gap: 16px;
  margin-bottom: 12px;
  padding: 18px;

  h2 {
    margin: 0;
    color: $warning;
    font-size: 26px;
  }

  p {
    max-width: 820px;
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.eyebrow {
  margin: 0 0 6px;
  color: $accent-primary;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.refresh-card {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
  border-radius: 8px;
  background: rgba(var(--accent-primary-rgb), 0.08);

  span,
  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 18px;
  }
}

.analysis-alert {
  margin-bottom: 12px;
}

.analysis-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.analysis-link {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 6px 10px;
  border: 1px solid $border-color;
  border-radius: 6px;
  background: rgba(var(--accent-info-rgb), 0.08);
  color: $accent-info;
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.kpi-card,
.scenario-card {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 12px;

  span,
  small {
    color: $text-secondary;
  }

  span {
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 22px;
    overflow-wrap: anywhere;
  }
}

.analysis-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
}

.analysis-panel {
  min-width: 0;
  padding: 14px;
}

.analysis-panel:last-child {
  grid-column: 1 / -1;
}

.panel-title {
  margin-bottom: 10px;

  h3 {
    margin: 0;
    color: $text-primary;
  }

  p {
    margin: 4px 0 0;
    color: $text-secondary;
  }
}

.table-grid {
  display: grid;
  gap: 5px;
}

.table-row {
  display: grid;
  grid-template-columns: minmax(140px, 1.2fr) minmax(120px, 1fr) minmax(110px, auto) minmax(140px, 1fr);
  gap: 8px;
  align-items: center;
  padding: 8px;
  border-radius: 6px;
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

.scenario-grid {
  display: grid;
  gap: 8px;
}

.scenario-card {
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;
}

.warning-list {
  margin: 0;
  padding-left: 18px;
  color: $text-secondary;
  line-height: 1.6;
}

@media (max-width: 900px) {
  .analysis-hero,
  .analysis-grid {
    grid-template-columns: 1fr;
  }

  .analysis-panel:last-child {
    grid-column: auto;
  }
}

@media (max-width: 680px) {
  .investment-analysis-view {
    padding: 12px;
  }

  .table-row {
    grid-template-columns: 1fr;
  }
}
</style>
