<script setup lang="ts">
withDefaults(defineProps<{
  size?: number
  label?: string
}>(), {
  size: 32,
  label: '',
})
</script>

<template>
  <span
    class="command-glyph"
    :style="{ '--command-glyph-size': `${size}px` }"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M8 10l3 2-3 2" />
      <path d="M13.5 15h3.5" />
      <path d="M7 8h10" />
    </svg>
  </span>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.command-glyph {
  width: var(--command-glyph-size);
  height: var(--command-glyph-size);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(var(--accent-info-rgb), 0.45);
  border-radius: $radius-sm;
  background: #060a12;
  color: $accent-info;
  box-shadow: inset 0 0 0 1px rgba(var(--accent-primary-rgb), 0.08);

  svg {
    width: 68%;
    height: 68%;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}
</style>
