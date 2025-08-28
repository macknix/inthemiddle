import googlemaps
import os
from typing import Dict, List, Tuple, Optional
from geopy.geocoders import Nominatim
from geopy.distance import geodesic
import math


class GoogleMapsService:
    """Service for interacting with Google Maps APIs"""
    
    def __init__(self, api_key: str):
        if not api_key or api_key == "your_api_key_here":
            raise ValueError("Valid Google Maps API key is required")
        self.client = googlemaps.Client(key=api_key)
        self.geocoder = Nominatim(user_agent="meet-in-the-middle")
    
    def geocode_address(self, address: str) -> Optional[Dict]:
        """
        Geocode an address using Google Maps Geocoding API
        Returns formatted address and coordinates
        """
        try:
            result = self.client.geocode(address)
            if result:
                location = result[0]
                return {
                    'formatted_address': location['formatted_address'],
                    'lat': location['geometry']['location']['lat'],
                    'lng': location['geometry']['location']['lng']
                }
            return None
        except Exception as e:
            print(f"Geocoding error: {e}")
            return None
    
    def get_transit_time(self, origin: Dict, destination: Dict, departure_time=None) -> Optional[int]:
        """
        Get transit time between two points using Google Maps Directions API
        Returns time in seconds
        """
        try:
            origin_coords = f"{origin['lat']},{origin['lng']}"
            dest_coords = f"{destination['lat']},{destination['lng']}"
            
            directions_result = self.client.directions(
                origin=origin_coords,
                destination=dest_coords,
                mode="transit",
                departure_time=departure_time,
                alternatives=False
            )
            
            if directions_result:
                route = directions_result[0]
                duration = route['legs'][0]['duration']['value']
                return duration
            return None
        except Exception as e:
            print(f"Transit time error: {e}")
            return None
    
    def find_places_nearby(self, location: Dict, radius: int = 1000, place_type: str = "point_of_interest") -> List[Dict]:
        """
        Find places nearby a given location
        """
        try:
            places_result = self.client.places_nearby(
                location=(location['lat'], location['lng']),
                radius=radius,
                type=place_type
            )
            
            places = []
            for place in places_result.get('results', [])[:20]:  # Increased to 20 results
                # Get more detailed place information
                place_details = {
                    'name': place['name'],
                    'formatted_address': place.get('vicinity', ''),
                    'lat': place['geometry']['location']['lat'],
                    'lng': place['geometry']['location']['lng'],
                    'rating': place.get('rating'),
                    'types': place.get('types', []),
                    'price_level': place.get('price_level'),
                    'opening_hours': place.get('opening_hours', {}).get('open_now'),
                    'place_id': place.get('place_id'),
                    'photos': []
                }
                
                # Add photo reference if available
                if 'photos' in place and len(place['photos']) > 0:
                    place_details['photos'] = [photo.get('photo_reference') for photo in place['photos'][:1]]
                
                places.append(place_details)
            
            return places
        except Exception as e:
            print(f"Places search error: {e}")
            return []

    def get_places_by_category(self, location: Dict, radius: int = 1000, categories: List[str] = None) -> Dict[str, List[Dict]]:
        """
        Get places categorized by type
        """
        if categories is None:
            categories = ['restaurant', 'cafe', 'bar', 'shopping_mall', 'park', 'tourist_attraction']
        
        categorized_places = {}
        
        for category in categories:
            places = self.find_places_nearby(location, radius, category)
            categorized_places[category] = places
        
        return categorized_places


class MiddlePointFinder:
    """Main service for finding middle points by transit time"""
    
    def __init__(self, maps_service: GoogleMapsService):
        self.maps_service = maps_service
    
    def calculate_geographic_midpoint(self, point1: Dict, point2: Dict) -> Dict:
        """Calculate the geographic midpoint between two coordinates"""
        lat1, lng1 = math.radians(point1['lat']), math.radians(point1['lng'])
        lat2, lng2 = math.radians(point2['lat']), math.radians(point2['lng'])
        
        # Calculate midpoint
        mid_lat = (lat1 + lat2) / 2
        mid_lng = (lng1 + lng2) / 2
        
        return {
            'lat': math.degrees(mid_lat),
            'lng': math.degrees(mid_lng)
        }
    
    def find_optimal_meeting_point(self, address1: str, address2: str, search_radius: int = 2000) -> Dict:
        """
        Find the optimal meeting point by transit time between two addresses
        """
        result = {
            'success': False,
            'error': None,
            'data': {}
        }
        
        try:
            # Geocode both addresses
            location1 = self.maps_service.geocode_address(address1)
            location2 = self.maps_service.geocode_address(address2)
            
            if not location1:
                result['error'] = f"Could not geocode address: {address1}"
                return result
            
            if not location2:
                result['error'] = f"Could not geocode address: {address2}"
                return result
            
            # Calculate geographic midpoint as starting point
            geographic_midpoint = self.calculate_geographic_midpoint(location1, location2)
            
            # Get transit times from both locations to geographic midpoint
            time1_to_mid = self.maps_service.get_transit_time(location1, geographic_midpoint)
            time2_to_mid = self.maps_service.get_transit_time(location2, geographic_midpoint)
            
            # Find nearby places around the geographic midpoint
            nearby_places = self.maps_service.find_places_nearby(
                geographic_midpoint, 
                radius=search_radius,
                place_type="establishment"
            )
            
            # Get categorized businesses within walking distance
            categorized_businesses = self.maps_service.get_places_by_category(
                geographic_midpoint,
                radius=search_radius,
                categories=['restaurant', 'cafe', 'bar', 'shopping_mall', 'store', 'park', 'tourist_attraction', 'gym', 'library']
            )
            
            # Evaluate each nearby place
            best_meeting_point = None
            best_time_difference = float('inf')
            
            for place in nearby_places:
                time1_to_place = self.maps_service.get_transit_time(location1, place)
                time2_to_place = self.maps_service.get_transit_time(location2, place)
                
                if time1_to_place and time2_to_place:
                    time_difference = abs(time1_to_place - time2_to_place)
                    if time_difference < best_time_difference:
                        best_time_difference = time_difference
                        best_meeting_point = {
                            **place,
                            'time_from_address1': time1_to_place,
                            'time_from_address2': time2_to_place,
                            'time_difference_seconds': time_difference,
                            'time_difference_minutes': round(time_difference / 60, 1)
                        }
            
            # Prepare result
            result['success'] = True
            result['data'] = {
                'address1': {
                    'input': address1,
                    'geocoded': location1
                },
                'address2': {
                    'input': address2,
                    'geocoded': location2
                },
                'geographic_midpoint': geographic_midpoint,
                'geographic_midpoint_transit_times': {
                    'from_address1_seconds': time1_to_mid,
                    'from_address2_seconds': time2_to_mid,
                    'from_address1_minutes': round(time1_to_mid / 60, 1) if time1_to_mid else None,
                    'from_address2_minutes': round(time2_to_mid / 60, 1) if time2_to_mid else None
                },
                'optimal_meeting_point': best_meeting_point,
                'nearby_alternatives': nearby_places[:5],  # Return top 5 alternatives
                'categorized_businesses': categorized_businesses
            }
            
        except Exception as e:
            result['error'] = f"Unexpected error: {str(e)}"
        
        return result
