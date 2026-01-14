#!/bin/bash

# Collect data for all 6 cities
# Each collector runs as a separate background process with its own output

echo ""
echo "🚀 Starting all city collectors..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Track PIDs for cleanup
declare -a PIDS=()

# Function to start a collector
start_collector() {
    local city=$1
    local script=$2
    local emoji=$3
    
    echo -e "${CYAN}Starting ${city}...${NC}"
    
    # Run the collector, prefix each line with the city name
    node "scripts/${script}" 2>&1 | while IFS= read -r line; do
        echo -e "${emoji} [${city}] ${line}"
    done &
    
    PIDS+=($!)
    echo -e "${GREEN}  ✓ ${city} collector started (PID: $!)${NC}"
}

# Function to handle cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}🛑 Stopping all collectors...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null
        fi
    done
    # Also kill any child node processes
    pkill -P $$ 2>/dev/null
    echo -e "${GREEN}✓ All collectors stopped${NC}"
    exit 0
}

# Set up trap to catch Ctrl+C
trap cleanup SIGINT SIGTERM

# Start all collectors (12 working cities)
start_collector "SF" "collectData.js" "🌉"
start_collector "LA" "collectDataLA.js" "🌴"
start_collector "Seattle" "collectDataSeattle.js" "☕"
start_collector "Portland" "collectDataPortland.js" "🚲"
start_collector "Boston" "collectDataBoston.js" "🦞"
start_collector "Philadelphia" "collectDataPhilly.js" "🔔"
start_collector "San Jose" "collectDataVTA.js" "💻"
start_collector "Toronto" "collectDataToronto.js" "🍁"
start_collector "Minneapolis" "collectDataMinneapolis.js" "🌆"
start_collector "Denver" "collectDataDenver.js" "🏔️"
start_collector "Salt Lake City" "collectDataSaltLakeCity.js" "🏔️"
start_collector "Pittsburgh" "collectDataPittsburgh.js" "🏗️"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ All 12 collectors running!${NC}"
echo ""
echo "📊 Logs will appear below, prefixed by city."
echo "🛑 Press Ctrl+C to stop all collectors."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Wait for all background processes
wait

