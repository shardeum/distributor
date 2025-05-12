# Publish Repaired Data Script

## Overview
This script is used to publish repaired data from the healArchiver to RMQ exchanges. It processes cycles, receipts, and transactions that have been repaired and publishes them in batches.

## Usage
Run the script using the following command:
```bash
node build/scripts/publishRepairedData/publishRepairedData.js -i <input-file> [options]
```

### Options
- `-i, --input <file>`: (Required) Path to the input repair data file.
- `-b, --batch-size <number>`: Batch size for processing (default: 1000).
- `--dry-run`: Run without publishing to RMQ.

## Input Format
The input file from the healArchiver should be a JSON file with the following structure:
```json
{
  "archiverId": "example-archiver",
  "repairedItems": {
    "cycles": [
      { "counter": 1, "majorityHash": "hash1", "repairedAt": "2024-01-01T00:00:00Z" },
      { "counter": 2, "majorityHash": "hash2", "repairedAt": "2024-01-01T00:00:00Z" }
    ],
    "receipts": [
      { "id": "receipt1", "cycle": 1, "majorityHash": "hash3", "repairedAt": "2024-01-01T00:00:00Z" },
      { "id": "receipt2", "cycle": 1, "majorityHash": "hash4", "repairedAt": "2024-01-01T00:00:00Z" }
    ],
    "transactions": [
      { "id": "tx1", "cycle": 1, "majorityHash": "hash5", "repairedAt": "2024-01-01T00:00:00Z" },
      { "id": "tx2", "cycle": 1, "majorityHash": "hash6", "repairedAt": "2024-01-01T00:00:00Z" }
    ]
  },
  "timestamp": 1234567890,
  "metadata": {
    "healArchiverVersion": "1.0.0",
    "repairSessionId": "example-session",
    "totalItemsRepaired": 6
  }
}
```

## Output
The script writes two types of output files into the `output` directory:
- **Summary File**: A JSON file named `publish-summary-<timestamp>.json` containing statistics about the publishing process.
- **Retry File**: If any items fail to publish, a JSON file named `retry-items-<timestamp>.json` is generated with details of the failed items.

### Example Output Files
#### Summary File (`publish-summary-2024-01-01T00-00-00.json`)
```json
{
  "timestamp": 1234567890,
  "totalProcessed": {
    "cycles": 2,
    "receipts": 2,
    "transactions": 2
  },
  "published": {
    "cycles": 2,
    "receipts": 2,
    "transactions": 2
  },
  "failed": {
    "cycles": 0,
    "receipts": 0,
    "transactions": 0
  }
}
```

#### Retry File (`retry-items-2024-01-01T00-00-00.json`)
```json
{
  "archiverId": "example-archiver",
  "repairedItems": {
    "cycles": [
      { "counter": 1, "majorityHash": "hash1", "repairedAt": "2024-01-01T00:00:00Z" },
      { "counter": 2, "majorityHash": "hash2", "repairedAt": "2024-01-01T00:00:00Z" }
    ],
    "receipts": [],
    "transactions": []
  },
  "timestamp": 1234567890,
  "metadata": {
    "healArchiverVersion": "1.0.0",
    "repairSessionId": "retry-2024-01-01T00-00-00",
    "totalItemsRepaired": 2
  }
}
```

## RMQ Configuration
To configure RabbitMQ (RMQ) for use with this script, set the following environment variables:
- `RMQ_HOST`: The hostname of the RMQ server (default: `localhost`).
- `RMQ_PORT`: The port number for the RMQ server (default: `5672`).
- `RMQ_USER`: The username for RMQ authentication (default: `guest`).
- `RMQ_PASS`: The password for RMQ authentication (default: `guest`).

Alternatively, you can specify these options directly in the script configuration if needed.
