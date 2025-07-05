import { sleep, validateTypes, isUndefined, isNumber } from '../../../src/utils/Utils'
import * as Logger from '../../../src/Logger'

jest.mock('../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
  },
}))

describe('Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('sleep', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should sleep for the specified time', async () => {
      const sleepTime = 1000
      const sleepPromise = sleep(sleepTime)

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('sleeping for', sleepTime)

      // The promise should not resolve immediately
      let resolved = false
      sleepPromise.then(() => { resolved = true })
      
      // Advance time partially - should not resolve yet
      jest.advanceTimersByTime(sleepTime - 1)
      expect(resolved).toBe(false)

      // Advance remaining time - should resolve
      jest.advanceTimersByTime(1)
      await sleepPromise
      expect(resolved).toBe(true)
    })

    it('should handle zero sleep time', async () => {
      const sleepTime = 0
      const sleepPromise = sleep(sleepTime)

      jest.advanceTimersByTime(sleepTime)

      await sleepPromise

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('sleeping for', sleepTime)
    })

    it('should handle negative sleep time', async () => {
      const sleepTime = -100
      const sleepPromise = sleep(sleepTime)

      // Negative values should be treated as 0 by setTimeout
      jest.advanceTimersByTime(0)

      await sleepPromise

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('sleeping for', sleepTime)
    })
  })

  describe('validateTypes', () => {
    describe('input validation', () => {
      it('should return error when input is undefined', () => {
        expect(validateTypes(undefined as any, {})).toBe('input is undefined')
      })

      it('should return error when input is null', () => {
        expect(validateTypes(null as any, {})).toBe('input is null')
      })

      it('should return error when input is not an object', () => {
        expect(validateTypes('string' as any, {})).toBe('input must be object, not string')
        expect(validateTypes(123 as any, {})).toBe('input must be object, not number')
        expect(validateTypes(true as any, {})).toBe('input must be object, not boolean')
      })
    })

    describe('type validation', () => {
      it('should validate string types', () => {
        const def = { name: 's', email: 's' }
        
        expect(validateTypes({ name: 'John', email: 'john@example.com' }, def)).toBe('')
        expect(validateTypes({ name: 'John' }, def)).toBe('email is required')
        expect(validateTypes({ name: 123, email: 'john@example.com' }, def)).toBe('name must be, string')
      })

      it('should validate number types', () => {
        const def = { age: 'n', score: 'n' }
        
        expect(validateTypes({ age: 25, score: 100 }, def)).toBe('')
        expect(validateTypes({ age: '25', score: 100 }, def)).toBe('age must be, number')
        expect(validateTypes({ age: 25 }, def)).toBe('score is required')
      })

      it('should validate boolean types', () => {
        const def = { isActive: 'b', isVerified: 'b' }
        
        expect(validateTypes({ isActive: true, isVerified: false }, def)).toBe('')
        expect(validateTypes({ isActive: 'true', isVerified: false }, def)).toBe('isActive must be, boolean')
      })

      it('should validate bigint types', () => {
        const def = { bigNumber: 'B' }
        
        expect(validateTypes({ bigNumber: BigInt(123) }, def)).toBe('')
        expect(validateTypes({ bigNumber: 123 }, def)).toBe('bigNumber must be, bigint')
      })

      it('should validate array types', () => {
        const def = { items: 'a', tags: 'a' }
        
        expect(validateTypes({ items: [1, 2, 3], tags: ['a', 'b'] }, def)).toBe('')
        expect(validateTypes({ items: 'not array', tags: [] }, def)).toBe('items must be, array')
        expect(validateTypes({ items: [] }, def)).toBe('tags is required')
      })

      it('should validate object types', () => {
        const def = { data: 'o', config: 'o' }
        
        expect(validateTypes({ data: {}, config: { key: 'value' } }, def)).toBe('')
        expect(validateTypes({ data: [], config: {} }, def)).toBe('data must be, object')
        expect(validateTypes({ data: {} }, def)).toBe('config is required')
      })
    })

    describe('optional fields', () => {
      it('should handle optional string fields', () => {
        const def = { name: 's', nickname: 's?' }
        
        expect(validateTypes({ name: 'John' }, def)).toBe('')
        expect(validateTypes({ name: 'John', nickname: 'Johnny' }, def)).toBe('')
        expect(validateTypes({ name: 'John', nickname: undefined }, def)).toBe('')
        expect(validateTypes({}, def)).toBe('name is required')
      })

      it('should handle optional number fields', () => {
        const def = { age: 'n?' }
        
        expect(validateTypes({}, def)).toBe('')
        expect(validateTypes({ age: 25 }, def)).toBe('')
        expect(validateTypes({ age: undefined }, def)).toBe('')
        expect(validateTypes({ age: '25' }, def)).toBe('age must be, number')
      })

      it('should handle required null check', () => {
        const def = { name: 's' }
        
        expect(validateTypes({ name: null }, def)).toBe('name cannot be null')
      })

      it('should not allow null for optional fields when present', () => {
        const def = { name: 's?' }
        
        expect(validateTypes({ name: null }, def)).toBe('name must be, string')
      })
    })

    describe('multiple type options', () => {
      it('should validate fields that can be multiple types', () => {
        const def = { value: 'sn', data: 'ao' }
        
        expect(validateTypes({ value: 'string', data: [] }, def)).toBe('')
        expect(validateTypes({ value: 123, data: {} }, def)).toBe('')
        expect(validateTypes({ value: true, data: {} }, def)).toBe('value must be, string, number')
        expect(validateTypes({ value: 'string', data: 'invalid' }, def)).toBe('data must be, array, object')
      })

      it('should validate optional fields with multiple types', () => {
        const def = { value: 'sn?' }
        
        expect(validateTypes({}, def)).toBe('')
        expect(validateTypes({ value: 'string' }, def)).toBe('')
        expect(validateTypes({ value: 123 }, def)).toBe('')
        expect(validateTypes({ value: undefined }, def)).toBe('')
        expect(validateTypes({ value: true }, def)).toBe('value must be, string, number')
      })
    })
  })

  describe('isUndefined', () => {
    it('should return true for undefined', () => {
      expect(isUndefined(undefined)).toBe(true)
      expect(isUndefined(void 0)).toBe(true)
    })

    it('should return false for defined values', () => {
      expect(isUndefined(null)).toBe(false)
      expect(isUndefined('')).toBe(false)
      expect(isUndefined(0)).toBe(false)
      expect(isUndefined(false)).toBe(false)
      expect(isUndefined([])).toBe(false)
      expect(isUndefined({})).toBe(false)
      expect(isUndefined(NaN)).toBe(false)
    })
  })

  describe('isNumber', () => {
    it('should return true for valid numbers', () => {
      expect(isNumber(0)).toBe(true)
      expect(isNumber(123)).toBe(true)
      expect(isNumber(-456)).toBe(true)
      expect(isNumber(3.14)).toBe(true)
      expect(isNumber(Number.MAX_VALUE)).toBe(true)
      expect(isNumber(Number.MIN_VALUE)).toBe(true)
      expect(isNumber(Infinity)).toBe(true)
      expect(isNumber(-Infinity)).toBe(true)
    })

    it('should return false for NaN', () => {
      expect(isNumber(NaN)).toBe(false)
      expect(isNumber(Number('not a number'))).toBe(false)
    })

    it('should return false for non-numbers', () => {
      expect(isNumber('123')).toBe(false)
      expect(isNumber(true)).toBe(false)
      expect(isNumber(false)).toBe(false)
      expect(isNumber(null)).toBe(false)
      expect(isNumber(undefined)).toBe(false)
      expect(isNumber([])).toBe(false)
      expect(isNumber({})).toBe(false)
      expect(isNumber(() => {})).toBe(false)
    })
  })
})