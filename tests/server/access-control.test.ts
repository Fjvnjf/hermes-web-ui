import { describe, expect, it, vi } from 'vitest'

import {
  permissionForRequest,
  requireRequestPermission,
  roleHasPermission,
} from '../../packages/server/src/middleware/access-control'

function ctx(path: string, role: string, method = 'GET') {
  return {
    path,
    method,
    state: { user: { id: 1, username: role, role } },
    get: vi.fn(() => ''),
    ip: '127.0.0.1',
    status: 200,
    body: null,
  } as any
}

describe('RBAC request permission gate', () => {
  it('classifies sensitive Hermes API routes', () => {
    expect(permissionForRequest(ctx('/api/hermes/memory', 'super_admin'))).toBe('view:memory')
    expect(permissionForRequest(ctx('/api/hermes/memory', 'super_admin', 'POST'))).toBe('write:memory')
    expect(permissionForRequest(ctx('/api/hermes/sessions', 'super_admin'))).toBe('view:history')
    expect(permissionForRequest(ctx('/api/hermes/files', 'super_admin'))).toBe('view:files')
    expect(permissionForRequest(ctx('/api/hermes/kanban', 'super_admin', 'POST'))).toBe('create:task')
    expect(permissionForRequest(ctx('/api/hermes/config', 'super_admin'))).toBe('view:settings')
    expect(permissionForRequest(ctx('/v1/chat/completions', 'super_admin'))).toBe('use:proxy')
  })

  it('keeps owner legacy roles fully privileged', () => {
    expect(roleHasPermission('super_admin', 'view:memory')).toBe(true)
    expect(roleHasPermission('owner', 'view:terminal')).toBe(true)
    expect(roleHasPermission('admin', 'use:proxy')).toBe(true)
  })

  it('blocks investor viewers from raw dashboard APIs while allowing approved portal data', async () => {
    const deniedPaths = [
      '/api/hermes/memory',
      '/api/hermes/sessions',
      '/api/hermes/files',
      '/api/hermes/kanban',
      '/api/hermes/jobs',
      '/api/hermes/config',
      '/api/hermes/available-models',
      '/api/hermes/logs',
      '/v1/chat/completions',
    ]

    for (const path of deniedPaths) {
      const request = ctx(path, 'investor_viewer')
      const next = vi.fn(async () => {})
      await requireRequestPermission(request, next)
      expect(request.status).toBe(403)
      expect(next).not.toHaveBeenCalled()
    }

    const approved = ctx('/api/hermes/investor/portal', 'investor_viewer')
    const next = vi.fn(async () => {})
    await requireRequestPermission(approved, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('blocks employees from raw memory/history/files/system APIs but allows tasks', async () => {
    for (const path of ['/api/hermes/memory', '/api/hermes/sessions', '/api/hermes/files', '/api/hermes/logs']) {
      const request = ctx(path, 'employee')
      const next = vi.fn(async () => {})
      await requireRequestPermission(request, next)
      expect(request.status).toBe(403)
      expect(next).not.toHaveBeenCalled()
    }

    const kanban = ctx('/api/hermes/kanban', 'employee')
    const next = vi.fn(async () => {})
    await requireRequestPermission(kanban, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('lets developer admins use system tools without granting raw business memory', async () => {
    for (const path of ['/api/hermes/logs', '/api/hermes/config', '/api/hermes/available-models']) {
      const request = ctx(path, 'developer_admin')
      const next = vi.fn(async () => {})
      await requireRequestPermission(request, next)
      expect(next).toHaveBeenCalledOnce()
    }

    const memory = ctx('/api/hermes/memory', 'developer_admin')
    const next = vi.fn(async () => {})
    await requireRequestPermission(memory, next)
    expect(memory.status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})
