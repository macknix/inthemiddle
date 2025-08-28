import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()

# API base URL
BASE_URL = "http://localhost:5000"

def test_health_check():
    """Test the health check endpoint"""
    print("Testing health check...")
    try:
        response = requests.get("{}/".format(BASE_URL))
        print("Status: {}".format(response.status_code))
        print("Response: {}".format(json.dumps(response.json(), indent=2)))
        return response.status_code == 200
    except Exception as e:
        print("Error: {}".format(e))
        return False

def test_geocoding(address):
    """Test the geocoding endpoint"""
    print("\nTesting geocoding for: {}".format(address))
    try:
        payload = {"address": address}
        response = requests.post("{}/api/geocode".format(BASE_URL), json=payload)
        print("Status: {}".format(response.status_code))
        print("Response: {}".format(json.dumps(response.json(), indent=2)))
        return response.status_code == 200
    except Exception as e:
        print("Error: {}".format(e))
        return False

def test_find_middle_point(address1, address2, search_radius=2000):
    """Test the find middle point endpoint"""
    print("\nTesting middle point finder:")
    print("Address 1: {}".format(address1))
    print("Address 2: {}".format(address2))
    print("Search radius: {}m".format(search_radius))
    try:
        payload = {
            "address1": address1,
            "address2": address2,
            "search_radius": search_radius
        }
        response = requests.post("{}/api/find-middle-point".format(BASE_URL), json=payload)
        print("Status: {}".format(response.status_code))
        result = response.json()
        print("Response: {}".format(json.dumps(result, indent=2)))
        
        if response.status_code == 200 and result.get('success'):
            data = result['data']
            print("\n" + "="*50)
            print("SUMMARY:")
            print("="*50)
            print("From: {}".format(data['address1']['geocoded']['formatted_address']))
            print("To: {}".format(data['address2']['geocoded']['formatted_address']))
            
            if data.get('optimal_meeting_point'):
                mp = data['optimal_meeting_point']
                print("\nOptimal Meeting Point: {}".format(mp['name']))
                print("Address: {}".format(mp['formatted_address']))
                print("Travel time from address 1: {} minutes".format(mp['time_from_address1'] // 60))
                print("Travel time from address 2: {} minutes".format(mp['time_from_address2'] // 60))
                print("Time difference: {} minutes".format(mp['time_difference_minutes']))
            else:
                print("\nNo optimal meeting point found")
            print("="*50)
        
        return response.status_code == 200
    except Exception as e:
        print("Error: {}".format(e))
        return False

def test_transit_time():
    """Test the transit time endpoint"""
    print("\nTesting transit time calculation...")
    try:
        # Example coordinates (Times Square to Central Park)
        payload = {
            "origin": {"lat": 40.7580, "lng": -73.9855},
            "destination": {"lat": 40.7829, "lng": -73.9654}
        }
        response = requests.post("{}/api/transit-time".format(BASE_URL), json=payload)
        print("Status: {}".format(response.status_code))
        print("Response: {}".format(json.dumps(response.json(), indent=2)))
        return response.status_code == 200
    except Exception as e:
        print("Error: {}".format(e))
        return False

def main():
    """Run all tests"""
    print("Meet in the Middle API Test Suite")
    print("=" * 40)
    
    # Check if server is running
    print("Checking if server is running...")
    if not test_health_check():
        print("\nServer is not running. Please start it with: python app.py")
        return
    
    # Check if API key is configured
    if not os.getenv('GOOGLE_MAPS_API_KEY'):
        print("\nWarning: GOOGLE_MAPS_API_KEY not found in .env file")
        print("Some tests may fail without a valid API key")
    
    # Test geocoding
    test_geocoding("Times Square, New York, NY")
    
    # Test transit time
    test_transit_time()
    
    # Test middle point finder with sample addresses
    # You can modify these addresses for your local testing
    test_find_middle_point(
        "Times Square, New York, NY",
        "Brooklyn Bridge, New York, NY",
        2000
    )
    
    print("\n" + "="*40)
    print("Test suite completed!")
    print("="*40)

if __name__ == "__main__":
    main()
