#!/usr/bin/env python3
"""
Quick test script to verify the application setup is working correctly
"""

import requests
import time
import sys

def test_api_server():
    """Test if the API server is responding"""
    try:
        response = requests.get('http://localhost:5001/', timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get('status') == 'healthy':
                print("✅ API Server is running and healthy")
                return True
            else:
                print("❌ API Server responded but status is not healthy")
                return False
        else:
            print(f"❌ API Server returned status code: {response.status_code}")
            return False
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to API server (http://localhost:5001)")
        return False
    except Exception as e:
        print(f"❌ Error testing API server: {e}")
        return False

def test_static_server():
    """Test if the static file server is responding"""
    try:
        response = requests.get('http://localhost:8082/', timeout=5)
        if response.status_code == 200:
            # Check if it's serving HTML content
            if 'html' in response.headers.get('content-type', '').lower():
                print("✅ Static file server is running and serving content")
                return True
            else:
                print("❌ Static file server is not serving HTML content")
                return False
        else:
            print(f"❌ Static file server returned status code: {response.status_code}")
            return False
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to static file server (http://localhost:8082)")
        return False
    except Exception as e:
        print(f"❌ Error testing static file server: {e}")
        return False

def test_geocoding():
    """Test the geocoding API endpoint"""
    try:
        payload = {"address": "Times Square, New York, NY"}
        response = requests.post('http://localhost:5001/api/geocode', 
                               json=payload, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                print("✅ Geocoding API is working")
                return True
            else:
                print(f"❌ Geocoding failed: {data.get('error', 'Unknown error')}")
                return False
        else:
            print(f"❌ Geocoding API returned status code: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Error testing geocoding API: {e}")
        return False

def main():
    print("🧪 Testing Meet in the Middle Application Setup")
    print("="*50)
    
    tests = [
        ("API Server Health", test_api_server),
        ("Static File Server", test_static_server),
        ("Geocoding API", test_geocoding)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n🔍 Testing {test_name}...")
        if test_func():
            passed += 1
        time.sleep(1)  # Brief pause between tests
    
    print("\n" + "="*50)
    print(f"📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Your application is ready to use.")
        print("🌐 Open http://localhost:8082 in your browser to access the app")
        return True
    else:
        print("⚠️  Some tests failed. Please check the server setup.")
        return False

if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
