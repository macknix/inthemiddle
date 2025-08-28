from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os
try:
    from .maps_service import GoogleMapsService, MiddlePointFinder
except ImportError:
    from maps_service import GoogleMapsService, MiddlePointFinder

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Initialize services
api_key = os.getenv('GOOGLE_MAPS_API_KEY')
if not api_key or api_key == "your_api_key_here":
    print("Warning: GOOGLE_MAPS_API_KEY not found or not configured in environment variables")
    maps_service = None
    middle_point_finder = None
else:
    try:
        maps_service = GoogleMapsService(api_key)
        middle_point_finder = MiddlePointFinder(maps_service)
    except ValueError as e:
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
    if not maps_service:
        return jsonify({'error': 'Google Maps API key not configured'}), 500
    
    try:
        data = request.get_json()
        if not data or 'address' not in data:
            return jsonify({'error': 'Address is required'}), 400
        
        address = data['address']
        result = maps_service.geocode_address(address)
        
        if result:
            return jsonify({
                'success': True,
                'data': result
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Could not geocode the provided address'
            }), 404
            
    except Exception as e:
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
    if not middle_point_finder:
        return jsonify({'error': 'Google Maps API key not configured'}), 500
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON data is required'}), 400
        
        address1 = data.get('address1')
        address2 = data.get('address2')
        search_radius = data.get('search_radius', 2000)
        
        if not address1 or not address2:
            return jsonify({'error': 'Both address1 and address2 are required'}), 400
        
        # Validate search radius
        if not isinstance(search_radius, int) or search_radius < 100 or search_radius > 10000:
            return jsonify({'error': 'search_radius must be between 100 and 10000 meters'}), 400
        
        result = middle_point_finder.find_optimal_meeting_point(
            address1, 
            address2, 
            search_radius
        )
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
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
