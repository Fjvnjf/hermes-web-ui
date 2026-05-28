<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'

const message = useMessage()
const { t } = useI18n()

let lastNoticeAt = 0
const NOTICE_DEBOUNCE_MS = 10_000

function onAuthNotice(event: Event) {
  const detail = (event as CustomEvent<{ kind?: string }>).detail || {}
  const now = Date.now()
  // Multiple startup requests can fail together; one visible auth notice is enough.
  if (now - lastNoticeAt < NOTICE_DEBOUNCE_MS) return
  lastNoticeAt = now

  if (detail.kind === 'forbidden') {
    message.error(t('login.accessDenied'))
    return
  }
  message.error(t('login.sessionExpired'))
}

onMounted(() => {
  window.addEventListener('hermes-auth-notice', onAuthNotice)
})

onUnmounted(() => {
  window.removeEventListener('hermes-auth-notice', onAuthNotice)
})
</script>

<template>
  <span style="display: none" aria-hidden="true" />
</template>
