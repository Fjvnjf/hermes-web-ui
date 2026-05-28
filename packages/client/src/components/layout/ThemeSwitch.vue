<script setup lang="ts">
import { useTheme } from '@/composables/useTheme'

const { isDark, toggleBrightness } = useTheme()
</script>

<template>
  <div class="theme-switch-container">
    <button class="theme-switch" :title="isDark ? 'Dim command view' : 'Full command view'" @click="toggleBrightness">
      <!-- Sun icon (shown in dark mode) -->
      <svg v-if="isDark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
      <!-- Moon icon (shown in light mode) -->
      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  </div>
</template>

<style scoped lang="scss">
.theme-switch-container {
  display: flex;
  gap: 4px;
  align-items: center;
}

.theme-switch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: 999px;
  cursor: pointer;
  color: var(--text-muted);
  transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;

  &:hover {
    color: var(--accent-primary);
    background: var(--bg-card-hover);
    border-color: var(--accent-primary);
  }
}
</style>
