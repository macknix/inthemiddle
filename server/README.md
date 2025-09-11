# Backend - Server Directory

Backend Python code for the "Meet in the Middle" Flask application. Provides REST endpoints and Google Maps integrations plus two algorithms for choosing a fair meeting point.

## 📁 Structure

```
server/
├── 🐍 __init__.py          # Package initialization
├── 🌐 app.py               # Flask API server (endpoints, config, timing)
├── 🗺️ maps_service.py      # Google Maps integration + algorithms
├── 📁 serve_map.py         # Static file server (serves ../public)
└── 🧪 tests/
    ├── test_api.py         # API endpoint unit tests
    └── demo.py             # Demo scripts and examples
```

## 🚀 Main Components

### `app.py` - Flask API Server
- **Purpose**: REST API endpoints and request lifecycle logging
- **Port**: 5000 (when run directly); 5001 when started by `run_dev.py`
- **Endpoints**: Health check, geocoding, config, meeting point finding
- **Features**: CORS enabled, error handling, environment/algorithm configuration

**Key Routes:**
```python
GET  /                     # Health check
POST /api/geocode          # Address geocoding
GET  /api/config           # Frontend config (API base, Maps API key presence)
POST /api/find-middle-point # Find optimal meeting point (supports algorithm override)
```

### `maps_service.py` - Google Maps + Algorithms
- **Purpose**: Wrapper for Google Maps APIs and core algorithms
- **Classes**: `GoogleMapsService`, `MiddlePointFinder` (geographic), `MiddlePointFinderTwo` (route-based minimax)
- **Features**: Geocoding, Distance Matrix batching, Places search, polyline decoding, route sampling (global + local refinement), strict minimax objective

**Key Classes:**
```python
class GoogleMapsService:
  # Geocoding, Directions (transit), Distance Matrix batching, Places
  geocode_address()
  get_transit_time()
  get_fastest_transit_route()  # overview polyline, distance, duration, decoded points
  find_places_nearby()
  get_transit_times_matrix()
  decode_polyline()

class MiddlePointFinder:
  # Default algorithm: geographic midpoint + Places composite score
  find_optimal_meeting_point()

class MiddlePointFinderTwo:
  # Route-based minimax: minimize max travel time along fastest transit route
  # Uniform global sampling (with optional lateral offsets) + local refinements
  find_optimal_meeting_point()
```

### `serve_map.py` - Static File Server
- **Purpose**: Serves frontend files from `public/` directory
- **Port**: 8082
- **Features**: CORS headers, auto-open browser, clean logging

### `tests/` - Testing Suite

#### `test_api.py` - API Unit Tests
- **Purpose**: Test Flask API endpoints
- **Coverage**: All major API routes and error cases
- **Usage**: `python -m server.tests.test_api`

#### `demo.py` - Demo Scripts
- **Purpose**: Example usage and testing scripts
- **Features**: Sample API calls, data formatting examples
- **Usage**: `python -m server.tests.demo`

## 🔧 API Documentation

### Health Check Endpoint
```http
GET /
```
**Response:**
```json
{
  "message": "Meet in the Middle API is running!",
  "endpoints": {
    "find_middle_point": "/api/find-middle-point",
    "geocode": "/api/geocode",
  "config": "/api/config",
    "health": "/"
  },
  "status": "healthy"
}
```

### Geocoding Endpoint
```http
POST /api/geocode
Content-Type: application/json

{
  "address": "Times Square, New York, NY"
}
```

### Config Endpoint
```http
GET /api/config
```
**Response:**
```json
{
  "success": true,
  "data": {
    "googleMapsApiKey": "<masked or null>",
    "apiBaseUrl": "http://localhost:5000"
  }
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "formatted_address": "Manhattan, NY 10036, USA",
    "lat": 40.7579747,
    "lng": -73.9855426
  }
}
```

### Meeting Point Finder
```http
POST /api/find-middle-point
Content-Type: application/json

{
  "address1": "Brooklyn Bridge, NY",
  "address2": "Central Park, NY",
  "search_radius": 2000,
  "algorithm": "default" | "route-midpoint"  // optional; overrides env default
}
```
Per-request `algorithm` overrides the `MIDDLEPOINT_ALGORITHM` env default.

**Response (default algorithm):**
```json
{
  "success": true,
  "data": {
    "address1": { "input": "...", "geocoded": {"lat": 0, "lng": 0} },
    "address2": { "input": "...", "geocoded": {"lat": 0, "lng": 0} },
    "geographic_midpoint": { "lat": 0, "lng": 0 },
    "geographic_midpoint_transit_times": {
      "from_address1_seconds": 900,
      "from_address2_seconds": 960
    },
    "optimal_meeting_point": { /* best place with fairness/efficiency scores */ },
    "nearby_alternatives": [...],
    "categorized_businesses": { "restaurant": [...], "cafe": [...], ... }
  }
}
```

**Response (route-midpoint algorithm):**
```json
{
  "success": true,
  "data": {
    "algorithm": "route-midpoint",
    "address1": { "input": "...", "geocoded": {"lat": 0, "lng": 0} },
    "address2": { "input": "...", "geocoded": {"lat": 0, "lng": 0} },
    "route": {
      "overview_polyline": "{encoded}",
      "distance_meters": 12345,
      "duration_seconds": 1800
    },
    "meeting_point": { "lat": 0, "lng": 0 },
    "minimax_metrics": {
      "from_address1_seconds": 900,
      "from_address2_seconds": 900,
      "max_travel_time_seconds": 900,
      "time_difference_seconds": 0
    },
    "optimal_meeting_point": { /* best place with scores */ },
    "nearby_alternatives": [...],
    "categorized_businesses": { ... },
    "route_sampling_points": [ /* optional, for visualization */ ]
  }
}
```

## 🔑 Environment Configuration

### Required Environment Variables
```bash
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
MIDDLEPOINT_ALGORITHM=default        # or route-midpoint (optional)
# Optional performance tuning
DM_MAX_DEST=25
DM_PARALLEL_CHUNKS=3
GMAPS_MAX_WORKERS=10
```

### Google Maps APIs Required
- **Maps JavaScript API**: For frontend map display
- **Geocoding API**: Address to coordinates conversion
- **Directions API**: Route calculation and transit times
- **Places API**: Business search and discovery

## 🛠️ Development

### Running the Server
```bash
# Main Flask API server
python -m server.app
# Or: python main.py

# Static file server
python -m server.serve_map
```

### Algorithm Selection
- Default: `MiddlePointFinder` (geographic midpoint + composite scoring)
- Alternate: `MiddlePointFinderTwo` (route-based strict minimax)

You can select the algorithm in two ways:
- Environment default: set `MIDDLEPOINT_ALGORITHM=default` or `route-midpoint`
- Per-request override: include `{ "algorithm": "default" | "route-midpoint" }` in `/api/find-middle-point` body

### Testing & Demo
```bash
# Run unit tests
python -m server.tests.test_api

# Run in-file demo (requires API key)
python server/maps_service.py

# Test setup verification
python test_setup.py
```

### Adding New Endpoints
1. Add route handler in `app.py`
2. Add business logic in `maps_service.py` if needed
3. Add tests in `tests/test_api.py`
4. Update API documentation

## 🏗️ Architecture

### Design Patterns
- **Service Layer**: Business logic separated in `maps_service.py`
- **Error Handling**: Consistent error responses across endpoints
- **Configuration**: Environment-based configuration
- **Testing**: Comprehensive unit test coverage

### Dependencies
```python
# Core Framework
Flask==2.3.3
Flask-Cors==4.0.0

# Google Maps Integration  
googlemaps==4.10.0

# Utilities
python-dotenv==1.0.0
requests==2.31.0
geopy==2.3.0
```

### Error Handling
```python
# Consistent error response format
{
  "success": false,
  "error": "Descriptive error message",
  "details": "Additional error details if applicable"
}
```

## 🔒 Security Considerations

- **API Key Protection**: Environment variables for sensitive data
- **CORS Configuration**: Controlled cross-origin access
- **Input Validation**: Request data validation and sanitization
- **Rate Limiting**: Consider implementing for production use

## 📈 Performance

- **Caching**: Google Maps API responses cached when possible
- **Async Operations**: Non-blocking API calls where applicable
- **Error Recovery**: Graceful degradation on API failures
- **Resource Management**: Efficient memory and connection handling

## 🐛 Debugging

### Development Mode
```bash
# Enable Flask debug mode
export FLASK_DEBUG=1
python -m server.app
```

### Logging
- API requests logged to console
- Error details in debug mode
- Google Maps API quota monitoring

### Common Issues
- **API Key Issues**: Check `.env` configuration
- **Port Conflicts**: Ensure ports 5000/8082 are available
- **CORS Errors**: Verify frontend/backend URL configuration
