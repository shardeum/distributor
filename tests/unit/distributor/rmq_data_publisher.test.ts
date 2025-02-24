import { CheckpointDao } from '../../../src/dbstore/checkpoints'
import { queryCycleRecordsBetween } from '../../../src/dbstore/cycles'
import RMQDataPublisher from '../../../src/distributor/rmq_data_publisher'
import { sleep } from '../../../src/utils/Utils'
import * as amqp from 'amqplib'
import { queryOriginalTxsData } from '../../../src/dbstore/originalTxsData'
import { queryReceiptsBetweenCycles } from '../../../src/dbstore/receipts'
import * as Crypto from '../../../src/utils/Crypto'
import { distributorMode } from '../../../src/Config'

jest.mock('amqplib', () => ({
  connect: jest.fn(),
}))

jest.mock('../../../src/dbstore/checkpoints', () => ({
  CheckpointDao: {
    getCheckpoint: jest.fn(),
    upsertCheckpoint: jest.fn(),
  },
}))

jest.mock('../../../src/dbstore/cycles', () => ({
  queryCycleRecordsBetween: jest.fn(),
}))

jest.mock('../../../src/dbstore/receipts', () => ({
  queryReceiptsBetweenCycles: jest.fn(),
}))

jest.mock('../../../src/dbstore/originalTxsData', () => ({
  queryOriginalTxsData: jest.fn(),
}))

jest.mock('../../../src/utils/Utils', () => ({
  sleep: jest.fn(),
}))

jest.mock('../../../src/utils/Crypto', () => ({
  sign: jest.fn(),
}))

describe('RMQDataPublisher Tests', () => {
  let mockConnect: jest.Mock

  beforeAll(() => {
    mockConnect = amqp.connect as jest.Mock
  })

  let publisher: RMQDataPublisher

  beforeEach(() => {
    publisher = new RMQDataPublisher()
    // jest.clearAllMocks()
  })

  test('should initialize and connect', async () => {
    ;(CheckpointDao.getCheckpoint as jest.Mock).mockResolvedValue({ id: 1, cursor: '0' })
    ;(queryCycleRecordsBetween as jest.Mock).mockResolvedValue([])
    ;(sleep as jest.Mock).mockResolvedValue(undefined)
    const mockChannel = {
      on: jest.fn(),
      close: jest.fn(),
    }
    const mockConnection = {
      createConfirmChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn(),
      on: jest.fn(),
    }
    mockConnect.mockResolvedValue(mockConnection)

    const startPromise = publisher.start()

    // Simulate the loop
    await sleep(1000)
    ;(publisher as any).isConnClosing = true

    await startPromise

    expect(CheckpointDao.getCheckpoint).toHaveBeenCalledWith('cycle', distributorMode.MQ)
  })

  test('should handle connection errors and retry', async () => {
    const connectSpy = jest.spyOn(publisher as any, 'connect').mockResolvedValue({})
    const retryConnectionSpy = jest.spyOn(publisher as any, 'retryConnection').mockImplementation()

    ;(CheckpointDao.getCheckpoint as jest.Mock).mockResolvedValue({ id: 1, cursor: '0' })
    ;(queryCycleRecordsBetween as jest.Mock).mockResolvedValue([])
    ;(sleep as jest.Mock).mockResolvedValue(undefined)
    const mockChannel = {
      on: jest.fn(),
      close: jest.fn(),
    }

    const mockConnection = {
      createConfirmChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn(),
      on: jest.fn(),
    }

    mockConnect.mockResolvedValue(mockConnection)
    const startPromise = publisher.start()

    // Simulate the loop
    await sleep(1000)
    ;(publisher as any).handleConnectionClose()
    await sleep(1000)
    ;(publisher as any).isConnClosing = true

    await startPromise

    expect(connectSpy).toHaveBeenCalled()
    expect(retryConnectionSpy).toHaveBeenCalled()
  })

  test('should publish events when connected', async () => {
    ;(CheckpointDao.getCheckpoint as jest.Mock).mockResolvedValue({ id: 1, cursor: '0' })
    ;(CheckpointDao.upsertCheckpoint as jest.Mock).mockResolvedValue({})
    ;(queryCycleRecordsBetween as jest.Mock).mockResolvedValue([{ counter: 1 }, { counter: 2 }])
    ;(queryOriginalTxsData as jest.Mock).mockResolvedValue([{ cycle: 1 }, { cycle: 2 }])
    ;(queryReceiptsBetweenCycles as jest.Mock).mockResolvedValue([{ cycle: 1 }, { cycle: 2 }])
    ;(sleep as jest.Mock).mockResolvedValue(undefined)
    ;(Crypto.sign as jest.Mock).mockResolvedValue({})

    const connectSpy = jest.spyOn(publisher as any, 'connect').mockResolvedValue({})
    const findAndPublishEventsSpy = jest.spyOn(publisher as any, 'findAndPublishEvents')

    const mockChannel = {
      on: jest.fn(),
      close: jest.fn(),
      publish: jest.fn(),
      waitForConfirms: jest.fn().mockResolvedValue(true),
    }
    const mockConnection = {
      createConfirmChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn(),
      on: jest.fn(),
    }
    mockConnect.mockResolvedValue(mockConnection)
    mockChannel.publish.mockResolvedValue('true')
    ;(publisher as any).channel = mockChannel

    const startPromise = publisher.start()

    await sleep(1000)
    ;(publisher as any).isConnected = true
    await sleep(1000)
    ;(publisher as any).isConnClosing = true

    await startPromise

    expect(connectSpy).toHaveBeenCalled()
    expect(findAndPublishEventsSpy).toHaveBeenCalled()
  })

  test('should update checkpoint after given threshold', async () => {
    ;(CheckpointDao.getCheckpoint as jest.Mock).mockResolvedValue({ id: 1, cursor: '0' })
    ;(CheckpointDao.upsertCheckpoint as jest.Mock).mockResolvedValue({})
    
    // Create enough cycles to exceed the cycleConfirmThreshold (which is batchSize - 1 = 20)
    const cycles = Array.from({ length: 25 }, (_, i) => ({ counter: i + 1 }))
    ;(queryCycleRecordsBetween as jest.Mock).mockResolvedValue(cycles)
    
    ;(queryOriginalTxsData as jest.Mock).mockResolvedValue([{ cycle: 1 }, { cycle: 2 }])
    ;(queryReceiptsBetweenCycles as jest.Mock).mockResolvedValue([{ cycle: 1 }, { cycle: 2 }])
    ;(sleep as jest.Mock).mockResolvedValue(undefined)
    ;(Crypto.sign as jest.Mock).mockResolvedValue({})

    const connectSpy = jest.spyOn(publisher as any, 'connect').mockResolvedValue({})
    const findAndPublishEventsSpy = jest.spyOn(publisher as any, 'findAndPublishEvents')
    const upsertCheckpointSpy = jest.spyOn(CheckpointDao, 'upsertCheckpoint')

    const mockChannel = {
      on: jest.fn(),
      close: jest.fn(),
      publish: jest.fn(),
      waitForConfirms: jest.fn().mockResolvedValue(true),
    }
    const mockConnection = {
      createConfirmChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn(),
      on: jest.fn(),
    }
    mockConnect.mockResolvedValue(mockConnection)
    mockChannel.publish.mockResolvedValue('true')
    ;(publisher as any).channel = mockChannel
    ;(publisher as any).cursorUpdatedAt = Date.now() - 61_000

    const startPromise = publisher.start()

    await sleep(1000)
    ;(publisher as any).isConnected = true
    await sleep(1000)
    ;(publisher as any).isConnClosing = true

    await startPromise

    expect(connectSpy).toHaveBeenCalled()
    expect(findAndPublishEventsSpy).toHaveBeenCalled()
    expect(upsertCheckpointSpy).toHaveBeenCalled()
  })

  test('should safely return on no new events', async () => {
    ;(CheckpointDao.getCheckpoint as jest.Mock).mockResolvedValue({ id: 1, cursor: '0' })
    ;(CheckpointDao.upsertCheckpoint as jest.Mock).mockResolvedValue({})
    ;(queryCycleRecordsBetween as jest.Mock).mockResolvedValue([])
    ;(queryOriginalTxsData as jest.Mock).mockResolvedValue([{ cycle: 1 }, { cycle: 2 }])
    ;(queryReceiptsBetweenCycles as jest.Mock).mockResolvedValue([{ cycle: 1 }, { cycle: 2 }])
    ;(sleep as jest.Mock).mockResolvedValue(undefined)
    ;(Crypto.sign as jest.Mock).mockResolvedValue({})

    const connectSpy = jest.spyOn(publisher as any, 'connect').mockResolvedValue({})
    const findAndPublishEventsSpy = jest.spyOn(publisher as any, 'findAndPublishEvents')

    const mockChannel = {
      on: jest.fn(),
      close: jest.fn(),
      publish: jest.fn(),
      waitForConfirms: jest.fn().mockResolvedValue(true),
    }
    const mockConnection = {
      createConfirmChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn(),
      on: jest.fn(),
    }
    mockConnect.mockResolvedValue(mockConnection)
    mockChannel.publish.mockResolvedValue('true')
    ;(publisher as any).channel = mockChannel

    const startPromise = publisher.start()

    await sleep(1000)
    ;(publisher as any).isConnected = true
    await sleep(1000)
    ;(publisher as any).isConnClosing = true

    await startPromise

    expect(connectSpy).toHaveBeenCalled()
    expect(findAndPublishEventsSpy).toHaveBeenCalled()
    expect(mockChannel.publish).not.toHaveBeenCalled()
  })

  test('should not invoke publish method if connection is closed', async () => {
    ;(CheckpointDao.getCheckpoint as jest.Mock).mockResolvedValue({ id: 1, cursor: '0' })
    ;(CheckpointDao.upsertCheckpoint as jest.Mock).mockResolvedValue({})
    ;(queryCycleRecordsBetween as jest.Mock).mockResolvedValue([{ counter: 1 }, { counter: 2 }])
    ;(queryOriginalTxsData as jest.Mock).mockResolvedValue([{ cycle: 1 }, { cycle: 2 }])
    ;(queryReceiptsBetweenCycles as jest.Mock).mockResolvedValue([{ cycle: 1 }, { cycle: 2 }])
    ;(sleep as jest.Mock).mockResolvedValue(undefined)
    ;(Crypto.sign as jest.Mock).mockResolvedValue({})

    const connectSpy = jest.spyOn(publisher as any, 'connect').mockResolvedValue({})
    const findAndPublishEventsSpy = jest.spyOn(publisher as any, 'findAndPublishEvents')

    const mockChannel = {
      on: jest.fn(),
      close: jest.fn(),
      publish: jest.fn(),
      waitForConfirms: jest.fn().mockResolvedValue(true),
    }
    const mockConnection = {
      createConfirmChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn(),
      on: jest.fn(),
    }
    mockConnect.mockResolvedValue(mockConnection)
    mockChannel.publish.mockResolvedValue('true')
    ;(publisher as any).channel = mockChannel

    const startPromise = publisher.start()

    await sleep(1000)
    ;(publisher as any).isConnected = true
    await sleep(1000)
    ;(publisher as any).isConnected = false
    await sleep(1000)
    ;(publisher as any).isConnClosing = true

    await startPromise

    expect(connectSpy).toHaveBeenCalled()
    expect(findAndPublishEventsSpy).toHaveBeenCalled()
    expect(mockChannel.publish).not.toHaveBeenCalled()
  })
})
