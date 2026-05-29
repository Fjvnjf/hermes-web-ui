<script setup lang="ts">
const reviewActions = [
  { label: 'Approve selected updates', route: 'hermes.memory' },
  { label: 'Save as research note', route: 'hermes.memory' },
  { label: 'Create task', route: 'hermes.kanban' },
  { label: 'Add to investor readiness', route: 'hermes.investorReadiness' },
  { label: 'Mark as To Verify', route: 'hermes.kanban' },
  { label: 'Reject', route: 'hermes.research' },
]

const reviewFields = [
  'summary',
  'sources',
  'key claims',
  'confidence',
  'evidence status',
  'suggested dashboard updates',
  'suggested tasks',
  'suggested investor material',
  'suggested risks',
]
</script>

<template>
  <div class="review-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Research result review</p>
        <h2 class="header-title">Approve Research Before It Changes Anything</h2>
        <p class="page-copy">
          Research outputs do not directly update dashboard facts, investor material, or verified claims. Review,
          source-check, and approve selected updates first.
        </p>
      </div>
      <RouterLink class="header-link" :to="{ name: 'hermes.research' }">Research Library</RouterLink>
    </header>

    <section class="empty-review">
      <h3>No research result selected</h3>
      <p>
        When a deeper research task produces output, stage it here with sources, key claims, confidence, evidence
        status, suggested tasks, and investor-material suggestions. Unsourced results stay Research Note / To Verify.
      </p>
    </section>

    <section class="field-grid">
      <article v-for="field in reviewFields" :key="field">
        <h3>{{ field }}</h3>
        <p>Missing / To Verify until a source-backed research result is selected.</p>
      </article>
    </section>

    <section class="action-strip">
      <RouterLink v-for="action in reviewActions" :key="action.label" :to="{ name: action.route }">
        {{ action.label }}
      </RouterLink>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.review-view {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.empty-review,
.field-grid article {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
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
.empty-review p,
.field-grid p {
  color: $text-secondary;
  line-height: 1.55;
}

.header-link,
.action-strip a {
  color: $accent-info;
  font-weight: 800;
}

.empty-review {
  margin: 14px 0;
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;

  article {
    padding: 16px;
  }

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
    text-transform: capitalize;
  }
}

.action-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;

  a {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    padding: 8px 10px;
    text-decoration: none;
  }
}
</style>
