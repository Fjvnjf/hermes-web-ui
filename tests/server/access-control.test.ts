import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

import {
  auditAccessEvent,
  permissionForRequest,
  requireRequestPermission,
  roleHasPermission,
} from '../../packages/server/src/middleware/access-control'
import { config } from '../../packages/server/src/config'

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
    expect(permissionForRequest(ctx('/api/hermes/backup/export', 'super_admin'))).toBe('export:backup')
    expect(permissionForRequest(ctx('/api/hermes/intelligence-state', 'super_admin'))).toBe('view:product-development')
    expect(permissionForRequest(ctx('/api/hermes/intelligence-state/autopilot-import-status', 'super_admin'))).toBe('view:jobs')
    expect(permissionForRequest(ctx('/api/hermes/intelligence-state/autopilot-import-now', 'super_admin', 'POST'))).toBe('view:product-development')
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
      '/api/hermes/backup/export',
      '/api/hermes/intelligence-state',
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

  it('allows employees through scoped business APIs while blocking memory, investor, proxy, and system APIs', async () => {
    for (const path of ['/api/hermes/memory', '/api/hermes/investor/portal', '/api/hermes/logs', '/api/hermes/config', '/api/hermes/available-models', '/api/hermes/backup/export', '/api/hermes/intelligence-state', '/v1/chat/completions']) {
      const request = ctx(path, 'employee')
      const next = vi.fn(async () => {})
      await requireRequestPermission(request, next)
      expect(request.status).toBe(403)
      expect(next).not.toHaveBeenCalled()
    }

    for (const path of ['/api/hermes/sessions', '/api/hermes/files', '/api/hermes/kanban', '/api/hermes/jobs']) {
      const request = ctx(path, 'employee')
      const next = vi.fn(async () => {})
      await requireRequestPermission(request, next)
      expect(next).toHaveBeenCalledOnce()
    }
  })

  it('keeps local backup exports owner-only', async () => {
    for (const role of ['employee', 'investor_viewer', 'research_assistant', 'financial_analyst', 'regulatory_consultant', 'developer_admin']) {
      const request = ctx('/api/hermes/backup/export', role)
      const next = vi.fn(async () => {})
      await requireRequestPermission(request, next)
      expect(request.status).toBe(403)
      expect(next).not.toHaveBeenCalled()
    }

    const owner = ctx('/api/hermes/backup/export', 'super_admin')
    const next = vi.fn(async () => {})
    await requireRequestPermission(owner, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('keeps dashboard intelligence persistence owner-only because it can contain sensitive business facts', async () => {
    for (const role of ['employee', 'investor_viewer', 'research_assistant', 'financial_analyst', 'regulatory_consultant', 'developer_admin']) {
      for (const [path, method] of [
        ['/api/hermes/intelligence-state', 'GET'],
        ['/api/hermes/intelligence-state/autopilot-import-now', 'POST'],
      ] as const) {
        const request = ctx(path, role, method)
        const next = vi.fn(async () => {})
        await requireRequestPermission(request, next)
        expect(request.status).toBe(403)
        expect(next).not.toHaveBeenCalled()
      }
    }

    const owner = ctx('/api/hermes/intelligence-state', 'super_admin')
    const next = vi.fn(async () => {})
    await requireRequestPermission(owner, next)
    expect(next).toHaveBeenCalledOnce()

    const ownerImport = ctx('/api/hermes/intelligence-state/autopilot-import-now', 'super_admin', 'POST')
    const importNext = vi.fn(async () => {})
    await requireRequestPermission(ownerImport, importNext)
    expect(importNext).toHaveBeenCalledOnce()
  })

  it('allows jobs-scoped users to read autopilot import health without granting full dashboard intelligence', async () => {
    for (const role of ['employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant', 'developer_admin', 'super_admin']) {
      const request = ctx('/api/hermes/intelligence-state/autopilot-import-status', role)
      const next = vi.fn(async () => {})
      await requireRequestPermission(request, next)
      expect(next).toHaveBeenCalledOnce()
    }

    const investor = ctx('/api/hermes/intelligence-state/autopilot-import-status', 'investor_viewer')
    const denied = vi.fn(async () => {})
    await requireRequestPermission(investor, denied)
    expect(investor.status).toBe(403)
    expect(denied).not.toHaveBeenCalled()
  })

  it('lets research assistants reach scoped jobs without granting raw system tools', async () => {
    const jobs = ctx('/api/hermes/jobs', 'research_assistant')
    const next = vi.fn(async () => {})
    await requireRequestPermission(jobs, next)
    expect(next).toHaveBeenCalledOnce()

    const logs = ctx('/api/hermes/logs', 'research_assistant')
    const denied = vi.fn(async () => {})
    await requireRequestPermission(logs, denied)
    expect(logs.status).toBe(403)
    expect(denied).not.toHaveBeenCalled()
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

  it('writes denied access attempts to the audit log', async () => {
    const resource = `/api/hermes/memory/audit-test-${Date.now()}`
    auditAccessEvent({
      user: { id: 7, username: 'test_employee', role: 'employee' },
      action: 'GET /api/hermes/memory',
      resource,
      permission: 'view:memory',
      result: 'denied',
      reason: 'test-denial',
    })

    const auditFile = join(config.appHome, 'logs', 'access-audit.jsonl')
    expect(existsSync(auditFile)).toBe(true)
    const lines = readFileSync(auditFile, 'utf8').trim().split('\n')
    const event = JSON.parse(lines[lines.length - 1])
    expect(event).toMatchObject({
      username: 'test_employee',
      role: 'employee',
      resource,
      result: 'denied',
      permission: 'view:memory',
    })
  })
})
