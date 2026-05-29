<script setup lang="ts">
import { computed } from 'vue'
import { buildInvestorPresentationDraft, type PresentationMaterial } from '@/utils/investorIntelligence'

const slideSections = [
  'Cover',
  'Executive Summary',
  'Problem / Opportunity',
  'Chemicon Background',
  'Product Plan',
  'China Feasibility',
  'Market Evidence',
  'Competitor Landscape',
  'Manufacturing Plan',
  'Regulatory Plan',
  'Financial Model',
  'IRR / Investor Return',
  'Use of Funds',
  'Risk & Mitigation',
  'Evidence / Data Room',
  'Next Steps',
]

const approvedMaterials: PresentationMaterial[] = []
const draftSections = computed(() => buildInvestorPresentationDraft(approvedMaterials))

const actions = [
  'Improve this slide',
  'Add evidence',
  'Create task for missing proof',
  'Do deeper research',
  'Rewrite for investor',
  'Mark risky claim',
  'Remove unsupported claim',
]
</script>

<template>
  <div class="presentation-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Investor presentation builder</p>
        <h2 class="header-title">Draft From Approved Material Only</h2>
        <p class="page-copy">
          This builder prepares investor draft text, not final truth. It excludes unsupported claims and labels
          assumptions visibly. PDF/export can come later only if the existing report system supports it safely.
        </p>
      </div>
      <div class="readiness-warning">
        <strong>Not investor-ready yet</strong>
        <span>Missing evidence should appear as risk or appendix items.</span>
      </div>
    </header>

    <section class="draft-status">
      <h3>Approved material currently available</h3>
      <p v-if="draftSections.length === 0">
        No verified, user-approved, or approved-assumption material has been staged for deck generation yet.
      </p>
      <article v-for="section in draftSections" :key="section.section">
        <strong>{{ section.section }}</strong>
        <p>{{ section.content }}</p>
        <small>{{ section.evidenceStatus }} / {{ section.sourceLabel }}</small>
      </article>
    </section>

    <section class="slide-grid">
      <article v-for="section in slideSections" :key="section" class="slide-card">
        <h3>{{ section }}</h3>
        <p>Missing / To Verify until approved source-backed material is added.</p>
        <div class="action-list">
          <RouterLink v-for="action in actions" :key="action" :to="{ name: action.includes('task') ? 'hermes.kanban' : 'hermes.chat', query: { captureContext: 'investment-research' } }">
            {{ action }}
          </RouterLink>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.presentation-view {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.readiness-warning,
.draft-status,
.slide-card {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
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
.draft-status p,
.slide-card p,
.readiness-warning span {
  color: $text-secondary;
  line-height: 1.55;
}

.readiness-warning {
  display: grid;
  gap: 8px;
  align-content: center;
  padding: 16px;

  strong {
    color: $warning;
    font-size: 18px;
  }
}

.draft-status {
  margin: 14px 0;
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }
}

.slide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
}

.slide-card {
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }
}

.action-list {
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

@media (max-width: 760px) {
  .page-header {
    grid-template-columns: 1fr;
  }
}
</style>
