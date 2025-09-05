from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os
import logging
import json
try:
    from .maps_service import GoogleMapsService, MiddlePointFinder, MiddlePointFinderTwo
except ImportError:
    from maps_service import GoogleMapsService, MiddlePointFinder, MiddlePointFinderTwo

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Initialize services
api_key = os.getenv('GOOGLE_MAPS_API_KEY')
logger.info(f"API Key found: {'Yes' if api_key and api_key != 'your_api_key_here' else 'No'}")

if not api_key or api_key == "your_api_key_here":
    logger.warning("GOOGLE_MAPS_API_KEY not found or not configured in environment variables")
    print("Warning: GOOGLE_MAPS_API_KEY not found or not configured in environment variables")
    maps_service = None
    middle_point_finder = None
else:
    try:
        logger.info("Initializing Google Maps service...")
        maps_service = GoogleMapsService(api_key)
        # Choose algorithm via env var (default -> original, route-midpoint -> MiddlePointFinderTwo)
        algo_env = os.getenv('MIDDLEPOINT_ALGORITHM', 'default').lower()
        if algo_env == 'route-midpoint':
            middle_point_finder = MiddlePointFinderTwo(maps_service)
            logger.info("Using MiddlePointFinderTwo (route-midpoint algorithm) from env setting")
        else:
            middle_point_finder = MiddlePointFinder(maps_service)
            logger.info("Using MiddlePointFinder (default algorithm) from env setting")
        logger.info("Google Maps service initialized successfully")
    except ValueError as e:
        logger.error(f"Error initializing Google Maps service: {e}")
        print(f"Error initializing Google Maps service: {e}")
        maps_service = None
        middle_point_finder = None


@app.route('/', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'message': 'Meet in the Middle API is running!',
        'endpoints': {
            'find_middle_point': '/api/find-middle-point',
            'geocode': '/api/geocode',
            'config': '/api/config',
            'health': '/'
        },
        'status': 'healthy'
    })


@app.route('/api/geocode', methods=['POST'])
def geocode_address():
    """
    Geocode a single address
    Expected JSON: {"address": "123 Main St, City, State"}
    """
    logger.info("=== GEOCODE REQUEST ===")
    
    if not maps_service:
        logger.error("Google Maps API key not configured - cannot geocode")
        return jsonify({'error': 'Google Maps API key not configured'}), 500
    
    try:
        data = request.get_json()
        logger.info(f"Geocode request data: {json.dumps(data, indent=2) if data else 'None'}")
        
        if not data or 'address' not in data:
            logger.error("Address not provided in request")
            return jsonify({'error': 'Address is required'}), 400
        
        address = data['address']
        logger.info(f"Attempting to geocode address: '{address}'")
        
        result = maps_service.geocode_address(address)
        logger.info(f"Geocoding result: {result}")
        
        if result:
            logger.info(f"Geocoding successful - lat: {result.get('lat')}, lng: {result.get('lng')}")
            return jsonify({
                'success': True,
                'data': result
            })
        else:
            logger.warning(f"Failed to geocode address: '{address}'")
            return jsonify({
                'success': False,
                'error': 'Could not geocode the provided address'
            }), 404
            
    except Exception as e:
        logger.error(f"Exception in geocode_address: {str(e)}", exc_info=True)
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/api/find-middle-point', methods=['POST'])
def find_middle_point():
    """
    Find the optimal middle point between two addresses
    Expected JSON: {
        "address1": "123 Main St, City, State",
        "address2": "456 Oak Ave, City, State",
        "search_radius": 2000  // optional, defaults to 2000 meters
    }
    """
    logger.info("=== FIND MIDDLE POINT REQUEST ===")
    
    if not middle_point_finder:
        logger.error("Google Maps API key not configured - cannot process request")
        return jsonify({'error': 'Google Maps API key not configured'}), 500
    
    try:
        data = request.get_json()
        logger.info(f"Request data received: {json.dumps(data, indent=2) if data else 'None'}")
        
        if not data:
            logger.error("No JSON data provided in request")
            return jsonify({'error': 'JSON data is required'}), 400
        
        address1 = data.get('address1')
        address2 = data.get('address2')
        search_radius = data.get('search_radius', 2000)
        
        logger.info(f"Parsed inputs:")
        logger.info(f"  - Address 1: {address1}")
        logger.info(f"  - Address 2: {address2}")
        logger.info(f"  - Search Radius: {search_radius}")
        
        if not address1 or not address2:
            logger.error("Missing required addresses")
            return jsonify({'error': 'Both address1 and address2 are required'}), 400
        
        # Validate search radius
        if not isinstance(search_radius, int) or search_radius < 100 or search_radius > 10000:
            logger.error(f"Invalid search radius: {search_radius}")
            return jsonify({'error': 'search_radius must be between 100 and 10000 meters'}), 400
        
        logger.info("Starting middle point calculation...")
        # Optional per-request override of algorithm
        algorithm = data.get('algorithm', None)
        finder = middle_point_finder
        if maps_service and algorithm:
            algo = str(algorithm).lower()
            if algo == 'route-midpoint':
                finder = MiddlePointFinderTwo(maps_service)
                logger.info("Per-request algorithm override: route-midpoint")
            elif algo == 'default':
                finder = MiddlePointFinder(maps_service)
                logger.info("Per-request algorithm override: default")

        result = finder.find_optimal_meeting_point(
            address1, 
            address2, 
            search_radius
        )
        logger.info(f"Middle point calculation completed")
        logger.info(f"Result success: {result.get('success', False)}")
        
        if result.get('success'):
            logger.info(f"Successful result keys: {list(result.keys())}")
            if 'data' in result and 'meeting_point' in result['data']:
                meeting_point = result['data']['meeting_point']
                logger.info(f"Meeting point coordinates: lat={meeting_point.get('lat')}, lng={meeting_point.get('lng')}")
        else:
            logger.error(f"Algorithm failed: {result.get('error', 'Unknown error')}")
        
        logger.info("=== END FIND MIDDLE POINT REQUEST ===")
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Exception in find_middle_point: {str(e)}", exc_info=True)
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/api/transit-time', methods=['POST'])
def get_transit_time():
    """
    Get transit time between two points
    Expected JSON: {
        "origin": {"lat": 40.7128, "lng": -74.0060},
        "destination": {"lat": 40.7589, "lng": -73.9851}
    }
    """
    if not maps_service:
        return jsonify({'error': 'Google Maps API key not configured'}), 500
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON data is required'}), 400
        
        origin = data.get('origin')
        destination = data.get('destination')
        
        if not origin or not destination:
            return jsonify({'error': 'Both origin and destination are required'}), 400
        
        # Validate coordinates
        for point_name, point in [('origin', origin), ('destination', destination)]:
            if not isinstance(point, dict) or 'lat' not in point or 'lng' not in point:
                return jsonify({'error': f'{point_name} must have lat and lng properties'}), 400
        
        transit_time = maps_service.get_transit_time(origin, destination)
        
        if transit_time:
            return jsonify({
                'success': True,
                'data': {
                    'transit_time_seconds': transit_time,
                    'transit_time_minutes': round(transit_time / 60, 1)
                }
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Could not calculate transit time between the provided points'
            }), 404
            
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/api/config', methods=['GET'])
def get_config():
    """
    Get frontend configuration including Google Maps API key
    """
    return jsonify({
        'success': True,
        'data': {
            'googleMapsApiKey': api_key if api_key and api_key != "your_api_key_here" else None,
            'apiBaseUrl': request.host_url.rstrip('/')
        }
    })


@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    if not api_key or api_key == "your_api_key_here":
        print("\n" + "="*50)
        print("SETUP REQUIRED:")
        print("="*50)
        print("1. Get a Google Maps API key from: https://console.cloud.google.com/")
        print("2. Enable the following APIs:")
        print("   - Geocoding API")
        print("   - Directions API") 
        print("   - Places API")
        print("3. Edit the .env file and replace 'your_api_key_here' with your actual API key")
        print("4. Restart the app")
        print("="*50)
        print("API will start but most features will be disabled without a valid key\n")
    else:
        print("Starting Meet in the Middle API...")
        print(f"API Key configured: {api_key[:10]}...")
        
    app.run(host='0.0.0.0', port=5000, debug=True)
