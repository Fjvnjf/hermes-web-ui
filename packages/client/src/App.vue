<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { darkTheme, NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { getThemeOverrides } from '@/styles/theme'
import { useTheme } from '@/composables/useTheme'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import { useKeyboard } from '@/composables/useKeyboard'
import { useAppStore } from '@/stores/hermes/app'
import SessionSearchModal from '@/components/hermes/chat/SessionSearchModal.vue'
import AuthEventListener from '@/components/auth/AuthEventListener.vue'
import { useSessionSearch } from '@/composables/useSessionSearch'
import CommandGlyph from '@/components/common/CommandGlyph.vue'
import { clearApiKey, getApiKey, getBaseUrlValue, hasApiKey } from '@/api/client'
import CommandLogin from '@/components/auth/CommandLogin.vue'

const { isDark, isComic } = useTheme()
const { t } = useI18n()
const appStore = useAppStore()
const router = useRouter()
const { openSessionSearch } = useSessionSearch()
const ready = ref(false)
const authReady = ref(false)
const authChecking = ref(true)

const themeOverrides = computed(() => getThemeOverrides(isDark.value, isComic.value))
const naiveTheme = computed(() => darkTheme)

const nodeVersionLow = computed(() => {
  const v = appStore.nodeVersion
  const major = parseInt(v.split('.')[0], 10)
  return !isNaN(major) && major < 23
})

// Close mobile sidebar on route change
watch(() => router.currentRoute.value.path, () => {
  appStore.closeSidebar()
})

// Wait for router to resolve before rendering layout
router.isReady().then(() => {
  ready.value = true
})

onMounted(() => {
  window.addEventListener('hermes-auth-notice', handleAuthNotice)
  window.addEventListener('storage', handleStorage)
  void initializeCommandCenter()
})

onUnmounted(() => {
  appStore.stopHealthPolling()
  window.removeEventListener('hermes-auth-notice', handleAuthNotice)
  window.removeEventListener('storage', handleStorage)
})

watch(authReady, (value, previous) => {
  if (value && !previous) appStore.loadModels()
})

async function initializeCommandCenter() {
  await refreshAuthState({ validate: true })
  appStore.startHealthPolling()
}

async function refreshAuthState(options: { validate?: boolean } = {}): Promise<boolean> {
  const token = getApiKey()
  if (!token) {
    authReady.value = false
    authChecking.value = false
    return false
  }

  if (!options.validate) {
    authReady.value = true
    authChecking.value = false
    return true
  }

  authChecking.value = true
  const valid = await validateStoredToken(token)
  authReady.value = valid
  authChecking.value = false
  return valid
}

async function validateStoredToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrlValue()}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) return true
    if (res.status === 401 || res.status === 403) clearApiKey()
    return false
  } catch {
    // If the backend is temporarily unreachable, keep the existing token and
    // let the app shell show its normal offline state once the user is inside.
    return hasApiKey()
  }
}

function handleAuthNotice(event: Event) {
  const kind = (event as CustomEvent<{ kind?: string }>).detail?.kind
  if (kind === 'expired' || kind === 'forbidden') {
    authReady.value = false
    authChecking.value = false
  }
}

function handleStorage(event: StorageEvent) {
  if (event.key === 'hermes_api_key') {
    void refreshAuthState({ validate: true })
  }
}

function handleAuthenticated() {
  void refreshAuthState({ validate: true })
}

function navigateTo(name: string) {
  void router.push({ name })
}

async function refreshCommandCenter() {
  if (!await refreshAuthState()) return
  await Promise.all([
    appStore.checkConnection(),
    appStore.reloadModels(),
  ])
}

useKeyboard()
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <NMessageProvider>
      <AuthEventListener />
      <NDialogProvider>
        <NNotificationProvider>
          <div v-if="nodeVersionLow && ready" class="node-warning-bar">
            {{ t('sidebar.nodeVersionWarning', { version: appStore.nodeVersion }) }}
          </div>
          <div v-if="ready && (authChecking || !authReady)" class="auth-gate">
            <div v-if="authChecking" class="auth-gate-panel">
              <CommandGlyph :size="34" />
              <p class="auth-gate-kicker">Hermes Command Center</p>
              <h1>Checking Secure Session</h1>
              <p>Validating your private command center link.</p>
            </div>
            <CommandLogin v-else @authenticated="handleAuthenticated" />
          </div>
          <div v-else-if="ready" class="app-layout">
            <button class="hamburger-btn" aria-label="Open command menu" @click="appStore.toggleSidebar">
              <CommandGlyph :size="24" />
            </button>
            <div v-if="appStore.sidebarOpen" class="mobile-backdrop" @click="appStore.closeSidebar" />
            <AppSidebar />
            <main class="app-main">
              <header class="command-topbar">
                <div class="topbar-title">
                  <span class="topbar-dot" :class="{ online: appStore.connected }"></span>
                  <span class="topbar-brand">Hermes Command Center</span>
                </div>
                <div class="topbar-meta">
                  <span class="topbar-pill" :class="{ online: appStore.connected }">
                    {{ appStore.connected ? 'API Online' : 'API Offline' }}
                  </span>
                  <span class="topbar-pill subtle">Node {{ appStore.nodeVersion || 'checking' }}</span>
                  <span class="topbar-pill subtle">v{{ appStore.serverVersion || '0.6.4' }}</span>
                </div>
                <div class="topbar-actions" aria-label="Command center quick actions">
                  <button class="topbar-action" type="button" title="Search sessions" aria-label="Search" @click="openSessionSearch">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <span>Search</span>
                  </button>
                  <button class="topbar-action" type="button" title="Open chat" aria-label="Chat" @click="navigateTo('hermes.chat')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>Chat</span>
                  </button>
                  <button class="topbar-action" type="button" title="Open files" aria-label="Files" @click="navigateTo('hermes.files')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    </svg>
                    <span>Files</span>
                  </button>
                  <button class="topbar-action" type="button" title="Open terminal" aria-label="Terminal" @click="navigateTo('hermes.terminal')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                    <span>Terminal</span>
                  </button>
                  <button class="topbar-action" type="button" title="Open settings" aria-label="Settings" @click="navigateTo('hermes.settings')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.82.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.82-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.26.55.82 1 1.55 1H21a2 2 0 1 1 0 4h-.05A1.7 1.7 0 0 0 19.4 15z" />
                    </svg>
                    <span>Settings</span>
                  </button>
                  <button class="topbar-action icon-only" type="button" title="Refresh status and models" aria-label="Refresh status and models" @click="refreshCommandCenter">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
              </header>
              <router-view />
            </main>
          </div>
          <SessionSearchModal v-if="authReady" />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.app-layout {
  display: flex;
  height: calc(100 * var(--vh));
  width: 100vw;
  overflow: hidden;
}

.auth-gate {
  min-height: calc(100 * var(--vh));
  display: grid;
  place-items: center;
  padding: 24px;
  background: #060a12;
  color: $text-primary;
}

.auth-gate-panel {
  width: min(460px, 100%);
  border: 1px solid $border-color;
  border-radius: 8px;
  padding: 28px;
  background: $bg-card;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
}

.auth-gate-kicker {
  margin: 16px 0 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.auth-gate-panel h1 {
  margin: 0 0 10px;
  color: $accent-primary;
  font-size: 24px;
  line-height: 1.2;
}

.auth-gate-panel p {
  margin: 0;
  color: $text-secondary;
  line-height: 1.6;
}

.app-main {
  --app-content-height: calc(100 * var(--vh) - #{$header-height});
  flex: 1;
  overflow-y: auto;
  background-color: #060a12;
  min-width: 0;
}

.command-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  height: $header-height;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  background: #080c14;
  border-bottom: 1px solid $border-color;
}

.topbar-title,
.topbar-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.topbar-brand {
  color: $accent-primary;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

.topbar-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: $error;
  box-shadow: 0 0 8px rgba(var(--error-rgb), 0.65);
  flex-shrink: 0;

  &.online {
    background: $success;
    box-shadow: 0 0 8px rgba(var(--success-rgb), 0.8);
  }
}

.topbar-pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 4px 9px;
  border: 1px solid $border-color;
  border-radius: 999px;
  color: $text-muted;
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;

  &.online {
    color: $success;
    border-color: rgba(var(--success-rgb), 0.45);
    background: rgba(var(--success-rgb), 0.08);
  }

  &.subtle {
    font-family: $font-code;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  min-width: 0;
}

.topbar-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 6px 10px;
  border: 1px solid $border-color;
  border-radius: 999px;
  background: $bg-card;
  color: $text-secondary;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  transition: color $transition-fast, border-color $transition-fast, background $transition-fast;

  &:hover {
    color: $accent-primary;
    border-color: rgba(var(--accent-primary-rgb), 0.7);
    background: $bg-card-hover;
  }

  svg {
    flex-shrink: 0;
  }

  &.icon-only {
    width: 30px;
    justify-content: center;
    padding: 0;

    span {
      display: none;
    }
  }
}

.node-warning-bar {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 100;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 500;
  color: $warning;
  background-color: #1d1208;
  border-bottom: 1px solid #6b3a16;
  text-align: center;
  line-height: 1.4;
}

@media (max-width: 1180px) {
  .topbar-meta .subtle {
    display: none;
  }
}

@media (max-width: 1024px) {
  .topbar-action {
    width: 30px;
    justify-content: center;
    padding: 0;

    span {
      display: none;
    }
  }
}

@media (max-width: $breakpoint-mobile) {
  .command-topbar {
    padding-left: 56px;
  }

  .topbar-meta {
    display: none;
  }

  .topbar-actions {
    display: none;
  }

  .topbar-brand {
    font-size: 12px;
  }
}
</style>
