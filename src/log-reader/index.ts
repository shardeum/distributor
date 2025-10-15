/**
 * Implmentation of a log reader that reads data from log files written by the collector
 * service and emits the same to the socket clients connected to their respective child processes.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import * as fs from 'fs'
import * as path from 'path'
import * as EventEmitter from 'events'
import * as readline from 'readline'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'

import { config } from '../Config'
class DataLogReader extends EventEmitter {
  activeLogFileName: string
  logCounter = 1

  constructor(
    public logDir: string,
    public dataName: string
  ) {
    super()
    this.activeLogFileName = `active-${dataName}-log.txt`
  }

  async init(): Promise<void> {
    const activeLogFilePath = path.join(this.logDir, this.activeLogFileName)
    if (await this.fileExists(activeLogFilePath)) {
      // Read the active log file to get the current log counter
      const activeLog = fs.readFileSync(activeLogFilePath, {
        encoding: 'utf8',
      })
      const activeLogNumber = parseInt(activeLog.replace(`${this.dataName}-log`, '').replace('.txt', ''))
      console.log(`Active log file found: ${activeLogFilePath} with number ${activeLogNumber}`)
      if (activeLogNumber) {
        this.logCounter = activeLogNumber
      }

      // Read the log file and skip the entries that have already been recorded
      const logFile = path.join(this.logDir, `${this.dataName}-log${this.logCounter}.txt`)
      if (!(await this.fileExists(logFile))) {
        throw new Error(`Log file ${logFile} does not exist`)
      }
      const stat = fs.statSync(logFile)
      let startEntries = 0
      let foundEndNumberofEntriesLine = false
      const stream = fs.createReadStream(logFile, {
        encoding: 'utf8',
        start: 0,
        end: stat.size,
      })
      const rl = readline.createInterface({
        input: stream,
      })
      rl.on('line', (data) => {
        /* prettier-ignore */ if (config.VERBOSE) console.log(data)
        try {
          // if the data contains a line with "End: Number of entries: ", then we know that the file has been rotated.
          if (data.includes('End: Number of entries: ')) {
            foundEndNumberofEntriesLine = true
          } else {
            startEntries++
          }
          /* prettier-ignore */ if (config.VERBOSE) console.log(this.dataName, 'startEntries', startEntries)
        } catch (e) {
          /* prettier-ignore */ if (config.VERBOSE) console.log('data is not complete!')
        }
      })
      stream.on('end', () => {
        console.log('Finished reading the file.')
        if (!foundEndNumberofEntriesLine) {
          console.log(
            `Starting at ${this.dataName}-log${this.logCounter}.txt with size ${stat.size} and ${startEntries} entries`
          )
          this.readLogFile(stat.size, startEntries)
        }
        rl.close()
        stream.close()
      })
    }

    // listen to the active log file
    fs.watch(activeLogFilePath, async (event: string, filename: string) => {
      if (filename) {
        let activeLog = ''
        do {
          activeLog = fs.readFileSync(activeLogFilePath, {
            encoding: 'utf8',
          })
        } while (activeLog === '')
        const activeLogNumber = parseInt(activeLog.replace(`${this.dataName}-log`, '').replace('.txt', ''))
        if (isNaN(activeLogNumber)) return
        if (activeLogNumber === this.logCounter) return
        if (activeLogNumber) {
          this.logCounter = activeLogNumber
        }
        console.info(`Switching to new File ${this.dataName}-log${this.logCounter}.txt`)
        this.readLogFile()
      }
    })
  }

  async readLogFile(startSize = 0, startEntries = 0): Promise<void> {
    const logFile = path.join(this.logDir, `${this.dataName}-log${this.logCounter}.txt`)
    if (!(await this.fileExists(logFile))) {
      throw new Error(`Log file ${logFile} does not exist`)
    }
    let currentSize = startSize
    let totalNumberOfEntries = startEntries

    let reading = false
    const fileStreamer = setInterval(() => {
      if (reading) return
      reading = true
      fs.stat(logFile, (err, stats) => {
        if (err) {
          console.error(err)
          reading = false
          return
        }
        if (stats.size > currentSize) {
          if (config.VERBOSE)
            console.log(
              this.dataName,
              'totalNumberOfEntries',
              totalNumberOfEntries,
              'currentSize',
              currentSize,
              'stats.size',
              stats.size
            )
          const sizeDiff = stats.size - currentSize
          if (sizeDiff / 1024 / 1024 > 100)
            console.log(this.dataName, stats.size, currentSize, sizeDiff / 1024 / 1024, 'MB')
          const stream = fs.createReadStream(logFile, {
            encoding: 'utf8',
            start: currentSize,
            end: stats.size,
          })

          const rl = readline.createInterface({
            input: stream,
          })
          // read the stream line-by-line
          rl.on('line', (data) => {
            try {
              // if the data contains a line with "End: Number of entries: ", then we know that the file has been rotated.
              if (data.includes('End: Number of entries: ')) {
                const entryCount = parseInt(data.split(':').slice(-1)[0].trim())
                if (isNaN(entryCount)) {
                  console.error(
                    'Error: File has been rotated but the last line does not contain the total number of entries'
                  )
                }
                if (totalNumberOfEntries !== entryCount)
                  console.log(
                    'Total number of entries does not not match with the entry Count.',
                    totalNumberOfEntries,
                    entryCount
                  )
                this.emit(`${this.dataName}-end`, totalNumberOfEntries, entryCount)
                // End the interval
                clearInterval(fileStreamer)
              } else {
                const parse = StringUtils.safeJsonParse(data)

                // Check if we should stop reading based on cycle cutoff
                if (config.stopDistributionAtCycle >= 0) {
                  let dataCycle = -1
                  if (this.dataName === 'cycle' && parse?.counter !== undefined) {
                    dataCycle = parse.counter
                  } else if (
                    (this.dataName === 'receipt' || this.dataName === 'originalTx') &&
                    parse?.cycle !== undefined
                  ) {
                    dataCycle = parse.cycle
                  }

                  if (dataCycle > config.stopDistributionAtCycle) {
                    console.log(
                      `⛔ Log Reader: Stopping ${this.dataName} log reading - exceeded stopDistributionAtCycle ${config.stopDistributionAtCycle}`
                    )
                    clearInterval(fileStreamer)
                    rl.close()
                    stream.close()
                    return
                  }
                }

                totalNumberOfEntries += 1
                /* prettier-ignore */ if (config.VERBOSE) console.log(`${this.dataName}-data`, data)
                this.emit(`${this.dataName}-data`, parse)
              }
              currentSize += Buffer.byteLength(data + '\n')
            } catch (e) {
              console.error(this.dataName, '❌ Damaged line Detected! >: ', data.length, data)
              if (config.VERBOSE)
                console.log(
                  this.dataName,
                  'Damaged line Detected! >: ',
                  'totalNumberOfEntries',
                  totalNumberOfEntries,
                  'currentSize',
                  currentSize
                )
            }
          })
          rl.on('error', (err) => {
            console.error('Error occurred in File Streamer', logFile, err)
          })
          stream.on('end', () => {
            // End of line
            rl.close()
            stream.close()
            reading = false
          })
        } else {
          reading = false
        }
      })
    }, config.FILE_STREAM_INTERVAL_MS) // Check for new data
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK)
      return true
    } catch (err) {
      return false
    }
  }
}

export default DataLogReader
