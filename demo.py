#!/usr/bin/env python3
"""
Simple demo script for the Meet in the Middle API
Run this after you've configured your Google Maps API key
"""

import requests
import json


def demo_with_sample_addresses():
    """Demo with some sample addresses - modify these for your local area"""
    
    print("🗺️  Meet in the Middle API Demo")
    print("=" * 40)
    
    # Sample addresses - change these to your local area for better testing
    address1 = "Times Square, New York, NY"
    address2 = "Central Park, New York, NY" 
    
    print(f"Finding meeting point between:")
    print(f"📍 Address 1: {address1}")
    print(f"📍 Address 2: {address2}")
    print()
    
    # Make API request
    try:
        response = requests.post(
            "http://localhost:5000/api/find-middle-point",
            json={
                "address1": address1,
                "address2": address2,
                "search_radius": 1500
            },
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()['data']
            
            print("✅ Success! Found optimal meeting point:")
            print("-" * 40)
            
            # Display results
            optimal = data.get('optimal_meeting_point')
            if optimal:
                print(f"🎯 Meeting Place: {optimal['name']}")
                print(f"📍 Address: {optimal['formatted_address']}")
                print(f"⭐ Rating: {optimal.get('rating', 'N/A')}")
                print()
                print("🚇 Travel Times:")
                print(f"   From {address1}: {optimal['time_from_address1'] // 60} minutes")
                print(f"   From {address2}: {optimal['time_from_address2'] // 60} minutes")
                print(f"   Time difference: {optimal['time_difference_minutes']} minutes")
                print()
                
                # Show alternatives
                alternatives = data.get('nearby_alternatives', [])
                if alternatives:
                    print("🔄 Alternative meeting spots nearby:")
                    for i, alt in enumerate(alternatives[:3], 1):
                        print(f"   {i}. {alt['name']} - {alt.get('formatted_address', 'N/A')}")
            else:
                print("❌ No optimal meeting point found")
                print("This might happen if there are no transit routes or nearby venues")
                
        else:
            error_data = response.json()
            print(f"❌ Error ({response.status_code}): {error_data.get('error', 'Unknown error')}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to API. Make sure the server is running:")
        print("   python app.py")
    except requests.exceptions.Timeout:
        print("❌ Request timed out. Google Maps API might be slow.")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")


def interactive_demo():
    """Interactive demo where user enters their own addresses"""
    
    print("\n🎯 Interactive Mode")
    print("=" * 40)
    
    try:
        address1 = input("Enter first address: ").strip()
        address2 = input("Enter second address: ").strip()
        
        if not address1 or not address2:
            print("❌ Both addresses are required!")
            return
            
        radius = input("Search radius in meters (default 2000): ").strip()
        radius = int(radius) if radius.isdigit() else 2000
        
        print(f"\n🔍 Searching for meeting point...")
        print(f"📍 From: {address1}")
        print(f"📍 To: {address2}")
        print(f"🔄 Radius: {radius}m")
        
        response = requests.post(
            "http://localhost:5000/api/find-middle-point",
            json={
                "address1": address1,
                "address2": address2,
                "search_radius": radius
            },
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()['data']
            optimal = data.get('optimal_meeting_point')
            
            if optimal:
                print(f"\n✅ Best meeting spot: {optimal['name']}")
                print(f"📍 {optimal['formatted_address']}")
                print(f"🚇 Travel times: {optimal['time_from_address1']//60}min / {optimal['time_from_address2']//60}min")
            else:
                print("\n❌ No good meeting point found. Try a larger search radius or different addresses.")
        else:
            error = response.json().get('error', 'Unknown error')
            print(f"\n❌ Error: {error}")
            
    except KeyboardInterrupt:
        print("\n👋 Demo cancelled!")
    except Exception as e:
        print(f"\n❌ Error: {e}")


def main():
    print("Meet in the Middle API Demo")
    print("Make sure the API server is running (python app.py)")
    print()
    
    # Check if API is running
    try:
        response = requests.get("http://localhost:5000/", timeout=5)
        if response.status_code != 200:
            print("❌ API server not responding correctly")
            return
    except:
        print("❌ Cannot connect to API server. Start it with: python app.py")
        return
    
    print("Choose demo mode:")
    print("1. Sample addresses (quick test)")
    print("2. Enter your own addresses")
    print("3. Quit")
    
    choice = input("\nEnter choice (1-3): ").strip()
    
    if choice == "1":
        demo_with_sample_addresses()
    elif choice == "2":
        interactive_demo()
    elif choice == "3":
        print("👋 Goodbye!")
    else:
        print("❌ Invalid choice")


if __name__ == "__main__":
    main()
