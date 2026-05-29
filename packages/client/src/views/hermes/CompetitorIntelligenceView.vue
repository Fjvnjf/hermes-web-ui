<script setup lang="ts">
import { ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { formatMarketShare } from '@/utils/investorIntelligence'

interface CompetitorRecord {
  companyName: string
  countryRegion: string
  productEquivalent: string
  activeContent: string
  pricingEvidence: string
  certifications: string
  distributionPresence: string
  marketShare?: string
  evidenceStatus: 'To Verify' | 'Verified' | 'Missing'
  sourceLink: string
  notes: string
}

const message = useMessage()
const kanbanStore = useKanbanStore()
const creating = ref('')

const competitors = ref<CompetitorRecord[]>([
  {
    companyName: 'Competitor to identify',
    countryRegion: 'To Verify',
    productEquivalent: 'To Verify',
    activeContent: 'To Verify',
    pricingEvidence: 'Missing',
    certifications: 'To Verify',
    distributionPresence: 'To Verify',
    marketShare: '',
    evidenceStatus: 'To Verify',
    sourceLink: '',
    notes: 'No competitor should be treated as real until a source is attached.',
  },
])

async function createResearchTask(competitor: CompetitorRecord) {
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
        'Market share must stay To Verify unless backed by a credible source.',
        'Tags: Competitor Intelligence, Research Job, To Verify',
      ].join('\n'),
      priority: 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Competitor research task created')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    creating.value = ''
  }
}
</script>

<template>
  <div class="competitor-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Competitor intelligence</p>
        <h2 class="header-title">Evidence-Backed Competitor Tracking</h2>
        <p class="page-copy">
          Track product equivalents, pricing evidence, certifications, distribution presence, and source links. Unknown
          market share is always displayed as To Verify.
        </p>
      </div>
      <RouterLink class="header-link" :to="{ name: 'hermes.marketIntelligence' }">Market Intelligence</RouterLink>
    </header>

    <section class="competitor-table" aria-label="Competitor list">
      <div class="competitor-row head">
        <span>Company</span><span>Region</span><span>Equivalent</span><span>Pricing</span><span>Market share</span><span>Status</span><span>Action</span>
      </div>
      <div v-for="competitor in competitors" :key="competitor.companyName" class="competitor-row">
        <span>{{ competitor.companyName }}</span>
        <span>{{ competitor.countryRegion }}</span>
        <span>{{ competitor.productEquivalent }}</span>
        <span>{{ competitor.pricingEvidence }}</span>
        <span>{{ formatMarketShare(competitor.marketShare) }}</span>
        <span>{{ competitor.evidenceStatus }}</span>
        <span>
          <NButton size="tiny" secondary type="primary" :loading="creating === competitor.companyName" @click="createResearchTask(competitor)">
            Research competitor
          </NButton>
        </span>
      </div>
    </section>

    <section class="detail-grid">
      <article>
        <h3>Product equivalents</h3>
        <p>To Verify until product active content and source documents are attached.</p>
      </article>
      <article>
        <h3>Pricing evidence</h3>
        <p>Use quotes, invoices, screenshots, distributor proof, or cited public sources. No fake percentages.</p>
      </article>
      <article>
        <h3>Strengths / weaknesses</h3>
        <p>Write notes only after sources are reviewed. Unsourced claims should remain To Verify.</p>
      </article>
      <article>
        <h3>Research jobs</h3>
        <p>Use Kanban tasks for competitor research until scheduled research jobs are safely integrated.</p>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.competitor-view {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.competitor-table,
.detail-grid article {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
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
.detail-grid p {
  color: $text-secondary;
  line-height: 1.55;
}

.header-link,
.detail-grid a {
  color: $accent-info;
  font-weight: 800;
}

.competitor-table {
  margin: 14px 0;
  padding: 16px;
}

.competitor-row {
  display: grid;
  grid-template-columns: 1.1fr 0.8fr 1fr 0.9fr 0.9fr 0.8fr 160px;
  gap: 10px;
  align-items: center;
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

@media (max-width: 940px) {
  .page-header,
  .competitor-row {
    grid-template-columns: 1fr;
  }
}
</style>
