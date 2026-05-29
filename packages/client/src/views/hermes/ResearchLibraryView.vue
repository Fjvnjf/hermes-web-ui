<script setup lang="ts">
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
]

const captureLinks = [
  { label: 'Open Chat', to: { name: 'hermes.chat', query: { captureContext: 'general-research' } }, primary: true },
  { label: 'Open History', to: { name: 'hermes.history' } },
  { label: 'Open Memory', to: { name: 'hermes.memory' } },
  { label: 'Open Documents', to: { name: 'hermes.files' } },
]
</script>

<template>
  <div class="workspace-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Research Library</p>
        <h2 class="header-title">Research, Evidence, and Notes</h2>
        <p class="page-copy">This is a lightweight library shell. It reuses Hermes History, Memory, and Files until project-specific storage is added later.</p>
      </div>
      <div class="quick-actions">
        <RouterLink v-for="link in links" :key="link.label" class="shell-link" :to="link.to">{{ link.label }}</RouterLink>
      </div>
    </header>

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
