<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { calculateInvestorReadinessScore, type ReadinessItem } from '@/utils/investorIntelligence'
import { copyToClipboard } from '@/utils/clipboard'

interface ReadinessSection extends ReadinessItem {
  description: string
  nextAction: string
  routeName: string
}

const message = useMessage()
const kanbanStore = useKanbanStore()
const creatingKey = ref('')
const localAssumptions = ref<Set<string>>(new Set())

const sections = computed<ReadinessSection[]>(() => [
  {
    label: 'Company / legal evidence',
    evidenceStatus: 'To Verify',
    description: 'Business license, company name, business scope, bank confirmation, import/export permission.',
    nextAction: 'Upload source documents or create evidence tasks before using this in investor material.',
    routeName: 'hermes.files',
    weight: 1.2,
  },
  {
    label: 'Product evidence',
    evidenceStatus: 'To Verify',
    description: 'TDS/SDS, formula/CAS list, product equivalents, and verified launch-product scope.',
    nextAction: 'Collect and source product documents for CWAS 90%+ and CWMS 70%.',
    routeName: 'hermes.files',
    weight: 1.2,
  },
  {
    label: 'Factory evidence',
    evidenceStatus: 'Missing',
    description: 'Location shortlist, rent offers, chemical approval, machine quotes, utilities, waste treatment.',
    nextAction: 'Create tasks for quote collection and site approval checks.',
    routeName: 'hermes.kanban',
    weight: 1.1,
  },
  {
    label: 'Regulatory evidence',
    evidenceStatus: 'Missing',
    description: 'DMS status, product handling, China chemical permissions, safety/fire and environmental requirements.',
    nextAction: 'Run source-backed regulatory research and track every gap as a task.',
    routeName: 'hermes.chat',
    weight: 1.3,
  },
  {
    label: 'Market evidence',
    evidenceStatus: 'To Verify',
    description: 'Customer interviews, distributor responses, competitor price proof, and sourced demand claims.',
    nextAction: 'Use Market and Competitor Intelligence to collect source-backed claims only.',
    routeName: 'hermes.marketIntelligence',
    weight: 1.2,
  },
  {
    label: 'Financial model completeness',
    evidenceStatus: 'Assumption',
    description: 'Year 1 15,000 MT model, working capital, capex, opex, pricing, tax, and IRR sensitivity.',
    nextAction: 'Use the IRR calculator and label every input by evidence status.',
    routeName: 'hermes.investmentCalculator',
    weight: 1.2,
  },
  {
    label: 'Investor presentation completeness',
    evidenceStatus: 'Missing',
    description: 'Executive story, evidence-backed claims, use of funds, risks, and data-room readiness.',
    nextAction: 'Build draft slides only from verified or user-approved material.',
    routeName: 'hermes.investorPresentation',
    weight: 1,
  },
])

const readinessScore = computed(() => calculateInvestorReadinessScore(sections.value))
const statusCounts = computed(() => {
  return sections.value.reduce<Record<string, number>>((acc, item) => {
    acc[item.evidenceStatus] = (acc[item.evidenceStatus] || 0) + 1
    return acc
  }, {})
})

const quickLinks = [
  { label: 'Chat', to: { name: 'hermes.chat', query: { captureContext: 'investment-research' } } },
  { label: 'Documents', to: { name: 'hermes.files' } },
  { label: 'Tasks', to: { name: 'hermes.kanban' } },
  { label: 'Memory', to: { name: 'hermes.memory' } },
  { label: 'Feasibility Studio', to: { name: 'hermes.feasibility' } },
  { label: 'Reports Hub', to: { name: 'hermes.reportsHub' } },
]

const dataRoomChecklist = [
  'Company registration and business scope',
  'Product TDS/SDS and CAS evidence',
  'Supplier quotes and raw-material cost sheets',
  'Machine quotes, capacity, and utility assumptions',
  'Factory/rent/permit evidence',
  'Customer, distributor, and competitor price evidence',
  'Financial model with evidence status per input',
  'Risk register and mitigation tasks',
]

function taskBody(item: ReadinessSection): string {
  return [
    `Investor readiness evidence gap: ${item.label}`,
    `Current evidence status: ${item.evidenceStatus}`,
    `Recommended next action: ${item.nextAction}`,
    `Source page: Investor Readiness Center`,
    'Tags: Investor Readiness, Evidence Gap, Chemicon China Feasibility',
    '',
    'Do not mark this investor-ready until source evidence is uploaded or user-approved.',
  ].join('\n')
}

async function createEvidenceTask(item: ReadinessSection) {
  creatingKey.value = item.label
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Investor evidence: ${item.label}`,
      body: taskBody(item),
      priority: item.evidenceStatus === 'Missing' ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Evidence task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    creatingKey.value = ''
  }
}

async function copyForPresentation(item: ReadinessSection) {
  const copied = await copyToClipboard([
    `${item.label}`,
    `Status: ${item.evidenceStatus}`,
    item.description,
    `Next action: ${item.nextAction}`,
  ].join('\n'))
  if (copied) message.success('Copied investor readiness note')
  else message.warning('Clipboard blocked')
}

function markAssumption(item: ReadinessSection) {
  const next = new Set(localAssumptions.value)
  next.add(item.label)
  localAssumptions.value = next
  message.info('Marked as a local assumption for this review only')
}
</script>

<template>
  <div class="investor-workspace">
    <header class="page-header">
      <div>
        <p class="eyebrow">Investor readiness center</p>
        <h2 class="header-title">Investor-Ready Feasibility Intelligence</h2>
        <p class="page-copy">
          Preparation workspace for Chemicon China feasibility. Missing data is shown as Missing / To Verify; no
          market numbers or investor claims are invented here.
        </p>
      </div>
      <div class="score-panel">
        <strong>{{ readinessScore }}%</strong>
        <span>Investor Readiness Score</span>
        <small>Derived from evidence status only</small>
      </div>
    </header>

    <section class="quick-links" aria-label="Investor readiness links">
      <RouterLink v-for="link in quickLinks" :key="link.label" :to="link.to">{{ link.label }}</RouterLink>
    </section>

    <section class="status-strip" aria-label="Readiness status summary">
      <span>Verified: {{ statusCounts.Verified || 0 }}</span>
      <span>User Approved: {{ statusCounts['User Approved'] || 0 }}</span>
      <span>Assumptions: {{ statusCounts.Assumption || 0 }}</span>
      <span>To Verify: {{ statusCounts['To Verify'] || 0 }}</span>
      <span>Missing: {{ statusCounts.Missing || 0 }}</span>
    </section>

    <section class="readiness-grid" aria-label="Investor readiness sections">
      <article v-for="item in sections" :key="item.label" class="readiness-card">
        <div class="card-head">
          <h3>{{ item.label }}</h3>
          <span class="status-pill">{{ localAssumptions.has(item.label) ? 'Assumption' : item.evidenceStatus }}</span>
        </div>
        <p>{{ item.description }}</p>
        <small>{{ item.nextAction }}</small>
        <div class="card-actions">
          <NButton size="tiny" secondary type="primary" :loading="creatingKey === item.label" @click="createEvidenceTask(item)">
            Create task for missing evidence
          </NButton>
          <RouterLink :to="{ name: 'hermes.chat', query: { captureContext: 'investment-research' } }">Send to Review & Capture</RouterLink>
          <button type="button" @click="markAssumption(item)">Mark as assumption</button>
          <button type="button" @click="copyForPresentation(item)">Copy for presentation</button>
          <RouterLink :to="{ name: item.routeName }">Open source area</RouterLink>
        </div>
      </article>
    </section>

    <section class="support-grid">
      <article>
        <h3>Risk Register</h3>
        <p>Risks are not auto-promoted. Add each missing proof, regulatory uncertainty, and weak assumption to Tasks.</p>
      </article>
      <article>
        <h3>Financial Model Status</h3>
        <p>IRR is not investor-ready until price, cost, capex, working capital, tax, and capacity assumptions have evidence status.</p>
        <RouterLink :to="{ name: 'hermes.investmentCalculator' }">Open IRR calculator</RouterLink>
      </article>
      <article>
        <h3>Presentation Draft Builder</h3>
        <p>Draft material must be Verified, User Approved, or visibly labeled Approved Assumption.</p>
        <RouterLink :to="{ name: 'hermes.investorPresentation' }">Open presentation builder</RouterLink>
      </article>
    </section>

    <section class="data-room">
      <div>
        <p class="eyebrow">Data room checklist</p>
        <h3>Investor Evidence Pack</h3>
      </div>
      <ul>
        <li v-for="item in dataRoomChecklist" :key="item">{{ item }} <span>Missing / To Verify</span></li>
      </ul>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.investor-workspace {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.readiness-card,
.support-grid article,
.data-room,
.score-panel {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 16px;
  align-items: stretch;
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
.readiness-card p,
.support-grid p,
.data-room li {
  color: $text-secondary;
  line-height: 1.55;
}

.score-panel {
  display: grid;
  place-items: center;
  gap: 4px;
  padding: 16px;
  text-align: center;

  strong {
    color: $accent-primary;
    font-size: 42px;
  }

  span {
    color: $text-primary;
    font-weight: 900;
  }

  small {
    color: $text-muted;
  }
}

.quick-links,
.status-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0;

  a,
  span {
    min-height: 34px;
    padding: 8px 12px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    color: $accent-info;
    text-decoration: none;
    font-weight: 800;
  }
}

.readiness-grid,
.support-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}

.readiness-card,
.support-grid article,
.data-room {
  padding: 16px;
}

.card-head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 16px;
  }
}

.status-pill {
  flex: 0 0 auto;
  padding: 4px 8px;
  border: 1px solid rgba(var(--warning-rgb), 0.45);
  border-radius: 999px;
  color: $warning;
  font-size: 11px;
  font-weight: 900;
}

.readiness-card small {
  display: block;
  color: $text-muted;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;

  a,
  button {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    padding: 6px 9px;
    background: transparent;
    color: $accent-info;
    font: inherit;
    font-size: 12px;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
  }
}

.support-grid {
  margin-top: 12px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }

  a {
    color: $accent-info;
    font-weight: 800;
  }
}

.data-room {
  margin-top: 12px;

  h3 {
    margin: 0;
    color: $text-primary;
  }

  ul {
    display: grid;
    gap: 8px;
    padding: 0;
    margin: 14px 0 0;
    list-style: none;
  }

  li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid $border-color;
  }

  span {
    color: $warning;
    font-weight: 900;
  }
}

@media (max-width: 760px) {
  .page-header {
    grid-template-columns: 1fr;
  }
}
</style>
