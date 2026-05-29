<script setup lang="ts">
import { computed } from 'vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { formatMarketShare, formatSourceReference, normalizedMarketClaimStatus } from '@/utils/investorIntelligence'

const intelligence = useFeasibilityIntelligence()

const sections = [
  {
    title: 'Saved Research',
    description: 'Use History for saved Hermes conversations and Files for source material or exported notes.',
  },
  {
    title: 'Questions',
    description: 'Keep research questions in chat sessions, Kanban tasks, or memory until a dedicated model is added.',
  },
  {
    title: 'Evidence Notes',
    description: 'Track evidence and source notes through documents, memory, and clearly named sessions.',
  },
  {
    title: 'Personal Research',
    description: 'Use this space for non-business learning, reading, and personal reference work.',
  },
  {
    title: 'Business Research',
    description: 'Collect supplier, customer, market, regulatory, and feasibility evidence without inventing facts.',
  },
  {
    title: 'Technical Research',
    description: 'Organize process, product, software, manufacturing, and technical due diligence notes.',
  },
]

const links = [
  { label: 'History', to: { name: 'hermes.history' } },
  { label: 'Memory', to: { name: 'hermes.memory' } },
  { label: 'Documents', to: { name: 'hermes.files' } },
  { label: 'Market', to: { name: 'hermes.marketIntelligence' } },
  { label: 'Competitors', to: { name: 'hermes.competitorIntelligence' } },
  { label: 'Review Results', to: { name: 'hermes.researchResultReview' } },
]

const captureLinks = [
  { label: 'Open Chat', to: { name: 'hermes.chat', query: { captureContext: 'general-research' } }, primary: true },
  { label: 'Open History', to: { name: 'hermes.history' } },
  { label: 'Open Memory', to: { name: 'hermes.memory' } },
  { label: 'Open Documents', to: { name: 'hermes.files' } },
]

const pendingFindings = computed(() =>
  intelligence.state.value.researchFindings
    .filter(item => item.status === 'Pending Review' || item.status === 'To Verify')
    .slice(0, 4),
)
const researchJobs = computed(() => intelligence.state.value.researchJobs.slice(0, 4))
const marketClaims = computed(() => intelligence.state.value.marketClaims.slice(0, 4))
const competitors = computed(() => intelligence.state.value.competitors.slice(0, 4))

const liveStats = computed(() => [
  {
    label: 'Review findings',
    value: pendingFindings.value.length,
    status: pendingFindings.value.length ? 'Needs approval' : 'Clear',
    to: { name: 'hermes.researchResultReview' },
  },
  {
    label: 'Research jobs',
    value: intelligence.state.value.researchJobs.length,
    status: researchJobs.value.some(item => item.status === 'Task Created') ? 'Task-backed' : 'Manual queue',
    to: { name: 'hermes.researchResultReview' },
  },
  {
    label: 'Market claims',
    value: intelligence.state.value.marketClaims.length,
    status: intelligence.state.value.marketClaims.some(item => normalizedMarketClaimStatus(item) === 'Verified') ? 'Has sourced claims' : 'To Verify',
    to: { name: 'hermes.marketIntelligence' },
  },
  {
    label: 'Competitor records',
    value: intelligence.state.value.competitors.length,
    status: intelligence.state.value.competitors.some(item => item.evidenceStatus === 'Verified') ? 'Has verified records' : 'To Verify',
    to: { name: 'hermes.competitorIntelligence' },
  },
])

const researchQueueItems = computed(() => [
  ...pendingFindings.value.map(item => ({
    id: item.id,
    title: item.keyClaim,
    detail: item.summary,
    status: item.status === 'Pending Review' ? item.evidenceStatus : item.status,
    source: formatSourceReference(item.source),
    to: { name: 'hermes.researchResultReview' },
  })),
  ...researchJobs.value.map(item => ({
    id: item.id,
    title: item.title,
    detail: item.question,
    status: item.status,
    source: item.context,
    to: { name: 'hermes.researchResultReview' },
  })),
].slice(0, 6))

const evidenceRecords = computed(() => [
  ...marketClaims.value.map(item => ({
    id: item.id || item.label,
    title: item.label,
    detail: item.value?.trim() || 'Value still To Verify',
    status: normalizedMarketClaimStatus(item),
    source: formatSourceReference(item.source),
    to: { name: 'hermes.marketIntelligence' },
  })),
  ...competitors.value.map(item => ({
    id: item.id,
    title: item.companyName,
    detail: `${item.productEquivalent || 'Product To Verify'} / market share: ${formatMarketShare(item.marketShare)}`,
    status: item.evidenceStatus,
    source: formatSourceReference(item.source),
    to: { name: 'hermes.competitorIntelligence' },
  })),
].slice(0, 6))
</script>

<template>
  <div class="workspace-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Research Library</p>
        <h2 class="header-title">Research, Evidence, and Notes</h2>
        <p class="page-copy">
          Live research hub for the shared feasibility intelligence workspace. It still reuses Hermes History,
          Memory, and Files, but now surfaces reviewed findings, research jobs, market claims, and competitor records.
        </p>
      </div>
      <div class="quick-actions">
        <RouterLink v-for="link in links" :key="link.label" class="shell-link" :to="link.to">{{ link.label }}</RouterLink>
      </div>
    </header>

    <section class="research-state-grid" aria-label="Live research state">
      <RouterLink v-for="item in liveStats" :key="item.label" class="research-stat-card" :to="item.to">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
        <small>{{ item.status }}</small>
      </RouterLink>
    </section>

    <section class="capture-research-section" aria-labelledby="capture-research-title">
      <div>
        <p class="eyebrow">Session capture</p>
        <h3 id="capture-research-title">Capture Research Sessions</h3>
        <p>
          Use Review & Capture after research conversations to save notes, questions, and tasks. Suggestions stay
          approval-first and reuse Chat, History, Memory, and Documents instead of creating a new storage system.
        </p>
      </div>
      <div class="capture-actions">
        <RouterLink
          v-for="link in captureLinks"
          :key="link.label"
          :class="link.primary ? 'shell-link primary' : 'shell-link'"
          :to="link.to"
        >
          {{ link.label }}
        </RouterLink>
      </div>
    </section>

    <section class="research-live-panels" aria-label="Research intelligence records">
      <article class="research-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Review queue</p>
            <h3>Research Waiting for Approval</h3>
          </div>
          <RouterLink class="shell-link" :to="{ name: 'hermes.researchResultReview' }">Review</RouterLink>
        </div>
        <div v-if="researchQueueItems.length" class="record-list">
          <RouterLink v-for="item in researchQueueItems" :key="item.id" class="record-row" :to="item.to">
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
              <small>{{ item.source }}</small>
            </div>
            <span>{{ item.status }}</span>
          </RouterLink>
        </div>
        <p v-else class="empty-state">No pending research findings or research jobs. Use Review & Capture after useful chats.</p>
      </article>

      <article class="research-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Evidence records</p>
            <h3>Market and Competitor Evidence</h3>
          </div>
          <RouterLink class="shell-link" :to="{ name: 'hermes.marketIntelligence' }">Market</RouterLink>
        </div>
        <div v-if="evidenceRecords.length" class="record-list">
          <RouterLink v-for="item in evidenceRecords" :key="item.id" class="record-row" :to="item.to">
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
              <small>{{ item.source }}</small>
            </div>
            <span>{{ item.status }}</span>
          </RouterLink>
        </div>
        <p v-else class="empty-state">No saved market or competitor records yet. Unknown claims stay To Verify until sourced.</p>
      </article>
    </section>

    <section class="section-grid" aria-label="Research library sections">
      <article v-for="section in sections" :key="section.title" class="workspace-card">
        <h3>{{ section.title }}</h3>
        <p>{{ section.description }}</p>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.workspace-shell {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: start;
  margin-bottom: 18px;
}

.eyebrow {
  margin: 0 0 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.page-copy {
  max-width: 760px;
  margin: 8px 0 0;
  color: $text-secondary;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.research-state-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.research-stat-card {
  display: grid;
  gap: 6px;
  min-height: 112px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
  color: inherit;
  text-decoration: none;

  span,
  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 28px;
    line-height: 1;
  }

  &:hover {
    border-color: $accent-info;
    background: rgba(var(--accent-info-rgb), 0.06);
  }
}

.capture-research-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  margin-bottom: 18px;
  padding: 16px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 18px;
  }

  p {
    max-width: 760px;
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.capture-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.shell-link {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  padding: 0 12px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  color: $accent-info;
  font-weight: 800;
  text-decoration: none;

  &:hover {
    border-color: $accent-info;
    color: $accent-info-hover;
    background: rgba(var(--accent-info-rgb), 0.08);
  }

  &.primary {
    color: $bg-primary;
    background: $accent-primary;
    border-color: $accent-primary;

    &:hover {
      color: $bg-primary;
      background: $accent-hover;
      border-color: $accent-hover;
    }
  }
}

.research-live-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.research-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.panel-head {
  display: flex;
  gap: 12px;
  align-items: start;
  justify-content: space-between;

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 18px;
  }

  .shell-link {
    flex: 0 0 auto;
  }
}

.record-list {
  display: grid;
  gap: 8px;
}

.record-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-panel;
  color: inherit;
  text-decoration: none;

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
  }

  > span {
    border: 1px solid $border-color;
    border-radius: 999px;
    padding: 3px 8px;
    color: $accent-primary;
    font-size: 11px;
    font-weight: 900;
    white-space: nowrap;
    text-transform: uppercase;
  }
}

.empty-state {
  margin: 0;
  color: $text-secondary;
  line-height: 1.55;
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}

.workspace-card {
  min-height: 145px;
  padding: 16px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
    font-size: 16px;
  }

  p {
    margin: 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

@media (max-width: 720px) {
  .page-header {
    grid-template-columns: 1fr;
  }

  .research-state-grid,
  .research-live-panels {
    grid-template-columns: 1fr;
  }

  .capture-research-section {
    grid-template-columns: 1fr;
  }

  .quick-actions {
    justify-content: flex-start;
  }

  .capture-actions {
    justify-content: flex-start;
  }
}
</style>
