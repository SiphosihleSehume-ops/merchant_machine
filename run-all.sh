#!/usr/bin/env bash
# ==============================================================================
# Merchant & Payment Machine — Full-Stack Runner
# ==============================================================================
# Starts or tests the entire stack in one command:
#   1. Installs missing dependencies across root, backend/, and contracts/
#   2. Ensures PostgreSQL is running (uses DATABASE_URL from backend/.env or
#      automatically starts a local Docker postgres:16-alpine container)
#   3. Starts a local Hardhat EVM node (chainId 31337) and deploys TestStablecoin
#      contracts (ZARK, USDC, NGN) — unless --sepolia is passed
#   4. Syncs backend/.env and .env.local with the deployed token addresses
#   5. Applies Prisma migrations (`prisma generate` + `prisma migrate deploy`)
#   6. Starts the Express + x402 Facilitator API (`http://localhost:4000`)
#   7. Starts the Next.js Frontend (`http://localhost:3000`) or runs the E2E
#      test suite (`--e2e`)
#
# Usage:
#   ./run-all.sh            # Run full local stack (Hardhat + DB + Backend + Frontend)
#   ./run-all.sh --e2e      # Run local stack + execute end-to-end test suite
#   ./run-all.sh --sepolia  # Run Backend + Frontend using existing Sepolia .env files
# ==============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="local"
FORCE_LOCAL_DB=0
for arg in "$@"; do
  case "$arg" in
    --e2e) MODE="e2e" ;;
    --sepolia) MODE="sepolia" ;;
    --local-db) FORCE_LOCAL_DB=1 ;;
    -h|--help)
      sed -n '2,22p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --help for usage)" >&2
      exit 1
      ;;
  esac
done

LOG_DIR="$ROOT_DIR/.logs"
mkdir -p "$LOG_DIR"
HARDHAT_LOG="$LOG_DIR/hardhat.log"
BACKEND_LOG="$LOG_DIR/backend.log"

PIDS=()
cleanup() {
  local exit_code=$?
  if [ ${#PIDS[@]} -gt 0 ]; then
    echo ""
    echo "[run-all] Shutting down background processes..."
    for pid in "${PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    done
    wait 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

log() {
  printf "\033[1;36m[run-all]\033[0m %s\n" "$*"
}

err() {
  printf "\033[1;31m[run-all ERROR]\033[0m %s\n" "$*" >&2
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local retries="${3:-40}"
  for ((i = 1; i <= retries; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  err "$name did not become ready at $url"
  return 1
}

wait_for_rpc() {
  local url="$1"
  local retries="${2:-40}"
  for ((i = 1; i <= retries; i++)); do
    if curl -fsS -X POST "$url" \
      -H "Content-Type: application/json" \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  err "JSON-RPC node did not become ready at $url"
  return 1
}

has_contract_code() {
  local rpc="$1"
  local addr="$2"
  local resp
  resp=$(curl -fsS -X POST "$rpc" \
    -H "Content-Type: application/json" \
    --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$addr\",\"latest\"],\"id\":1}" 2>/dev/null || true)
  [[ "$resp" == *'"result":"0x'* ]] && [[ "$resp" != *'"result":"0x"'* ]] && [[ "$resp" != *'"result":"0x0"'* ]]
}

# ------------------------------------------------------------------------------
# 1. Install dependencies if binaries are missing
# ------------------------------------------------------------------------------
if [ ! -x "$ROOT_DIR/node_modules/.bin/next" ] || [ ! -d "$ROOT_DIR/node_modules/viem" ] || [ ! -d "$ROOT_DIR/node_modules/@x402/core" ] || [ ! -d "$ROOT_DIR/node_modules/jsqr" ]; then
  log "Installing frontend dependencies..."
  pnpm install --no-frozen-lockfile
fi

if [ ! -x "$ROOT_DIR/backend/node_modules/.bin/prisma" ] || [ ! -x "$ROOT_DIR/backend/node_modules/.bin/tsx" ]; then
  log "Installing backend dependencies..."
  (cd "$ROOT_DIR/backend" && pnpm install)
fi

if [ ! -x "$ROOT_DIR/contracts/node_modules/.bin/hardhat" ]; then
  log "Installing smart contract dependencies..."
  (cd "$ROOT_DIR/contracts" && npm install)
fi

# ------------------------------------------------------------------------------
# 2. Local Blockchain + Contract Deployment (unless --sepolia)
# ------------------------------------------------------------------------------
DEFAULT_HARDHAT_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
RPC_URL="http://127.0.0.1:8545"
DEPLOY_JSON="$ROOT_DIR/contracts/deployments/localhost.local.json"

if [ "$MODE" != "sepolia" ]; then
  if curl -fsS -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/dev/null 2>&1; then
    log "Hardhat JSON-RPC already running at $RPC_URL"
  else
    log "Starting local Hardhat node on $RPC_URL (log: $HARDHAT_LOG)..."
    (cd "$ROOT_DIR/contracts" && ./node_modules/.bin/hardhat node >"$HARDHAT_LOG" 2>&1) &
    PIDS+=($!)
    wait_for_rpc "$RPC_URL" 60
  fi

  NEED_DEPLOY=1
  if [ -f "$DEPLOY_JSON" ]; then
    EXISTING_ZARK=$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('$DEPLOY_JSON','utf8')).tokens.ZARK.address)")
    if [ -n "$EXISTING_ZARK" ] && has_contract_code "$RPC_URL" "$EXISTING_ZARK"; then
      NEED_DEPLOY=0
      log "Reusing already-deployed contracts on $RPC_URL"
    fi
  fi

  if [ "$NEED_DEPLOY" -eq 1 ]; then
    log "Deploying TestStablecoin (ZARK, USDC, NGN) to local Hardhat chain..."
    (cd "$ROOT_DIR/contracts" && ./node_modules/.bin/hardhat run scripts/deploy.ts --network localhost)
  fi

  KYC_JSON="$ROOT_DIR/contracts/deployments/localhost-kyc.local.json"
  PAYMENTS_JSON="$ROOT_DIR/contracts/deployments/localhost-payments.local.json"
  KYC_ADDR=""
  PAYMENTS_ADDR=""
  if [ -f "$KYC_JSON" ]; then
    KYC_ADDR=$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('$KYC_JSON','utf8')).kycVerification || '')")
  fi
  if [ -z "$KYC_ADDR" ] || ! has_contract_code "$RPC_URL" "$KYC_ADDR"; then
    log "Deploying KYCVerification to local Hardhat chain..."
    (cd "$ROOT_DIR/contracts" && ./node_modules/.bin/hardhat run scripts/deploy-kyc.ts --network localhost)
    KYC_ADDR=$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('$KYC_JSON','utf8')).kycVerification || '')")
  fi

  if [ -f "$PAYMENTS_JSON" ]; then
    PAYMENTS_ADDR=$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('$PAYMENTS_JSON','utf8')).merchantPayments || '')")
  fi
  if [ -z "$PAYMENTS_ADDR" ] || ! has_contract_code "$RPC_URL" "$PAYMENTS_ADDR"; then
    log "Deploying MerchantPayments to local Hardhat chain..."
    (cd "$ROOT_DIR/contracts" && ./node_modules/.bin/hardhat run scripts/deploy-payments.ts --network localhost)
    PAYMENTS_ADDR=$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('$PAYMENTS_JSON','utf8')).merchantPayments || '')")
  fi

  ZARK_ADDR=$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('$DEPLOY_JSON','utf8')).tokens.ZARK.address)")
  USDC_ADDR=$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('$DEPLOY_JSON','utf8')).tokens.USDC.address)")
  NGN_ADDR=$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('$DEPLOY_JSON','utf8')).tokens.NGN.address)")
  log "Active contracts: ZARK=$ZARK_ADDR | USDC=$USDC_ADDR | NGN=$NGN_ADDR | KYC=$KYC_ADDR | PAYMENTS=$PAYMENTS_ADDR"
fi

# ------------------------------------------------------------------------------
# 3. Database & Environment Files
# ------------------------------------------------------------------------------
DB_URL="${DATABASE_URL:-}"
if [ "$FORCE_LOCAL_DB" -eq 1 ]; then
  DB_URL=""
elif [ -z "$DB_URL" ] && [ -f "$ROOT_DIR/backend/.env" ]; then
  DB_URL=$(grep -E '^DATABASE_URL=' "$ROOT_DIR/backend/.env" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
fi

if [ -n "$DB_URL" ] && [[ "$DB_URL" != *"user:pass@host"* ]]; then
  # Normalize URL for Prisma query engine (strip channel_binding=require, add connect_timeout=30)
  DB_URL=$(node -e "
    const raw = process.argv[1];
    try {
      const u = new URL(raw);
      u.searchParams.delete('channel_binding');
      if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '30');
      if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '30');
      if (u.hostname.includes('neon.tech')) {
        if (!u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
        if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '5');
      }
      console.log(u.toString());
    } catch {
      console.log(raw);
    }
  " "$DB_URL")
fi

if [ -z "$DB_URL" ] || [[ "$DB_URL" == *"user:pass@host"* ]]; then
  DB_URL="postgresql://postgres:postgres@localhost:5432/merchant_machine?schema=public"
  if ! (echo >/dev/tcp/127.0.0.1/5432) >/dev/null 2>&1; then
    if command -v docker >/dev/null 2>&1; then
      log "Starting local PostgreSQL container (merchant-machine-db) on port 5432..."
      if docker ps -a --format '{{.Names}}' | grep -qx 'merchant-machine-db'; then
        docker start merchant-machine-db >/dev/null
      else
        docker run -d \
          --name merchant-machine-db \
          -e POSTGRES_USER=postgres \
          -e POSTGRES_PASSWORD=postgres \
          -e POSTGRES_DB=merchant_machine \
          -p 5432:5432 \
          postgres:16-alpine >/dev/null
      fi
      for ((i = 1; i <= 30; i++)); do
        if (echo >/dev/tcp/127.0.0.1/5432) >/dev/null 2>&1; then
          sleep 1
          break
        fi
        sleep 1
      done
    else
      err "No PostgreSQL reachable on localhost:5432 and Docker is not running. Set DATABASE_URL in backend/.env."
      exit 1
    fi
  fi
fi

API_PORT="${PORT:-4000}"
if [ "$MODE" = "e2e" ]; then
  API_PORT="${PORT:-4100}"
fi

if [ "$MODE" != "sepolia" ]; then
  if [ ! -f "$ROOT_DIR/backend/.env" ]; then
    log "Creating backend/.env with local defaults and Nodemailer SMTP config..."
    cat >"$ROOT_DIR/backend/.env" <<EOF
# ---- Core ----
DATABASE_URL="$DB_URL"
JWT_SECRET="local-dev-jwt-secret-change-in-production-0123456789"
PORT=$API_PORT
CORS_ORIGIN="http://localhost:3000"
APP_URL="http://localhost:3000"

# ---- Email (Nodemailer Gmail SMTP) ----
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=queenofleonida@gmail.com
SMTP_PASS=app-password
MAIL_FROM="Merchant Machine <queenofleonida@gmail.com>"

# ---- Chain & Tokens ----
CHAIN_ID=31337
SEPOLIA_RPC_URL="$RPC_URL"
FACILITATOR_PRIVATE_KEY="$DEFAULT_HARDHAT_PK"
TOKEN_ZARK_ADDRESS="$ZARK_ADDR"
TOKEN_USDC_ADDRESS="$USDC_ADDR"
TOKEN_NGN_ADDRESS="$NGN_ADDR"
KYC_CONTRACT_ADDRESS="$KYC_ADDR"
KYC_VERIFIER_PRIVATE_KEY="$DEFAULT_HARDHAT_PK"
PAYMENTS_CONTRACT_ADDRESS="$PAYMENTS_ADDR"
PLATFORM_FEE_PERCENT=2.5

# ---- Demo settings ----
ZAR_PER_USD=18.50
REVERSAL_APPROVAL_HOURS=24
EOF
  else
    log "Updating deployed token addresses in backend/.env (preserving SMTP & DB settings)..."
    node -e "
      const fs = require('fs');
      const file = '$ROOT_DIR/backend/.env';
      let content = fs.readFileSync(file, 'utf8');
      const updates = {
        DATABASE_URL: '\"$DB_URL\"',
        TOKEN_ZARK_ADDRESS: '\"$ZARK_ADDR\"',
        TOKEN_USDC_ADDRESS: '\"$USDC_ADDR\"',
        TOKEN_NGN_ADDRESS: '\"$NGN_ADDR\"',
        KYC_CONTRACT_ADDRESS: '\"$KYC_ADDR\"',
        PAYMENTS_CONTRACT_ADDRESS: '\"$PAYMENTS_ADDR\"',
      };
      for (const [k, v] of Object.entries(updates)) {
        const re = new RegExp('^' + k + '=.*$', 'm');
        if (re.test(content)) content = content.replace(re, k + '=' + v);
        else content += '\n' + k + '=' + v;
      }
      fs.writeFileSync(file, content);
    "
  fi

  cat >"$ROOT_DIR/.env.local" <<EOF
NEXT_PUBLIC_API_URL=http://localhost:$API_PORT/api/v1
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_EXPLORER_TX_URL=https://sepolia.etherscan.io/tx/
NEXT_PUBLIC_TOKEN_ZARK_ADDRESS=$ZARK_ADDR
NEXT_PUBLIC_TOKEN_USDC_ADDRESS=$USDC_ADDR
NEXT_PUBLIC_TOKEN_NGN_ADDRESS=$NGN_ADDR
EOF
fi

# ------------------------------------------------------------------------------
# 4. Prisma Client Generation & Database Migrations
# ------------------------------------------------------------------------------
log "Generating Prisma client and applying database migrations..."
(
  cd "$ROOT_DIR/backend"
  DATABASE_URL="$DB_URL" ./node_modules/.bin/prisma generate
  DATABASE_URL="$DB_URL" ./node_modules/.bin/prisma migrate deploy
)

# ------------------------------------------------------------------------------
# 5. Start Backend API
# ------------------------------------------------------------------------------
log "Starting Backend API on http://localhost:$API_PORT (log: $BACKEND_LOG)..."
: >"$BACKEND_LOG"
(
  cd "$ROOT_DIR/backend"
  if [ "$MODE" = "e2e" ]; then
    DATABASE_URL="$DB_URL" \
    PORT="$API_PORT" \
    CHAIN_ID=31337 \
    SEPOLIA_RPC_URL="$RPC_URL" \
    FACILITATOR_PRIVATE_KEY="$DEFAULT_HARDHAT_PK" \
    TOKEN_ZARK_ADDRESS="$ZARK_ADDR" \
    TOKEN_USDC_ADDRESS="$USDC_ADDR" \
    TOKEN_NGN_ADDRESS="$NGN_ADDR" \
    KYC_CONTRACT_ADDRESS="$KYC_ADDR" \
    KYC_VERIFIER_PRIVATE_KEY="$DEFAULT_HARDHAT_PK" \
    PAYMENTS_CONTRACT_ADDRESS="$PAYMENTS_ADDR" \
    E2E_LOCAL_MAIL="1" \
    ./node_modules/.bin/tsx src/server.ts >"$BACKEND_LOG" 2>&1
  elif [ "$MODE" != "sepolia" ]; then
    DATABASE_URL="$DB_URL" \
    PORT="$API_PORT" \
    CHAIN_ID=31337 \
    SEPOLIA_RPC_URL="$RPC_URL" \
    FACILITATOR_PRIVATE_KEY="$DEFAULT_HARDHAT_PK" \
    TOKEN_ZARK_ADDRESS="$ZARK_ADDR" \
    TOKEN_USDC_ADDRESS="$USDC_ADDR" \
    TOKEN_NGN_ADDRESS="$NGN_ADDR" \
    KYC_CONTRACT_ADDRESS="$KYC_ADDR" \
    KYC_VERIFIER_PRIVATE_KEY="$DEFAULT_HARDHAT_PK" \
    PAYMENTS_CONTRACT_ADDRESS="$PAYMENTS_ADDR" \
    ./node_modules/.bin/tsx src/server.ts >"$BACKEND_LOG" 2>&1
  else
    PORT="$API_PORT" ./node_modules/.bin/tsx src/server.ts >"$BACKEND_LOG" 2>&1
  fi
) &
PIDS+=($!)

wait_for_http "http://localhost:$API_PORT/health" "Backend API" 60
log "Backend API is healthy at http://localhost:$API_PORT"
if curl -fsS "http://localhost:$API_PORT/api/v1/db-status" >/dev/null 2>&1; then
  log "Database connection pool verified (/api/v1/db-status)"
else
  err "Warning: /api/v1/db-status failed. If Neon is unreachable, run: ./run-all.sh --local-db"
fi

# ------------------------------------------------------------------------------
# 6. Run E2E Suite (--e2e) OR Start Frontend Dev Server
# ------------------------------------------------------------------------------
if [ "$MODE" = "e2e" ]; then
  log "Running end-to-end verification suite (backend/scripts/e2e-local.ts)..."
  (
    cd "$ROOT_DIR/backend"
    PORT="$API_PORT" \
    API_URL="http://localhost:$API_PORT/api/v1" \
    TOKEN_ZARK_ADDRESS="$ZARK_ADDR" \
    TOKEN_USDC_ADDRESS="$USDC_ADDR" \
    TOKEN_NGN_ADDRESS="$NGN_ADDR" \
    ./node_modules/.bin/tsx scripts/e2e-local.ts "$BACKEND_LOG"
  )
  log "E2E suite completed successfully!"
  exit 0
fi

log "Starting Next.js Frontend on http://localhost:3000 ..."
log "  - Frontend: http://localhost:3000"
log "  - Backend:  http://localhost:$API_PORT/health"
if [ "$MODE" != "sepolia" ]; then
  log "  - Hardhat:  $RPC_URL (Chain ID 31337)"
  log "  - Note: Email verification links are logged to $BACKEND_LOG"
fi
log "Press Ctrl+C to stop all services."

tail -f "$BACKEND_LOG" &
PIDS+=($!)

./node_modules/.bin/next dev
