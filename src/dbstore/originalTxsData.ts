import * as db from './sqlite3storage'
import { originalTxDataDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString } from '../utils/serialization'
import { isNumber } from '../utils/Utils'

export interface OriginalTxData {
  txId: string
  timestamp: number
  cycle: number
  originalTxData: unknown
  // sign: Signature
}

export interface OriginalTxsDataCountByCycle {
  cycle: number
  originalTxsData: number
}

export type DBOriginalTxData = OriginalTxData & {
  originalTxData: string
}

export async function insertOriginalTxData(OriginalTxData: OriginalTxData): Promise<void> {
  try {
    const fields = Object.keys(OriginalTxData).join(', ')
    const placeholders = Object.keys(OriginalTxData).fill('?').join(', ')
    const values = db.extractValues(OriginalTxData)
    if (!values || values.length === 0) {
      throw new Error(`No values extracted from OriginalTxData with txId ${OriginalTxData.txId}`)
    }
    const sql = 'INSERT OR REPLACE INTO originalTxsData (' + fields + ') VALUES (' + placeholders + ')'
    await db.run(originalTxDataDatabase, sql, values)
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted OriginalTxData', OriginalTxData.txId)
    }
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error(
      'Unable to insert OriginalTxData or it is already stored in to database',
      OriginalTxData.txId
    )
  }
}

export async function bulkInsertOriginalTxsData(originalTxsData: OriginalTxData[]): Promise<void> {
  try {
    const fields = Object.keys(originalTxsData[0]).join(', ')
    const placeholders = Object.keys(originalTxsData[0]).fill('?').join(', ')
    const values = db.extractValuesFromArray(originalTxsData)
    if (!values || values.length === 0) {
      throw new Error(
        `No values extracted from originalTxsData. Number of originalTxsData: ${originalTxsData.length}`
      )
    }
    let sql = 'INSERT OR REPLACE INTO originalTxsData (' + fields + ') VALUES (' + placeholders + ')'
    for (let i = 1; i < originalTxsData.length; i++) {
      sql = sql + ', (' + placeholders + ')'
    }
    await db.run(originalTxDataDatabase, sql, values)
    Logger.mainLogger.debug('Successfully inserted OriginalTxsData', originalTxsData.length)
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to bulk insert OriginalTxsData', originalTxsData.length)
    throw e // check with Achal/Jai
  }
}

export async function queryOriginalTxDataCount(startCycle?: number, endCycle?: number): Promise<number> {
  let originalTxsData
  try {
    let sql = `SELECT COUNT(*) FROM originalTxsData`
    const values: number[] = []
    if (isNumber(startCycle) && isNumber(endCycle)) {
      sql += ` WHERE cycle BETWEEN ? AND ?`
      values.push(startCycle, endCycle)
    }
    originalTxsData = await db.get(originalTxDataDatabase, sql, values)
  } catch (e) {
    console.log(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('OriginalTxData count', originalTxsData)
  }
  return originalTxsData['COUNT(*)'] || 0
}

export async function queryOriginalTxsData(
  skip = 0,
  limit = 10,
  startCycle?: number,
  endCycle?: number
): Promise<OriginalTxData[]> {
  let originalTxsData
  try {
    let sql = `SELECT * FROM originalTxsData`
    const sqlSuffix = ` ORDER BY cycle ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    const values: number[] = []
    if (isNumber(startCycle) && isNumber(endCycle)) {
      sql += ` WHERE cycle BETWEEN ? AND ?`
      values.push(startCycle, endCycle)
    }
    sql += sqlSuffix
    originalTxsData = await db.all(originalTxDataDatabase, sql, values)
    originalTxsData.forEach((originalTxData: DBOriginalTxData) => {
      if (originalTxData.originalTxData)
        originalTxData.originalTxData = DeSerializeFromJsonString(originalTxData.originalTxData)
    })
  } catch (e) {
    console.log(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('OriginalTxData originalTxsData', originalTxsData)
  }
  return originalTxsData
}

export async function queryOriginalTxDataByTxId(txId: string): Promise<OriginalTxData | null> {
  try {
    const sql = `SELECT * FROM originalTxsData WHERE txId=?`
    const originalTxData = (await db.get(originalTxDataDatabase, sql, [txId])) as DBOriginalTxData
    if (originalTxData) {
      if (originalTxData.originalTxData)
        originalTxData.originalTxData = DeSerializeFromJsonString(originalTxData.originalTxData)
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('OriginalTxData txId', originalTxData)
    }
    return originalTxData as OriginalTxData
  } catch (e) {
    console.log(e)
  }
  return null
}

export async function queryOriginalTxDataCountByCycles(
  start: number,
  end: number
): Promise<OriginalTxsDataCountByCycle[]> {
  let originalTxsData
  try {
    const sql = `SELECT cycle, COUNT(*) FROM originalTxsData GROUP BY cycle HAVING cycle BETWEEN ? AND ? ORDER BY cycle ASC`
    originalTxsData = await db.all(originalTxDataDatabase, sql, [start, end])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('OriginalTxData count by cycle', originalTxsData)
  }
  if (originalTxsData.length > 0) {
    originalTxsData.forEach((OriginalTxData) => {
      OriginalTxData['originalTxsData'] = OriginalTxData['COUNT(*)']
      delete OriginalTxData['COUNT(*)']
    })
  }
  return originalTxsData
}

export async function queryLatestOriginalTxs(count: number): Promise<DBOriginalTxData[] | void> {
  try {
    const sql = `SELECT * FROM originalTxsData ORDER BY cycle DESC, timestamp DESC LIMIT ${
      count ? count : 100
    }`
    const originalTxs = (await db.all(originalTxDataDatabase, sql)) as DBOriginalTxData[]
    if (originalTxs.length > 0) {
      originalTxs.forEach((tx: DBOriginalTxData) => {
        if (tx.originalTxData) tx.originalTxData = DeSerializeFromJsonString(tx.originalTxData)
      })
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Latest Original-Tx: ', originalTxs)
    }
    return originalTxs
  } catch (e) {
    Logger.mainLogger.error(e)
  }
}
