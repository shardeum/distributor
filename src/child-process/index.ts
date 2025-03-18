import * as url from 'url'
import * as net from 'net'
import * as http from 'http'
import * as Logger from '../Logger'

import { config, distributorMode } from '../Config'
import DataLogReader from '../log-reader'
import fastifyCors from '@fastify/cors'
import type { Worker } from 'node:cluster'
import { handleSocketRequest, registerParentProcessListener, registerDataReaderListeners } from './child'
import Fastify, { FastifyInstance } from 'fastify'
import fastifyRateLimit from '@fastify/rate-limit'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { registerRoutes, validateRequestData } from '../api'
import { healthCheckRouter } from '../routes/healthCheck'

interface ClientRequestDataInterface {
  header: object
  socket: net.Socket
}

let httpServer: http.Server
export const workerClientMap = new Map<Worker, string[]>()

const connectToSocketClient = (clientKey: string, clientRequestData: ClientRequestDataInterface): void => {
  try {
    handleSocketRequest({ ...clientRequestData.header, socket: clientRequestData.socket, clientKey })
  } catch (e) {
    throw new Error(`Error in connectToSocketClient(): ${e}`)
  }
}

export const initHttpServer = async (worker: Worker): Promise<void> => {
  const serverFactory = (handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): http.Server => {
    httpServer = http.createServer((req, res) => {
      handler(req, res)
    })
    return httpServer
  }

  const fastifyServer = Fastify({ serverFactory })
  await fastifyServer.register(fastifyCors)
  await fastifyServer.register(fastifyRateLimit, {
    global: true,
    max: config.RATE_LIMIT,
    timeWindow: 10,
    allowList: ['127.0.0.1', '0.0.0.0'], // Excludes local IPs from rate limits
  })
  await fastifyServer.register(healthCheckRouter)

  fastifyServer.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const jsonString = typeof body === 'string' ? body : body.toString('utf8')
      done(null, StringUtils.safeJsonParse(jsonString))
    } catch (err) {
      err.statusCode = 400
      done(err, undefined)
    }
  })

  fastifyServer.setReplySerializer((payload) => {
    return StringUtils.safeStringify(payload)
  })

  // Register API routes
  registerRoutes(fastifyServer as FastifyInstance<http.Server, http.IncomingMessage, http.ServerResponse>)

  initSocketServer(httpServer, worker)

  registerParentProcessListener()
  // Start server and bind to port on all interfaces
  fastifyServer.ready(() => {
    httpServer.listen(config.DISTRIBUTOR_PORT, () => {
      console.log(`Distributor-Server (${process.pid}) listening on port ${config.DISTRIBUTOR_PORT}.`)
      Logger.mainLogger.debug(`API-Server started on Worker Process (${process.pid}).`)
      return
    })

    httpServer.on('error', (err) => {
      Logger.mainLogger.error('Distributor failed to start.', err)
      process.exit(1)
    })
  })
}

const initSocketServer = async (httpServer: http.Server, worker: Worker): Promise<void> => {
  // Handles incoming upgrade requests from clients (to upgrade to a Socket connection)
  httpServer.on('upgrade', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const queryObject = url.parse(req.url!, true).query
    const decodedData = decodeURIComponent(queryObject.data as string)
    const clientData = StringUtils.safeJsonParse(decodedData)

    const auth = validateRequestData(clientData, {
      collectorInfo: 'o',
      sender: 's',
      sign: 'o',
    })
    if (auth.success) {
      const clientKey = clientData.sender
      connectToSocketClient(clientKey, {
        header: { headers: req.headers, method: req.method, head, clientKey },
        socket,
      })
    } else {
      Logger.mainLogger.debug(`❌ Unauthorized Client Request from ${req.headers.host}, Reason: ${auth.error}`)

      socket.write('HTTP/1.1 401 Unauthorized\r\n')
      socket.write('Content-Type: text/plain\r\n')
      socket.write('Connection: close\r\n')
      socket.write('Unauthorized: Authentication failed\r\n')

      socket.end()
      return
    }
  })
}

export const initWorker = async (): Promise<void> => {
  try {
    if (config.distributorMode === distributorMode.MQ) {
      return
    }
    const DATA_LOG_PATH = config.DATA_LOG_DIR
    const cycleReader = new DataLogReader(DATA_LOG_PATH, 'cycle')
    const receiptReader = new DataLogReader(DATA_LOG_PATH, 'receipt')
    const originalTxReader = new DataLogReader(DATA_LOG_PATH, 'originalTx')
    await Promise.all([receiptReader.init(), cycleReader.init(), originalTxReader.init()])
    registerDataReaderListeners(cycleReader)
    registerDataReaderListeners(receiptReader)
    registerDataReaderListeners(originalTxReader)
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error(
        '❌ Path to the data-logs directory does not exist. Please check the path in the config file.\n Current Path: ',
        config.DATA_LOG_DIR
      )
      process.exit(0)
    } else {
      console.error('Error in Child Process: ', e.message, e.code)
    }
  }
}
