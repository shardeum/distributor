import { SerializeToJsonString, DeSerializeFromJsonString } from '../../../src/utils/serialization'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'

jest.mock('@shardeum-foundation/lib-types')

const mockStringUtils = StringUtils as jest.Mocked<typeof StringUtils>

describe('serialization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('SerializeToJsonString', () => {
    it('should serialize object to JSON string', () => {
      const obj = { name: 'test', value: 123, nested: { data: true } }
      const expectedJson = '{"name":"test","value":123,"nested":{"data":true}}'
      mockStringUtils.safeStringify.mockReturnValue(expectedJson)

      const result = SerializeToJsonString(obj)

      expect(mockStringUtils.safeStringify).toHaveBeenCalledWith(obj)
      expect(result).toBe(expectedJson)
    })

    it('should serialize array to JSON string', () => {
      const arr = [1, 2, 3, 'test']
      const expectedJson = '[1,2,3,"test"]'
      mockStringUtils.safeStringify.mockReturnValue(expectedJson)

      const result = SerializeToJsonString(arr)

      expect(mockStringUtils.safeStringify).toHaveBeenCalledWith(arr)
      expect(result).toBe(expectedJson)
    })

    it('should serialize primitive values', () => {
      mockStringUtils.safeStringify.mockImplementation((val) => JSON.stringify(val))

      expect(SerializeToJsonString('string')).toBe('"string"')
      expect(SerializeToJsonString(123)).toBe('123')
      expect(SerializeToJsonString(true)).toBe('true')
      expect(SerializeToJsonString(null)).toBe('null')
    })

    it('should log error and rethrow when serialization fails', () => {
      const obj = { circular: null as any }
      obj.circular = obj // Create circular reference
      const error = new Error('Converting circular structure to JSON')
      mockStringUtils.safeStringify.mockImplementation(() => {
        throw error
      })

      expect(() => SerializeToJsonString(obj)).toThrow(error)
      expect(console.log).toHaveBeenCalledWith('Error serializing object', error)
      expect(console.log).toHaveBeenCalledWith(obj)
    })
  })

  describe('DeSerializeFromJsonString', () => {
    it('should deserialize JSON string to object', () => {
      const jsonString = '{"name":"test","value":123,"nested":{"data":true}}'
      const expectedObj = { name: 'test', value: 123, nested: { data: true } }
      mockStringUtils.safeJsonParse.mockReturnValue(expectedObj)

      const result = DeSerializeFromJsonString<typeof expectedObj>(jsonString)

      expect(mockStringUtils.safeJsonParse).toHaveBeenCalledWith(jsonString)
      expect(result).toEqual(expectedObj)
    })

    it('should deserialize JSON array string', () => {
      const jsonString = '[1,2,3,"test"]'
      const expectedArr = [1, 2, 3, 'test']
      mockStringUtils.safeJsonParse.mockReturnValue(expectedArr)

      const result = DeSerializeFromJsonString<typeof expectedArr>(jsonString)

      expect(mockStringUtils.safeJsonParse).toHaveBeenCalledWith(jsonString)
      expect(result).toEqual(expectedArr)
    })

    it('should deserialize primitive values', () => {
      mockStringUtils.safeJsonParse.mockImplementation((str) => JSON.parse(str))

      expect(DeSerializeFromJsonString<string>('"string"')).toBe('string')
      expect(DeSerializeFromJsonString<number>('123')).toBe(123)
      expect(DeSerializeFromJsonString<boolean>('true')).toBe(true)
      expect(DeSerializeFromJsonString<null>('null')).toBe(null)
    })

    it('should use type parameter correctly', () => {
      interface TestType {
        id: number
        name: string
      }
      const jsonString = '{"id":1,"name":"test"}'
      const expectedObj: TestType = { id: 1, name: 'test' }
      mockStringUtils.safeJsonParse.mockReturnValue(expectedObj)

      const result = DeSerializeFromJsonString<TestType>(jsonString)

      expect(result).toEqual(expectedObj)
      // TypeScript will ensure result has the correct type
    })

    it('should log error and rethrow when deserialization fails', () => {
      const invalidJson = '{invalid json'
      const error = new Error('Unexpected end of JSON input')
      mockStringUtils.safeJsonParse.mockImplementation(() => {
        throw error
      })

      expect(() => DeSerializeFromJsonString(invalidJson)).toThrow(error)
      expect(console.log).toHaveBeenCalledWith('Error deserializing object', error)
      expect(console.log).toHaveBeenCalledWith(invalidJson)
    })
  })
})