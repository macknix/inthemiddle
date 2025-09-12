# Meet in the Middle

Find a fair, transit-friendly place to meet between two addresses. The app offers two algorithms (default geographic midpoint and a route-based strict minimax) and shows nearby places via Google Places.

## 🏗️ Project Structure

```
meet-in-the-middle/
├── public/                 # Frontend assets (served directly to users)
│   ├── index.html         # Main application interface
│   ├── styles/
│   │   └── main.css      # Application styles
│   ├── scripts/
│   │   └── main.js       # Frontend JavaScript logic
│   └── *.html            # Other HTML pages (test, debug, etc.)
├── server/                # Backend Python code
│   ├── __init__.py       # Server package initialization
│   ├── app.py            # Flask API (endpoints and wiring)
│   ├── maps_service.py   # Google Maps integration + algorithms
│   ├── serve_map.py      # Static file server
│   └── tests/
│       ├── test_api.py   # API unit tests
│       └── demo.py       # Demo/example scripts
├── env/                  # Python virtual environment
├── main.py              # Alternative entry point (runs API on 5000)
├── run_dev.py           # Development server script
├── requirements.txt     # Python dependencies
├── .env                 # Environment variables (API keys)
└── README.md           # This file
```

## 🚀 Features

- Two algorithms:
   - Default: geographic midpoint seed with fairness/efficiency composite scoring across nearby Places
   - Route-based: strict minimax objective (minimize the maximum of the two transit times) sampled along the fastest public-transit route
- Transit-only directions and scoring (no driving fallback)
- Resilient frontend bootstrap: loads `main.js` first, discovers `/api/config`, then injects Google Maps script
- Clear UX on failures: if no transit route is found, shows a concise error (no map overlays); also shows a "no meeting point found" message if calls succeed but no candidates qualify
- Nearby Places discovery and lightweight categorization

## 🛠️ Setup and Installation

### Prerequisites
- Python 3.10+
- Google Maps API key with the following APIs enabled:
  - Maps JavaScript API
  - Geocoding API
  - Directions API
  - Places API

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd meet-in-the-middle
   ```

2. **Create and activate virtual environment**
   ```bash
   python3 -m venv env
   source env/bin/activate  # On Windows: env\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env and add your Google Maps API key
   echo "GOOGLE_MAPS_API_KEY=your_api_key_here" > .env
   ```

## 🎮 Running the Application

### Development Mode (Recommended)
Start both servers with one command:
```bash
source env/bin/activate
python run_dev.py
```

This will start:
- **API Server**: http://localhost:5001
- **Web Interface**: http://localhost:8082

### Manual Start (Individual Servers)

**Start the Flask API server:**
```bash
source env/bin/activate
python -m server.app
# Or: python main.py
```

**Start the static file server:**
```bash
source env/bin/activate
python -m server.serve_map
```

## 🧪 Testing

**Run API tests:**
```bash
source env/bin/activate
python -m server.tests.test_api
```

**Run backend demo (route-based + default) in `maps_service.py`:**
```bash
source env/bin/activate
python server/maps_service.py
```
The demo runs sample addresses and prints JSON summaries. Requires a valid `GOOGLE_MAPS_API_KEY`.

## 📖 Usage

1. **Open the web interface** at http://localhost:8080
2. **Enter two addresses** in the input fields
3. **Click "Find Meeting Point"** to analyze optimal locations
4. **Explore the map** with markers showing:
   - 🔵 **A**: First address
   - 🔴 **B**: Second address  
   - ⭐ **Green**: Optimal meeting point
   - 🟡 **Yellow**: Alternative options
   - 🔵 **Small**: Nearby businesses
5. **Use business filters** in the sidebar to show/hide:
   - 🍽️ Restaurants
   - ☕ Cafes
   - 🍺 Bars
   - 🛍️ Shopping
   - 🌳 Parks
   - 🏛️ Attractions
   - 💪 Gyms
   - 📚 Libraries
6. **Switch to "Travel Routes" tab** to see detailed directions

## 🔧 API Endpoints

- `GET /` — Health check and available endpoints
- `GET /api/config` — Frontend config: base URL and whether a Maps key is configured
- `POST /api/find-middle-point` — Find optimal meeting point (supports per-request `{ "algorithm": "default" | "route-midpoint" }`)
- `POST /api/geocode` — Geocode an address
- `POST /api/transit-time` — Transit time between two coordinates

## 🎨 Architecture

### Backend (Flask)
- Google Maps client with batching for Distance Matrix, light in-process caching, and thread-pooled async wrappers
- Two algorithms:
   - `MiddlePointFinder` (default): geocode → geographic midpoint → Places search → composite scoring (fairness + efficiency)
   - `MiddlePointFinderTwo` (route-based): fastest transit route → global sampling (plus lateral offsets) → batched Distance Matrix → strict minimax → local refinements
- Detailed timing logs and per-request process-time headers

### Frontend (Vanilla JavaScript)
- **Modern ES6+**: Uses modern JavaScript features
- **Modular CSS**: Organized stylesheets with responsive design
- **Interactive Maps**: Google Maps integration with custom markers and info windows
- **Real-time Filtering**: Dynamic business filtering without page reload

## 🌍 Environment Variables

Create a `.env` file with at least:
```
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

Optional tuning knobs:
```
# Select default algorithm used by the API when not overridden per request
MIDDLEPOINT_ALGORITHM=default   # or route-midpoint

# Google Distance Matrix batching
DM_MAX_DEST=25                  # max destinations per DM chunk
DM_PARALLEL_CHUNKS=3            # max concurrent DM chunk requests

# Thread pool size for GoogleMapsService async wrappers
GMAPS_MAX_WORKERS=10
```

## 📝 Notes

- Transit-only: if Google returns no transit routes, the UI shows an error message and no overlays.
- If Places are found but none have valid transit times, the UI shows a "no meeting point found" message.
- Route sampling points may be included in the API response for visualization/testing when using the route-based algorithm.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.
