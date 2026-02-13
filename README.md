# Distributor 

The Distributor service is designed to provide real-time network data, referred to as FIREHOSE data, including `Cycle Data`, `Original Transaction Data` and `Receipt Data`, to its **Collector** clients over a socket connection.

![LDRPC Architecture](https://github.com/shardeum/relayer-collector/blob/ce3e885749bb5dadb06a6f1a0df36c8a3ecd0940/ldrpc-setup.png?raw=true)

## Key Components

The Distributor service consists of the following key components:

1. **Main Distributor Process** (`distributor.ts`): Manages incoming socket connections and spawns child processes.
2. **Child Processes** (`child-process/child.ts`): Handle individual socket connections and data distribution.
3. **DataLogReader** (`log-reader/index.ts`): Reads data from log files.
4. **Database Interfaces** (`dbstore/`): Interact with the SQLite database for various data types.
5. **Utility Functions** (`utils/`): Provide helper functions for crypto operations, serialization, etc.

## Working

1. The Distributor reads new data chunks written by another collector (or archiver) service in log files (found under the `/data-logs` directory of the archiver/collector service).

2. When a new socket connection request is received:
   - The Distributor checks for existing child processes.
   - If a child process is available and not at capacity (`MAX_CLIENTS_PER_CHILD`), the request is assigned to it.
   - If no available child processes are found, a new one is spawned.

3. Each **Child process**:
   - Reads data from log files using the **DataLogReader** class.
   - Forwards data to its connected socket clients.
   - Handles socket disconnection events.
   - Reports to the parent process (`distributor.ts`).
   - Is terminated when its last socket client disconnects.

## Usage

The distributor service can be used with either an [**Archiver**](https://github.com/shardeum/archive-server) service or a [**Collector**](https://github.com/shardeum/relayer-collector) service.

### Setup

1. Configure `distributor-config.json`:

   - Set `ARCHIVER_DB_PATH` to the path of the archiver/collector service database file (`.sqlite3`).
   - Set `DATA_LOG_DIR` to the directory where data log files are written (`/data-logs/<archiverip_port>`).
   - For production, update `DISTRIBUTOR_PUBLIC_KEY` and `DISTRIBUTOR_SECRET_KEY`.
   - Set `limitToSubscribersOnly` to `true` for subscriber checks, or `false` to disable.
   - If enabled, add subscriber public keys to the `subscribers` array.

   Example configuration:

   ```json
   {
     "ARCHIVER_DB_PATH": "/home/user/archive-server/archiver-db/archiverdb-4000.sqlite3", 
     // assuming you're running a local archive server 
     "DATA_LOG_DIR": "/home/user/archive-server/data-logs/127.0.0.1_4000",
     "limitToSubscribersOnly": true,
     "subscribers": [
       {
         "publicKey": "COLLECTOR_PUBLIC_KEY",
         "expirationTimestamp": 0,
         "subscriptionType": "FIREHOSE"
       }
     ]
   }
   ```
2.  Install dependencies:
    ```bash 
    npm  install
    ```
   
3.  Run the distributor service:
    
    ```bash 
    npm run start
    ```
    

## Development

-   The `src/` directory contains the main source code.
-   `scripts/` contains utility scripts for testing.
-   Database interactions are handled in the `dbstore/` directory.
-   Utility functions are located in `utils/`.

# Health Check

- GET `/is-alive` this endpoint returns 200 if the server is running.
- GET `/is-healthy` currently the same as `/is-alive` but will be expanded.

## Contributing

Contributions are welcome! Please adhere to our [code of conduct](./CODE_OF_CONDUCT.md) when participating in this project.
