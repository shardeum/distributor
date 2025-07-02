# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm start` - Build and run the distributor service
- `npm run rmq_mode_apis` - Run in RabbitMQ API mode
- `npm run compile` - Compile TypeScript to JavaScript

### Testing
- `npm test` - Run Jest unit tests
- To run a specific test: `npm test -- path/to/test.spec.ts`

### Code Quality
- `npm run lint` - Run ESLint and GTS checks
- `npm run fix` - Auto-fix linting issues with GTS
- `npm run format-check` - Check code formatting with Prettier
- `npm run format-fix` - Auto-fix formatting issues

### Release
- `npm run release:patch` - Create patch release
- `npm run release:minor` - Create minor release
- `npm run release:major` - Create major release

## Architecture Overview

The Distributor is a multi-process service that streams real-time network data (FIREHOSE data) to authenticated Collector clients via Socket.io connections.

### Key Components

1. **Main Process** (`src/distributor.ts`)
   - Spawns and manages child processes
   - Routes incoming socket connections to available child processes
   - Monitors child process health

2. **Child Process** (`src/child-process/`)
   - Handles socket connections (max per child: MAX_CLIENTS_PER_CHILD)
   - Reads data from log files via DataLogReader
   - Streams data to connected clients
   - Self-terminates when all clients disconnect

3. **Data Flow**
   - Reads from SQLite database (ARCHIVER_DB_PATH)
   - Monitors log files in DATA_LOG_DIR
   - Streams: Cycle Data, Original Transaction Data, Receipt Data

4. **Authentication** (`src/utils/authentication.ts`)
   - Uses public key cryptography for subscriber verification
   - Subscribers must be whitelisted in config if limitToSubscribersOnly=true

5. **RabbitMQ Integration** (`src/messaging/`, `src/distributor/rmq_data_publisher.ts`)
   - Alternative mode for distributed messaging
   - Publishes data to RabbitMQ exchanges

### Configuration

Main config file: `distributor-config.json`
- `ARCHIVER_DB_PATH` - Path to SQLite database
- `DATA_LOG_DIR` - Path to data log files
- `limitToSubscribersOnly` - Enable/disable subscriber authentication
- `subscribers` - Array of authorized public keys

### Database Schema

Uses SQLite with tables for:
- cycles
- accounts
- transactions
- receipts
- originalTxsData

### Testing Approach

- Framework: Jest with ts-jest
- Test location: `/tests/unit/`
- Mock external dependencies (RabbitMQ, file system)
- Limited test coverage currently exists