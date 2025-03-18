import { resolve } from 'path'
import { readFileSync } from 'fs'
import { config } from '../Config'
import * as crypto from './Crypto'
import * as Logger from '../Logger'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'

export interface DistributorInfo {
  ip: string
  port: number
  publicKey: string
  secretKey?: string
}

const distributorInfo: DistributorInfo = {
  ip: '',
  port: -1,
  publicKey: '',
  secretKey: '',
}

export function setHashKey(key: string): void {
  crypto.setCryptoHashKey(key)
}

export function initLogger(): void {
  let logsConfig: Logger.LogsConfiguration
  try {
    logsConfig = StringUtils.safeJsonParse(readFileSync(resolve(__dirname, '../../../distributor-log.json'), 'utf8'))
  } catch (err) {
    console.log('Failed to parse distributor log file:', err)
  }
  const logDir = `${config.DISTRIBUTOR_LOGS}`
  const baseDir = '.'
  logsConfig.dir = logDir
  Logger.initLogger(baseDir, logsConfig)

  // Set distributor info from config
  distributorInfo.ip = config.DISTRIBUTOR_IP
  distributorInfo.port = config.DISTRIBUTOR_PORT
  distributorInfo.publicKey = config.DISTRIBUTOR_PUBLIC_KEY
  distributorInfo.secretKey = config.DISTRIBUTOR_SECRET_KEY
}

export function getDistributorInfo(): DistributorInfo {
  const sanitizedDistributorInfo = { ...distributorInfo }
  delete sanitizedDistributorInfo.secretKey
  return sanitizedDistributorInfo
}

export function getDistributorSecretKey(): string {
  return distributorInfo.secretKey!
}
