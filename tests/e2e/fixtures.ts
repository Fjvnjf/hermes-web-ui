import type { Page, Request, Route } from '@playwright/test'

export const TEST_ACCESS_KEY = 'playwright-access-key'

export interface MockedRequest {
  method: string
  pathname: string
  search: string
  headers: Record<string, string>
  postData: string | null
}

interface MockHermesApiOptions {
  tokenValidationStatus?: number
  initialProfileName?: 'default' | 'research'
  sessions?: unknown[]
}

const sampleModelGroup = {
  provider: 'test-provider',
  label: 'Test Provider',
  base_url: 'https://example.invalid/v1',
  models: ['test-model'],
  available_models: ['test-model'],
  api_key: '',
  builtin: true,
}

const sampleJob = {
  job_id: 'job-smoke',
  id: 'job-smoke',
  name: 'Nightly Smoke',
  prompt: 'Run the smoke check',
  prompt_preview: 'Run the smoke check',
  skills: [],
  skill: null,
  model: 'test-model',
  provider: 'test-provider',
  base_url: null,
  script: null,
  schedule: '0 9 * * *',
  schedule_display: '0 9 * * *',
  repeat: { times: null, completed: 0 },
  enabled: true,
  state: 'scheduled',
  paused_at: null,
  paused_reason: null,
  created_at: '2026-01-01T00:00:00.000Z',
  next_run_at: '2026-01-02T09:00:00.000Z',
  last_run_at: null,
  last_status: null,
  last_error: null,
  deliver: 'origin',
  origin: null,
  last_delivery_error: null,
}

const sampleBoard = {
  slug: 'default',
  name: 'Default',
  description: 'Primary command board',
  icon: '',
  color: '#4fc3f7',
  created_at: null,
  archived: false,
  counts: {},
  total: 0,
}

const emptyUsageStats = {
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cache_read_tokens: 0,
  total_cache_write_tokens: 0,
  total_reasoning_tokens: 0,
  total_sessions: 0,
  total_cost: 0,
  total_api_calls: 0,
  period_days: 30,
  model_usage: [],
  daily_usage: [],
}

const emptySkillUsageStats = {
  period_days: 7,
  summary: {
    total_skill_loads: 0,
    total_skill_edits: 0,
    total_skill_actions: 0,
    distinct_skills_used: 0,
  },
  by_day: [],
  top_skills: [],
}

const samplePerformanceSnapshot = {
  timestamp: Date.now(),
  system: {
    platform: 'darwin',
    arch: 'arm64',
    uptimeSeconds: 3600,
    cpuCount: 8,
    cpuPercent: 12.5,
    loadAverage: [1.2, 1.1, 1],
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
    freeMemoryBytes: 8 * 1024 * 1024 * 1024,
    usedMemoryBytes: 8 * 1024 * 1024 * 1024,
    memoryPercent: 50,
  },
  web: {
    pid: 4242,
    uptimeSeconds: 120,
    memory: { rss: 128 * 1024 * 1024 },
    cpuPercent: 2.4,
  },
  bridge: {
    endpoint: '/tmp/hermes-agent-bridge.sock',
    reachable: true,
    broker: {
      running: true,
      ready: true,
      pid: 31337,
      process: {
        pid: 31337,
        role: 'broker',
        running: true,
        cpuPercent: 1.1,
        memoryRssBytes: 96 * 1024 * 1024,
      },
      restartScheduled: false,
      restartAttempts: 0,
    },
    workers: [],
    totalWorkerMemoryRssBytes: 0,
  },
  sessions: {
    active: 0,
    running: 0,
    byProfile: {},
  },
}

const previewStatus = {
  preview_dir: '/tmp/hermes-preview',
  exists: false,
  has_package: false,
  installed: false,
  running: false,
  pid: null,
  current_tag: '',
  frontend_url: '',
  agent_bridge_endpoint: '',
  log_path: '',
  webui_home: '',
  action_log_path: '',
  dev_log_path: '',
  action_log: '',
  dev_log: '',
}

const sampleProfileDetail = {
  name: 'research',
  path: '/tmp/hermes/profiles/research',
  model: 'test-model',
  provider: 'test-provider',
  skills: 0,
  hasEnv: false,
  hasSoulMd: false,
  avatar: null,
}

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

function recordRequest(request: Request): MockedRequest {
  const url = new URL(request.url())
  return {
    method: request.method(),
    pathname: url.pathname,
    search: url.search,
    headers: request.headers(),
    postData: request.postData(),
  }
}

export async function mockHermesApi(page: Page, options: MockHermesApiOptions = {}) {
  const requests: MockedRequest[] = []
  const unexpectedRequests: MockedRequest[] = []
  const tokenValidationStatus = options.tokenValidationStatus ?? 200
  let activeProfileName = options.initialProfileName ?? 'research'

  await page.route('**/*', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const { pathname } = url

    if (!(pathname === '/health' || pathname.startsWith('/api/') || pathname.startsWith('/v1/'))) {
      await route.continue()
      return
    }

    requests.push(recordRequest(request))

    if (pathname === '/health') {
      await route.fulfill(jsonResponse({ status: 'ok', webui_version: '0.5.23', node_version: '23.0.0' }))
      return
    }

    if (pathname === '/api/auth/status') {
      await route.fulfill(jsonResponse({ hasPasswordLogin: true, username: 'playwright' }))
      return
    }

    if (pathname === '/api/auth/login') {
      if (request.method() !== 'POST') {
        await route.fulfill(jsonResponse({ error: 'Method not allowed' }, 405))
        return
      }
      if (tokenValidationStatus !== 200) {
        await route.fulfill(jsonResponse({ error: 'Invalid username or password' }, tokenValidationStatus))
        return
      }
      await route.fulfill(jsonResponse({ token: TEST_ACCESS_KEY }))
      return
    }

    if (pathname === '/api/auth/me') {
      await route.fulfill(jsonResponse({
        user: {
          id: 1,
          username: 'playwright',
          role: 'super_admin',
          status: 'active',
          created_at: 0,
          updated_at: 0,
          last_login_at: 0,
          requiresCredentialChange: false,
        },
      }))
      return
    }

    if (pathname === '/api/auth/users') {
      await route.fulfill(jsonResponse({
        users: [
          {
            id: 1,
            username: 'playwright',
            role: 'super_admin',
            status: 'active',
            created_at: 0,
            updated_at: 0,
            last_login_at: 0,
          },
        ],
      }))
      return
    }

    if (pathname === '/api/hermes/sessions') {
      await route.fulfill(jsonResponse({ sessions: options.sessions ?? [] }, tokenValidationStatus))
      return
    }

    if (pathname === '/api/hermes/sessions/hermes') {
      await route.fulfill(jsonResponse({ sessions: [] }))
      return
    }

    if (pathname === '/api/hermes/sessions/context-length') {
      await route.fulfill(jsonResponse({ context_length: 256000 }))
      return
    }

    if (pathname === '/api/hermes/files/list') {
      await route.fulfill(jsonResponse({ entries: [], path: '' }))
      return
    }

    if (pathname === '/api/hermes/config/models') {
      await route.fulfill(jsonResponse({
        default: 'test-model',
        groups: [{ provider: 'test-provider', models: [{ id: 'test-model', label: 'test-model' }] }],
      }))
      return
    }

    if (pathname === '/api/hermes/update/preview') {
      await route.fulfill(jsonResponse(previewStatus))
      return
    }

    if (pathname === '/api/hermes/update/preview/tags') {
      await route.fulfill(jsonResponse({ tags: [{ name: 'v0.6.4', sha: 'test-sha' }] }))
      return
    }

    if (pathname === '/api/hermes/auth/copilot/check-token') {
      await route.fulfill(jsonResponse({ has_token: false, source: null, enabled: false }))
      return
    }

    if (pathname === '/api/auth/locked-ips') {
      await route.fulfill(jsonResponse({ locks: [] }))
      return
    }

    if (pathname === '/api/hermes/available-models') {
      await route.fulfill(jsonResponse({
        default: 'test-model',
        default_provider: 'test-provider',
        groups: [sampleModelGroup],
        allProviders: [sampleModelGroup],
        model_aliases: {},
        model_visibility: {},
      }))
      return
    }

    if (pathname === '/api/hermes/provider-models') {
      await route.fulfill(jsonResponse({ models: ['proxy-model-a', 'proxy-model-b'] }))
      return
    }

    if (pathname === '/api/hermes/profiles') {
      await route.fulfill(jsonResponse({
        profiles: [
          { name: 'default', active: activeProfileName === 'default', model: 'test-model', gateway: 'test', alias: 'Default', avatar: null },
          { name: 'research', active: activeProfileName === 'research', model: 'test-model', gateway: 'test', alias: 'Research', avatar: null },
        ],
      }))
      return
    }

    if (pathname === '/api/hermes/profiles/runtime-statuses') {
      await route.fulfill(jsonResponse({
        profiles: [
          {
            profile: 'default',
            bridge: { running: activeProfileName === 'default', profile: 'default', reachable: true },
            gateway: { running: true, profile: 'default' },
          },
          {
            profile: 'research',
            bridge: { running: activeProfileName === 'research', profile: 'research', reachable: true },
            gateway: { running: true, profile: 'research' },
          },
        ],
      }))
      return
    }

    if (pathname === '/api/hermes/profiles/active') {
      if (request.method() !== 'PUT') {
        await route.fulfill(jsonResponse({ error: 'Method not allowed' }, 405))
        return
      }

      let body: { name?: unknown }
      try {
        body = JSON.parse(request.postData() || '{}')
      } catch {
        await route.fulfill(jsonResponse({ error: 'Invalid JSON body' }, 400))
        return
      }

      if (body.name !== 'default' && body.name !== 'research') {
        await route.fulfill(jsonResponse({ error: 'Unknown profile' }, 400))
        return
      }

      activeProfileName = body.name
      await route.fulfill(jsonResponse({ success: true, active: activeProfileName }))
      return
    }

    if (request.method() === 'GET' && /^\/api\/hermes\/profiles\/[^/]+$/.test(pathname)) {
      const name = decodeURIComponent(pathname.split('/').pop() || 'research')
      await route.fulfill(jsonResponse({ profile: { ...sampleProfileDetail, name } }))
      return
    }

    if (pathname === '/api/hermes/config') {
      await route.fulfill(jsonResponse({
        display: { streaming: true, show_reasoning: true, show_cost: true },
        agent: {},
        memory: {},
        compression: {},
        session_reset: {},
        privacy: {},
        approvals: {},
        telegram: {},
        discord: {},
        slack: {},
        whatsapp: {},
        matrix: {},
        wecom: {},
        feishu: {},
        dingtalk: {},
        qqbot: {},
        weixin: {},
        platforms: {},
      }))
      return
    }

    if (pathname === '/api/hermes/jobs') {
      await route.fulfill(jsonResponse({ jobs: [sampleJob] }))
      return
    }

    if (pathname === '/api/cron-history') {
      await route.fulfill(jsonResponse({ runs: [] }))
      return
    }

    if (pathname === '/api/hermes/kanban/boards') {
      await route.fulfill(jsonResponse({ boards: [sampleBoard] }))
      return
    }

    if (pathname === '/api/hermes/kanban/capabilities') {
      await route.fulfill(jsonResponse({
        capabilities: {
          source: 'hermes-cli',
          supports: { events: false },
          missing: ['events'],
          capabilities: [{ key: 'events', status: 'missing', requiresBoard: true }],
        },
      }))
      return
    }

    if (pathname === '/api/hermes/kanban') {
      await route.fulfill(jsonResponse({ tasks: [] }))
      return
    }

    if (pathname === '/api/hermes/kanban/stats') {
      await route.fulfill(jsonResponse({ stats: { by_status: {}, by_assignee: {}, total: 0 } }))
      return
    }

    if (pathname === '/api/hermes/kanban/assignees') {
      await route.fulfill(jsonResponse({ assignees: [] }))
      return
    }

    if (pathname === '/api/hermes/logs') {
      await route.fulfill(jsonResponse({ files: [] }))
      return
    }

    if (pathname.startsWith('/api/hermes/logs/')) {
      await route.fulfill(jsonResponse({ entries: [] }))
      return
    }

    if (pathname === '/api/hermes/usage/stats') {
      const period = Number(url.searchParams.get('days') || 30)
      await route.fulfill(jsonResponse({ ...emptyUsageStats, period_days: period }))
      return
    }

    if (pathname === '/api/hermes/performance/runtime') {
      await route.fulfill(jsonResponse(samplePerformanceSnapshot))
      return
    }

    if (pathname === '/api/hermes/skills/usage/stats') {
      const period = Number(url.searchParams.get('days') || 7)
      await route.fulfill(jsonResponse({ ...emptySkillUsageStats, period_days: period }))
      return
    }

    if (pathname === '/api/hermes/skills') {
      await route.fulfill(jsonResponse({ categories: [], archived: [] }))
      return
    }

    if (pathname === '/api/hermes/plugins') {
      await route.fulfill(jsonResponse({
        plugins: [],
        warnings: [],
        metadata: {
          hermesAgentRoot: '/tmp/hermes-agent',
          pythonExecutable: '/usr/bin/python3',
          cwd: '/tmp/hermes',
          projectPluginsEnabled: false,
        },
      }))
      return
    }

    if (pathname === '/api/hermes/memory') {
      await route.fulfill(jsonResponse({
        memory: '',
        user: '',
        soul: '',
        memory_mtime: null,
        user_mtime: null,
        soul_mtime: null,
      }))
      return
    }

    if (pathname === '/api/hermes/group-chat/rooms') {
      await route.fulfill(jsonResponse({ rooms: [] }))
      return
    }

    unexpectedRequests.push(recordRequest(request))
    await route.fulfill(jsonResponse({ error: `Unexpected mocked route: ${request.method()} ${pathname}` }, 404))
  })

  return { requests, unexpectedRequests }
}

export async function authenticate(page: Page, accessKey = TEST_ACCESS_KEY, profileName?: string) {
  await page.addInitScript((state: { storedToken: string; storedProfileName?: string }) => {
    const { storedToken, storedProfileName } = state
    window.localStorage.setItem('hermes_api_key', storedToken)
    if (storedProfileName && !window.localStorage.getItem('hermes_active_profile_name')) {
      window.localStorage.setItem('hermes_active_profile_name', storedProfileName)
    }
  }, { storedToken: accessKey, storedProfileName: profileName })
}

export async function mockChatSocket(page: Page) {
  await page.route('**/node_modules/.vite/deps/socket__io-client.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
const state = window.__PW_CHAT_SOCKET__ || (window.__PW_CHAT_SOCKET__ = { sockets: [], emitted: [] })
function makeSocket(url, options) {
  const listeners = new Map()
  const onceListeners = new Map()
  const socket = {
    connected: true,
    url,
    options,
    on(event, handler) {
      const handlers = listeners.get(event) || []
      handlers.push(handler)
      listeners.set(event, handlers)
      return this
    },
    once(event, handler) {
      const handlers = onceListeners.get(event) || []
      handlers.push(handler)
      onceListeners.set(event, handlers)
      return this
    },
    emit(event, payload) {
      state.emitted.push({ event, payload })
      if (event === 'resume') {
        const sessionId = payload && payload.session_id
        const resumes = window.__PW_CHAT_SOCKET_RESUMES__ || {}
        const response = sessionId ? resumes[sessionId] : null
        if (response) {
          setTimeout(() => this.__trigger('resumed', response), 0)
        }
      }
      return this
    },
    removeAllListeners() {
      listeners.clear()
      onceListeners.clear()
      return this
    },
    disconnect() {
      this.connected = false
      return this
    },
    __trigger(event, payload) {
      for (const handler of listeners.get(event) || []) handler(payload)
      const handlers = onceListeners.get(event) || []
      onceListeners.delete(event)
      for (const handler of handlers) handler(payload)
    },
  }
  state.sockets.push(socket)
  state.latest = socket
  return socket
}
export function io(url, options) {
  return makeSocket(url, options)
}
export default { io }
`,
    })
  })
}

export async function mockTerminalWebSocket(page: Page) {
  await page.addInitScript(() => {
    const state = (window as any).__PW_TERMINAL_WS__ = {
      sockets: [] as any[],
      sent: [] as any[],
      createdCount: 0,
      latest: null as any,
    }
    const RealEvent = window.Event
    const RealMessageEvent = window.MessageEvent

    class MockTerminalWebSocket extends EventTarget {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3

      readonly CONNECTING = 0
      readonly OPEN = 1
      readonly CLOSING = 2
      readonly CLOSED = 3
      binaryType: BinaryType = 'blob'
      bufferedAmount = 0
      extensions = ''
      protocol = ''
      readyState = MockTerminalWebSocket.CONNECTING
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null

      constructor(readonly url: string | URL) {
        super()
        state.sockets.push(this)
        state.latest = this
        setTimeout(() => {
          this.readyState = MockTerminalWebSocket.OPEN
          const openEvent = new RealEvent('open')
          this.onopen?.(openEvent)
          this.dispatchEvent(openEvent)
          this.__createSession('term-1', 'zsh', 101)
        }, 0)
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        const normalized = typeof data === 'string' ? data : String(data)
        state.sent.push({ socket: this.url.toString(), data: normalized })
        if (normalized.charCodeAt(0) !== 0x7B) return
        try {
          const message = JSON.parse(normalized)
          if (message.type === 'create') {
            this.__createSession(`term-${state.createdCount + 1}`, 'bash', 200 + state.createdCount)
          }
          if (message.type === 'switch') {
            this.__emitMessage(JSON.stringify({ type: 'switched', id: message.sessionId }))
          }
        } catch {}
      }

      close() {
        this.readyState = MockTerminalWebSocket.CLOSED
      }

      __createSession(id: string, shell: string, pid: number) {
        state.createdCount += 1
        this.__emitMessage(JSON.stringify({ type: 'created', id, shell, pid }))
      }

      __emitMessage(data: string) {
        const event = new RealMessageEvent('message', { data })
        this.onmessage?.(event)
        this.dispatchEvent(event)
      }
    }

    ;(window as any).WebSocket = MockTerminalWebSocket
  })
}
