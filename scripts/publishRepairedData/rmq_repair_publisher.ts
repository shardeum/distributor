import { Connection, Channel, connect } from 'amqplib'

export class RMQRepairPublisher {
  private connection: Connection | null = null
  private channel: Channel | null = null
  private isConnected = false

  async start(): Promise<void> {
    try {
      this.connection = await connect({
        protocol: process.env.RMQ_PROTOCOL || 'amqp',
        hostname: process.env.RMQ_HOST || 'localhost',
        port: parseInt(process.env.RMQ_PORT || '5672'),
        username: process.env.RMQ_USER || 'guest',
        password: process.env.RMQ_PASS || 'guest',
      })

      this.channel = await this.connection.createChannel()
      this.isConnected = true

      // Declare exchanges
      const cyclesExchange = process.env.RMQ_CYCLES_EXCHANGE_NAME
      const receiptsExchange = process.env.RMQ_RECEIPTS_EXCHANGE_NAME
      const transactionsExchange = process.env.RMQ_ORIGINAL_TXS_EXCHANGE_NAME
      const accountsExchange = process.env.RMQ_ACCOUNTS_EXCHANGE_NAME

      if (!cyclesExchange || !receiptsExchange || !transactionsExchange) {
        throw new Error('Missing required RMQ exchange names in environment variables')
      }

      await this.channel.assertExchange(cyclesExchange, 'fanout', { durable: true })
      await this.channel.assertExchange(receiptsExchange, 'fanout', { durable: true })
      await this.channel.assertExchange(transactionsExchange, 'fanout', { durable: true })
      //   await this.channel.assertExchange(accountsExchange, 'fanout', { durable: true })
    } catch (error) {
      console.error('Failed to start RMQ connection:', error)
      throw error
    }
  }

  async cleanUp(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close()
        this.channel = null
      }
      if (this.connection) {
        await this.connection.close()
        this.connection = null
      }
      this.isConnected = false
    } catch (error) {
      console.error('Failed to cleanup RMQ connection:', error)
      throw error
    }
  }

  async publishMessages(exchangeName: string, messages: any[]): Promise<void> {
    if (!this.isConnected || !this.channel) {
      throw new Error('RMQ connection not established')
    }

    try {
      for (const message of messages) {
        await this.channel.publish(exchangeName, '', Buffer.from(JSON.stringify(message)), { persistent: true })
      }
    } catch (error) {
      console.error(`Failed to publish messages to ${exchangeName}:`, error)
      throw error
    }
  }

  async publishCycles(cycles: any[]): Promise<void> {
    if (cycles.length <= 0) return
    const exchangeName = process.env.RMQ_CYCLES_EXCHANGE_NAME
    if (!exchangeName) throw new Error('Missing RMQ_CYCLES_EXCHANGE_NAME')
    const messages = cycles.map((cycle) => ({ cycle }))
    await this.publishMessages(exchangeName, messages)
  }

  async publishReceipts(receipts: any[]): Promise<void> {
    if (receipts.length <= 0) return
    const exchangeName = process.env.RMQ_RECEIPTS_EXCHANGE_NAME
    if (!exchangeName) throw new Error('Missing RMQ_RECEIPTS_EXCHANGE_NAME')
    const messages = receipts.map((receipt) => ({ receipt }))
    await this.publishMessages(exchangeName, messages)
  }

  async publishTransactions(transactions: any[]): Promise<void> {
    if (transactions.length <= 0) return
    const exchangeName = process.env.RMQ_TRANSACTIONS_EXCHANGE_NAME
    if (!exchangeName) throw new Error('Missing RMQ_TRANSACTIONS_EXCHANGE_NAME')
    const messages = transactions.map((transaction) => ({ transaction }))
    await this.publishMessages(exchangeName, messages)
  }

  async publishAccounts(accounts: any[]): Promise<void> {
    if (accounts.length <= 0) return
    const exchangeName = process.env.RMQ_ACCOUNTS_EXCHANGE_NAME
    if (!exchangeName) throw new Error('Missing RMQ_ACCOUNTS_EXCHANGE_NAME')
    const messages = accounts.map((account) => ({ account }))
    await this.publishMessages(exchangeName, messages)
  }
}
