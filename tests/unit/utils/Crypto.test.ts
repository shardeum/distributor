import { setCryptoHashKey, hashObj, sign, verify } from '../../../src/utils/Crypto'
import * as core from '@shardeum-foundation/lib-crypto-utils'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import * as utilsIndex from '../../../src/utils/index'

jest.mock('@shardeum-foundation/lib-crypto-utils')
jest.mock('../../../src/utils/index')

const mockCore = core as jest.Mocked<typeof core>
const mockUtilsIndex = utilsIndex as jest.Mocked<typeof utilsIndex>

describe('Crypto', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('setCryptoHashKey', () => {
    it('should initialize crypto with the provided hash key', () => {
      const hashKey = 'test-hash-key'
      
      setCryptoHashKey(hashKey)

      expect(mockCore.init).toHaveBeenCalledWith(hashKey)
      expect(mockCore.setCustomStringifier).toHaveBeenCalledWith(
        StringUtils.safeStringify,
        'shardus_safeStringify'
      )
    })
  })

  describe('hashObj', () => {
    it('should be the same as core.hashObj', () => {
      expect(hashObj).toBe(core.hashObj)
    })
  })

  describe('sign', () => {
    const mockDistributorInfo = {
      ip: 'localhost',
      port: 6100,
      publicKey: 'test-public-key',
    }

    beforeEach(() => {
      mockUtilsIndex.getDistributorInfo.mockReturnValue(mockDistributorInfo)
      mockUtilsIndex.getDistributorSecretKey.mockReturnValue('test-secret-key')
      mockCore.signObj.mockImplementation((obj: any, sk: any, pk: any) => {
        obj.sign = { owner: pk || 'test-public-key', sig: 'test-signature' }
        return obj
      })
    })

    it('should sign an object with default keys', () => {
      const obj = { data: 'test' }
      
      const result = sign(obj)

      expect(mockCore.signObj).toHaveBeenCalledWith(
        expect.objectContaining({ data: 'test' }),
        'test-secret-key',
        'test-public-key'
      )
      expect(result).toHaveProperty('sign')
    })

    it('should sign an object with provided keys', () => {
      const obj = { data: 'test' }
      const customSk = 'custom-secret-key'
      const customPk = 'custom-public-key'
      
      const result = sign(obj, customSk, customPk)

      expect(mockCore.signObj).toHaveBeenCalledWith(
        expect.objectContaining({ data: 'test' }),
        customSk,
        customPk
      )
      expect(result).toHaveProperty('sign')
    })

    it('should create a copy of the object before signing', () => {
      const obj = { data: 'test', nested: { value: 123 } }
      
      const result = sign(obj)

      // Original object should not be modified
      expect(obj).not.toHaveProperty('sign')
      // Result should be a different object
      expect(result).not.toBe(obj)
      expect(result.data).toBe(obj.data)
      expect(result.nested.value).toBe(obj.nested.value)
    })
  })

  describe('verify', () => {
    it('should verify a signed object and return true for valid signature', () => {
      const signedObj = {
        data: 'test',
        sign: { owner: 'test-public-key', sig: 'test-signature' },
      }
      mockCore.verifyObj.mockReturnValue(true)

      const result = verify(signedObj)

      expect(mockCore.verifyObj).toHaveBeenCalledWith(signedObj)
      expect(result).toBe(true)
    })

    it('should verify a signed object and return false for invalid signature', () => {
      const signedObj = {
        data: 'test',
        sign: { owner: 'test-public-key', sig: 'invalid-signature' },
      }
      mockCore.verifyObj.mockReturnValue(false)

      const result = verify(signedObj)

      expect(mockCore.verifyObj).toHaveBeenCalledWith(signedObj)
      expect(result).toBe(false)
    })
  })
})