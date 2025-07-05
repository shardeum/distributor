export const createMockSocket = () => ({
  id: 'mock-socket-id',
  emit: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn(),
  handshake: {
    auth: {},
  },
  data: {},
})

export const createMockSocketServer = () => ({
  on: jest.fn(),
  emit: jest.fn(),
  to: jest.fn(() => ({
    emit: jest.fn(),
  })),
  sockets: {
    sockets: new Map(),
  },
  use: jest.fn(),
  listen: jest.fn(),
  close: jest.fn(),
})

export const createMockSocketClient = () => ({
  connect: jest.fn(() => createMockSocket()),
  on: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
  connected: true,
})