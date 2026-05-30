import { createRouter, createWebHashHistory } from 'vue-router'
import { canAccessRouteName, getFrontendAccessRole } from '@/utils/accessControl'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/hermes/dashboard',
    },
    {
      path: '/hermes/access-denied',
      name: 'hermes.accessDenied',
      component: () => import('@/views/hermes/AccessDeniedView.vue'),
    },
    {
      path: '/hermes/investor-portal',
      name: 'hermes.investorPortal',
      meta: { sensitivity: 'investor-approved' },
      component: () => import('@/views/hermes/InvestorPortalView.vue'),
    },
    {
      path: '/hermes/dashboard',
      name: 'hermes.dashboard',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/DashboardView.vue'),
    },
    {
      path: '/hermes/last-24-hours',
      name: 'hermes.last24Hours',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/Last24HoursView.vue'),
    },
    {
      path: '/hermes/chat',
      name: 'hermes.chat',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/ChatView.vue'),
    },
    {
      path: '/hermes/projects',
      name: 'hermes.projects',
      component: () => import('@/views/hermes/ProjectsView.vue'),
    },
    {
      path: '/hermes/feasibility',
      name: 'hermes.feasibility',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/FeasibilityStudioView.vue'),
    },
    {
      path: '/hermes/research',
      name: 'hermes.research',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/ResearchLibraryView.vue'),
    },
    {
      path: '/hermes/reports',
      name: 'hermes.reportsHub',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/ReportsHubView.vue'),
    },
    {
      path: '/hermes/investor-readiness',
      name: 'hermes.investorReadiness',
      component: () => import('@/views/hermes/InvestorReadinessView.vue'),
    },
    {
      path: '/hermes/investment-calculator',
      name: 'hermes.investmentCalculator',
      component: () => import('@/views/hermes/InvestmentCalculatorView.vue'),
    },
    {
      path: '/hermes/market-intelligence',
      name: 'hermes.marketIntelligence',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/MarketIntelligenceView.vue'),
    },
    {
      path: '/hermes/raw-material-sourcing',
      name: 'hermes.rawMaterialSourcing',
      meta: { sensitivity: 'confidential' },
      component: () => import('@/views/hermes/RawMaterialSourcingView.vue'),
    },
    {
      path: '/hermes/export-market-opportunity',
      name: 'hermes.exportMarketOpportunity',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/ExportMarketOpportunityView.vue'),
    },
    {
      path: '/hermes/competitor-intelligence',
      name: 'hermes.competitorIntelligence',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/CompetitorIntelligenceView.vue'),
    },
    {
      path: '/hermes/investor-presentation',
      name: 'hermes.investorPresentation',
      component: () => import('@/views/hermes/InvestorPresentationBuilderView.vue'),
    },
    {
      path: '/hermes/research-review',
      name: 'hermes.researchResultReview',
      component: () => import('@/views/hermes/ResearchResultReviewView.vue'),
    },
    {
      path: '/hermes/session/:sessionId',
      name: 'hermes.session',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/ChatView.vue'),
    },
    {
      path: '/hermes/history',
      name: 'hermes.history',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/HistoryView.vue'),
    },
    {
      path: '/hermes/history/session/:sessionId',
      name: 'hermes.historySession',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/HistoryView.vue'),
    },
    {
      path: '/hermes/jobs',
      name: 'hermes.jobs',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/JobsView.vue'),
    },
    {
      path: '/hermes/kanban',
      name: 'hermes.kanban',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/KanbanView.vue'),
    },
    {
      path: '/hermes/models',
      name: 'hermes.models',
      component: () => import('@/views/hermes/ModelsView.vue'),
    },
    {
      path: '/hermes/profiles',
      name: 'hermes.profiles',
      component: () => import('@/views/hermes/ProfilesView.vue'),
    },
    {
      path: '/hermes/logs',
      name: 'hermes.logs',
      component: () => import('@/views/hermes/LogsView.vue'),
    },
    {
      path: '/hermes/usage',
      name: 'hermes.usage',
      component: () => import('@/views/hermes/UsageView.vue'),
    },
    {
      path: '/hermes/performance',
      name: 'hermes.performance',
      component: () => import('@/views/hermes/PerformanceView.vue'),
    },
    {
      path: '/hermes/skills-usage',
      name: 'hermes.skillsUsage',
      component: () => import('@/views/hermes/SkillsUsageView.vue'),
    },
    {
      path: '/hermes/skills',
      name: 'hermes.skills',
      component: () => import('@/views/hermes/SkillsView.vue'),
    },
    {
      path: '/hermes/plugins',
      name: 'hermes.plugins',
      component: () => import('@/views/hermes/PluginsView.vue'),
    },
    {
      path: '/hermes/memory',
      name: 'hermes.memory',
      component: () => import('@/views/hermes/MemoryView.vue'),
    },
    {
      path: '/hermes/settings',
      name: 'hermes.settings',
      component: () => import('@/views/hermes/SettingsView.vue'),
    },
    {
      path: '/hermes/channels',
      name: 'hermes.channels',
      component: () => import('@/views/hermes/ChannelsView.vue'),
    },
    {
      path: '/hermes/terminal',
      name: 'hermes.terminal',
      component: () => import('@/views/hermes/TerminalView.vue'),
    },
    {
      path: '/hermes/local-backup-vault',
      name: 'hermes.localBackupVault',
      meta: { sensitivity: 'system-admin-only' },
      component: () => import('@/views/hermes/LocalBackupVaultView.vue'),
    },
    {
      path: '/hermes/backup-vault',
      redirect: { name: 'hermes.localBackupVault' },
    },
    {
      path: '/hermes/group-chat',
      name: 'hermes.groupChat',
      component: () => import('@/views/hermes/GroupChatView.vue'),
    },
    {
      path: '/hermes/group-chat/room/:roomId',
      name: 'hermes.groupChatRoom',
      component: () => import('@/views/hermes/GroupChatView.vue'),
    },
    {
      path: '/hermes/files',
      name: 'hermes.files',
      meta: { sensitivity: 'employee-safe' },
      component: () => import('@/views/hermes/FilesView.vue'),
    },
    {
      path: '/hermes/version-preview',
      name: 'hermes.versionPreview',
      component: () => import('@/views/hermes/VersionPreviewView.vue'),
    },
  ],
})

router.beforeEach((to) => {
  const routeName = typeof to.name === 'string' ? to.name : ''
  if (!routeName) return true
  const role = getFrontendAccessRole()
  if (canAccessRouteName(routeName, role)) return true
  if (routeName === 'hermes.accessDenied') return true
  return { name: 'hermes.accessDenied', query: { from: routeName, role } }
})

export default router
