<script setup lang="ts">
import { renameSession, setSessionWorkspace, batchDeleteSessions, exportSession } from "@/api/hermes/sessions";
import { useChatStore, type Session } from "@/stores/hermes/chat";
import { useAppStore } from "@/stores/hermes/app";
import { useProfilesStore } from "@/stores/hermes/profiles";
import { useSessionBrowserPrefsStore } from "@/stores/hermes/session-browser-prefs";
import {
  NButton,
  NDropdown,
  NInput,
  NModal,
  NSelect,
  NTooltip,
  NPopconfirm,
  useMessage,
  type DropdownOption,
} from "naive-ui";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { copyToClipboard } from "@/utils/clipboard";
import {
  inferCaptureContext,
  shouldPromptForCapture,
  type CaptureContextId,
} from "@/composables/useSessionCapture";
import FolderPicker from "./FolderPicker.vue";
import ChatInput from "./ChatInput.vue";
import ConversationMonitorPane from "./ConversationMonitorPane.vue";
import MessageList from "./MessageList.vue";
import SessionListItem from "./SessionListItem.vue";
import DrawerPanel from "./DrawerPanel.vue";
import OutlinePanel from "./OutlinePanel.vue";
import SessionCaptureDrawer from "@/components/session-capture/SessionCaptureDrawer.vue";

const chatStore = useChatStore();
const appStore = useAppStore();
const profilesStore = useProfilesStore();
const sessionBrowserPrefsStore = useSessionBrowserPrefsStore();
const router = useRouter();
const route = useRoute();
const message = useMessage();
const { t } = useI18n();

const showDrawer = ref(false);
const showCaptureDrawer = ref(false);
const drawerActiveTab = ref<"terminal" | "files">("files");
const showOutline = ref(false);
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null);

const currentMode = ref<"chat" | "live">("chat");

// Batch selection mode
const isBatchMode = ref(false);
const selectedSessionKeys = ref<Set<string>>(new Set());
const showBatchDeleteConfirm = ref(false);
const isBatchDeleting = ref(false);

// Initialize synchronously from the media query so first paint is correct.
// On narrow viewports the session list is an absolute-positioned overlay
// (z-index 10) on top of the chat area; if we default to `true`, onMounted
// only flips it to `false` AFTER the first render, causing a visible flash
// where the session list covers the chat content ("auto-fixes after a
// moment" — that was the race).
const showSessions = ref(
  typeof window === "undefined" ||
    !window.matchMedia("(max-width: 768px)").matches,
);
let mobileQuery: MediaQueryList | null = null;
const isMobile = ref(false);

function sessionHref(sessionId: string) {
  return router.resolve({
    name: "hermes.session",
    params: { sessionId },
  }).href;
}

function openSessionInNewTab(sessionId: string) {
  if (typeof window === "undefined") return;
  window.open(sessionHref(sessionId), "_blank", "noopener,noreferrer");
}

function handleOutlineNavigate(target: { messageId: string; anchorId: string }) {
  messageListRef.value?.scrollToAnchor(target.messageId, target.anchorId);
}

async function handleSessionClick(sessionId: string) {
  if (sessionId !== chatStore.activeSessionId && maybePromptCaptureBeforeLeaving()) return;
  await router.push({
    name: "hermes.session",
    params: { sessionId },
  });
  if (mobileQuery?.matches) showSessions.value = false;
}

function handleMobileChange(e: MediaQueryListEvent | MediaQueryList) {
  isMobile.value = e.matches;
  if (e.matches && showSessions.value) {
    showSessions.value = false;
  }
}

onMounted(() => {
  mobileQuery = window.matchMedia("(max-width: 768px)");
  handleMobileChange(mobileQuery);
  mobileQuery.addEventListener("change", handleMobileChange);
  if (profilesStore.profiles.length === 0) {
    void profilesStore.fetchProfiles();
  }
});

onUnmounted(() => {
  mobileQuery?.removeEventListener("change", handleMobileChange);
});
const showRenameModal = ref(false);
const renameValue = ref("");
const renameSessionId = ref<string | null>(null);
const renameInputRef = ref<InstanceType<typeof NInput> | null>(null);
const sessionProfileFilter = computed(() => chatStore.sessionProfileFilter);
const profileFilterOptions = computed(() => [
  { label: t("chat.allProfiles"), value: "__all__" },
  ...profilesStore.profiles.map((profile) => ({
    label: profile.name,
    value: profile.name,
  })),
]);

async function handleProfileFilterChange(value: string) {
  chatStore.sessionProfileFilter = value === "__all__" ? null : value;
  await chatStore.loadSessions(chatStore.sessionProfileFilter);
}

function sortSessionsWithActiveFirst(items: Session[]): Session[] {
  return [...items].sort((a, b) => {
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

const pinnedSessions = computed(() =>
  sortSessionsWithActiveFirst(
    chatStore.sessions.filter((session) =>
      sessionBrowserPrefsStore.isPinned(session.id),
    ),
  ),
);

const unpinnedSessions = computed(() =>
  sortSessionsWithActiveFirst(
    chatStore.sessions.filter(
      (session) => !sessionBrowserPrefsStore.isPinned(session.id),
    ),
  ),
);

watch(
  () => [
    chatStore.sessionsLoaded,
    ...chatStore.sessions.map((session) => session.id),
  ],
  (value) => {
    const sessionIds = value.slice(1) as string[];
    if (!value[0] || sessionIds.length === 0) return;
    sessionBrowserPrefsStore.pruneMissingSessions(sessionIds);
  },
  { immediate: true },
);

const activeSessionTitle = computed(
  () => chatStore.activeSession?.title || t("chat.newChat"),
);

const headerTitle = computed(() =>
  currentMode.value === "live"
    ? t("chat.liveSessions")
    : activeSessionTitle.value,
);
const activeProfileLabel = computed(() =>
  chatStore.activeSession?.profile || profilesStore.activeProfileName || "default",
);
const activeModelLabel = computed(() => {
  const session = chatStore.activeSession;
  const model = session?.model || appStore.selectedModel || "";
  const provider = session?.provider || appStore.selectedProvider || "";
  return model ? appStore.displayModelName(model, provider) : "Not selected";
});
const activeSourceLabel = computed(() =>
  (chatStore.activeSession?.source || "web").toUpperCase(),
);
const connectionLabel = computed(() => (appStore.connected ? "Online" : "Offline"));
const messageCountLabel = computed(() => String(chatStore.messages.length));
const routeCaptureContext = computed(() => {
  const value = route.query.captureContext;
  return typeof value === "string" ? value : null;
});
const sessionCaptureContext = computed<CaptureContextId>(() =>
  inferCaptureContext(chatStore.messages, activeSessionTitle.value, routeCaptureContext.value),
);
const canReviewCapture = computed(() =>
  Boolean(chatStore.activeSessionId && chatStore.messages.length > 0),
);

const activeApproval = computed(() => chatStore.activePendingApproval);
const visibleApproval = computed(() => activeApproval.value);

const activeClarify = computed(() => chatStore.activePendingClarify);
const visibleClarify = computed(() => activeClarify.value);
const clarifyResponse = ref('');

function handleClarify(response?: string) {
  const finalResponse = response !== undefined ? response : clarifyResponse.value.trim();
  chatStore.respondToClarify(finalResponse);
  clarifyResponse.value = '';
}

const showNewChatModal = ref(false);
const newChatProfile = ref<string>("default");
const newChatProvider = ref<string>("");
const newChatModel = ref<string>("");
const newChatLoading = ref(false);

function getModelGroupsForProfile(profile: string) {
  const profileModels = appStore.profileModelGroups.find(
    (entry) => entry.profile === profile,
  );
  return profileModels?.groups || [];
}

function getDefaultModelForProfile(profile: string) {
  const groups = getModelGroupsForProfile(profile);
  const profileModels = appStore.profileModelGroups.find(
    (entry) => entry.profile === profile,
  );
  const defaultProvider = profileModels?.default_provider || "";
  const defaultModel = profileModels?.default || "";
  const providerGroup = defaultProvider
    ? groups.find((group) => group.provider === defaultProvider)
    : undefined;
  const fallbackGroup = providerGroup || groups.find((group) => group.models.length > 0);
  return {
    provider: fallbackGroup?.provider || "",
    model: fallbackGroup?.models.includes(defaultModel)
      ? defaultModel
      : fallbackGroup?.models[0] || "",
  };
}

const newChatProfileOptions = computed(() =>
  (profilesStore.profiles.length > 0 ? profilesStore.profiles : [{ name: "default" }]).map((profile) => ({
    label: profile.name,
    value: profile.name,
  })),
);

const newChatModelGroups = computed(() => {
  return getModelGroupsForProfile(newChatProfile.value);
});

const newChatProviderOptions = computed(() =>
  newChatModelGroups.value.map((group) => ({
    label: group.label || group.provider,
    value: group.provider,
  })),
);

const newChatModelOptions = computed(() => {
  const group = newChatModelGroups.value.find(
    (item) => item.provider === newChatProvider.value,
  );
  return (group?.models || []).map((model) => ({
    label: appStore.displayModelName(model, group?.provider),
    value: model,
  }));
});

function syncNewChatModelSelection() {
  const defaults = getDefaultModelForProfile(newChatProfile.value);
  newChatProvider.value = defaults.provider;
  newChatModel.value = defaults.model;
}

async function openNewChatModal() {
  if (maybePromptCaptureBeforeLeaving()) return;
  showNewChatModal.value = true;
  newChatLoading.value = true;
  try {
    if (profilesStore.profiles.length === 0) await profilesStore.fetchProfiles();
    if (appStore.modelGroups.length === 0 && appStore.profileModelGroups.length === 0) {
      await appStore.loadModels();
    }
    newChatProfile.value =
      profilesStore.activeProfileName ||
      profilesStore.profiles.find((profile) => profile.active)?.name ||
      profilesStore.profiles[0]?.name ||
      "default";
    syncNewChatModelSelection();
  } finally {
    newChatLoading.value = false;
  }
}

function maybePromptCaptureBeforeLeaving(): boolean {
  if (shouldPromptForCapture(chatStore.activeSessionId, chatStore.messages)) {
    showCaptureDrawer.value = true;
    return true;
  }
  return false;
}

function openSessionCapture() {
  showCaptureDrawer.value = true;
}

function handleNewChatProfileChange(value: string) {
  newChatProfile.value = value;
  syncNewChatModelSelection();
}

function handleNewChatProviderChange(value: string) {
  newChatProvider.value = value;
  newChatModel.value = newChatModelOptions.value[0]?.value || "";
}

async function confirmNewChat() {
  const session = chatStore.newChat({
    profile: newChatProfile.value,
    provider: newChatProvider.value,
    model: newChatModel.value,
  });
  await router.push({
    name: "hermes.session",
    params: { sessionId: session.id },
  });
  showNewChatModal.value = false;
}

function handleApproval(choice: "once" | "session" | "always" | "deny") {
  chatStore.respondApproval(choice);
}

function sessionProfile(sessionId: string): string | null {
  return chatStore.sessions.find((session) => session.id === sessionId)?.profile || null;
}

function buildSessionUrl(sessionId: string, profile?: string | null): string {
  const href = router.resolve({
    name: "hermes.session",
    params: { sessionId },
    query: profile ? { profile } : undefined,
  }).href;
  return `${window.location.origin}${window.location.pathname}${href}`;
}

async function copySessionLink(id?: string) {
  const sessionId = id || chatStore.activeSessionId;
  if (sessionId) {
    const ok = await copyToClipboard(buildSessionUrl(sessionId, sessionProfile(sessionId)));
    if (ok) message.success(t("common.copied"));
    else message.error(t("common.copied") + " ✗");
  }
}

async function copySessionId(id?: string) {
  const sessionId = id || chatStore.activeSessionId;
  if (sessionId) {
    const ok = await copyToClipboard(sessionId);
    if (ok) message.success(t("common.copied"));
    else message.error(t("common.copied") + " ✗");
  }
}

function openCommandDrawer(tab: "terminal" | "files") {
  drawerActiveTab.value = tab;
  showDrawer.value = true;
}

function openCommandSettings() {
  void router.push({ name: "hermes.settings" });
}

async function refreshCommandRuntime() {
  await Promise.all([
    appStore.checkConnection(),
    appStore.reloadModels(),
    chatStore.loadSessions(chatStore.sessionProfileFilter),
  ]);
}

function handleDeleteSession(id: string) {
  sessionBrowserPrefsStore.removePinned(id);
  chatStore.deleteSession(id);
  message.success(t("chat.sessionDeleted"));
}

function toggleBatchMode() {
  if (isBatchDeleting.value) return;
  isBatchMode.value = !isBatchMode.value;
  if (!isBatchMode.value) {
    selectedSessionKeys.value.clear();
    showBatchDeleteConfirm.value = false;
  }
}

function sessionSelectionKey(session: Pick<Session, "id" | "profile">): string {
  return `${session.profile || "default"}\u0000${session.id}`;
}

function toggleSessionSelection(session: Session) {
  if (isBatchDeleting.value) return;
  const key = sessionSelectionKey(session);
  if (selectedSessionKeys.value.has(key)) {
    selectedSessionKeys.value.delete(key);
  } else {
    selectedSessionKeys.value.add(key);
  }
  selectedSessionKeys.value = new Set(selectedSessionKeys.value);
  if (selectedSessionKeys.value.size === 0) {
    showBatchDeleteConfirm.value = false;
  }
}

function isSessionSelected(session: Session): boolean {
  return selectedSessionKeys.value.has(sessionSelectionKey(session));
}

async function handleBatchDelete() {
  if (selectedSessionKeys.value.size === 0 || isBatchDeleting.value) return;

  const sessionsByKey = new Map(chatStore.sessions.map((session) => [sessionSelectionKey(session), session]));
  const targets = Array.from(selectedSessionKeys.value)
    .map((key) => sessionsByKey.get(key))
    .filter((session): session is Session => Boolean(session))
    .map((session) => ({ id: session.id, profile: session.profile || null }));
  if (targets.length === 0) return;
  isBatchDeleting.value = true;
  try {
    const result = await batchDeleteSessions(targets);
    if (result.deleted > 0) {
      // Remove from pinned sessions
      for (const target of targets) {
        sessionBrowserPrefsStore.removePinned(target.id);
      }

      // Remove deleted sessions from local store (without calling API again)
      // Use loadSessions to refresh from server instead of manual filtering
      await chatStore.loadSessions(chatStore.sessionProfileFilter);

      message.success(t("chat.batchDeleteSuccess", { count: result.deleted }));
      if (result.failed > 0) {
        message.warning(t("chat.batchDeletePartial", { failed: result.failed }));
      }
    } else {
      message.error(t("chat.batchDeleteFailed"));
    }
  } catch (err: any) {
    message.error(t("chat.batchDeleteFailed"));
  } finally {
    isBatchDeleting.value = false;
    showBatchDeleteConfirm.value = false;
    isBatchMode.value = false;
    selectedSessionKeys.value.clear();
  }
}

function handleBatchDeleteConfirm() {
  void handleBatchDelete();
  return false;
}

function selectAllSessions() {
  if (isBatchDeleting.value) return;
  selectedSessionKeys.value.clear();
  for (const session of chatStore.sessions) {
    if (session.id !== chatStore.activeSessionId) {
      selectedSessionKeys.value.add(sessionSelectionKey(session));
    }
  }
  selectedSessionKeys.value = new Set(selectedSessionKeys.value);
}

const selectedCount = computed(() => selectedSessionKeys.value.size);
const canSelectAll = computed(() => {
  return chatStore.sessions.some(s => s.id !== chatStore.activeSessionId);
});

const contextSessionId = ref<string | null>(null);
const contextSessionPinned = computed(() =>
  contextSessionId.value
    ? sessionBrowserPrefsStore.isPinned(contextSessionId.value)
    : false,
);
const contextSession = computed(() =>
  contextSessionId.value
    ? chatStore.sessions.find((session) => session.id === contextSessionId.value) || null
    : null,
);

const contextMenuOptions = computed(() => {
  const options: DropdownOption[] = [{
    label: t(contextSessionPinned.value ? "chat.unpin" : "chat.pin"),
    key: "pin",
  },
  { label: t("chat.rename"), key: "rename" },
  { label: t("chat.setWorkspace"), key: "workspace" }]

  if (contextSession.value?.source === "cli") {
    options.push({ label: t("chat.setModel"), key: "model" })
  }

  options.push({
    label: t("chat.export"),
    key: "export",
    children: [
      {
        label: t("chat.exportFull"),
        key: "export-full",
        children: [
          { label: "JSON", key: "export-full-json" },
          { label: "TXT", key: "export-full-txt" },
        ],
      },
      {
        label: t("chat.exportCompressed"),
        key: "export-compressed",
        children: [
          { label: "JSON", key: "export-compressed-json" },
          { label: "TXT", key: "export-compressed-txt" },
        ],
      },
    ],
  })
  options.push({ label: t("chat.openSessionInNewTab"), key: "open-link" })
  options.push({ label: t("chat.copySessionLink"), key: "copy-link" })
  options.push({ label: t("chat.copySessionId"), key: "copy-id" })
  return options
});

function handleContextMenu(e: MouseEvent, sessionId: string) {
  e.preventDefault();
  contextSessionId.value = sessionId;
  showContextMenu.value = true;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
}

const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

function parseExportKey(key: string): { mode: 'full' | 'compressed'; ext: 'json' | 'txt' } | null {
  if (key === 'export-full-json') return { mode: 'full', ext: 'json' }
  if (key === 'export-full-txt') return { mode: 'full', ext: 'txt' }
  if (key === 'export-compressed-json') return { mode: 'compressed', ext: 'json' }
  if (key === 'export-compressed-txt') return { mode: 'compressed', ext: 'txt' }
  return null
}

async function handleContextMenuSelect(key: string) {
  showContextMenu.value = false;
  if (!contextSessionId.value) return;
  if (key === "pin") {
    sessionBrowserPrefsStore.togglePinned(contextSessionId.value);
    return;
  }
  if (key === "copy-link") {
    copySessionLink(contextSessionId.value);
  } else if (key === "copy-id") {
    copySessionId(contextSessionId.value);
  } else if (key === "open-link") {
    openSessionInNewTab(contextSessionId.value);
  } else if (parseExportKey(key)) {
    const { mode, ext } = parseExportKey(key)!;
    const loadingMsg = mode === "compressed" ? message.loading(t("chat.exportCompressing"), { duration: 0 }) : null;
    try {
      await exportSession(contextSessionId.value, mode, ext);
      loadingMsg?.destroy();
      message.success(t("chat.exportSuccess"));
    } catch {
      loadingMsg?.destroy();
      message.error(t("chat.exportFailed"));
    }
  } else if (key === "workspace") {
    const session = chatStore.sessions.find(
      (s) => s.id === contextSessionId.value,
    );
    workspaceSessionId.value = contextSessionId.value;
    workspaceValue.value = session?.workspace || "";
    showWorkspaceModal.value = true;
  } else if (key === "model") {
    await openSessionModelModal(contextSessionId.value);
  } else if (key === "rename") {
    const session = chatStore.sessions.find(
      (s) => s.id === contextSessionId.value,
    );
    renameSessionId.value = contextSessionId.value;
    renameValue.value = session?.title || "";
    showRenameModal.value = true;
    nextTick(() => {
      renameInputRef.value?.focus();
    });
  }
}

function handleClickOutside() {
  showContextMenu.value = false;
}

async function handleRenameConfirm() {
  if (!renameSessionId.value || !renameValue.value.trim()) return;
  const ok = await renameSession(
    renameSessionId.value,
    renameValue.value.trim(),
  );
  if (ok) {
    const session = chatStore.sessions.find(
      (s) => s.id === renameSessionId.value,
    );
    if (session) session.title = renameValue.value.trim();
    if (chatStore.activeSession?.id === renameSessionId.value) {
      chatStore.activeSession.title = renameValue.value.trim();
    }
    message.success(t("chat.renamed"));
  } else {
    message.error(t("chat.renameFailed"));
  }
  showRenameModal.value = false;
}

const showWorkspaceModal = ref(false);
const workspaceValue = ref("");
const workspaceSessionId = ref<string | null>(null);

async function handleWorkspaceConfirm() {
  if (!workspaceSessionId.value) return;
  const ok = await setSessionWorkspace(
    workspaceSessionId.value,
    workspaceValue.value || null,
  );
  if (ok) {
    const session = chatStore.sessions.find(
      (s) => s.id === workspaceSessionId.value,
    );
    if (session) session.workspace = workspaceValue.value || null;
    if (chatStore.activeSession?.id === workspaceSessionId.value) {
      chatStore.activeSession.workspace = workspaceValue.value || null;
    }
    message.success(t("chat.workspaceSet"));
  } else {
    message.error(t("chat.workspaceSetFailed"));
  }
  showWorkspaceModal.value = false;
}

const showSessionModelModal = ref(false);
const sessionModelSessionId = ref<string | null>(null);
const sessionModelSearch = ref("");
const sessionModelCollapsedGroups = ref<Record<string, boolean>>({});
const sessionModelValue = ref("");
const sessionModelProvider = ref("");
const sessionModelCustomInput = ref("");
const sessionModelCustomProvider = ref("");

const sessionModelProfile = computed<string | null>(() => {
  const session = chatStore.sessions.find((s) => s.id === sessionModelSessionId.value);
  return session?.profile || null;
});

const sessionModelBaseGroups = computed(() =>
  sessionModelProfile.value ? getModelGroupsForProfile(sessionModelProfile.value) : [],
);

const sessionModelProviderOptions = computed(() =>
  sessionModelBaseGroups.value.map((group) => ({ label: group.label, value: group.provider })),
);

const sessionModelGroupsWithCustom = computed(() =>
  sessionModelBaseGroups.value.map((group) => ({
    ...group,
    models: [
      ...group.models,
      ...(appStore.customModels[group.provider] || []).filter(
        (model) => !group.models.includes(model),
      ),
    ],
  })),
);

const filteredSessionModelGroups = computed(() => {
  const query = sessionModelSearch.value.trim().toLowerCase();
  if (!query) return sessionModelGroupsWithCustom.value;
  return sessionModelGroupsWithCustom.value
    .map((group) => ({
      ...group,
      models: group.models.filter((model) => {
        const displayName = appStore.displayModelName(model, group.provider);
        return model.toLowerCase().includes(query) || displayName.toLowerCase().includes(query);
      }),
    }))
    .filter((group) => group.models.length > 0 || group.label.toLowerCase().includes(query));
});

async function openSessionModelModal(sessionId: string) {
  if (appStore.modelGroups.length === 0 && appStore.profileModelGroups.length === 0) {
    await appStore.loadModels();
  }
  const session = chatStore.sessions.find((s) => s.id === sessionId);
  const defaults = session?.profile
    ? getDefaultModelForProfile(session.profile)
    : { provider: "", model: "" };
  sessionModelSessionId.value = sessionId;
  sessionModelValue.value = session?.model || defaults.model || "";
  sessionModelProvider.value = session?.provider || defaults.provider || "";
  sessionModelCustomProvider.value = sessionModelProvider.value;
  sessionModelSearch.value = "";
  sessionModelCustomInput.value = "";
  sessionModelCollapsedGroups.value = {};
  showSessionModelModal.value = true;
}

function isSessionModelGroupCollapsed(provider: string) {
  return !!sessionModelCollapsedGroups.value[provider];
}

function toggleSessionModelGroup(provider: string) {
  sessionModelCollapsedGroups.value[provider] = !sessionModelCollapsedGroups.value[provider];
}

function isCustomSessionModel(model: string, provider: string) {
  return (appStore.customModels[provider] || []).includes(model);
}

function sessionModelDisplayName(model: string, provider: string) {
  return appStore.displayModelName(model, provider);
}

function sessionModelAlias(model: string, provider: string) {
  return appStore.getModelAlias(model, provider);
}

async function selectSessionModel(model: string, provider: string) {
  const meta = sessionModelBaseGroups.value.find((group) => group.provider === provider)?.model_meta?.[model];
  if (meta?.disabled || !sessionModelSessionId.value) return;
  const ok = await chatStore.switchSessionModel(model, provider, sessionModelSessionId.value);
  if (ok) {
    sessionModelValue.value = model;
    sessionModelProvider.value = provider;
    showSessionModelModal.value = false;
    message.success(t("chat.modelSet"));
  } else {
    message.error(t("chat.modelSetFailed"));
  }
}

async function handleSessionModelCustomSubmit() {
  const model = sessionModelCustomInput.value.trim();
  const provider = sessionModelCustomProvider.value;
  if (!model || !provider) return;
  await selectSessionModel(model, provider);
}
</script>

<template>
  <div class="chat-panel">
    <div
      v-if="currentMode === 'chat'"
      class="session-backdrop"
      :class="{ active: showSessions }"
      @click="showSessions = false"
    />
    <aside
      v-if="currentMode === 'chat'"
      class="session-list"
      :class="{ collapsed: !showSessions }"
    >
      <div class="session-list-header">
        <span v-if="showSessions" class="session-list-title">{{
          t("chat.webUiSessions")
        }}</span>
        <div class="session-list-actions">
          <button class="session-close-btn" @click="showSessions = false">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <NButton
            v-if="!isBatchMode"
            quaternary
            size="tiny"
            @click="toggleBatchMode"
            :title="t('chat.toggleBatchMode')"
          >
            <template #icon>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </template>
          </NButton>
          <NButton
            v-if="isBatchMode"
            quaternary
            size="tiny"
            @click="selectAllSessions"
            :disabled="!canSelectAll || isBatchDeleting"
            :title="t('chat.selectAll')"
          >
            <template #icon>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </template>
          </NButton>
          <NPopconfirm
            v-if="isBatchMode && selectedCount > 0"
            v-model:show="showBatchDeleteConfirm"
            :positive-button-props="{ loading: isBatchDeleting, disabled: isBatchDeleting }"
            :negative-button-props="{ disabled: isBatchDeleting }"
            @positive-click="handleBatchDeleteConfirm"
          >
            <template #trigger>
              <NButton quaternary size="tiny" type="error" :loading="isBatchDeleting" :disabled="isBatchDeleting">
                <template #icon>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </template>
              </NButton>
            </template>
            {{ t('chat.confirmBatchDelete', { count: selectedCount }) }}
          </NPopconfirm>
          <NButton
            v-if="isBatchMode"
            quaternary
            size="tiny"
            @click="toggleBatchMode"
            :disabled="isBatchDeleting"
          >
            <template #icon>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </template>
          </NButton>
          <NButton quaternary size="tiny" circle @click="openNewChatModal">
            <template #icon>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </template>
          </NButton>
        </div>
      </div>
      <div v-if="showSessions" class="session-profile-filter">
        <NSelect
          :value="sessionProfileFilter || '__all__'"
          :options="profileFilterOptions"
          size="small"
          :loading="profilesStore.loading"
          @update:value="handleProfileFilterChange"
        />
      </div>
      <div v-if="showSessions" class="session-items">
        <div
          v-if="chatStore.isLoadingSessions && chatStore.sessions.length === 0"
          class="session-loading"
        >
          {{ t("common.loading") }}
        </div>
        <div v-else-if="chatStore.sessions.length === 0" class="session-empty">
          {{ t("chat.noSessions") }}
        </div>

        <template v-if="pinnedSessions.length > 0">
          <div class="session-group-header session-group-header--static">
            <span class="session-group-label">{{ t("chat.pinned") }}</span>
            <span class="session-group-count">{{ pinnedSessions.length }}</span>
          </div>
          <SessionListItem
            v-for="s in pinnedSessions"
            :key="`pinned-${s.id}`"
            :session="s"
            :active="s.id === chatStore.activeSessionId"
            :pinned="true"
            :can-delete="
              s.id !== chatStore.activeSessionId ||
              chatStore.sessions.length > 1
            "
            :streaming="chatStore.isSessionLive(s.id)"
            :selectable="isBatchMode"
            :selected="isSessionSelected(s)"
            :show-profile="true"
            :to="sessionHref(s.id)"
            @select="handleSessionClick(s.id)"
            @contextmenu="handleContextMenu($event, s.id)"
            @delete="handleDeleteSession(s.id)"
            @toggle-select="toggleSessionSelection(s)"
          />
        </template>

        <SessionListItem
          v-for="s in unpinnedSessions"
          :key="s.id"
          :session="s"
          :active="s.id === chatStore.activeSessionId"
          :pinned="false"
          :can-delete="
            s.id !== chatStore.activeSessionId ||
            chatStore.sessions.length > 1
          "
          :streaming="chatStore.isSessionLive(s.id)"
          :selectable="isBatchMode"
          :selected="isSessionSelected(s)"
          :show-profile="true"
          :to="sessionHref(s.id)"
          @select="handleSessionClick(s.id)"
          @contextmenu="handleContextMenu($event, s.id)"
          @delete="handleDeleteSession(s.id)"
          @toggle-select="toggleSessionSelection(s)"
        />
      </div>
    </aside>

    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="contextMenuX"
      :y="contextMenuY"
      :options="contextMenuOptions"
      :show="showContextMenu"
      @select="handleContextMenuSelect"
      @clickoutside="handleClickOutside"
    />

    <NModal
      v-model:show="showRenameModal"
      preset="dialog"
      :title="t('chat.renameSession')"
      :positive-text="t('common.ok')"
      :negative-text="t('common.cancel')"
      @positive-click="handleRenameConfirm"
    >
      <NInput
        ref="renameInputRef"
        v-model:value="renameValue"
        :placeholder="t('chat.enterNewTitle')"
        @keydown.enter="handleRenameConfirm"
      />
    </NModal>

    <NModal
      v-model:show="showWorkspaceModal"
      preset="dialog"
      :title="t('chat.setWorkspaceTitle')"
      :positive-text="t('common.ok')"
      :negative-text="t('common.cancel')"
      style="width: 520px"
      @positive-click="handleWorkspaceConfirm"
    >
      <FolderPicker v-model="workspaceValue" />
    </NModal>

    <NModal
      v-model:show="showSessionModelModal"
      preset="card"
      :title="t('chat.setModelTitle')"
      :style="{ width: 'min(480px, calc(100vw - 32px))' }"
      :mask-closable="true"
    >
      <NInput
        v-model:value="sessionModelSearch"
        :placeholder="t('models.searchPlaceholder')"
        clearable
        size="small"
        class="session-model-search"
      />
      <div class="session-model-list">
        <div v-for="group in filteredSessionModelGroups" :key="group.provider" class="session-model-group">
          <div class="session-model-group-header" @click="toggleSessionModelGroup(group.provider)">
            <svg
              class="session-model-group-arrow"
              :class="{ collapsed: isSessionModelGroupCollapsed(group.provider) }"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span class="session-model-group-label">{{ group.label }}</span>
            <span class="session-model-group-count">{{ group.models.length }}</span>
          </div>
          <div v-show="!isSessionModelGroupCollapsed(group.provider)" class="session-model-group-items">
            <div
              v-for="model in group.models"
              :key="model"
              class="session-model-item"
              :class="{
                active: model === sessionModelValue && group.provider === sessionModelProvider,
                disabled: !!group.model_meta?.[model]?.disabled,
              }"
              :title="group.model_meta?.[model]?.disabled ? t('models.disabledTooltip') : ''"
              @click="selectSessionModel(model, group.provider)"
            >
              <span class="session-model-item-label">
                <span class="session-model-item-name">{{ sessionModelDisplayName(model, group.provider) }}</span>
                <span v-if="sessionModelAlias(model, group.provider)" class="session-model-item-id">
                  {{ t('models.aliasCanonical', { model }) }}
                </span>
              </span>
              <span v-if="group.model_meta?.[model]?.preview" class="session-model-badge-preview">{{ t('models.previewBadge') }}</span>
              <span v-if="group.model_meta?.[model]?.disabled" class="session-model-badge-disabled">{{ t('models.disabledBadge') }}</span>
              <span v-if="isCustomSessionModel(model, group.provider)" class="session-model-badge-custom">{{ t('models.customBadge') }}</span>
              <svg
                v-if="model === sessionModelValue && group.provider === sessionModelProvider"
                class="session-model-check"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
        </div>
        <div v-if="filteredSessionModelGroups.length === 0" class="session-model-empty">
          {{ sessionModelSearch ? 'No results' : 'No models' }}
        </div>
        <div class="session-model-custom">
          <div class="session-model-custom-row">
            <NSelect
              v-model:value="sessionModelCustomProvider"
              :options="sessionModelProviderOptions"
              size="small"
              class="session-model-custom-provider"
            />
            <NInput
              v-model:value="sessionModelCustomInput"
              :placeholder="t('models.customModelPlaceholder')"
              size="small"
              class="session-model-custom-input"
              @keydown.enter="handleSessionModelCustomSubmit"
            />
          </div>
          <div class="session-model-custom-hint">
            {{ t('models.customModelHint') }}
          </div>
        </div>
      </div>
    </NModal>

    <NModal
      v-model:show="showNewChatModal"
      preset="card"
      :title="t('chat.newChat')"
      :style="{ width: 'min(440px, calc(100vw - 32px))' }"
      :mask-closable="true"
    >
      <div class="new-chat-form">
        <label class="new-chat-field">
          <span class="new-chat-label">{{ t("sidebar.profiles") }}</span>
          <NSelect
            :value="newChatProfile"
            :options="newChatProfileOptions"
            :loading="newChatLoading || profilesStore.loading"
            @update:value="handleNewChatProfileChange"
          />
        </label>
        <label class="new-chat-field">
          <span class="new-chat-label">{{ t("models.provider") }}</span>
          <NSelect
            :value="newChatProvider"
            :options="newChatProviderOptions"
            :disabled="newChatLoading"
            @update:value="handleNewChatProviderChange"
          />
        </label>
        <label class="new-chat-field">
          <span class="new-chat-label">{{ t("models.models") }}</span>
          <NSelect
            v-model:value="newChatModel"
            :options="newChatModelOptions"
            :disabled="newChatLoading || !newChatProvider"
            filterable
          />
        </label>
      </div>
      <template #footer>
        <div class="new-chat-actions">
          <NButton @click="showNewChatModal = false">{{ t("common.cancel") }}</NButton>
          <NButton
            type="primary"
            :disabled="!newChatProfile || !newChatProvider || !newChatModel"
            @click="confirmNewChat"
          >
            {{ t("chat.newChat") }}
          </NButton>
        </div>
      </template>
    </NModal>

    <div class="chat-main">
      <header class="chat-header">
        <div class="header-left">
          <NButton
            v-if="currentMode === 'chat'"
            quaternary
            size="small"
            @click="showSessions = !showSessions"
            circle
          >
            <template #icon>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
            </template>
          </NButton>
          <span class="header-session-title">{{ headerTitle }}</span>
          <span
            v-if="chatStore.activeSession?.workspace"
            class="workspace-badge"
            :title="chatStore.activeSession.workspace"
            >WS {{
              chatStore.activeSession.workspace.split("/").pop() ||
              chatStore.activeSession.workspace
            }}</span
          >
        </div>
        <div class="header-actions">
          <!-- chat/live mode toggle hidden -->
          <template v-if="currentMode === 'chat'">
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton
                  quaternary
                  size="small"
                  @click="showOutline = !showOutline"
                  circle
                >
                  <template #icon>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path d="M3 12h18M3 6h18M3 18h18" />
                    </svg>
                  </template>
                </NButton>
              </template>
              {{ t("chat.outlineTitle") }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton
                  quaternary
                  size="small"
                  @click="copySessionId()"
                  circle
                >
                  <template #icon>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path
                        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                      />
                    </svg>
                  </template>
                </NButton>
              </template>
              {{ t("chat.copySessionId") }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton
                  size="small"
                  secondary
                  :circle="isMobile"
                  :disabled="!canReviewCapture"
                  aria-label="Review & Capture"
                  title="Review & Capture"
                  @click="openSessionCapture"
                >
                  <template #icon>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                  </template>
                  <template v-if="!isMobile">Review & Capture</template>
                </NButton>
              </template>
              Review useful tasks, notes, evidence gaps, and report snippets from this session
            </NTooltip>
            <NButton size="small" :circle="isMobile" @click="openNewChatModal">
              <template #icon>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </template>
              <template v-if="!isMobile">{{ t("chat.newChat") }}</template>
            </NButton>
          </template>
        </div>
      </header>

      <template v-if="currentMode === 'chat'">
        <section class="command-dashboard-strip" aria-label="Session command status">
          <div class="command-evidence-strip">
            <span class="evidence-chip verified">
              <span class="evidence-dot"></span>
              {{ appStore.connected ? "API Online" : "API Offline" }}
            </span>
            <span class="evidence-chip approved">{{ activeSourceLabel }}</span>
            <span class="evidence-chip assumption">{{ activeProfileLabel }}</span>
            <span class="evidence-copy">Hermes Command Center runtime is attached to this session.</span>
            <div class="command-strip-actions" aria-label="Session command actions">
              <button
                type="button"
                class="command-action"
                aria-label="Open files drawer"
                title="Open files drawer"
                @click="openCommandDrawer('files')"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                <span>Files</span>
              </button>
              <button
                type="button"
                class="command-action"
                aria-label="Open terminal drawer"
                title="Open terminal drawer"
                @click="openCommandDrawer('terminal')"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <span>Terminal</span>
              </button>
              <button
                type="button"
                class="command-action"
                aria-label="Copy session link"
                title="Copy session link"
                :disabled="!chatStore.activeSessionId"
                @click="copySessionLink()"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93" />
                  <path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07" />
                </svg>
                <span>Link</span>
              </button>
              <button
                type="button"
                class="command-action"
                aria-label="Open settings"
                title="Open settings"
                @click="openCommandSettings"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.82.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.82-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.26.55.82 1 1.55 1H21a2 2 0 1 1 0 4h-.05A1.7 1.7 0 0 0 19.4 15z" />
                </svg>
                <span>Settings</span>
              </button>
              <button
                type="button"
                class="command-action icon-only"
                aria-label="Refresh runtime"
                title="Refresh runtime"
                @click="refreshCommandRuntime"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                  <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
                </svg>
                <span>Refresh</span>
              </button>
            </div>
          </div>
          <div class="command-kpis">
            <div class="command-kpi">
              <div class="command-kpi-value">{{ activeProfileLabel }}</div>
              <div class="command-kpi-label">Active profile</div>
            </div>
            <div class="command-kpi">
              <div class="command-kpi-value">{{ activeModelLabel }}</div>
              <div class="command-kpi-label">Model route</div>
            </div>
            <div class="command-kpi">
              <div class="command-kpi-value">{{ messageCountLabel }}</div>
              <div class="command-kpi-label">Messages</div>
            </div>
            <div class="command-kpi">
              <div class="command-kpi-value" :class="{ online: appStore.connected }">{{ connectionLabel }}</div>
              <div class="command-kpi-label">Gateway</div>
            </div>
          </div>
        </section>
        <div class="chat-content-wrapper">
          <div class="chat-main-content">
            <MessageList ref="messageListRef" />
          </div>
          <OutlinePanel
            v-if="showOutline"
            :messages="chatStore.messages"
            @navigate="handleOutlineNavigate"
          />
        </div>
        <div v-if="visibleApproval" class="approval-bar">
          <div class="approval-icon" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div class="approval-content">
            <div class="approval-main">
              <div class="approval-kicker">{{ t("chat.approvalKicker") }}</div>
              <div class="approval-title">{{ t("chat.approvalTitle") }}</div>
              <div class="approval-desc">{{ visibleApproval.description }}</div>
              <code class="approval-command">{{ visibleApproval.command }}</code>
            </div>
            <div class="approval-actions">
              <NButton
                v-if="visibleApproval.choices.includes('once')"
                size="small"
                type="primary"
                @click="handleApproval('once')"
              >
                {{ t("chat.approvalAllowOnce") }}
              </NButton>
              <NButton
                v-if="visibleApproval.choices.includes('session')"
                size="small"
                secondary
                @click="handleApproval('session')"
              >
                {{ t("chat.approvalAllowSession") }}
              </NButton>
              <NButton
                v-if="visibleApproval.choices.includes('always')"
                size="small"
                secondary
                @click="handleApproval('always')"
              >
                {{ t("chat.approvalAlways") }}
              </NButton>
              <NButton
                v-if="visibleApproval.choices.includes('deny')"
                size="small"
                type="error"
                secondary
                @click="handleApproval('deny')"
              >
                {{ t("chat.approvalDeny") }}
              </NButton>
            </div>
          </div>
        </div>
        <div v-if="visibleClarify" class="clarify-bar">
          <div class="clarify-icon" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div class="clarify-content">
            <div class="clarify-main">
              <div class="clarify-kicker">{{ t('chat.clarifyKicker') }}</div>
              <div class="clarify-title">{{ t('chat.clarifyTitle') }}</div>
              <div class="clarify-desc">{{ visibleClarify.question }}</div>
            </div>
            <div v-if="visibleClarify.choices && visibleClarify.choices.length" class="clarify-actions">
              <NButton
                v-for="choice in visibleClarify.choices"
                :key="choice"
                size="small"
                type="primary"
                @click="handleClarify(choice)"
              >
                {{ choice }}
              </NButton>
              <NButton
                size="small"
                type="error"
                secondary
                @click="handleClarify('')"
              >
                {{ t('chat.clarifyDismiss') }}
              </NButton>
            </div>
            <div v-else class="clarify-actions clarify-actions-open">
              <div class="clarify-input-row">
                <NInput
                  v-model:value="clarifyResponse"
                  size="small"
                  :placeholder="t('chat.clarifyPlaceholder')"
                />
                <NButton size="small" type="primary" @click="handleClarify()">
                  {{ t('chat.clarifySubmit') }}
                </NButton>
              </div>
            </div>
          </div>
        </div>
        <ChatInput />
      </template>
      <ConversationMonitorPane
        v-else
        :human-only="sessionBrowserPrefsStore.humanOnly"
      />
    </div>

    <!-- Floating drawer button -->
    <div class="drawer-button-wrapper">
      <div class="drawer-button" @click="showDrawer = true">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </div>
    </div>

    <DrawerPanel v-model:show="showDrawer" :active-tab="drawerActiveTab" />
    <SessionCaptureDrawer
      v-model:show="showCaptureDrawer"
      :session-id="chatStore.activeSessionId"
      :session-title="activeSessionTitle"
      :messages="chatStore.messages"
      :initial-context="sessionCaptureContext"
    />
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.chat-panel {
  display: flex;
  height: 100%;
  position: relative;
  background: #060a12;
  color: $text-primary;
}

.session-model-search {
  margin-bottom: 12px;
}

.session-model-list {
  max-height: 50vh;
  overflow-y: auto;
  scrollbar-width: thin;
}

.session-model-group {
  margin-bottom: 4px;
}

.session-model-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  font-size: 12px;
  font-weight: 600;
  color: $text-secondary;
  cursor: pointer;
  border-radius: $radius-sm;
  user-select: none;
  transition: background-color $transition-fast;

  &:hover {
    background-color: $bg-secondary;
  }
}

.session-model-group-arrow {
  flex-shrink: 0;
  transition: transform $transition-fast;

  &.collapsed {
    transform: rotate(-90deg);
  }
}

.session-model-group-label {
  flex: 1;
}

.session-model-group-count {
  font-size: 11px;
  color: $text-muted;
  font-weight: 400;
}

.session-model-group-items {
  padding-left: 8px;
}

.session-model-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 13px;
  color: $text-secondary;
  border-radius: $radius-sm;
  cursor: pointer;
  transition: all $transition-fast;

  &:hover {
    background-color: rgba(var(--accent-primary-rgb), 0.06);
    color: $text-primary;
  }

  &.active {
    color: $accent-primary;
    font-weight: 500;
  }

  &.disabled {
    opacity: 0.45;
    cursor: not-allowed;

    &:hover {
      background-color: transparent;
      color: $text-secondary;
    }
  }
}

.session-model-item-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-model-item-name,
.session-model-item-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: $font-code;
}

.session-model-item-name {
  font-size: 12px;
}

.session-model-item-id {
  color: $text-muted;
  font-size: 10px;
  font-weight: 400;
}

.session-model-check {
  flex-shrink: 0;
  color: $accent-primary;
}

.session-model-badge-preview,
.session-model-badge-custom,
.session-model-badge-disabled {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  margin-right: 4px;
  letter-spacing: 0.03em;
}

.session-model-badge-preview {
  color: #fff;
  background: #d97706;
}

.session-model-badge-custom {
  color: #fff;
  background: $accent-primary;
}

.session-model-badge-disabled {
  color: $text-muted;
  background: transparent;
  border: 1px solid $border-color;
  padding: 0 5px;
}

.session-model-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: $text-muted;
}

.session-model-custom {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid $border-color;
}

.session-model-custom-row {
  display: flex;
  gap: 8px;
}

.session-model-custom-provider {
  width: 160px;
  flex-shrink: 0;
}

.session-model-custom-input {
  flex: 1;
}

.session-model-custom-hint {
  margin-top: 6px;
  font-size: 11px;
  color: $text-muted;
}

.session-list {
  width: 252px;
  border-right: 1px solid $border-color;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: #0f1520;
  transition:
    width $transition-normal,
    opacity $transition-normal;
  overflow: hidden;

  &.collapsed {
    width: 0;
    border-right: none;
    opacity: 0;
    pointer-events: none;
  }

  @media (max-width: $breakpoint-mobile) {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    z-index: 120;
    background: #0f1520;
    box-shadow: 18px 0 48px rgba(0, 0, 0, 0.36);
    width: 280px;

    &.collapsed {
      transform: translateX(-100%);
      opacity: 0;
    }
  }
}

@media (max-width: $breakpoint-mobile) {
  .session-close-btn {
    display: flex;
  }

  .session-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 110;
    opacity: 0;
    pointer-events: none;
    transition: opacity $transition-fast;

    &.active {
      opacity: 1;
      pointer-events: auto;
    }
  }
}

.session-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 10px;
  border-bottom: 1px solid $border-color;
  flex-shrink: 0;
  min-height: 0;
}

.session-list-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;

  .n-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    min-height: 22px;
  }
}

.session-close-btn {
  display: none;
  border: none;
  background: none;
  cursor: pointer;
  color: $text-secondary;
  padding: 4px;
  border-radius: $radius-sm;
  height: 22px;
  min-height: 22px;
  align-items: center;
  justify-content: center;

  &:hover {
    background: rgba($accent-primary, 0.06);
  }
}

.session-list-title {
  font-size: 10px;
  font-weight: 800;
  color: $text-muted;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  line-height: 22px;
}

.session-profile-filter {
  margin: 10px 10px 10px;
}

.new-chat-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.new-chat-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.new-chat-label {
  font-size: 12px;
  color: $text-muted;
  font-weight: 500;
}

.new-chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.session-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 10px 6px;
  cursor: pointer;
  user-select: none;
}

.session-group-header--static {
  cursor: default;
}

.group-chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
  transform: rotate(90deg);

  &.collapsed {
    transform: rotate(0deg);
  }
}

.session-group-label {
  font-size: 10px;
  font-weight: 600;
  color: $text-muted;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.session-group-count {
  font-size: 10px;
  color: $text-muted;
  font-weight: 400;
}

.session-items {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px 12px;
}

.session-loading,
.session-empty {
  padding: 16px 10px;
  font-size: 12px;
  color: $text-muted;
  text-align: center;
}

:deep(.session-item) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  background: none;
  border-radius: $radius-sm;
  cursor: pointer;
  text-align: left;
  text-decoration: none;
  color: $text-secondary;
  transition: all $transition-fast;
  margin-bottom: 4px;

  &:hover {
    background: $bg-card;
    border-color: rgba(var(--accent-info-rgb), 0.18);
    color: $text-primary;

    .session-item-delete {
      opacity: 1;
    }
  }

  &.active {
    background: rgba(var(--accent-info-rgb), 0.07);
    border-color: $accent-info;
    color: $text-primary;
    font-weight: 500;
  }

  &.active .session-item-title {
    color: $accent-info;
  }

  &.missing-models {
    color: #b42318;
    background: rgba(220, 38, 38, 0.08);

    .session-item-title,
    .session-item-profile-name,
    .session-item-time {
      color: #b42318;
    }

    .session-item-model {
      color: #b42318;
      background: rgba(220, 38, 38, 0.12);
    }

    &:hover {
      background: rgba(220, 38, 38, 0.12);
    }
  }
}

:deep(.session-item-content) {
  flex: 1;
  overflow: hidden;
}

:deep(.session-item-title-row) {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

:deep(.session-item-title) {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.session-item-streaming) {
  display: inline-block;
  flex-shrink: 0;
  margin-right: 4px;
  vertical-align: middle;
  animation: spin 1.2s linear infinite;
  color: $accent-primary;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

:deep(.session-item-pin) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: $accent-primary;
}

:deep(.session-item-time) {
  font-size: 11px;
  color: $text-muted;
}

:deep(.session-item-meta) {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

:deep(.session-item-model) {
  font-size: 10px;
  color: $accent-primary;
  background: rgba($accent-primary, 0.08);
  padding: 0 5px;
  border-radius: 3px;
  line-height: 16px;
  flex-shrink: 0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.session-item-delete) {
  flex-shrink: 0;
  opacity: 0.5;
  padding: 2px;
  border: none;
  background: none;
  color: $text-muted;
  cursor: pointer;
  border-radius: 3px;
  transition: all $transition-fast;

  &:hover {
    color: $error;
    background: rgba($error, 0.1);
  }
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: #060a12;
}

.chat-content-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  gap: 12px;
  padding: 0 16px 12px;
  background: #060a12;
}

.chat-main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #060a12;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid $border-color;
  background: #080c14;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  flex: 1;
  min-width: 0;
}

.header-session-title {
  font-size: 15px;
  font-weight: 800;
  color: $accent-primary;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-badge {
  font-size: 10px;
  color: $text-muted;
  background: rgba(19, 26, 40, 0.88);
  border: 1px solid $border-color;
  padding: 3px 8px;
  border-radius: 999px;
  flex-shrink: 0;
  white-space: nowrap;
  line-height: 16px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.chat-mode-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 4px;
}

@media (max-width: $breakpoint-mobile) {
  .chat-header {
    padding: 16px 12px 16px 52px;
  }
}

.workspace-badge {
  font-size: 11px;
  color: $text-muted;
  background: rgba(19, 26, 40, 0.88);
  border: 1px solid $border-color;
  padding: 3px 8px;
  border-radius: 999px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.command-dashboard-strip {
  padding: 12px 16px 0;
  background: #060a12;
  flex: 0 0 auto;
}

.command-evidence-strip {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: #09130f;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.evidence-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 10px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 800;
  border: 1px solid $border-color;
  color: $text-muted;
  background: rgba(19, 26, 40, 0.72);

  &.verified {
    color: $success;
    border-color: rgba(var(--success-rgb), 0.45);
    background: rgba(var(--success-rgb), 0.08);
  }

  &.approved {
    color: $accent-info;
    border-color: rgba(var(--accent-info-rgb), 0.45);
    background: rgba(var(--accent-info-rgb), 0.07);
  }

  &.assumption {
    color: $warning;
    border-color: rgba(var(--warning-rgb), 0.45);
    background: rgba(var(--warning-rgb), 0.08);
  }
}

.evidence-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

.evidence-copy {
  flex: 1 1 220px;
  min-width: 180px;
  color: $text-muted;
  font-size: 12px;
  line-height: 1.4;
}

.command-strip-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1 1 auto;
  gap: 6px;
  min-width: 0;
  margin-left: auto;
}

.command-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 5px 9px;
  border: 1px solid $border-color;
  border-radius: 999px;
  background: rgba(19, 26, 40, 0.86);
  color: $text-secondary;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  transition: color $transition-fast, border-color $transition-fast, background $transition-fast;

  &:hover:not(:disabled) {
    color: $accent-info;
    border-color: rgba(var(--accent-info-rgb), 0.62);
    background: rgba(var(--accent-info-rgb), 0.08);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  svg {
    flex: 0 0 auto;
  }

  &.icon-only {
    width: 28px;
    padding: 0;

    span {
      display: none;
    }
  }
}

.command-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.command-kpi {
  min-width: 0;
  padding: 14px;
  background: $bg-card;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.command-kpi-value {
  overflow: hidden;
  color: $accent-primary;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.online {
    color: $success;
  }
}

.command-kpi-label {
  margin-top: 6px;
  color: $text-muted;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

// ─── Drawer button ─────────────────────────────────────────────

.drawer-button-wrapper {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 100;
  background: $bg-card;
  border: 1px solid $border-color;
  border-radius: 999px;
  box-shadow: none;
  transition: all $transition-fast;

  &:hover {
    border-color: $accent-info;
  }
}

.drawer-button {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(var(--accent-info-rgb), 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all $transition-fast;

  svg {
    width: 18px;
    height: 18px;
    color: var(--accent-info);
  }

  &:hover {
    transform: none;
  }
}

.approval-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 16px 12px;
  padding: 12px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
  box-shadow: none;
}

.approval-icon {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  color: $accent-info;
  background: rgba(var(--accent-info-rgb), 0.08);
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: $radius-sm;
}

.approval-content {
  flex: 1;
  min-width: 0;
}

.approval-main {
  min-width: 0;
}

.approval-kicker {
  margin-bottom: 2px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: $accent-info;
}

.approval-title {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.3;
  color: $accent-primary;
}

.approval-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: $text-secondary;
}

.approval-command {
  display: block;
  margin-top: 8px;
  max-height: 96px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "SFMono-Regular", "Cascadia Code", "Roboto Mono", Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  color: $text-primary;
  background: $bg-primary;
  border: 1px solid $border-color;
  border-radius: 6px;
  padding: 8px 10px;
}

.approval-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid $border-color;
}


.clarify-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 16px 12px;
  padding: 12px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
  box-shadow: none;
}

.clarify-icon {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  color: $accent-info;
  background: rgba(var(--accent-info-rgb), 0.08);
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: $radius-sm;
}

.clarify-content {
  flex: 1;
  min-width: 0;
}

.clarify-main {
  min-width: 0;
}

.clarify-kicker {
  margin-bottom: 2px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: $accent-info;
}

.clarify-title {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.3;
  color: $accent-primary;
}

.clarify-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: $text-secondary;
}

.clarify-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid $border-color;
}

.clarify-input-row {
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  gap: 8px;
  align-items: center;

  :deep(.n-input) {
    flex: 1 1 auto;
    min-width: 0;
  }

  :deep(.n-button) {
    flex: 0 0 auto;
  }
}

.clarify-actions-open {
  display: flex;
  width: 100%;
}
@media (max-width: 768px) {
  .command-evidence-strip {
    align-items: stretch;
  }

  .evidence-copy {
    flex-basis: 100%;
    min-width: 0;
  }

  .command-strip-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    margin-left: 0;
  }

  .command-action {
    width: 100%;

    &.icon-only {
      width: 100%;

      span {
        display: inline;
      }
    }
  }

  .approval-bar {
    margin: 0 10px 10px;
    padding: 10px;
  }

  .approval-icon {
    flex-basis: 28px;
    width: 28px;
    height: 28px;
  }

  .approval-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .approval-actions :deep(.n-button) {
    width: 100%;
  }

  .clarify-bar {
    margin: 0 10px 10px;
    padding: 10px;
  }

  .clarify-icon {
    flex-basis: 28px;
    width: 28px;
    height: 28px;
  }

  .clarify-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .clarify-actions-open {
    display: flex;
    grid-template-columns: none;
  }

  .clarify-actions :deep(.n-button) {
    width: 100%;
  }

  .clarify-actions-open :deep(.n-button) {
    width: auto;
  }
}

@media (max-width: 420px) {
  .approval-bar {
    gap: 8px;
  }

  .approval-actions {
    grid-template-columns: 1fr;
  }

  .clarify-bar {
    gap: 8px;
  }

  .clarify-actions {
    grid-template-columns: 1fr;
  }

  .clarify-input-row {
    flex-direction: column;
    align-items: stretch;
  }

  .clarify-actions-open :deep(.n-button) {
    width: 100%;
  }
}

@media (max-width: $breakpoint-mobile) {
  .drawer-button-wrapper {
    right: 12px;
  }

  .drawer-button {
    width: 36px;
    height: 36px;

    svg {
      width: 16px;
      height: 16px;
    }
  }
}
</style>
