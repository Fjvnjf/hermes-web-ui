<script setup lang="ts">
const sections = [
  {
    title: 'Overview',
    description: 'Define the study scope, assumptions, open decisions, and the exact question Hermes should help answer.',
  },
  {
    title: 'Feasibility Draft',
    description: 'Prepare and refine the working feasibility narrative before turning it into a report or presentation.',
  },
  {
    title: 'Questions',
    description: 'Keep unresolved business, technical, regulatory, supplier, and finance questions visible.',
  },
  {
    title: 'Evidence Gaps',
    description: 'List claims that still need documents, quotations, calculations, expert checks, or regulatory confirmation.',
  },
  {
    title: 'Documents',
    description: 'Use the existing Files area for source documents, notes, exports, and supporting evidence.',
  },
  {
    title: 'Tasks',
    description: 'Use the existing Kanban board for follow-ups, missing evidence, and report-preparation work.',
  },
  {
    title: 'Reports',
    description: 'Prepare report outlines, investor questions, and presentation drafts without adding fake numbers.',
  },
]

const quickLinks = [
  { label: 'Chat', to: { name: 'hermes.chat' } },
  { label: 'Documents', to: { name: 'hermes.files' } },
  { label: 'Tasks', to: { name: 'hermes.kanban' } },
  { label: 'Memory', to: { name: 'hermes.memory' } },
  { label: 'Reports', to: { name: 'hermes.reportsHub' } },
]
</script>

<template>
  <div class="workspace-shell">
    <header class="studio-hero">
      <div>
        <p class="eyebrow">Current main project</p>
        <h2 class="header-title">Chemicon China Feasibility</h2>
        <p class="page-copy">A focused workspace for feasibility study work. This shell links to existing Hermes tools; it does not add new storage or invent business data.</p>
      </div>
      <div class="quick-actions" aria-label="Feasibility quick links">
        <RouterLink v-for="link in quickLinks" :key="link.label" class="shell-link" :to="link.to">{{ link.label }}</RouterLink>
      </div>
    </header>

    <section class="section-grid" aria-label="Feasibility sections">
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

.studio-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: start;
  margin-bottom: 18px;
  padding: 18px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
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
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}

.workspace-card {
  min-height: 150px;
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
  .studio-hero {
    grid-template-columns: 1fr;
  }

  .quick-actions {
    justify-content: flex-start;
  }
}
</style>
