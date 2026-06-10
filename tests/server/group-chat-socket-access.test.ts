import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  authenticateUserToken: vi.fn(),
  isAuthEnabled: vi.fn(),
}))

vi.mock('../../packages/server/src/middleware/user-auth', () => ({
  authenticateUserToken: authMocks.authenticateUserToken,
  isAuthEnabled: authMocks.isAuthEnabled,
}))

import { GROUP_CHAT_AGENT_SOCKET_SECRET } from '../../packages/server/src/services/hermes/group-chat/agent-clients'
import { GroupChatServer } from '../../packages/server/src/services/hermes/group-chat'

function createSocket(auth: Record<string, unknown> = {}) {
  return {
    id: 'socket-1',
    handshake: { auth, query: {} },
    data: {},
  } as any
}

describe('group-chat socket access control', () => {
  beforeEach(() => {
    authMocks.authenticateUserToken.mockReset()
    authMocks.isAuthEnabled.mockReset()
    authMocks.isAuthEnabled.mockResolvedValue(true)
  })

  it('allows internal agent sockets through the dedicated secret path', async () => {
    const server = Object.create(GroupChatServer.prototype) as any
    const socket = createSocket({ source: 'agent', agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET })
    const next = vi.fn()

    await server.authMiddleware(socket, next)

    expect(next).toHaveBeenCalledWith()
    expect(authMocks.authenticateUserToken).not.toHaveBeenCalled()
  })

  it('rejects non-owner human sockets before room history can be joined', async () => {
    const server = Object.create(GroupChatServer.prototype) as any
    const socket = createSocket({ token: 'employee-token' })
    const next = vi.fn()
    authMocks.authenticateUserToken.mockResolvedValue({
      id: 7,
      username: 'employee',
      role: 'employee',
      profiles: ['default'],
    })

    await server.authMiddleware(socket, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(next.mock.calls[0][0].message).toBe('Forbidden')
    expect(socket.data.authenticatedUser).toBeUndefined()
  })

  it('allows owner human sockets and stores the authenticated user on the socket', async () => {
    const server = Object.create(GroupChatServer.prototype) as any
    const socket = createSocket({ token: 'owner-token' })
    const next = vi.fn()
    const owner = {
      id: 1,
      username: 'owner',
      role: 'super_admin',
    }
    authMocks.authenticateUserToken.mockResolvedValue(owner)

    await server.authMiddleware(socket, next)

    expect(next).toHaveBeenCalledWith()
    expect(socket.data.authenticatedUser).toBe(owner)
  })
})
