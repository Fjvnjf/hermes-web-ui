<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NSelect, NSwitch, useMessage } from 'naive-ui'
import { useJobsStore } from '@/stores/hermes/jobs'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import {
  FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
  FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
  useTrustedSourceAutopilot,
} from '@/composables/useTrustedSourceAutopilot'
import type { TrustedSourceDataType, TrustedSourceTier } from '@/utils/trustedSources'

const FULL_AUTOPILOT_STATUS_KEY = 'hermes.fullDashboardAutopilot.status.v1'

interface FullAutopilotStatus {
  enabled: boolean
  scheduledJobId: string
  lastRun: string
  lastStatus: string
}

const message = useMessage()
const autopilot = useTrustedSourceAutopilot()
const jobsStore = useJobsStore()
const intelligence = useFeasibilityIntelligence()
const fullAutopilotSaving = ref(false)
const importingLatestOutput = ref(false)
const fullAutopilotStatus = ref(loadFullAutopilotStatus())

const form = ref({
  name: '',
  domain: '',
  tier: 'candidate-source' as TrustedSourceTier,
  dataType: 'market_size' as TrustedSourceDataType,
  notes: '',
})

const tierOptions = [
  { label: 'Tier 1 - Official / High Trust', value: 'tier1-official' },
  { label: 'Tier 2 - Market Reference', value: 'tier2-market-reference' },
  { label: 'Tier 3 - Supplier Evidence', value: 'tier3-supplier-evidence' },
  { label: 'Tier 4 - Public Listing / Weak Evidence', value: 'tier4-public-listing' },
  { label: 'Candidate Source / To Verify', value: 'candidate-source' },
]

const dataTypeOptions = [
  'trade_data',
  'market_size',
  'price_data',
  'competitor_data',
  'company_data',
  'regulatory_data',
  'financial_data',
  'supplier_quote',
  'document_evidence',
  'internal_activity',
].map(value => ({ label: value.replace(/_/g, ' '), value }))

const groupedSources = computed(() => ({
  tier1: autopilot.state.value.sources.filter(source => source.tier === 'tier1-official'),
  tier2: autopilot.state.value.sources.filter(source => source.tier === 'tier2-market-reference'),
  tier3: autopilot.state.value.sources.filter(source => source.tier === 'tier3-supplier-evidence'),
  tier4: autopilot.state.value.sources.filter(source => source.tier === 'tier4-public-listing'),
  candidates: autopilot.state.value.sources.filter(source => source.tier === 'candidate-source'),
}))
type SourceGroupKey = 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'candidates'

const sourceGroupLabels: Record<SourceGroupKey, string> = {
  tier1: 'Tier 1 - Official / High Trust',
  tier2: 'Tier 2 - Market Reference',
  tier3: 'Tier 3 - Supplier Evidence',
  tier4: 'Tier 4 - Public Listing / Weak Evidence',
  candidates: 'Candidate Sources / To Verify',
}
const activeSourceCount = computed(() => autopilot.activeSources.value.length)
const needsReviewCount = computed(() => autopilot.needsReviewSnapshots.value.length)
const fullAutopilotSnapshotCount = computed(() => autopilot.state.value.snapshots.length)
const fullAutopilotReviewCount = computed(() => autopilot.needsReviewSnapshots.value.length)

function loadFullAutopilotStatus(): FullAutopilotStatus {
  if (typeof window === 'undefined') {
    return { enabled: false, scheduledJobId: '', lastRun: '', lastStatus: 'Not enabled yet' }
  }
  try {
    const raw = window.localStorage.getItem(FULL_AUTOPILOT_STATUS_KEY)
    return raw
      ? { enabled: false, scheduledJobId: '', lastRun: '', lastStatus: 'Not enabled yet', ...JSON.parse(raw) }
      : { enabled: false, scheduledJobId: '', lastRun: '', lastStatus: 'Not enabled yet' }
  } catch {
    return { enabled: false, scheduledJobId: '', lastRun: '', lastStatus: 'Not enabled yet' }
  }
}

function persistFullAutopilotStatus(patch: Partial<FullAutopilotStatus>) {
  fullAutopilotStatus.value = { ...fullAutopilotStatus.value, ...patch }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FULL_AUTOPILOT_STATUS_KEY, JSON.stringify(fullAutopilotStatus.value))
  }
}

function sourceGroupLabel(key: string | number): string {
  return sourceGroupLabels[String(key) as SourceGroupKey] || String(key)
}

function addSource() {
  if (!form.value.name.trim() || !form.value.domain.trim()) {
    message.warning('Add source name and domain first')
    return
  }
  const saved = autopilot.registerCandidate({
    name: form.value.name,
    domain: form.value.domain,
    dataType: form.value.dataType,
  })
  autopilot.updateSource(saved.source_id, {
    tier: form.value.tier,
    confidence_default: form.value.tier === 'tier1-official' ? 'high' : form.value.tier === 'candidate-source' || form.value.tier === 'tier4-public-listing' ? 'low' : 'medium',
    auto_update_allowed: form.value.tier === 'tier1-official' || form.value.tier === 'tier2-market-reference' || form.value.tier === 'tier3-supplier-evidence',
    requires_review: form.value.tier === 'candidate-source' || form.value.tier === 'tier4-public-listing',
    notes: form.value.notes || 'Owner-added trusted source registry record.',
  })
  form.value = { name: '', domain: '', tier: 'candidate-source', dataType: 'market_size', notes: '' }
  message.success('Trusted source saved')
}

async function enableFullDashboardAutopilot() {
  fullAutopilotSaving.value = true
  try {
    const job = await jobsStore.createJob({
      name: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      prompt: autopilot.fullDashboardAutopilotPrompt(),
      deliver: 'local',
    })
    const scheduledJobId = job.job_id || job.id
    await autopilot.runFullDashboardDataEngine(scheduledJobId)
    intelligence.addResearchJob({
      title: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
      question: 'Automatically research trusted online sources and existing evidence to refresh the whole dashboard.',
      scope: 'Executive Overview, Market Intelligence, Competitor Intelligence, Investment Analysis, Raw Material Sourcing, Supplier Scorecards, Export Markets, Regulatory, Investor Readiness, and Presentation Builder inputs.',
      expectedOutput: 'Source-backed dashboard update candidates, evidence gaps, suggested tasks, and review-ready investor material candidates.',
      sourceRequirements: 'Every value needs source title plus URL/date and evidence status. Missing, conflicting, sensitive, or weak-source claims remain To Verify or go to Research Result Review.',
      priority: 'high',
      schedulePreference: 'Custom',
      scheduledJobId,
      schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      context: 'Chemicon China Feasibility',
      status: 'Scheduled Hermes Job',
    })
    persistFullAutopilotStatus({
      enabled: true,
      scheduledJobId,
      lastRun: new Date().toISOString(),
      lastStatus: 'Scheduled Hermes job active; online research output will be review-ready and source-labeled.',
    })
    message.success('Full dashboard autopilot enabled')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown scheduling error'
    await autopilot.runFullDashboardDataEngine()
    persistFullAutopilotStatus({
      enabled: false,
      lastRun: new Date().toISOString(),
      lastStatus: `Scheduling failed; local source snapshot created instead. ${detail}`,
    })
    message.warning('Scheduling failed; created local source snapshots for review instead')
  } finally {
    fullAutopilotSaving.value = false
  }
}

async function runFullDashboardSnapshotNow() {
  fullAutopilotSaving.value = true
  try {
    const result = await autopilot.runFullDashboardDataEngine(fullAutopilotStatus.value.scheduledJobId || undefined)
    persistFullAutopilotStatus({
      lastRun: new Date().toISOString(),
      lastStatus: `${result.message}. Review items: ${result.reviewItemCount}.`,
    })
    message.success('Full dashboard source snapshot created')
  } finally {
    fullAutopilotSaving.value = false
  }
}

async function importLatestDashboardResearchOutput(showMessages = true) {
  if (!fullAutopilotStatus.value.scheduledJobId) {
    if (showMessages) message.warning('Enable Full Dashboard Autopilot first so Hermes has a scheduled job id')
    return
  }
  importingLatestOutput.value = true
  try {
    const result = await autopilot.importLatestFullDashboardRunOutput(fullAutopilotStatus.value.scheduledJobId)
    persistFullAutopilotStatus({
      lastRun: result.runImported ? new Date().toISOString() : fullAutopilotStatus.value.lastRun,
      lastStatus: `${result.message}. Auto-filled: ${result.autoFilledCount}. Needs review: ${result.reviewItemCount}.`,
    })
    if (!showMessages) return
    if (result.runImported) {
      message.success('Latest Hermes research output imported into the source-gated dashboard pipeline')
    } else {
      message.warning(result.message)
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown import error'
    persistFullAutopilotStatus({
      lastStatus: `Could not import latest Hermes research output: ${detail}`,
    })
    if (showMessages) message.error(`Could not import latest Hermes research output: ${detail}`)
  } finally {
    importingLatestOutput.value = false
  }
}

onMounted(() => {
  if (fullAutopilotStatus.value.enabled && fullAutopilotStatus.value.scheduledJobId) {
    void importLatestDashboardResearchOutput(false)
  }
})
</script>

<template>
  <div class="trusted-sources-view">
    <header class="sources-header">
      <div>
        <p class="eyebrow">Trusted Sources</p>
        <h2>Autopilot Source Registry</h2>
        <p>
          Owner-only registry for classifying official, market-reference, supplier, public-listing, and candidate
          sources. These rules decide what can auto-update dashboard fields and what must go to review.
        </p>
      </div>
      <div class="summary-card">
        <strong>{{ activeSourceCount }}</strong>
        <span>active sources</span>
        <small>{{ needsReviewCount }} snapshots need review</small>
      </div>
    </header>

    <section class="source-permission-panel" aria-label="Research permission and evidence rules">
      <div>
        <p class="eyebrow">Research permission</p>
        <h3>Hermes can research trusted sources</h3>
        <p>
          Owner-approved research is active for public, company, regulatory, supplier, and uploaded evidence sources.
          Findings can stage dashboard updates only when source evidence and review rules are preserved.
        </p>
      </div>
      <div class="permission-flow" aria-label="Trusted source research flow">
        <span>Twice-daily trusted research</span>
        <span>Extract important data</span>
        <span>Attach evidence label</span>
        <span>Auto-stage critical items</span>
        <span>Fill only safe source-backed fields</span>
      </div>
      <ul class="permission-rule-list">
        <li>Important numbers require source title, URL or source date, confidence, evidence status, and review trail.</li>
        <li>Weak, conflicting, sensitive, or candidate-source findings go to Research Result Review instead of becoming facts.</li>
        <li>Unsupported market size, CAGR, market share, pricing, cost, IRR, or NPV values remain To Verify or Missing.</li>
      </ul>
      <div class="policy-tier-strip" aria-label="Official-first source ranking policy">
        <span>Tier 1: official / regulator / trade</span>
        <span>Tier 2: official company / product</span>
        <span>Tier 3: uploaded supplier evidence</span>
        <span>Tier 4: paid / reputable market reference</span>
        <span>Tier 5: public listing / weak reference</span>
      </div>
    </section>

    <section class="full-autopilot-panel" aria-label="Full dashboard trusted source autopilot">
      <div class="full-autopilot-copy">
        <p class="eyebrow">Full dashboard autopilot</p>
        <h3>Automatic Source Research For The Whole Dashboard</h3>
        <p>
          Enable once and Hermes will research trusted online sources on schedule, create source-labeled dashboard
          snapshots, and route weak, conflicting, sensitive, or missing values to Research Result Review. This removes
          manual copy-paste while keeping fake numbers out of Market Intelligence, Competitors, supplier scorecards,
          investment analysis, and investor material.
        </p>
      </div>
      <div class="full-autopilot-status">
        <article>
          <span>Status</span>
          <strong>{{ fullAutopilotStatus.enabled ? 'Scheduled' : 'Not Scheduled' }}</strong>
        </article>
        <article>
          <span>Schedule</span>
          <strong>07:00 / 19:00</strong>
        </article>
        <article>
          <span>Snapshots</span>
          <strong>{{ fullAutopilotSnapshotCount }}</strong>
        </article>
        <article>
          <span>Needs Review</span>
          <strong>{{ fullAutopilotReviewCount }}</strong>
        </article>
      </div>
      <ul class="autopilot-rule-list">
        <li>Researches official, company, regulatory, trade, supplier, price-reference, and uploaded evidence sources.</li>
        <li>Runs on the existing Hermes Jobs scheduler at 07:00 and 19:00; no separate database or backend migration is required.</li>
        <li>Fills only source-backed/API/internal-safe fields automatically; unsupported values stay Missing / To Verify.</li>
        <li>Supplier prices, quality, reliability, payment terms, IRR, market size, growth, market share, regulatory status, and investor claims are auto-staged for review unless source policy allows safe filling.</li>
      </ul>
      <div class="full-autopilot-actions">
        <NButton type="primary" :loading="fullAutopilotSaving" @click="enableFullDashboardAutopilot">Enable Full Autopilot</NButton>
        <NButton secondary :loading="fullAutopilotSaving" @click="runFullDashboardSnapshotNow">Run Source Snapshot Now</NButton>
        <NButton tertiary :loading="importingLatestOutput" @click="importLatestDashboardResearchOutput(true)">Import Latest Output</NButton>
        <RouterLink class="autopilot-link" :to="{ name: 'hermes.researchResultReview' }">Open Review Queue</RouterLink>
        <RouterLink class="autopilot-link" :to="{ name: 'hermes.rawMaterialSourcing' }">Raw Material Scorecards</RouterLink>
      </div>
      <p class="autopilot-status-note">
        {{ fullAutopilotStatus.lastStatus }}
        <span v-if="fullAutopilotStatus.scheduledJobId"> Job: {{ fullAutopilotStatus.scheduledJobId }}</span>
      </p>
    </section>

    <section class="source-form">
      <h3>Add Source</h3>
      <label>Name<input v-model="form.name" type="text" placeholder="Official agency, company, supplier, source portal" /></label>
      <label>Domain<input v-model="form.domain" type="text" placeholder="example.gov.cn or supplier evidence" /></label>
      <label>Tier<NSelect v-model:value="form.tier" :options="tierOptions" /></label>
      <label>Data type<NSelect v-model:value="form.dataType" :options="dataTypeOptions" /></label>
      <label class="wide">Notes<textarea v-model="form.notes" rows="3" placeholder="What fields this source can update and any limitations"></textarea></label>
      <NButton type="primary" @click="addSource">Add Source</NButton>
    </section>

    <section class="source-groups">
      <article v-for="(sources, key) in groupedSources" :key="key" class="source-group">
        <div class="source-group-header">
          <h3>{{ sourceGroupLabel(key) }}</h3>
          <span>{{ sources.length }} sources</span>
        </div>
        <div v-for="source in sources" :key="source.source_id" class="source-row">
          <div>
            <strong>{{ source.name }}</strong>
            <span class="source-domain">{{ source.domain }}</span>
            <div class="source-meta" aria-label="Source connector metadata">
              <span>Connector: {{ source.connector_type }}</span>
              <span>Frequency: {{ source.update_frequency }}</span>
              <span>Confidence: {{ source.confidence_default }}</span>
              <span>Auto Update: {{ source.auto_update_allowed ? 'Allowed' : 'Review only' }}</span>
            </div>
            <span>{{ source.data_types_supported.join(', ') }}</span>
            <small>{{ source.notes }}</small>
            <small>Last checked: {{ source.last_checked || 'Never' }} / Failure: {{ source.last_failure || 'None' }}</small>
          </div>
          <NSwitch
            :value="source.enabled"
            @update:value="value => autopilot.updateSource(source.source_id, { enabled: value })"
          />
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.trusted-sources-view {
  min-height: var(--app-content-height, 100%);
  padding: 18px;
  background: $bg-primary;
  color: $text-primary;
}

.sources-header,
.source-permission-panel,
.full-autopilot-panel,
.source-form,
.source-group {
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-card;
}

.sources-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 190px;
  gap: 16px;
  margin-bottom: 12px;
  padding: 18px;

  h2 {
    margin: 0;
    color: $warning;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
  }
}

.eyebrow,
.summary-card span,
.summary-card small {
  color: $text-muted;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.summary-card {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
  border-radius: 8px;
  background: rgba(var(--accent-primary-rgb), 0.08);

  strong {
    color: $accent-primary;
    font-size: 26px;
  }
}

.source-permission-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 0.75fr);
  gap: 16px;
  margin-bottom: 12px;
  padding: 16px;
  border-color: rgba(var(--accent-info-rgb), 0.32);
  background:
    linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.1), transparent 46%),
    $bg-card;

  h3 {
    margin: 0;
    color: $accent-info;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.permission-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-content: start;

  span {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 3px 8px;
    border: 1px solid rgba(var(--warning-rgb), 0.36);
    border-radius: 999px;
    background: rgba(var(--warning-rgb), 0.08);
    color: $warning;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.permission-rule-list {
  grid-column: 1 / -1;
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    padding: 9px 10px;
    border: 1px solid $border-color;
    border-radius: 7px;
    background: $bg-secondary;
    color: $text-secondary;
    line-height: 1.45;
  }
}

.policy-tier-strip {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 7px;

  span {
    padding: 8px 9px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.26);
    border-radius: 6px;
    background: rgba(var(--accent-primary-rgb), 0.055);
    color: $warning;
    font-size: 11px;
    font-weight: 850;
  }
}

.full-autopilot-panel {
  display: grid;
  gap: 14px;
  margin-bottom: 12px;
  padding: 16px;
  border-color: rgba(var(--accent-primary-rgb), 0.42);
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.14), rgba(var(--accent-info-rgb), 0.05) 46%, transparent),
    $bg-card;

  h3 {
    margin: 0;
    color: $warning;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.full-autopilot-copy {
  max-width: 980px;
}

.full-autopilot-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;

  article {
    display: grid;
    gap: 6px;
    padding: 12px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
    border-radius: 8px;
    background: rgba(var(--accent-primary-rgb), 0.07);
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 18px;
  }
}

.autopilot-rule-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    padding: 9px 10px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.22);
    border-radius: 7px;
    background: rgba(var(--accent-info-rgb), 0.06);
    color: $text-secondary;
    line-height: 1.45;
  }
}

.full-autopilot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.autopilot-link {
  color: $accent-info;
  font-weight: 800;
  text-decoration: none;
}

.autopilot-status-note {
  margin: 0 !important;
  color: $warning !important;
}

.source-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  gap: 10px;
  align-items: end;
  margin-bottom: 12px;
  padding: 14px;

  h3 {
    grid-column: 1 / -1;
    margin: 0;
    color: $warning;
  }

  label {
    display: grid;
    gap: 5px;
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .wide {
    grid-column: span 2;
  }

  input,
  textarea {
    width: 100%;
    min-width: 0;
    border: 1px solid $border-color;
    border-radius: 6px;
    background: $bg-secondary;
    color: $text-primary;
    padding: 8px;
  }
}

.source-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}

.source-group {
  display: grid;
  gap: 8px;
  align-content: start;
  padding: 14px;

  h3 {
    margin: 0;
    color: $warning;
  }
}

.source-group-header {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.source-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;

  div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  span,
  small {
    color: $text-secondary;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
}

.source-domain {
  color: $accent-info !important;
  font-weight: 800;
}

.source-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    padding: 2px 7px;
    border: 1px solid $border-color;
    border-radius: 999px;
    background: rgba(var(--accent-info-rgb), 0.07);
    color: $text-secondary;
    font-size: 11px;
    font-weight: 800;
  }
}

@media (max-width: 760px) {
  .trusted-sources-view {
    padding: 12px;
  }

  .sources-header,
  .source-permission-panel,
  .source-form {
    grid-template-columns: 1fr;
  }

  .source-form .wide {
    grid-column: auto;
  }
}
</style>
