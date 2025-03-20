import * as db from './sqlite3storage'
import { transactionDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString } from '../utils/serialization'

/**
 * Transaction is for storing dapp receipt (eg. evm receipt in shardeum)
 * If there is no dapp receipt, we can skip storing in transactions table and use receipts table
 */
export interface Transaction {
  txId: string
  appReceiptId?: string // Dapp receipt id (eg. txhash of evm receipt in shardeum)
  timestamp: number
  cycleNumber: number
  data: object
  originalTxData: object
}

export type DBTransaction = Transaction & {
  data: string
  originalTxData: string
}

export async function insertTransaction(transaction: Transaction): Promise<void> {
  try {
    const fields = Object.keys(transaction).join(', ')
    const placeholders = Object.keys(transaction).fill('?').join(', ')
    const values = db.extractValues(transaction) // Ensure values is always an array
    if (!values || values.length === 0) {
      throw new Error(`No values extracted from transaction with txId ${transaction.txId}`)
    }
    const sql = 'INSERT OR REPLACE INTO transactions (' + fields + ') VALUES (' + placeholders + ')'
    await db.run(transactionDatabase, sql, values)
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Transaction', transaction.txId)
    }
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to insert Transaction or it is already stored in to database', transaction.txId)
  }
}

export async function bulkInsertTransactions(transactions: Transaction[]): Promise<void> {
  try {
    const fields = Object.keys(transactions[0]).join(', ')
    const placeholders = Object.keys(transactions[0]).fill('?').join(', ')
    const values = db.extractValuesFromArray(transactions) || []
    if (!values || values.length === 0) {
      throw new Error(`No values extracted from transactions. Number of transactions: ${transactions.length}`)
    }
    let sql = 'INSERT OR REPLACE INTO transactions (' + fields + ') VALUES (' + placeholders + ')'
    for (let i = 1; i < transactions.length; i++) {
      sql = sql + ', (' + placeholders + ')'
    }
    await db.run(transactionDatabase, sql, values)
    Logger.mainLogger.debug('Successfully inserted Transactions', transactions.length)
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to bulk insert Transactions', transactions.length)
  }
}

export async function queryTransactionByTxId(txId: string): Promise<Transaction | void> {
  try {
    const sql = `SELECT * FROM transactions WHERE txId=?`
    const transaction = (await db.get(transactionDatabase, sql, [txId])) as DBTransaction
    if (transaction) {
      if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
      if (transaction.originalTxData) transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction txId', transaction)
    }
    return transaction as unknown as Transaction
  } catch (e) {
    Logger.mainLogger.error(e)
  }
}

export async function queryTransactionByAccountId(accountId: string): Promise<Transaction | void> {
  try {
    const sql = `SELECT * FROM transactions WHERE accountId=?`
    const transaction = (await db.get(transactionDatabase, sql, [accountId])) as DBTransaction
    if (transaction) {
      if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
      if (transaction.originalTxData) transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction accountId', transaction)
    }
    return transaction as unknown as Transaction
  } catch (e) {
    Logger.mainLogger.error(e)
  }
}

export async function queryLatestTransactions(count: number): Promise<Transaction[] | void> {
  try {
    const sql = `SELECT * FROM transactions ORDER BY cycleNumber DESC, timestamp DESC LIMIT ${count ? count : 100}`
    const transactions = (await db.all(transactionDatabase, sql)) as DBTransaction[]
    if (transactions.length > 0) {
      transactions.forEach((transaction: DBTransaction) => {
        if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
        if (transaction.originalTxData)
          transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
      })
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction latest', transactions)
    }
    return transactions as unknown as Transaction[]
  } catch (e) {
    Logger.mainLogger.error(e)
  }
}

export async function queryTransactions(skip = 0, limit = 10000): Promise<Transaction[] | void> {
  let transactions
  try {
    const sql = `SELECT * FROM transactions ORDER BY cycleNumber ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    transactions = await db.all(transactionDatabase, sql)
    if (transactions.length > 0) {
      transactions.forEach((transaction: DBTransaction) => {
        if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
        if (transaction.originalTxData)
          transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
      })
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Transaction transactions', transactions ? transactions.length : transactions, 'skip', skip)
  }
  return transactions as unknown as Transaction[]
}

export async function queryTransactionCount(): Promise<number> {
  let transactions
  try {
    const sql = `SELECT COUNT(*) FROM transactions`
    transactions = await db.get(transactionDatabase, sql, [])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Transaction count', transactions)
  }
  if (transactions) transactions = transactions['COUNT(*)']
  else transactions = 0
  return transactions
}

export async function queryTransactionCountBetweenCycles(
  startCycleNumber: number,
  endCycleNumber: number
): Promise<number> {
  let transactions
  try {
    const sql = `SELECT COUNT(*) FROM transactions WHERE cycleNumber BETWEEN ? AND ?`
    transactions = await db.get(transactionDatabase, sql, [startCycleNumber, endCycleNumber])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Transaction count between cycles', transactions)
  }
  if (transactions) transactions = transactions['COUNT(*)']
  else transactions = 0
  return transactions
}

export async function queryTransactionsBetweenCycles(
  skip = 0,
  limit = 10000,
  startCycleNumber: number,
  endCycleNumber: number
): Promise<Transaction[] | void> {
  let transactions
  try {
    const sql = `SELECT * FROM transactions WHERE cycleNumber BETWEEN ? AND ? ORDER BY cycleNumber ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    transactions = await db.all(transactionDatabase, sql, [startCycleNumber, endCycleNumber])
    if (transactions.length > 0) {
      transactions.forEach((transaction: DBTransaction) => {
        if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
        if (transaction.originalTxData)
          transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
      })
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug(
      'Transaction transactions between cycles',
      transactions ? transactions.length : transactions,
      'skip',
      skip
    )
  }
  return transactions
}
