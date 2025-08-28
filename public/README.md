# Frontend - Public Directory

This directory contains all frontend assets for the "Meet in the Middle" web application.

## 📁 Structure

```
public/
├── 🏠 index.html           # Main application interface
├── 🎨 styles/
│   └── main.css           # Application styles and responsive design
├── ⚡ scripts/
│   └── main.js            # Frontend JavaScript logic
├── 🧪 test_map.html       # Testing interface for maps
├── 🐛 debug_map.html      # Debugging interface
└── 🌐 web_interface.html  # Alternative web interface
```

## 🌐 Pages

### `index.html` - Main Application
- **Purpose**: Primary user interface for finding meeting points
- **Features**: Address input, map display, business filtering
- **URL**: http://localhost:8082/

### `web_interface.html` - Alternative Interface  
- **Purpose**: Alternative UI layout
- **URL**: http://localhost:8082/web_interface.html

### `test_map.html` - Testing Interface
- **Purpose**: Map functionality testing and debugging
- **URL**: http://localhost:8082/test_map.html

### `debug_map.html` - Debug Interface
- **Purpose**: Advanced debugging and development
- **URL**: http://localhost:8082/debug_map.html

## 🎨 Styles (`styles/main.css`)

**Key Features:**
- 📱 **Responsive Design**: Mobile-first approach
- 🎨 **Modern UI**: Clean, intuitive interface
- 🗺️ **Map Integration**: Optimized for Google Maps
- 🔘 **Interactive Elements**: Hover effects, transitions
- 📊 **Business Filters**: Styled category toggles

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

**Key Components:**
- 🗺️ **Map Initialization**: Google Maps setup and configuration
- 📍 **Geocoding**: Address to coordinates conversion
- 🎯 **Meeting Point Finder**: API integration for optimal locations
- 🏢 **Business Discovery**: Nearby places and filtering
- 🔄 **Real-time Updates**: Dynamic content updates

**JavaScript Architecture:**
```javascript
// Configuration and constants
const API_BASE = 'http://localhost:5001';

// Map management
function initMaps() { /* Google Maps initialization */ }

// API communication
async function findMeetingPoint() { /* API calls */ }

// Business filtering
function updateBusinessFilters() { /* Filter logic */ }

// UI updates
function displayResults() { /* DOM manipulation */ }
```

## 🔗 API Integration

The frontend communicates with the Flask API server at **http://localhost:5001**:

- **Geocoding**: Convert addresses to coordinates
- **Meeting Points**: Find optimal locations
- **Business Data**: Nearby places and amenities

## 📱 Responsive Design

**Breakpoints:**
- 📱 Mobile: < 768px
- 💻 Tablet: 768px - 1024px  
- 🖥️ Desktop: > 1024px

**Features:**
- Collapsible sidebars on mobile
- Responsive map sizing
- Touch-friendly controls
- Optimized loading for mobile networks

## 🛠️ Development

**File Serving:**
- Static files served by `server/serve_map.py`
- Available at http://localhost:8082
- Auto-reload on file changes (development mode)

**Editing Guidelines:**
- Maintain responsive design principles
- Follow existing CSS organization
- Use semantic HTML structure
- Keep JavaScript modular and documented

## 🔧 Configuration

**Google Maps API:**
- API key loaded from environment
- Maps JavaScript API required
- Places API for business discovery

**Backend Integration:**
- API calls to http://localhost:5001
- CORS enabled for cross-origin requests
- Error handling for API failures

## 🐛 Debugging

**Browser Developer Tools:**
- Console logs for API responses
- Network tab for request monitoring
- Elements tab for CSS debugging

**Debug Pages:**
- `debug_map.html` - Advanced debugging
- `test_map.html` - Feature testing
- Browser console shows detailed logs
