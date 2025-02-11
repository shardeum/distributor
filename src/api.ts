import { Signature } from '@shardeum-foundation/lib-crypto-utils'
import { FastifyInstance, FastifyRequest } from 'fastify'
import { Server, IncomingMessage, ServerResponse } from 'http'
import { config } from './Config'
import * as Logger from './Logger'
import * as Crypto from './utils/Crypto'
import * as Utils from './utils/Utils'
import * as CycleDB from './dbstore/cycles'
import * as AccountDB from './dbstore/accounts'
import * as TransactionDB from './dbstore/transactions'
import * as ReceiptDB from './dbstore/receipts'
import * as OriginalTxDB from './dbstore/originalTxsData'
import { distributorSubscribers } from './distributor/utils'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { getDataLogReaderMetrics } from './metrics'

const TXID_LENGTH = 64
export const MAX_ACCOUNTS_PER_REQUEST = 1000
export const MAX_RECEIPTS_PER_REQUEST = 100
export const MAX_ORIGINAL_TXS_PER_REQUEST = 100
export const MAX_CYCLES_PER_REQUEST = 100

export const MAX_BETWEEN_CYCLES_PER_REQUEST = 100

//Types and interfaces for request body
interface RequestBody {
  count?: number
  start?: number
  end?: number
  startCycle?: number
  endCycle?: number
  type?: string
  page?: number
  txId?: string
  txIdList?: string
  sender: string
  sign: Signature
  collectorInfo?: {
    subscriptionType: string
    timestamp: number
  }
}

export function registerRoutes(server: FastifyInstance<Server, IncomingMessage, ServerResponse>): void {
  type Request = FastifyRequest<{
    Body: {
      sender: string
      sign: Signature
    }
  }>

  type CycleInfoRequest = FastifyRequest<{
    Body: {
      start: number
      end: number
      count: number
    }
  }>

  server.post('/cycleinfo', async (_request: CycleInfoRequest & Request, reply) => {
    const requestData = _request.body
    const result = validateRequestData(requestData, {
      start: 'n?',
      end: 'n?',
      count: 'n?',
      sender: 's',
      sign: 'o',
    })
    if (!result.success) {
      reply.status(400).send(Crypto.sign({ success: false, error: result.error }))
      return
    }
    const { start, end, count } = requestData
    let cycleInfo = []
    if (count) {
      if (count <= 0 || Number.isNaN(count)) {
        reply.send(Crypto.sign({ success: false, error: `Invalid count` }))
        return
      }
      if (count > MAX_CYCLES_PER_REQUEST) {
        reply.send(Crypto.sign({ success: false, error: `Max count is ${MAX_CYCLES_PER_REQUEST}.` }))
        return
      }
      cycleInfo = (await CycleDB.queryLatestCycleRecords(count)) || []
    } else if (start || start === 0) {
      const from = start
      const to = end ? end : from
      if (!(from >= 0 && to >= from) || Number.isNaN(from) || Number.isNaN(to)) {
        Logger.mainLogger.error(`Invalid start and end counters`)
        reply.send(Crypto.sign({ success: false, error: `Invalid start and end counters` }))
        return
      }
      const cycleCount = to - from
      if (cycleCount > MAX_CYCLES_PER_REQUEST) {
        Logger.mainLogger.error(`Exceed maximum limit of ${MAX_CYCLES_PER_REQUEST} cycles`)
        reply.send(
          Crypto.sign({ success: false, error: `Exceed maximum limit of ${MAX_CYCLES_PER_REQUEST} cycles` })
        )
        return
      }
      cycleInfo = (await CycleDB.queryCycleRecordsBetween(from, to)) || []
    } else {
      reply.send({
        success: false,
        error: 'not specified which cycle to show',
      })
      return
    }
    const res = Crypto.sign({
      cycleInfo,
    })
    reply.send(res)
  })

  type ReceiptRequest = FastifyRequest<{
    Body: {
      count: number
      start: number
      end: number
      startCycle: number
      endCycle: number
      type: string
      page: number
      txId: string
      txIdList: string
    }
  }>

  server.post('/originalTx', async (_request: ReceiptRequest & Request, reply) => {
    const requestData = _request.body
    const result = validateRequestData(requestData, {
      count: 'n?',
      start: 'n?',
      end: 'n?',
      startCycle: 'n?',
      endCycle: 'n?',
      type: 's?',
      page: 'n?',
      txId: 's?',
      txIdList: 's?',
      sender: 's',
      sign: 'o',
    })
    if (!result.success) {
      reply.status(400).send(Crypto.sign({ success: false, error: result.error }))
      return
    }
    const { count, start, end, startCycle, endCycle, type, page, txId, txIdList } = requestData
    let originalTxs: OriginalTxDB.OriginalTxData[] | OriginalTxDB.OriginalTxsDataCountByCycle[] | number = []
    if (count) {
      if (count <= 0 || Number.isNaN(count)) {
        reply.send(Crypto.sign({ success: false, error: `Invalid count` }))
        return
      }
      if (count > MAX_ORIGINAL_TXS_PER_REQUEST) {
        reply.send(Crypto.sign({ success: false, error: `Max count is ${MAX_ORIGINAL_TXS_PER_REQUEST}` }))
        return
      }
      originalTxs = (await OriginalTxDB.queryLatestOriginalTxs(count)) || []
    } else if (txId) {
      if (txId.length !== TXID_LENGTH) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid txId ${txId}`,
          })
        )
        return
      }
      const originalTx = await OriginalTxDB.queryOriginalTxDataByTxId(txId)
      if (originalTx) (originalTxs as OriginalTxDB.OriginalTxData[]).push(originalTx)
    } else if (txIdList) {
      let txIdListArr: string[] = []
      try {
        txIdListArr = StringUtils.safeJsonParse(txIdList)
        if (txIdListArr && txIdListArr.length > MAX_ORIGINAL_TXS_PER_REQUEST) {
          reply.send(
            Crypto.sign({
              success: false,
              error: `Exceed maximum limit of ${MAX_ORIGINAL_TXS_PER_REQUEST} original transactions`,
            })
          )
          return
        }
      } catch (e) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid txIdList ${txIdList}`,
          })
        )
        return
      }
      for (const txId of txIdListArr) {
        if (typeof txId !== 'string' || txId.length !== TXID_LENGTH) {
          reply.send(
            Crypto.sign({
              success: false,
              error: `Invalid txId ${txId} in the List`,
            })
          )
          return
        }
        const originalTx = (await OriginalTxDB.queryOriginalTxDataByTxId(txId)) as OriginalTxDB.OriginalTxData
        if (originalTx) (originalTxs as OriginalTxDB.OriginalTxData[]).push(originalTx)
      }
    } else if (start || start === 0) {
      const from = start
      const to = end ? end : from
      if (!(from >= 0 && to >= from) || Number.isNaN(from) || Number.isNaN(to)) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid start and end counters`,
          })
        )
        return
      }
      const count = to - from
      if (count > MAX_ORIGINAL_TXS_PER_REQUEST) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Exceed maximum limit of ${MAX_ORIGINAL_TXS_PER_REQUEST} original transactions`,
          })
        )
        return
      }
      originalTxs = await OriginalTxDB.queryOriginalTxsData(from, count + 1)
    } else if (startCycle || startCycle === 0) {
      const from = startCycle
      const to = endCycle ? endCycle : from
      if (!(from >= 0 && to >= from) || Number.isNaN(from) || Number.isNaN(to)) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid startCycle and endCycle counters`,
          })
        )
        return
      }
      const count = to - from
      if (count > MAX_BETWEEN_CYCLES_PER_REQUEST) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Exceed maximum limit of ${MAX_BETWEEN_CYCLES_PER_REQUEST} cycles`,
          })
        )
        return
      }
      if (type === 'tally') {
        originalTxs = await OriginalTxDB.queryOriginalTxDataCountByCycles(from, to)
      } else if (type === 'count') {
        originalTxs = await OriginalTxDB.queryOriginalTxDataCount(from, to)
      } else {
        let skip = 0
        const limit = MAX_ORIGINAL_TXS_PER_REQUEST
        if (page) {
          if (page < 1 || Number.isNaN(page)) {
            reply.send(Crypto.sign({ success: false, error: `Invalid page number` }))
            return
          }
          skip = page - 1
          if (skip > 0) skip = skip * limit
        }
        originalTxs = await OriginalTxDB.queryOriginalTxsData(skip, limit, from, to)
      }
    }
    const res = Crypto.sign({
      originalTxs,
    })
    reply.send(res)
  })

  server.post('/receipt', async (_request: ReceiptRequest, reply) => {
    const requestData = _request.body as RequestBody
    const result = validateRequestData(requestData, {
      count: 'n?',
      start: 'n?',
      end: 'n?',
      startCycle: 'n?',
      endCycle: 'n?',
      type: 's?',
      page: 'n?',
      txId: 's?',
      txIdList: 's?',
      sender: 's',
      sign: 'o',
    })
    if (!result.success) {
      reply.status(400).send(Crypto.sign({ success: false, error: result.error }))
      return
    }
    const { count, start, end, startCycle, endCycle, type, page, txId, txIdList } = requestData
    let receipts: ReceiptDB.Receipt[] | ReceiptDB.ReceiptsCountByCycle[] | number = []
    if (count) {
      if (count <= 0 || Number.isNaN(count)) {
        reply.send(Crypto.sign({ success: false, error: `Invalid count` }))
        return
      }
      if (count > MAX_RECEIPTS_PER_REQUEST) {
        reply.send(Crypto.sign({ success: false, error: `Max count is ${MAX_RECEIPTS_PER_REQUEST}` }))
        return
      }
      receipts = (await ReceiptDB.queryLatestReceipts(count)) || []
    } else if (txId) {
      if (txId.length !== TXID_LENGTH) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid txId ${txId}`,
          })
        )
        return
      }
      const receipt = await ReceiptDB.queryReceiptByReceiptId(txId)
      if (receipt) (receipts as ReceiptDB.Receipt[]).push(receipt)
    } else if (txIdList) {
      let txIdListArr: string[] = []
      try {
        txIdListArr = StringUtils.safeJsonParse(txIdList)
        if (txIdListArr && txIdListArr.length > MAX_RECEIPTS_PER_REQUEST) {
          reply.send(
            Crypto.sign({
              success: false,
              error: `Exceed maximum limit of ${MAX_RECEIPTS_PER_REQUEST} receipts`,
            })
          )
          return
        }
      } catch (e) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid txIdList ${txIdList}`,
          })
        )
        return
      }
      for (const txId of txIdListArr) {
        if (typeof txId !== 'string' || txId.length !== TXID_LENGTH) {
          reply.send(
            Crypto.sign({
              success: false,
              error: `Invalid txId ${txId} in the List`,
            })
          )
          return
        }
        const receipt = await ReceiptDB.queryReceiptByReceiptId(txId)
        if (receipt) (receipts as ReceiptDB.Receipt[]).push(receipt)
      }
    } else if (start || start === 0) {
      const from = start
      const to = end ? end : from
      if (!(from >= 0 && to >= from) || Number.isNaN(from) || Number.isNaN(to)) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid start and end counters`,
          })
        )
        return
      }
      const count = to - from
      if (count > MAX_RECEIPTS_PER_REQUEST) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Exceed maximum limit of ${MAX_RECEIPTS_PER_REQUEST} receipts`,
          })
        )
        return
      }
      receipts = (await ReceiptDB.queryReceipts(from, count + 1)) || []
    } else if (startCycle || startCycle === 0) {
      const from = startCycle
      const to = endCycle ? endCycle : from
      if (!(from >= 0 && to >= from) || Number.isNaN(from) || Number.isNaN(to)) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid startCycle and endCycle counters`,
          })
        )
        return
      }
      const count = to - from
      if (count > MAX_BETWEEN_CYCLES_PER_REQUEST) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Exceed maximum limit of ${MAX_BETWEEN_CYCLES_PER_REQUEST} cycles`,
          })
        )
        return
      }
      if (type === 'tally') {
        receipts = (await ReceiptDB.queryReceiptCountByCycles(from, to)) || []
      } else if (type === 'count') {
        receipts = await ReceiptDB.queryReceiptCountBetweenCycles(from, to)
      } else {
        let skip = 0
        const limit = MAX_RECEIPTS_PER_REQUEST
        if (page) {
          if (page < 1 || Number.isNaN(page)) {
            reply.send(Crypto.sign({ success: false, error: `Invalid page number` }))
            return
          }
          skip = page - 1
          if (skip > 0) skip = skip * limit
        }
        receipts = await ReceiptDB.queryReceiptsBetweenCycles(skip, limit, from, to)
      }
    }
    const res = Crypto.sign({
      receipts,
    })
    reply.send(res)
  })

  type AccountRequest = FastifyRequest<{
    Body: {
      count: number
      start: number
      end: number
      startCycle: number
      endCycle: number
      page: number
      accountId: string
    }
  }>

  server.post('/account', async (_request: AccountRequest & Request, reply) => {
    const requestData = _request.body
    const result = validateRequestData(requestData, {
      count: 'n?',
      start: 'n?',
      end: 'n?',
      startCycle: 'n?',
      endCycle: 'n?',
      page: 'n?',
      accountId: 's?',
      sender: 's',
      sign: 'o',
    })
    if (!result.success) {
      reply.send(Crypto.sign({ success: false, error: result.error }))
      return
    }
    let accounts: AccountDB.AccountsCopy[] = []
    let totalAccounts = 0
    let res
    const { count, start, end, startCycle, endCycle, page, accountId } = requestData
    if (count) {
      if (count <= 0 || Number.isNaN(count)) {
        reply.send(Crypto.sign({ success: false, error: `Invalid count` }))
        return
      }
      if (count > MAX_ACCOUNTS_PER_REQUEST) {
        reply.send(Crypto.sign({ success: false, error: `Max count is ${MAX_ACCOUNTS_PER_REQUEST}` }))
        return
      }
      accounts = (await AccountDB.queryLatestAccounts(count)) || []
    } else if (start || start === 0) {
      const from = start
      const to = end ? end : from
      if (!(from >= 0 && to >= from) || Number.isNaN(from) || Number.isNaN(to)) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid start and end counters`,
          })
        )
        return
      }
      const count = to - from
      if (count > MAX_ACCOUNTS_PER_REQUEST) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Exceed maximum limit of ${MAX_ACCOUNTS_PER_REQUEST} accounts`,
          })
        )
        return
      }
      accounts = (await AccountDB.queryAccounts(from, count + 1)) || []
      res = Crypto.sign({
        accounts,
      })
    } else if (startCycle || startCycle === 0) {
      const from = startCycle
      const to = endCycle ? endCycle : from
      if (!(from >= 0 && to >= from) || Number.isNaN(from) || Number.isNaN(to)) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid startCycle and endCycle counters`,
          })
        )
        return
      }
      const count = to - from
      if (count > MAX_BETWEEN_CYCLES_PER_REQUEST) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Exceed maximum limit of ${MAX_BETWEEN_CYCLES_PER_REQUEST} cycles to query accounts Count`,
          })
        )
        return
      }
      totalAccounts = (await AccountDB.queryAccountCountBetweenCycles(from, to)) || 0
      if (page) {
        if (page < 1 || Number.isNaN(page)) {
          reply.send(Crypto.sign({ success: false, error: `Invalid page number` }))
          return
        }
        let skip = page - 1
        const limit = MAX_ACCOUNTS_PER_REQUEST
        if (skip > 0) skip = skip * limit
        accounts = (await AccountDB.queryAccountsBetweenCycles(skip, limit, from, to)) || []
        res = Crypto.sign({
          accounts,
          totalAccounts,
        })
      } else {
        res = Crypto.sign({
          totalAccounts,
        })
      }
    } else if (accountId) {
      const account = await AccountDB.queryAccountByAccountId(accountId)
      accounts = account ? [account] : []
      res = Crypto.sign({
        accounts,
      })
    } else {
      reply.send({
        success: false,
        error: 'not specified which account to show',
      })
      return
    }
    reply.send(res)
  })

  type TransactionRequest = FastifyRequest<{
    Body: {
      count: number
      start: number
      end: number
      startCycle: number
      endCycle: number
      txId: string
      page: number
      appReceiptId: string
      cycle: number
    }
  }>

  server.post('/transaction', async (_request: TransactionRequest & Request, reply) => {
    const requestData = _request.body
    const result = validateRequestData(requestData, {
      count: 'n?',
      start: 'n?',
      end: 'n?',
      txId: 's?',
      appReceiptId: 's?',
      startCycle: 'n?',
      endCycle: 'n?',
      page: 'n?',
      sender: 's',
      sign: 'o',
    })
    if (!result.success) {
      reply.send(Crypto.sign({ success: false, error: result.error }))
      return
    }
    const { count, start, end, txId, appReceiptId, startCycle, endCycle, page } = requestData
    let transactions = []
    let totalTransactions = 0
    let res
    if (count) {
      if (count <= 0 || Number.isNaN(count)) {
        reply.send(Crypto.sign({ success: false, error: `Invalid count` }))
        return
      }
      if (count > MAX_ACCOUNTS_PER_REQUEST) {
        reply.send(Crypto.sign({ success: false, error: `Max count is ${MAX_ACCOUNTS_PER_REQUEST}` }))
        return
      }
      transactions = (await TransactionDB.queryLatestTransactions(count)) || []
    } else if (start || start === 0) {
      const from = start
      const to = end ? end : from
      if (!(from >= 0 && to >= from) || Number.isNaN(from) || Number.isNaN(to)) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid start and end counters`,
          })
        )
        return
      }
      const count = to - from
      if (count > MAX_ACCOUNTS_PER_REQUEST) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Exceed maximum limit of ${MAX_ACCOUNTS_PER_REQUEST} transactions`,
          })
        )
        return
      }
      transactions = (await TransactionDB.queryTransactions(from, count + 1)) || []
      res = Crypto.sign({
        transactions,
      })
    } else if (startCycle || startCycle === 0) {
      const from = startCycle
      const to = endCycle ? endCycle : from
      if (!(from >= 0 && to >= from) || Number.isNaN(from) || Number.isNaN(to)) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Invalid startCycle and endCycle counters`,
          })
        )
        return
      }
      const count = to - from
      if (count > MAX_BETWEEN_CYCLES_PER_REQUEST) {
        reply.send(
          Crypto.sign({
            success: false,
            error: `Exceed maximum limit of ${MAX_BETWEEN_CYCLES_PER_REQUEST} cycles to query transactions Count`,
          })
        )
        return
      }
      totalTransactions = await TransactionDB.queryTransactionCountBetweenCycles(from, to)
      if (page) {
        if (page < 1 || Number.isNaN(page)) {
          reply.send(Crypto.sign({ success: false, error: `Invalid page number` }))
          return
        }
        let skip = page - 1
        const limit = MAX_ACCOUNTS_PER_REQUEST
        if (skip > 0) skip = skip * limit
        transactions = (await TransactionDB.queryTransactionsBetweenCycles(skip, limit, from, to)) || []
        res = Crypto.sign({
          transactions,
          totalTransactions,
        })
      } else {
        res = Crypto.sign({
          totalTransactions,
        })
      }
    } else if (txId) {
      const transaction = await TransactionDB.queryTransactionByTxId(txId)
      transactions = transaction ? [transaction] : []
      res = Crypto.sign({
        transactions,
      })
    } else if (appReceiptId) {
      const transaction = await TransactionDB.queryTransactionByAccountId(appReceiptId)
      transactions = transaction ? [transaction] : []
      res = Crypto.sign({
        transactions,
      })
    } else {
      res = {
        success: false,
        error: 'not specified which account to show',
      }
    }
    reply.send(res)
  })

  server.post('/totalData', async (_request: Request, reply) => {
    const requestData = _request.body
    const result = validateRequestData(requestData, {
      sender: 's',
      sign: 'o',
    })
    if (!result.success) {
      reply.send(Crypto.sign({ success: false, error: result.error }))
      return
    }
    const totalCycles = await CycleDB.queryCyleCount()
    const totalAccounts = await AccountDB.queryAccountCount()
    const totalTransactions = await TransactionDB.queryTransactionCount()
    const totalReceipts = await ReceiptDB.queryReceiptCount()
    const totalOriginalTxs = await OriginalTxDB.queryOriginalTxDataCount()
    reply.send(
      Crypto.sign({
        totalCycles,
        totalAccounts,
        totalTransactions,
        totalReceipts,
        totalOriginalTxs,
        pid: process.pid,
      })
    )
  })

  server.get('/config', (_request, reply) => {
    config.DISTRIBUTOR_PUBLIC_KEY
    const distributorConfig = {
      DISTRIBUTOR_IP: config.DISTRIBUTOR_IP,
      DISTRIBUTOR_PORT: config.DISTRIBUTOR_PORT,
      DISTRIBUTOR_PUBLIC_KEY: config.DISTRIBUTOR_PUBLIC_KEY,
      limitToSubscribersOnly: config.limitToSubscribersOnly,
      subscribers: config.subscribers,
    }
    reply.send({ config: distributorConfig })
  })

  server.get('/metrics', (_request, reply) => {
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Metrics requested')
    }
    try {
      const metrics = getDataLogReaderMetrics()
      if (config.VERBOSE) {
        Logger.mainLogger.debug('Metrics: ', metrics)
      }
      reply.send(metrics)
    } catch (e) {
      Logger.mainLogger.error('Error getting metrics', e)
      reply.status(500).send({ error: 'Error getting metrics' })
    }
  })

  server.post('/cycleData', async (_request: TransactionRequest & Request, reply) => {
    try {
      const requestData = _request.body
      const result = validateRequestData(requestData, {
        cycle: 'n?',
        sender: 's',
        sign: 'o',
      })

      if (!result.success) {
        reply.send(Crypto.sign({ success: false, error: result.error }))
        return
      }

      const { cycle } = requestData

      if (cycle < 0 || Number.isNaN(cycle)) {
        reply.send(Crypto.sign({ success: false, error: `Invalid cycle. Must be a number >= 0` }))
        return
      }

      const [totalReceipts, totalTransactions] = await Promise.all([
        ReceiptDB.queryReceiptCountBetweenCycles(cycle, cycle),
        OriginalTxDB.queryOriginalTxDataCount(cycle, cycle),
      ])
      const res = { totalReceipts, totalTransactions }

      reply.send(Crypto.sign({ success: true, data: res }))
    } catch (error) {
      console.error('Error fetching cycleData on receipt and transaction count:', error)
      reply.send(Crypto.sign({ success: false, error: 'Error in /cycleData' }))
    }
  })
}

export const validateRequestData = (
  data: RequestBody,
  expectedDataType: {
    [key: string]: 'n?' | 's?' | 'o' | 's'
  }
): {
  success: boolean
  error?: string
} => {
  try {
    let err = Utils.validateTypes(data, expectedDataType)
    if (err) {
      Logger.mainLogger.error('Invalid request data ', err)
      return { success: false, error: 'Invalid request data ' + err }
    }
    err = Utils.validateTypes(data.sign, { owner: 's', sig: 's' })
    if (err) {
      Logger.mainLogger.error('Invalid request data signature ', err)
      return { success: false, error: 'Invalid request data signature ' + err }
    }
    if (data.sign.owner !== data.sender) {
      Logger.mainLogger.error('Data sender publicKey and sign owner key does not match')
      return { success: false, error: 'Data sender publicKey and sign owner key does not match' }
    }
    if (config.limitToSubscribersOnly) {
      if (!distributorSubscribers.has(data.sender)) {
        Logger.mainLogger.error('Data request sender is not a subscriber')
        return { success: false, error: 'Data request sender is not a subscriber' }
      }
      const subscriber = distributorSubscribers.get(data.sender)
      if (subscriber?.expirationTimestamp !== 0 && subscriber!.expirationTimestamp > Date.now()) {
        Logger.mainLogger.error('Subscriber subscription expired')
        return { success: false, error: 'Subscriber subscription expired' }
      }
      if (expectedDataType.collectorInfo) {
        err = Utils.validateTypes(data.collectorInfo, { subscriptionType: 's', timestamp: 'n' })
        if (err) {
          Logger.mainLogger.error('Invalid collectorInfo ', err)
          return { success: false, error: 'Invalid collectorInfo ' + err }
        }
        if (data.collectorInfo.subscriptionType !== subscriber.subscriptionType) {
          Logger.mainLogger.error('Invalid subscriptionType')
          return { success: false, error: 'Invalid subscriptionType' }
        }
        // Check if the timestamp is less than 30 seconds of the current time
        const ACCEPTABLE_TIMESTAMP_DIFF = 30000
        if (
          data.collectorInfo.timestamp !== 0 &&
          Date.now() - data.collectorInfo.timestamp > ACCEPTABLE_TIMESTAMP_DIFF
        ) {
          Logger.mainLogger.error('Invalid timestamp')
          return { success: false, error: 'Invalid timestamp' }
        }
      }
    }
    if (!Crypto.verify(data)) {
      Logger.mainLogger.error('Invalid signature', data)
      return { success: false, error: 'Invalid signature' }
    }
    return { success: true }
  } catch (e) {
    Logger.mainLogger.error('Error validating request data', e)
    return { success: false, error: 'Error validating request data' }
  }
}
