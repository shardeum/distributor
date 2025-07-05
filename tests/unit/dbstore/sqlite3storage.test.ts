import { readFromDB, close, run, get, all, extractValues, extractValuesFromArray } from '../../../src/dbstore/sqlite3storage'
import { Database } from 'sqlite3'
import { SerializeToJsonString } from '../../../src/utils/serialization'

jest.mock('sqlite3')
jest.mock('../../../src/utils/serialization')

const mockSerializeToJsonString = SerializeToJsonString as jest.MockedFunction<typeof SerializeToJsonString>

describe('sqlite3storage', () => {
  let mockDatabase: any
  let consoleSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'error').mockImplementation()

    mockDatabase = {
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
      close: jest.fn(),
    } as any

    ;(Database as any).mockImplementation((path: string, callback: any) => {
      callback(null)
      return mockDatabase
    })

    mockSerializeToJsonString.mockImplementation((obj) => {
      if (obj === null) return null
      return JSON.stringify(obj)
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('readFromDB', () => {
    it('should successfully open database and set WAL mode', async () => {
      mockDatabase.run.mockImplementation((sql: any, params: any, callback: any) => {
        if (typeof params === 'function') {
          params.call({ lastID: 1 }, null)
        } else {
          callback.call({ lastID: 1 }, null)
        }
      })

      const result = await readFromDB('/path/to/db', 'testDB')

      expect(Database).toHaveBeenCalledWith('/path/to/db', expect.any(Function))
      expect(mockDatabase.run).toHaveBeenCalledWith('PRAGMA journal_mode=WAL', expect.any(Array), expect.any(Function))
      expect(result).toBe(mockDatabase)
      expect(consoleSpy).toHaveBeenCalledWith('Read From DB -> dbName: ', 'testDB', 'dbPath: ', '/path/to/db')
      expect(consoleSpy).toHaveBeenCalledWith('✅ Database: testDB initialized.')
    })

    it('should throw error when database fails to open', async () => {
      const dbError = new Error('Database connection failed')
      ;(Database as any).mockImplementation((path: string, callback: any) => {
        callback(dbError)
        return mockDatabase
      })

      await expect(readFromDB('/path/to/db', 'testDB')).rejects.toThrow(dbError)
      expect(consoleSpy).toHaveBeenCalledWith('❌ Error opening database:', dbError)
    })
  })

  describe('close', () => {
    it('should successfully close database connection', async () => {
      mockDatabase.close.mockImplementation((callback: any) => {
        callback(null)
      })

      await close(mockDatabase, 'testDB')

      expect(mockDatabase.close).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith('Terminating testDB Database/Indexer Connections...')
      expect(consoleSpy).toHaveBeenCalledWith('testDB Database connection closed.')
    })

    it('should handle close error gracefully', async () => {
      const closeError = new Error('Close failed')
      mockDatabase.close.mockImplementation((callback: any) => {
        callback(closeError)
      })

      await close(mockDatabase, 'testDB')

      expect(console.error).toHaveBeenCalledWith('Error closing testDB Database Connection.')
      expect(console.error).toHaveBeenCalledWith('Error thrown in testDB db close() function: ')
      expect(console.error).toHaveBeenCalledWith(closeError)
    })
  })

  describe('run', () => {
    it('should execute SQL and return lastID', async () => {
      mockDatabase.run.mockImplementation((sql: any, params: any, callback: any) => {
        callback.call({ lastID: 123 }, null)
      })

      const result = await run(mockDatabase, 'INSERT INTO test VALUES (?)', ['value'])

      expect(mockDatabase.run).toHaveBeenCalledWith('INSERT INTO test VALUES (?)', ['value'], expect.any(Function))
      expect(result).toEqual({ id: 123 })
    })

    it('should handle empty params', async () => {
      mockDatabase.run.mockImplementation((sql: any, params: any, callback: any) => {
        callback.call({ lastID: 456 }, null)
      })

      const result = await run(mockDatabase, 'CREATE TABLE test')

      expect(mockDatabase.run).toHaveBeenCalledWith('CREATE TABLE test', expect.any(Array), expect.any(Function))
      expect(result).toEqual({ id: 456 })
    })

    it('should reject on error', async () => {
      const sqlError = new Error('SQL execution failed')
      mockDatabase.run.mockImplementation((sql: any, params: any, callback: any) => {
        callback(sqlError)
      })

      await expect(run(mockDatabase, 'INVALID SQL')).rejects.toThrow(sqlError)
      expect(consoleSpy).toHaveBeenCalledWith('Error running sql INVALID SQL')
      expect(consoleSpy).toHaveBeenCalledWith(sqlError)
    })
  })

  describe('get', () => {
    it('should fetch single row successfully', async () => {
      const mockRow = { id: 1, name: 'test' }
      mockDatabase.get.mockImplementation((sql: any, params: any, callback: any) => {
        callback(null, mockRow)
      })

      const result = await get(mockDatabase, 'SELECT * FROM test WHERE id = ?', [1])

      expect(mockDatabase.get).toHaveBeenCalledWith('SELECT * FROM test WHERE id = ?', [1], expect.any(Function))
      expect(result).toEqual(mockRow)
    })

    it('should reject on error', async () => {
      const sqlError = new Error('Query failed')
      mockDatabase.get.mockImplementation((sql: any, params: any, callback: any) => {
        callback(sqlError, null)
      })

      await expect(get(mockDatabase, 'SELECT * FROM invalid')).rejects.toThrow(sqlError)
      expect(consoleSpy).toHaveBeenCalledWith('Error running sql: SELECT * FROM invalid')
      expect(consoleSpy).toHaveBeenCalledWith(sqlError)
    })
  })

  describe('all', () => {
    it('should fetch all rows successfully', async () => {
      const mockRows = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ]
      mockDatabase.all.mockImplementation((sql: any, params: any, callback: any) => {
        callback(null, mockRows)
      })

      const result = await all(mockDatabase, 'SELECT * FROM test')

      expect(mockDatabase.all).toHaveBeenCalledWith('SELECT * FROM test', [], expect.any(Function))
      expect(result).toEqual(mockRows)
    })

    it('should reject on error', async () => {
      const sqlError = new Error('Query failed')
      mockDatabase.all.mockImplementation((sql: any, params: any, callback: any) => {
        callback(sqlError, null)
      })

      await expect(all(mockDatabase, 'SELECT * FROM invalid')).rejects.toThrow(sqlError)
      expect(consoleSpy).toHaveBeenCalledWith('Error running sql: SELECT * FROM invalid')
      expect(consoleSpy).toHaveBeenCalledWith(sqlError)
    })
  })

  describe('extractValues', () => {
    it('should extract values from simple object', () => {
      const obj = { id: 1, name: 'test', active: true, optional: null }
      
      const result = extractValues(obj)

      expect(result).toEqual([1, 'test', true, null])
    })

    it('should serialize nested objects', () => {
      const obj = { 
        id: 1, 
        data: { nested: 'value' },
        array: [1, 2, 3],
      }
      
      const result = extractValues(obj)

      expect(mockSerializeToJsonString).toHaveBeenCalledWith({ nested: 'value' })
      expect(mockSerializeToJsonString).toHaveBeenCalledWith([1, 2, 3])
      expect(result).toEqual([1, '{"nested":"value"}', '[1,2,3]'])
    })

    it('should handle errors gracefully', () => {
      const obj = {} as any
      Object.defineProperty(obj, 'errorProp', {
        get() {
          throw new Error('Property access error')
        },
        enumerable: true,
      })

      const result = extractValues(obj)

      expect(result).toBeUndefined()
      expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('extractValuesFromArray', () => {
    it('should extract values from array of objects', () => {
      const arr = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ] as any[]
      
      const result = extractValuesFromArray(arr)

      expect(result).toEqual([1, 'test1', 2, 'test2'])
    })

    it('should serialize nested objects in array', () => {
      const arr = [
        { id: 1, data: { value: 'nested' } },
        { id: 2, data: { value: 'nested2' } },
      ] as any[]
      
      const result = extractValuesFromArray(arr)

      expect(mockSerializeToJsonString).toHaveBeenCalledTimes(2)
      expect(result).toEqual([1, '{"value":"nested"}', 2, '{"value":"nested2"}'])
    })

    it('should handle empty array', () => {
      const result = extractValuesFromArray([])

      expect(result).toEqual([])
    })

    it('should handle errors gracefully', () => {
      const arr = [{}] as any
      Object.defineProperty(arr[0], 'errorProp', {
        get() {
          throw new Error('Property access error')
        },
        enumerable: true,
      })

      const result = extractValuesFromArray(arr)

      expect(result).toBeUndefined()
      expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error))
    })
  })
})