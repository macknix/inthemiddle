import googlemaps
from typing import Dict, List, Tuple, Optional
from geopy.distance import geodesic
import math
import datetime as _dt
import asyncio
import concurrent.futures


# --- Module-level constants ---
PLACE_FAIRNESS_WEIGHT = 0.7
PLACE_EFFICIENCY_WEIGHT = 0.3
ROUTE_CANDIDATE_FAIRNESS_WEIGHT = 0.6
ROUTE_CANDIDATE_EFFICIENCY_WEIGHT = 0.4
LONG_ROUTE_THRESHOLD_M = 15000  # 15 km
DISTANCE_MATRIX_MAX_DEST = 25   # conservative chunk size for DM requests


class GoogleMapsService:
    """Service for interacting with Google Maps APIs"""
    
    def __init__(self, api_key: str):
        if not api_key or api_key == "your_api_key_here":
            raise ValueError("Valid Google Maps API key is required")
        self.client = googlemaps.Client(key=api_key)
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

    def get_fastest_transit_route(self, origin: Dict, destination: Dict, departure_time=None) -> Optional[Dict]:
        """
        Get the fastest transit route between two points.
        Returns a dict with route summary, decoded polyline points, distance and duration.
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

            if not directions_result:
                return None

            route = directions_result[0]
            # Distance/duration across all legs (usually 1)
            total_distance = 0
            total_duration = 0
            for leg in route.get('legs', []):
                if 'distance' in leg and 'value' in leg['distance']:
                    total_distance += leg['distance']['value']
                if 'duration' in leg and 'value' in leg['duration']:
                    total_duration += leg['duration']['value']

            overview_polyline = route.get('overview_polyline', {}).get('points')
            decoded_points = self.decode_polyline(overview_polyline) if overview_polyline else []

            return {
                'route': route,
                'overview_polyline': overview_polyline,
                'points': decoded_points,  # list of {lat, lng}
                'distance_meters': total_distance,
                'duration_seconds': total_duration
            }
        except Exception as e:
            print(f"Transit route error: {e}")
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

    def get_transit_times_matrix(self, origins: List[Dict], destinations: List[Dict], departure_time=None) -> Optional[List[List[Optional[int]]]]:
        """Batch transit durations using Distance Matrix API. Returns a rows x cols matrix
        where rows = len(origins) and cols = len(destinations). Values are seconds or None.
        Chunks destinations to respect API limits.
        """
        try:
            if not origins or not destinations:
                return None

            def fmt(pt: Dict) -> str:
                return f"{pt['lat']},{pt['lng']}"

            origin_strs = [fmt(o) for o in origins]
            # Initialize matrix with None
            rows = len(origins)
            cols = len(destinations)
            matrix: List[List[Optional[int]]] = [[None for _ in range(cols)] for _ in range(rows)]

            # Process destinations in chunks
            for start in range(0, cols, DISTANCE_MATRIX_MAX_DEST):
                end = min(start + DISTANCE_MATRIX_MAX_DEST, cols)
                dest_chunk = destinations[start:end]
                dest_strs = [fmt(d) for d in dest_chunk]
                dm = self.client.distance_matrix(
                    origins=origin_strs,
                    destinations=dest_strs,
                    mode="transit",
                    departure_time=departure_time,
                )
                if not dm or 'rows' not in dm:
                    continue
                dm_rows = dm.get('rows', [])
                for i, row in enumerate(dm_rows):
                    elements = row.get('elements', [])
                    for j, el in enumerate(elements):
                        status = el.get('status')
                        dur = el.get('duration', {}).get('value') if el else None
                        if status == 'OK' and dur is not None:
                            matrix[i][start + j] = dur
                        else:
                            # Leave as None if not OK
                            pass
            return matrix
        except Exception as e:
            print(f"Distance Matrix error: {e}")
            return None

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

    async def get_fastest_transit_route_async(self, origin: Dict, destination: Dict, departure_time=None) -> Optional[Dict]:
        """Async wrapper for get_fastest_transit_route"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, self.get_fastest_transit_route, origin, destination, departure_time)

    async def get_transit_times_matrix_async(self, origins: List[Dict], destinations: List[Dict], departure_time=None) -> Optional[List[List[Optional[int]]]]:
        """Async wrapper for get_transit_times_matrix"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, self.get_transit_times_matrix, origins, destinations, departure_time)

    # --- Helpers ---
    def decode_polyline(self, polyline_str: Optional[str]) -> List[Dict]:
        """Decode a Google Maps encoded polyline string into a list of {lat, lng} dicts."""
        if not polyline_str:
            return []

        index = 0
        lat = 0
        lng = 0
        coordinates: List[Dict] = []

        length = len(polyline_str)
        while index < length:
            # Decode latitude
            result = 0
            shift = 0
            while True:
                b = ord(polyline_str[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            dlat = ~(result >> 1) if (result & 1) else (result >> 1)
            lat += dlat

            # Decode longitude
            result = 0
            shift = 0
            while True:
                b = ord(polyline_str[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            dlng = ~(result >> 1) if (result & 1) else (result >> 1)
            lng += dlng

            coordinates.append({'lat': lat / 1e5, 'lng': lng / 1e5})

        return coordinates


# --- Shared helpers ---
async def _select_best_place(
    maps_service: GoogleMapsService,
    nearby_places: List[Dict],
    location1: Dict,
    location2: Dict,
    fairness_weight: float = PLACE_FAIRNESS_WEIGHT,
    efficiency_weight: float = PLACE_EFFICIENCY_WEIGHT,
) -> Optional[Dict]:
    """Given a list of places, compute transit times from both locations and select
    the best by composite score (fairness + efficiency). Returns the enriched best place or None.
    """
    if not nearby_places:
        return None

    # Use Distance Matrix to batch durations: 2 origins x N destinations
    dm = await maps_service.get_transit_times_matrix_async(
        [location1, location2], nearby_places, departure_time=_dt.datetime.now()
    )

    best_meeting_point = None
    best_score = float('inf')

    for i, place in enumerate(nearby_places):
        t1 = dm[0][i] if dm and len(dm) > 0 and i < len(dm[0]) else None
        t2 = dm[1][i] if dm and len(dm) > 1 and i < len(dm[1]) else None

        if t1 and t2:
            time_difference = abs(t1 - t2)
            total_time = t1 + t2
            fairness_score = time_difference / 3600.0
            efficiency_score = total_time / 3600.0
            composite_score = fairness_weight * fairness_score + efficiency_weight * efficiency_score

            if composite_score < best_score:
                best_score = composite_score
                best_meeting_point = {
                    **place,
                    'time_from_address1': t1,
                    'time_from_address2': t2,
                    'time_difference_seconds': time_difference,
                    'time_difference_minutes': round(time_difference / 60, 1),
                    'total_travel_time_seconds': total_time,
                    'total_travel_time_minutes': round(total_time / 60, 1),
                    'composite_score': composite_score,
                    'fairness_score': fairness_score,
                    'efficiency_score': efficiency_score
                }

    # Fallback: if no place had valid transit times via DM, try a small subset with Directions API
    if best_meeting_point is None:
        subset = nearby_places[: min(8, len(nearby_places))]
        tasks: List[asyncio.Future] = []
        for place in subset:
            tasks.append(maps_service.get_transit_time_async(location1, place, departure_time=_dt.datetime.now()))
            tasks.append(maps_service.get_transit_time_async(location2, place, departure_time=_dt.datetime.now()))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for i, place in enumerate(subset):
            t1 = results[i * 2] if i * 2 < len(results) and not isinstance(results[i * 2], Exception) else None
            t2 = results[i * 2 + 1] if i * 2 + 1 < len(results) and not isinstance(results[i * 2 + 1], Exception) else None
            if t1 and t2:
                time_difference = abs(t1 - t2)
                total_time = t1 + t2
                fairness_score = time_difference / 3600.0
                efficiency_score = total_time / 3600.0
                composite_score = fairness_weight * fairness_score + efficiency_weight * efficiency_score
                if composite_score < best_score:
                    best_score = composite_score
                    best_meeting_point = {
                        **place,
                        'time_from_address1': t1,
                        'time_from_address2': t2,
                        'time_difference_seconds': time_difference,
                        'time_difference_minutes': round(time_difference / 60, 1),
                        'total_travel_time_seconds': total_time,
                        'total_travel_time_minutes': round(total_time / 60, 1),
                        'composite_score': composite_score,
                        'fairness_score': fairness_score,
                        'efficiency_score': efficiency_score
                    }

    return best_meeting_point


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
            
            # Evaluate places using shared helper
            best_meeting_point = await _select_best_place(
                self.maps_service,
                nearby_places,
                location1,
                location2,
                fairness_weight=PLACE_FAIRNESS_WEIGHT,
                efficiency_weight=PLACE_EFFICIENCY_WEIGHT,
            )
            
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


class MiddlePointFinderTwo:
    """Alternative service that uses the midpoint along the fastest transit route as the middle point"""

    def __init__(self, maps_service: GoogleMapsService):
        self.maps_service = maps_service
    # ----------------------- New minimax (max-travel-time) search logic -----------------------
    @staticmethod
    def _interpolate_point(p1: Dict, p2: Dict, frac: float) -> Dict:
        return {
            'lat': p1['lat'] + (p2['lat'] - p1['lat']) * frac,
            'lng': p1['lng'] + (p2['lng'] - p1['lng']) * frac,
        }

    @staticmethod
    def _cumulative_distances(points: List[Dict]) -> Tuple[List[float], float]:
        """Return cumulative distances (meters) for each vertex and total length."""
        if not points:
            return [], 0.0
        cum = [0.0]
        total = 0.0
        for i in range(len(points) - 1):
            a = (points[i]['lat'], points[i]['lng'])
            b = (points[i + 1]['lat'], points[i + 1]['lng'])
            d = geodesic(a, b).meters
            total += d
            cum.append(total)
        return cum, total

    def _point_at_fraction(self, points: List[Dict], cum: List[float], total: float, frac: float) -> Dict:
        """Return a point along the polyline at fraction of total path length (0..1)."""
        if not points:
            return {'lat': 0, 'lng': 0}
        if len(points) == 1 or total == 0:
            return points[0]
        target = frac * total
        # Binary / linear search (list small so linear is fine)
        for i in range(len(cum) - 1):
            if cum[i + 1] >= target:
                seg_len = cum[i + 1] - cum[i]
                inner = 0.0 if seg_len == 0 else (target - cum[i]) / seg_len
                return self._interpolate_point(points[i], points[i + 1], inner)
        return points[-1]

    # --------------- Route + perpendicular sampling ---------------
    def _bearing(self, p1: Dict, p2: Dict) -> float:
        """Approximate bearing in radians between two lat/lng points (simple equirect approximation)."""
        lat1 = math.radians(p1['lat']); lat2 = math.radians(p2['lat'])
        dlon = math.radians(p2['lng'] - p1['lng'])
        y = math.sin(dlon) * math.cos(lat2)
        x = math.cos(lat1)*math.sin(lat2) - math.sin(lat1)*math.cos(lat2)*math.cos(dlon)
        return math.atan2(y, x)

    def _offset_point(self, p: Dict, bearing_rad: float, distance_m: float) -> Dict:
        """Offset point by distance_m perpendicular to bearing (bearing + 90 deg) using simple planar approximation for small distances."""
        # Earth's radius ~6378137 m
        R = 6378137.0
        lat = math.radians(p['lat'])
        lng = math.radians(p['lng'])
        # Perpendicular bearing
        perp = bearing_rad + math.pi / 2.0
        dlat = (distance_m * math.cos(perp)) / R
        dlng = (distance_m * math.sin(perp)) / (R * math.cos(lat))
        return {
            'lat': math.degrees(lat + dlat),
            'lng': math.degrees(lng + dlng)
        }

    def _sample_route_with_perpendicular(
        self,
        points: List[Dict],
        fractions: int = 25,
        lateral_offsets_m: List[float] = None,
    ) -> List[Dict]:
        """Sample points along route (fractions equally spaced) and perpendicular offsets at each sample.
        Returns list of candidate points (dicts)."""
        if not points:
            return []
        if lateral_offsets_m is None:
            lateral_offsets_m = [-800, -400, -200, 0, 200, 400, 800]
        cum, total = self._cumulative_distances(points)
        if total == 0:
            return [points[0]]
        fracs = [i/(fractions-1) for i in range(fractions)] if fractions > 1 else [0.5]
        candidates: List[Dict] = []
        for f in fracs:
            base_pt = self._point_at_fraction(points, cum, total, f)
            # Find a small segment around fraction for bearing
            # Approx nearest segment index
            target = f * total
            seg_index = 0
            for i in range(len(cum)-1):
                if cum[i+1] >= target:
                    seg_index = i
                    break
            if seg_index >= len(points)-1:
                seg_index = len(points)-2
            bearing = self._bearing(points[seg_index], points[seg_index+1])
            for off in lateral_offsets_m:
                if off == 0:
                    candidates.append({'lat': base_pt['lat'], 'lng': base_pt['lng'], 'route_fraction': f, 'lateral_offset_m': 0})
                else:
                    cand = self._offset_point(base_pt, bearing, off)
                    cand['route_fraction'] = f
                    cand['lateral_offset_m'] = off
                    candidates.append(cand)
        # Deduplicate by rounding
        seen = set(); unique = []
        for c in candidates:
            key = (round(c['lat'], 6), round(c['lng'], 6))
            if key in seen: continue
            seen.add(key); unique.append(c)
        return unique

    async def _evaluate_minimax_candidates(
        self,
        loc1: Dict,
        loc2: Dict,
        candidates: List[Dict],
    ) -> List[Dict]:
        """Batch evaluate candidates; return list with metrics using minimax objective (minimize max travel time)."""
        if not candidates:
            return []
        dm = await self.maps_service.get_transit_times_matrix_async(
            [loc1, loc2], candidates, departure_time=_dt.datetime.now()
        )
        results: List[Dict] = []
        for idx, pt in enumerate(candidates):
            t1 = dm[0][idx] if dm and dm[0][idx] is not None else None
            t2 = dm[1][idx] if dm and dm[1][idx] is not None else None
            if t1 is None or t2 is None:
                continue
            worst = max(t1, t2)
            diff = abs(t1 - t2)
            results.append({
                'point': pt,
                'time_from_address1': t1,
                'time_from_address2': t2,
                'max_travel_time_seconds': worst,
                'max_travel_time_minutes': round(worst / 60, 1),
                'time_difference_seconds': diff,
                'time_difference_minutes': round(diff / 60, 1),
                'total_travel_time_seconds': t1 + t2,
                'total_travel_time_minutes': round((t1 + t2) / 60, 1),
            })
        return results

    async def _minimax_search_along_route(
        self,
        points: List[Dict],
        loc1: Dict,
        loc2: Dict,
        initial_samples: int = 21,
        refinement_iterations: int = 3,
        refinement_samples: int = 15,
        window_shrink: float = 0.5,
    ) -> Optional[Dict]:
        """Iterative coarse-to-fine search along route polyline minimizing max travel time.
        Returns best candidate dict with metrics or None."""
        if not points:
            return None
        cum, total = self._cumulative_distances(points)
        if total == 0:
            # Degenerate polyline
            solo = await self._evaluate_minimax_candidates(loc1, loc2, [points[0]])
            return solo[0] if solo else None

        start_frac = 0.0
        end_frac = 1.0
        best: Optional[Dict] = None

        for iteration in range(refinement_iterations + 1):  # include initial iteration
            n = initial_samples if iteration == 0 else refinement_samples
            if n <= 1:
                n = 2
            fracs = [start_frac + (end_frac - start_frac) * i / (n - 1) for i in range(n)]
            candidates = [self._point_at_fraction(points, cum, total, f) for f in fracs]
            evals = await self._evaluate_minimax_candidates(loc1, loc2, candidates)
            if not evals:
                break
            evals.sort(key=lambda x: x['max_travel_time_seconds'])
            top = evals[0]
            if (best is None) or (top['max_travel_time_seconds'] < best['max_travel_time_seconds']):
                best = top
                best['route_fraction'] = fracs[candidates.index(top['point'])]
            # Prepare next window around best fraction
            if iteration < refinement_iterations:
                best_frac = best.get('route_fraction', 0.5)
                window = (end_frac - start_frac) * window_shrink
                new_start = max(0.0, best_frac - window / 2)
                new_end = min(1.0, best_frac + window / 2)
                start_frac, end_frac = new_start, new_end
                # If window too small, stop early
                if (end_frac - start_frac) < 0.01:  # <1% of route
                    break
        return best

    # ---------------- Bayesian optimization over route fraction [0,1] -----------------
    async def _bayesian_minimax_search_along_route(
        self,
        points: List[Dict],
        loc1: Dict,
        loc2: Dict,
        init_samples: int = 8,
        iterations: int = 25,
        kernel_length_scale: float = 0.15,
        noise: float = 1e-6,
    ) -> Optional[Dict]:
        """Bayesian optimization (1D GP + Expected Improvement) to minimize max travel time along route.
        Keeps a small evaluation budget and explores full route domain.
        """
        try:
            import math as _m
            # Lazy import numpy only when used (avoid mandatory dependency if unused)
            import numpy as _np
        except Exception:
            # If numpy missing, fallback to deterministic search
            return await self._minimax_search_along_route(points, loc1, loc2)

        if not points:
            return None
        cum, total = self._cumulative_distances(points)
        if total == 0:
            solo = await self._evaluate_minimax_candidates(loc1, loc2, [points[0]])
            return solo[0] if solo else None

        # Store evaluated fractions and objective values (seconds)
        fracs: List[float] = []
        vals: List[float] = []
        details: List[Dict] = []

        # Seed with evenly spaced samples
        init_samples = max(4, init_samples)
        seed_fracs = [i/(init_samples-1) for i in range(init_samples)]
        seed_points = [self._point_at_fraction(points, cum, total, f) for f in seed_fracs]
        seed_evals = await self._evaluate_minimax_candidates(loc1, loc2, seed_points)
        for i, ev in enumerate(seed_evals):
            fracs.append(seed_fracs[i])
            vals.append(ev['max_travel_time_seconds'])
            details.append(ev)

        def rbf_kernel(a: _np.ndarray, b: _np.ndarray) -> _np.ndarray:
            d = _np.subtract.outer(a, b)**2
            return _np.exp(-0.5 * d / (kernel_length_scale**2))

        def gp_predict(x_new: _np.ndarray) -> Tuple[_np.ndarray, _np.ndarray]:
            X = _np.array(fracs)
            y = _np.array(vals, dtype=float)
            K = rbf_kernel(X, X) + noise * _np.eye(len(X))
            Ks = rbf_kernel(X, x_new)
            Kss = rbf_kernel(x_new, x_new) + noise * _np.eye(len(x_new))
            try:
                L = _np.linalg.cholesky(K)
                alpha = _np.linalg.solve(L.T, _np.linalg.solve(L, y))
                mu = Ks.T @ alpha
                v = _np.linalg.solve(L, Ks)
                cov = Kss - v.T @ v
                var = _np.clip(_np.diag(cov), 1e-9, None)
            except _np.linalg.LinAlgError:
                # Fallback to simple mean if numerical issues
                mu = _np.full(len(x_new), float(_np.mean(y)))
                var = _np.full(len(x_new), float(_np.var(y))+1e-6)
            return mu, var

        def expected_improvement(mu: _np.ndarray, var: _np.ndarray, best: float, xi: float = 0.01) -> _np.ndarray:
            sigma = _np.sqrt(var)
            with _np.errstate(divide='ignore'):
                Z = (best - mu - xi) / sigma
            # Standard normal pdf/cdf (erf based) to avoid scipy dependency
            def pdf(z):
                return (1/_np.sqrt(2*_np.pi))*_np.exp(-0.5*z*z)
            def cdf(z):
                return 0.5*(1+_m.erf(z/_np.sqrt(2)))
            pdfZ = pdf(Z)
            cdfZ = cdf(Z)
            improvement = (best - mu - xi)
            ei = improvement * cdfZ + sigma * pdfZ
            ei[sigma < 1e-9] = 0.0
            ei[improvement < 0] = 0.0  # no expected improvement if already worse
            return ei

        total_evals_budget = init_samples + iterations
        tried = set(fracs)
        for _ in range(iterations):
            # Dense grid for acquisition search (adaptive resolution)
            grid_n = 200
            grid = _np.linspace(0.0, 1.0, grid_n)
            mu, var = gp_predict(grid)
            best_val = float(min(vals))
            ei = expected_improvement(mu, var, best_val)
            # Choose max EI point not already evaluated
            order = _np.argsort(-ei)
            next_frac = None
            for idx in order:
                f = float(grid[idx])
                # Avoid duplicates / very close points
                if any(abs(f - e) < 1e-4 for e in tried):
                    continue
                next_frac = f
                break
            if next_frac is None:
                break
            tried.add(next_frac)
            cand_point = self._point_at_fraction(points, cum, total, next_frac)
            eval_res = await self._evaluate_minimax_candidates(loc1, loc2, [cand_point])
            if not eval_res:
                continue
            ev = eval_res[0]
            fracs.append(next_frac)
            vals.append(ev['max_travel_time_seconds'])
            details.append(ev)
            # Early stop if variance globally small
            if len(vals) > 10:
                if _np.std(vals[-5:]) < 30:  # last 5 within 30s
                    break

        # Pick best observed
        if not details:
            return None
        details.sort(key=lambda d: d['max_travel_time_seconds'])
        best = details[0]
        best['route_fraction'] = fracs[vals.index(best['max_travel_time_seconds'])]
        best['evaluations'] = len(vals)
        return best

    # ---------- Combined global uniform sampling + local Bayesian refinements ----------
    async def _global_and_local_sampling_minimax(
        self,
        points: List[Dict],
        loc1: Dict,
        loc2: Dict,
        global_fractions: int = 40,
        lateral_offsets: Optional[List[float]] = None,
        top_k_refine: int = 5,
        local_window: float = 0.08,
        local_iterations: int = 8,
        local_batch_ei: int = 3,
        ei_xi_seconds: float = 5.0,
    ) -> Tuple[Optional[Dict], List[Dict]]:
        """Uniformly sample entire route (with lateral offsets) then run local Bayesian refinement
        around top_k_refine promising fractions. Returns (best_metrics, all_sample_evals_for_payload).
        """
        if lateral_offsets is None:
            # Reduced offsets to limit Distance Matrix destinations while keeping variety
            lateral_offsets = [-400.0, 0.0, 400.0]
        if not points:
            return None, []
        try:
            import numpy as _np
            import math as _m
        except Exception:
            # Fallback to existing deterministic search
            best = await self._minimax_search_along_route(points, loc1, loc2)
            return best, []

        cum, total = self._cumulative_distances(points)
        if total == 0:
            solo = await self._evaluate_minimax_candidates(loc1, loc2, [points[0]])
            return (solo[0] if solo else None), []

        # --- Global uniform sampling ---
        frac_list = [i/(global_fractions-1) for i in range(global_fractions)] if global_fractions > 1 else [0.5]
        global_candidates: List[Dict] = []
        for f in frac_list:
            base = self._point_at_fraction(points, cum, total, f)
            # Estimate bearing for perpendicular offsets
            target = f * total
            seg_i = 0
            for i in range(len(cum)-1):
                if cum[i+1] >= target:
                    seg_i = i
                    break
            if seg_i >= len(points)-1:
                seg_i = len(points)-2
            bearing = self._bearing(points[seg_i], points[seg_i+1])
            for off in lateral_offsets:
                if off == 0:
                    pt = {**base}
                else:
                    pt = self._offset_point(base, bearing, off)
                pt['route_fraction'] = f
                pt['lateral_offset_m'] = off
                global_candidates.append(pt)

        # Evaluate global candidates in batch
        global_evals = await self._evaluate_minimax_candidates(loc1, loc2, global_candidates)
        # Index by (fraction, offset)
        eval_map: Dict[Tuple[float, float], Dict] = {}
        for ev in global_evals:
            key = (round(ev['point']['route_fraction'], 6), float(ev['point']['lateral_offset_m']))
            eval_map[key] = ev

        # Determine best per fraction (choose offset with lowest max time) to rank fractions
        per_fraction_best: Dict[float, Dict] = {}
        for ev in global_evals:
            f = ev['point']['route_fraction']
            cur = per_fraction_best.get(f)
            if cur is None or ev['max_travel_time_seconds'] < cur['max_travel_time_seconds']:
                per_fraction_best[f] = ev
        ranked_fracs = sorted(per_fraction_best.values(), key=lambda e: e['max_travel_time_seconds'])
        top_fracs = [e['point']['route_fraction'] for e in ranked_fracs[:top_k_refine]]

        # --- Local Bayesian refinement for each top fraction ---
        refined_evals: List[Dict] = []
        try:
            import numpy as _np
        except Exception:
            top_best = ranked_fracs[0] if ranked_fracs else (global_evals[0] if global_evals else None)
            all_payload = self._format_samples_payload(global_evals + refined_evals)
            return (self._to_metrics_dict(top_best) if top_best else None), all_payload

        def rbf_kernel(a: _np.ndarray, b: _np.ndarray, ls: float = 0.05):
            d = _np.subtract.outer(a, b)**2
            return _np.exp(-0.5 * d / (ls**2))

        async def refine_fraction(center_frac: float):
            # Gather existing samples in window
            start = max(0.0, center_frac - local_window)
            end = min(1.0, center_frac + local_window)
            existing = [(k,v) for k,v in eval_map.items() if start <= k[0] <= end and k[1] == 0.0]
            if not existing:
                # add center point (offset 0) if missing
                base = self._point_at_fraction(points, cum, total, center_frac)
                base['route_fraction'] = center_frac
                base['lateral_offset_m'] = 0.0
                new_ev = await self._evaluate_minimax_candidates(loc1, loc2, [base])
                if new_ev:
                    ev = new_ev[0]
                    eval_map[(round(center_frac,6), 0.0)] = ev
                    existing = [((round(center_frac,6),0.0), ev)]
            # Prepare GP data
            X = _np.array([k[0] for k,_ in existing])
            y = _np.array([e['max_travel_time_seconds'] for _,e in existing], dtype=float)
            noise = 1e-6
            for it in range(local_iterations):
                # Candidate fractions inside window (dense grid)
                grid = _np.linspace(start, end, 100)
                # Remove already sampled (within tiny tolerance)
                mask = _np.array([all(abs(g - x) > 1e-4 for x in X) for g in grid])
                grid = grid[mask]
                if len(grid) == 0:
                    break
                K = rbf_kernel(X, X) + noise * _np.eye(len(X))
                try:
                    L = _np.linalg.cholesky(K)
                    alpha = _np.linalg.solve(L.T, _np.linalg.solve(L, y))
                    Ks = rbf_kernel(X, grid)
                    mu = Ks.T @ alpha
                    v = _np.linalg.solve(L, Ks)
                    var = _np.clip(1 - _np.sum(v*v, axis=0), 1e-6, None)  # approximate diag posterior variance (unit prior)
                except _np.linalg.LinAlgError:
                    mu = _np.full(len(grid), float(_np.mean(y)))
                    var = _np.full(len(grid), 0.05)
                best_y = float(_np.min(y))
                sigma = _np.sqrt(var)
                xi = float(ei_xi_seconds)
                Z = (best_y - mu - xi) / sigma
                # Normal pdf/cdf
                pdf = (1/_np.sqrt(2*_np.pi))*_np.exp(-0.5*Z*Z)
                cdf = 0.5*(1+_np.vectorize(lambda z: math.erf(z/_np.sqrt(2)))(Z))
                improvement = (best_y - mu - xi)
                ei = improvement * cdf + sigma * pdf
                ei[(sigma < 1e-9) | (improvement < 0)] = 0.0
                if _np.all(ei <= 0):
                    break
                # Select up to local_batch_ei best candidates with separation
                order = _np.argsort(-ei)
                chosen: List[float] = []
                min_sep = 0.005 * (end - start if end > start else 1.0)
                for idx in order:
                    f = float(grid[idx])
                    if all(abs(f - c) >= min_sep for c in chosen):
                        chosen.append(f)
                    if len(chosen) >= max(1, int(local_batch_ei)):
                        break
                # Build batch of candidates including small lateral scan
                cand_pts: List[Dict] = []
                for next_frac in chosen:
                    base_pt = self._point_at_fraction(points, cum, total, next_frac)
                    # Bearing near fraction
                    tgt = next_frac * total
                    seg_i = 0
                    for j in range(len(cum)-1):
                        if cum[j+1] >= tgt:
                            seg_i = j
                            break
                    if seg_i >= len(points)-1: seg_i = len(points)-2
                    bearing = self._bearing(points[seg_i], points[seg_i+1])
                    for off in [0.0, -200.0, 200.0]:
                        pt = {**base_pt} if off == 0.0 else self._offset_point(base_pt, bearing, off)
                        pt['route_fraction'] = next_frac
                        pt['lateral_offset_m'] = off
                        cand_pts.append(pt)
                # Batch evaluate all candidates in one Distance Matrix round
                cand_evals = await self._evaluate_minimax_candidates(loc1, loc2, cand_pts)
                if not cand_evals:
                    break
                # Update maps and GP dataset (centerline points only)
                added_centers = 0
                for ev in cand_evals:
                    key = (round(ev['point']['route_fraction'],6), float(ev['point']['lateral_offset_m']))
                    if key not in eval_map:
                        eval_map[key] = ev
                        refined_evals.append(ev)
                for f in chosen:
                    center_ev = eval_map.get((round(f,6), 0.0))
                    if center_ev is not None:
                        X = _np.append(X, center_ev['point']['route_fraction'])
                        y = _np.append(y, center_ev['max_travel_time_seconds'])
                        added_centers += 1
                try:
                    print(f"[BO-Local] center={round(center_frac,4)} it={it+1} added_centers={added_centers} best={round(float(_np.min(y))/60.0,1)}min window=({round(start,3)},{round(end,3)})")
                except Exception:
                    pass
            return

        # Run refinements sequentially (could be parallel but sequence for rate limiting)
        for f in top_fracs:
            await refine_fraction(f)

        # Collate all evaluations
        all_evals = list(eval_map.values())
        all_evals.extend(refined_evals)
        # Pick best overall
        if not all_evals:
            return None, []
        # Sort by objective (max travel time)
        all_evals.sort(key=lambda e: e['max_travel_time_seconds'])
        best = all_evals[0]
        # Apply spacing (≥200m between kept points for visualization). Because list is
        # already sorted with best first, best will always be retained.
        original_ct = len(all_evals)
        clustered_spaced = self._thin_for_visualization(all_evals, fraction_tol=0.002, base_min_spacing_m=300.0)
        final_ct = len(clustered_spaced)
        try:
            print(f"[RouteSampling] Thinning reduced samples from {original_ct} to {final_ct} (fraction_tol=0.002, min_spacing=300m)")
        except Exception:
            pass
        payload = self._format_samples_payload(clustered_spaced)
        return best, payload

    def _format_samples_payload(self, evals: List[Dict]) -> List[Dict]:
        out = []
        for ev in evals:
            pt = ev['point']
            out.append({
                'lat': pt['lat'],
                'lng': pt['lng'],
                'route_fraction': pt.get('route_fraction'),
                'lateral_offset_m': pt.get('lateral_offset_m'),
                'max_travel_time_minutes': ev.get('max_travel_time_minutes'),
                'time_difference_minutes': ev.get('time_difference_minutes')
            })
        return out

    # --- Spacing utilities (inserted) ---
    @staticmethod
    def _haversine_m(p1: Dict, p2: Dict) -> float:
        R = 6371000.0
        lat1, lon1 = math.radians(p1['lat']), math.radians(p1['lng'])
        lat2, lon2 = math.radians(p2['lat']), math.radians(p2['lng'])
        dlat = lat2 - lat1; dlon = lon2 - lon1
        a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
        c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R*c

    def _enforce_min_spacing(self, evals: List[Dict], min_distance_m: float = 200.0) -> List[Dict]:
        if not evals:
            return []
        kept: List[Dict] = []
        for ev in evals:
            pt = ev['point']
            if not kept:
                kept.append(ev); continue
            if all(self._haversine_m(pt, k['point']) >= min_distance_m for k in kept):
                kept.append(ev)
        return kept

    def _thin_for_visualization(
        self,
        evals: List[Dict],
        fraction_tol: float = 0.002,
        base_min_spacing_m: float = 300.0,
    ) -> List[Dict]:
        """Cluster by route_fraction (within fraction_tol) keeping best per cluster,
        then apply spatial spacing along route order. Assumes evals already sorted by
        objective (best first) so best candidate in each cluster retained.
        """
        if not evals:
            return []
        # 1. Cluster by route_fraction tolerance
        clustered: List[Dict] = []
        used = []
        for ev in evals:
            rf = ev['point'].get('route_fraction')
            if rf is None:
                clustered.append(ev)
                continue
            if any(abs(rf - u) <= fraction_tol for u in used):
                continue
            clustered.append(ev)
            used.append(rf)
        # 2. Apply spacing (reuse enforce with higher threshold)
        spaced = self._enforce_min_spacing(clustered, min_distance_m=base_min_spacing_m)
        return spaced

    def _to_metrics_dict(self, ev: Dict) -> Dict:
        return {
            **ev,
            'point': ev['point']
        }

    async def _select_best_place_minimax(
        self,
        location1: Dict,
        location2: Dict,
        places: List[Dict],
    ) -> Optional[Dict]:
        """Select place minimizing max(origin travel times)."""
        if not places:
            return None
        dm = await self.maps_service.get_transit_times_matrix_async(
            [location1, location2], places, departure_time=_dt.datetime.now()
        )
        best = None
        best_val = float('inf')
        for i, place in enumerate(places):
            t1 = dm[0][i] if dm and dm[0][i] is not None else None
            t2 = dm[1][i] if dm and dm[1][i] is not None else None
            if t1 is None or t2 is None:
                continue
            worst = max(t1, t2)
            if worst < best_val:
                diff = abs(t1 - t2)
                best_val = worst
                best = {
                    **place,
                    'time_from_address1': t1,
                    'time_from_address2': t2,
                    'max_travel_time_seconds': worst,
                    'max_travel_time_minutes': round(worst / 60, 1),
                    'time_difference_seconds': diff,
                    'time_difference_minutes': round(diff / 60, 1),
                    'total_travel_time_seconds': t1 + t2,
                    'total_travel_time_minutes': round((t1 + t2) / 60, 1),
                    'objective': 'minimax_max_travel_time'
                }
        if best:
            return best
        # Fallback: attempt per-place directions for a small subset if DM failed
        subset = places[: min(8, len(places))]
        tasks: List[asyncio.Future] = []
        for p in subset:
            tasks.append(self.maps_service.get_transit_time_async(location1, p, departure_time=_dt.datetime.now()))
            tasks.append(self.maps_service.get_transit_time_async(location2, p, departure_time=_dt.datetime.now()))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for i, p in enumerate(subset):
            t1 = results[i * 2] if i * 2 < len(results) and not isinstance(results[i * 2], Exception) else None
            t2 = results[i * 2 + 1] if i * 2 + 1 < len(results) and not isinstance(results[i * 2 + 1], Exception) else None
            if t1 is None or t2 is None:
                continue
            worst = max(t1, t2)
            if worst < best_val:
                diff = abs(t1 - t2)
                best_val = worst
                best = {
                    **p,
                    'time_from_address1': t1,
                    'time_from_address2': t2,
                    'max_travel_time_seconds': worst,
                    'max_travel_time_minutes': round(worst / 60, 1),
                    'time_difference_seconds': diff,
                    'time_difference_minutes': round(diff / 60, 1),
                    'total_travel_time_seconds': t1 + t2,
                    'total_travel_time_minutes': round((t1 + t2) / 60, 1),
                    'objective': 'minimax_max_travel_time'
                }
        return best

    def find_optimal_meeting_point(self, address1: str, address2: str, search_radius: int = 2000) -> Dict:
        """
        Find optimal meeting point using minimax (minimize the maximum of the two transit travel times)
        by searching along the fastest transit route between the two addresses.
        """
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self.find_optimal_meeting_point_async(address1, address2, search_radius))
        finally:
            loop.close()

    async def find_optimal_meeting_point_async(self, address1: str, address2: str, search_radius: int = 2000) -> Dict:
        result = {
            'success': False,
            'error': None,
            'data': {}
        }

        try:
            # Geocode both addresses in parallel
            loc1_task = self.maps_service.geocode_address_async(address1)
            loc2_task = self.maps_service.geocode_address_async(address2)
            location1, location2 = await asyncio.gather(loc1_task, loc2_task)

            if not location1:
                result['error'] = f"Could not geocode address: {address1}"
                return result
            if not location2:
                result['error'] = f"Could not geocode address: {address2}"
                return result

            # Get fastest transit route and perform minimax search along it
            route_info = await self.maps_service.get_fastest_transit_route_async(location1, location2)
            if not route_info or not route_info.get('points'):
                fallback_mid = MiddlePointFinder(self.maps_service).calculate_geographic_midpoint(location1, location2)
                minimax_point = fallback_mid
                minimax_metrics = None
                route_meta = None
            else:
                # Try Bayesian optimization first; fallback to deterministic if it fails
                # Global uniform sampling + local Bayesian refinement across entire route
                best_eval, sampled_points_payload = await self._global_and_local_sampling_minimax(
                    route_info['points'], location1, location2,
                    global_fractions=50,
                    lateral_offsets=[-400.0, 0.0, 400.0],
                    top_k_refine=6,
                    local_window=0.06,
                    local_iterations=8,
                    local_batch_ei=3,
                    ei_xi_seconds=5.0,
                )
                if sampled_points_payload is None:
                    sampled_points_payload = []
                # If no evaluated payload but we have points, include raw geometric samples for visibility
                if not sampled_points_payload:
                    raw_samples = self._sample_route_with_perpendicular(route_info['points'], fractions=20, lateral_offsets_m=[-400,0,400])
                    fake_evals = [{
                        'point': p,
                        'max_travel_time_seconds': 0
                    } for p in raw_samples[:150]]
                    spaced = self._enforce_min_spacing(fake_evals, min_distance_m=200.0)
                    sampled_points_payload = [{
                        'lat': fe['point']['lat'], 'lng': fe['point']['lng'],
                        'route_fraction': fe['point'].get('route_fraction'),
                        'lateral_offset_m': fe['point'].get('lateral_offset_m'),
                        'max_travel_time_minutes': None,
                        'time_difference_minutes': None
                    } for fe in spaced]
                # Debug logging of sampling points count and a first sample
                try:
                    sample_count = len(sampled_points_payload)
                    first_sample = sampled_points_payload[0] if sample_count else None
                    print(f"[RouteSampling] Generated {sample_count} sampling points (evaluated + fallback). First sample: {first_sample}")
                except Exception:
                    pass
                minimax_metrics = best_eval
                minimax_point = best_eval['point'] if best_eval else route_info['points'][len(route_info['points']) // 2]
                route_meta = {
                    'distance_meters': route_info.get('distance_meters'),
                    'duration_seconds': route_info.get('duration_seconds'),
                    'overview_polyline': route_info.get('overview_polyline')
                }

            # Parallel API calls: transit times to the chosen minimax point + nearby places + categories
            tasks = [
                self.maps_service.get_transit_time_async(location1, minimax_point),
                self.maps_service.get_transit_time_async(location2, minimax_point),
                self.maps_service.find_places_nearby_async(minimax_point, radius=search_radius, place_type="establishment"),
                self.maps_service.get_places_by_category_async(
                    minimax_point,
                    radius=search_radius,
                    categories=['restaurant', 'cafe', 'bar', 'shopping_mall', 'store', 'park', 'tourist_attraction', 'gym', 'library']
                )
            ]

            time1_to_mid, time2_to_mid, nearby_places, categorized_businesses = await asyncio.gather(*tasks)
            # Minimax evaluation for places
            best_meeting_point = await self._select_best_place_minimax(location1, location2, nearby_places)

            # Sort and keep a few alternatives (by minimax)
            alternatives: List[Dict] = []
            if nearby_places:
                dm_alt = await self.maps_service.get_transit_times_matrix_async([location1, location2], nearby_places, departure_time=_dt.datetime.now())
                scored = []
                for i, p in enumerate(nearby_places):
                    t1 = dm_alt[0][i] if dm_alt and dm_alt[0][i] is not None else None
                    t2 = dm_alt[1][i] if dm_alt and dm_alt[1][i] is not None else None
                    if t1 is None or t2 is None:
                        continue
                    scored.append({
                        **p,
                        'time_from_address1': t1,
                        'time_from_address2': t2,
                        'max_travel_time_seconds': max(t1, t2),
                        'max_travel_time_minutes': round(max(t1, t2) / 60, 1),
                        'time_difference_seconds': abs(t1 - t2),
                        'time_difference_minutes': round(abs(t1 - t2) / 60, 1),
                        'total_travel_time_seconds': t1 + t2,
                        'total_travel_time_minutes': round((t1 + t2) / 60, 1),
                    })
                scored.sort(key=lambda x: x['max_travel_time_seconds'])
                alternatives = scored[:5]

            result['success'] = True
            result['data'] = {
                # Keep original algorithm identifier for frontend compatibility; internally now minimax.
                'algorithm': 'transit-route-midpoint',
                'address1': {'input': address1, 'geocoded': location1},
                'address2': {'input': address2, 'geocoded': location2},
                'route': route_meta,
                'route_midpoint': minimax_point,  # kept key name for frontend compatibility
                'route_minimax_metrics': minimax_metrics,  # new detailed metrics for the chosen point
                'route_sampling_points': sampled_points_payload if route_info and route_info.get('points') else [],
                'route_sampling_points_count': len(sampled_points_payload) if route_info and route_info.get('points') else 0,
                'route_midpoint_transit_times': {  # preserve original structure
                    'from_address1_seconds': time1_to_mid,
                    'from_address2_seconds': time2_to_mid,
                    'from_address1_minutes': round(time1_to_mid / 60, 1) if time1_to_mid else None,
                    'from_address2_minutes': round(time2_to_mid / 60, 1) if time2_to_mid else None
                },
                'optimal_meeting_point': best_meeting_point,
                'nearby_alternatives': alternatives,
                'categorized_businesses': categorized_businesses or {}
            }

        except Exception as e:
            result['error'] = f"Unexpected error: {str(e)}"

        return result
