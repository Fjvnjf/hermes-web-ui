<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NAlert, NButton, NSwitch, NTag, useMessage } from 'naive-ui'
import {
  collectBackupBrowserState,
  createBackupSnapshot,
  downloadBackupArchive,
  fetchBackupStatus,
  saveBackupSchedule,
  type BackupStatus,
  type BackupType,
} from '@/api/hermes/backup'

const message = useMessage()

const includeBrowserState = ref(true)
const loadingStatus = ref(false)
const downloadingType = ref<BackupType | ''>('')
const snapshotType = ref<BackupType>('full-owner')
const snapshotBusy = ref(false)
const scheduleBusy = ref(false)
const status = ref<BackupStatus | null>(null)

const backupTypes: Array<{
  type: BackupType
  title: string
  description: string
  includes: string[]
  excludes: string[]
  tone: 'owner' | 'business' | 'investor' | 'system'
}> = [
  {
    type: 'full-owner',
    title: 'Full Owner Backup ZIP',
    description: 'Broadest owner-only disaster recovery export.',
    includes: ['manifest', 'code metadata', 'redacted database JSON/schema', 'memory', 'session summaries', 'Kanban tasks', 'documents', 'reports/intelligence placeholders', 'jobs/activity', 'audit logs', 'redacted config'],
    excludes: ['plaintext secrets', 'raw DB copy', 'raw full transcripts by default'],
    tone: 'owner',
  },
  {
    type: 'business',
    title: 'Business Workspace Backup ZIP',
    description: 'Workspace data without code/database/audit internals.',
    includes: ['memory', 'session summaries', 'projects', 'Kanban tasks', 'documents', 'reports/intelligence placeholders', 'jobs/activity', 'redacted config'],
    excludes: ['code snapshot', 'raw database', 'audit logs', 'plaintext secrets'],
    tone: 'business',
  },
  {
    type: 'investor-approved',
    title: 'Investor Approved Backup ZIP',
    description: 'Approved-investor export shell. Raw data remains excluded until the data-room approval filter is connected.',
    includes: ['manifest', 'approved report/presentation placeholders', 'redacted config notes'],
    excludes: ['raw chats', 'memory', 'raw files', 'tasks', 'jobs', 'system tools', 'unapproved research'],
    tone: 'investor',
  },
  {
    type: 'code',
    title: 'Code Snapshot Backup',
    description: 'Source-control metadata and a size-limited tracked-code snapshot.',
    includes: ['git commit', 'branch', 'package files', 'changed files', 'tracked source files within size limits'],
    excludes: ['node_modules', 'dist artifacts', 'runtime secrets'],
    tone: 'system',
  },
  {
    type: 'memory-chat',
    title: 'Memory + Chat Summaries Backup',
    description: 'Curated memory files and session indexes/summaries without raw transcripts.',
    includes: ['MEMORY.md', 'USER.md', 'SOUL.md', 'session index', 'compression summaries', 'capture placeholders'],
    excludes: ['raw full chat transcripts by default', 'auth tokens'],
    tone: 'owner',
  },
  {
    type: 'documents',
    title: 'Documents Backup',
    description: 'Uploaded dashboard documents with category placeholders.',
    includes: ['uploaded files within size limits', 'document category folders', 'restore guide'],
    excludes: ['secret-like filenames', 'oversized files', 'runtime credentials'],
    tone: 'business',
  },
]

const browserStatePreview = computed(() => {
  if (!includeBrowserState.value || typeof window === 'undefined') return null
  return collectBackupBrowserState()
})

const lastBackupText = computed(() => {
  if (!status.value?.lastBackup) return 'No server snapshot has been created yet.'
  const backup = status.value.lastBackup
  return `${backup.file} / ${backup.type} / ${new Date(backup.createdAt).toLocaleString()}`
})

const excludedKeyCount = computed(() => browserStatePreview.value?.excludedKeys.length || 0)
const includedBrowserKeyCount = computed(() => Object.keys(browserStatePreview.value?.localStorage || {}).length)

async function loadStatus() {
  loadingStatus.value = true
  try {
    status.value = await fetchBackupStatus()
  } catch (err) {
    message.error(err instanceof Error ? err.message : 'Could not load backup status')
  } finally {
    loadingStatus.value = false
  }
}

async function handleDownload(type: BackupType) {
  downloadingType.value = type
  try {
    const fileName = await downloadBackupArchive(type, includeBrowserState.value)
    message.success(`Backup downloaded: ${fileName}`)
  } catch (err) {
    message.error(err instanceof Error ? err.message : 'Backup download failed')
  } finally {
    downloadingType.value = ''
  }
}

async function handleCreateSnapshot() {
  snapshotBusy.value = true
  try {
    const result = await createBackupSnapshot(snapshotType.value, includeBrowserState.value)
    message.success(`Server backup created: ${result.snapshot.file}`)
    await loadStatus()
  } catch (err) {
    message.error(err instanceof Error ? err.message : 'Could not create server backup')
  } finally {
    snapshotBusy.value = false
  }
}

async function handleSchedule(enabled: boolean) {
  scheduleBusy.value = true
  try {
    const result = await saveBackupSchedule(snapshotType.value, enabled)
    status.value = {
      ...(status.value || { backupDir: '', lastBackup: null, backups: [] }),
      schedule: result.schedule,
    }
    message.success(enabled ? 'Twice-daily backup metadata enabled' : 'Twice-daily backup metadata disabled')
  } catch (err) {
    message.error(err instanceof Error ? err.message : 'Could not update backup schedule metadata')
  } finally {
    scheduleBusy.value = false
  }
}

onMounted(loadStatus)
</script>

<template>
  <main class="backup-vault">
    <section class="vault-hero">
      <div>
        <p class="eyebrow">Owner-only disaster recovery</p>
        <h2>Local Backup Vault</h2>
        <p>Download organized ZIP backups of Hermes workspace data without exporting plaintext secrets by default.</p>
        <p class="section-help-text">Download backups so cloud loss does not destroy your work. Secrets are redacted by default; keep ZIP files private.</p>
      </div>
      <div class="vault-hero-actions">
        <span class="status-badge owner-only">Owner Only</span>
        <NButton :loading="loadingStatus" secondary @click="loadStatus">Refresh Status</NButton>
      </div>
    </section>

    <NAlert type="warning" :bordered="false" class="vault-warning">
      Backups may contain confidential business, product-development, research, document, task, memory, and investor-preparation data. Keep downloaded ZIP files private.
    </NAlert>

    <section class="status-grid">
      <article>
        <span>Last server snapshot</span>
        <strong>{{ lastBackupText }}</strong>
      </article>
      <article>
        <span>Server backup folder</span>
        <strong>{{ status?.backupDir || 'Loading...' }}</strong>
      </article>
      <article>
        <span>Default schedule</span>
        <strong>{{ status?.schedule.scheduleDisplay || '09:00 and 21:00 local time' }}</strong>
      </article>
      <article>
        <span>Retention</span>
        <strong>Last {{ status?.schedule.keepLast || 7 }} backups</strong>
      </article>
    </section>

    <section class="browser-state-panel">
      <div>
        <h3>Include Browser Workspace State</h3>
        <p>Exports local-only intelligence such as raw material sourcing, market opportunity, feasibility intelligence, IRR scenarios, executive board refresh metadata, and selected preferences.</p>
        <small>Auth tokens, API keys, passwords, cookies, SSH/private-key-like values, Cloudflare/tunnel credentials, and secret-like keys are excluded.</small>
      </div>
      <div class="state-toggle">
        <NSwitch v-model:value="includeBrowserState" />
        <span>{{ includeBrowserState ? `${includedBrowserKeyCount} keys included / ${excludedKeyCount} excluded` : 'Browser state not included' }}</span>
      </div>
    </section>

    <section class="backup-type-grid">
      <article v-for="item in backupTypes" :key="item.type" class="backup-card" :class="item.tone">
        <header>
          <div>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
          </div>
          <NTag size="small" :type="item.tone === 'investor' ? 'info' : item.tone === 'system' ? 'warning' : 'success'">
            {{ item.type }}
          </NTag>
        </header>
        <div class="card-columns">
          <div>
            <strong>Included</strong>
            <ul>
              <li v-for="entry in item.includes" :key="entry">{{ entry }}</li>
            </ul>
          </div>
          <div>
            <strong>Excluded / redacted</strong>
            <ul>
              <li v-for="entry in item.excludes" :key="entry">{{ entry }}</li>
            </ul>
          </div>
        </div>
        <NButton type="primary" :loading="downloadingType === item.type" @click="handleDownload(item.type)">
          Download ZIP
        </NButton>
      </article>
    </section>

    <section class="schedule-panel">
      <div>
        <p class="eyebrow">Server snapshots</p>
        <h3>Create Backup Now / Twice Daily Metadata</h3>
        <p>Manual server snapshots are stored in the server backup folder and retain the latest 7 archives. The twice-daily schedule is metadata only until an owner-approved runner calls the backup endpoint.</p>
      </div>
      <div class="snapshot-controls">
        <label>
          Backup type
          <select v-model="snapshotType">
            <option v-for="item in backupTypes" :key="item.type" :value="item.type">{{ item.title }}</option>
          </select>
        </label>
        <NButton type="primary" :loading="snapshotBusy" @click="handleCreateSnapshot">Create Backup Now</NButton>
        <NButton secondary :loading="scheduleBusy" @click="handleSchedule(!(status?.schedule.enabled))">
          {{ status?.schedule.enabled ? 'Disable Twice Daily Metadata' : 'Enable Twice Daily Metadata' }}
        </NButton>
      </div>
      <p class="schedule-note">{{ status?.schedule.note || 'Schedule metadata only. Use Create Backup Now until a trusted runner is configured.' }}</p>
    </section>

    <section class="restore-panel">
      <h3>Restore Guide Included In Every ZIP</h3>
      <div class="restore-grid">
        <span>Restore documents into the dashboard upload directory.</span>
        <span>Restore Memory manually after reviewing sensitivity.</span>
        <span>Recreate tasks from Kanban JSON exports.</span>
        <span>Restore code from Git commit/branch metadata.</span>
        <span>Re-enter secrets manually into secure runtime config.</span>
        <span>Do not run destructive restore automatically.</span>
      </div>
    </section>
  </main>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.backup-vault {
  display: grid;
  gap: 16px;
  padding: 22px;
}

.vault-hero,
.browser-state-panel,
.schedule-panel,
.restore-panel,
.backup-card,
.status-grid article {
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-card;
}

.vault-hero,
.browser-state-panel,
.schedule-panel,
.restore-panel,
.backup-card,
.status-grid article {
  position: relative;
  overflow: hidden;
}

.vault-hero::before,
.browser-state-panel::before,
.schedule-panel::before,
.restore-panel::before,
.backup-card::before,
.status-grid article::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: $executive-strip;
}

.vault-hero,
.browser-state-panel,
.schedule-panel {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  padding: 18px;
}

.vault-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  align-items: center;
}

.vault-hero h2,
.browser-state-panel h3,
.schedule-panel h3,
.restore-panel h3,
.backup-card h3 {
  margin: 0;
  color: $accent-primary;
}

.vault-hero p,
.browser-state-panel p,
.schedule-panel p,
.backup-card p,
.restore-panel span,
.status-grid span,
.browser-state-panel small {
  color: $text-secondary;
}

.eyebrow {
  margin: 0 0 6px !important;
  color: $accent-info !important;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.vault-warning {
  border: 1px solid rgba(var(--warning-rgb), 0.35);
  box-shadow: 0 0 0 1px rgba(var(--warning-rgb), 0.08);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;

  article {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 14px;
  }

  strong {
    color: $text-primary;
    overflow-wrap: anywhere;
  }
}

.state-toggle {
  display: grid;
  justify-items: end;
  gap: 8px;
  color: $text-secondary;
  white-space: nowrap;
}

.backup-type-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.backup-card {
  display: grid;
  gap: 14px;
  padding: 16px;

  header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  ul {
    margin: 8px 0 0;
    padding-left: 18px;
    color: $text-secondary;
  }
}

.card-columns,
.restore-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.card-columns strong {
  color: $text-primary;
}

.snapshot-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: end;

  label {
    display: grid;
    gap: 6px;
    color: $text-secondary;
    font-size: 12px;
  }

  select {
    min-height: 34px;
    border: 1px solid $border-color;
    border-radius: 6px;
    background: $bg-secondary;
    color: $text-primary;
    padding: 0 10px;
  }
}

.schedule-panel {
  flex-wrap: wrap;
}

.schedule-note {
  width: 100%;
  margin: 0;
  font-size: 12px;
}

.restore-panel {
  padding: 16px;
}

.restore-grid {
  margin-top: 12px;

  span {
    border: 1px solid $border-color;
    border-radius: 6px;
    background: $bg-secondary;
    padding: 10px;
  }
}

@media (max-width: 980px) {
  .status-grid,
  .backup-type-grid,
  .card-columns,
  .restore-grid {
    grid-template-columns: 1fr;
  }

  .vault-hero,
  .browser-state-panel,
  .schedule-panel {
    display: grid;
  }

  .state-toggle {
    justify-items: start;
    white-space: normal;
  }
}
</style>
