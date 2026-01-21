#!/bin/bash

# Collector script for multiple cities
# Runs collectors for: Baltimore, Seattle, Boston, Toronto, Minneapolis, Salt Lake City, Phoenix, Charlotte
# Each runs in the background so they collect simultaneously

cd "$(dirname "$0")/.."

echo "Starting collectors for 8 cities..."
echo ""

# Start all collectors in background
node scripts/collectDataBaltimore.js &
echo "✓ Baltimore collector started (PID: $!)"

node scripts/collectDataSeattle.js &
echo "✓ Seattle collector started (PID: $!)"

node scripts/collectDataBoston.js &
echo "✓ Boston collector started (PID: $!)"

node scripts/collectDataToronto.js &
echo "✓ Toronto collector started (PID: $!)"

node scripts/collectDataMinneapolis.js &
echo "✓ Minneapolis collector started (PID: $!)"

node scripts/collectDataSaltLakeCity.js &
echo "✓ Salt Lake City collector started (PID: $!)"

node scripts/collectDataPhoenix.js &
echo "✓ Phoenix collector started (PID: $!)"

node scripts/collectDataCharlotte.js &
echo "✓ Charlotte collector started (PID: $!)"

echo ""
echo "All 8 collectors are running in the background."
echo "They will poll every 90 seconds until stopped."
echo ""
echo "To stop all collectors, run: pkill -f 'collectData'"
echo "Or press Ctrl+C if running in foreground mode."

# Wait for all background jobs
wait
