import googlemaps
import os
from typing import Dict, List, Tuple, Optional
from geopy.geocoders import Nominatim
from geopy.distance import geodesic
import math
import asyncio
import concurrent.futures
from functools import partial


class GoogleMapsService:
    """Service for interacting with Google Maps APIs"""
    
    def __init__(self, api_key: str):
        if not api_key or api_key == "your_api_key_here":
            raise ValueError("Valid Google Maps API key is required")
        self.client = googlemaps.Client(key=api_key)
        self.geocoder = Nominatim(user_agent="meet-in-the-middle")
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=10)
    
    def cleanup(self):
        """Clean up resources"""
        if hasattr(self, 'executor'):
            self.executor.shutdown(wait=True)
    
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
        Get places categorized by type (optimized with parallel execution)
        """
        if categories is None:
            categories = ['restaurant', 'cafe', 'bar', 'shopping_mall', 'park', 'tourist_attraction']
        
        # Use asyncio to run category searches in parallel
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self._get_places_by_category_parallel(location, radius, categories))
        finally:
            loop.close()
    
    async def _get_places_by_category_parallel(self, location: Dict, radius: int, categories: List[str]) -> Dict[str, List[Dict]]:
        """Internal method to run category searches in parallel"""
        tasks = [
            self.find_places_nearby_async(location, radius, category)
            for category in categories
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        categorized_places = {}
        for i, category in enumerate(categories):
            if i < len(results) and not isinstance(results[i], Exception):
                categorized_places[category] = results[i]
            else:
                categorized_places[category] = []
        
        return categorized_places

    # Async wrapper methods for parallel execution
    async def geocode_address_async(self, address: str) -> Optional[Dict]:
        """Async wrapper for geocode_address"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, self.geocode_address, address)
    
    async def get_transit_time_async(self, origin: Dict, destination: Dict, departure_time=None) -> Optional[int]:
        """Async wrapper for get_transit_time"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, self.get_transit_time, origin, destination, departure_time)
    
    async def find_places_nearby_async(self, location: Dict, radius: int = 1000, place_type: str = "point_of_interest") -> List[Dict]:
        """Async wrapper for find_places_nearby"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, self.find_places_nearby, location, radius, place_type)
    
    async def get_places_by_category_async(self, location: Dict, radius: int = 1000, categories: List[str] = None) -> Dict[str, List[Dict]]:
        """Async wrapper for get_places_by_category"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, self.get_places_by_category, location, radius, categories)


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
        Uses async parallel execution for better performance
        """
        # Run the async version and return the result
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self.find_optimal_meeting_point_async(address1, address2, search_radius))
        finally:
            loop.close()
    
    async def find_optimal_meeting_point_async(self, address1: str, address2: str, search_radius: int = 2000) -> Dict:
        """
        Async version of find_optimal_meeting_point with parallel API calls
        """
        result = {
            'success': False,
            'error': None,
            'data': {}
        }
        
        try:
            # Geocode both addresses in parallel
            geocode_tasks = [
                self.maps_service.geocode_address_async(address1),
                self.maps_service.geocode_address_async(address2)
            ]
            location1, location2 = await asyncio.gather(*geocode_tasks)
            
            if not location1:
                result['error'] = f"Could not geocode address: {address1}"
                return result
            
            if not location2:
                result['error'] = f"Could not geocode address: {address2}"
                return result
            
            # Calculate geographic midpoint as starting point
            geographic_midpoint = self.calculate_geographic_midpoint(location1, location2)
            
            # Run multiple API calls in parallel
            parallel_tasks = [
                # Transit times to midpoint
                self.maps_service.get_transit_time_async(location1, geographic_midpoint),
                self.maps_service.get_transit_time_async(location2, geographic_midpoint),
                # Places search
                self.maps_service.find_places_nearby_async(
                    geographic_midpoint, 
                    radius=search_radius,
                    place_type="establishment"
                ),
                # Categorized businesses search
                self.maps_service.get_places_by_category_async(
                    geographic_midpoint,
                    radius=search_radius,
                    categories=['restaurant', 'cafe', 'bar', 'shopping_mall', 'store', 'park', 'tourist_attraction', 'gym', 'library']
                )
            ]
            
            time1_to_mid, time2_to_mid, nearby_places, categorized_businesses = await asyncio.gather(*parallel_tasks)
            
            # Evaluate each nearby place - this is where we can make the biggest optimization
            # by running transit time calculations in parallel
            best_meeting_point = None
            best_score = float('inf')
            
            if nearby_places:
                # Create tasks for all transit time calculations at once
                transit_tasks = []
                for place in nearby_places:
                    transit_tasks.extend([
                        self.maps_service.get_transit_time_async(location1, place),
                        self.maps_service.get_transit_time_async(location2, place)
                    ])
                
                # Run all transit time calculations in parallel
                transit_results = await asyncio.gather(*transit_tasks, return_exceptions=True)
                
                # Process results in pairs (time1_to_place, time2_to_place)
                for i, place in enumerate(nearby_places):
                    time1_to_place = transit_results[i * 2] if i * 2 < len(transit_results) and not isinstance(transit_results[i * 2], Exception) else None
                    time2_to_place = transit_results[i * 2 + 1] if i * 2 + 1 < len(transit_results) and not isinstance(transit_results[i * 2 + 1], Exception) else None
                    
                    if time1_to_place and time2_to_place:
                        # Calculate time difference (fairness factor)
                        time_difference = abs(time1_to_place - time2_to_place)
                        
                        # Calculate total travel time (efficiency factor)
                        total_time = time1_to_place + time2_to_place
                        
                        # Calculate composite score: minimize both total time and time difference
                        # Weight the fairness (equal travel times) more heavily
                        fairness_weight = 0.7  # How much we care about equal travel times
                        efficiency_weight = 0.3  # How much we care about minimizing total time
                        
                        # Normalize scores (divide by 3600 to convert seconds to hours for scoring)
                        fairness_score = time_difference / 3600  # Lower is better
                        efficiency_score = total_time / 3600     # Lower is better
                        
                        composite_score = (fairness_weight * fairness_score) + (efficiency_weight * efficiency_score)
                        
                        if composite_score < best_score:
                            best_score = composite_score
                            best_meeting_point = {
                                **place,
                                'time_from_address1': time1_to_place,
                                'time_from_address2': time2_to_place,
                                'time_difference_seconds': time_difference,
                                'time_difference_minutes': round(time_difference / 60, 1),
                                'total_travel_time_seconds': total_time,
                                'total_travel_time_minutes': round(total_time / 60, 1),
                                'composite_score': composite_score,
                                'fairness_score': fairness_score,
                                'efficiency_score': efficiency_score
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
                'nearby_alternatives': nearby_places[:5] if nearby_places else [],  # Return top 5 alternatives
                'categorized_businesses': categorized_businesses or {}
            }
            
        except Exception as e:
            result['error'] = f"Unexpected error: {str(e)}"
        
        return result
