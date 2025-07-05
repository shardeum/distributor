export const mockDatabase = {
  run: jest.fn((query: string, params: any[], callback: (err: Error | null) => void) => {
    callback(null)
  }),
  get: jest.fn((query: string, params: any[], callback: (err: Error | null, row?: any) => void) => {
    callback(null, {})
  }),
  all: jest.fn((query: string, params: any[], callback: (err: Error | null, rows?: any[]) => void) => {
    callback(null, [])
  }),
  prepare: jest.fn(() => ({
    run: jest.fn((params: any[], callback: (err: Error | null) => void) => {
      callback(null)
    }),
    finalize: jest.fn(),
  })),
  close: jest.fn((callback: (err: Error | null) => void) => {
    callback(null)
  }),
}

export const createMockSqlite3 = () => ({
  Database: jest.fn().mockImplementation(() => mockDatabase),
  verbose: jest.fn(),
})