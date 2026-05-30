import { beforeEach, describe, expect, it, vi } from 'vitest'

const provider = {
  listDir: vi.fn(),
  stat: vi.fn(),
}
const createFileProviderMock = vi.fn(async () => provider)
const resolveHermesPathMock = vi.fn((relativePath: string) => {
  const normalized = relativePath.replace(/^\/+/, '')
  return normalized ? `/home/agent/.hermes/${normalized}` : '/home/agent/.hermes'
})

vi.mock('../../packages/server/src/services/hermes/file-provider', () => ({
  createFileProvider: createFileProviderMock,
  resolveHermesPath: resolveHermesPathMock,
  isSensitivePath: vi.fn(() => false),
  MAX_EDIT_SIZE: 10 * 1024 * 1024,
}))

describe('file routes path metadata', () => {
  beforeEach(() => {
    vi.resetModules()
    createFileProviderMock.mockClear()
    resolveHermesPathMock.mockClear()
    provider.listDir.mockReset()
    provider.stat.mockReset()
  })

  it('returns absolute paths for listed entries while preserving relative operation paths', async () => {
    provider.listDir.mockResolvedValue([
      { name: 'app.log', path: 'logs/app.log', isDir: false, size: 12, modTime: '2026-05-20T00:00:00.000Z' },
    ])

    const { fileRoutes } = await import('../../packages/server/src/routes/hermes/files')
    const layer = fileRoutes.stack.find((entry: any) => entry.path === '/api/hermes/files/list')
    const ctx: any = { query: { path: 'logs' }, state: { profile: { name: 'research' } }, body: null }

    await layer.stack[0](ctx)

    expect(createFileProviderMock).toHaveBeenCalledWith('research')
    expect(resolveHermesPathMock).toHaveBeenCalledWith('logs', 'research')
    expect(provider.listDir).toHaveBeenCalledWith('/home/agent/.hermes/logs')
    expect(ctx.body).toEqual({
      path: 'logs',
      absolutePath: '/home/agent/.hermes/logs',
      entries: [
        {
          name: 'app.log',
          path: 'logs/app.log',
          absolutePath: '/home/agent/.hermes/logs/app.log',
          isDir: false,
          size: 12,
          modTime: '2026-05-20T00:00:00.000Z',
        },
      ],
    })
  })

  it('returns an absolute path in stat responses', async () => {
    provider.stat.mockResolvedValue({
      name: 'app.log',
      path: 'logs/app.log',
      isDir: false,
      size: 12,
      modTime: '2026-05-20T00:00:00.000Z',
    })

    const { fileRoutes } = await import('../../packages/server/src/routes/hermes/files')
    const layer = fileRoutes.stack.find((entry: any) => entry.path === '/api/hermes/files/stat')
    const ctx: any = { query: { path: 'logs/app.log' }, state: { profile: { name: 'research' } }, body: null }

    await layer.stack[0](ctx)

    expect(createFileProviderMock).toHaveBeenCalledWith('research')
    expect(resolveHermesPathMock).toHaveBeenCalledWith('logs/app.log', 'research')
    expect(ctx.body).toEqual({
      name: 'app.log',
      path: 'logs/app.log',
      absolutePath: '/home/agent/.hermes/logs/app.log',
      isDir: false,
      size: 12,
      modTime: '2026-05-20T00:00:00.000Z',
    })
  })

  it('filters employee file listings to safe categories and blocks sensitive direct metadata access', async () => {
    provider.listDir.mockResolvedValue([
      { name: 'employee-safe', path: 'employee-safe', isDir: true, size: 0, modTime: '2026-05-20T00:00:00.000Z' },
      { name: 'supplier-quotes', path: 'supplier-quotes', isDir: true, size: 0, modTime: '2026-05-20T00:00:00.000Z' },
      { name: 'note.md', path: 'research/note.md', isDir: false, size: 12, modTime: '2026-05-20T00:00:00.000Z' },
      { name: 'cost.xlsx', path: 'research/cost.xlsx', isDir: false, size: 12, modTime: '2026-05-20T00:00:00.000Z' },
    ])

    const { fileRoutes } = await import('../../packages/server/src/routes/hermes/files')
    const listLayer = fileRoutes.stack.find((entry: any) => entry.path === '/api/hermes/files/list')
    const listCtx: any = {
      query: { path: '' },
      state: { profile: { name: 'research' }, user: { role: 'employee' } },
      body: null,
    }

    await listLayer.stack[0](listCtx)

    expect(listCtx.body.entries.map((entry: any) => entry.path)).toEqual(['employee-safe', 'research/note.md'])

    const statLayer = fileRoutes.stack.find((entry: any) => entry.path === '/api/hermes/files/stat')
    const statCtx: any = {
      query: { path: 'supplier-quotes/quote.pdf' },
      state: { profile: { name: 'research' }, user: { role: 'employee' } },
      body: null,
    }

    await statLayer.stack[0](statCtx)

    expect(statCtx.status).toBe(403)
    expect(statCtx.body).toMatchObject({ code: 'permission_denied' })
    expect(provider.stat).not.toHaveBeenCalled()
  })
})
