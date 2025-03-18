import { Signature } from '@shardeum-foundation/lib-crypto-utils'
import * as db from './sqlite3storage'
import { receiptDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString } from '../utils/serialization'
import { AccountsCopy } from '../dbstore/accounts'

export type Proposal = {
  applied: boolean
  cant_preApply: boolean
  accountIDs: string[]
  beforeStateHashes: string[]
  afterStateHashes: string[]
  appReceiptDataHash: string
  txid: string
}

export type SignedReceipt = {
  proposal: Proposal
  proposalHash: string // Redundant, may go
  signaturePack: Signature[]
  voteOffsets: number[]
  sign?: Signature
}

// We might have to move type definitions to a separate place

/**
 * ArchiverReceipt is the full data (shardusReceipt + appReceiptData + accounts ) of a tx that is sent to the archiver
 */
export interface ArchiverReceipt {
  tx: {
    originalTxData: object
    txId: string
    timestamp: number
  }
  cycle: number
  signedReceipt: SignedReceipt
  afterStates?: AccountsCopy[]
  beforeStates?: AccountsCopy[]
  appReceiptData: any
  executionShardKey: string
  globalModification: boolean
}

export type AppliedVote = {
  txid: string
  transaction_result: boolean
  account_id: string[]
  //if we add hash state before then we could prove a dishonest apply vote
  //have to consider software version
  account_state_hash_after: string[]
  account_state_hash_before: string[]
  cant_apply: boolean // indicates that the preapply could not give a pass or fail
  node_id: string // record the node that is making this vote.. todo could look this up from the sig later
  sign: Signature
  // hash of app data
  app_data_hash: string
}

/**
 * a space efficent version of the receipt
 *
 * use TellSignedVoteHash to send just signatures of the vote hash (votes must have a deterministic sort now)
 * never have to send or request votes individually, should be able to rely on existing receipt send/request
 * for nodes that match what is required.
 */
export type AppliedReceipt2 = {
  txid: string
  result: boolean
  //single copy of vote
  appliedVote: AppliedVote
  confirmOrChallenge: ConfirmOrChallengeMessage
  //all signatures for this vote
  signatures: [Signature] //Could have all signatures or best N.  (lowest signature value?)
  // hash of app data
  app_data_hash: string
}

export type ConfirmOrChallengeMessage = {
  message: string
  nodeId: string
  appliedVote: AppliedVote
  sign: Signature
}
export interface Receipt extends ArchiverReceipt {
  receiptId: string
  timestamp: number
  applyTimestamp: number
}

export type DBReceipt = Receipt & {
  tx: string
  afterStates: string
  beforeStates: string
  signedReceipt: string
  appReceiptData: string | null
}

export interface ReceiptsCountByCycle {
  cycle: number
  receipts: number
}

export async function insertReceipt(receipt: Receipt): Promise<void> {
  try {
    const fields = Object.keys(receipt).join(', ')
    const placeholders = Object.keys(receipt).fill('?').join(', ')
    const values = db.extractValues(receipt)
    if (!values) {
      throw new Error('Failed to extract values from receipt')
    }
    const sql = 'INSERT OR REPLACE INTO receipts (' + fields + ') VALUES (' + placeholders + ')'
    await db.run(receiptDatabase, sql, values)
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Receipt', receipt.receiptId)
    }
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to insert Receipt or it is already stored in to database', receipt.receiptId)
  }
}

export async function bulkInsertReceipts(receipts: Receipt[]): Promise<void> {
  try {
    const fields = Object.keys(receipts[0]).join(', ')
    const placeholders = Object.keys(receipts[0]).fill('?').join(', ')
    const values = db.extractValuesFromArray(receipts)
    if (!values) {
      throw new Error('Failed to extract values from receipt')
    }
    let sql = 'INSERT OR REPLACE INTO receipts (' + fields + ') VALUES (' + placeholders + ')'
    for (let i = 1; i < receipts.length; i++) {
      sql = sql + ', (' + placeholders + ')'
    }
    await db.run(receiptDatabase, sql, values)
    Logger.mainLogger.debug('Successfully inserted Receipts', receipts.length)
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to bulk insert Receipts', receipts.length)
  }
}

export async function queryReceiptByReceiptId(receiptId: string, timestamp = 0): Promise<Receipt> {
  try {
    const sql = `SELECT * FROM receipts WHERE receiptId=?` + (timestamp ? ` AND timestamp=?` : '')
    const value = timestamp ? [receiptId, timestamp] : [receiptId]
    const receipt = (await db.get(receiptDatabase, sql, value)) as DBReceipt
    if (receipt) deserializeDBReceipt(receipt)
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt receiptId', receipt)
    }
    return receipt as Receipt
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function queryLatestReceipts(count: number): Promise<Receipt[]> {
  try {
    const sql = `SELECT * FROM receipts ORDER BY cycle DESC, timestamp DESC LIMIT ${count ? count : 100}`
    const receipts = (await db.all(receiptDatabase, sql)) as DBReceipt[]
    if (receipts.length > 0) {
      receipts.forEach((receipt: DBReceipt) => {
        deserializeDBReceipt(receipt)
      })
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt latest', receipts)
    }
    return receipts as unknown as Receipt[]
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function queryReceipts(skip = 0, limit = 10000): Promise<Receipt[]> {
  let receipts: Receipt[] = []
  try {
    const sql = `SELECT * FROM receipts ORDER BY cycle ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    receipts = (await db.all(receiptDatabase, sql)) as DBReceipt[]
    if (receipts.length > 0) {
      receipts.forEach((receipt: DBReceipt) => {
        deserializeDBReceipt(receipt)
      })
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Receipt receipts', receipts ? receipts.length : receipts, 'skip', skip)
  }
  return receipts
}

export async function queryReceiptCount(): Promise<number> {
  let receipts
  try {
    const sql = `SELECT COUNT(*) FROM receipts`
    receipts = await db.get(receiptDatabase, sql, [])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Receipt count', receipts)
  }
  if (receipts) receipts = receipts['COUNT(*)']
  else receipts = 0
  return receipts
}

export async function queryReceiptCountByCycles(start: number, end: number): Promise<ReceiptsCountByCycle[]> {
  let receipts
  try {
    const sql = `SELECT cycle, COUNT(*) FROM receipts GROUP BY cycle HAVING cycle BETWEEN ? AND ? ORDER BY cycle ASC`
    receipts = await db.all(receiptDatabase, sql, [start, end])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Receipt count by cycle', receipts)
  }
  if (receipts.length > 0) {
    receipts.forEach((receipt) => {
      receipt['receipts'] = receipt['COUNT(*)']
      delete receipt['COUNT(*)']
    })
  }
  return receipts
}

export async function queryReceiptCountBetweenCycles(
  startCycleNumber: number,
  endCycleNumber: number
): Promise<number> {
  let receipts
  try {
    const sql = `SELECT COUNT(*) FROM receipts WHERE cycle BETWEEN ? AND ?`
    receipts = await db.get(receiptDatabase, sql, [startCycleNumber, endCycleNumber])
  } catch (e) {
    console.log(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Receipt count between cycles', receipts)
  }
  if (receipts) receipts = receipts['COUNT(*)']
  else receipts = 0
  return receipts
}

export async function queryReceiptsBetweenCycles(
  skip = 0,
  limit = 10000,
  startCycleNumber: number,
  endCycleNumber: number
): Promise<Receipt[]> {
  let receipts: Receipt[] = []
  try {
    const sql = `SELECT * FROM receipts WHERE cycle BETWEEN ? AND ? ORDER BY cycle ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    receipts = (await db.all(receiptDatabase, sql, [startCycleNumber, endCycleNumber])) as DBReceipt[]
    if (receipts.length > 0) {
      receipts.forEach((receipt: DBReceipt) => {
        deserializeDBReceipt(receipt)
      })
    }
  } catch (e) {
    console.log(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Receipt receipts between cycles', receipts ? receipts.length : receipts, 'skip', skip)
  }
  return receipts
}

function deserializeDBReceipt(receipt: DBReceipt): void {
  receipt.tx &&= DeSerializeFromJsonString(receipt.tx)
  receipt.afterStates &&= DeSerializeFromJsonString(receipt.afterStates)
  receipt.beforeStates &&= DeSerializeFromJsonString(receipt.beforeStates)
  receipt.signedReceipt &&= DeSerializeFromJsonString(receipt.signedReceipt)
  receipt.appReceiptData &&= DeSerializeFromJsonString(receipt.appReceiptData)

  // globalModification is stored as 0 or 1 in the database, convert it to boolean
  receipt.globalModification = (receipt.globalModification as unknown as number) === 1
}
