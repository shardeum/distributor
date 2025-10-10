/* eslint-disable security/detect-object-injection */
import { readFileSync } from 'fs'
import * as Logger from './Logger'
import * as merge from 'deepmerge'
import * as minimist from 'minimist'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'

export enum distributorMode {
  WS = 'WS',
  MQ = 'MQ',
}

export interface Config {
  DISTRIBUTOR_IP: string
  DISTRIBUTOR_PORT: number
  DISTRIBUTOR_HASH_KEY: string
  DISTRIBUTOR_PUBLIC_KEY: string
  DISTRIBUTOR_SECRET_KEY: string
  ARCHIVER_DB_DIR: string
  ARCHIVER_DATA: {
    cycleDB: string
    accountDB: string
    transactionDB: string
    receiptDB: string
    originalTxDataDB: string
  }
  DISTRIBUTOR_LOGS: string
  RATE_LIMIT: number
  VERBOSE: boolean
  DATA_LOG_DIR: string
  FILE_STREAM_INTERVAL_MS: number
  NUMBER_OF_WORKERS: number
  MAX_CLIENTS_PER_CHILD: number
  limitToSubscribersOnly: boolean
  subscribers: [] | Subscriber[]
  distributorMode: string
  MQ_DISTRIBUTOR_SERVER_PORT: number
  stopDistributionAtCycle: number
}

let config: Config = {
  DISTRIBUTOR_IP: 'localhost',
  DISTRIBUTOR_PORT: 6100,
  DISTRIBUTOR_HASH_KEY: '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc',
  DISTRIBUTOR_PUBLIC_KEY:
    process.env.DISTRIBUTOR_PUBLIC_KEY || '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3',
  DISTRIBUTOR_SECRET_KEY:
    process.env.DISTRIBUTOR_SECRET_KEY ||
    '3be00019f23847529bd63e41124864983175063bb524bd54ea3c155f2fa12969758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3',
  ARCHIVER_DB_DIR: 'archiverdb.sqlite3',
  ARCHIVER_DATA: {
    cycleDB: 'cycles.sqlite3',
    accountDB: 'accounts.sqlite3',
    transactionDB: 'transactions.sqlite3',
    receiptDB: 'receipts.sqlite3',
    originalTxDataDB: 'originalTxsData.sqlite3',
  },
  DISTRIBUTOR_LOGS: 'distributor-logs',
  RATE_LIMIT: 100, // 100 req per second,
  DATA_LOG_DIR: '../../../collector/data-logs', // Directory to store data log files written by archiver/collector
  FILE_STREAM_INTERVAL_MS: 100, // Check for new data every 100 ms
  NUMBER_OF_WORKERS: 5,
  MAX_CLIENTS_PER_CHILD: 2,
  VERBOSE: false,
  limitToSubscribersOnly: false,
  subscribers: [],
  distributorMode: process.env.DISTRIBUTOR_MODE || distributorMode.WS.toString(),
  MQ_DISTRIBUTOR_SERVER_PORT: 6101,
  stopDistributionAtCycle: -1, // -1 means no limit, any positive number will stop distribution at that cycle
}

export interface Subscriber {
  publicKey: string
  expirationTimestamp: number
  subscriptionType: SubscriptionType
}

export interface ClientInterface {
  Worker_PID: number
  Client_PubKeys: string[]
}

export enum SubscriptionType {
  FIREHOSE = 'FIREHOSE',
  ACCOUNTS = 'ACCOUNTS',
}

export function overrideDefaultConfig(file: string, env: NodeJS.ProcessEnv, args: string[]): void {
  // Override config from config file
  try {
    // Disabling eslint rule because the file is not user-controlled and is a static path
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const fileConfig = StringUtils.safeJsonParse(readFileSync(file, { encoding: 'utf8' }))
    const overwriteMerge = (target: [], source: []): [] => source
    config = merge(config, fileConfig, { arrayMerge: overwriteMerge })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Failed to parse config file:', err)
    }
  }

  // Override config from env vars
  for (const param in config) {
    if (env[param]) {
      switch (typeof config[param]) {
        case 'number': {
          config[param] = Number(env[param])
          break
        }
        case 'string': {
          config[param] = String(env[param])
          break
        }
        case 'object': {
          try {
            const parameterStr = env[param]
            if (parameterStr) {
              const parameterObj = StringUtils.safeJsonParse(parameterStr)
              config[param] = parameterObj
            }
          } catch (e) {
            Logger.mainLogger.error(e)
            Logger.mainLogger.error('Unable to JSON parse', env[param])
          }
          break
        }
        case 'boolean': {
          config[param] = String(env[param]).toLowerCase() === 'true'
          break
        }
        // Default case was removed because it was an empty block. Will exit if no cases match.
      }
    }
  }

  // Override config from cli args
  const parsedArgs = minimist(args.slice(2))
  for (const param of Object.keys(config)) {
    if (parsedArgs[param]) {
      switch (typeof config[param]) {
        case 'number': {
          config[param] = Number(parsedArgs[param])
          break
        }
        case 'string': {
          config[param] = String(parsedArgs[param])
          break
        }
        case 'boolean': {
          if (typeof parsedArgs[param] === 'boolean') {
            config[param] = parsedArgs[param]
          } else {
            config[param] = String(parsedArgs[param]).toLowerCase() === 'true'
          }
          break
        }
        // Default case was removed because it was an empty block. Will exit if no cases match.
      }
    }
  }
}

export { config }
