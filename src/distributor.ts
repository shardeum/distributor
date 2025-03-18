import * as v8 from 'v8'
import { join } from 'path'
import * as Logger from './Logger'
import * as dbstore from './dbstore'
import type { Worker } from 'cluster'
import * as clusterModule from 'cluster'
import { initHttpServer, initWorker } from './child-process'
import { setHashKey, initLogger } from './utils'
import { config, distributorMode, overrideDefaultConfig } from './Config'

import {
  workerClientMap,
  workerProcessMap,
  refreshSubscribers,
  updateConfigAndSubscriberList,
  registerWorkerMessageListener,
} from './distributor/utils'
import RMQDataPublisher from './distributor/rmq_data_publisher'
import { CheckpointDao } from './dbstore/checkpoints'
import { initRMQModeHttpServer } from './distributor/rmq_healthcheck_server'
import RMQModeHeathCheck from './distributor/rmq_healthcheck_service'
import { setInitialDataLogReaderMetrics } from './metrics'

const cluster = clusterModule as unknown as clusterModule.Cluster
// Override default config params from config file, env vars, and cli args
const file = join(process.cwd(), 'distributor-config.json')
const { argv, env } = process

const spawnWorker = (): Worker => {
  const worker: Worker = cluster.fork()
  workerClientMap.set(worker, [])
  workerProcessMap.set(worker.process.pid, worker)
  registerWorkerMessageListener(worker)
  if (config.limitToSubscribersOnly) refreshSubscribers()
  return worker
}

const initDistributor = async (): Promise<void> => {
  // Common logic for both parent and worker processes
  overrideDefaultConfig(file, env, argv)

  // Set crypto hash keys from config
  const hashKey = config.DISTRIBUTOR_HASH_KEY
  setHashKey(hashKey)
  initLogger()
  addSigListeners()
  updateConfigAndSubscriberList()

  if (cluster.isPrimary) {
    // Primary/Parent Process Logic
    Logger.mainLogger.debug(`Distributor Master Process (${process.pid}) Started`)
    for (let i = 0; i < config.NUMBER_OF_WORKERS; i++) {
      // const worker: Worker = cluster.fork({
      //   execArgv: process.execArgv.concat([`--inspect=0.0.0.0:${9229 + i}`])
      // });
      const worker = spawnWorker()
      console.log(`⛏️ Worker ${worker.process.pid} started`)
    }

    cluster.on('exit', (worker: Worker, code: number, signal: string) => {
      Logger.mainLogger.debug(`❌ Worker ${worker.process.pid} exited with code ${code} and signal ${signal}`)
      const outGoingWorker = workerProcessMap.get(worker.process.pid)
      if (outGoingWorker) {
        workerClientMap.delete(outGoingWorker)
        workerProcessMap.delete(outGoingWorker.process.pid)
      }
      const newWorker = spawnWorker()
      Logger.mainLogger.debug(`⛏️ Worker ${newWorker.process.pid} started to replace the terminated one`)
    })

    console.log(`Primary Process Heap Memory limit: ${v8.getHeapStatistics().heap_size_limit / 1024 / 1024} MB`)
    setInterval(() => {
      const memoryUsage = process.memoryUsage()
      console.log(
        `Primary Process Heap Used: ${memoryUsage.heapUsed / 1024 / 1024} MB / ${memoryUsage.heapTotal / 1024 / 1024} MB`
      )
    }, 30000) // log every 30 seconds
  } else {
    if (config.distributorMode == distributorMode.WS) {
      await initWorker()
    }
    // Worker Process Logic
    await dbstore.initializeDB(config)
    await setInitialDataLogReaderMetrics()
    const { worker } = cluster
    await initHttpServer(worker)
    console.log(
      `Worker ${worker.process.pid} > Heap Memory limit: ${v8.getHeapStatistics().heap_size_limit / 24 / 1024} MB`
    )
    setInterval(() => {
      const memoryUsage = process.memoryUsage()
      console.log(
        `Heap Used in Worker ${worker.process.pid}: ${memoryUsage.heapUsed / 1024 / 1024} MB / ${memoryUsage.heapTotal / 1024 / 1024} MB`
      )
    }, 30000) // log every 30 seconds
  }
}

const addSigListeners = (): void => {
  process.on('SIGUSR1', async () => {
    // Reload the distributor-config.json
    overrideDefaultConfig(file, env, argv)
    Logger.mainLogger.debug('Config reloaded', config)
    Logger.mainLogger.debug('DETECTED SIGUSR1 SIGNAL @: ', process.pid)
    console.log('DETECTED SIGUSR1 SIGNAL @: ', process.pid)
    if (cluster.isPrimary) {
      // Check for expired subscribers in the updated config
      if (config.limitToSubscribersOnly) refreshSubscribers()
    } else {
      // Refresh the list of subscribers in every worker process
      updateConfigAndSubscriberList()
    }
  })
  process.on('SIGINT', async () => {
    console.log('Exiting on SIGINT')
    if (!cluster.isPrimary) await dbstore.closeDatabases()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    console.log('Exiting on SIGTERM')
    if (!cluster.isPrimary) await dbstore.closeDatabases()
    process.exit(0)
  })
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception in Distributor: ', error)
  })
  Logger.mainLogger.debug('Registered signal listeners.')
}

const initDistributorMQMode = async (): Promise<void> => {
  const rmqDataPublisher = new RMQDataPublisher()
  initLogger()
  await dbstore.initializeDB(config)
  await CheckpointDao.init()
  addSigListeners()
  updateConfigAndSubscriberList()

  const rmqHealthCheck = new RMQModeHeathCheck(rmqDataPublisher)
  await initRMQModeHttpServer(rmqHealthCheck)

  rmqDataPublisher.start()

  process.on('SIGTERM', async () => {
    console.log('Exiting initDistributorMQMode on SIGTERM')
    await rmqDataPublisher.cleanUp()
    CheckpointDao.close()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    console.log('Exiting initDistributorMQMode on SIGTERM')
    await rmqDataPublisher.cleanUp()
    CheckpointDao.close()
    process.exit(0)
  })
}

if (config.distributorMode === distributorMode.MQ) {
  console.log(`Initiating Distributor in MQ mode`)
  initDistributorMQMode()
} else {
  console.log(`Initiating Distributor in WS mode`)
  initDistributor()
}
