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
import fs from 'fs'

dotenvConfig()

const configFile = join(__dirname, '../distributor-config.json')
overrideDefaultConfig(configFile, process.env, process.argv)

interface RepairData {
  archiverId: string
  repairedItems: {
    cycles: Array<{
      counter: number
      majorityHash: string
      repairedAt: string
    }>
    receipts: Array<{
      id: string
      cycle: number
      majorityHash: string
      repairedAt: string
    }>
    transactions: Array<{
      id: string
      cycle: number
      majorityHash: string
      repairedAt: string
    }>
  }
  timestamp: number
  metadata: {
    healArchiverVersion: string
    repairSessionId: string
    totalItemsRepaired: number
  }
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
  private repairData: RepairData
  private config: ScriptConfig

  constructor(config: ScriptConfig) {
    this.rmqPublisher = rmqPublisher
    this.repairData = {
      archiverId: '',
      repairedItems: {
        cycles: [],
        receipts: [],
        transactions: [],
      },
      timestamp: 0,
      metadata: {
        healArchiverVersion: '',
        repairSessionId: '',
        totalItemsRepaired: 0,
      },
    }
    this.config = config
  }

  async loadRepairData(): Promise<void> {
    try {
      const data = JSON.parse(readFileSync(this.config.inputFile, 'utf-8'))
      this.repairData = data
      logger.info(`Loaded repair data from ${this.config.inputFile}`, {
        archiverId: data.archiverId,
        totalItems: data.metadata.totalItemsRepaired,
      })
    } catch (error) {
      logger.error(`Failed to load repair data from ${this.config.inputFile}`, { error })
      throw error
    }
  }

  async init(): Promise<void> {
    try {
      await dbstore.initializeDB(distributorConfig)

      await this.rmqPublisher.start()

      logger.info('Initialized DataRepairPublisher')
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
      let skip = 0
      const limit = this.config.batchSize
      let hasMore = true

      while (hasMore) {
        const batch = await CycleDB.queryCycleRecordsBetween(skip, skip + limit - 1)
        if (!batch || batch.length === 0) {
          hasMore = false
          break
        }

        const matchingCycles = batch.filter((cycle) => cycleIds.includes(cycle.counter))
        cycles.push(...matchingCycles)

        if (batch.length < limit) {
          hasMore = false
        } else {
          skip += limit
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
      let skip = 0
      const limit = this.config.batchSize
      let hasMore = true

      while (hasMore) {
        const batch = await ReceiptDB.queryReceipts(skip, limit)
        if (!batch || batch.length === 0) {
          hasMore = false
          break
        }

        const matchingReceipts = batch.filter((receipt) => receiptIds.includes(receipt.receiptId))
        receipts.push(...matchingReceipts)

        if (batch.length < limit) {
          hasMore = false
        } else {
          skip += limit
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
      let skip = 0
      const limit = this.config.batchSize
      let hasMore = true

      while (hasMore) {
        const batch = await OriginalTxsDataDB.queryOriginalTxsData(skip, limit)
        if (!batch || batch.length === 0) {
          hasMore = false
          break
        }

        const matchingTxs = batch.filter((tx) => txIds.includes(tx.txId))
        transactions.push(...matchingTxs)

        if (batch.length < limit) {
          hasMore = false
        } else {
          skip += limit
        }
      }

      logger.info(`Found ${transactions.length} original transactions in database`)
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

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const ok = await this.publishWithRetries(() => publishFn(batch), label, i + 1)
      if (ok) result.published += batch.length
      else result.failed += batch.length
    }

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
    const cycleIds = this.repairData.repairedItems.cycles.map((cycle) => cycle.counter)
    const receiptIds = this.repairData.repairedItems.receipts.map((receipt) => receipt.id)
    const txIds = this.repairData.repairedItems.transactions.map((tx) => tx.id)

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
    const retryData: RepairData = {
      archiverId: this.repairData.archiverId,
      repairedItems: {
        cycles: failedItems.cycles.map((item) => ({
          counter: item.counter,
          majorityHash: item.majorityHash,
          repairedAt: new Date().toISOString(),
        })),
        receipts: failedItems.receipts.map((item) => ({
          id: item.id,
          cycle: item.cycle,
          majorityHash: item.majorityHash,
          repairedAt: new Date().toISOString(),
        })),
        transactions: failedItems.transactions.map((item) => ({
          id: item.id,
          cycle: item.cycle,
          majorityHash: item.majorityHash,
          repairedAt: new Date().toISOString(),
        })),
      },
      timestamp: Date.now(),
      metadata: {
        healArchiverVersion: this.repairData.metadata.healArchiverVersion,
        repairSessionId: `retry-${timestamp}`,
        totalItemsRepaired: failedItems.cycles.length + failedItems.receipts.length + failedItems.transactions.length,
      },
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
        const cycleData = this.repairData.repairedItems.cycles.find((c) => c.counter === cycle.counter)
        return {
          counter: cycle.counter,
          majorityHash: cycleData?.majorityHash || '',
        }
      })
    }

    if (results.receipts.failed > 0) {
      const failedReceipts = receipts.slice(-results.receipts.failed)
      failedItems.receipts = failedReceipts.map((receipt) => {
        const receiptData = this.repairData.repairedItems.receipts.find((r) => r.id === receipt.receiptId)
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
        const txData = this.repairData.repairedItems.transactions.find((t) => t.id === tx.txId)
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

export { DataRepairPublisher, RepairData, ScriptConfig }
