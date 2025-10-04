# Chen Pilot - AI Agent for Cross-Chain DeFi Operations

Chen Pilot is an intelligent AI agent that enables seamless interaction with multiple blockchain networks and DeFi protocols through natural language commands. This agent provides a unified interface for managing Bitcoin wallets, Starknet operations, cross-chain swaps, and DeFi lending/borrowing activities.

## 🚀 Features Overview

### Core Capabilities
- **Natural Language Processing**: Chat with the agent using plain English
- **Multi-Chain Support**: Bitcoin, Starknet, and cross-chain operations
- **DeFi Integration**: Lending, borrowing, and yield farming on Vesu protocol
- **Cross-Chain Swaps**: Seamless asset swaps between Bitcoin and Starknet
- **Wallet Management**: Complete wallet operations and contact management
- **Auto-Deployment**: Automatic Starknet account creation and funding

## 🏗️ Architecture

### Services Integration
- **Atomiq**: Cross-chain swap infrastructure for Bitcoin ↔ Starknet
- **Vesu**: DeFi lending and borrowing protocol on Starknet
- **XVerse**: Bitcoin wallet and transaction management
- **Starknet**: Native blockchain operations and smart contracts

### Agent System
- **Intent Agent**: Parses natural language commands and routes to appropriate services
- **Execution Agent**: Executes planned workflows across multiple tools
- **Tool Registry**: Dynamic tool discovery and management system
- **Memory System**: Context-aware conversation management

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL database
- Environment variables configured (see Configuration section)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chenpilot-experimental
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up the database**
   ```bash
   npm run migration:run
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

## ⚙️ Configuration

Create a `.env` file with the following variables:

```env
# Server Configuration
NODE_ENV=development
PORT=2333

# Anthropic API (for AI agent)
ANTHROPIC_API_KEY=your_anthropic_api_key

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=your_db_username
DB_PASSWORD=your_db_password
DB_NAME=your_db_name

# Starknet Configuration
NODE_URL=https://starknet-sepolia.public.blastapi.io/rpc/v0_7

# XVerse API Configuration
XVERSE_API_KEY=your_xverse_api_key
BITCOIN_NETWORK=mainnet
XVERSE_BASE_URL=https://api.secretkeylabs.io
```

## 👤 Account Creation

### Registration Process

1. **Create Account**
   ```bash
   POST /auth/register
   ```
   ```json
   {
     "email": "user@example.com",
     "password": "securepassword123",
     "name": "John Doe"
   }
   ```

2. **Account Setup Features**
   - Automatic Starknet account generation
   - Auto-funding with testnet tokens (if available)
   - Account deployment to Starknet network
   - Encrypted private key storage

3. **Login**
   ```bash
   POST /auth/login
   ```
   ```json
   {
     "email": "user@example.com",
     "password": "securepassword123"
   }
   ```

### Account Features
- **Starknet Integration**: Each user gets a unique Starknet account
- **Security**: Private keys are encrypted and stored securely
- **Auto-Deployment**: Accounts are automatically deployed to the network
- **Funding**: Automatic testnet token funding for new accounts

## 💬 Chatting with the Agent

### Basic Usage

Send queries to the agent via the `/query` endpoint:

```bash
POST /query
```
```json
{
  "userId": "your-user-id",
  "query": "Check my STRK balance"
}
```

### Natural Language Examples

The agent understands natural language commands. Here are examples:

**Wallet Operations:**
- "Check my STRK balance"
- "Transfer 100 STRK to 0x123..."
- "What's my wallet address?"
- "Show me my ETH balance"

**DeFi Operations:**
- "Lend 100 STRK"
- "Borrow 500 USDC"
- "What's my lending balance?"
- "Show me the best APY"
- "Check my health factor"
- "Claim my rewards"

**Cross-Chain Swaps:**
- "Swap 0.01 BTC to STRK"
- "Check my swap status"
- "Get swap quote for 0.005 BTC"

**Bitcoin Operations:**
- "Check my Bitcoin balance"
- "Send 0.001 BTC to bc1q..."
- "Create a new Bitcoin wallet"
- "What's the current Bitcoin price?"

## 🔧 Available Tools and Features

### 1. Atomiq - Cross-Chain Swaps

**Purpose**: Enables seamless swaps between Bitcoin and Starknet assets

**Features**:
- Bitcoin to Starknet token swaps
- Starknet to Bitcoin swaps
- Real-time swap quotes
- Swap status monitoring
- Refund and claim operations

**Supported Operations**:
```typescript
// Get swap quote
"Get quote for swapping 0.01 BTC to STRK"

// Execute swap
"Swap 0.01 BTC to STRK"

// Check swap status
"Check status of swap abc123"

// Manage swaps
"Get all refundable swaps"
"Refund swap abc123"
"Claim swap abc123"
```

**API Endpoints**:
- `GET /atomiq/health` - Service health check
- `POST /atomiq/quote` - Get swap quote
- `POST /atomiq/swap` - Execute swap
- `GET /atomiq/status/:swapId` - Check swap status

### 2. Vesu - DeFi Lending & Borrowing

**Purpose**: DeFi protocol for lending and borrowing on Starknet

**Features**:
- Supply assets to lending pools
- Borrow against collateral
- Withdraw supplied assets
- Repay borrowed amounts
- Health factor monitoring
- Liquidation operations
- Reward claiming

**Supported Assets**: ETH, STRK, USDC, USDT, WBTC, wstETH, EKUBO, xSTRK

**Available Pools**:
- Prime Pool
- RE7 USDC Core
- RE7 USDC Prime
- RE7 USDC Frontier
- RE7 xBTC
- RE7 USDC Stable Core

**DeFi Operations**:
```typescript
// Lending
"Lend 100 STRK"
"Supply 50 ETH to the prime pool"

// Borrowing
"Borrow 500 USDC"
"Borrow 1000 USDT against my STRK collateral"

// Management
"Withdraw 25 STRK from lending"
"Repay 200 USDC"
"Check my lending positions"
"Show me the best APY rates"

// Health & Risk
"Check my health factor"
"Am I at risk of liquidation?"
"Add 50 STRK as collateral"
"Remove 25 USDC collateral"

// Advanced
"Liquidate USDC position for user 0x123"
"Claim my DeFi Spring rewards"
```

**API Endpoints**:
- `GET /vesu/health` - Service health check
- `GET /vesu/pools` - Get available lending pools
- `GET /vesu/positions/:userId` - Get user positions
- `POST /vesu/execute` - Execute lending operation

### 3. XVerse - Bitcoin Wallet Management

**Purpose**: Complete Bitcoin wallet and transaction management

**Features**:
- Bitcoin wallet creation
- Balance checking
- Transaction history
- UTXO management
- Fee estimation
- Address validation
- Price monitoring

**Bitcoin Operations**:
```typescript
// Wallet Management
"Create a new Bitcoin wallet"
"Check my Bitcoin balance"
"Get my Bitcoin address"

// Transactions
"Send 0.001 BTC to bc1q..."
"Check my transaction history"
"Get my UTXOs"

// Information
"What's the current Bitcoin price?"
"Estimate transaction fees"
"Validate Bitcoin address bc1q..."

// Advanced
"Create transaction with custom fees"
"Sign and broadcast transaction"
```

**API Endpoints**:
- `GET /bitcoin/health` - Service health check
- `GET /bitcoin/balance/:address` - Get Bitcoin balance
- `GET /bitcoin/transactions/:address` - Get transaction history
- `POST /bitcoin/send` - Send Bitcoin transaction

### 4. Wallet Tool - Starknet Operations

**Purpose**: Native Starknet wallet operations

**Features**:
- Balance checking for multiple tokens
- Token transfers
- Address management
- Contact management

**Supported Tokens**: STRK, ETH, DAI

**Wallet Operations**:
```typescript
// Balance & Address
"Check my STRK balance"
"Check my ETH balance"
"Get my wallet address"

// Transfers
"Transfer 100 STRK to 0x123..."
"Send 5 ETH to alice.eth"

// Contacts
"Add contact Alice with address 0x123..."
"Delete contact Bob"
"Show my contacts"
"Edit contact Alice's address"
```

### 5. Meta Tool - Agent Information

**Purpose**: Get information about the agent itself

**Operations**:
```typescript
"What is your name?"
"What can you do?"
"What version are you?"
"Who created you?"
```

## 🔄 Workflow System

The agent uses an intelligent workflow system that:

1. **Parses Intent**: Understands natural language commands
2. **Plans Workflow**: Creates step-by-step execution plans
3. **Executes Tools**: Runs appropriate tools in sequence
4. **Manages State**: Tracks operation status and results
5. **Provides Feedback**: Returns structured responses

### Example Workflow
```
User: "Lend 100 STRK and then check my balance"

Workflow:
1. Execute lending operation (Vesu)
2. Check wallet balance (Wallet Tool)
3. Return combined results
```

## 🛡️ Security Features

- **Encrypted Storage**: All private keys are encrypted at rest
- **JWT Authentication**: Secure API access with JSON Web Tokens
- **Input Validation**: All user inputs are validated and sanitized
- **Error Handling**: Comprehensive error handling and logging
- **Rate Limiting**: Built-in rate limiting for API endpoints

## 📊 Monitoring & Health Checks

Each service provides health check endpoints:

- `GET /vesu/health` - Vesu DeFi service status
- `GET /bitcoin/health` - XVerse Bitcoin service status
- `GET /atomiq/health` - Atomiq swap service status

## 🚀 Getting Started Examples

### 1. Basic Wallet Operations
```bash
# Check balance
curl -X POST http://localhost:2333/query \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "query": "Check my STRK balance"}'

# Transfer tokens
curl -X POST http://localhost:2333/query \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "query": "Transfer 10 STRK to 0x123..."}'
```

### 2. DeFi Operations
```bash
# Lend assets
curl -X POST http://localhost:2333/query \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "query": "Lend 100 STRK"}'

# Check positions
curl -X POST http://localhost:2333/query \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "query": "What are my lending positions?"}'
```

### 3. Cross-Chain Swaps
```bash
# Get swap quote
curl -X POST http://localhost:2333/query \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "query": "Get quote for swapping 0.01 BTC to STRK"}'

# Execute swap
curl -X POST http://localhost:2333/query \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "query": "Swap 0.01 BTC to STRK"}'
```

## 🔧 Development

### Project Structure
```
src/
├── Agents/           # AI agent system
│   ├── agents/       # Intent and execution agents
│   ├── tools/        # Available tools
│   └── registry/     # Tool registry system
├── Auth/             # Authentication system
├── Gateway/          # API routes and middleware
├── services/         # External service integrations
├── types/            # TypeScript type definitions
└── config/           # Configuration files
```

### Adding New Tools

1. Create a new tool class extending `BaseTool`
2. Implement the `metadata` and `execute` methods
3. The tool will be automatically discovered and registered

### Running Tests
```bash
npm test
```

### Building for Production
```bash
npm run build
npm start
```

## 📝 API Documentation

### Authentication Endpoints
- `POST /auth/register` - Create new account
- `POST /auth/login` - Login to account
- `POST /auth/refresh` - Refresh JWT token

### Query Endpoint
- `POST /query` - Send natural language queries to the agent

### Service-Specific Endpoints
- `/vesu/*` - Vesu DeFi operations
- `/bitcoin/*` - Bitcoin wallet operations
- `/atomiq/*` - Cross-chain swap operations

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.


## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the API health endpoints
- Review the logs for error details

---

**Chen Pilot** - Your intelligent gateway to cross-chain DeFi operations! 🚀
