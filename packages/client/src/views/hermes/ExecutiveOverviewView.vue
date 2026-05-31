<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import PinnedExecutiveIntelligenceBoard from '@/components/intelligence/PinnedExecutiveIntelligenceBoard.vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { canAccessRouteName, getFrontendAccessRole } from '@/utils/accessControl'
import {
  EXECUTIVE_REFRESH_SCHEDULE,
  defaultExecutiveRefreshState,
} from '@/utils/executiveIntelligence'

const intelligence = useFeasibilityIntelligence()
const frontendRole = computed(() => getFrontendAccessRole())
const refreshState = computed(() => defaultExecutiveRefreshState())
const canUseRoute = (routeName: string) => canAccessRouteName(routeName, frontendRole.value)

const commandCards = computed(() => [
  {
    label: 'Executive Intelligence',
    value: `${intelligence.readinessScore.value}%`,
    detail: 'Evidence-status readiness score, not an investor claim.',
    routeName: 'hermes.investorReadiness',
    tone: 'gold',
  },
  {
    label: 'Market Intelligence',
    value: String(intelligence.state.value.marketClaims.length || 'To Verify'),
    detail: 'Source-backed claims only; missing values stay To Verify.',
    routeName: 'hermes.marketIntelligence',
    tone: 'cyan',
  },
  {
    label: 'Investment Analysis',
    value: intelligence.latestFinancialModel.value?.scenarioName || 'To Verify',
    detail: 'Financial outputs remain derived from assumptions until approved.',
    routeName: 'hermes.investmentAnalysis',
    tone: 'green',
  },
  {
    label: 'Needs Review',
    value: String(intelligence.pendingResearchFindings.value.length),
    detail: 'Draft findings waiting in Research Result Review.',
    routeName: 'hermes.researchResultReview',
    tone: intelligence.pendingResearchFindings.value.length ? 'amber' : 'green',
  },
].filter(card => canUseRoute(card.routeName)))

const actionLinks = computed(() => [
  { label: 'Review Results', routeName: 'hermes.researchResultReview' },
  { label: 'Open Jobs', routeName: 'hermes.jobs' },
  { label: 'Open Tasks', routeName: 'hermes.kanban' },
  { label: 'Open Documents', routeName: 'hermes.files' },
  { label: 'Open Chat', routeName: 'hermes.chat' },
].filter(link => canUseRoute(link.routeName)))
</script>

<template>
  <div class="executive-overview-view">
    <header class="overview-hero">
      <div>
        <p class="eyebrow">Executive Overview</p>
        <h2>Hermes Executive Intelligence</h2>
        <p>
          Command-center view for economics, market intelligence, competitor tracking, daily brief, and action review.
          It uses existing Hermes workspace data only; missing or unsourced values stay To Verify.
        </p>
      </div>
      <div class="refresh-card">
        <span>Refresh cadence</span>
        <strong>09:00 / 21:00</strong>
        <small>Job: Executive Intelligence Refresh</small>
        <small>Schedule: {{ EXECUTIVE_REFRESH_SCHEDULE }}</small>
        <small>Next update: {{ new Date(refreshState.nextRun || '').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }}</small>
      </div>
    </header>

    <section class="command-strip" aria-label="Executive overview command cards">
      <RouterLink
        v-for="card in commandCards"
        :key="card.label"
        class="command-card"
        :class="card.tone"
        :to="{ name: card.routeName }"
      >
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <small>{{ card.detail }}</small>
      </RouterLink>
    </section>

    <section class="overview-actions" aria-label="Executive overview actions">
      <RouterLink v-for="link in actionLinks" :key="link.label" class="action-link" :to="{ name: link.routeName }">
        {{ link.label }}
      </RouterLink>
    </section>

    <PinnedExecutiveIntelligenceBoard />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.executive-overview-view {
  min-height: var(--app-content-height, 100%);
  padding: 18px;
  background: $bg-primary;
  color: $text-primary;
}

.overview-hero,
.command-card {
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-card;
}

.overview-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(230px, 300px);
  gap: 16px;
  margin-bottom: 14px;
  padding: 18px;

  h2 {
    margin: 0;
    color: $warning;
    font-size: 26px;
  }

  p {
    max-width: 820px;
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.eyebrow {
  margin: 0 0 6px;
  color: $accent-primary;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.refresh-card {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
  border-radius: 8px;
  background: rgba(var(--accent-primary-rgb), 0.08);

  span,
  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 22px;
  }
}

.command-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.command-card {
  position: relative;
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 14px;
  text-decoration: none;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: $executive-strip;
  }

  span,
  small {
    color: $text-secondary;
  }

  span {
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $text-primary;
    font-size: 24px;
    overflow-wrap: anywhere;
  }

  &.cyan strong { color: $accent-info; }
  &.green strong { color: $success; }
  &.amber strong,
  &.gold strong { color: $accent-primary; }
}

.overview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.action-link {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 6px 10px;
  border: 1px solid $border-color;
  border-radius: 6px;
  background: rgba(var(--accent-info-rgb), 0.08);
  color: $accent-info;
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
}

@media (max-width: 760px) {
  .executive-overview-view {
    padding: 12px;
  }

  .overview-hero {
    grid-template-columns: 1fr;
  }
}
</style>
