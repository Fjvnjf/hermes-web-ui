<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NDrawer, NDrawerContent, NTag, useMessage } from 'naive-ui'
import { useJobsStore } from '@/stores/hermes/jobs'
import { useTrustedSourceAutopilot } from '@/composables/useTrustedSourceAutopilot'
import {
  EXECUTIVE_REFRESH_SCHEDULE,
  nextTwiceDailyRefresh,
} from '@/utils/executiveIntelligence'
import type { AutopilotScreen, TrustedSourceSnapshotClaim } from '@/utils/trustedSources'
import type { IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'

const props = defineProps<{
  screen: AutopilotScreen
  title?: string
  compact?: boolean
}>()

const message = useMessage()
const jobsStore = useJobsStore()
const autopilot = useTrustedSourceAutopilot()
const drawerOpen = ref(false)
const saving = ref(false)
const selectedClaim = ref<TrustedSourceSnapshotClaim | null>(null)

const screenSnapshots = computed(() => autopilot.snapshotsForScreen(props.screen))
const latestSnapshot = computed(() => autopilot.lastSnapshotForScreen(props.screen))
const activeSources = computed(() => autopilot.activeSourcesForScreen(props.screen))
const needsReviewCount = computed(() => screenSnapshots.value.filter(snapshot => snapshot.review_required || snapshot.conflicts.length).length)
const lastSuccessfulRefresh = computed(() => latestSnapshot.value?.generated_at || null)
const lastFailedRefresh = computed(() => activeSources.value.find(source => source.last_failure)?.last_failure || null)
const nextRefresh = computed(() => nextTwiceDailyRefresh())
const sourceStatusLabel = computed(() => activeSources.value.length ? 'On' : 'Off')

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function tagType(status: IntelligenceEvidenceStatus): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (status === 'Verified' || status === 'Trusted Source Auto-Updated' || status === 'Source-backed') return 'success'
  if (status === 'Conflict Detected' || status === 'Missing') return 'error'
  if (status === 'To Verify' || status === 'Candidate Source' || status === 'Reference Only') return 'warning'
  return 'info'
}

function openDrawer(claim?: TrustedSourceSnapshotClaim) {
  selectedClaim.value = claim || latestSnapshot.value?.claims[0] || null
  drawerOpen.value = true
}

function disableSelectedSource() {
  if (!selectedClaim.value) {
    message.info('Select a sourced field first')
    return
  }
  const source = activeSources.value.find(item =>
    item.name.toLowerCase() === selectedClaim.value?.source.title.toLowerCase() ||
    (selectedClaim.value?.source.url && selectedClaim.value.source.url.includes(item.domain)),
  )
  if (!source) {
    message.warning('No active source record found for this field')
    return
  }
  autopilot.updateSource(source.source_id, {
    enabled: false,
    notes: `${source.notes} Disabled from source drawer for field: ${selectedClaim.value.label}.`,
  })
  message.success('Auto update disabled for this source')
}

async function createResearchJob() {
  saving.value = true
  try {
    const job = await jobsStore.createJob({
      name: `${props.title || props.screen} Trusted Source Refresh`,
      schedule: EXECUTIVE_REFRESH_SCHEDULE,
      deliver: 'local',
      prompt: autopilot.screenRefreshPrompt(props.screen),
    })
    await autopilot.runTrustedSourceDataEngine(props.screen, job.job_id || job.id)
    message.success('Trusted source refresh job created')
  } catch (err) {
    await autopilot.runTrustedSourceDataEngine(props.screen)
    const detail = err instanceof Error ? err.message : 'job API unavailable'
    message.warning(`Job scheduling fallback recorded: ${detail}`)
  } finally {
    saving.value = false
  }
}

async function syncNow() {
  await createResearchJob()
}
</script>

<template>
  <section class="trusted-autopilot" :class="{ compact }" aria-label="Trusted source autopilot">
    <div class="autopilot-header">
      <div>
        <p class="eyebrow">Trusted Source Autopilot</p>
        <h3>{{ title || 'Auto Source Status' }}</h3>
        <p>
          Trusted sources can update fields automatically with source, date, confidence, and evidence labels.
          Conflicts, unknown sources, investor-approved changes, and sensitive visibility risks go to review.
        </p>
      </div>
      <div class="autopilot-status">
        <span>Online auto-update: {{ sourceStatusLabel }}</span>
        <strong>{{ activeSources.length }}</strong>
        <small>trusted sources active</small>
      </div>
    </div>

    <div class="autopilot-metrics">
      <button type="button" @click="openDrawer()">
        <span>Last successful refresh</span>
        <strong>{{ formatDateTime(lastSuccessfulRefresh) }}</strong>
      </button>
      <button type="button" @click="openDrawer()">
        <span>Next refresh</span>
        <strong>{{ formatDateTime(nextRefresh) }}</strong>
      </button>
      <button type="button" @click="openDrawer()">
        <span>Needs review</span>
        <strong>{{ needsReviewCount }}</strong>
      </button>
      <button type="button" @click="openDrawer()">
        <span>Last failed refresh</span>
        <strong>{{ lastFailedRefresh || 'None' }}</strong>
      </button>
    </div>

    <div class="autopilot-actions">
      <NButton size="small" type="primary" :loading="saving" @click="syncNow">Sync Now</NButton>
      <NButton size="small" secondary @click="openDrawer()">View Sources</NButton>
      <RouterLink class="autopilot-link" :to="{ name: 'hermes.researchResultReview' }">View Review Queue</RouterLink>
      <NButton size="small" secondary :loading="saving" @click="createResearchJob">Create Research Job</NButton>
      <RouterLink class="autopilot-link" :to="{ name: 'hermes.trustedSources' }">Trusted Sources</RouterLink>
    </div>

    <div v-if="latestSnapshot?.claims.length" class="claim-strip">
      <button v-for="claim in latestSnapshot.claims" :key="claim.id" type="button" @click="openDrawer(claim)">
        <span>{{ claim.label }}</span>
        <strong>{{ claim.value }}</strong>
        <NTag size="small" :type="tagType(claim.evidenceStatus)">{{ claim.evidenceStatus }}</NTag>
      </button>
    </div>

    <NDrawer v-model:show="drawerOpen" :width="520" placement="right">
      <NDrawerContent title="Trusted Source Details">
        <div v-if="selectedClaim" class="source-detail">
          <h4>{{ selectedClaim.label }}</h4>
          <strong>{{ selectedClaim.value }}</strong>
          <NTag :type="tagType(selectedClaim.evidenceStatus)">{{ selectedClaim.evidenceStatus }}</NTag>
          <dl>
            <dt>Source</dt><dd>{{ selectedClaim.source.title }}</dd>
            <dt>URL / file</dt><dd>{{ selectedClaim.source.url || 'Not provided' }}</dd>
            <dt>Source date</dt><dd>{{ selectedClaim.source.date || 'To Verify' }}</dd>
            <dt>Extraction time</dt><dd>{{ formatDateTime(latestSnapshot?.generated_at) }}</dd>
            <dt>Confidence</dt><dd>{{ selectedClaim.confidence }}</dd>
            <dt>Previous value</dt><dd>{{ selectedClaim.previousValue || 'None' }}</dd>
            <dt>Change %</dt><dd>{{ selectedClaim.changePercent === null || selectedClaim.changePercent === undefined ? 'n/a' : `${selectedClaim.changePercent.toFixed(1)}%` }}</dd>
            <dt>Review status</dt><dd>{{ selectedClaim.reviewRequired ? 'Needs Review' : 'Auto-updated' }}</dd>
          </dl>
          <p v-if="selectedClaim.sensitive" class="sensitive-note">Sensitive value. Employee/investor views must redact this field.</p>
          <NButton secondary type="warning" @click="disableSelectedSource">Disable Auto Update for this field</NButton>
        </div>
        <div v-else class="source-detail">
          <h4>No source-backed field selected yet</h4>
          <p>Use Sync Now to schedule a refresh, or add trusted-source records from a structured source result.</p>
        </div>
        <div class="source-list">
          <h4>Active sources for this screen</h4>
          <div v-for="source in activeSources" :key="source.source_id" class="source-row">
            <strong>{{ source.name }}</strong>
            <span>{{ source.domain }} / {{ source.tier }} / {{ source.confidence_default }}</span>
            <small>{{ source.notes }}</small>
          </div>
        </div>
      </NDrawerContent>
    </NDrawer>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.trusted-autopilot {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.08), rgba(var(--accent-info-rgb), 0.05));
  color: $text-primary;
}

.autopilot-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 170px;
  gap: 14px;
  align-items: start;

  h3 {
    margin: 0;
    color: $warning;
    font-size: 16px;
  }

  p {
    margin: 4px 0 0;
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

.eyebrow,
.autopilot-status span,
.autopilot-status small,
.autopilot-metrics span {
  color: $text-muted;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.autopilot-status,
.autopilot-metrics button,
.claim-strip button {
  display: grid;
  gap: 4px;
  min-width: 0;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-card;
  color: $text-primary;
}

.autopilot-status {
  padding: 10px;

  strong {
    color: $accent-primary;
    font-size: 24px;
  }
}

.autopilot-metrics,
.claim-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.autopilot-metrics button,
.claim-strip button {
  padding: 9px;
  text-align: left;
  cursor: pointer;

  strong {
    overflow-wrap: anywhere;
    color: $accent-primary;
    font-size: 13px;
  }
}

.autopilot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.autopilot-link {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid $border-color;
  border-radius: 6px;
  background: $bg-card;
  color: $accent-info;
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
}

.source-detail {
  display: grid;
  gap: 10px;

  h4 {
    margin: 0;
    color: $warning;
  }

  dl {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr);
    gap: 8px;
  }

  dt {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
    color: $text-secondary;
  }
}

.sensitive-note {
  padding: 8px;
  border: 1px solid rgba(var(--error-rgb), 0.4);
  border-radius: 6px;
  color: $error;
}

.source-list {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.source-row {
  display: grid;
  gap: 3px;
  padding: 9px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;

  span,
  small {
    color: $text-secondary;
    font-size: 12px;
  }
}

@media (max-width: 720px) {
  .autopilot-header,
  .autopilot-metrics,
  .claim-strip {
    grid-template-columns: 1fr;
  }
}
</style>
