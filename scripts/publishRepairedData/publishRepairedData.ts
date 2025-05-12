import { config as dotenvConfig } from 'dotenv'
import { Command } from 'commander'
import RMQDataPublisher from '../../src/distributor/rmq_data_publisher'
import * as CycleDB from '../../src/dbstore/cycles'
import * as ReceiptDB from '../../src/dbstore/receipts'
import * as OriginalTxsDataDB from '../../src/dbstore/originalTxsData'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as dbstore from '../../src/dbstore'
import { config as distributorConfig, overrideDefaultConfig } from '../../src/Config'
import { CycleRecord, CycleData } from '@shardeum-foundation/lib-types/build/src/p2p/CycleCreatorTypes'
import { Receipt } from '../../src/dbstore/receipts'
import { OriginalTxData } from '../../src/dbstore/originalTxsData'
import { sleep } from '../../src/utils/Utils'
import { writeFile, mkdir } from 'fs/promises'
import * as fs from 'fs'

dotenvConfig()

const configFile = join(__dirname, '../distributor-config.json')
overrideDefaultConfig(configFile, process.env, process.argv)

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Logger = require('../../src/Logger')
  if (!Logger.mainLogger) {
    Logger.mainLogger = {
      debug: (...args: any[]): void => {
        /* mock */
      },
      info: (...args: any[]): void => {
        /* mock */
      },
      warn: (...args: any[]): void => {
        /* mock */
      },
      error: (...args: any[]): void => {
        /* mock */
      },
    }
  }
} catch (e) {
  // If Logger cannot be required, do nothing
}

interface ScriptConfig {
  inputFile: string
  batchSize: number
  maxRetries: number
  retryDelay: number
  rmqHost: string
  rmqPort: number
  rmqUser: string
  rmqPass: string
  dryRun: boolean
}

interface PublishSummary {
  timestamp: number
  totalProcessed: {
    cycles: number
    receipts: number
    transactions: number
  }
  published: {
    cycles: number
    receipts: number
    transactions: number
  }
  failed: {
    cycles: number
    receipts: number
    transactions: number
  }
  failedItems?: {
    cycles: Array<{ counter: number; majorityHash: string }>
    receipts: Array<{ id: string; cycle: number; majorityHash: string }>
    transactions: Array<{ id: string; cycle: number; majorityHash: string }>
  }
}

interface MissingData {
  cycles: Array<{ counter: number; majorityHash?: string }>
  receipts: Array<{ id: string; cycle: number; majorityHash?: string }>
  accounts: Array<{ id: string; majorityHash?: string; cycle?: number; cycleNumber?: number }>
  transactions: Array<{ id: string; cycle: number; majorityHash?: string; cycleNumber?: number }>
  timestamp: number
}

const logger = {
  info: (message: string, meta?: any): void => {
    console.log(`[INFO] ${message}`, meta ? meta : '')
  },
  error: (message: string, meta?: any): void => {
    console.error(`[ERROR] ${message}`, meta ? meta : '')
  },
  warn: (message: string, meta?: any): void => {
    console.warn(`[WARN] ${message}`, meta ? meta : '')
  },
  debug: (message: string, meta?: any): void => {
    console.debug(`[DEBUG] ${message}`, meta ? meta : '')
  },
}

const defaultConfig: ScriptConfig = {
  batchSize: 1000,
  maxRetries: 3,
  retryDelay: 1000,
  rmqHost: process.env.RMQ_HOST || 'localhost',
  rmqPort: parseInt(process.env.RMQ_PORT || '5672'),
  rmqUser: process.env.RMQ_USER || 'guest',
  rmqPass: process.env.RMQ_PASS || 'guest',
  dryRun: false,
  inputFile: '',
}

function setupCLI(): ScriptConfig {
  const program = new Command()

  program
    .name('publishRepairedData')
    .description('Publish repaired data from healArchiver to RMQ exchanges')
    .requiredOption('-i, --input <file>', 'Input repair data file')
    .option('-b, --batch-size <number>', 'Batch size for processing', '1000')
    .option('--dry-run', 'Run without publishing to RMQ')
    .parse(process.argv)

  const options = program.opts()

  return {
    ...defaultConfig,
    inputFile: options.input,
    batchSize: parseInt(options.batchSize),
    dryRun: options.dryRun,
  }
}

const rmqPublisher = new RMQDataPublisher()

interface BatchResult {
  published: number
  failed: number
}

interface PublishResult {
  cycles: BatchResult
  receipts: BatchResult
  transactions: BatchResult
}

class DataRepairPublisher {
  private rmqPublisher: RMQDataPublisher
  private repairData: MissingData
  private config: ScriptConfig

  constructor(config: ScriptConfig) {
    this.rmqPublisher = rmqPublisher
    this.repairData = {
      cycles: [],
      receipts: [],
      accounts: [],
      transactions: [],
      timestamp: 0,
    }
    this.config = config
  }

  async loadRepairData(): Promise<void> {
    try {
      const data = JSON.parse(readFileSync(this.config.inputFile, 'utf-8')) as MissingData

      if (!Array.isArray(data.cycles) || !Array.isArray(data.receipts) || !Array.isArray(data.transactions)) {
        throw new Error('Invalid data structure: missing required arrays')
      }

      const invalidCycles = data.cycles.filter((cycle) => typeof cycle.counter !== 'number' || cycle.counter < 0)
      if (invalidCycles.length > 0) {
        throw new Error(`Invalid cycle numbers found: ${invalidCycles.map((c) => c.counter).join(', ')}`)
      }

      const invalidReceipts = data.receipts.filter((receipt) => !receipt.id || typeof receipt.cycle !== 'number')
      if (invalidReceipts.length > 0) {
        throw new Error(`Invalid receipt data found: ${invalidReceipts.map((r) => r.id).join(', ')}`)
      }

      const invalidTxs = data.transactions.filter((tx) => !tx.id || typeof tx.cycle !== 'number')
      if (invalidTxs.length > 0) {
        throw new Error(`Invalid transaction data found: ${invalidTxs.map((t) => t.id).join(', ')}`)
      }

      this.repairData = data
      logger.info(`Loaded repair data from ${this.config.inputFile}`, {
        totalItems: data.cycles.length + data.receipts.length + data.transactions.length,
        cycles: data.cycles.length,
        receipts: data.receipts.length,
        transactions: data.transactions.length,
      })
    } catch (error) {
      logger.error(`Failed to load repair data from ${this.config.inputFile}`, { error })
      throw error
    }
  }

  async init(): Promise<void> {
    try {
      await dbstore.initializeDB(distributorConfig)

      if (!this.config.dryRun) {
        await this.rmqPublisher.start()
        logger.info('Initialized DataRepairPublisher with RMQ connection')
      } else {
        logger.info('Initialized DataRepairPublisher in dry run mode')
      }
    } catch (error) {
      logger.error('Failed to initialize DataRepairPublisher', { error })
      throw error
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.rmqPublisher.cleanUp()
      await dbstore.closeDatabases()
      logger.info('Cleaned up DataRepairPublisher')
    } catch (error) {
      logger.error('Failed to cleanup DataRepairPublisher', { error })
      throw error
    }
  }

  async fetchRepairedCycles(cycleIds: number[]): Promise<CycleRecord[]> {
    try {
      if (cycleIds.length === 0) {
        return []
      }

      const cycles: CycleRecord[] = []
      for (const cycleId of cycleIds) {
        const batch = await CycleDB.queryCycleRecordsBetween(cycleId, cycleId)
        if (batch && batch.length > 0) {
          cycles.push(...batch)
        }
      }

      logger.info(`Found ${cycles.length} cycles in database`)
      return cycles
    } catch (error) {
      logger.error('Failed to fetch repaired cycles', { error })
      throw error
    }
  }

  async fetchRepairedReceipts(receiptIds: string[]): Promise<Receipt[]> {
    try {
      if (receiptIds.length === 0) {
        return []
      }

      const receipts: Receipt[] = []
      for (const receiptId of receiptIds) {
        const receipt = await ReceiptDB.queryReceiptByReceiptId(receiptId)
        if (receipt) {
          receipts.push(receipt)
        }
      }

      logger.info(`Found ${receipts.length} receipts in database`)
      return receipts
    } catch (error) {
      logger.error('Failed to fetch repaired receipts', { error })
      throw error
    }
  }

  async fetchRepairedTransactions(txIds: string[]): Promise<OriginalTxData[]> {
    try {
      if (txIds.length === 0) {
        return []
      }

      const transactions: OriginalTxData[] = []
      for (const txId of txIds) {
        const tx = await OriginalTxsDataDB.queryOriginalTxDataByTxId(txId)
        if (tx) {
          transactions.push(tx)
        }
      }

      logger.info(`Found ${transactions.length} transactions in database`)
      return transactions
    } catch (error) {
      logger.error('Failed to fetch repaired transactions', { error })
      throw error
    }
  }

  private async publishWithRetries<T>(
    publishFn: () => Promise<void>,
    label: string,
    batchNum: number
  ): Promise<boolean> {
    if (this.config.dryRun) {
      logger.info(`[DRY RUN] Would publish ${label} batch ${batchNum}`)
      return true
    }

    let attempt = 0
    while (attempt < this.config.maxRetries) {
      try {
        await publishFn()
        logger.info(`Successfully published ${label} batch ${batchNum}`)
        return true
      } catch (error) {
        attempt++
        logger.warn(`Failed to publish ${label} batch ${batchNum} (attempt ${attempt}/${this.config.maxRetries})`, {
          error,
        })
        if (attempt < this.config.maxRetries) {
          await sleep(this.config.retryDelay)
        }
      }
    }
    return false
  }

  private async publishBatch<T>(
    items: T[],
    publishFn: (batch: T[]) => Promise<void>,
    label: string
  ): Promise<BatchResult> {
    const batchSize = this.config.batchSize
    const batches = this.batchArray(items, batchSize)
    const result: BatchResult = { published: 0, failed: 0 }
    const totalBatches = batches.length

    logger.info(`Starting to process ${totalBatches} batches of ${label}`)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const progress = (((i + 1) / totalBatches) * 100).toFixed(1)

      try {
        const ok = await this.publishWithRetries(() => publishFn(batch), label, i + 1)
        if (ok) {
          result.published += batch.length
          logger.info(`Progress: ${progress}% - Published batch ${i + 1}/${totalBatches} of ${label}`)
        } else {
          result.failed += batch.length
          logger.warn(`Progress: ${progress}% - Failed batch ${i + 1}/${totalBatches} of ${label}`)
        }
      } catch (error) {
        result.failed += batch.length
        logger.error(`Progress: ${progress}% - Error processing batch ${i + 1}/${totalBatches} of ${label}`, { error })
      }
    }

    logger.info(`Completed processing ${label}`, {
      total: items.length,
      published: result.published,
      failed: result.failed,
      successRate: ((result.published / items.length) * 100).toFixed(1) + '%',
    })

    return result
  }

  private batchArray<T>(arr: T[], batchSize: number): T[][] {
    const batches: T[][] = []
    for (let i = 0; i < arr.length; i += batchSize) {
      batches.push(arr.slice(i, i + batchSize))
    }
    return batches
  }

  private async extractIds(): Promise<{
    cycleIds: number[]
    receiptIds: string[]
    txIds: string[]
  }> {
    const cycleIds = this.repairData.cycles.map((cycle) => cycle.counter)
    const receiptIds = this.repairData.receipts.map((receipt) => receipt.id)
    const txIds = this.repairData.transactions.map((tx) => tx.id)

    return { cycleIds, receiptIds, txIds }
  }

  private async writeSummaryFile(summary: PublishSummary): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputDir = join(__dirname, 'output')
    const summaryPath = join(outputDir, `publish-summary-${timestamp}.json`)
    try {
      if (!fs.existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true })
      }
      await writeFile(summaryPath, JSON.stringify(summary, null, 2))
      logger.info(`Summary written to ${summaryPath}`)
    } catch (error) {
      logger.error(`Failed to write summary file`, { error })
    }
  }

  private async writeRetryFile(failedItems: PublishSummary['failedItems']): Promise<void> {
    if (!failedItems) return
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputDir = join(__dirname, 'output')
    const retryPath = join(outputDir, `retry-items-${timestamp}.json`)
    const retryData: MissingData = {
      cycles: failedItems.cycles.map((item) => ({ counter: item.counter, majorityHash: item.majorityHash })),
      receipts: failedItems.receipts.map((item) => ({
        id: item.id,
        cycle: item.cycle,
        majorityHash: item.majorityHash,
      })),
      accounts: [],
      transactions: failedItems.transactions.map((item) => ({
        id: item.id,
        cycle: item.cycle,
        majorityHash: item.majorityHash,
      })),
      timestamp: Date.now(),
    }
    try {
      if (!fs.existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true })
      }
      await writeFile(retryPath, JSON.stringify(retryData, null, 2))
      logger.info(`Retry file written to ${retryPath}`)
    } catch (error) {
      logger.error(`Failed to write retry file`, { error })
    }
  }

  private async trackFailedItems(
    cycles: CycleRecord[],
    receipts: Receipt[],
    transactions: OriginalTxData[],
    results: PublishResult
  ): Promise<PublishSummary['failedItems']> {
    const failedItems: PublishSummary['failedItems'] = {
      cycles: [],
      receipts: [],
      transactions: [],
    }

    if (results.cycles.failed > 0) {
      const failedCycles = cycles.slice(-results.cycles.failed)
      failedItems.cycles = failedCycles.map((cycle) => {
        const cycleData = this.repairData.cycles.find((c) => c.counter === cycle.counter)
        return {
          counter: cycle.counter,
          majorityHash: cycleData?.majorityHash || '',
        }
      })
    }

    if (results.receipts.failed > 0) {
      const failedReceipts = receipts.slice(-results.receipts.failed)
      failedItems.receipts = failedReceipts.map((receipt) => {
        const receiptData = this.repairData.receipts.find((r) => r.id === receipt.receiptId)
        return {
          id: receipt.receiptId,
          cycle: receipt.cycle,
          majorityHash: receiptData?.majorityHash || '',
        }
      })
    }

    if (results.transactions.failed > 0) {
      const failedTxs = transactions.slice(-results.transactions.failed)
      failedItems.transactions = failedTxs.map((tx) => {
        const txData = this.repairData.transactions.find((t) => t.id === tx.txId)
        return {
          id: tx.txId,
          cycle: tx.cycle,
          majorityHash: txData?.majorityHash || '',
        }
      })
    }

    return failedItems
  }

  async publishRepairedData(): Promise<PublishResult> {
    try {
      const { cycleIds, receiptIds, txIds } = await this.extractIds()

      const [cycles, receipts, transactions] = await Promise.all([
        this.fetchRepairedCycles(cycleIds),
        this.fetchRepairedReceipts(receiptIds),
        this.fetchRepairedTransactions(txIds),
      ])

      logger.info('Fetched repaired data', {
        cycles: cycles.length,
        receipts: receipts.length,
        transactions: transactions.length,
      })

      const [cycleResult, receiptResult, txResult] = await Promise.all([
        this.publishBatch(cycles, (batch) => this.rmqPublisher.publishCycles(batch as CycleData[]), 'cycles'),
        this.publishBatch(receipts, (batch) => this.rmqPublisher.publishReceipts(batch), 'receipts'),
        this.publishBatch(transactions, (batch) => this.rmqPublisher.publishTransactions(batch), 'transactions'),
      ])

      const result: PublishResult = {
        cycles: cycleResult,
        receipts: receiptResult,
        transactions: txResult,
      }

      const summary: PublishSummary = {
        timestamp: Date.now(),
        totalProcessed: {
          cycles: cycles.length,
          receipts: receipts.length,
          transactions: transactions.length,
        },
        published: {
          cycles: cycleResult.published,
          receipts: receiptResult.published,
          transactions: txResult.published,
        },
        failed: {
          cycles: cycleResult.failed,
          receipts: receiptResult.failed,
          transactions: txResult.failed,
        },
      }

      if (cycleResult.failed > 0 || receiptResult.failed > 0 || txResult.failed > 0) {
        summary.failedItems = await this.trackFailedItems(cycles, receipts, transactions, result)
        await this.writeRetryFile(summary.failedItems)
      }

      await this.writeSummaryFile(summary)

      logger.info('Publishing complete', { result })
      return result
    } catch (error) {
      logger.error('Failed to publish repaired data', { error })
      throw error
    }
  }
}

async function main(scriptConfig: ScriptConfig): Promise<void> {
  const publisher = new DataRepairPublisher(scriptConfig)

  try {
    await publisher.init()
    await publisher.loadRepairData()
    await publisher.publishRepairedData()
  } catch (error) {
    logger.error('Failed to execute DataRepairPublisher', { error })
    process.exit(1)
  } finally {
    await publisher.cleanup()
  }
}

if (require.main === module) {
  const scriptConfig = setupCLI()
  main(scriptConfig).catch((error) => {
    logger.error('Unhandled error in main execution', { error })
    process.exit(1)
  })
}
