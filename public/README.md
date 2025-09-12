# Frontend - Public Directory

Frontend assets for the "Meet in the Middle" web application. The page loads a small bootstrap (`scripts/main.js`) first, discovers `/api/config`, then injects the Google Maps JS with the API key.

## 📁 Structure

```
public/
├── 🏠 index.html           # Main application interface
├── 🎨 styles/
│   └── main.css           # Application styles and responsive design
├── ⚡ scripts/
│   └── main.js            # Frontend JavaScript logic (cleaned & optimized)
└── 📄 README.md           # This documentation
```

## 🌐 Application

### `index.html` - Main Application
- **Purpose**: Primary user interface for finding meeting points
- **Features**: 
  - Address input with validation
  - Interactive Google Maps integration
  - Meeting point and alternative location display
  - Business filtering and discovery
  - Responsive design for all devices
- **URL**: http://localhost:8082/

## 🎨 Styles (`styles/main.css`)

**Key Features:**
- 📱 **Responsive Design**: Mobile-first approach with breakpoints
- 🎨 **Modern UI**: Clean, intuitive interface with smooth transitions
- 🗺️ **Map Integration**: Optimized layout for Google Maps
- 🔘 **Interactive Elements**: Hover effects and user feedback
- 📊 **Business Filters**: Styled category toggles and controls

**CSS Organization:**
```css
/* Base styles and variables */
/* Layout and grid system */
/* Map container styles */
/* Form and input styles */
/* Business filter styles */
/* Responsive media queries */
```

## ⚡ Scripts (`scripts/main.js`)

**Key behaviors:**
- Loads before Maps JS to avoid race conditions
- Fetches `/api/config` to get `apiBaseUrl` and whether a Google Maps key is present
- Injects Maps JS only after `initMaps` is registered

**Key Components:**
- 🗺️ **Map Initialization**: Clean Google Maps setup with Places API
- 🎯 **Meeting Point Display**: Optimal and alternative location markers
- 🏢 **Business Discovery**: Nearby places with interactive InfoWindows
- 🖱️ **Click Handling**: Unified popup system for all map elements
- � **POI Integration**: Custom InfoWindows for Google Places
- 🔄 **API Integration**: Streamlined backend communication

**JavaScript Architecture:**
```javascript
// Core Functions
initMaps()              // Google Maps initialization
setApiBase(url)         // Called after /api/config discovery
displayResultsOnMap()   // Show meeting points and routes
displayBusinesses()     // Show nearby businesses
closeAllInfoWindows()   // Unified popup management
checkApiStatus()        // Backend connectivity
```

**UX notes:**
- Transit-only: no driving fallback is rendered
- If no transit route exists, we show a concise error message and do not leave residual overlays
- If calls succeed but no meeting place qualifies, we show a "no meeting point found" message

## 🔗 API Integration

The frontend discovers the API base from `/api/config` served by the backend. Typical local URLs:

- **API**: http://localhost:5001
- **Web**: http://localhost:8082

Endpoints used:
- `GET /api/config` — configuration and API base
- `POST /api/find-middle-point` — meeting point search

## 🎯 Interactive Features

**Map Interactions:**
- **Meeting Point Markers**: Click to view details (travel times, ratings)
- **Alternative Markers**: Numbered alternatives with info popups
- **Business Markers**: Nearby restaurants, cafes, attractions
- **POI Markers**: Google Places with custom InfoWindows
- **Routes**: Visual transit routes between addresses and meeting point

**Popup Behavior:**
- ✅ Click any marker → InfoWindow opens
- ✅ Click elsewhere on map → All popups close
- ✅ No close buttons needed (map-click-to-close)
- ✅ Consistent behavior across all marker types

## 📱 Responsive Design

**Breakpoints:**
- 📱 **Mobile**: < 768px (collapsible sidebar, touch-friendly)
- 💻 **Tablet**: 768px - 1024px (optimized layout)
- 🖥️ **Desktop**: > 1024px (full sidebar visible)

## 🛠️ Development

Serve the static files with the included server (recommended via project `run_dev.py`):

```bash
source ../env/bin/activate
python ../run_dev.py
```

This starts the API at 5001 and the static server at 8082, opening your browser automatically.

**Code Quality:**
- Clean, maintainable JavaScript (75% size reduction)
- Consistent error handling
- Semantic HTML structure
- Modular CSS organization

## 🔧 Configuration

**Google Maps API Requirements:**
- Maps JavaScript API
- Places API (for POI details)
- Geometry Library (for route calculations)

**Backend Integration:**
- API calls to http://localhost:5001
- CORS enabled for development
- Graceful error handling for API failures

## 🐛 Debugging

**Browser Developer Tools:**
- Console logs for API responses and errors
- Network tab for request monitoring
- Elements tab for CSS and layout debugging

**Error Handling:**
- API connection status indicator
- User-friendly error messages
- Fallback behavior for API failures
