# Meet in the Middle API

A Python Flask API that finds optimal meeting points between two addresses based on public transport travel time using Google Maps APIs.

## Features

- **Address Geocoding**: Convert addresses to coordinates with address verification
- **Transit Time Calculation**: Get public transport travel times between points
- **Smart Middle Point Finding**: Find optimal meeting locations that minimize travel time differences
- **Nearby Places Discovery**: Suggest meeting venues near the optimal point
- **RESTful API**: Easy to integrate with web and mobile applications

## Setup

### 1. Environment Setup

The project uses a Python virtual environment which is already configured. Activate it:

```bash
source env/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Google Maps API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - **Geocoding API** (for address to coordinates conversion)
   - **Directions API** (for transit time calculation)
   - **Places API** (for finding nearby meeting venues)
4. Create an API key with access to these services
5. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
6. Edit `.env` and add your API key:
   ```
   GOOGLE_MAPS_API_KEY=your_actual_api_key_here
   ```

### 4. Run the API

```bash
python app.py
```

The API will start on `http://localhost:5000`

## API Endpoints

### 1. Health Check
```
GET /
```
Returns API status and available endpoints.

### 2. Geocode Address
```
POST /api/geocode
```
**Request Body:**
```json
{
  "address": "123 Main St, New York, NY"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "formatted_address": "123 Main St, New York, NY 10001, USA",
    "lat": 40.7128,
    "lng": -74.0060
  }
}
```

### 3. Find Middle Point (Main Feature)
```
POST /api/find-middle-point
```
**Request Body:**
```json
{
  "address1": "Times Square, New York, NY",
  "address2": "Brooklyn Bridge, New York, NY",
  "search_radius": 2000
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address1": {
      "input": "Times Square, New York, NY",
      "geocoded": {
        "formatted_address": "Times Square, New York, NY, USA",
        "lat": 40.7580,
        "lng": -73.9855
      }
    },
    "address2": {
      "input": "Brooklyn Bridge, New York, NY",
      "geocoded": {
        "formatted_address": "Brooklyn Bridge, New York, NY, USA",
        "lat": 40.7061,
        "lng": -73.9969
      }
    },
    "geographic_midpoint": {
      "lat": 40.7320,
      "lng": -73.9912
    },
    "optimal_meeting_point": {
      "name": "Washington Square Park",
      "formatted_address": "4th St, New York, NY",
      "lat": 40.7308,
      "lng": -73.9973,
      "time_from_address1": 900,
      "time_from_address2": 1080,
      "time_difference_seconds": 180,
      "time_difference_minutes": 3.0,
      "rating": 4.5,
      "types": ["park", "point_of_interest"]
    },
    "nearby_alternatives": [...]
  }
}
```

### 4. Transit Time
```
POST /api/transit-time
```
**Request Body:**
```json
{
  "origin": {"lat": 40.7128, "lng": -74.0060},
  "destination": {"lat": 40.7589, "lng": -73.9851}
}
```

## Testing

Run the test suite to verify everything is working:

```bash
python test_api.py
```

This will test all endpoints with sample data. Make sure the API is running before running tests.

### Manual Testing Examples

You can also test manually using curl:

```bash
# Health check
curl http://localhost:5000/

# Geocode an address
curl -X POST http://localhost:5000/api/geocode \
  -H "Content-Type: application/json" \
  -d '{"address": "Central Park, New York"}'

# Find middle point
curl -X POST http://localhost:5000/api/find-middle-point \
  -H "Content-Type: application/json" \
  -d '{
    "address1": "Grand Central Terminal, New York",
    "address2": "Brooklyn Bridge, New York",
    "search_radius": 1500
  }'
```

## How It Works

1. **Address Geocoding**: The API first converts both input addresses to precise coordinates using Google's Geocoding API
2. **Geographic Midpoint**: Calculates the mathematical midpoint between the two locations
3. **Transit Time Analysis**: Uses Google's Directions API to calculate public transport travel times
4. **Venue Discovery**: Searches for nearby points of interest around the geographic midpoint using Google Places API
5. **Optimization**: Evaluates each potential meeting spot to find the one that minimizes travel time differences between both parties
6. **Results**: Returns the optimal meeting point along with travel times and alternative options

## Configuration

- `search_radius`: Controls how far from the geographic midpoint to search for venues (100-10000 meters)
- The API prioritizes locations with minimal travel time differences between both starting points
- Results include venue ratings and types to help users choose appropriate meeting spots

## Error Handling

The API includes comprehensive error handling for:
- Invalid addresses that cannot be geocoded
- No available public transport routes
- API key issues
- Network connectivity problems
- Invalid request parameters

## Next Steps

This API provides the backend foundation. You can now:
1. Build a web frontend using React, Vue, or plain HTML/JavaScript
2. Create a mobile app that consumes this API
3. Add features like saved locations, user preferences, or meeting scheduling
4. Integrate with mapping libraries for visual display of results

## Troubleshooting

- **"Google Maps API key not configured"**: Make sure your `.env` file exists and contains a valid API key
- **Geocoding failures**: Check that the addresses are specific enough and exist
- **No transit routes found**: Some locations may not have public transport connections
- **API quota exceeded**: Monitor your Google Maps API usage in the Cloud Console
