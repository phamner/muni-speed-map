#!/bin/bash

# Collect data for all frontend cities EXCEPT SF, Portland, and Toronto
# Each collector runs as a separate background process with its own output

echo ""
echo "🚀 Starting collectors (excluding SF, Portland, Toronto)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

declare -a PIDS=()

start_collector() {
    local city=$1
    local script=$2
    local emoji=$3
    
    echo -e "${CYAN}Starting ${city}...${NC}"
    
    node "scripts/${script}" 2>&1 | while IFS= read -r line; do
        echo -e "${emoji} [${city}] ${line}"
    done &
    
    PIDS+=($!)
    echo -e "${GREEN}  ✓ ${city} collector started (PID: $!)${NC}"
}

cleanup() {
    echo ""
    echo -e "${YELLOW}🛑 Stopping all collectors...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null
        fi
    done
    pkill -P $$ 2>/dev/null
    echo -e "${GREEN}✓ All collectors stopped${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

start_collector "Baltimore" "collectDataBaltimore.js" "🦀"
start_collector "Boston" "collectDataBoston.js" "🦞"
start_collector "Charlotte" "collectDataCharlotte.js" "🏦"
start_collector "Cleveland" "collectDataCleveland.js" "🎸"
start_collector "Denver" "collectDataDenver.js" "⛏️"
start_collector "LA" "collectDataLA.js" "🌴"
start_collector "Minneapolis" "collectDataMinneapolis.js" "🌲"
start_collector "Philadelphia" "collectDataPhilly.js" "🔔"
start_collector "Phoenix" "collectDataPhoenix.js" "🌵"
start_collector "Pittsburgh" "collectDataPittsburgh.js" "🏗️"
start_collector "Salt Lake City" "collectDataSaltLakeCity.js" "🏔️"
start_collector "San Diego" "collectDataSanDiego.js" "🌊"
start_collector "San Jose" "collectDataVTA.js" "💻"
start_collector "Seattle" "collectDataSeattle.js" "☕"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ 14 collectors running (SF, Portland, Toronto excluded)${NC}"
echo ""
echo "📊 Logs will appear below, prefixed by city."
echo "🛑 Press Ctrl+C to stop all collectors."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

wait
