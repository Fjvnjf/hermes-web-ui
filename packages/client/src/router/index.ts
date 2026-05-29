import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/hermes/dashboard',
    },
    {
      path: '/hermes/dashboard',
      name: 'hermes.dashboard',
      component: () => import('@/views/hermes/DashboardView.vue'),
    },
    {
      path: '/hermes/chat',
      name: 'hermes.chat',
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
      component: () => import('@/views/hermes/FeasibilityStudioView.vue'),
    },
    {
      path: '/hermes/research',
      name: 'hermes.research',
      component: () => import('@/views/hermes/ResearchLibraryView.vue'),
    },
    {
      path: '/hermes/reports',
      name: 'hermes.reportsHub',
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
      component: () => import('@/views/hermes/MarketIntelligenceView.vue'),
    },
    {
      path: '/hermes/competitor-intelligence',
      name: 'hermes.competitorIntelligence',
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
      component: () => import('@/views/hermes/ChatView.vue'),
    },
    {
      path: '/hermes/history',
      name: 'hermes.history',
      component: () => import('@/views/hermes/HistoryView.vue'),
    },
    {
      path: '/hermes/history/session/:sessionId',
      name: 'hermes.historySession',
      component: () => import('@/views/hermes/HistoryView.vue'),
    },
    {
      path: '/hermes/jobs',
      name: 'hermes.jobs',
      component: () => import('@/views/hermes/JobsView.vue'),
    },
    {
      path: '/hermes/kanban',
      name: 'hermes.kanban',
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
      component: () => import('@/views/hermes/FilesView.vue'),
    },
    {
      path: '/hermes/version-preview',
      name: 'hermes.versionPreview',
      component: () => import('@/views/hermes/VersionPreviewView.vue'),
    },
  ],
})

export default router
