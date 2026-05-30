<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { routePolicyFor } from '@/utils/accessControl'

const route = useRoute()
const attemptedRoute = computed(() => String(route.query.from || 'this page'))
const policy = computed(() => routePolicyFor(attemptedRoute.value))
</script>

<template>
  <main class="access-denied">
    <section class="panel">
      <p class="eyebrow">Access Control</p>
      <h1>Access denied</h1>
      <p>
        Your current role cannot open this area. Sensitive Hermes pages are blocked before loading their data.
      </p>
      <div v-if="policy" class="policy">
        <span>Route</span>
        <strong>{{ attemptedRoute }}</strong>
        <span>Sensitivity</span>
        <strong>{{ policy.sensitivity }}</strong>
      </div>
      <div class="actions">
        <RouterLink class="button" :to="{ name: 'hermes.dashboard' }">Owner Home</RouterLink>
        <RouterLink class="button secondary" :to="{ name: 'hermes.investorPortal' }">Investor Portal</RouterLink>
      </div>
    </section>
  </main>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.access-denied {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 32px;
  background: $bg-primary;
}

.panel {
  width: min(720px, 100%);
  border: 1px solid $border-color;
  background: $bg-secondary;
  padding: 28px;
  border-radius: 8px;
}

.eyebrow {
  color: $accent-primary;
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: .08em;
  margin: 0 0 8px;
}

h1 {
  margin: 0 0 10px;
  color: $text-primary;
}

p {
  color: $text-secondary;
}

.policy {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 14px;
  margin: 20px 0;
  color: $text-muted;
}

.policy strong {
  color: $text-primary;
}

.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.button {
  color: $bg-primary;
  background: $accent-info;
  padding: 10px 14px;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 700;
}

.button.secondary {
  color: $text-primary;
  background: transparent;
  border: 1px solid $border-color;
}
</style>
