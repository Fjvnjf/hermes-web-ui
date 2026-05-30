<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { canAccessRouteName, getFrontendAccessRole, routePolicyFor } from '@/utils/accessControl'
import { request } from '@/api/client'

const route = useRoute()
const attemptedRoute = computed(() => String(route.query.from || 'this page'))
const policy = computed(() => routePolicyFor(attemptedRoute.value))
const role = computed(() => getFrontendAccessRole())
const homeRoute = computed(() => canAccessRouteName('hermes.dashboard', role.value) ? 'hermes.dashboard' : 'hermes.investorPortal')
const quickActions = computed(() => [
  { label: 'Home', routeName: homeRoute.value },
  { label: 'My Tasks', routeName: 'hermes.kanban' },
  { label: 'Chat', routeName: 'hermes.chat' },
  { label: 'Investor Portal', routeName: 'hermes.investorPortal' },
].filter(action => canAccessRouteName(action.routeName, role.value)))

const friendlyCopy = computed(() => {
  if (role.value === 'investor_viewer') {
    return 'This area is internal. Your account is limited to approved investor material only.'
  }
  if (role.value === 'developer_admin') {
    return 'This area contains business workspace data. Developer access is limited to system tools unless the owner grants business access.'
  }
  return 'This area is restricted for your role. Sensitive pages stay blocked before any private data is loaded.'
})

onMounted(() => {
  request('/api/hermes/access-denied', {
    method: 'POST',
    body: JSON.stringify({
      route: attemptedRoute.value,
      reason: 'frontend-route-guard',
    }),
  }).catch(() => {})
})
</script>

<template>
  <main class="access-denied">
    <section class="panel">
      <p class="eyebrow">Access Control</p>
      <h1>This area is not available for your role</h1>
      <p>{{ friendlyCopy }}</p>
      <div v-if="policy" class="policy" aria-label="Access details">
        <span>Requested area</span>
        <strong>{{ attemptedRoute }}</strong>
        <span>Access label</span>
        <strong>{{ policy.sensitivity }}</strong>
      </div>
      <div class="actions">
        <RouterLink
          v-for="action in quickActions"
          :key="action.label"
          class="button"
          :to="{ name: action.routeName }"
        >
          {{ action.label }}
        </RouterLink>
        <span class="contact-owner">Contact Owner for access</span>
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

.contact-owner {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid $border-color;
  border-radius: 6px;
  color: $text-muted;
  font-size: 12px;
  font-weight: 700;
}
</style>
