<script setup lang="ts">
const sections = [
  {
    title: 'Feasibility Reports',
    description: 'Prepare outlines and final report structure from verified assumptions, documents, tasks, and chat outputs.',
  },
  {
    title: 'Research Summaries',
    description: 'Turn saved research into concise summaries once sources and evidence gaps are clear.',
  },
  {
    title: 'Investor Preparation',
    description: 'Collect diligence questions, source lists, assumptions, and presentation talking points.',
  },
  {
    title: 'Presentation Drafts',
    description: 'Use this area to plan slide narratives before creating a real deck or exported document.',
  },
  {
    title: 'Usage Analytics',
    description: 'Open existing Hermes usage pages for token/session analytics. This is not business performance data.',
  },
]

const links = [
  { label: 'Usage', to: { name: 'hermes.usage' } },
  { label: 'Skills Usage', to: { name: 'hermes.skillsUsage' } },
  { label: 'Documents', to: { name: 'hermes.files' } },
  { label: 'Chat', to: { name: 'hermes.chat' } },
]
</script>

<template>
  <div class="workspace-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Reports Hub</p>
        <h2 class="header-title">Reports and Presentation Preparation</h2>
        <p class="page-copy">A simple output-planning shell. It links to existing Hermes analytics and work areas, but does not claim reports already exist.</p>
      </div>
      <div class="quick-actions">
        <RouterLink v-for="link in links" :key="link.label" class="shell-link" :to="link.to">{{ link.label }}</RouterLink>
      </div>
    </header>

    <section class="section-grid" aria-label="Report sections">
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

  .quick-actions {
    justify-content: flex-start;
  }
}
</style>
