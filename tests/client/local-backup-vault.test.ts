// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchBackupStatusMock = vi.hoisted(() => vi.fn())
const downloadBackupArchiveMock = vi.hoisted(() => vi.fn())
const createBackupSnapshotMock = vi.hoisted(() => vi.fn())
const saveBackupScheduleMock = vi.hoisted(() => vi.fn())

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
  NAlert: { template: '<div class="n-alert"><slot /></div>' },
  NButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
  NSwitch: { props: ['value'], template: '<button class="n-switch" @click="$emit(\'update:value\', !value)"><slot /></button>' },
  NTag: { template: '<span class="n-tag"><slot /></span>' },
}))

vi.mock('@/api/hermes/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hermes/backup')>()
  return {
    ...actual,
    fetchBackupStatus: fetchBackupStatusMock,
    downloadBackupArchive: downloadBackupArchiveMock,
    createBackupSnapshot: createBackupSnapshotMock,
    saveBackupSchedule: saveBackupScheduleMock,
  }
})

import { collectBackupBrowserState } from '@/api/hermes/backup'
import LocalBackupVaultView from '@/views/hermes/LocalBackupVaultView.vue'

describe('Local Backup Vault client behavior', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchBackupStatusMock.mockResolvedValue({
      backupDir: '/tmp/hermes-backups',
      lastBackup: null,
      backups: [],
      schedule: {
        enabled: false,
        schedule: '0 9,21 * * *',
        scheduleDisplay: '09:00 and 21:00 local time',
        keepLast: 7,
        type: 'full-owner',
        lastUpdatedAt: null,
        note: 'metadata only',
      },
    })
    downloadBackupArchiveMock.mockResolvedValue('hermes-full-owner-default.zip')
    createBackupSnapshotMock.mockResolvedValue({ ok: true, snapshot: { file: '/tmp/hermes.zip', checksumFile: '/tmp/hermes.zip.sha256', size: 1024, sha256: 'a'.repeat(64) } })
    saveBackupScheduleMock.mockResolvedValue({
      ok: true,
      schedule: {
        enabled: true,
        schedule: '0 9,21 * * *',
        scheduleDisplay: '09:00 and 21:00 local time',
        keepLast: 7,
        type: 'full-owner',
        lastUpdatedAt: '2026-05-30T00:00:00.000Z',
        note: 'metadata only',
      },
    })
  })

  it('exports allowlisted browser workspace state while excluding auth tokens', () => {
    localStorage.setItem('hermes.rawMaterialSourcing.v1', JSON.stringify([{ name: 'TEA' }]))
    localStorage.setItem('hermes.investmentCalculator.scenarios.v1', JSON.stringify([{ scenarioName: 'Base' }]))
    localStorage.setItem('hermes_api_key', 'live-token')
    localStorage.setItem('random-key', 'ignore me')

    const state = collectBackupBrowserState()

    expect(state.localStorage['hermes.rawMaterialSourcing.v1']).toEqual([{ name: 'TEA' }])
    expect(state.localStorage['hermes.investmentCalculator.scenarios.v1']).toEqual([{ scenarioName: 'Base' }])
    expect(state.localStorage).not.toHaveProperty('hermes_api_key')
    expect(state.localStorage).not.toHaveProperty('random-key')
    expect(state.excludedKeys).toContain('hermes_api_key')
  })

  it('renders all backup download actions and calls the archive downloader', async () => {
    const wrapper = mount(LocalBackupVaultView)
    await flushPromises()

    expect(wrapper.text()).toContain('Local Backup Vault')
    expect(wrapper.text()).toContain('Full Owner Backup ZIP')
    expect(wrapper.text()).toContain('Business Workspace Backup ZIP')
    expect(wrapper.text()).toContain('Investor Approved Backup ZIP')
    expect(wrapper.text()).toContain('Code Snapshot Backup')
    expect(wrapper.text()).toContain('Memory + Chat Summaries Backup')
    expect(wrapper.text()).toContain('Documents Backup')

    const firstDownload = wrapper.findAll('button').find(button => button.text().includes('Download ZIP'))
    expect(firstDownload).toBeTruthy()
    await firstDownload!.trigger('click')

    expect(downloadBackupArchiveMock).toHaveBeenCalledWith('full-owner', true)
  })
})
