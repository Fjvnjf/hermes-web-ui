<script setup lang="ts">
import { useAppStore } from '@/stores/hermes/app'
import CommandGlyph from './CommandGlyph.vue'
import RouteLinkItem from './RouteLinkItem.vue'

withDefaults(defineProps<{
  title?: string
  subtitle?: string
  context?: string
  showQuickActions?: boolean
}>(), {
  title: 'Command channel ready',
  subtitle: 'Hermes runtime is standing by for the next instruction.',
  context: 'Session idle',
  showQuickActions: false,
})

const appStore = useAppStore()
</script>

<template>
  <div class="command-empty-state">
    <section class="empty-console" aria-live="polite">
      <div class="empty-console-header">
        <CommandGlyph :size="42" />
        <div class="empty-copy">
          <span>Hermes Command Center</span>
          <strong>{{ title }}</strong>
        </div>
      </div>
      <p>{{ subtitle }}</p>
      <div class="empty-status-strip">
        <span class="empty-status" :class="{ online: appStore.connected }">
          API {{ appStore.connected ? 'Online' : 'Offline' }}
        </span>
        <span class="empty-status">Web UI</span>
        <span class="empty-status">{{ context }}</span>
      </div>
      <nav v-if="showQuickActions" class="empty-actions" aria-label="Hermes command shortcuts">
        <RouteLinkItem class="empty-action" :to="{ name: 'hermes.files' }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span>Files</span>
        </RouteLinkItem>
        <RouteLinkItem class="empty-action" :to="{ name: 'hermes.terminal' }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span>Terminal</span>
        </RouteLinkItem>
        <RouteLinkItem class="empty-action" :to="{ name: 'hermes.models' }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
          </svg>
          <span>Models</span>
        </RouteLinkItem>
        <RouteLinkItem class="empty-action" :to="{ name: 'hermes.jobs' }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          <span>Jobs</span>
        </RouteLinkItem>
      </nav>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.command-empty-state {
  flex: 1;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: $text-muted;
  background: #060a12;
}

.empty-console {
  width: min(520px, 100%);
  padding: 18px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
}

.empty-console-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.empty-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;

  span {
    color: $accent-primary;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    line-height: 1;
    text-transform: uppercase;
  }

  strong {
    color: $text-primary;
    font-size: 17px;
    line-height: 1.2;
  }
}

p {
  margin: 14px 0 0;
  color: $text-secondary;
  font-size: 13px;
  line-height: 1.55;
}

.empty-status-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.empty-status {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 4px 9px;
  border: 1px solid $border-color;
  border-radius: 999px;
  color: $text-muted;
  background: #060a12;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  line-height: 1;
  text-transform: uppercase;

  &.online {
    color: $success;
    border-color: rgba(var(--success-rgb), 0.42);
    background: rgba(var(--success-rgb), 0.08);
  }
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid $border-color;
}

.empty-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 5px 10px;
  border: 1px solid $border-color;
  border-radius: 999px;
  color: $text-secondary;
  background: #060a12;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  text-decoration: none;
  transition: color $transition-fast, border-color $transition-fast, background $transition-fast;

  &:hover {
    color: $accent-info;
    border-color: rgba(var(--accent-info-rgb), 0.62);
    background: rgba(var(--accent-info-rgb), 0.08);
  }

  svg {
    flex: 0 0 auto;
  }
}

@media (max-width: $breakpoint-mobile) {
  .command-empty-state {
    min-height: 260px;
    padding: 16px;
  }

  .empty-console {
    padding: 14px;
  }

  .empty-copy strong {
    font-size: 15px;
  }

  .empty-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .empty-action {
    width: 100%;
  }
}
</style>
