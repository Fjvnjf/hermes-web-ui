<script setup lang="ts">
const projects = [
  {
    title: 'Chemicon China Feasibility',
    description: 'Main feasibility workspace for assumptions, questions, evidence, tasks, and draft outputs.',
    action: { label: 'Open Feasibility Studio', to: { name: 'hermes.feasibility' } },
  },
  {
    title: 'Product Research',
    description: 'Collect product notes, specifications, supplier questions, and comparison work.',
    action: { label: 'Research Library', to: { name: 'hermes.research' } },
  },
  {
    title: 'Manufacturing Research',
    description: 'Track process notes, equipment questions, plant assumptions, and technical gaps.',
    action: { label: 'Tasks', to: { name: 'hermes.kanban' } },
  },
  {
    title: 'Market / Competitor Research',
    description: 'Organize market questions, competitor notes, and source material without fake metrics.',
    action: { label: 'History', to: { name: 'hermes.history' } },
  },
  {
    title: 'Investment Research',
    description: 'Prepare diligence questions, evidence needs, and report outlines for later review.',
    action: { label: 'Reports', to: { name: 'hermes.reportsHub' } },
  },
  {
    title: 'Regulatory Research',
    description: 'Keep compliance questions, source documents, and required checks in one place.',
    action: { label: 'Documents', to: { name: 'hermes.files' } },
  },
  {
    title: 'Personal Research',
    description: 'Use Hermes for personal learning, saved questions, notes, and document review.',
    action: { label: 'Memory', to: { name: 'hermes.memory' } },
  },
  {
    title: 'Other Projects',
    description: 'A holding area for new research or feasibility work before it needs its own structure.',
    action: { label: 'Chat', to: { name: 'hermes.chat' } },
  },
]
</script>

<template>
  <div class="workspace-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Hermes Research Workspace</p>
        <h2 class="header-title">Projects</h2>
        <p class="page-copy">Use this page as a simple project launchpad. Storage is not added yet; existing Hermes chat, files, memory, and Kanban stay in charge.</p>
      </div>
    </header>

    <section class="project-grid" aria-label="Project workspaces">
      <article v-for="project in projects" :key="project.title" class="workspace-card">
        <div>
          <h3>{{ project.title }}</h3>
          <p>{{ project.description }}</p>
        </div>
        <RouterLink class="shell-link" :to="project.action.to">{{ project.action.label }}</RouterLink>
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

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.workspace-card {
  display: flex;
  min-height: 170px;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
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

.shell-link {
  color: $accent-info;
  font-weight: 800;
  text-decoration: none;

  &:hover {
    color: $accent-info-hover;
  }
}
</style>
