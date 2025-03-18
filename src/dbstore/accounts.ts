import * as db from './sqlite3storage'
import { accountDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils/serialization'

/** Same as type AccountsCopy in the shardus core */
export interface AccountsCopy {
  accountId: string
  data: object
  timestamp: number
  hash: string
  cycleNumber: number
  isGlobal?: boolean
}

export type DBAccount = AccountsCopy & {
  data: string
}

export async function insertAccount(account: AccountsCopy): Promise<void> {
  try {
    const fields = Object.keys(account).join(', ')
    const placeholders = Object.keys(account).fill('?').join(', ')
    const values = db.extractValues(account)
    if (!values || values.length === 0) {
      throw new Error(`No values extracted from account ${account.accountId}`)
    }
    const sql = 'INSERT OR REPLACE INTO accounts (' + fields + ') VALUES (' + placeholders + ')'
    await db.run(accountDatabase, sql, values)
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Account', account.accountId)
    }
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to insert Account or it is already stored in to database', account.accountId)
  }
}

export async function bulkInsertAccounts(accounts: AccountsCopy[]): Promise<void> {
  try {
    const fields = Object.keys(accounts[0]).join(', ')
    const placeholders = Object.keys(accounts[0]).fill('?').join(', ')
    const values = db.extractValuesFromArray(accounts)
    if (!values || values.length === 0) {
      throw new Error(`No values extracted from accounts. Number of accounts: ${accounts.length}`)
    }
    let sql = 'INSERT OR REPLACE INTO accounts (' + fields + ') VALUES (' + placeholders + ')'
    for (let i = 1; i < accounts.length; i++) {
      sql = sql + ', (' + placeholders + ')'
    }
    await db.run(accountDatabase, sql, values)
    Logger.mainLogger.debug('Successfully inserted Accounts', accounts.length)
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to bulk insert Accounts', accounts.length)
  }
}

export async function updateAccount(accountId: string, account: AccountsCopy): Promise<void> {
  try {
    const sql = `UPDATE accounts SET cycleNumber = $cycleNumber, timestamp = $timestamp, data = $data, hash = $hash WHERE accountId = $accountId `
    await db.run(accountDatabase, sql, {
      $cycleNumber: account.cycleNumber,
      $timestamp: account.timestamp,
      $data: account.data && SerializeToJsonString(account.data),
      $hash: account.hash,
      $accountId: account.accountId,
    })
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully updated Account', account.accountId)
    }
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to update Account', account)
  }
}

export async function queryAccountByAccountId(accountId: string): Promise<AccountsCopy | void> {
  try {
    const sql = `SELECT * FROM accounts WHERE accountId=?`
    const account = (await db.get(accountDatabase, sql, [accountId])) as DBAccount
    if (account) if (account && account.data) account.data = DeSerializeFromJsonString(account.data)
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Account accountId', account)
    }
    return account as unknown as AccountsCopy
  } catch (e) {
    Logger.mainLogger.error(e)
  }
}

export async function queryLatestAccounts(count: number): Promise<AccountsCopy[] | void> {
  try {
    const sql = `SELECT * FROM accounts ORDER BY cycleNumber DESC, timestamp DESC LIMIT ${count ? count : 100}`
    const accounts = (await db.all(accountDatabase, sql)) as DBAccount[]
    if (accounts.length > 0) {
      accounts.forEach((account: DBAccount) => {
        if (account && account.data) account.data = DeSerializeFromJsonString(account.data)
      })
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Account latest', accounts)
    }
    return accounts as unknown as AccountsCopy[]
  } catch (e) {
    Logger.mainLogger.error(e)
  }
}

export async function queryAccounts(skip = 0, limit = 10000): Promise<AccountsCopy[] | void> {
  let accounts
  try {
    const sql = `SELECT * FROM accounts ORDER BY cycleNumber ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    accounts = await db.all(accountDatabase, sql)
    if (accounts.length > 0) {
      accounts.forEach((account: DBAccount) => {
        if (account && account.data) account.data = DeSerializeFromJsonString(account.data)
      })
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Account accounts', accounts ? accounts.length : accounts, 'skip', skip)
  }
  return accounts
}

export async function queryAccountCount(): Promise<AccountsCopy[] | void> {
  let accounts
  try {
    const sql = `SELECT COUNT(*) FROM accounts`
    accounts = await db.get(accountDatabase, sql, [])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Account count', accounts)
  }
  if (accounts) accounts = accounts['COUNT(*)']
  else accounts = 0
  return accounts
}

export async function queryAccountCountBetweenCycles(
  startCycleNumber: number,
  endCycleNumber: number
): Promise<number | void> {
  let accounts
  try {
    const sql = `SELECT COUNT(*) FROM accounts WHERE cycleNumber BETWEEN ? AND ?`
    accounts = await db.get(accountDatabase, sql, [startCycleNumber, endCycleNumber])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Account count between cycles', accounts)
  }
  if (accounts) accounts = accounts['COUNT(*)']
  else accounts = 0
  return accounts
}

export async function queryAccountsBetweenCycles(
  skip = 0,
  limit = 10000,
  startCycleNumber: number,
  endCycleNumber: number
): Promise<AccountsCopy[] | void> {
  let accounts
  try {
    const sql = `SELECT * FROM accounts WHERE cycleNumber BETWEEN ? AND ? ORDER BY cycleNumber ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    accounts = await db.all(accountDatabase, sql, [startCycleNumber, endCycleNumber])
    if (accounts.length > 0) {
      accounts.forEach((account: DBAccount) => {
        if (account && account.data) account.data = DeSerializeFromJsonString(account.data)
      })
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Account accounts between cycles', accounts ? accounts.length : accounts, 'skip', skip)
  }
  return accounts
}
