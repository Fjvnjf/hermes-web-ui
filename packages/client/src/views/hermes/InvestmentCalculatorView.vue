<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NInputNumber, useMessage } from 'naive-ui'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import {
  calculateInvestmentScenario,
  createEmptyInvestmentScenario,
  hasUsableInvestmentOutputs,
  listInvestmentEvidenceGaps,
  summarizeInvestmentEvidence,
  type EvidenceStatus,
  type InvestmentEvidenceGap,
  type InvestmentScenarioInput,
} from '@/utils/investmentCalculator'
import type { IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'
import { copyToClipboard } from '@/utils/clipboard'

type ScenarioKey = 'Lean' | 'Base' | 'Conservative' | 'Aggressive'

const STORAGE_KEY = 'hermes.investmentCalculator.scenarios.v1'
const message = useMessage()
const intelligence = useFeasibilityIntelligence()
const kanbanStore = useKanbanStore()
const scenarioKeys: ScenarioKey[] = ['Lean', 'Base', 'Conservative', 'Aggressive']
const activeScenario = ref<ScenarioKey>('Base')
const copied = ref(false)
const creatingFinancialTask = ref(false)
const creatingGapTaskId = ref('')

function makeScenario(name: ScenarioKey): InvestmentScenarioInput {
  const scenario = createEmptyInvestmentScenario(`Chemicon China Feasibility - ${name}`)
  scenario.products[0].name = 'CWAS / CWMS product mix'
  return scenario
}

function loadScenarios(): Record<ScenarioKey, InvestmentScenarioInput> {
  const fallback = Object.fromEntries(scenarioKeys.map(key => [key, makeScenario(key)])) as Record<ScenarioKey, InvestmentScenarioInput>
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    return { ...fallback, ...JSON.parse(raw) }
  } catch {
    return fallback
  }
}

const scenarios = reactive(loadScenarios())
const scenario = computed(() => scenarios[activeScenario.value])
const result = computed(() => calculateInvestmentScenario(scenario.value))
const evidenceSummary = computed(() => summarizeInvestmentEvidence(scenario.value))
const investmentEvidenceGaps = computed(() => listInvestmentEvidenceGaps(scenario.value))
const topInvestmentEvidenceGaps = computed(() => investmentEvidenceGaps.value.slice(0, 10))
const draftableFinancialOutputs = computed(() => hasUsableInvestmentOutputs(result.value))
const financialEvidenceStatus = computed<IntelligenceEvidenceStatus>(() => {
  if (!draftableFinancialOutputs.value || evidenceSummary.value.toVerify > 0) return 'To Verify'
  if (evidenceSummary.value.assumptions > 0) return 'Derived from Assumptions'
  return 'User Approved'
})
const financialPresentationEvidenceStatus = computed<IntelligenceEvidenceStatus>(() => {
  if (financialEvidenceStatus.value === 'User Approved') return 'User Approved'
  if (financialEvidenceStatus.value === 'Derived from Assumptions') return 'Derived from Assumptions'
  return 'To Verify'
})
const financialDraftButtonLabel = computed(() =>
  financialPresentationEvidenceStatus.value === 'To Verify'
    ? 'Stage To Verify finance draft'
    : 'Add assumption-labeled draft',
)
const latestFinancialModel = intelligence.latestFinancialModel

const evidenceOptions: EvidenceStatus[] = ['Assumption', 'User Provided', 'To Verify', 'Verified']
const costRows = [
  ['rawMaterials', 'Raw material cost / ton'],
  ['packaging', 'Packaging / ton'],
  ['labor', 'Direct labor / ton'],
  ['utilities', 'Utilities / ton'],
  ['logistics', 'Logistics / ton'],
  ['wasteTreatment', 'Waste treatment / ton'],
  ['contingency', 'Contingency / ton'],
] as const
const fixedRows = [
  ['rent', 'Factory rent / year'],
  ['fixedLabor', 'Fixed labor / year'],
  ['admin', 'Sales/admin / year'],
  ['maintenanceFixed', 'Maintenance / year'],
] as const
const capexRows = [
  ['machinery', 'Machinery'],
  ['installation', 'Installation'],
  ['factorySetup', 'Factory setup'],
  ['labEquipment', 'Lab equipment'],
  ['safetyFireSystems', 'Safety/fire systems'],
  ['wastewaterTreatment', 'Wastewater treatment'],
  ['tanksReactorsMixers', 'Tanks/reactors/mixers'],
  ['engineering', 'Engineering'],
  ['permitLegalCosts', 'Permit/legal costs'],
  ['officeSetup', 'Office setup'],
] as const

watch(
  scenarios,
  () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios))
  },
  { deep: true },
)

function ensureYears() {
  const years = Math.max(1, Math.min(20, Number(scenario.value.operatingYears) || 1))
  scenario.value.operatingYears = years
  scenario.value.timelineYears = years
  const product = scenario.value.products[0]
  product.annualVolumeTon = Array.from({ length: years }, (_, index) => Number(product.annualVolumeTon[index]) || 0)
  product.sellingPricePerTon = Array.from({ length: years }, (_, index) => Number(product.sellingPricePerTon[index]) || 0)
  product.capacityUtilization = Array.from({ length: years }, (_, index) => Number(product.capacityUtilization[index] ?? 1) || 0)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: scenario.value.currency || 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Not calculable'
  return `${(value * 100).toFixed(1)}%`
}

function formatMultiple(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Not calculable'
  return `${value.toFixed(2)}x`
}

function formatDate(value?: string): string {
  if (!value) return 'Not saved yet'
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function statusClass(status: EvidenceStatus): string {
  return `status-${status.toLowerCase().replace(/\s+/g, '-')}`
}

async function copySummary() {
  const text = financialSummaryText()
  copied.value = await copyToClipboard(text)
}

function financialSummaryText(): string {
  const safetyLabel = financialEvidenceStatus.value === 'To Verify'
    ? 'Some outputs depend on To Verify inputs and must not be used as investor claims until evidence is resolved.'
    : financialEvidenceStatus.value === 'Derived from Assumptions'
      ? 'All outputs are derived from assumptions and must not be treated as verified investor claims without source evidence.'
      : 'Outputs are based on user-approved or source-backed inputs, but still require final investor review.'
  return [
    `Project: ${scenario.value.projectName}`,
    `Scenario: ${activeScenario.value}`,
    `Evidence status: ${financialEvidenceStatus.value}`,
    `Evidence warning: ${result.value.incomplete ? 'Incomplete or unverified assumptions' : 'Inputs marked ready'}`,
    `NPV: ${formatCurrency(result.value.npv)}`,
    `IRR: ${formatPercent(result.value.irr)}`,
    `MIRR: ${formatPercent(result.value.mirr)}`,
    `Investor IRR: ${formatPercent(result.value.investorIrr)}`,
    `Investor MOIC: ${formatMultiple(result.value.investorMoic)}`,
    `Investor exit proceeds: ${result.value.investorExitProceeds == null ? 'Not calculable' : formatCurrency(result.value.investorExitProceeds)}`,
    `Payback: ${result.value.paybackYear ? `Year ${result.value.paybackYear}` : 'Not reached'}`,
    `Capex: ${formatCurrency(result.value.capexTotal)}`,
    `Funding gap: ${formatCurrency(result.value.fundingGap)}`,
    `Year 1 revenue: ${formatCurrency(result.value.yearly[0]?.revenue || 0)}`,
    '',
    result.value.warnings.length ? `Warnings:\n- ${result.value.warnings.join('\n- ')}` : 'Warnings: none from calculator completeness checks',
    '',
    safetyLabel,
  ].join('\n')
}

function financialSnapshotSource() {
  return {
    title: `IRR calculator ${activeScenario.value} scenario`,
    date: new Date().toISOString().slice(0, 10),
  }
}

function currentFinancialSnapshotInput() {
  return {
    scenarioName: activeScenario.value,
    projectName: scenario.value.projectName,
    currency: scenario.value.currency,
    evidenceStatus: financialEvidenceStatus.value,
    npv: result.value.npv,
    irr: result.value.irr,
    mirr: result.value.mirr,
    investorIrr: result.value.investorIrr,
    investorMoic: result.value.investorMoic,
    investorExitProceeds: result.value.investorExitProceeds,
    fundingGap: result.value.fundingGap,
    paybackYear: result.value.paybackYear,
    breakEvenVolumeTon: result.value.breakEvenVolumeTon,
    capexTotal: result.value.capexTotal,
    yearOneRevenue: result.value.yearly[0]?.revenue || 0,
    warnings: result.value.warnings,
    source: financialSnapshotSource(),
  }
}

function financialEvidenceTaskBody(): string {
  return [
    `Financial model evidence task: ${scenario.value.projectName}`,
    `Scenario: ${activeScenario.value}`,
    `Current financial evidence status: ${financialEvidenceStatus.value}`,
    `Weak inputs: ${evidenceSummary.value.weak} / ${evidenceSummary.value.total}`,
    `To Verify inputs: ${evidenceSummary.value.toVerify}`,
    `Assumption inputs: ${evidenceSummary.value.assumptions}`,
    `Verified inputs: ${evidenceSummary.value.verified}`,
    '',
    `NPV: ${formatCurrency(result.value.npv)}`,
    `IRR: ${formatPercent(result.value.irr)}`,
    `Investor IRR: ${formatPercent(result.value.investorIrr)}`,
    `Capex: ${formatCurrency(result.value.capexTotal)}`,
    `Year 1 revenue: ${formatCurrency(result.value.yearly[0]?.revenue || 0)}`,
    `Funding gap: ${formatCurrency(result.value.fundingGap)}`,
    '',
    result.value.warnings.length
      ? `Warnings:\n- ${result.value.warnings.join('\n- ')}`
      : 'Warnings: none from calculator completeness checks',
    '',
    'Recommended action: attach source evidence or user approval for weak financial assumptions before treating outputs as investor-ready.',
    'Source page: IRR / Investment Calculator',
    'Tags: Financial Model, Evidence Gap, IRR, Chemicon China Feasibility',
    '',
    'Do not treat IRR, NPV, investor return, or payback as verified investor claims until assumptions are source-backed or explicitly approved.',
  ].join('\n')
}

function financialDataRoomNotes(): string {
  return [
    `Project: ${scenario.value.projectName}`,
    `Scenario: ${activeScenario.value}`,
    `Evidence status: ${financialEvidenceStatus.value}`,
    `Weak inputs: ${evidenceSummary.value.weak} / ${evidenceSummary.value.total}`,
    `To Verify inputs: ${evidenceSummary.value.toVerify}`,
    `Assumption inputs: ${evidenceSummary.value.assumptions}`,
    `Verified inputs: ${evidenceSummary.value.verified}`,
    '',
    `NPV: ${formatCurrency(result.value.npv)}`,
    `IRR: ${formatPercent(result.value.irr)}`,
    `MIRR: ${formatPercent(result.value.mirr)}`,
    `Investor IRR: ${formatPercent(result.value.investorIrr)}`,
    `Investor MOIC: ${formatMultiple(result.value.investorMoic)}`,
    `Payback: ${result.value.paybackYear ? `Year ${result.value.paybackYear}` : 'Not reached'}`,
    `Capex: ${formatCurrency(result.value.capexTotal)}`,
    `Year 1 revenue: ${formatCurrency(result.value.yearly[0]?.revenue || 0)}`,
    '',
    result.value.warnings.length
      ? `Warnings:\n- ${result.value.warnings.join('\n- ')}`
      : 'Warnings: none from calculator completeness checks',
    '',
    'Registered from IRR / Investment Calculator. Outputs are derived model outputs, not verified investor claims unless the displayed evidence status supports investor use.',
  ].join('\n')
}

async function createFinancialEvidenceTask() {
  creatingFinancialTask.value = true
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Financial evidence: ${activeScenario.value} model assumptions`,
      body: financialEvidenceTaskBody(),
      priority: evidenceSummary.value.toVerify > 0 || result.value.incomplete ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Financial evidence task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create financial evidence task: ${detail}`)
  } finally {
    creatingFinancialTask.value = false
  }
}

function financialInputTaskBody(item: InvestmentEvidenceGap): string {
  return [
    `Financial input evidence gap: ${item.label}`,
    `Category: ${item.category}`,
    `Current evidence status: ${item.evidenceStatus}`,
    `Recommended action: ${item.recommendedAction}`,
    `Scenario: ${activeScenario.value}`,
    `Project: ${scenario.value.projectName}`,
    'Source page: IRR / Investment Calculator / Financial Input Evidence',
    'Tags: Financial Model, Input Evidence, Evidence Gap, Chemicon China Feasibility',
    '',
    'Do not use this input as investor-ready until it is source-backed, user-provided, or explicitly approved as an assumption.',
  ].join('\n')
}

async function createFinancialInputTask(item: InvestmentEvidenceGap) {
  creatingGapTaskId.value = item.id
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Verify financial input: ${item.label}`,
      body: financialInputTaskBody(item),
      priority: item.priority,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Financial input evidence task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create financial input task: ${detail}`)
  } finally {
    creatingGapTaskId.value = ''
  }
}

function saveFinancialSnapshot() {
  const saved = intelligence.saveFinancialModelSnapshot(currentFinancialSnapshotInput())
  void saved
  message.success('Financial model snapshot saved to Investor Readiness')
}

function registerFinancialModelInDataRoom() {
  if (!draftableFinancialOutputs.value) {
    message.warning('Add capex, revenue, and calculable cash flows before registering this model in the data room')
    return
  }
  const snapshot = intelligence.saveFinancialModelSnapshot(currentFinancialSnapshotInput())
  const saved = intelligence.addDataRoomSource({
    checklistLabel: 'Financial model with evidence status per input',
    area: 'financial',
    evidenceStatus: snapshot.evidenceStatus,
    source: snapshot.source || financialSnapshotSource(),
    notes: financialDataRoomNotes(),
  })
  if (saved.evidenceStatus === 'To Verify') {
    message.warning('Financial model registered as To Verify in the data room; resolve weak inputs before investor use')
  } else if (saved.evidenceStatus === 'Derived from Assumptions') {
    message.info('Financial model registered as assumption-derived data-room evidence')
  } else {
    message.success('Financial model registered in the investor data room')
  }
}

function addFinancialSummaryToDraft() {
  if (!draftableFinancialOutputs.value) {
    message.warning('Add capex, revenue, and calculable cash flows before staging financial output')
    return
  }
  const saved = intelligence.saveFinancialModelSnapshot(currentFinancialSnapshotInput())
  void saved
  intelligence.addPresentationMaterial({
    section: 'IRR / Investor Return',
    content: financialSummaryText(),
    evidenceStatus: financialPresentationEvidenceStatus.value,
    source: financialSnapshotSource(),
  })
  if (financialPresentationEvidenceStatus.value === 'To Verify') {
    message.warning('Financial summary staged as To Verify and excluded from investor slides until weak inputs are resolved')
  } else {
    intelligence.updateEvidenceStatus('presentation', 'User Approved')
    message.success('Assumption-labeled financial summary staged for investor draft')
  }
}
</script>

<template>
  <div class="calculator-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">IRR / investment calculator</p>
        <h2 class="header-title">Feasibility Investment Model</h2>
        <p class="page-copy">
          Frontend calculator for assumptions, cash flow, NPV, IRR, MIRR, payback, break-even, working capital, and
          sensitivity. Outputs are derived from assumptions until every input is source-backed.
        </p>
      </div>
      <div class="scenario-tabs">
        <button
          v-for="key in scenarioKeys"
          :key="key"
          type="button"
          :class="{ active: activeScenario === key }"
          @click="activeScenario = key"
        >
          {{ key }}
        </button>
      </div>
    </header>

    <NAlert v-if="result.incomplete" type="warning" :bordered="false" class="model-warning">
      IRR is calculated from incomplete or unverified data. Use this for planning only until source evidence is attached.
    </NAlert>

    <section class="model-status-grid" aria-label="Financial model readiness">
      <article class="status-card">
        <span>Financial evidence status</span>
        <strong>{{ financialEvidenceStatus }}</strong>
        <small>Outputs are never treated as verified facts automatically.</small>
      </article>
      <article class="status-card">
        <span>Input evidence</span>
        <strong>{{ evidenceSummary.weak }} weak / {{ evidenceSummary.total }} total</strong>
        <small>{{ evidenceSummary.toVerify }} to verify, {{ evidenceSummary.assumptions }} assumptions, {{ evidenceSummary.verified }} verified.</small>
      </article>
      <article class="status-card">
        <span>Latest saved model</span>
        <strong>{{ latestFinancialModel?.scenarioName || 'None' }}</strong>
        <small>{{ formatDate(latestFinancialModel?.createdAt) }}</small>
      </article>
      <article class="status-actions">
        <NButton secondary type="primary" @click="saveFinancialSnapshot">Save financial snapshot</NButton>
        <NButton secondary @click="registerFinancialModelInDataRoom">Register in data room</NButton>
        <NButton secondary @click="addFinancialSummaryToDraft">{{ financialDraftButtonLabel }}</NButton>
        <NButton secondary :loading="creatingFinancialTask" @click="createFinancialEvidenceTask">Create financial evidence task</NButton>
        <RouterLink :to="{ name: 'hermes.investorReadiness' }">Investor Readiness</RouterLink>
        <small v-if="draftableFinancialOutputs">
          Can stage as draft text. To Verify outputs stay excluded from investor slides; assumption-only outputs stay labeled as derived from assumptions.
        </small>
        <small v-else>
          Add capex and revenue until NPV/IRR are calculable before staging output.
        </small>
      </article>
    </section>

    <section class="cashflow-panel financial-gap-panel" aria-label="Financial input evidence checklist">
      <div class="panel-heading">
        <div>
          <h3>Financial Input Evidence Checklist</h3>
          <p>
            Weak inputs are the exact assumptions still blocking investor-safe financial outputs. Create targeted
            Tasks instead of one vague finance follow-up.
          </p>
        </div>
        <RouterLink :to="{ name: 'hermes.kanban' }">Open Tasks</RouterLink>
      </div>
      <div v-if="topInvestmentEvidenceGaps.length" class="financial-gap-list">
        <article v-for="item in topInvestmentEvidenceGaps" :key="item.id" class="financial-gap-row">
          <div>
            <strong>{{ item.label }}</strong>
            <p>{{ item.recommendedAction }}</p>
            <small>{{ item.category }} / {{ item.evidenceStatus }}</small>
          </div>
          <NButton
            size="tiny"
            secondary
            :loading="creatingGapTaskId === item.id"
            @click="createFinancialInputTask(item)"
          >
            Create input task
          </NButton>
        </article>
      </div>
      <p v-else class="empty-state">
        No weak financial inputs in the active scenario. Keep source labels attached before using outputs with investors.
      </p>
    </section>

    <section class="input-grid">
      <article class="input-panel">
        <h3>Project Setup</h3>
        <label>Project name <NInput v-model:value="scenario.projectName" /></label>
        <label>Currency <NInput v-model:value="scenario.currency" /></label>
        <label>Operating years <NInputNumber v-model:value="scenario.operatingYears" :min="1" :max="20" @update:value="ensureYears" /></label>
        <label>
          Setup months
          <NInputNumber v-model:value="scenario.setupMonths.value" :min="0" />
          <select v-model="scenario.setupMonths.evidenceStatus" aria-label="Setup months evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Discount rate
          <NInputNumber v-model:value="scenario.discountRate.value" :step="0.01" :min="0" />
          <select v-model="scenario.discountRate.evidenceStatus" aria-label="Discount rate evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Tax rate
          <NInputNumber v-model:value="scenario.taxRate.value" :step="0.01" :min="0" />
          <select v-model="scenario.taxRate.evidenceStatus" aria-label="Tax rate evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Terminal / salvage value
          <NInputNumber v-model:value="scenario.salvageValue.value" :min="0" />
          <select v-model="scenario.salvageValue.evidenceStatus" aria-label="Terminal value evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
      </article>

      <article class="input-panel">
        <h3>Funding</h3>
        <label>
          Investor amount
          <NInputNumber v-model:value="scenario.funding.investorAmount.value" :min="0" />
          <select v-model="scenario.funding.investorAmount.evidenceStatus" aria-label="Investor amount evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Founder contribution
          <NInputNumber v-model:value="scenario.funding.founderContribution.value" :min="0" />
          <select v-model="scenario.funding.founderContribution.evidenceStatus" aria-label="Founder contribution evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Investor equity %
          <NInputNumber v-model:value="scenario.funding.investorEquityPercent.value" :step="0.01" :min="0" />
          <select v-model="scenario.funding.investorEquityPercent.evidenceStatus" aria-label="Investor equity evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Exit year
          <NInputNumber v-model:value="scenario.funding.exitYear.value" :min="0" />
          <select v-model="scenario.funding.exitYear.evidenceStatus" aria-label="Exit year evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Exit multiple
          <NInputNumber v-model:value="scenario.funding.exitMultiple.value" :min="0" />
          <select v-model="scenario.funding.exitMultiple.evidenceStatus" aria-label="Exit multiple evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
      </article>

      <article class="input-panel">
        <h3>Working Capital</h3>
        <label>
          Raw material inventory days
          <NInputNumber v-model:value="scenario.workingCapital.rawMaterialInventoryDays.value" :min="0" />
          <select v-model="scenario.workingCapital.rawMaterialInventoryDays.evidenceStatus" aria-label="Raw material inventory evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Finished goods inventory days
          <NInputNumber v-model:value="scenario.workingCapital.finishedGoodsInventoryDays.value" :min="0" />
          <select v-model="scenario.workingCapital.finishedGoodsInventoryDays.evidenceStatus" aria-label="Finished goods inventory evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Customer credit days / DSO
          <NInputNumber v-model:value="scenario.workingCapital.customerCreditDays.value" :min="0" />
          <select v-model="scenario.workingCapital.customerCreditDays.evidenceStatus" aria-label="Customer credit days evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Supplier credit days / DPO
          <NInputNumber v-model:value="scenario.workingCapital.supplierCreditDays.value" :min="0" />
          <select v-model="scenario.workingCapital.supplierCreditDays.evidenceStatus" aria-label="Supplier credit days evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Safety cash buffer
          <NInputNumber v-model:value="scenario.workingCapital.safetyCashBuffer.value" :min="0" />
          <select v-model="scenario.workingCapital.safetyCashBuffer.evidenceStatus" aria-label="Safety cash buffer evidence status">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
      </article>
    </section>

    <section class="input-panel wide">
      <div class="panel-heading">
        <h3>Revenue Assumptions</h3>
        <span :class="statusClass(scenario.products[0].evidenceStatus)">{{ scenario.products[0].evidenceStatus }}</span>
      </div>
      <label>Product list / mix <NInput v-model:value="scenario.products[0].name" /></label>
      <label>
        Revenue evidence status
        <select v-model="scenario.products[0].evidenceStatus" aria-label="Revenue assumptions evidence status">
          <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
        </select>
      </label>
      <div class="year-table">
        <div class="year-row head">
          <span>Year</span>
          <span>Volume MT</span>
          <span>Selling price / ton</span>
          <span>Utilization</span>
        </div>
        <div v-for="(_, index) in scenario.products[0].annualVolumeTon" :key="index" class="year-row">
          <span>Year {{ index + 1 }}</span>
          <NInputNumber v-model:value="scenario.products[0].annualVolumeTon[index]" :min="0" />
          <NInputNumber v-model:value="scenario.products[0].sellingPricePerTon[index]" :min="0" />
          <NInputNumber v-model:value="scenario.products[0].capacityUtilization[index]" :step="0.05" :min="0" :max="1" />
        </div>
      </div>
    </section>

    <section class="assumption-grid">
      <article class="input-panel">
        <h3>Cost Assumptions</h3>
        <label v-for="[key, label] in costRows" :key="key">
          {{ label }}
          <NInputNumber v-model:value="scenario.variableCostPerTon[key].value" :min="0" />
          <select v-model="scenario.variableCostPerTon[key].evidenceStatus">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
      </article>

      <article class="input-panel">
        <h3>Fixed Costs</h3>
        <label v-for="[key, label] in fixedRows" :key="key">
          {{ label }}
          <NInputNumber v-model:value="scenario.annualFixedCosts[key].value" :min="0" />
          <select v-model="scenario.annualFixedCosts[key].evidenceStatus">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
      </article>

      <article class="input-panel">
        <h3>Capex</h3>
        <label v-for="[key, label] in capexRows" :key="key">
          {{ label }}
          <NInputNumber v-model:value="scenario.capex[key].value" :min="0" />
          <select v-model="scenario.capex[key].evidenceStatus">
            <option v-for="status in evidenceOptions" :key="status">{{ status }}</option>
          </select>
        </label>
      </article>
    </section>

    <section class="outputs">
      <article class="metric-card"><span>NPV</span><strong>{{ formatCurrency(result.npv) }}</strong></article>
      <article class="metric-card"><span>IRR</span><strong>{{ formatPercent(result.irr) }}</strong></article>
      <article class="metric-card"><span>MIRR</span><strong>{{ formatPercent(result.mirr) }}</strong></article>
      <article class="metric-card"><span>Payback</span><strong>{{ result.paybackYear ? `Year ${result.paybackYear}` : 'Not reached' }}</strong></article>
      <article class="metric-card"><span>Break-even volume</span><strong>{{ result.breakEvenVolumeTon ? `${result.breakEvenVolumeTon.toFixed(0)} MT` : 'Not calculable' }}</strong></article>
      <article class="metric-card"><span>Working capital Y1</span><strong>{{ formatCurrency(result.yearly[0]?.workingCapitalRequirement || 0) }}</strong></article>
    </section>

    <section class="investor-return-panel" aria-label="Investor return lens">
      <div class="panel-heading">
        <div>
          <h3>Investor Return Lens</h3>
          <p>
            Uses only the funding assumptions above. Investor IRR is not a claim unless investor amount, equity,
            exit year, exit multiple, and source evidence are user-approved.
          </p>
        </div>
      </div>
      <div class="outputs investor-outputs">
        <article class="metric-card">
          <span>Total funding</span>
          <strong>{{ formatCurrency(result.totalFunding) }}</strong>
        </article>
        <article class="metric-card">
          <span>Funding gap</span>
          <strong>{{ formatCurrency(result.fundingGap) }}</strong>
        </article>
        <article class="metric-card">
          <span>Exit proceeds</span>
          <strong>{{ result.investorExitProceeds == null ? 'Not calculable' : formatCurrency(result.investorExitProceeds) }}</strong>
        </article>
        <article class="metric-card">
          <span>Investor MOIC</span>
          <strong>{{ formatMultiple(result.investorMoic) }}</strong>
        </article>
        <article class="metric-card">
          <span>Investor IRR</span>
          <strong>{{ formatPercent(result.investorIrr) }}</strong>
        </article>
      </div>
    </section>

    <section class="cashflow-panel">
      <div class="panel-heading">
        <h3>Yearly Cash Flow</h3>
        <NButton size="small" secondary @click="copySummary">{{ copied ? 'Copied' : 'Copy summary' }}</NButton>
      </div>
      <div class="cashflow-table">
        <div class="cashflow-row head">
          <span>Year</span><span>Revenue</span><span>Gross Profit</span><span>EBITDA</span><span>FCF</span><span>Cumulative</span>
        </div>
        <div v-for="row in result.yearly" :key="row.year" class="cashflow-row">
          <span>{{ row.year }}</span>
          <span>{{ formatCurrency(row.revenue) }}</span>
          <span>{{ formatCurrency(row.grossProfit) }}</span>
          <span>{{ formatCurrency(row.ebitda) }}</span>
          <span>{{ formatCurrency(row.freeCashFlow) }}</span>
          <span>{{ formatCurrency(row.cumulativeCashFlow) }}</span>
        </div>
      </div>
    </section>

    <section class="cashflow-panel">
      <h3>Sensitivity Table</h3>
      <div class="cashflow-table">
        <div class="cashflow-row head"><span>Case</span><span>NPV</span><span>IRR</span><span>Price</span><span>Cost</span></div>
        <div v-for="item in result.sensitivity" :key="item.label" class="cashflow-row">
          <span>{{ item.label }}</span>
          <span>{{ formatCurrency(item.npv) }}</span>
          <span>{{ formatPercent(item.irr) }}</span>
          <span>{{ (item.priceFactor * 100).toFixed(0) }}%</span>
          <span>{{ (item.costFactor * 100).toFixed(0) }}%</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.calculator-view {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.input-panel,
.metric-card,
.investor-return-panel,
.cashflow-panel {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  padding: 18px;
  align-items: start;
}

.eyebrow {
  margin: 0 0 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.page-copy {
  max-width: 850px;
  color: $text-secondary;
  line-height: 1.55;
}

.scenario-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  button {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    padding: 8px 12px;
    background: transparent;
    color: $text-secondary;
    font-weight: 900;
    cursor: pointer;

    &.active {
      border-color: $accent-primary;
      color: $bg-primary;
      background: $accent-primary;
    }
  }
}

.model-warning {
  margin: 14px 0;
}

.input-grid,
.model-status-grid,
.assumption-grid,
.outputs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
  margin: 14px 0;
}

.investor-return-panel {
  margin: 14px 0;
  padding: 16px;

  p {
    margin: 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.investor-outputs {
  margin-bottom: 0;
}

.financial-gap-panel {
  margin: 14px 0;
}

.financial-gap-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.financial-gap-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-panel;

  strong {
    color: $text-primary;
  }

  p {
    margin: 5px 0;
    color: $text-secondary;
    line-height: 1.45;
  }

  small {
    color: $text-muted;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }
}

.empty-state {
  margin: 12px 0 0;
  color: $text-secondary;
  line-height: 1.55;
}

.model-status-grid {
  margin: 14px 0;
}

.status-card,
.status-actions {
  min-height: 120px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
  padding: 14px;
}

.status-card {
  display: grid;
  gap: 8px;

  span {
    color: $text-muted;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 18px;
  }

  small {
    color: $text-secondary;
    line-height: 1.45;
  }
}

.status-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-content: center;

  a {
    display: inline-flex;
    min-height: 32px;
    align-items: center;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    padding: 0 10px;
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
    text-decoration: none;
  }

  small {
    flex-basis: 100%;
    color: $text-secondary;
    line-height: 1.45;
  }
}

.input-panel,
.cashflow-panel {
  padding: 16px;

  h3 {
    margin: 0 0 12px;
    color: $text-primary;
  }

  label {
    display: grid;
    gap: 6px;
    margin-bottom: 10px;
    color: $text-secondary;
    font-size: 12px;
    font-weight: 800;
  }

  select {
    min-height: 32px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-input;
    color: $text-primary;
  }
}

.wide {
  margin: 14px 0;
}

.panel-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;

  p {
    margin: 5px 0 0;
    color: $text-secondary;
    line-height: 1.45;
  }
}

.year-table,
.cashflow-table {
  display: grid;
  gap: 6px;
}

.year-row,
.cashflow-row {
  display: grid;
  grid-template-columns: 90px repeat(3, minmax(120px, 1fr));
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;

  &.head {
    color: $accent-primary;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.cashflow-row {
  grid-template-columns: 70px repeat(5, minmax(110px, 1fr));
  overflow-x: auto;
}

.metric-card {
  min-height: 96px;
  padding: 14px;

  span {
    color: $text-muted;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    display: block;
    margin-top: 10px;
    color: $accent-primary;
    font-size: 20px;
  }
}

.status-to-verify,
.status-assumption {
  color: $warning;
  font-weight: 900;
}

.status-verified,
.status-user-provided {
  color: $success;
  font-weight: 900;
}

@media (max-width: 860px) {
  .page-header,
  .year-row,
  .cashflow-row {
    grid-template-columns: 1fr;
  }

  .financial-gap-row {
    grid-template-columns: 1fr;
    align-items: start;
  }
}
</style>
