<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import VirtualMessageList from "./VirtualMessageList.vue";
import MessageItem from "./MessageItem.vue";
import CommandEmptyState from "@/components/common/CommandEmptyState.vue";
import { useChatStore } from "@/stores/hermes/chat";
import { useToolTraceVisibility } from "@/composables/useToolTraceVisibility";
import type { Session } from "@/stores/hermes/chat";

const props = defineProps<{
  session?: Session | null; // Optional: use this session instead of chatStore.activeSession
}>();

const chatStore = useChatStore();
const { toolTraceVisible } = useToolTraceVisibility();
const { t } = useI18n();
const listRef = ref<InstanceType<typeof VirtualMessageList> | null>(null);

// Use provided session or fall back to chatStore's active session
const activeSession = computed(() => props.session || chatStore.activeSession);

const displayMessages = computed(() =>
  (activeSession.value?.messages || []).filter((m) => {
    // Tool messages without a name are internal use only and remain hidden.
    if (m.role === 'tool') return toolTraceVisible.value && !!m.toolName
    // Filter out messages with empty content.
    if (!m.content?.trim()) return false
    return true
  }),
);

function isNearBottom(threshold = 200): boolean {
  return listRef.value?.isNearBottom(threshold) ?? true;
}

function scrollToBottom() {
  listRef.value?.scrollToBottom();
}

function scrollToMessage(messageId: string) {
  listRef.value?.scrollToMessage(messageId);
}

function scrollToAnchor(messageId: string, anchorId: string) {
  listRef.value?.scrollToAnchor(messageId, anchorId);
}

// Scroll to bottom on session switch
watch(
  () => activeSession.value?.id,
  (id) => {
    if (!id) return;
    if (chatStore.focusMessageId) {
      scrollToMessage(chatStore.focusMessageId);
      return;
    }
    scrollToBottom();
  },
  { immediate: true },
);

watch(
  () => chatStore.focusMessageId,
  (messageId) => {
    if (!messageId) return;
    scrollToMessage(messageId);
  },
);

// During streaming, only auto-scroll if the user is already near the bottom
watch(
  () => (activeSession.value?.messages || [])[((activeSession.value?.messages || []).length - 1)]?.content,
  (content) => {
    if (!content) return
    if (!isNearBottom()) return;
    scrollToBottom();
  },
);

watch(
  () => (activeSession.value?.messages || []).length,
  (length) => {
    if (length === 0) return
    if (!isNearBottom()) return;
    scrollToBottom();
  },
);

defineExpose({
  scrollToBottom,
  scrollToMessage,
  scrollToAnchor,
});
</script>

<template>
  <VirtualMessageList
    ref="listRef"
    :messages="displayMessages"
  >
    <template #empty>
      <CommandEmptyState
        title="No visible messages"
        :subtitle="t('chat.emptyState')"
        context="History view"
      />
    </template>
    <template #item="{ message: msg }">
      <MessageItem
        :message="msg"
        :highlight="chatStore.focusMessageId === msg.id"
      />
    </template>
  </VirtualMessageList>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
