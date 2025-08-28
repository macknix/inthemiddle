# Backend - Server Directory

This directory contains all backend Python code for the "Meet in the Middle" Flask application.

## 📁 Structure

```
server/
├── 🐍 __init__.py          # Package initialization
├── 🌐 app.py               # Main Flask application (API server)
├── 🗺️ maps_service.py      # Google Maps API integration
├── 📁 serve_map.py         # Static file server
└── 🧪 tests/
    ├── test_api.py         # API endpoint unit tests
    └── demo.py             # Demo scripts and examples
```

## 🚀 Main Components

### `app.py` - Flask API Server
- **Purpose**: Main Flask application providing REST API
- **Port**: 5001
- **Endpoints**: Health check, geocoding, meeting point finding
- **Features**: CORS enabled, error handling, environment configuration

**Key Routes:**
```python
GET  /                     # Health check
POST /api/geocode          # Address geocoding
POST /api/find-middle-point # Find optimal meeting point
```

### `maps_service.py` - Google Maps Integration
- **Purpose**: Wrapper for Google Maps APIs
- **Classes**: `GoogleMapsService`, `MiddlePointFinder`
- **Features**: Geocoding, directions, places search, transit times

**Key Classes:**
```python
class GoogleMapsService:
    # Direct Google Maps API integration
    def geocode_address()
    def get_directions()
    def search_nearby_places()

class MiddlePointFinder:
    # Business logic for finding meeting points
    def find_optimal_meeting_point()
    def calculate_transit_times()
```

### `serve_map.py` - Static File Server
- **Purpose**: Serves frontend files from `public/` directory
- **Port**: 8082
- **Features**: CORS headers, auto-browser opening, clean logging

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
  "transport_mode": "transit",
  "search_nearby_businesses": true,
  "business_types": ["restaurant", "cafe"]
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "middle_point": {
      "lat": 40.7589,
      "lng": -73.9851,
      "address": "Lower Manhattan, NY"
    },
    "route_info": {
      "address1_to_middle": { "duration": "15 mins", "distance": "2.1 km" },
      "address2_to_middle": { "duration": "16 mins", "distance": "2.3 km" }
    },
    "nearby_businesses": [...]
  }
}
```

## 🔑 Environment Configuration

### Required Environment Variables
```bash
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
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

### Testing
```bash
# Run unit tests
python -m server.tests.test_api

# Run demo scripts
python -m server.tests.demo

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
- **Port Conflicts**: Ensure ports 5001/8082 are available
- **CORS Errors**: Verify frontend/backend URL configuration
