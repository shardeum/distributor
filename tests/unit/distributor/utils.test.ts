import {
  showAllProcesses,
  registerWorkerMessageListener,
  updateConfigAndSubscriberList,
  refreshSubscribers,
  getWorkerForClient,
  workerClientMap,
  socketClientMap,
  workerProcessMap,
  distributorSubscribers,
} from '../../../src/distributor/utils'
import * as Logger from '../../../src/Logger'
import { config } from '../../../src/Config'
import { Worker } from 'cluster'

jest.mock('../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
  },
}))

jest.mock('../../../src/Config', () => ({
  config: {
    subscribers: [],
  },
}))

describe('distributor/utils', () => {
  let mockWorker: any
  let consoleSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleSpy = jest.spyOn(console, 'table').mockImplementation()
    jest.spyOn(console, 'log').mockImplementation()
    
    // Clear all maps
    workerClientMap.clear()
    socketClientMap.clear()
    workerProcessMap.clear()
    distributorSubscribers.clear()

    // Create mock worker
    mockWorker = {
      process: { pid: 123 },
      on: jest.fn(),
      send: jest.fn(),
    }
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('showAllProcesses', () => {
    it('should display empty table when no workers', () => {
      showAllProcesses()

      expect(console.table).toHaveBeenCalledWith([], ['Worker_PID', 'Client_PubKeys'])
    })

    it('should display worker client map in table format', () => {
      workerClientMap.set(mockWorker, ['client1', 'client2'])
      
      showAllProcesses()

      expect(console.table).toHaveBeenCalledWith(
        [{ Worker_PID: 123, Client_PubKeys: ['client1', 'client2'] }],
        ['Worker_PID', 'Client_PubKeys']
      )
    })
  })

  describe('registerWorkerMessageListener', () => {
    it('should register message listener on worker', () => {
      registerWorkerMessageListener(mockWorker)

      expect(mockWorker.on).toHaveBeenCalledWith('message', expect.any(Function))
    })

    describe('message handling', () => {
      let messageHandler: Function

      beforeEach(() => {
        registerWorkerMessageListener(mockWorker)
        messageHandler = mockWorker.on.mock.calls[0][1]
        workerProcessMap.set(123, mockWorker)
      })

      it('should handle client_close message', () => {
        socketClientMap.set('client1', 123)
        workerClientMap.set(mockWorker, ['client1'])

        messageHandler({ type: 'client_close', data: 'client1' })

        expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
          '❌ Client Connection Terminated with ID: ',
          'client1'
        )
        expect(socketClientMap.has('client1')).toBe(false)
      })

      it('should handle client_connected for new client', () => {
        workerClientMap.set(mockWorker, [])

        messageHandler({ type: 'client_connected', data: 'newClient' })

        expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
          '✅ Client (newClient) connected with Worker: 123'
        )
        expect(socketClientMap.get('newClient')).toBe(123)
        expect(workerClientMap.get(mockWorker)).toContain('newClient')
      })

      it('should handle duplicate client connection on different worker', () => {
        const otherWorker = { process: { pid: 456 }, send: jest.fn() }
        socketClientMap.set('client1', 456)
        workerProcessMap.set(456, otherWorker as any)
        workerClientMap.set(mockWorker, [])
        workerClientMap.set(otherWorker as any, ['client1'])

        messageHandler({ type: 'client_connected', data: 'client1' })

        expect(mockWorker.send).toHaveBeenCalledWith({
          type: 'close_duplicate_connection',
          data: 'client1',
        })
      })

      it('should handle duplicate client connection on same worker', () => {
        socketClientMap.set('client1', 123)
        workerClientMap.set(mockWorker, ['client1'])

        messageHandler({ type: 'client_connected', data: 'client1' })

        expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Duplicate Connection Request')
        )
      })

      it('should handle client_expired message', () => {
        socketClientMap.set('client1', 123)
        workerClientMap.set(mockWorker, ['client1'])

        messageHandler({ type: 'client_expired', data: 'client1' })

        expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
          '❌ Client with ID Expired: ',
          'client1'
        )
        expect(socketClientMap.has('client1')).toBe(false)
      })

      it('should handle unexpected message type', () => {
        messageHandler({ type: 'unknown_type', data: 'some_data' })

        expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
          'Unexpected Message Received From Worker: ',
          { type: 'unknown_type', data: 'some_data' }
        )
      })

      it('should ignore messages without type', () => {
        messageHandler({ data: 'some_data' })

        expect(Logger.mainLogger.debug).not.toHaveBeenCalled()
      })
    })
  })

  describe('updateConfigAndSubscriberList', () => {
    it('should clear and update subscribers from config', () => {
      distributorSubscribers.set('old-key', { 
        publicKey: 'old-key',
        expirationTimestamp: 0,
        subscriptionType: 'FIREHOSE' as any,
      })

      config.subscribers = [
        { publicKey: 'key1', expirationTimestamp: 0, subscriptionType: 'FIREHOSE' as any },
        { publicKey: 'key2', expirationTimestamp: 0, subscriptionType: 'ACCOUNTS' as any },
      ]

      updateConfigAndSubscriberList()

      expect(distributorSubscribers.size).toBe(2)
      expect(distributorSubscribers.has('old-key')).toBe(false)
      expect(distributorSubscribers.has('key1')).toBe(true)
      expect(distributorSubscribers.has('key2')).toBe(true)
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Subscribers refreshed, count: ', 2)
    })

    it('should handle empty subscribers list', () => {
      config.subscribers = []

      updateConfigAndSubscriberList()

      expect(distributorSubscribers.size).toBe(0)
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Subscribers refreshed, count: ', 0)
    })
  })

  describe('refreshSubscribers', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      jest.spyOn(global, 'setInterval')
      jest.spyOn(global, 'clearInterval')
    })

    afterEach(() => {
      jest.useRealTimers()
      jest.restoreAllMocks()
    })

    it('should set up interval to check for expired subscribers', () => {
      config.subscribers = [
        { publicKey: 'key1', expirationTimestamp: 0, subscriptionType: 'FIREHOSE' as any },
      ]

      refreshSubscribers()

      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 30000)
    })

    it('should remove expired subscribers', () => {
      const expiredTime = Date.now() - 1000
      config.subscribers = [
        { publicKey: 'expired', expirationTimestamp: expiredTime, subscriptionType: 'FIREHOSE' as any },
        { publicKey: 'permanent', expirationTimestamp: 0, subscriptionType: 'FIREHOSE' as any },
      ]
      socketClientMap.set('expired', 123)
      workerProcessMap.set(123, mockWorker)

      refreshSubscribers()
      
      // Fast forward timer
      jest.advanceTimersByTime(30000)

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('❌ Removing Expired Subscriber: expired')
      expect(mockWorker.send).toHaveBeenCalledWith({
        type: 'remove_subscriber',
        data: 'expired',
      })
      expect(config.subscribers).toHaveLength(1)
      expect(config.subscribers[0].publicKey).toBe('permanent')
    })

    it('should clear previous interval when called again', () => {
      refreshSubscribers()
      
      // Clear the mock to start fresh
      jest.clearAllMocks()
      
      refreshSubscribers()

      // Should clear the previous interval
      expect(clearInterval).toHaveBeenCalledTimes(1)
      // Should set a new interval
      expect(setInterval).toHaveBeenCalledTimes(1)
    })
  })

  describe('getWorkerForClient', () => {
    it('should return worker for valid client', () => {
      socketClientMap.set('client1', 123)
      workerProcessMap.set(123, mockWorker)

      const result = getWorkerForClient('client1')

      expect(result).toBe(mockWorker)
    })

    it('should throw error when client not found', () => {
      expect(() => getWorkerForClient('unknown')).toThrow(
        'Child process associated with Client: unknown not found'
      )
    })

    it('should throw error when worker process not found', () => {
      socketClientMap.set('client1', 999)

      expect(() => getWorkerForClient('client1')).toThrow(
        'Child process with PID: 999 not found'
      )
    })
  })
})