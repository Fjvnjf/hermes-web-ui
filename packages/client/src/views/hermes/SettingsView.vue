<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NSpin,
} from "naive-ui";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/hermes/settings";
import DisplaySettings from "@/components/hermes/settings/DisplaySettings.vue";
import AgentSettings from "@/components/hermes/settings/AgentSettings.vue";
import MemorySettings from "@/components/hermes/settings/MemorySettings.vue";
import CompressionSettings from "@/components/hermes/settings/CompressionSettings.vue";
import SessionSettings from "@/components/hermes/settings/SessionSettings.vue";
import PrivacySettings from "@/components/hermes/settings/PrivacySettings.vue";
import ModelSettings from "@/components/hermes/settings/ModelSettings.vue";
import AccountSettings from "@/components/hermes/settings/AccountSettings.vue";
import UserManagementSettings from "@/components/hermes/settings/UserManagementSettings.vue";
import VoiceSettings from "@/components/hermes/settings/VoiceSettings.vue";
import { useProfilesStore } from "@/stores/hermes/profiles";

const settingsStore = useSettingsStore();
const profilesStore = useProfilesStore();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const activeTab = ref("account");
const tabNames = [
  "account",
  "users",
  "display",
  "agent",
  "memory",
  "compression",
  "session",
  "privacy",
  "models",
  "voice",
] as const;

const settingsTabs = computed(() =>
  tabNames.map(name => ({
    name,
    label: t(`settings.tabs.${name}`),
  })),
);

const validTabs = computed(() => new Set<string>(tabNames));

function normalizeTab(value: unknown): string {
  const tab = typeof value === "string" ? value : "";
  return validTabs.value.has(tab) ? tab : "account";
}

function handleTabUpdate(tab: string) {
  activeTab.value = normalizeTab(tab);
  router.replace({
    query: {
      ...route.query,
      tab: activeTab.value === "account" ? undefined : activeTab.value,
    },
  });
}

watch(() => route.query.tab, (tab) => {
  activeTab.value = normalizeTab(tab);
}, { immediate: true });

async function loadSettingsForProfile() {
  if (!profilesStore.activeProfileName || profilesStore.profiles.length === 0) {
    await profilesStore.fetchProfiles();
  }
  await settingsStore.fetchSettings();
}

onMounted(() => {
  void loadSettingsForProfile();
});
</script>

<template>
  <div class="settings-view">
    <header class="page-header">
      <h2 class="header-title">{{ t("settings.title") }}</h2>
    </header>

    <div class="settings-content">
      <NSpin
        :show="settingsStore.loading || settingsStore.saving"
        size="large"
        :description="t('common.loading')"
      >
        <div class="settings-command-tabs" role="tablist" aria-label="Settings sections">
          <button
            v-for="tab in settingsTabs"
            :id="`settings-tab-${tab.name}`"
            :key="tab.name"
            class="settings-tab"
            :class="{ active: activeTab === tab.name }"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.name"
            :aria-controls="`settings-panel-${tab.name}`"
            @click="handleTabUpdate(tab.name)"
          >
            {{ tab.label }}
          </button>
        </div>

        <section
          :id="`settings-panel-${activeTab}`"
          class="settings-panel"
          role="tabpanel"
          :aria-labelledby="`settings-tab-${activeTab}`"
        >
          <AccountSettings v-if="activeTab === 'account'" />
          <UserManagementSettings v-else-if="activeTab === 'users'" />
          <DisplaySettings v-else-if="activeTab === 'display'" />
          <AgentSettings v-else-if="activeTab === 'agent'" />
          <MemorySettings v-else-if="activeTab === 'memory'" />
          <CompressionSettings v-else-if="activeTab === 'compression'" />
          <SessionSettings v-else-if="activeTab === 'session'" />
          <PrivacySettings v-else-if="activeTab === 'privacy'" />
          <ModelSettings v-else-if="activeTab === 'models'" />
          <VoiceSettings v-else-if="activeTab === 'voice'" />
        </section>
      </NSpin>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.settings-view {
  height: var(--app-content-height, calc(100 * var(--vh)));
  display: flex;
  flex-direction: column;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}

.settings-command-tabs {
  position: sticky;
  top: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: #09130f;
}

.settings-tab {
  min-width: 0;
  min-height: 32px;
  padding: 7px 10px;
  border: 1px solid $border-color;
  border-radius: 999px;
  background: $bg-card;
  color: $text-secondary;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.1;
  text-align: center;
  transition: color $transition-fast, border-color $transition-fast, background $transition-fast;

  &:hover {
    border-color: rgba(var(--accent-primary-rgb), 0.65);
    color: $accent-primary;
    background: $bg-card-hover;
  }

  &.active {
    border-color: rgba(var(--accent-info-rgb), 0.72);
    background: rgba(var(--accent-info-rgb), 0.1);
    color: $accent-info;
  }
}

.settings-panel {
  padding: 16px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
}

@media (max-width: $breakpoint-mobile) {
  .settings-content {
    padding: 12px;
  }

  .settings-command-tabs {
    position: static;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    padding: 8px;
  }

  .settings-tab {
    min-height: 34px;
    padding: 7px 8px;
    font-size: 11px;
  }

  .settings-panel {
    padding: 14px;
  }
}
</style>
