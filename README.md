# 🚊 Transit Speed Map

A real-time visualization tool for analyzing light rail and streetcar speeds across major US cities. Identify slow zones, compare performance, and support data-driven transit advocacy.

![Transit Speed Map Screenshot](docs/screenshot-sf.png)

---

## 🎯 The Problem

**Light rail and streetcars are slow when they share the street with cars.**

Across the US, billions of dollars have been invested in light rail systems — yet many operate at frustratingly slow speeds because they're stuck in traffic, waiting at signals, or blocked by turning vehicles. This undermines ridership, wastes operating costs, and makes transit less competitive with driving.

The solution is known: **upgrade the right-of-way**. Move from mixed traffic → dedicated lanes → physical separation → full grade separation. But cities often lack data showing _exactly where_ trains are slowest and _why_.

## 💡 The Approach

This tool collects real-time GPS positions from transit vehicles, calculates their speeds, and visualizes the results on a map. By aggregating thousands of data points over days and weeks, patterns emerge:

- **Red zones** = Trains consistently slow down here (traffic conflicts, bad signal timing)
- **Cyan zones** = Trains move freely here (dedicated ROW, grade separation)
- **Grade crossings** = Street intersections where trains cross traffic at-grade

The goal: **Give transit advocates and planners the data they need to prioritize ROW improvements.**

## 🏙️ Why These Cities?

Each city was selected because its light rail or streetcar system has **significant street-running sections** where trains compete with traffic:

| City                  | System           | Why It's Interesting                                                                        |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| 🌉 **San Francisco**  | Muni Metro       | Surface lines (N, T, F) mix with traffic; subway portal queuing is a known bottleneck       |
| 🌴 **Los Angeles**    | Metro Rail       | E Line (Expo) and A Line (Blue) have extensive street-running in Downtown LA and Long Beach |
| ☕ **Seattle**        | Link Light Rail  | Rainier Valley section runs at-grade through neighborhoods with many crossings              |
| 🦞 **Boston**         | Green Line       | The oldest US subway, with extensive street-running branches (B, C, E)                      |
| 🚲 **Portland**       | MAX Light Rail   | Pioneer of modern US light rail, with downtown street-running and suburban grade crossings  |
| 🔔 **Philadelphia**   | SEPTA Trolleys   | Historic trolley network with subway-surface lines and West Philadelphia street-running     |
| 💻 **San Jose**       | VTA Light Rail   | Silicon Valley light rail with extensive street-running through downtown San Jose           |
| 🍁 **Toronto**        | TTC Streetcars   | Largest streetcar network in North America with extensive mixed-traffic operation           |
| 🌆 **Minneapolis**    | Metro Transit    | Blue and Green Lines have at-grade sections in urban areas                                  |
| 🏔️ **Denver**         | RTD Light Rail   | Downtown street-running sections with at-grade crossings                                    |
| 🏔️ **Salt Lake City** | UTA TRAX         | Four light rail lines with street-running through downtown Salt Lake City                   |
| 🏗️ **Pittsburgh**     | The T Light Rail | Historic light rail system with downtown subway and South Hills surface sections            |
| 🏛️ **Sacramento**     | SacRT Light Rail | Street-running through downtown Sacramento with Gold and Blue Lines                         |

**Not included:** Heavy rail systems (BART, NYC Subway, DC Metro) that are fully grade-separated — they don't have traffic conflicts to analyze.

### 🔮 Potential Future Cities

These systems have significant street-running and could be added:

| City             | System       | Why It's a Good Candidate                                                      |
| ---------------- | ------------ | ------------------------------------------------------------------------------ |
| 🌊 **San Diego** | MTS Trolley  | Large network with street-running sections through downtown and East County    |
| 🌵 **Phoenix**   | Valley Metro | Extensive street-running through downtown and Tempe                            |
| 🤠 **Houston**   | METRORail    | Red Line runs at-grade through Midtown and Medical Center                      |
| 🇨🇦 **Calgary**   | CTrain       | One of North America's busiest light rail systems with downtown street-running |
| 🇨🇦 **Edmonton**  | ETS LRT      | Capital, Metro, and Valley Lines with urban at-grade sections                  |

### ❌ Systems We Chose Not to Include

| System                                   | Why Not                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| **BART** (SF Bay Area)                   | Fully grade-separated heavy rail — no traffic conflicts to analyze                      |
| **NYC Subway**                           | Underground/elevated heavy rail — speed issues are scheduling, not traffic              |
| **DC Metro**                             | Fully grade-separated — no street-running sections                                      |
| **Chicago L**                            | Elevated/subway heavy rail — traffic conflicts not a factor                             |
| **Caltrain / Metrolink / Commuter Rail** | Mostly dedicated ROW with rural crossings — different problem than urban street-running |

The focus remains on **light rail and streetcars that compete with street traffic** — where ROW improvements can make the biggest difference.

---

## 🌆 Supported Cities

| City                  | System           | Lines                            | Status        |
| --------------------- | ---------------- | -------------------------------- | ------------- |
| 🌉 **San Francisco**  | Muni Metro       | F, J, K, L, M, N, T              | ✅ Collecting |
| 🌴 **Los Angeles**    | Metro Rail       | A, B, C, D, E, K                 | ✅ Collecting |
| ☕ **Seattle**        | Link Light Rail  | 1 Line, 2 Line, T Line           | ✅ Collecting |
| 🚲 **Portland**       | MAX Light Rail   | Blue, Green, Orange, Red, Yellow | ✅ Collecting |
| 🦞 **Boston**         | MBTA Green Line  | B, C, D, E                       | ✅ Collecting |
| 🔔 **Philadelphia**   | SEPTA Trolleys   | 10, 11, 13, 15, 34, 36, 101, 102 | ✅ Collecting |
| 💻 **San Jose**       | VTA Light Rail   | Blue, Green, Orange              | ✅ Collecting |
| 🍁 **Toronto**        | TTC Streetcars   | 501-512, Line 6 Finch West       | ✅ Collecting |
| 🌆 **Minneapolis**    | Metro Transit    | Blue, Green                      | ✅ Collecting |
| 🏔️ **Denver**         | RTD Light Rail   | A, B, C, D, E, F, G, H, L, R, W  | ✅ Collecting |
| 🏔️ **Salt Lake City** | UTA TRAX         | Blue, Red, Green, S-Line         | ✅ Collecting |
| 🏗️ **Pittsburgh**     | The T Light Rail | Red, Blue, Silver                | ✅ Collecting |
| 🏛️ **Sacramento**     | SacRT Light Rail | Gold, Blue                       | ✅ Collecting |
| 🌊 **San Diego**      | MTS Trolley      | Blue, Orange, Green, Copper      | ⏳ Needs key  |
| 🤠 **Dallas**         | DART Light Rail  | Red, Blue, Green, Orange         | ⏳ Needs key  |

## ✨ Features

### Speed Visualization

- **Color-coded data points**: Red (slow) → Yellow → Cyan (fast)
- **Raw data view**: Individual GPS readings with calculated speeds
- **Segment average view**: 100m track segments colored by average speed

![Segment View](docs/screenshot-segments.png)

### Filtering & Analysis

- Filter by transit line
- Filter by speed range (min/max mph)
- Hide stopped trains (0 mph)
- Toggle route lines, stations, and grade crossings

### Grade Crossings

- Street-level railroad crossings from OpenStreetMap
- Identify potential conflict points that slow trains
- Clustered markers to reduce visual clutter

### Statistics

- Average and median speed per line
- Lines ranked fastest to slowest
- Real-time position counts

## 🛠️ Setup

### Prerequisites

- Node.js 20+
- A Supabase account (free tier works)

### Installation

```bash
# Clone the repository
git clone https://github.com/philiphamner/muni-speed-map.git
cd muni-speed-map

# Install dependencies
npm install

# Create .env file with your Supabase credentials
cp .env.example .env
# Edit .env with your SUPABASE_URL and SUPABASE_ANON_KEY
```

### Database Setup

Run this SQL in your Supabase SQL editor:

```sql
CREATE TABLE vehicle_positions (
  id SERIAL PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  route_id TEXT,
  direction_id TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  city TEXT
);

CREATE INDEX idx_vehicle_positions_recorded_at ON vehicle_positions(recorded_at DESC);
CREATE INDEX idx_vehicle_positions_city ON vehicle_positions(city);
```

### Running the App

```bash
# Start the development server
npm run dev

# In another terminal, start data collection (see table below)
npm run collect:sf

# Or run all collectors at once (12 cities)
npm run collect:all
```

### 📜 Collection Scripts

| Command                       | City           | Script                       | Status           |
| ----------------------------- | -------------- | ---------------------------- | ---------------- |
| `npm run collect:sf`          | San Francisco  | `collectData.js`             | ✅ Active        |
| `npm run collect:la`          | Los Angeles    | `collectDataLA.js`           | ✅ Active        |
| `npm run collect:seattle`     | Seattle        | `collectDataSeattle.js`      | ✅ Active        |
| `npm run collect:portland`    | Portland       | `collectDataPortland.js`     | ✅ Active        |
| `npm run collect:boston`      | Boston         | `collectDataBoston.js`       | ✅ Active        |
| `npm run collect:philly`      | Philadelphia   | `collectDataPhilly.js`       | ✅ Active        |
| `npm run collect:toronto`     | Toronto        | `collectDataToronto.js`      | ✅ Active        |
| `npm run collect:sacramento`  | Sacramento     | `collectDataSacramento.js`   | ✅ Active        |
| `npm run collect:minneapolis` | Minneapolis    | `collectDataMinneapolis.js`  | ✅ Active        |
| `npm run collect:denver`      | Denver         | `collectDataDenver.js`       | ✅ Active        |
| `npm run collect:slc`         | Salt Lake City | `collectDataSaltLakeCity.js` | ✅ Active        |
| `npm run collect:pittsburgh`  | Pittsburgh     | `collectDataPittsburgh.js`   | ✅ Active        |
| `npm run collect:vta`         | San Jose (VTA) | `collectDataVTA.js`          | ✅ Active        |
| `npm run collect:sandiego`    | San Diego      | `collectDataSanDiego.js`     | ⏳ Needs API key |
| `npm run collect:dallas`      | Dallas         | `collectDataDallas.js`       | ⏳ Needs API key |

**Combined Scripts:**

| Command                          | Cities                      | Script                        |
| -------------------------------- | --------------------------- | ----------------------------- |
| `npm run collect:all`            | All 12 active cities        | `collectAll.sh`               |
| `npm run collect:seattle-denver` | Seattle + Denver            | `collectDataSeattleDenver.js` |
| `npm run collect:slc-pit`        | Salt Lake City + Pittsburgh | `collectDataSlcPittsburgh.js` |

## 📊 Data Collection

### How Speed is Calculated

- **SF, Seattle, San Diego, Philadelphia**: Speed calculated from GPS distance ÷ time between consecutive readings (~90 seconds apart)
- **LA, Boston, Portland, Toronto, Sacramento**: Speed reported directly by the transit agency's API

### API Keys Required

| City           | API                 | Key Required?                                                                                  |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| San Francisco  | 511.org GTFS-RT     | ✅ Yes - https://511.org/open-data                                                             |
| Los Angeles    | Metro WebSocket     | ❌ No key needed                                                                               |
| Seattle        | OneBusAway          | ✅ Yes - https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd |
| Portland       | TriMet GTFS-RT      | ✅ Yes - https://developer.trimet.org/appid/registration/                                      |
| Boston         | MBTA V3 API         | ✅ Yes - https://api-v3.mbta.com/                                                              |
| Philadelphia   | SEPTA TransitView   | ❌ No key needed                                                                               |
| San Jose (VTA) | 511.org GTFS-RT     | ✅ Yes - https://511.org/open-data                                                             |
| Toronto        | TTC GTFS-RT/NextBus | ❌ No key needed                                                                               |
| Minneapolis    | Metro Transit       | ❌ No key needed                                                                               |
| Denver         | RTD GTFS-RT         | ❌ No key needed                                                                               |
| Salt Lake City | UTA GTFS-RT         | ❌ No key needed                                                                               |
| Pittsburgh     | PRT TrueTime        | ❌ No key needed                                                                               |
| Sacramento     | SacRT GTFS-RT       | ❌ No key needed                                                                               |
| San Diego      | MTS GTFS-RT         | ✅ Yes - https://www.sdmts.com/business-center/app-developers                                  |

### Data Retention

- Frontend displays last 7 days of data
- Supabase `pg_cron` job deletes data older than 8 days (optional)

## 🗂️ Project Structure

```
muni-speed-map/
├── src/
│   ├── components/
│   │   ├── SpeedMap.tsx      # Main map component
│   │   └── Controls.tsx      # Sidebar with filters
│   ├── data/                 # Generated GeoJSON files
│   │   ├── *Routes.json      # Transit line geometries
│   │   ├── *Stops.json       # Station locations
│   │   └── *Crossings.json   # Grade crossing data
│   └── types.ts              # TypeScript definitions
├── scripts/
│   ├── collectData*.js       # Data collection scripts
│   ├── parseGtfs*.js         # GTFS route parsers
│   ├── parseStops*.js        # GTFS stop parsers
│   └── fetchCrossings.js     # Grade crossing fetcher
└── gtfs_*/                   # Raw GTFS data (not in git)
```

## 🔄 Updating GTFS Data

If transit routes change, refresh the static data:

```bash
# 1. Download fresh GTFS data to gtfs_cityname/
# 2. Re-run parsers
npm run parse-gtfs:sf
npm run parse-stops:sf
npm run fetch-crossings
```

## 🎯 Use Cases

### Transit Advocacy

- Identify slow zones caused by traffic conflicts
- Support arguments for transit priority signals
- Compare street-running vs. grade-separated performance

### Planning & Analysis

- Understand real-world operating speeds vs. scheduled
- Identify patterns by time of day (future feature)
- Compare performance across cities

## 📝 License

MIT License - feel free to use and adapt for transit advocacy in your city!

## 🙏 Data Sources

- **San Francisco**: [511.org](https://511.org/open-data) GTFS-realtime
- **Los Angeles**: [LA Metro API](https://developer.metro.net/)
- **Seattle**: [Sound Transit OneBusAway](https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd)
- **Portland**: [TriMet Developer Resources](https://developer.trimet.org/)
- **Boston**: [MBTA V3 API](https://api-v3.mbta.com/)
- **Philadelphia**: [SEPTA API](https://www3.septa.org/developer/)
- **San Jose**: [511.org](https://511.org/open-data) VTA GTFS-realtime
- **Toronto**: [TTC BusTime GTFS-RT](https://bustime.ttc.ca/gtfsrt/) + NextBus API
- **Minneapolis**: [Metro Transit GTFS-RT](https://svc.metrotransit.org/)
- **Denver**: [RTD GTFS-RT](https://www.rtd-denver.com/developer-resources)
- **Salt Lake City**: [UTA GTFS-RT](https://www.rideuta.com/Developer-Resources)
- **Pittsburgh**: [PRT TrueTime GTFS-RT](https://truetime.portauthority.org/)
- **Sacramento**: [SacRT Transit Data Portal](https://www.sacrt.com/transit-data-portal/)
- **San Diego**: [MTS Developer Resources](https://www.sdmts.com/business-center/app-developers)
- **Grade Crossings**: [OpenStreetMap](https://www.openstreetmap.org/) via Overpass API
- **Base Map**: [CARTO Dark Matter](https://carto.com/basemaps/)

---

_Built with React, MapLibre GL, and Supabase_
