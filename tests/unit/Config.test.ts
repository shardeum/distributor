import { config, overrideDefaultConfig, distributorMode, SubscriptionType } from '../../src/Config'
import { readFileSync } from 'fs'
import * as Logger from '../../src/Logger'

jest.mock('fs')
jest.mock('../../src/Logger', () => ({
  mainLogger: {
    error: jest.fn(),
  },
}))

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>

describe('Config', () => {
  let originalConfig: any

  beforeEach(() => {
    jest.clearAllMocks()
    // Store original config
    originalConfig = { ...config }
  })

  afterEach(() => {
    // Restore original config
    Object.keys(config).forEach(key => {
      ;(config as any)[key] = originalConfig[key]
    })
  })

  describe('default config', () => {
    it('should have all required properties with default values', () => {
      expect(config.DISTRIBUTOR_IP).toBe('localhost')
      expect(config.DISTRIBUTOR_PORT).toBe(6100)
      expect(config.DISTRIBUTOR_HASH_KEY).toBe('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
      expect(config.ARCHIVER_DB_DIR).toBe('archiverdb.sqlite3')
      expect(config.RATE_LIMIT).toBe(100)
      expect(config.NUMBER_OF_WORKERS).toBe(5)
      expect(config.MAX_CLIENTS_PER_CHILD).toBe(2)
      expect(config.VERBOSE).toBe(false)
      expect(config.limitToSubscribersOnly).toBe(false)
      expect(config.subscribers).toEqual([])
    })

    it('should have proper ARCHIVER_DATA structure', () => {
      expect(config.ARCHIVER_DATA).toEqual({
        cycleDB: 'cycles.sqlite3',
        accountDB: 'accounts.sqlite3',
        transactionDB: 'transactions.sqlite3',
        receiptDB: 'receipts.sqlite3',
        originalTxDataDB: 'originalTxsData.sqlite3',
      })
    })

    it('should use environment variable for DISTRIBUTOR_PUBLIC_KEY if set', () => {
      const originalEnv = process.env.DISTRIBUTOR_PUBLIC_KEY
      process.env.DISTRIBUTOR_PUBLIC_KEY = 'test-public-key'
      
      // Re-import to get fresh config
      jest.resetModules()
      const { config: freshConfig } = require('../../src/Config')
      
      expect(freshConfig.DISTRIBUTOR_PUBLIC_KEY).toBe('test-public-key')
      
      // Restore
      if (originalEnv) {
        process.env.DISTRIBUTOR_PUBLIC_KEY = originalEnv
      } else {
        delete process.env.DISTRIBUTOR_PUBLIC_KEY
      }
    })
  })

  describe('enums', () => {
    it('should have correct distributor modes', () => {
      expect(distributorMode.WS).toBe('WS')
      expect(distributorMode.MQ).toBe('MQ')
    })

    it('should have correct subscription types', () => {
      expect(SubscriptionType.FIREHOSE).toBe('FIREHOSE')
      expect(SubscriptionType.ACCOUNTS).toBe('ACCOUNTS')
    })
  })

  describe('overrideDefaultConfig', () => {
    describe('file override', () => {
      it('should override config from valid JSON file', () => {
        const fileConfig = {
          DISTRIBUTOR_PORT: 7000,
          VERBOSE: true,
          RATE_LIMIT: 200,
        }
        mockReadFileSync.mockReturnValue(JSON.stringify(fileConfig))

        overrideDefaultConfig('config.json', {}, [])

        expect(config.DISTRIBUTOR_PORT).toBe(7000)
        expect(config.VERBOSE).toBe(true)
        expect(config.RATE_LIMIT).toBe(200)
      })

      it('should handle array merge properly', () => {
        const fileConfig = {
          subscribers: [
            { publicKey: 'key1', expirationTimestamp: 123, subscriptionType: 'FIREHOSE' }
          ],
        }
        mockReadFileSync.mockReturnValue(JSON.stringify(fileConfig))

        overrideDefaultConfig('config.json', {}, [])

        expect(config.subscribers).toEqual(fileConfig.subscribers)
      })

      it('should handle file not found error silently', () => {
        const error = new Error('File not found') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        mockReadFileSync.mockImplementation(() => {
          throw error
        })

        expect(() => overrideDefaultConfig('config.json', {}, [])).not.toThrow()
      })

      it('should warn on other file errors', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
        const error = new Error('Parse error')
        mockReadFileSync.mockImplementation(() => {
          throw error
        })

        overrideDefaultConfig('config.json', {}, [])

        expect(consoleSpy).toHaveBeenCalledWith('Failed to parse config file:', error)
        consoleSpy.mockRestore()
      })

      it('should handle invalid JSON gracefully', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
        mockReadFileSync.mockReturnValue('invalid json')

        overrideDefaultConfig('config.json', {}, [])

        expect(consoleSpy).toHaveBeenCalled()
        consoleSpy.mockRestore()
      })
    })

    describe('environment variable override', () => {
      it('should override number values from env vars', () => {
        const env = {
          DISTRIBUTOR_PORT: '8000',
          RATE_LIMIT: '500',
          NUMBER_OF_WORKERS: '10',
        }
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        overrideDefaultConfig('config.json', env, [])

        expect(config.DISTRIBUTOR_PORT).toBe(8000)
        expect(config.RATE_LIMIT).toBe(500)
        expect(config.NUMBER_OF_WORKERS).toBe(10)
      })

      it('should override string values from env vars', () => {
        const env = {
          DISTRIBUTOR_IP: '192.168.1.1',
          DISTRIBUTOR_HASH_KEY: 'new-hash-key',
          DISTRIBUTOR_LOGS: 'new-logs-dir',
        }
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        overrideDefaultConfig('config.json', env, [])

        expect(config.DISTRIBUTOR_IP).toBe('192.168.1.1')
        expect(config.DISTRIBUTOR_HASH_KEY).toBe('new-hash-key')
        expect(config.DISTRIBUTOR_LOGS).toBe('new-logs-dir')
      })

      it('should override boolean values from env vars', () => {
        const env = {
          VERBOSE: 'true',
          limitToSubscribersOnly: 'TRUE',
        }
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        overrideDefaultConfig('config.json', env, [])

        expect(config.VERBOSE).toBe(true)
        expect(config.limitToSubscribersOnly).toBe(true)
      })

      it('should handle false boolean values from env vars', () => {
        const env = {
          VERBOSE: 'false',
          limitToSubscribersOnly: 'FALSE',
        }
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        overrideDefaultConfig('config.json', env, [])

        expect(config.VERBOSE).toBe(false)
        expect(config.limitToSubscribersOnly).toBe(false)
      })

      it('should override object values from env vars', () => {
        const archiverData = {
          cycleDB: 'custom-cycles.db',
          accountDB: 'custom-accounts.db',
        }
        const env = {
          ARCHIVER_DATA: JSON.stringify(archiverData),
        }
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        overrideDefaultConfig('config.json', env, [])

        expect(config.ARCHIVER_DATA).toMatchObject(archiverData)
      })

      it('should handle invalid JSON in object env vars', () => {
        const env = {
          ARCHIVER_DATA: 'invalid json',
        }
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        overrideDefaultConfig('config.json', env, [])

        expect(Logger.mainLogger.error).toHaveBeenCalledTimes(2)
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Unable to JSON parse', 'invalid json')
      })
    })

    describe('CLI argument override', () => {
      it('should override number values from CLI args', () => {
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        const args = ['node', 'script.js', '--DISTRIBUTOR_PORT', '9000', '--RATE_LIMIT', '300']

        overrideDefaultConfig('config.json', {}, args)

        expect(config.DISTRIBUTOR_PORT).toBe(9000)
        expect(config.RATE_LIMIT).toBe(300)
      })

      it('should override string values from CLI args', () => {
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        const args = ['node', 'script.js', '--DISTRIBUTOR_IP', '10.0.0.1', '--distributorMode', 'MQ']

        overrideDefaultConfig('config.json', {}, args)

        expect(config.DISTRIBUTOR_IP).toBe('10.0.0.1')
        expect(config.distributorMode).toBe('MQ')
      })

      it('should override boolean values from CLI args', () => {
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        const args = ['node', 'script.js', '--VERBOSE', '--limitToSubscribersOnly', 'true']

        overrideDefaultConfig('config.json', {}, args)

        expect(config.VERBOSE).toBe(true)
        expect(config.limitToSubscribersOnly).toBe(true)
      })

      it('should handle string boolean values from CLI args', () => {
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error(), { code: 'ENOENT' })
        })

        const args = ['node', 'script.js', '--VERBOSE', 'false']

        overrideDefaultConfig('config.json', {}, args)

        expect(config.VERBOSE).toBe(false)
      })
    })

    describe('override precedence', () => {
      it('should apply overrides in correct order: file < env < cli', () => {
        // File config
        const fileConfig = {
          DISTRIBUTOR_PORT: 7000,
          RATE_LIMIT: 200,
          VERBOSE: true,
        }
        mockReadFileSync.mockReturnValue(JSON.stringify(fileConfig))

        // Env config
        const env = {
          DISTRIBUTOR_PORT: '8000',
          RATE_LIMIT: '300',
        }

        // CLI args (highest priority)
        const args = ['node', 'script.js', '--DISTRIBUTOR_PORT', '9000']

        overrideDefaultConfig('config.json', env, args)

        // CLI should win for DISTRIBUTOR_PORT
        expect(config.DISTRIBUTOR_PORT).toBe(9000)
        // Env should win for RATE_LIMIT (no CLI override)
        expect(config.RATE_LIMIT).toBe(300)
        // File should win for VERBOSE (no env or CLI override)
        expect(config.VERBOSE).toBe(true)
      })
    })
  })
})