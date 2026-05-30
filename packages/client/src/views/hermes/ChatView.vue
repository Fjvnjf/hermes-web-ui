<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from '@/components/hermes/chat/ChatPanel.vue'
import { useAppStore } from '@/stores/hermes/app'
import { useChatStore } from '@/stores/hermes/chat'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { useSettingsStore } from '@/stores/hermes/settings'
import { canAccessRouteName, getFrontendAccessRole } from '@/utils/accessControl'
import { getStoredDefaultProfile, getStoredUserProfiles } from '@/api/client'

const appStore = useAppStore()
const chatStore = useChatStore()
const profilesStore = useProfilesStore()
const settingsStore = useSettingsStore()
const route = useRoute()
const router = useRouter()

const routeSessionId = computed(() => {
  const value = route.params.sessionId
  return typeof value === 'string' && value.trim() ? value : null
})

const routeProfile = computed(() => {
  const value = route.query.profile
  return typeof value === 'string' && value.trim() ? value : null
})
const frontendRole = computed(() => getFrontendAccessRole())
const canLoadProfiles = computed(() => canAccessRouteName('hermes.profiles', frontendRole.value))
const canLoadSettings = computed(() => canAccessRouteName('hermes.settings', frontendRole.value))
const canLoadModels = computed(() => canAccessRouteName('hermes.models', frontendRole.value))

async function loadRouteSession() {
  await chatStore.loadSessions(chatStore.sessionProfileFilter, routeSessionId.value)
  if (routeSessionId.value && chatStore.activeSessionId !== routeSessionId.value) {
    await router.replace({ name: 'hermes.chat' })
  }
}

onMounted(async () => {
  if (canLoadModels.value) appStore.loadModels()
  if (!canLoadProfiles.value) {
    profilesStore.applyAssignedProfiles(getStoredUserProfiles(), getStoredDefaultProfile())
  }
  // Owner/admin roles preload profile, model, and display settings. Business
  // roles use their own assigned profile context and avoid restricted APIs.
  await Promise.all([
    canLoadProfiles.value ? profilesStore.fetchProfiles() : Promise.resolve(),
    canLoadSettings.value ? settingsStore.fetchSettings() : Promise.resolve(),
  ])
  await loadRouteSession()
})

watch([routeSessionId, routeProfile], async ([sessionId]) => {
  if (!chatStore.sessionsLoaded) return
  if (!sessionId) {
    await chatStore.loadSessions(chatStore.sessionProfileFilter)
    return
  }
  if (chatStore.activeSessionId === sessionId) return

  const exists = chatStore.sessions.some(session => session.id === sessionId)
  if (!exists) {
    await loadRouteSession()
    return
  }

  await chatStore.switchSession(sessionId)
})
</script>

<template>
  <div class="chat-view">
    <ChatPanel />
  </div>
</template>

<style scoped lang="scss">
.chat-view {
  height: var(--app-content-height, calc(100 * var(--vh)));
  display: flex;
  flex-direction: column;
}
</style>
