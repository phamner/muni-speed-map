#!/usr/bin/env python3
"""
Add trafficLights field to all city data loaders
"""

import re

# Read the file
with open('src/data/cityDataLoaders.ts', 'r') as f:
    content = f.read()

# Pattern 1: Add after "separation: separation.default,"
content = re.sub(
    r'(separation: separation\.default,)\n',
    r'\1\n        trafficLights: null,\n',
    content
)

# Pattern 2: Add after "separation: mergedSeparation,"
content = re.sub(
    r'(separation: mergedSeparation,)\n',
    r'\1\n        trafficLights: null,\n',
    content
)

# Pattern 3: Add after "separation: separation?.default || null,"
content = re.sub(
    r'(separation: separation\?\.default \|\| null,)\n',
    r'\1\n        trafficLights: null,\n',
    content
)

# Pattern 4: Add after "separation: null," in empty cities
content = re.sub(
    r'(separation: null,)\n(\s+}\n\s+}\n)',
    r'\1\n        trafficLights: null,\n\2',
    content
)

# Pattern 5: Handle the merged separation features case
content = re.sub(
    r'(features: mergedSeparationFeatures,\n\s+},)\n',
    r'\1\n        trafficLights: null,\n',
    content
)

# Update the interface
content = re.sub(
    r'(// Type for city static data \(routes, stops, crossings, switches, maxspeed, tunnelsBridges, separation)\)',
    r'\1, trafficLights)',
    content
)

content = re.sub(
    r'(separation: any \| null;)\n(\s+railContextHeavy)',
    r'\1\n  trafficLights: any | null;\n\2',
    content
)

# Write back
with open('src/data/cityDataLoaders.ts', 'w') as f:
    f.write(content)

print("✅ Added trafficLights field to cityDataLoaders.ts")
