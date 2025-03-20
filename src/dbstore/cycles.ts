import * as db from './sqlite3storage'
import { cycleDatabase } from '.'
import { P2P, StateManager } from '@shardeum-foundation/lib-types'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils/serialization'

export interface Cycle {
  counter: number
  cycleRecord: P2P.CycleCreatorTypes.CycleRecord
  cycleMarker: StateManager.StateMetaDataTypes.CycleMarker
}

export type DBCycle = Cycle & {
  cycleRecord: string
}

export async function insertCycle(cycle: Cycle): Promise<void> {
  try {
    const fields = Object.keys(cycle).join(', ')
    const placeholders = Object.keys(cycle).fill('?').join(', ')
    const values = db.extractValues(cycle)
    if (!values || values.length === 0) {
      throw new Error(`No values extracted from cycle ${cycle.cycleRecord.counter}`)
    }
    const sql = 'INSERT OR REPLACE INTO cycles (' + fields + ') VALUES (' + placeholders + ')'
    await db.run(cycleDatabase, sql, values)
    Logger.mainLogger.debug('Successfully inserted Cycle', cycle.cycleRecord.counter, cycle.cycleMarker)
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error(
      'Unable to insert cycle or it is already stored in to database',
      cycle.cycleRecord.counter,
      cycle.cycleMarker
    )
  }
}

export async function bulkInsertCycles(cycles: Cycle[]): Promise<void> {
  try {
    const fields = Object.keys(cycles[0]).join(', ')
    const placeholders = Object.keys(cycles[0]).fill('?').join(', ')
    const values = db.extractValuesFromArray(cycles)
    if (!values || values.length === 0) {
      throw new Error(`No values extracted from cycles. Number of cycles: ${cycles.length}`)
    }
    let sql = 'INSERT OR REPLACE INTO cycles (' + fields + ') VALUES (' + placeholders + ')'
    for (let i = 1; i < cycles.length; i++) {
      sql = sql + ', (' + placeholders + ')'
    }
    await db.run(cycleDatabase, sql, values)
    Logger.mainLogger.debug('Successfully inserted Cycles', cycles.length)
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to bulk insert Cycles', cycles.length)
  }
}

export async function updateCycle(marker: string, cycle: Cycle): Promise<void> {
  try {
    const sql = `UPDATE cycles SET counter = $counter, cycleRecord = $cycleRecord WHERE cycleMarker = $marker `
    await db.run(cycleDatabase, sql, {
      $counter: cycle.counter,
      $cycleRecord: cycle.cycleRecord && SerializeToJsonString(cycle.cycleRecord),
      $marker: marker,
    })
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Updated cycle for counter', cycle.cycleRecord.counter, cycle.cycleMarker)
    }
  } catch (e) {
    Logger.mainLogger.error(e)
    Logger.mainLogger.error('Unable to update Cycle', cycle.cycleMarker)
  }
}

export async function queryCycleByMarker(marker: string): Promise<Cycle | null> {
  try {
    const sql = `SELECT * FROM cycles WHERE cycleMarker=? LIMIT 1`
    const dbCycle = (await db.get(cycleDatabase, sql, [marker])) as DBCycle
    let cycle: Cycle | null = null
    if (dbCycle) {
      cycle = {
        counter: dbCycle.counter,
        cycleRecord: dbCycle.cycleRecord ? DeSerializeFromJsonString(dbCycle.cycleRecord) : null,
        cycleMarker: dbCycle.cycleMarker,
      }
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('cycle marker', cycle)
    }
    return cycle
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function queryLatestCycleRecords(count: number): Promise<P2P.CycleCreatorTypes.CycleRecord[] | void> {
  try {
    const sql = `SELECT * FROM cycles ORDER BY counter DESC LIMIT ${count ? count : 100}`
    const cycleRecords: DBCycle[] = (await db.all(cycleDatabase, sql)) as DBCycle[]
    let deserializedCycleRecords: P2P.CycleCreatorTypes.CycleRecord[] = []
    if (cycleRecords.length > 0) {
      deserializedCycleRecords = cycleRecords.map((cycleRecord: DBCycle) => {
        return cycleRecord.cycleRecord
          ? (DeSerializeFromJsonString(cycleRecord.cycleRecord) as P2P.CycleCreatorTypes.CycleRecord)
          : null
      })
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('cycle latest', cycleRecords)
    }
    return deserializedCycleRecords
  } catch (e) {
    Logger.mainLogger.error(e)
  }
}

export async function queryCycleRecordsBetween(
  start: number,
  end: number
): Promise<P2P.CycleCreatorTypes.CycleRecord[] | void> {
  try {
    const sql = `SELECT * FROM cycles WHERE counter BETWEEN ? AND ? ORDER BY counter ASC`
    const cycleRecords: DBCycle[] = (await db.all(cycleDatabase, sql, [start, end])) as DBCycle[]
    let deserializedCycleRecords: P2P.CycleCreatorTypes.CycleRecord[] = []
    if (cycleRecords.length > 0) {
      deserializedCycleRecords = cycleRecords.map((cycleRecord: DBCycle) => {
        if (cycleRecord.cycleRecord) return DeSerializeFromJsonString(cycleRecord.cycleRecord)
        else return null
      })
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('cycle between', cycleRecords)
    }
    return deserializedCycleRecords
  } catch (e) {
    Logger.mainLogger.error(e)
  }
}

export async function queryCyleCount(): Promise<number> {
  let cycles
  try {
    const sql = `SELECT COUNT(*) FROM cycles`
    cycles = await db.get(cycleDatabase, sql, [])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Cycle count', cycles)
  }
  if (cycles) cycles = cycles['COUNT(*)']
  else cycles = 0
  return cycles
}
