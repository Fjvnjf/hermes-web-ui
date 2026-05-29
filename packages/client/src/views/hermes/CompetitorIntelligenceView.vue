<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import {
  type CompetitorIntelligenceRecord,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { formatMarketShare, type IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const creating = ref('')

const competitorForm = ref({
  companyName: '',
  countryRegion: '',
  productEquivalent: '',
  activeContent: '',
  pricingEvidence: '',
  certifications: '',
  distributionPresence: '',
  marketShare: '',
  evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus,
  sourceTitle: '',
  sourceUrl: '',
  notes: '',
})

const competitors = computed(() => intelligence.state.value.competitors)

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
        'Market share must stay To Verify unless backed by a credible source.',
        'Tags: Competitor Intelligence, Research Job, To Verify',
      ].join('\n'),
      priority: 2,
      tenant: 'Chemicon China Feasibility',
    })
    intelligence.addResearchJob({
      title: `Competitor research: ${competitor.companyName}`,
      question: `Verify ${competitor.companyName} product equivalent, pricing evidence, distribution, certifications, and market-share source if available.`,
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
      }
    : null
  const saved = intelligence.addCompetitor({
    companyName,
    countryRegion: competitorForm.value.countryRegion.trim() || 'To Verify',
    productEquivalent: competitorForm.value.productEquivalent.trim() || 'To Verify',
    activeContent: competitorForm.value.activeContent.trim() || 'To Verify',
    pricingEvidence: competitorForm.value.pricingEvidence.trim() || 'Missing',
    certifications: competitorForm.value.certifications.trim() || 'To Verify',
    distributionPresence: competitorForm.value.distributionPresence.trim() || 'To Verify',
    marketShare: competitorForm.value.marketShare.trim(),
    evidenceStatus: competitorForm.value.evidenceStatus,
    source,
    notes: competitorForm.value.notes.trim() || 'No competitor claim should be treated as real until source evidence is attached.',
  })
  if (competitorForm.value.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Competitor saved as To Verify because verified records need usable source evidence')
  } else {
    message.success('Competitor record saved in this browser workspace')
  }
  competitorForm.value = {
    companyName: '',
    countryRegion: '',
    productEquivalent: '',
    activeContent: '',
    pricingEvidence: '',
    certifications: '',
    distributionPresence: '',
    marketShare: '',
    evidenceStatus: 'To Verify',
    sourceTitle: '',
    sourceUrl: '',
    notes: '',
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

    <section class="competitor-form" aria-label="Add competitor record">
      <div>
        <h3>Add competitor evidence</h3>
        <p>Saved locally in this browser workspace. Unknown market share is always displayed as To Verify.</p>
      </div>
      <label>Company<input v-model="competitorForm.companyName" type="text" placeholder="Company name" /></label>
      <label>Region<input v-model="competitorForm.countryRegion" type="text" placeholder="Country / region" /></label>
      <label>Product equivalent<input v-model="competitorForm.productEquivalent" type="text" placeholder="Equivalent product" /></label>
      <label>Active content<input v-model="competitorForm.activeContent" type="text" placeholder="Active content" /></label>
      <label>Pricing evidence<input v-model="competitorForm.pricingEvidence" type="text" placeholder="Quote, source, or Missing" /></label>
      <label>Certifications<input v-model="competitorForm.certifications" type="text" placeholder="To Verify" /></label>
      <label>Distribution<input v-model="competitorForm.distributionPresence" type="text" placeholder="To Verify" /></label>
      <label>Market share<input v-model="competitorForm.marketShare" type="text" placeholder="Leave blank unless sourced" /></label>
      <label>
        Evidence status
        <select v-model="competitorForm.evidenceStatus">
          <option>To Verify</option>
          <option>Missing</option>
          <option>Assumption</option>
          <option>User Approved</option>
          <option>Verified</option>
        </select>
      </label>
      <label>Source title<input v-model="competitorForm.sourceTitle" type="text" placeholder="Source title" /></label>
      <label>Source URL<input v-model="competitorForm.sourceUrl" type="url" placeholder="https://..." /></label>
      <label class="wide">Notes<input v-model="competitorForm.notes" type="text" placeholder="Evidence notes" /></label>
      <NButton secondary type="primary" @click="addCompetitor">Save competitor</NButton>
    </section>

    <section class="competitor-table" aria-label="Competitor list">
      <div class="competitor-row head">
        <span>Company</span><span>Region</span><span>Equivalent</span><span>Pricing</span><span>Market share</span><span>Status</span><span>Action</span>
      </div>
      <p v-if="competitors.length === 0" class="empty-state">
        No competitor records saved yet. Add sourced records above, or create research tasks for unknown competitors.
      </p>
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
.competitor-form,
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

.empty-state {
  border-top: 1px solid $border-color;
  margin: 0;
  padding: 12px 0 0;
  color: $text-secondary;
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
