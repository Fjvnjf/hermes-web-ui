<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { normalizedMarketClaimStatus, type MarketClaim } from '@/utils/investorIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const creating = ref('')

const claims = ref<MarketClaim[]>([
  {
    label: 'China textile softener demand',
    value: '',
    evidenceStatus: 'To Verify',
    confidence: 'low',
    source: null,
  },
  {
    label: 'CWAS/CWMS price validation',
    value: '',
    evidenceStatus: 'To Verify',
    confidence: 'low',
    source: null,
  },
])

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

const sourceReadyCount = computed(() => claims.value.filter(item => normalizedMarketClaimStatus(item) === 'Verified').length)

async function createResearchTask(label: string) {
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
    message.success('Market research task created')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    creating.value = ''
  }
}
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
      </div>
      <div class="summary-card">
        <strong>{{ sourceReadyCount }}</strong>
        <span>verified claims</span>
        <small>source required</small>
      </div>
    </header>

    <section class="section-grid">
      <article v-for="section in sections" :key="section" class="workspace-card">
        <h3>{{ section }}</h3>
        <p>Missing / To Verify until source-backed research is captured and approved.</p>
        <div class="actions">
          <NButton size="tiny" secondary type="primary" :loading="creating === section" @click="createResearchTask(section)">
            Research this market
          </NButton>
          <RouterLink :to="{ name: 'hermes.kanban' }">Create task</RouterLink>
          <RouterLink :to="{ name: 'hermes.investorReadiness' }">Add claim to investor review</RouterLink>
        </div>
      </article>
    </section>

    <section class="claims-panel">
      <h3>Verified / To Verify Claims</h3>
      <div class="claim-row head">
        <span>Claim</span><span>Value</span><span>Source</span><span>Status</span><span>Last checked</span>
      </div>
      <div v-for="claim in claims" :key="claim.label" class="claim-row">
        <span>{{ claim.label }}</span>
        <span>{{ claim.value || 'To Verify' }}</span>
        <span>{{ claim.source?.title || 'Source missing' }}</span>
        <span>{{ normalizedMarketClaimStatus(claim) }}</span>
        <span>{{ claim.lastChecked || 'Not checked' }}</span>
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
.claims-panel,
.summary-card {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
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

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
  margin: 14px 0;
}

.workspace-card,
.claims-panel {
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
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
  grid-template-columns: 1.2fr 1fr 1fr 130px 130px;
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
}

@media (max-width: 820px) {
  .page-header,
  .claim-row {
    grid-template-columns: 1fr;
  }
}
</style>
