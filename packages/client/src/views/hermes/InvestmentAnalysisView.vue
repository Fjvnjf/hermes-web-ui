<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NAlert, NButton, NTag, useMessage } from 'naive-ui'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
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
import {
  displayAutomaticVerificationText,
  displayEvidenceStatus,
  displayUnresolvedValue,
  type IntelligenceEvidenceStatus,
} from '@/utils/investorIntelligence'

const message = useMessage()
const intelligence = useFeasibilityIntelligence()
const kanbanStore = useKanbanStore()
const jobsStore = useJobsStore()

const refreshState = ref<ExecutiveRefreshState>(defaultExecutiveRefreshState())
const savingAction = ref('')
const selectedScenario = ref('Base')
const scenarioNames = ['Lean', 'Base', 'Conservative', 'Aggressive'] as const

const role = computed(() => getFrontendAccessRole())
const redactsFinancials = computed(() => shouldRedactForEmployee(role.value) || role.value === 'investor_viewer' || role.value === 'developer_admin')
const latestFinancialModel = intelligence.latestFinancialModel
const selectedFinancialModel = computed(() =>
  intelligence.state.value.financialModels.find(model => model.scenarioName.toLowerCase().includes(selectedScenario.value.toLowerCase())) || null,
)
const nextUpdateLabel = computed(() => formatDateTime(refreshState.value.nextRun))
const kpis = computed(() =>
  buildInvestorEconomicsKpis(selectedFinancialModel.value, nextUpdateLabel.value)
    .filter(item => ['totalInvestment', 'projectIrr', 'npv', 'payback', 'profitabilityIndex', 'fiveYearRoi'].includes(item.key))
    .map(item => redactsFinancials.value
      ? { ...item, value: item.sensitive ? 'Restricted' : item.value, evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus, sourceLabel: item.sensitive ? 'Owner/financial only' : item.sourceLabel }
      : item),
)
const breakdownRows = computed(() =>
  buildInvestmentBreakdownRows().map(row => redactsFinancials.value ? { ...row, value: 'Restricted' } : row),
)
const financialWarnings = computed(() => selectedFinancialModel.value?.warnings || ['Scenario not filled yet. Open the IRR Calculator and save this scenario before using investment outputs.'])
const evidenceStatus = computed(() => selectedFinancialModel.value ? 'Derived from Assumptions' : 'To Verify')
const financialEvidenceCandidates = computed(() =>
  intelligence.state.value.dataRoomSources
    .filter(record => record.dashboardGroup === 'financialEvidence' || (record.area === 'financial' && record.notes.toLowerCase().includes('financialevidence')))
    .slice(0, 10)
    .map(record => ({
      id: record.id,
      label: record.checklistLabel || 'Financial evidence candidate',
      value: redactsFinancials.value ? 'Restricted' : record.proposedValue || 'To Verify',
      sourceTitle: record.source?.title || 'Source review needed',
      sourceUrl: record.source?.url || '',
      sourceTier: record.sourceTier || 'candidate-source',
      evidenceStatus: (record.evidenceStatus === 'Verified' || record.evidenceStatus === 'Investor Approved'
        ? 'To Verify'
        : record.evidenceStatus) as IntelligenceEvidenceStatus,
      confidence: record.confidence || 'medium',
      notes: record.notes || 'Autopilot staged this source for review. It is not an approved investment assumption.',
    })),
)
const processEquipmentRows = computed(() => [
  detailRow('Tanks / reactors / mixers', 'Capacity and metallurgy To Verify'),
  detailRow('Dosing / transfer systems', 'Quote and sizing To Verify'),
  detailRow('QC / lab equipment', 'Specification To Verify'),
])
const utilitiesBuildingRows = computed(() => [
  detailRow('Utilities & Infrastructure', 'Power, steam, water, compressed air To Verify'),
  detailRow('Buildings & Civil', 'Factory, warehouse, office, safety areas To Verify'),
  detailRow('Wastewater / safety systems', 'Environmental and fire-system scope To Verify'),
])
const workingCapitalRows = computed(() => [
  detailRow('Inventory days', 'Raw material and finished goods days To Verify'),
  detailRow('Receivable days', 'Customer credit / DSO To Verify'),
  detailRow('Payable days', 'Supplier credit / DPO To Verify'),
  detailRow('Working capital need', 'Derived only after input evidence is reviewed'),
])
const projectAnalysisTemplateKpis = computed(() => kpis.value)
const projectAnalysisTemplateTitle = computed(() =>
  selectedFinancialModel.value
    ? `${selectedFinancialModel.value.scenarioName} Project Analysis`
    : 'Scale-Up Esterquat Plant Project Analysis Template',
)
const projectAnalysisBreakdownTemplateRows = computed(() => [
  {
    category: 'Process Equipment',
    icon: 'Wrench',
    keyItems: 'Reactors, columns, exchangers, tanks, pumps, packaging',
    source: 'Vendor quotes needed',
  },
  {
    category: 'Utilities & Infrastructure',
    icon: 'Bolt',
    keyItems: 'Steam, cooling, electrical, nitrogen, WWTP, fire systems',
    source: 'Utility and plant-scope evidence needed',
  },
  {
    category: 'Buildings & Civil',
    icon: 'Plant',
    keyItems: 'Production, warehouse, admin, tank farm, roads',
    source: 'Factory/location quote needed',
  },
  {
    category: 'Engineering & Project Mgmt',
    icon: 'Set square',
    keyItems: 'Basic/detailed engineering, PM, EPC overhead',
    source: 'Engineering proposal needed',
  },
  {
    category: 'Installation & Commissioning',
    icon: 'Tools',
    keyItems: 'Erection, piping, E&I, start-up, training',
    source: 'EPC or contractor quote needed',
  },
  {
    category: 'Other Costs',
    icon: 'Clipboard',
    keyItems: 'Permits, initial inventory, working capital, contingency',
    source: 'Legal, permit, and working-capital model needed',
  },
].map(row => ({
  ...row,
  amount: redactsFinancials.value ? 'Restricted' : 'To Verify',
  percent: redactsFinancials.value ? 'Restricted' : 'To Verify',
  evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus,
})))
const projectAnalysisDetailCards = computed(() => [
  {
    title: 'Process Equipment Detail',
    accent: 'Wrench',
    rows: processEquipmentRows.value,
  },
  {
    title: 'Utilities & Buildings Detail',
    accent: 'Bolt',
    rows: utilitiesBuildingRows.value,
  },
  {
    title: 'Working Capital Detail',
    accent: 'Clipboard',
    rows: workingCapitalRows.value,
  },
])
const pdfProjectAnalysisKpis = [
  { label: 'Total Investment', value: '$16M' },
  { label: 'Project IRR', value: '60%' },
  { label: 'NPV @ 12%', value: '$49.8M' },
  { label: 'Payback Period', value: '1.7 yr' },
  { label: 'Profitability Index', value: '4.1x' },
  { label: '5-Year ROI', value: '5.1x' },
]
const pdfInvestmentBreakdownRows = [
  {
    category: 'Process Equipment',
    keyItems: 'Reactors, columns, exchangers, tanks, pumps, packaging',
    amount: '$7,850,000',
    percent: '49.1%',
  },
  {
    category: 'Utilities & Infrastructure',
    keyItems: 'Steam, cooling, electrical, nitrogen, WWTP, fire',
    amount: '$1,720,000',
    percent: '10.8%',
  },
  {
    category: 'Buildings & Civil',
    keyItems: 'Production, warehouse, admin, tank farm, roads',
    amount: '$1,810,000',
    percent: '11.3%',
  },
  {
    category: 'Engineering & Project Mgmt',
    keyItems: 'Basic/detailed engineering, PM, EPC overhead',
    amount: '$970,000',
    percent: '6.0%',
  },
  {
    category: 'Installation & Commissioning',
    keyItems: 'Erection, piping, E&I, start-up, training',
    amount: '$1,130,000',
    percent: '7.1%',
  },
  {
    category: 'Other Costs',
    keyItems: 'Permits, raw inventory (3mo), working capital, contingency',
    amount: '$2,520,000',
    percent: '15.8%',
  },
]

const scenarioCards = computed(() => [
  { name: 'Lean', status: 'To Verify', detail: 'Needs sourced capex, operating cost, volume, and selling-price assumptions.' },
  { name: 'Base', status: latestFinancialModel.value?.scenarioName?.includes('Base') ? evidenceStatus.value : 'To Verify', detail: latestFinancialModel.value?.scenarioName || 'No saved base scenario snapshot.' },
  { name: 'Conservative', status: 'To Verify', detail: 'Use the IRR Calculator to save downside assumptions before investor use.' },
  { name: 'Aggressive', status: 'To Verify', detail: 'Upside case must stay assumption-labeled until source-backed.' },
].map(card => {
  const model = intelligence.state.value.financialModels.find(item => item.scenarioName.toLowerCase().includes(card.name.toLowerCase()))
  return {
    ...card,
    status: model ? evidenceStatus.value : card.status,
    detail: model?.scenarioName || card.detail,
  }
}))

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

function displayInvestmentValue(value?: string | number | null): string {
  return displayUnresolvedValue(value)
}

function displayInvestmentStatus(status?: string | null): string {
  return displayEvidenceStatus(status)
}

function displayInvestmentText(text?: string | null): string {
  return displayAutomaticVerificationText(text)
}

function detailRow(item: string, spec: string) {
  return {
    item,
    spec,
    cost: redactsFinancials.value ? 'Restricted' : 'To Verify',
    source: 'Source missing',
    status: 'To Verify' as IntelligenceEvidenceStatus,
  }
}

function analysisReviewSummary(): string {
  const model = selectedFinancialModel.value
  return [
    'Investment Analysis refresh draft',
    `Schedule metadata: ${refreshState.value.scheduleDisplay}`,
    `Scenario: ${model?.scenarioName || `${selectedScenario.value} scenario not filled yet`}`,
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
    evidenceStatus: selectedFinancialModel.value ? 'Derived from Assumptions' : 'To Verify',
    confidence: 'medium',
    source: selectedFinancialModel.value?.source || null,
    suggestedTask: 'Review financial model inputs, source documents, and assumption labels before investor use.',
    suggestedInvestorMaterial: selectedFinancialModel.value
      ? `Financial model draft: ${selectedFinancialModel.value.scenarioName}. Outputs are Derived from Assumptions.`
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
          Unsupported financial values stay out of investor truth, and financial outputs are labeled Derived from Assumptions until reviewed.
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

    <TrustedSourceAutopilotPanel screen="investment" title="Investment Auto Source Status" />

    <section v-if="financialEvidenceCandidates.length" class="analysis-panel financial-autopilot-panel" aria-label="Autopilot financial evidence candidates">
      <div class="panel-title">
        <div>
          <h3>Autopilot Financial Evidence Candidates</h3>
          <p>
            Hermes has staged source-backed capex, working-capital, or finance evidence for review.
            These entries do not change IRR, NPV, payback, or investor returns until approved in the IRR Calculator or Research Result Review.
          </p>
        </div>
        <RouterLink class="analysis-link" :to="{ name: 'hermes.researchResultReview' }">Review Results</RouterLink>
      </div>
      <div class="financial-candidate-table">
        <div class="financial-candidate-row head">
          <span>Field</span>
          <span>Proposed value</span>
          <span>Source</span>
          <span>Tier / confidence</span>
          <span>Status</span>
        </div>
        <div v-for="candidate in financialEvidenceCandidates" :key="candidate.id" class="financial-candidate-row">
          <strong>{{ candidate.label }}</strong>
          <span>{{ displayInvestmentValue(candidate.value) }}</span>
          <span>
            <a v-if="candidate.sourceUrl" class="analysis-link inline" :href="candidate.sourceUrl" target="_blank" rel="noopener noreferrer">{{ candidate.sourceTitle }}</a>
            <template v-else>{{ candidate.sourceTitle }}</template>
          </span>
          <span>{{ candidate.sourceTier }} / {{ candidate.confidence }}</span>
          <NTag size="small" :type="statusType(candidate.evidenceStatus)">{{ displayInvestmentStatus(candidate.evidenceStatus) }}</NTag>
        </div>
      </div>
      <p class="financial-candidate-note">
        Autopilot financial evidence is useful for filling the dashboard, but it stays review-gated because financial outputs are sensitive and assumption-dependent.
      </p>
    </section>

    <section class="kpi-grid" aria-label="Investment analysis KPI cards">
      <article v-for="kpi in kpis" :key="kpi.key" class="kpi-card">
        <span>{{ kpi.label }}</span>
        <strong>{{ displayInvestmentValue(kpi.value) }}</strong>
        <NTag size="small" :type="statusType(kpi.evidenceStatus)">{{ displayInvestmentStatus(kpi.evidenceStatus) }}</NTag>
        <small>{{ kpi.sourceLabel }}</small>
      </article>
    </section>

    <section class="project-analysis-template" aria-label="Project analysis template">
      <div class="template-hero">
        <div>
          <p class="eyebrow">Project analysis template</p>
          <h3>{{ projectAnalysisTemplateTitle }}</h3>
          <p>
            Screenshot-style investment analysis board. Saved IRR Calculator scenarios can feed the KPI cards, while
            plant line items stay in automatic verification until quotes, source files, and user-approved assumptions are attached.
          </p>
        </div>
        <RouterLink class="analysis-link" :to="{ name: 'hermes.investmentCalculator' }">Open IRR Calculator</RouterLink>
      </div>

      <div class="template-kpi-grid">
        <article v-for="kpi in projectAnalysisTemplateKpis" :key="`template-${kpi.key}`" class="template-kpi-card">
          <strong>{{ displayInvestmentValue(kpi.value) }}</strong>
          <span>{{ kpi.label }}</span>
          <NTag size="small" :type="statusType(kpi.evidenceStatus)">{{ displayInvestmentStatus(kpi.evidenceStatus) }}</NTag>
          <small>{{ kpi.sourceLabel }}</small>
        </article>
      </div>

      <article class="template-panel investment-breakdown-template">
        <div class="template-panel-title">
          <div>
            <h3>Investment Breakdown - Esterquat Plant</h3>
            <p>Use this as the project-analysis template. It does not assert capex totals until source-backed data exists.</p>
          </div>
          <NButton size="small" secondary :loading="savingAction === 'finance-task'" @click="createMissingFinanceTask">
            Create Cost Evidence Task
          </NButton>
        </div>
        <div class="template-breakdown-table">
          <div class="template-breakdown-row head">
            <span>Category</span><span>Key Items</span><span>Amount</span><span>%</span><span>Bar</span><span>Source</span><span>Evidence Status</span>
          </div>
          <div v-for="row in projectAnalysisBreakdownTemplateRows" :key="row.category" class="template-breakdown-row">
            <strong><span>{{ row.icon }}</span> {{ row.category }}</strong>
            <span>{{ row.keyItems }}</span>
            <span>{{ displayInvestmentValue(row.amount) }}</span>
            <span>{{ displayInvestmentValue(row.percent) }}</span>
            <span class="template-placeholder-bar" aria-label="Hermes verifying twice daily bar"></span>
            <span>{{ row.source }}</span>
            <NTag size="small" :type="statusType(row.evidenceStatus)">{{ displayInvestmentStatus(row.evidenceStatus) }}</NTag>
          </div>
          <div class="template-breakdown-row total">
            <strong>Total</strong>
            <span>{{ selectedFinancialModel?.projectName || 'Project scope and location under Hermes verification' }}</span>
            <span>{{ selectedFinancialModel && !redactsFinancials ? displayInvestmentValue(projectAnalysisTemplateKpis[0]?.value) : redactsFinancials ? 'Restricted' : displayInvestmentStatus('To Verify') }}</span>
            <span>{{ selectedFinancialModel && !redactsFinancials ? 'Derived' : redactsFinancials ? 'Restricted' : displayInvestmentStatus('To Verify') }}</span>
            <span class="template-placeholder-bar"></span>
            <span>{{ selectedFinancialModel?.source?.title || 'IRR Calculator / source missing' }}</span>
            <NTag size="small" :type="statusType(evidenceStatus)">{{ displayInvestmentStatus(evidenceStatus) }}</NTag>
          </div>
        </div>
      </article>

      <div class="template-detail-grid">
        <article v-for="card in projectAnalysisDetailCards" :key="card.title" class="template-panel template-detail-panel">
          <div class="template-panel-title compact">
            <h3>{{ card.accent }} {{ card.title }}</h3>
            <span>source-gated</span>
          </div>
          <div class="template-detail-row head"><span>Item</span><span>Spec / assumption</span><span>Cost</span><span>Status</span></div>
          <div v-for="row in card.rows" :key="`${card.title}-${row.item}`" class="template-detail-row">
            <strong>{{ row.item }}</strong>
            <span>{{ row.spec }}</span>
            <span>{{ displayInvestmentValue(row.cost) }}</span>
            <NTag size="small" :type="statusType(row.status)">{{ displayInvestmentStatus(row.status) }}</NTag>
          </div>
        </article>
      </div>

      <article class="template-panel pdf-project-analysis-panel" aria-label="User PDF project analysis reference">
        <div class="template-panel-title">
          <div>
            <h3>User PDF Project Analysis Reference - 60,000 MT/YR Esterquat Plant</h3>
            <p>
              These values are copied from your PDF screenshot so the dashboard can show the table you requested.
              They are not treated as verified model outputs; they remain User Provided / Derived from Assumptions until source-backed quotes and approved IRR inputs exist.
            </p>
          </div>
          <NTag size="small" type="warning">User Provided / {{ displayInvestmentStatus('To Verify') }}</NTag>
        </div>

        <div class="pdf-kpi-grid">
          <article v-for="kpi in pdfProjectAnalysisKpis" :key="kpi.label" class="template-kpi-card">
            <strong>{{ redactsFinancials ? 'Restricted' : displayInvestmentValue(kpi.value) }}</strong>
            <span>{{ kpi.label }}</span>
            <NTag size="small" type="warning">Derived from Assumptions</NTag>
            <small>User PDF screenshot / source quotes needed</small>
          </article>
        </div>

        <div class="pdf-breakdown-table">
          <div class="pdf-breakdown-row head">
            <span>Category</span><span>Key Items</span><span>Amount</span><span>%</span><span>Source</span><span>Evidence Status</span>
          </div>
          <div v-for="row in pdfInvestmentBreakdownRows" :key="row.category" class="pdf-breakdown-row">
            <strong>{{ row.category }}</strong>
            <span>{{ row.keyItems }}</span>
            <span>{{ redactsFinancials ? 'Restricted' : row.amount }}</span>
            <span>{{ redactsFinancials ? 'Restricted' : row.percent }}</span>
            <span>User PDF screenshot / quote evidence needed</span>
            <NTag size="small" type="warning">User Provided</NTag>
          </div>
          <div class="pdf-breakdown-row total">
            <strong>Total</strong>
            <span>5 production lines / Guangdong, China</span>
            <span>{{ redactsFinancials ? 'Restricted' : '$16,000,000' }}</span>
            <span>{{ redactsFinancials ? 'Restricted' : '100%' }}</span>
            <span>User PDF screenshot</span>
            <NTag size="small" type="warning">{{ displayInvestmentStatus('To Verify') }}</NTag>
          </div>
        </div>
      </article>
    </section>

    <section class="analysis-grid">
      <article class="analysis-panel">
        <div class="panel-title">
          <div>
            <h3>Investment Breakdown</h3>
            <p>Line items remain in Hermes twice-daily verification until source-backed storage exists.</p>
          </div>
        </div>
        <div class="table-grid">
          <div class="table-row head">
            <span>Category</span><span>Key Items</span><span>Amount</span><span>%</span><span>Bar</span><span>Source</span><span>Evidence Status</span>
          </div>
          <div v-for="row in breakdownRows" :key="row.label" class="table-row">
            <span>{{ row.label }}</span>
            <span>No source-backed line items yet</span>
            <span>{{ displayInvestmentValue(row.value) }}</span>
            <span>{{ displayInvestmentStatus('To Verify') }}</span>
            <span class="placeholder-bar" aria-label="gray placeholder bar"></span>
            <span>{{ row.sourceLabel }}</span>
            <NTag size="small" :type="statusType(row.evidenceStatus)">{{ displayInvestmentStatus(row.evidenceStatus) }}</NTag>
          </div>
        </div>
      </article>

      <article class="analysis-panel">
        <div class="panel-title">
          <div>
            <h3>Scenario Selector</h3>
            <p>Lean, Base, Conservative, and Aggressive scenarios switch to saved IRR Calculator snapshots when available.</p>
          </div>
        </div>
        <div class="scenario-selector" role="radiogroup" aria-label="Investment scenario selector">
          <button
            v-for="name in scenarioNames"
            :key="name"
            type="button"
            class="scenario-option"
            :class="{ selected: selectedScenario === name }"
            :aria-pressed="selectedScenario === name"
            @click="selectedScenario = name"
          >
            {{ name }}
          </button>
        </div>
        <p v-if="!selectedFinancialModel" class="scenario-empty">
          Scenario not filled yet
        </p>
        <div class="scenario-grid">
          <div v-for="scenario in scenarioCards" :key="scenario.name" class="scenario-card">
            <strong>{{ scenario.name }}</strong>
            <NTag size="small" :type="statusType(scenario.status as IntelligenceEvidenceStatus)">{{ displayInvestmentStatus(scenario.status) }}</NTag>
            <small>{{ scenario.detail }}</small>
          </div>
        </div>
      </article>

      <article class="analysis-panel detail-panel">
        <div class="panel-title">
          <div>
            <h3>Process Equipment Detail</h3>
            <p>Equipment, spec, cost, source, and status remain source-gated.</p>
          </div>
        </div>
        <div class="detail-row head"><span>Equipment</span><span>Spec</span><span>Cost</span><span>Source</span><span>Status</span></div>
        <div v-for="row in processEquipmentRows" :key="row.item" class="detail-row">
          <span>{{ row.item }}</span><span>{{ displayInvestmentText(row.spec) }}</span><span>{{ displayInvestmentValue(row.cost) }}</span><span>{{ row.source }}</span><NTag size="small" :type="statusType(row.status)">{{ displayInvestmentStatus(row.status) }}</NTag>
        </div>
      </article>

      <article class="analysis-panel detail-panel">
        <div class="panel-title">
          <div>
            <h3>Utilities & Buildings Detail</h3>
            <p>Utility, building, and compliance scope must stay in Hermes twice-daily verification until quoted.</p>
          </div>
        </div>
        <div class="detail-row head"><span>Item</span><span>Spec</span><span>Cost</span><span>Source</span><span>Status</span></div>
        <div v-for="row in utilitiesBuildingRows" :key="row.item" class="detail-row">
          <span>{{ row.item }}</span><span>{{ displayInvestmentText(row.spec) }}</span><span>{{ displayInvestmentValue(row.cost) }}</span><span>{{ row.source }}</span><NTag size="small" :type="statusType(row.status)">{{ displayInvestmentStatus(row.status) }}</NTag>
        </div>
      </article>

      <article class="analysis-panel detail-panel">
        <div class="panel-title">
          <div>
            <h3>Working Capital Detail</h3>
            <p>Inventory, receivable, payable, and cash-buffer assumptions are not verified yet.</p>
          </div>
        </div>
        <div class="detail-row head"><span>Item</span><span>Assumption</span><span>Need</span><span>Source</span><span>Status</span></div>
        <div v-for="row in workingCapitalRows" :key="row.item" class="detail-row">
          <span>{{ row.item }}</span><span>{{ displayInvestmentText(row.spec) }}</span><span>{{ displayInvestmentValue(row.cost) }}</span><span>{{ row.source }}</span><NTag size="small" :type="statusType(row.status)">{{ displayInvestmentStatus(row.status) }}</NTag>
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
        <div class="analysis-actions">
          <RouterLink class="analysis-link" :to="{ name: 'hermes.investmentCalculator' }">Open IRR Calculator</RouterLink>
          <NButton size="small" secondary :loading="savingAction === 'finance-task'" @click="createMissingFinanceTask">Create Missing Cost Task</NButton>
          <NButton size="small" secondary @click="stageAnalysisReview">Add to Investor Presentation</NButton>
          <NButton size="small" secondary :loading="savingAction === 'schedule-refresh'" @click="scheduleRefreshJob">Do Deeper Analysis</NButton>
          <NButton size="small" secondary @click="stageAnalysisReview">Export / Copy Summary</NButton>
        </div>
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

  &.inline {
    min-height: auto;
    padding: 0;
    border: 0;
    background: transparent;
    overflow-wrap: anywhere;
  }
}

.financial-autopilot-panel {
  margin-bottom: 12px;
  border-color: rgba(var(--accent-primary-rgb), 0.42);
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.08), transparent 44%),
    $bg-card;
}

.financial-candidate-table {
  display: grid;
  gap: 5px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.financial-candidate-row {
  display: grid;
  grid-template-columns: minmax(150px, 1.1fr) minmax(150px, 1.2fr) minmax(160px, 1.1fr) minmax(130px, 0.9fr) minmax(110px, auto);
  gap: 10px;
  align-items: center;
  min-width: 820px;
  padding: 9px;
  border-radius: 6px;
  background: $bg-secondary;
  color: $text-secondary;
  font-size: 12px;

  > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  &.head {
    color: $accent-primary;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.financial-candidate-note {
  margin: 10px 0 0;
  color: $warning;
  font-size: 12px;
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
  }

  strong {
    color: $accent-primary;
    font-size: 22px;
    overflow-wrap: anywhere;
  }
}

.project-analysis-template {
  display: grid;
  gap: 14px;
  margin: 0 0 14px;
}

.template-hero,
.template-kpi-card,
.template-panel {
  border: 1px solid rgba(var(--accent-info-rgb), 0.24);
  border-radius: 8px;
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
    max-width: 860px;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.template-kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.template-kpi-card {
  display: grid;
  gap: 8px;
  min-height: 132px;
  padding: 16px;
  border-color: rgba(var(--accent-primary-rgb), 0.32);

  strong {
    color: $accent-primary;
    font-size: clamp(22px, 2.4vw, 34px);
    line-height: 1.05;
    overflow-wrap: anywhere;
  }

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  small {
    color: $text-secondary;
    font-size: 11px;
    line-height: 1.35;
  }
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

  &.compact {
    align-items: center;
  }
}

.template-breakdown-table {
  overflow-x: auto;
}

.template-breakdown-row {
  display: grid;
  grid-template-columns: minmax(210px, 1fr) minmax(320px, 1.45fr) minmax(120px, 0.7fr) minmax(86px, 0.45fr) minmax(90px, 0.45fr) minmax(190px, 1fr) minmax(130px, auto);
  gap: 10px;
  align-items: center;
  min-width: 1150px;
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

  &.total {
    border-top-color: rgba(var(--accent-primary-rgb), 0.6);
    color: $text-primary;
    font-weight: 900;
  }

  > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  strong span {
    color: $accent-primary;
  }
}

.template-placeholder-bar {
  display: block;
  width: 64px;
  height: 8px;
  border: 1px dashed rgba(var(--accent-primary-rgb), 0.45);
  border-radius: 999px;
  background: rgba(var(--text-muted-rgb), 0.12);
}

.template-detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.template-detail-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(150px, 1.1fr) minmax(90px, 0.6fr) minmax(90px, auto);
  gap: 8px;
  align-items: center;
  padding: 8px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;
  font-size: 12px;

  &.head {
    border-top: 0;
    color: $accent-primary;
    font-weight: 900;
    text-transform: uppercase;
  }

  > * {
    min-width: 0;
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
  overflow-x: auto;
  padding-bottom: 2px;
}

.table-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(130px, 1fr) minmax(90px, 0.7fr) minmax(70px, 0.5fr) minmax(70px, 0.5fr) minmax(130px, 1fr) minmax(110px, auto);
  gap: 8px;
  align-items: center;
  min-width: 780px;
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
  }
}

.placeholder-bar {
  display: block;
  width: 100%;
  max-width: 88px;
  height: 8px;
  border-radius: 999px;
  background: rgba(var(--text-muted-rgb), 0.3);
}

.detail-panel {
  grid-column: auto;
}

.detail-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(150px, 1.2fr) minmax(90px, 0.7fr) minmax(110px, 0.8fr) minmax(100px, auto);
  gap: 8px;
  align-items: center;
  padding: 8px;
  border-top: 1px solid $border-color;
  color: $text-secondary;
  font-size: 12px;

  &.head {
    border-top: 0;
    color: $accent-primary;
    font-weight: 900;
  }

  > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.analysis-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.scenario-grid {
  display: grid;
  gap: 8px;
}

.scenario-selector {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.scenario-option {
  min-height: 34px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;
  color: $text-secondary;
  font-weight: 900;
  cursor: pointer;

  &.selected {
    border-color: $accent-primary;
    background: rgba(var(--accent-primary-rgb), 0.12);
    color: $accent-primary;
    box-shadow: 0 0 0 1px rgba(var(--accent-primary-rgb), 0.18) inset;
  }
}

.scenario-empty {
  margin: 0 0 10px;
  color: $warning;
  font-size: 12px;
  font-weight: 800;
}

.scenario-card {
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;
}

.pdf-project-analysis-panel {
  display: grid;
  gap: 12px;
}

.pdf-kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(150px, 1fr));
  gap: 10px;
}

.pdf-breakdown-table {
  display: grid;
  gap: 5px;
  overflow-x: auto;
}

.pdf-breakdown-row {
  display: grid;
  grid-template-columns: minmax(210px, 1fr) minmax(340px, 1.4fr) minmax(125px, 0.7fr) minmax(80px, 0.45fr) minmax(210px, 1fr) minmax(125px, auto);
  gap: 9px;
  align-items: center;
  min-width: 1060px;
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

  &.total {
    border: 1px solid rgba(var(--accent-primary-rgb), 0.45);
    color: $text-primary;
    font-weight: 900;
  }

  > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.warning-list {
  margin: 0;
  padding-left: 18px;
  color: $text-secondary;
  line-height: 1.6;
}

@media (max-width: 900px) {
  .analysis-hero,
  .template-hero,
  .template-detail-grid,
  .analysis-grid {
    grid-template-columns: 1fr;
  }

  .template-kpi-grid,
  .pdf-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .template-panel-title {
    display: grid;
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
    min-width: 0;
  }

  .detail-row {
    grid-template-columns: 1fr;
  }

  .template-kpi-grid,
  .pdf-kpi-grid,
  .template-breakdown-row,
  .template-detail-row,
  .pdf-breakdown-row {
    grid-template-columns: 1fr;
  }

  .template-breakdown-row,
  .pdf-breakdown-row {
    min-width: 0;
  }

  .scenario-selector {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
