import { Stats } from 'fs'

export const mockStats: Partial<Stats> = {
  isFile: jest.fn(() => true),
  isDirectory: jest.fn(() => false),
  size: 1024,
  mtime: new Date(),
}

export const createMockFs = () => ({
  readFileSync: jest.fn(() => '{}'),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  statSync: jest.fn(() => mockStats),
  readdirSync: jest.fn(() => []),
  createReadStream: jest.fn(() => ({
    on: jest.fn(),
    pipe: jest.fn(),
    close: jest.fn(),
  })),
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
  promises: {
    readFile: jest.fn(() => Promise.resolve(Buffer.from('{}'))),
    writeFile: jest.fn(() => Promise.resolve()),
    stat: jest.fn(() => Promise.resolve(mockStats)),
    mkdir: jest.fn(() => Promise.resolve()),
  },
})