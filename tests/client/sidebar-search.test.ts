// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const openSessionSearchMock = vi.hoisted(() => vi.fn())
const mockAppStore = vi.hoisted(() => ({
  sidebarOpen: true,
  sidebarCollapsed: false,
  connected: true,
  serverVersion: 'test',
  latestVersion: '',
  updateAvailable: false,
  clientOutdated: false,
  updating: false,
  toggleSidebar: vi.fn(),
  toggleSidebarCollapsed: vi.fn(),
  closeSidebar: vi.fn(),
  doUpdate: vi.fn(),
  reloadClient: vi.fn(),
}))

vi.mock('@/composables/useSessionSearch', () => ({
  useSessionSearch: () => ({
    openSessionSearch: openSessionSearchMock,
  }),
}))

vi.mock('@/stores/hermes/app', () => ({
  useAppStore: () => mockAppStore,
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    useRoute: () => ({ name: 'hermes.chat' }),
    useRouter: () => ({ push: vi.fn() }),
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
  createI18n: () => ({
    global: { locale: { value: 'en' }, setLocaleMessage: vi.fn() },
  }),
}))

vi.mock('@/composables/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}))

vi.mock('/logo.png', () => ({
  default: 'logo.png',
}))

vi.mock('@/components/layout/ProfileSelector.vue', () => ({
  default: { name: 'ProfileSelector', template: '<div />' },
}))

vi.mock('@/components/layout/ModelSelector.vue', () => ({
  default: { name: 'ModelSelector', template: '<div />' },
}))

vi.mock('@/components/layout/LanguageSwitch.vue', () => ({
  default: { name: 'LanguageSwitch', template: '<div />' },
}))

vi.mock('@/components/layout/ThemeSwitch.vue', () => ({
  default: { name: 'ThemeSwitch', template: '<div />' },
}))

vi.mock('@/components/common/RouteLinkItem.vue', () => ({
  default: {
    name: 'RouteLinkItem',
    props: ['to', 'active'],
    template: '<a class="route-link-item" :class="{ active }" :data-route-name="to && to.name" href="#"><slot /></a>',
  },
}))

vi.mock('naive-ui', async () => {
  const actual = await vi.importActual<any>('naive-ui')
  return {
    ...actual,
    useMessage: () => ({
      success: vi.fn(),
      error: vi.fn(),
    }),
    NButton: {
      template: '<button v-bind="$attrs"><slot /></button>',
    },
    NSelect: {
      template: '<div />',
    },
  }
})

import AppSidebar from '@/components/layout/AppSidebar.vue'

describe('AppSidebar search entry', () => {
  beforeEach(() => {
    window.localStorage.removeItem('hermes.sidebar.collapsedGroups')
    window.localStorage.removeItem('hermes.frontendAccessRole')
    openSessionSearchMock.mockClear()
    mockAppStore.serverVersion = 'test'
    mockAppStore.latestVersion = ''
    mockAppStore.updateAvailable = false
    mockAppStore.clientOutdated = false
    mockAppStore.updating = false
    mockAppStore.sidebarCollapsed = false
    mockAppStore.reloadClient.mockClear()
  })

  it('opens the session search modal from the sidebar button', async () => {
    const wrapper = mount(AppSidebar, {
      global: {
        stubs: {
          ProfileSelector: true,
          ModelSelector: true,
          LanguageSwitch: true,
          ThemeSwitch: true,
          NButton: true,
        },
      },
    })

    const buttons = wrapper.findAll('button')
    const searchButton = buttons.find(node => node.text().includes('sidebar.search'))
    expect(searchButton).toBeTruthy()

    await searchButton!.trigger('click')
    expect(openSessionSearchMock).toHaveBeenCalledTimes(1)
  })

  it('offers a client reload when the server version differs from the loaded bundle', async () => {
    mockAppStore.clientOutdated = true
    mockAppStore.serverVersion = '0.5.17'
    const wrapper = mount(AppSidebar, {
      global: {
        stubs: {
          ProfileSelector: true,
          ModelSelector: true,
          LanguageSwitch: true,
          ThemeSwitch: true,
        },
      },
    })

    const reloadButton = wrapper.findAll('button')
      .find(node => node.text().includes('sidebar.reloadClientVersion'))
    expect(reloadButton).toBeTruthy()

    await reloadButton!.trigger('click')
    expect(mockAppStore.reloadClient).toHaveBeenCalledTimes(1)
  })

  it('uses compact command group codes and keeps group folding active when collapsed', async () => {
    mockAppStore.sidebarCollapsed = true
    const wrapper = mount(AppSidebar, {
      global: {
        stubs: {
          ProfileSelector: true,
          ModelSelector: true,
          LanguageSwitch: true,
          ThemeSwitch: true,
          NButton: true,
        },
      },
    })

    expect(wrapper.classes()).toContain('collapsed')
    expect(wrapper.findAll('.nav-group-label span').map(node => node.text())).toEqual([
      'WORK',
      'LIB',
      'RPT',
      'MEM',
      'SYS',
      'DEV',
    ])
    expect(wrapper.findAll('.nav-group-label').map(node => node.attributes('title'))).toEqual([
      'Research Workspace',
      'Research Library',
      'Reports',
      'Memory',
      'Hermes System',
      'Developer Tools',
    ])

    const routeNames = wrapper.findAll('.route-link-item').map(node => node.attributes('data-route-name'))
    expect(routeNames).toEqual(expect.arrayContaining([
      'hermes.dashboard',
      'hermes.chat',
      'hermes.feasibility',
      'hermes.investorPortal',
      'hermes.projects',
      'hermes.files',
      'hermes.kanban',
      'hermes.research',
      'hermes.history',
      'hermes.reportsHub',
      'hermes.usage',
      'hermes.skillsUsage',
      'hermes.memory',
      'hermes.jobs',
      'hermes.channels',
      'hermes.skills',
      'hermes.plugins',
      'hermes.models',
      'hermes.profiles',
      'hermes.settings',
      'hermes.groupChat',
      'hermes.localBackupVault',
      'hermes.terminal',
      'hermes.logs',
      'hermes.performance',
      'hermes.versionPreview',
    ]))

    const libraryGroup = wrapper.findAll('.nav-group')[1]
    expect(libraryGroup.text()).toContain('sidebar.search')
    expect(libraryGroup.find('.nav-group-items').attributes('style')).toBeUndefined()

    await libraryGroup.find('.nav-group-label').trigger('click')
    expect(libraryGroup.find('.nav-group-items').attributes('style')).toContain('display: none')
  })

  it('shows a simplified employee workspace without owner or system-only links', () => {
    window.localStorage.setItem('hermes.frontendAccessRole', 'employee')
    const wrapper = mount(AppSidebar, {
      global: {
        stubs: {
          ProfileSelector: true,
          ModelSelector: true,
          LanguageSwitch: true,
          ThemeSwitch: true,
          NButton: true,
        },
      },
    })

    const text = wrapper.text()
    expect(text).toContain('My Tasks')
    expect(text).toContain('Research Jobs')
    expect(text).toContain('Employee Documents')
    expect(text).toContain('Reports / Outputs')
    expect(text).toContain('Access Help')
    expect(text).not.toContain('Raw Materials')
    expect(text).not.toContain('Memory')
    expect(text).not.toContain('Terminal')
    expect(text).not.toContain('Settings')
    expect(text).not.toContain('Models')
    expect(text).not.toContain('Backup Vault')

    const routeNames = wrapper.findAll('.route-link-item').map(node => node.attributes('data-route-name'))
    expect(routeNames).toEqual(expect.arrayContaining([
      'hermes.dashboard',
      'hermes.chat',
      'hermes.kanban',
      'hermes.jobs',
      'hermes.research',
      'hermes.files',
      'hermes.reportsHub',
      'hermes.accessDenied',
    ]))
    expect(routeNames).not.toContain('hermes.terminal')
    expect(routeNames).not.toContain('hermes.memory')
    expect(routeNames).not.toContain('hermes.rawMaterialSourcing')
  })

  it('keeps investor viewers inside approved investor navigation', () => {
    window.localStorage.setItem('hermes.frontendAccessRole', 'investor_viewer')
    const wrapper = mount(AppSidebar, {
      global: {
        stubs: {
          ProfileSelector: true,
          ModelSelector: true,
          LanguageSwitch: true,
          ThemeSwitch: true,
          NButton: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Investor Portal')
    expect(wrapper.text()).toContain('Approved Presentation')
    expect(wrapper.text()).toContain('Approved Reports')
    expect(wrapper.text()).toContain('Approved Data Room')
    expect(wrapper.text()).not.toContain('Chat')
    expect(wrapper.text()).not.toContain('Memory')
    expect(wrapper.text()).not.toContain('Terminal')

    const routeNames = wrapper.findAll('.route-link-item').map(node => node.attributes('data-route-name'))
    expect(new Set(routeNames)).toEqual(new Set(['hermes.investorPortal', 'hermes.accessDenied']))
  })

  it('shows developer admin system tools without raw business routes', () => {
    window.localStorage.setItem('hermes.frontendAccessRole', 'developer_admin')
    const wrapper = mount(AppSidebar, {
      global: {
        stubs: {
          ProfileSelector: true,
          ModelSelector: true,
          LanguageSwitch: true,
          ThemeSwitch: true,
          NButton: true,
        },
      },
    })

    const text = wrapper.text()
    expect(text).toContain('Terminal')
    expect(text).toContain('Logs')
    expect(text).toContain('Settings')
    expect(text).toContain('Models')
    expect(text).toContain('System Health')
    expect(text).not.toContain('Chat')
    expect(text).not.toContain('Memory')
    expect(text).not.toContain('Employee Documents')
  })
})
