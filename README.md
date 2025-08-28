# Meet in the Middle

A Flask web application that finds the optimal meeting point between two addresses based on public transport travel time, with business discovery and filtering capabilities.

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
│   ├── app.py            # Main Flask application
│   ├── maps_service.py   # Google Maps API integration
│   ├── serve_map.py      # Static file server
│   └── tests/
│       ├── test_api.py   # API unit tests
│       └── demo.py       # Demo/example scripts
├── env/                  # Python virtual environment
├── main.py              # Alternative entry point
├── run_dev.py           # Development server script
├── requirements.txt     # Python dependencies
├── .env                 # Environment variables (API keys)
└── README.md           # This file
```

## 🚀 Features

- **🎯 Optimal Meeting Point**: Finds the best location based on equal transit times
- **🚇 Public Transport**: Uses real-time Google Maps transit directions
- **🗺️ Interactive Maps**: Visual representation with custom markers and info windows
- **⭕ Walking Distance Rings**: Shows 5, 10, and 15-minute walking areas
- **🏢 Business Discovery**: Displays nearby restaurants, cafes, parks, and more
- **🔍 Smart Filtering**: Filter businesses by category with real-time updates
- **📱 Responsive Design**: Works on desktop and mobile devices

## 🛠️ Setup and Installation

### Prerequisites
- Python 3.8+
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
- **API Server**: http://localhost:5000
- **Web Interface**: http://localhost:8080

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

**Run demo script:**
```bash
source env/bin/activate
python -m server.tests.demo
```

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

- `GET /` - Health check and available endpoints
- `POST /api/find-middle-point` - Find optimal meeting point
- `POST /api/geocode` - Geocode an address
- `POST /api/transit-time` - Get transit time between points

## 🎨 Architecture

### Backend (Flask)
- **Separation of Concerns**: Clean separation between API logic and map services
- **Modular Design**: Google Maps integration in dedicated service class
- **Error Handling**: Comprehensive error handling and validation
- **Testing**: Unit tests for API endpoints

### Frontend (Vanilla JavaScript)
- **Modern ES6+**: Uses modern JavaScript features
- **Modular CSS**: Organized stylesheets with responsive design
- **Interactive Maps**: Google Maps integration with custom markers and info windows
- **Real-time Filtering**: Dynamic business filtering without page reload

## 🌍 Environment Variables

Create a `.env` file with:
```
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

## 📝 Notes

- The application uses walking distance estimates (80m/minute average)
- Transit times are calculated using Google Maps real-time data
- Business search radius is set to 2km around the optimal meeting point
- The interface automatically updates when filters are changed

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.
