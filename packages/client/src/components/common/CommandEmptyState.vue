<script setup lang="ts">
import { useAppStore } from '@/stores/hermes/app'
import CommandGlyph from './CommandGlyph.vue'

withDefaults(defineProps<{
  title?: string
  subtitle?: string
  context?: string
}>(), {
  title: 'Command channel ready',
  subtitle: 'Hermes runtime is standing by for the next instruction.',
  context: 'Session idle',
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
}
</style>
