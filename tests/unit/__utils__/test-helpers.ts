export const mockCycleData = {
  counter: 1,
  cycleMarker: 'cycle-1',
  active: 10,
  start: 1000,
  duration: 60,
  networkConfigHash: 'config-hash',
  cycleRecord: {},
}

export const mockReceiptData = {
  receiptId: 'receipt-1',
  txId: 'tx-1',
  cycle: 1,
  timestamp: Date.now(),
  beforeStateHash: 'before-hash',
  afterStateHash: 'after-hash',
  appReceiptData: {},
  appliedReceipt: {},
  confirmOrChallenge: {},
  signatures: [],
}

export const mockOriginalTxData = {
  txId: 'tx-1',
  timestamp: Date.now(),
  cycle: 1,
  originalTxData: {},
}

export const mockAccountData = {
  accountId: 'account-1',
  data: {},
  timestamp: Date.now(),
  hash: 'account-hash',
  cycleNumber: 1,
}

export const mockTransactionData = {
  txId: 'tx-1',
  appData: {},
  timestamp: Date.now(),
  cycle: 1,
}

export const clearAllMocks = () => {
  jest.clearAllMocks()
}

export const resetAllMocks = () => {
  jest.resetAllMocks()
}

export const waitForAsync = async () => {
  await new Promise(resolve => setImmediate(resolve))
}