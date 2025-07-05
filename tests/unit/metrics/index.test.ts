import {
  setInitialDataLogReaderMetrics,
  incrementCycleCount,
  incrementReceiptCount,
  incrementOriginalTxCount,
  getDataLogReaderMetrics,
} from '../../../src/metrics/index'
import { queryCyleCount } from '../../../src/dbstore/cycles'
import { queryOriginalTxDataCount } from '../../../src/dbstore/originalTxsData'
import { queryReceiptCount } from '../../../src/dbstore/receipts'

jest.mock('../../../src/dbstore/cycles', () => ({
  queryCyleCount: jest.fn(),
}))
jest.mock('../../../src/dbstore/originalTxsData', () => ({
  queryOriginalTxDataCount: jest.fn(),
}))
jest.mock('../../../src/dbstore/receipts', () => ({
  queryReceiptCount: jest.fn(),
}))

const mockQueryCyleCount = queryCyleCount as jest.MockedFunction<typeof queryCyleCount>
const mockQueryOriginalTxDataCount = queryOriginalTxDataCount as jest.MockedFunction<typeof queryOriginalTxDataCount>
const mockQueryReceiptCount = queryReceiptCount as jest.MockedFunction<typeof queryReceiptCount>

describe('metrics/index', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('setInitialDataLogReaderMetrics', () => {
    it('should initialize metrics with database counts', async () => {
      mockQueryCyleCount.mockResolvedValue(100)
      mockQueryReceiptCount.mockResolvedValue(200)
      mockQueryOriginalTxDataCount.mockResolvedValue(300)

      await setInitialDataLogReaderMetrics()

      const metrics = getDataLogReaderMetrics()
      expect(metrics.cycle.count).toBe(100)
      expect(metrics.receipt.count).toBe(200)
      expect(metrics.originalTx.count).toBe(300)
      expect(metrics.cycle.lastUpdationTimestamp).toBe(Date.now())
      expect(metrics.receipt.lastUpdationTimestamp).toBe(Date.now())
      expect(metrics.originalTx.lastUpdationTimestamp).toBe(Date.now())
    })

    it('should handle database query errors gracefully', async () => {
      mockQueryCyleCount.mockRejectedValue(new Error('DB Error'))
      mockQueryReceiptCount.mockResolvedValue(0)
      mockQueryOriginalTxDataCount.mockResolvedValue(0)

      await expect(setInitialDataLogReaderMetrics()).rejects.toThrow('DB Error')
    })
  })

  describe('increment functions', () => {
    beforeEach(async () => {
      mockQueryCyleCount.mockResolvedValue(10)
      mockQueryReceiptCount.mockResolvedValue(20)
      mockQueryOriginalTxDataCount.mockResolvedValue(30)
      await setInitialDataLogReaderMetrics()
    })

    it('should increment cycle count', async () => {
      const initialTime = Date.now()
      jest.advanceTimersByTime(1000)

      await incrementCycleCount()

      const metrics = getDataLogReaderMetrics()
      expect(metrics.cycle.count).toBe(11)
      expect(metrics.cycle.lastUpdationTimestamp).toBeGreaterThan(initialTime)
    })

    it('should increment receipt count', async () => {
      const initialTime = Date.now()
      jest.advanceTimersByTime(1000)

      await incrementReceiptCount()

      const metrics = getDataLogReaderMetrics()
      expect(metrics.receipt.count).toBe(21)
      expect(metrics.receipt.lastUpdationTimestamp).toBeGreaterThan(initialTime)
    })

    it('should increment original tx count', async () => {
      const initialTime = Date.now()
      jest.advanceTimersByTime(1000)

      await incrementOriginalTxCount()

      const metrics = getDataLogReaderMetrics()
      expect(metrics.originalTx.count).toBe(31)
      expect(metrics.originalTx.lastUpdationTimestamp).toBeGreaterThan(initialTime)
    })

    it('should handle multiple increments', async () => {
      await incrementCycleCount()
      await incrementCycleCount()
      await incrementReceiptCount()
      await incrementOriginalTxCount()
      await incrementOriginalTxCount()
      await incrementOriginalTxCount()

      const metrics = getDataLogReaderMetrics()
      expect(metrics.cycle.count).toBe(12)
      expect(metrics.receipt.count).toBe(21)
      expect(metrics.originalTx.count).toBe(33)
    })
  })

  describe('getDataLogReaderMetrics', () => {
    it('should return current metrics state', async () => {
      mockQueryCyleCount.mockResolvedValue(5)
      mockQueryReceiptCount.mockResolvedValue(10)
      mockQueryOriginalTxDataCount.mockResolvedValue(15)

      await setInitialDataLogReaderMetrics()

      const metrics = getDataLogReaderMetrics()
      expect(metrics).toEqual({
        cycle: {
          count: 5,
          lastUpdationTimestamp: Date.now(),
        },
        receipt: {
          count: 10,
          lastUpdationTimestamp: Date.now(),
        },
        originalTx: {
          count: 15,
          lastUpdationTimestamp: Date.now(),
        },
      })
    })

    it('should return the same object reference', () => {
      const metrics1 = getDataLogReaderMetrics()
      const metrics2 = getDataLogReaderMetrics()

      expect(metrics1).toBe(metrics2)
    })
  })
})