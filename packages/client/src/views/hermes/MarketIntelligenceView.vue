<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { normalizedMarketClaimStatus, type IntelligenceEvidenceStatus, type MarketClaim } from '@/utils/investorIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const creating = ref('')

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
    intelligence.addResearchJob({
      title: `Market research: ${label}`,
      question: label,
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

function addClaim() {
  const label = claimForm.value.label.trim()
  if (!label) {
    message.warning('Add a claim or research question first')
    return
  }
  const source = claimForm.value.sourceTitle.trim()
    ? {
        title: claimForm.value.sourceTitle.trim(),
        url: claimForm.value.sourceUrl.trim() || undefined,
        date: claimForm.value.sourceDate.trim() || undefined,
      }
    : null
  const saved = intelligence.addMarketClaim({
    label,
    value: claimForm.value.value.trim(),
    evidenceStatus: claimForm.value.evidenceStatus,
    confidence: claimForm.value.confidence,
    source,
  })
  if (claimForm.value.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Claim saved as To Verify because verified claims need a value and usable source')
  } else {
    message.success('Market claim saved in this browser workspace')
  }
  claimForm.value = {
    label: '',
    value: '',
    evidenceStatus: 'To Verify',
    confidence: 'low',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
  }
}

function addClaimToInvestorReview(claim: MarketClaim) {
  const status = normalizedMarketClaimStatus(claim)
  intelligence.updateEvidenceStatus('market', status, claim.source || null)
  if (status === 'Verified') message.success('Market evidence marked verified for investor readiness')
  else message.info('Market evidence remains To Verify until value and source are complete')
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

    <section class="claim-form" aria-label="Add market claim">
      <div>
        <h3>Add sourced market claim</h3>
        <p>Saved locally in this browser workspace. Verified status requires a claim value plus a source title and URL or date.</p>
      </div>
      <label>
        Claim
        <input v-model="claimForm.label" type="text" placeholder="Example: CWAS price validation source" />
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
      <NButton secondary type="primary" @click="addClaim">Save claim</NButton>
    </section>

    <section class="claims-panel">
      <h3>Verified / To Verify Claims</h3>
      <div class="claim-row head">
        <span>Claim</span><span>Value</span><span>Source</span><span>Status</span><span>Last checked</span><span>Action</span>
      </div>
      <p v-if="claims.length === 0" class="empty-state">
        No market claims saved yet. Add source-backed claims here, or create research tasks from the cards above.
      </p>
      <div v-for="claim in claims" :key="claim.label" class="claim-row">
        <span>{{ claim.label }}</span>
        <span>{{ claim.value || 'To Verify' }}</span>
        <span>{{ claim.source?.title || 'Source missing' }}</span>
        <span>{{ normalizedMarketClaimStatus(claim) }}</span>
        <span>{{ claim.lastChecked || 'Not checked' }}</span>
        <span>
          <button type="button" @click="addClaimToInvestorReview(claim)">Add to investor review</button>
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
.claim-form,
.claims-panel {
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
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
  grid-template-columns: 1.2fr 1fr 1fr 130px 130px 150px;
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
}

.empty-state {
  border-top: 1px solid $border-color;
  margin: 0;
  padding: 12px 0 0;
  color: $text-secondary;
}

@media (max-width: 820px) {
  .page-header,
  .claim-row {
    grid-template-columns: 1fr;
  }
}
</style>
