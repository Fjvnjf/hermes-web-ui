<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { darkTheme, NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { getThemeOverrides } from '@/styles/theme'
import { useTheme } from '@/composables/useTheme'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import { useKeyboard } from '@/composables/useKeyboard'
import { useAppStore } from '@/stores/hermes/app'
import SessionSearchModal from '@/components/hermes/chat/SessionSearchModal.vue'
import AuthEventListener from '@/components/auth/AuthEventListener.vue'
import DefaultCredentialPrompt from '@/components/auth/DefaultCredentialPrompt.vue'

const { isDark, isComic } = useTheme()
const { t } = useI18n()
const appStore = useAppStore()
const route = useRoute()
const router = useRouter()
const ready = ref(false)

const themeOverrides = computed(() => getThemeOverrides(isDark.value, isComic.value))
const naiveTheme = computed(() => darkTheme)

const isLoginPage = computed(() => route.name === 'login')

const nodeVersionLow = computed(() => {
  const v = appStore.nodeVersion
  const major = parseInt(v.split('.')[0], 10)
  return !isNaN(major) && major < 23
})

// Close mobile sidebar on route change
watch(() => route.path, () => {
  appStore.closeSidebar()
})

// Wait for router to resolve before rendering layout
router.isReady().then(() => {
  ready.value = true
})

onMounted(() => {
  if (!isLoginPage.value) {
    appStore.loadModels()
    appStore.startHealthPolling()
  }
})

onUnmounted(() => {
  appStore.stopHealthPolling()
})

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
          <div v-if="ready" class="app-layout" :class="{ 'no-sidebar': isLoginPage }">
            <button v-if="!isLoginPage" class="hamburger-btn" @click="appStore.toggleSidebar">
              <img src="/logo.png" alt="Menu" style="width: 24px; height: 24px;" />
            </button>
            <div v-if="!isLoginPage && appStore.sidebarOpen" class="mobile-backdrop" @click="appStore.closeSidebar" />
            <AppSidebar v-if="!isLoginPage" />
            <main class="app-main">
              <header v-if="!isLoginPage" class="command-topbar">
                <div class="topbar-title">
                  <span class="topbar-dot" :class="{ online: appStore.connected }"></span>
                  <span class="topbar-brand">Hermes Command Center</span>
                  <span class="topbar-pill">Live Ops</span>
                </div>
                <div class="topbar-meta">
                  <span class="topbar-pill subtle">Node {{ appStore.nodeVersion || 'checking' }}</span>
                  <span class="topbar-pill subtle">v{{ appStore.serverVersion || '0.6.4' }}</span>
                </div>
              </header>
              <router-view />
            </main>
          </div>
          <SessionSearchModal />
          <DefaultCredentialPrompt />
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

  &.no-sidebar {
    display: block;
  }
}

.app-main {
  flex: 1;
  overflow-y: auto;
  background-color: $bg-primary;
  min-width: 0;

  .no-sidebar & {
    height: calc(100 * var(--vh));
  }
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
  padding: 0 18px;
  background: $bg-shell;
  border-bottom: 1px solid $border-color;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
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
  padding: 3px 9px;
  border: 1px solid $border-color;
  border-radius: 999px;
  color: $text-muted;
  background: rgba(19, 26, 40, 0.72);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;

  &.subtle {
    font-family: $font-code;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
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

@media (max-width: $breakpoint-mobile) {
  .command-topbar {
    padding-left: 56px;
  }

  .topbar-meta {
    display: none;
  }

  .topbar-brand {
    font-size: 12px;
  }
}
</style>
