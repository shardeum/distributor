import Logger, { initLogger, startSaving, mainLogger, fatalLogger, errorLogger, LogsConfiguration } from '../../src/Logger'
import * as log4js from 'log4js'
import * as fs from 'fs'
import { PassThrough } from 'stream'
import { RollingFileStream } from 'streamroller'
import * as log4jsExtend from 'log4js-extend'

jest.mock('fs')
jest.mock('log4js')
jest.mock('log4js-extend')
jest.mock('streamroller')

const mockFs = fs as jest.Mocked<typeof fs>
const mockLog4js = log4js as jest.Mocked<typeof log4js>
const mockLog4jsExtend = log4jsExtend as jest.MockedFunction<typeof log4jsExtend>

describe('Logger', () => {
  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockFs.existsSync.mockReturnValue(false)
    mockFs.mkdirSync.mockImplementation(() => undefined)
    mockLog4js.configure.mockReturnValue({} as any)
    mockLog4js.getLogger.mockReturnValue(mockLogger as any)
  })

  describe('constructor and configuration', () => {
    it('should initialize with valid config', () => {
      const config: LogsConfiguration = {
        dir: 'logs',
        files: {
          main: 'main.log',
          fatal: 'fatal.log',
        },
        options: {
          appenders: {
            main: { type: 'file' },
            fatal: { type: 'file' },
          },
        },
      }

      const logger = new Logger('/base', config)

      expect(logger.baseDir).toBe('/base')
      expect(logger.config).toBe(config)
      expect(mockLog4jsExtend).toHaveBeenCalledWith(log4js)
    })

    it('should throw error when config.dir is not defined', () => {
      const config: LogsConfiguration = {
        files: { main: 'main.log' },
      }

      expect(() => new Logger('/base', config)).toThrow('Fatal Error: Log directory not defined.')
    })

    it('should throw error when config.files is not provided', () => {
      const config: LogsConfiguration = {
        dir: 'logs',
      }

      expect(() => new Logger('/base', config)).toThrow('Fatal Error: Valid log file locations not provided.')
    })

    it('should throw error when config.files is not an object', () => {
      const config: LogsConfiguration = {
        dir: 'logs',
        files: 'invalid' as any,
      }

      expect(() => new Logger('/base', config)).toThrow('Fatal Error: Valid log file locations not provided.')
    })

    it('should throw error when baseDir is not provided', () => {
      const config: LogsConfiguration = {
        dir: 'logs',
        files: { main: 'main.log' },
      }

      expect(() => new Logger('', config)).toThrow('Fatal Error: Base directory not defined.')
    })

    it('should throw error when config is not provided', () => {
      expect(() => new Logger('/base', null as any)).toThrow('Fatal Error: No configuration provided.')
    })
  })

  describe('directory creation', () => {
    it('should create log directories if they do not exist', () => {
      mockFs.existsSync.mockReturnValue(false)

      const config: LogsConfiguration = {
        dir: 'logs/distributor',
        files: { main: 'main.log' },
        options: { appenders: {} },
      }

      new Logger('/base', config)

      expect(mockFs.mkdirSync).toHaveBeenCalledTimes(2)
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/base/logs')
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/base/logs/distributor')
    })

    it('should not create directories if they already exist', () => {
      mockFs.existsSync.mockReturnValue(true)

      const config: LogsConfiguration = {
        dir: 'logs',
        files: { main: 'main.log' },
        options: { appenders: {} },
      }

      new Logger('/base', config)

      expect(mockFs.mkdirSync).not.toHaveBeenCalled()
    })
  })

  describe('log configuration', () => {
    it('should add filenames to file appenders', () => {
      const config: LogsConfiguration = {
        dir: 'logs',
        files: { main: 'main.log' },
        options: {
          appenders: {
            main: { type: 'file' },
            out: { type: 'console' },
            fatal: { type: 'file' },
          },
        },
      }

      new Logger('/base', config)

      const configureCall = mockLog4js.configure.mock.calls[0][0] as any
      expect(configureCall.appenders.main.filename).toBe('/base/logs/main.log')
      expect(configureCall.appenders.fatal.filename).toBe('/base/logs/fatal.log')
      expect(configureCall.appenders.out.filename).toBeUndefined()
    })

    it('should configure log4js with provided options', () => {
      const options = {
        appenders: {
          main: { type: 'file', maxLogSize: 10000, backups: 3 },
        },
        categories: {
          default: { appenders: ['main'], level: 'info' },
        },
      }

      const config: LogsConfiguration = {
        dir: 'logs',
        files: { main: 'main.log' },
        options,
      }

      new Logger('/base', config)

      expect(mockLog4js.configure).toHaveBeenCalled()
      const configureCall = mockLog4js.configure.mock.calls[0][0] as any
      expect(configureCall.appenders.main.maxLogSize).toBe(10000)
      expect(configureCall.appenders.main.backups).toBe(3)
    })
  })

  describe('getLogger', () => {
    it('should return logger for specified category', () => {
      const config: LogsConfiguration = {
        dir: 'logs',
        files: { main: 'main.log' },
        options: { appenders: {} },
      }

      const logger = new Logger('/base', config)
      const result = logger.getLogger('test')

      expect(mockLog4js.getLogger).toHaveBeenCalledWith('test')
      expect(result).toBe(mockLogger)
    })
  })

  describe('shutdown', () => {
    it('should shutdown log4js and return promise', async () => {
      mockLog4js.shutdown.mockImplementation((cb: () => void) => {
        cb()
      })

      const config: LogsConfiguration = {
        dir: 'logs',
        files: { main: 'main.log' },
        options: { appenders: {} },
      }

      const logger = new Logger('/base', config)
      const result = await logger.shutdown()

      expect(mockLog4js.shutdown).toHaveBeenCalled()
      expect(result).toBe('done')
    })
  })
})

describe('initLogger', () => {
  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockFs.existsSync.mockReturnValue(true)
    mockLog4js.configure.mockReturnValue({} as any)
    mockLog4js.getLogger.mockReturnValue(mockLogger as any)
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('should initialize all loggers', () => {
    const config: LogsConfiguration = {
      dir: 'logs',
      files: { main: 'main.log' },
      options: { appenders: {} },
    }

    initLogger('/base', config)

    expect(mockLog4js.getLogger).toHaveBeenCalledWith('main')
    expect(mockLog4js.getLogger).toHaveBeenCalledWith('fatal')
    expect(mockLog4js.getLogger).toHaveBeenCalledWith('errorFile')
    expect(mainLogger).toBe(mockLogger)
    expect(fatalLogger).toBe(mockLogger)
    expect(errorLogger).toBe(mockLogger)
  })
})

describe('startSaving', () => {
  let mockStream: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockStream = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      emit: jest.fn(),
      pipe: jest.fn(),
      unpipe: jest.fn(),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
      setMaxListeners: jest.fn(),
      getMaxListeners: jest.fn(() => 10),
      listeners: jest.fn(() => []),
      rawListeners: jest.fn(() => []),
      listenerCount: jest.fn(() => 0),
      prependListener: jest.fn(),
      prependOnceListener: jest.fn(),
      eventNames: jest.fn(() => []),
    } as any
    ;(RollingFileStream as any).mockImplementation(() => mockStream)
  })

  it('should create rolling file stream with correct parameters', () => {
    startSaving('/logs')

    expect(RollingFileStream).toHaveBeenCalledWith('/logs/out.log', 10000000, 10)
  })

  it('should pipe stdout and stderr to file stream', () => {
    const originalStdout = process.stdout
    const originalStderr = process.stderr
    const originalConsole = console

    const mockStdoutPipe = jest.spyOn(PassThrough.prototype, 'pipe')

    try {
      startSaving('/logs')

      // Check that PassThrough pipes to both original streams and file stream
      expect(mockStdoutPipe).toHaveBeenCalledWith(originalStdout)
      expect(mockStdoutPipe).toHaveBeenCalledWith(originalStderr)
      expect(mockStdoutPipe).toHaveBeenCalledWith(mockStream)

      // Check that console was replaced
      expect(console).not.toBe(originalConsole)
    } finally {
      // Restore original console
      console = originalConsole // eslint-disable-line no-global-assign
      mockStdoutPipe.mockRestore()
    }
  })
})