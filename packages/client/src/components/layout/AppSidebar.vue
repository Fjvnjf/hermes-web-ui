<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { NButton, NModal, useMessage } from "naive-ui";
import { useAppStore } from "@/stores/hermes/app";
import ModelSelector from "./ModelSelector.vue";
import ProfileSelector from "./ProfileSelector.vue";
import LanguageSwitch from "./LanguageSwitch.vue";
import ThemeSwitch from "./ThemeSwitch.vue";
import { useSessionSearch } from '@/composables/useSessionSearch'
import { usePersistentRecord } from '@/composables/usePersistentRecord'
import RouteLinkItem from '@/components/common/RouteLinkItem.vue'
import CommandGlyph from '@/components/common/CommandGlyph.vue'
import { changelog } from "@/data/changelog";
import { canAccessRouteName, getFrontendAccessRole, type FrontendAccessRole } from '@/utils/accessControl'

const { t } = useI18n();
const message = useMessage();
const route = useRoute();
const appStore = useAppStore();
const { openSessionSearch } = useSessionSearch();
const MOBILE_BREAKPOINT_PX = 768;
const isMobileSidebar = ref(false);
const selectedKey = computed(() => {
  if (route.name === "hermes.session") return "hermes.chat";
  if (route.name === "hermes.historySession") return "hermes.history";
  if (route.name === "hermes.groupChatRoom") return "hermes.groupChat";
  return route.name as string;
});
const frontendAccessRole = computed(() => getFrontendAccessRole());
const isVersionPreview = import.meta.env.VITE_HERMES_PREVIEW === '1';
const sidebarIsCollapsed = computed(() => appStore.sidebarCollapsed && !isMobileSidebar.value);
const sidebarControlTitle = computed(() => {
  if (isMobileSidebar.value) return 'Close command menu';
  return appStore.sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse');
});

function syncMobileSidebar() {
  isMobileSidebar.value = window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

onMounted(() => {
  syncMobileSidebar();
  window.addEventListener('resize', syncMobileSidebar);
});

onUnmounted(() => {
  window.removeEventListener('resize', syncMobileSidebar);
});

function isNavActive(...names: string[]) {
  return names.includes(selectedKey.value);
}

function canShowRoute(name: string) {
  return canAccessRouteName(name, frontendAccessRole.value);
}

function roleIs(...roles: FrontendAccessRole[]) {
  return roles.includes(frontendAccessRole.value)
}

const { record: collapsedGroups, persist: persistCollapsedGroups } = usePersistentRecord('hermes.sidebar.collapsedGroups');

let initializedDefaultCollapsedGroups = false;
for (const key of ['hermesSystem', 'developerTools']) {
  if (!(key in collapsedGroups)) {
    collapsedGroups[key] = true;
    initializedDefaultCollapsedGroups = true;
  }
}
if (initializedDefaultCollapsedGroups) persistCollapsedGroups();

type SidebarGroupKey = "Workspace" | "ResearchLibrary" | "Reports" | "Memory" | "HermesSystem" | "DeveloperTools" | "Investor" | "Access";
type NavItem = {
  label: string
  routeName: string
  symbol: string
  title?: string
  badge?: string
  activeNames?: string[]
}
type NavGroup = {
  key: SidebarGroupKey
  stateKey: string
  items: NavItem[]
}

const collapsedGroupLabels: Record<SidebarGroupKey, string> = {
  Workspace: 'WORK',
  ResearchLibrary: 'LIB',
  Reports: 'RPT',
  Memory: 'MEM',
  HermesSystem: 'SYS',
  DeveloperTools: 'DEV',
  Investor: 'INV',
  Access: 'HELP',
};

const groupTitles: Record<SidebarGroupKey, string> = {
  Workspace: 'Research Workspace',
  ResearchLibrary: 'Research Library',
  Reports: 'Reports',
  Memory: 'Memory',
  HermesSystem: 'Hermes System',
  DeveloperTools: 'Developer Tools',
  Investor: 'Investor Portal',
  Access: 'Access Help',
};

function groupTitle(key: SidebarGroupKey) {
  return groupTitles[key];
}

function groupLabel(key: SidebarGroupKey) {
  return sidebarIsCollapsed.value ? collapsedGroupLabels[key] : groupTitle(key);
}

function groupAriaLabel(key: SidebarGroupKey) {
  return `${groupTitle(key)} navigation group`;
}

function toggleGroup(key: string) {
  collapsedGroups[key] = !collapsedGroups[key];
  persistCollapsedGroups();
}

function isGroupCollapsed(key: string) {
  return !!collapsedGroups[key];
}

function itemIsActive(item: NavItem) {
  return isNavActive(item.routeName, ...(item.activeNames || []))
}

function canShowItem(item: NavItem) {
  return canShowRoute(item.routeName)
}

function homeRouteName() {
  if (roleIs('investor_viewer')) return 'hermes.investorPortal'
  return canShowRoute('hermes.dashboard') ? 'hermes.dashboard' : 'hermes.accessDenied'
}

function filterItems(items: NavItem[]) {
  return items.filter(canShowItem)
}

const ownerWorkspaceItems: NavItem[] = [
  { label: 'Home', routeName: 'hermes.dashboard', symbol: 'HM' },
  { label: 'Executive Overview', routeName: 'hermes.executiveOverview', symbol: 'EO', title: 'Daily executive economics, market, risk, and action board' },
  { label: 'Last 24 Hours', routeName: 'hermes.last24Hours', symbol: '24', title: 'Owner-only daily activity brief' },
  { label: 'Chat', routeName: 'hermes.chat', symbol: 'CH', activeNames: ['hermes.session'] },
  { label: 'Feasibility Studio', routeName: 'hermes.feasibility', symbol: 'FS', badge: 'Primary', title: 'Main feasibility work area' },
  { label: 'Investor Readiness', routeName: 'hermes.investorReadiness', symbol: 'IR' },
  { label: 'Investor Portal', routeName: 'hermes.investorPortal', symbol: 'IP' },
  { label: 'IRR Calculator', routeName: 'hermes.investmentCalculator', symbol: 'IRR' },
  { label: 'Investment Analysis', routeName: 'hermes.investmentAnalysis', symbol: 'IA' },
  { label: 'Projects', routeName: 'hermes.projects', symbol: 'PR' },
  { label: 'Documents', routeName: 'hermes.files', symbol: 'DC' },
  { label: 'Tasks', routeName: 'hermes.kanban', symbol: 'TK' },
]

const ownerResearchItems: NavItem[] = [
  { label: 'Research Library', routeName: 'hermes.research', symbol: 'RL' },
  { label: 'History', routeName: 'hermes.history', symbol: 'HS', activeNames: ['hermes.historySession'] },
  { label: 'Market Intelligence', routeName: 'hermes.marketIntelligence', symbol: 'MK' },
  { label: 'Raw Materials', routeName: 'hermes.rawMaterialSourcing', symbol: 'RM' },
  { label: 'Export Markets', routeName: 'hermes.exportMarketOpportunity', symbol: 'EX' },
  { label: 'Competitors', routeName: 'hermes.competitorIntelligence', symbol: 'CP' },
  { label: 'Research Review', routeName: 'hermes.researchResultReview', symbol: 'RV' },
]

const ownerReportItems: NavItem[] = [
  { label: 'Reports Hub', routeName: 'hermes.reportsHub', symbol: 'RP' },
  { label: 'Presentation Builder', routeName: 'hermes.investorPresentation', symbol: 'PB' },
  { label: 'Usage', routeName: 'hermes.usage', symbol: 'US' },
  { label: 'Skills Usage', routeName: 'hermes.skillsUsage', symbol: 'SU' },
]

const ownerSystemItems: NavItem[] = [
  { label: 'Jobs', routeName: 'hermes.jobs', symbol: 'JB' },
  { label: 'Channels', routeName: 'hermes.channels', symbol: 'CN' },
  { label: 'Skills', routeName: 'hermes.skills', symbol: 'SK' },
  { label: 'Plugins', routeName: 'hermes.plugins', symbol: 'PL' },
  { label: 'Models', routeName: 'hermes.models', symbol: 'MD' },
  { label: 'Profiles', routeName: 'hermes.profiles', symbol: 'PF' },
  { label: 'Settings', routeName: 'hermes.settings', symbol: 'ST' },
  { label: 'Group Chat', routeName: 'hermes.groupChat', symbol: 'GC', badge: 'Beta', activeNames: ['hermes.groupChatRoom'] },
]

const developerItems: NavItem[] = [
  { label: 'Home', routeName: 'hermes.dashboard', symbol: 'HM' },
  { label: 'Jobs', routeName: 'hermes.jobs', symbol: 'JB' },
  { label: 'Terminal', routeName: 'hermes.terminal', symbol: 'TR' },
  { label: 'Logs', routeName: 'hermes.logs', symbol: 'LG' },
  { label: 'Settings', routeName: 'hermes.settings', symbol: 'ST' },
  { label: 'Models', routeName: 'hermes.models', symbol: 'MD' },
  { label: 'Profiles', routeName: 'hermes.profiles', symbol: 'PF' },
  { label: 'System Health', routeName: 'hermes.performance', symbol: 'SH' },
  { label: 'Version Preview', routeName: 'hermes.versionPreview', symbol: 'VP' },
]

const employeeItems: NavItem[] = [
  { label: 'Home', routeName: 'hermes.dashboard', symbol: 'HM' },
  { label: 'Chat', routeName: 'hermes.chat', symbol: 'CH', activeNames: ['hermes.session'] },
  { label: 'My Tasks', routeName: 'hermes.kanban', symbol: 'TK' },
  { label: 'Research Jobs', routeName: 'hermes.jobs', symbol: 'JB' },
  { label: 'Research Library', routeName: 'hermes.research', symbol: 'RL' },
  { label: 'Employee Documents', routeName: 'hermes.files', symbol: 'DC' },
  { label: 'Reports / Outputs', routeName: 'hermes.reportsHub', symbol: 'RP' },
  { label: 'Access Help', routeName: 'hermes.accessDenied', symbol: '?' },
]

const researchAssistantItems: NavItem[] = [
  { label: 'Home', routeName: 'hermes.dashboard', symbol: 'HM' },
  { label: 'Chat', routeName: 'hermes.chat', symbol: 'CH', activeNames: ['hermes.session'] },
  { label: 'My Tasks', routeName: 'hermes.kanban', symbol: 'TK' },
  { label: 'Research Jobs', routeName: 'hermes.jobs', symbol: 'JB' },
  { label: 'Research Library', routeName: 'hermes.research', symbol: 'RL' },
  { label: 'Market', routeName: 'hermes.marketIntelligence', symbol: 'MK' },
  { label: 'Competitors', routeName: 'hermes.competitorIntelligence', symbol: 'CP' },
  { label: 'Documents', routeName: 'hermes.files', symbol: 'DC' },
  { label: 'Reports / Outputs', routeName: 'hermes.reportsHub', symbol: 'RP' },
]

const financialAnalystItems: NavItem[] = [
  { label: 'Home', routeName: 'hermes.dashboard', symbol: 'HM' },
  { label: 'My Tasks', routeName: 'hermes.kanban', symbol: 'TK' },
  { label: 'IRR Calculator', routeName: 'hermes.investmentCalculator', symbol: 'IRR' },
  { label: 'Investment Analysis', routeName: 'hermes.investmentAnalysis', symbol: 'IA' },
  { label: 'Reports / Outputs', routeName: 'hermes.reportsHub', symbol: 'RP' },
  { label: 'Documents', routeName: 'hermes.files', symbol: 'DC' },
]

const regulatoryConsultantItems: NavItem[] = [
  { label: 'Home', routeName: 'hermes.dashboard', symbol: 'HM' },
  { label: 'My Tasks', routeName: 'hermes.kanban', symbol: 'TK' },
  { label: 'Regulatory Review', routeName: 'hermes.researchResultReview', symbol: 'RV' },
  { label: 'Documents', routeName: 'hermes.files', symbol: 'DC' },
  { label: 'Reports / Outputs', routeName: 'hermes.reportsHub', symbol: 'RP' },
]

const investorItems: NavItem[] = [
  { label: 'Investor Portal', routeName: 'hermes.investorPortal', symbol: 'IP' },
  { label: 'Approved Presentation', routeName: 'hermes.investorPortal', symbol: 'AP' },
  { label: 'Approved Reports', routeName: 'hermes.investorPortal', symbol: 'AR' },
  { label: 'Approved Data Room', routeName: 'hermes.investorPortal', symbol: 'DR' },
  { label: 'Access Help', routeName: 'hermes.accessDenied', symbol: '?' },
]

const visibleNavGroups = computed<NavGroup[]>(() => {
  if (roleIs('investor_viewer')) {
    return [{ key: 'Investor', stateKey: 'investor', items: filterItems(investorItems) }]
  }

  if (roleIs('developer_admin')) {
    return [{ key: 'DeveloperTools', stateKey: 'developerTools', items: filterItems(developerItems) }]
  }

  if (roleIs('employee')) {
    return [{ key: 'Workspace', stateKey: 'workspace', items: filterItems(employeeItems) }]
  }

  if (roleIs('research_assistant')) {
    return [{ key: 'Workspace', stateKey: 'workspace', items: filterItems(researchAssistantItems) }]
  }

  if (roleIs('financial_analyst')) {
    return [{ key: 'Workspace', stateKey: 'workspace', items: filterItems(financialAnalystItems) }]
  }

  if (roleIs('regulatory_consultant')) {
    return [{ key: 'Workspace', stateKey: 'workspace', items: filterItems(regulatoryConsultantItems) }]
  }

  const ownerGroups: NavGroup[] = [
    { key: 'Workspace', stateKey: 'workspace', items: filterItems(ownerWorkspaceItems) },
    { key: 'ResearchLibrary', stateKey: 'researchLibrary', items: filterItems(ownerResearchItems) },
    { key: 'Reports', stateKey: 'reports', items: filterItems(ownerReportItems) },
    { key: 'Memory', stateKey: 'memory', items: filterItems([{ label: 'Memory', routeName: 'hermes.memory', symbol: 'MM' }]) },
    { key: 'HermesSystem', stateKey: 'hermesSystem', items: filterItems(ownerSystemItems) },
    {
      key: 'DeveloperTools',
      stateKey: 'developerTools',
      items: filterItems([
        { label: 'Backup Vault', routeName: 'hermes.localBackupVault', symbol: 'BK' },
        { label: 'Terminal', routeName: 'hermes.terminal', symbol: 'TR' },
        { label: 'Logs', routeName: 'hermes.logs', symbol: 'LG' },
        { label: 'Performance', routeName: 'hermes.performance', symbol: 'PF' },
        ...(!isVersionPreview ? [{ label: 'Version Preview', routeName: 'hermes.versionPreview', symbol: 'VP' }] : []),
      ]),
    },
  ]
  return ownerGroups.filter(group => group.items.length > 0)
})

function handleSidebarControl() {
  if (isMobileSidebar.value) {
    appStore.closeSidebar();
    return;
  }
  appStore.toggleSidebarCollapsed();
}

async function handleUpdate() {
  const ok = await appStore.doUpdate();
  if (ok) {
    message.success(t('sidebar.updateSuccess'), { duration: 5000 });
  } else {
    message.error(t('sidebar.updateFailed'));
  }
}

function handleReloadClient() {
  appStore.reloadClient();
}

async function handleRefresh() {
  const tasks: Array<Promise<unknown>> = [appStore.checkConnection()];
  if (canShowRoute('hermes.models')) tasks.push(appStore.reloadModels());
  await Promise.all(tasks);
}

// Changelog
const showChangelog = ref(false);

function openChangelog() {
  showChangelog.value = true;
}
</script>

<template>
  <aside class="sidebar" :class="{ open: appStore.sidebarOpen, collapsed: sidebarIsCollapsed }">
    <RouteLinkItem class="sidebar-logo" :to="{ name: homeRouteName() }">
      <CommandGlyph class="logo-mark" :size="30" />
      <span class="logo-copy">
        <span class="logo-title">Hermes Workspace</span>
        <span class="logo-subtitle">{{ roleIs('owner') ? 'Command operations' : roleIs('developer_admin') ? 'System tools' : roleIs('investor_viewer') ? 'Approved access' : 'Assigned workspace' }}</span>
      </span>
    </RouteLinkItem>

    <button class="collapse-btn" @click="handleSidebarControl" :title="sidebarControlTitle" :aria-label="sidebarControlTitle">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path v-if="isMobileSidebar" d="M18 6 6 18M6 6l12 12" />
        <polyline v-else-if="sidebarIsCollapsed" points="9 18 15 12 9 6" />
        <polyline v-else points="15 18 9 12 15 6" />
      </svg>
    </button>

    <nav class="sidebar-nav">
      <div v-for="group in visibleNavGroups" :key="group.stateKey" class="nav-group">
        <div
          class="nav-group-label"
          role="button"
          tabindex="0"
          :title="groupTitle(group.key)"
          :aria-label="groupAriaLabel(group.key)"
          @click="toggleGroup(group.stateKey)"
          @keydown.enter.prevent="toggleGroup(group.stateKey)"
          @keydown.space.prevent="toggleGroup(group.stateKey)"
        >
          <span>{{ groupLabel(group.key) }}</span>
          <svg class="nav-group-arrow" :class="{ collapsed: isGroupCollapsed(group.stateKey) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        <div v-show="!isGroupCollapsed(group.stateKey)" class="nav-group-items">
          <RouteLinkItem
            v-for="item in group.items"
            :key="`${group.stateKey}-${item.label}`"
            class="nav-item"
            :to="{ name: item.routeName }"
            :active="itemIsActive(item)"
            :title="item.title"
          >
            <span class="nav-symbol">{{ item.symbol }}</span>
            <span class="nav-label-copy">
              {{ item.label }}{{ item.badge ? ' ' : '' }}
              <span v-if="item.badge" class="beta-tag">{{ item.badge }}</span>
            </span>
          </RouteLinkItem>
          <a
            v-if="(group.stateKey === 'hermesSystem' || group.stateKey === 'developerTools') && canShowRoute('hermes.models')"
            class="nav-item fun-link"
            href="https://apikey.fun/register?aff=LIBAPI"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="nav-symbol">API</span>
            <span>API Relay</span>
          </a>
          <button
            v-if="group.key === 'ResearchLibrary' && canShowRoute('hermes.history')"
            class="nav-item"
            @click="openSessionSearch"
          >
            <span class="nav-symbol">SR</span>
            <span>{{ t("sidebar.search") }}</span>
          </button>
        </div>
      </div>
    </nav>

    <ProfileSelector v-if="canShowRoute('hermes.profiles')" />
    <ModelSelector v-if="canShowRoute('hermes.models')" />

    <div class="sidebar-footer">
      <button class="nav-item refresh-item" @click="handleRefresh">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
          <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
        </svg>
        <span>{{ t("common.retry") }}</span>
      </button>
      <div class="status-row">
        <div
          class="status-indicator"
          :class="{
            connected: appStore.connected,
            disconnected: !appStore.connected,
          }"
        >
          <span class="status-dot"></span>
          <span class="status-text">{{
            appStore.connected
              ? t("sidebar.connected")
              : t("sidebar.disconnected")
          }}</span>
        </div>
        <LanguageSwitch />
      </div>
      <div class="version-info">
        <div class="version-links">
          <a class="github-link" href="https://github.com/EKKOLearnAI/hermes-web-ui" target="_blank" rel="noopener noreferrer" title="GitHub">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          </a>
          <a class="website-link" href="https://ekkolearnai.com/" target="_blank" rel="noopener noreferrer" title="Website">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </a>
        </div>
        <span class="version-text" @click="openChangelog">Web UI v{{ appStore.serverVersion || "0.1.0" }}</span>
        <ThemeSwitch />
      </div>
      <NButton v-if="appStore.clientOutdated" type="warning" size="tiny" block class="update-btn" @click="handleReloadClient">
        {{ t('sidebar.reloadClientVersion', { version: appStore.serverVersion }) }}
      </NButton>
      <NButton v-if="appStore.updateAvailable" type="primary" size="tiny" block class="update-btn" :loading="appStore.updating" @click="handleUpdate">
        {{ appStore.updating ? t('sidebar.updating') : t('sidebar.updateVersion', { version: appStore.latestVersion }) }}
      </NButton>
    </div>

    <!-- Changelog modal -->
    <NModal v-model:show="showChangelog" preset="dialog" :title="t('sidebar.changelog')" style="width: 520px;">
      <div class="changelog-list">
        <div v-for="entry in changelog" :key="entry.version" class="changelog-version-block">
          <div class="changelog-version-header">
            <span class="changelog-version-tag">v{{ entry.version }}</span>
            <span class="changelog-date">{{ entry.date }}</span>
          </div>
          <ul class="changelog-changes">
            <li v-for="(change, idx) in entry.changes" :key="idx">{{ t(change) }}</li>
          </ul>
        </div>
      </div>
    </NModal>
  </aside>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.sidebar {
  position: relative;
  width: $sidebar-width;
  height: calc(100 * var(--vh));
  background: $bg-sidebar;
  border-right: 1px solid $border-color;
  display: flex;
  flex-direction: column;
  padding: 14px 0 16px;
  flex-shrink: 0;
  transition: width $transition-normal;
  box-shadow: 12px 0 32px rgba(0, 0, 0, 0.18);
}

.logo-mark {
  color: $accent-info;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px 16px;
  margin: 0 0 12px;
  color: $accent-primary;
  cursor: pointer;
  background: transparent;
  border-bottom: 1px solid $border-color;
  position: relative;
  overflow: hidden;

  .logo-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }

  .logo-title {
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.05em;
    line-height: 1.05;
    text-transform: uppercase;
  }

  .logo-subtitle {
    color: $text-muted;
    font-size: 11px;
    line-height: 1;
    letter-spacing: 0;
    text-transform: none;
  }

}

.sidebar-nav {
  flex: 1;
  display: flex;
  padding: 0;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

:deep(.profile-selector) {
  margin: 10px 12px 0;
  padding-top: 12px;
  border-top: 1px solid $border-color;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 0 6px;
  position: relative;

  &.nav-group-bottom {
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid $border-color;
  }
}

.nav-group-items {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nav-group-label {
  font-size: 10px;
  font-weight: 800;
  color: $text-muted;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  padding: 18px 18px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  transition: color $transition-fast;
  border-left: 3px solid transparent;

  &:hover {
    color: $accent-primary;
  }

  .nav-group:first-child & {
    padding-top: 0;
  }
}

.nav-group-arrow {
  transition: transform $transition-fast;
  flex-shrink: 0;

  &.collapsed {
    transform: rotate(-90deg);
  }
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 18px;
  border: none;
  background: none;
  appearance: none;
  text-decoration: none;
  color: $text-muted;
  font-size: 13px;
  border-radius: 0;
  border-right: 2px solid transparent;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: all $transition-fast;
  width: 100%;
  text-align: left;

  &:hover {
    background-color: $bg-card;
    color: $text-primary;
  }

  &.active {
    background: linear-gradient(90deg, rgba(var(--accent-primary-rgb), 0.12), rgba(var(--accent-info-rgb), 0.06));
    border-left-color: $accent-primary;
    border-right-color: $accent-info;
    color: $accent-info;
    box-shadow: inset 0 0 0 1px rgba(var(--accent-primary-rgb), 0.05);
  }

  .beta-tag {
    display: inline-flex;
    align-items: center;
    min-height: 16px;
    margin-left: 6px;
    padding: 1px 5px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
    border-radius: 999px;
    color: $accent-primary;
    font-size: 9px;
    font-weight: 900;
    line-height: 1;
    text-transform: uppercase;
  }
}

.nav-symbol {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.26);
  border-radius: 6px;
  color: $accent-info;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0;
}

.nav-label-copy {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-footer {
  margin: 8px 12px 0;
  padding-top: 8px;
  border-top: 1px solid $border-color;
}

.refresh-item {
  margin: 0 -12px 2px;
  padding: 10px 18px;
  font-size: 13px;
  color: $text-muted;

  &:hover {
    color: $accent-info;
    background: rgba(var(--accent-info-rgb), 0.08);
  }
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;

  .status-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  &.connected .status-dot {
    background-color: $success;
    box-shadow: 0 0 6px rgba(var(--success-rgb), 0.5);
  }

  &.disconnected .status-dot {
    background-color: $error;
  }

  .status-text {
    color: $text-secondary;
  }
}

.version-info {
  padding: 4px 0 8px;
  font-size: 11px;
  color: $text-muted;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  overflow: hidden;
}

.version-links {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
}

:deep(.theme-switch-container) {
  flex-shrink: 0;
}

.github-link,
.website-link {
  color: $text-muted;
  display: flex;
  align-items: center;
  transition: color 0.2s;

  &:hover {
    color: $accent-primary;
  }
}

.update-btn {
  margin: 4px 0 0;
  border-radius: 4px;
}

.version-text {
  flex: 0 0 auto;
  overflow: visible;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.2s;

  &:hover {
    color: $accent-primary;
  }
}

.changelog-list {
  max-height: 400px;
  overflow-y: auto;
}

.changelog-version-block {
  margin-bottom: 20px;

  &:last-child {
    margin-bottom: 0;
  }
}

.changelog-version-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.changelog-version-tag {
  font-weight: 600;
  font-size: 14px;
  color: $text-primary;
  font-family: $font-code;
}

.changelog-changes {
  list-style: none;
  padding: 0;
  margin: 0;

  li {
    font-size: 13px;
    color: $text-secondary;
    padding: 4px 0 4px 16px;
    position: relative;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 12px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: $text-muted;
    }
  }
}

// ─── Collapsed sidebar (icon-rail mode) ─────────────────────────

.sidebar.collapsed {
  width: $sidebar-collapsed-width;
  padding: 14px 8px 12px;
  overflow: hidden;

  .sidebar-logo {
    padding: 0 4px 12px;
    margin: 0 -8px;
    justify-content: center;
    gap: 0;

    .logo-text {
      display: none;
    }

    .logo-copy {
      display: none;
    }
  }

  .collapse-btn {
    display: flex;
    margin: 0 auto 8px;
  }

  .nav-group-label {
    justify-content: center;
    gap: 0;
    padding: 8px 0 5px;
    font-size: 9px;
    letter-spacing: 0;

    span {
      max-width: 42px;
      overflow: hidden;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nav-group-arrow {
      display: none;
    }
  }

  .nav-item {
    justify-content: center;
    padding: 10px 4px;
    gap: 0;

    span {
      display: none;
    }

    svg {
      flex-shrink: 0;
    }
  }

  // Hide model selector in icon-rail mode, but keep the active profile avatar
  // visible as the profile manager entry point.
  :deep(.model-selector) {
    display: none;
  }

  :deep(.profile-selector) {
    display: flex;
    justify-content: center;
    padding: 8px 0;
    margin: 0 0 6px;
    border-top: 1px solid $border-color;
  }

  :deep(.profile-selector .selector-label),
  :deep(.profile-selector .profile-name) {
    display: none;
  }

  :deep(.profile-selector .profile-display) {
    width: 36px;
    height: 36px;
    justify-content: center;
    padding: 0;
    gap: 0;
    border: none;
    border-radius: 0;
    background: transparent;
  }

  :deep(.profile-selector .profile-display:hover) {
    background: transparent;
  }

  :deep(.profile-selector .profile-avatar) {
    width: 28px !important;
    height: 28px !important;
    flex-basis: 28px !important;
  }

  .sidebar-footer {
    .refresh-item {
      margin: 0;
      padding: 10px 4px;
      border-radius: $radius-sm;
    }

    .refresh-item span {
      display: none;
    }

    .status-text {
      display: none;
    }

    .version-text,
    .version-links {
      display: none;
    }

    .status-row {
      justify-content: center;

      :deep(.input-sm) {
        display: none;
      }
    }

    .version-info {
      justify-content: center;
      padding: 4px 0;

      :deep(.theme-switch-container) {
        flex-direction: column;
      }
    }
  }
}

// ─── Collapse button ────────────────────────────────────────────

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid $border-color;
  background: $bg-card;
  appearance: none;
  text-decoration: none;
  color: $text-muted;
  border-radius: $radius-sm;
  cursor: pointer;
  flex-shrink: 0;
  margin-left: auto;
  margin-right: 0;
  transition: all $transition-fast;

  &:hover {
    color: $accent-primary;
    border-color: $accent-primary;
    background-color: $bg-card-hover;
  }
}

// In expanded mode, overlap the top-right of the logo area
.sidebar:not(.collapsed) .collapse-btn {
  position: absolute;
  top: 16px;
  right: 14px;
  z-index: 5;
}

@media (max-width: $breakpoint-mobile) {
  .status-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 1000;
    transform: translateX(-100%);
    transition: transform $transition-normal;

    &.open {
      transform: translateX(0);
    }

    // Override global utility — sidebar is always 240px wide
    .input-sm {
      width: 90px;
    }
  }
}

.fun-link {
  text-decoration: none;
}
</style>
