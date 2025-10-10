import * as WebSocket from 'ws'
import * as Crypto from '../utils/Crypto'
import { join } from 'path'
import { config, overrideDefaultConfig } from '../Config'
import DataLogReader from '../log-reader'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { incrementCycleCount, incrementOriginalTxCount, incrementReceiptCount } from '../metrics'

const FILE = join(process.cwd(), 'distributor-config.json')
overrideDefaultConfig(FILE, process.env, process.argv)
Crypto.setCryptoHashKey(config.DISTRIBUTOR_HASH_KEY)

enum SocketCloseCodes {
  DUPLICATE_CONNECTION_CODE = 1000,
  SUBSCRIBER_EXPIRATION_CODE,
}

const wss = new WebSocket.Server({ noServer: true })

const socketClientMap = new Map<string, WebSocket.WebSocket>()

//interface for dataProp
interface DataPropInterface {
  headers?: Record<string, string>
  socket: WebSocket
  head?: Buffer
  clientKey?: string
  type?: string
  data?: string
}

export const handleSocketRequest = (dataProp: DataPropInterface): void => {
  if (dataProp.headers) {
    wss.handleUpgrade(dataProp, dataProp.socket, dataProp.head, (ws: WebSocket.WebSocket) => {
      const clientId = dataProp.clientKey
      if (socketClientMap.has(clientId)) {
        console.info('Duplicate Connection Found. Closing previous connection.')
        socketClientMap.get(clientId).close(1000)
      }
      socketClientMap.set(clientId, ws)
      // Sending Client-ID to Parent Process for managing subscribers
      process.send!({
        type: 'client_connected',
        data: clientId,
      })

      ws.on('close', (code) => {
        switch (code) {
          case SocketCloseCodes.DUPLICATE_CONNECTION_CODE:
            console.log(`❌ Connection with Duplicate Client (${clientId}) Terminated.`)
            // Note: Since this event is triggered originally from the parent process, we don't need to send a message to the parent process
            break
          case SocketCloseCodes.SUBSCRIBER_EXPIRATION_CODE:
            console.log(`❌ Expired Subscriber (${clientId}) Closed.`)
            process.send!({
              type: 'client_expired',
              data: clientId,
            })
            break
          default:
            process.send!({
              type: 'client_close',
              data: clientId,
            })
            console.log(`❌ Connection with Client (${clientId}) Closed.`)
        }
        if (socketClientMap.has(clientId)) socketClientMap.delete(clientId)
      })
    })
  }
}

export const registerParentProcessListener = (): void => {
  process.on('message', (dataProp: DataPropInterface) => {
    const clientId = dataProp.data
    switch (dataProp.type) {
      case 'remove_subscriber':
        socketClientMap.get(clientId).close(1001)
        console.log(`❌ Expired Subscription Client (${clientId}) Removed.`)
        break
      case 'close_duplicate_connection':
        socketClientMap.get(clientId).close(1000)
        console.log(`❌ Duplicate Client Connection Removed.`)
        break
    }
  })
}
const sendDataToAllClients = ({ signedData }: { signedData: Record<string, unknown> }): void => {
  for (const client of socketClientMap.values()) {
    client.send(
      StringUtils.safeStringify({
        ...signedData,
      })
    )
  }
}

export const registerDataReaderListeners = (reader: DataLogReader): void => {
  reader.on(`${reader.dataName}-data`, (logData: unknown) => {
    try {
      const data: {
        cycle?: unknown
        receipt?: unknown
        originalTx?: unknown
      } = {}
      let dataCycle = -1
      switch (reader.dataName) {
        case 'cycle':
          data.cycle = logData
          dataCycle = (logData as { counter: number })?.counter
          incrementCycleCount()
          break
        case 'receipt':
          data.receipt = logData
          dataCycle = (logData as { cycle: number })?.cycle
          incrementReceiptCount()
          break
        case 'originalTx':
          data.originalTx = logData
          dataCycle = (logData as { cycle: number })?.cycle
          incrementOriginalTxCount()
          break
      }

      // Check if distribution should stop at a specific cycle
      if (config.stopDistributionAtCycle >= 0 && dataCycle >= config.stopDistributionAtCycle) {
        console.log(
          `⛔ Distribution stopped: data cycle ${dataCycle} has reached or exceeded stopDistributionAtCycle ${config.stopDistributionAtCycle}`
        )
        return
      }

      sendDataToAllClients({
        signedData: Crypto.sign(data, config.DISTRIBUTOR_SECRET_KEY, config.DISTRIBUTOR_PUBLIC_KEY),
      })
    } catch (e) {
      console.log('Issue with Log-reader data: ')
      console.log('->> LOG DATA: ', logData)
      console.log(e)
    }
  })

  reader.on(`${reader.dataName}-end`, (totalEntriesItReads: number, totalEntriesDefinedOnFile: number) => {
    console.info(
      `✔️ Finished reading ${totalEntriesItReads} entries from ${reader.dataName}-${reader.logCounter} log file having ${totalEntriesDefinedOnFile} entries.`
    )
  })

  reader.on('error', (err: Error) => {
    console.error(`Error reading log file: ${err}`)
  })
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception in Child Process:', error)
})
