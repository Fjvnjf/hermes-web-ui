import { describe, expect, it, vi } from 'vitest'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'

import {
  buildBackupArchive,
  createBackupSnapshot,
  normalizeBackupType,
  redactSensitiveData,
  saveBackupSchedule,
} from '../../packages/server/src/services/backup/local-backup-vault'

async function runRouteLayer(layer: any, ctx: any) {
  let index = -1
  async function dispatch(nextIndex: number): Promise<void> {
    if (nextIndex <= index) throw new Error('next called multiple times')
    index = nextIndex
    const fn = layer.stack[nextIndex]
    if (!fn) return
    await fn(ctx, () => dispatch(nextIndex + 1))
  }
  await dispatch(0)
}

describe('local backup vault exports', () => {
  it('normalizes backup types safely', () => {
    expect(normalizeBackupType('documents')).toBe('documents')
    expect(normalizeBackupType('bad-input')).toBe('full-owner')
  })

  it('redacts sensitive keys recursively', () => {
    const redacted = redactSensitiveData({
      apiKey: 'live-secret',
      nested: { jwt_secret: 'jwt-secret', safe: 'visible' },
    })
    expect(redacted).toEqual({
      apiKey: '[REDACTED]',
      nested: { jwt_secret: '[REDACTED]', safe: 'visible' },
    })
  })

  it('generates a ZIP with manifest, restore guide, placeholders, and no browser token value', async () => {
    const archive = await buildBackupArchive({
      type: 'memory-chat',
      profile: 'default',
      browserState: {
        exportedAt: '2026-05-30T00:00:00.000Z',
        localStorage: {
          'hermes.rawMaterialSourcing.v1': [],
          hermes_api_key: 'should-not-leak',
        },
        excludedKeys: ['hermes_api_key'],
        notes: ['test browser state'],
      },
    })

    expect(archive.filename).toContain('hermes-memory-chat-default-')
    expect(archive.buffer.subarray(0, 2).toString()).toBe('PK')
    const zipText = archive.buffer.toString('utf8')
    expect(zipText).toContain('00_manifest/backup-manifest.json')
    expect(zipText).toContain('00_manifest/restore-instructions.md')
    expect(zipText).toContain('04_chat_sessions/important-sessions/README.md')
    expect(zipText).toContain('not available / not connected')
    expect(zipText).not.toContain('should-not-leak')
  })

  it('updates scheduled backup metadata without creating a runner secretly', async () => {
    const schedule = await saveBackupSchedule({ enabled: true, type: 'documents' })

    expect(schedule.enabled).toBe(true)
    expect(schedule.type).toBe('documents')
    expect(schedule.schedule).toBe('0 9,21 * * *')
    expect(schedule.note).toContain('metadata only')
  })

  it('can create a server-side snapshot archive and checksum', async () => {
    const snapshot = await createBackupSnapshot({ type: 'memory-chat', profile: 'default' })

    expect(snapshot.file).toContain('hermes-memory-chat-default-')
    expect(snapshot.checksumFile).toContain('.sha256')
    expect(snapshot.size).toBeGreaterThan(100)
    expect(snapshot.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('backup export endpoint returns a ZIP archive', async () => {
    const { backupRoutes } = await import('../../packages/server/src/routes/hermes/backup')
    const layer = backupRoutes.stack.find((entry: any) => entry.path === '/api/hermes/backup/export' && entry.methods.includes('GET'))
    const headers: Record<string, string> = {}
    const ctx: any = {
      method: 'GET',
      path: '/api/hermes/backup/export',
      query: { type: 'memory-chat' },
      state: { user: { id: 1, username: 'owner', role: 'super_admin' }, profile: { name: 'default' } },
      set: vi.fn((key: string, value: string) => { headers[key.toLowerCase()] = value }),
      get: vi.fn(() => ''),
      ip: '127.0.0.1',
      body: null,
      status: 200,
    }

    await runRouteLayer(layer, ctx)

    expect(headers['content-type']).toBe('application/zip')
    expect(headers['content-disposition']).toContain('hermes-memory-chat-default-')
    expect(Buffer.isBuffer(ctx.body)).toBe(true)
    expect((ctx.body as Buffer).subarray(0, 2).toString()).toBe('PK')
  })

  it('ships a local rsync pull script without executing it', () => {
    const scriptPath = resolve(process.cwd(), 'scripts/pull-hermes-backup-to-local.sh')
    expect(existsSync(scriptPath)).toBe(true)
    expect(statSync(scriptPath).mode & 0o111).toBeTruthy()
  })
})
