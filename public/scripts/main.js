// Resolve API base dynamically, with safe fallback
let API_BASE = (typeof window !== 'undefined' && window.API_BASE)
    ? window.API_BASE
    : 'http://localhost:5001';

function setApiBase(base) {
    if (typeof base === 'string' && base.trim()) {
        API_BASE = base.trim().replace(/\/$/, '');
        if (typeof window !== 'undefined') {
            window.API_BASE = API_BASE;
        }
        try {
            console.log('API base configured:', API_BASE);
        } catch (_) {}
    }
}

// Expose setter for index.html/bootstrap script
if (typeof window !== 'undefined') {
    window.setApiBase = setApiBase;
}
let map;
let directionsService;
let directionsRenderer1, directionsRenderer2;
let directionsRendererAlt1, directionsRendererAlt2; // for second algorithm
let currentData = null;
let markers = [];
let businessMarkers = [];
let sampleMarkers = [];
let openInfoWindows = [];
let routes = [];
let categorizedBusinesses = {};
let routeClickedRecently = false;
let markerClickedRecently = false;

// Lightweight Google polyline decoder (returns array of {lat,lng})
function decodePolyline(encoded) {
    if (!encoded || typeof encoded !== 'string') return [];
    let index = 0, lat = 0, lng = 0, coordinates = [];
    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        coordinates.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return coordinates;
}

// Business type icons mapping
const businessIcons = {
    restaurant: '🍽️',
    cafe: '☕',
    bar: '🍺',
    shopping_mall: '🛍️',
    park: '🌳',
    tourist_attraction: '🏛️',
    gym: '💪',
    library: '📚'
};

// Transport mode icons mapping
const transportIcons = {
    'BUS': '🚌',
    'SUBWAY': '🚇',
    'TRAIN': '🚂',
    'TRAM': '🚊',
    'RAIL': '🚆',
    'METRO_RAIL': '🚇',
    'MONORAIL': '🚝',
    'HEAVY_RAIL': '🚆',
    'COMMUTER_TRAIN': '🚆',
    'HIGH_SPEED_TRAIN': '🚄',
    'LONG_DISTANCE_TRAIN': '🚂',
    'WALKING': '🚶',
    'DRIVING': '🚗',
    'BICYCLING': '🚴',
    'FERRY': '⛴️',
    'CABLE_CAR': '🚠',
    'GONDOLA_LIFT': '🚡',
    'FUNICULAR': '🚟',
    'OTHER': '🚌' // Default fallback
};

// Initialize maps when Google Maps API is loaded
function initMaps() {
    console.log('Initializing Google Maps...');
    
    // Check if map element exists
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error('Map element not found!');
        return;
    }
    
    // Main overview map
    map = new google.maps.Map(mapElement, {
        zoom: 13,
        center: { lat: 40.7128, lng: -74.0060 }, // Default to NYC
        mapTypeId: 'roadmap'
    });
    
    // Initialize directions service and renderers
    directionsService = new google.maps.DirectionsService();
    
    console.log('Google Maps initialized successfully');
    
    // Comprehensive map click handler for both POI and regular clicks
    let lastMapClickTime = 0;
    map.addListener('click', (event) => {
        const currentTime = Date.now();
        
        // Debounce rapid clicks
        if (currentTime - lastMapClickTime < 50) { // Reduced from 100ms to 50ms
            return;
        }
        lastMapClickTime = currentTime;
        
        // Handle POI clicks - prevent default and create our own InfoWindow
        if (event.placeId) {
            // Prevent Google's default InfoWindow from opening
            event.stop();
            
            markerClickedRecently = true;
            setTimeout(() => { markerClickedRecently = false; }, 200);
            
            // Close existing InfoWindows first
            closeAllInfoWindows();
            
            // Fetch place details directly without loading indicator
            const service = new google.maps.places.PlacesService(map);
            service.getDetails({
                placeId: event.placeId,
                fields: ['name', 'formatted_address', 'rating', 'user_ratings_total', 'types', 'website']
            }, (place, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK && place) {
                    // Create optimized content using template literals
                    const content = createPOIContent(place);
                    
                    const poiInfoWindow = new google.maps.InfoWindow({
                        content,
                        position: event.latLng
                    });
                    
                    poiInfoWindow._debugId = `poi-${event.placeId}`;
                    poiInfoWindow.open(map);
                    openInfoWindows.push(poiInfoWindow);
                }
                // Silently fail if place details can't be loaded
            });
            
            return;
        }
        
        // Handle regular map clicks (empty space)
        if (!routeClickedRecently && !markerClickedRecently) {
            closeAllInfoWindows();
        }
    });
    
    directionsRenderer1 = new google.maps.DirectionsRenderer({
        map: map,
        polylineOptions: {
            strokeColor: '#4285f4',
            strokeWeight: 6,
            strokeOpacity: 0.8,
            clickable: true,  // Make the polyline clickable
            zIndex: 1000
        },
        suppressMarkers: true, // We'll create custom markers
        preserveViewport: false
    });
    
    directionsRenderer2 = new google.maps.DirectionsRenderer({
        map: map,
        polylineOptions: {
            strokeColor: '#ea4335',
            strokeWeight: 6,
            strokeOpacity: 0.8,
            clickable: true,  // Make the polyline clickable
            zIndex: 1000
        },
        suppressMarkers: true, // We'll create custom markers
        preserveViewport: false
    });
    
    // Alternative renderers for second algorithm (route-midpoint)
    directionsRendererAlt1 = new google.maps.DirectionsRenderer({
        map: map,
        polylineOptions: {
            strokeColor: '#9c27b0', // purple
            strokeWeight: 5,
            strokeOpacity: 0.85,
            clickable: true,
            zIndex: 999
        },
        suppressMarkers: true,
        preserveViewport: false
    });
    directionsRendererAlt2 = new google.maps.DirectionsRenderer({
        map: map,
        polylineOptions: {
            strokeColor: '#0f9d58', // green
            strokeWeight: 5,
            strokeOpacity: 0.85,
            clickable: true,
            zIndex: 999
        },
        suppressMarkers: true,
        preserveViewport: false
    });
    
    checkApiStatus();
    
    // Initialize Google Places Autocomplete
    initializeAutocomplete();
    
    // Setup input field enhancements
    setupInputFieldEnhancements();
    
    // Initialize location detection after maps are ready
    initializeLocationDetection();
}

// Check API status
async function checkApiStatus() {
    const statusDiv = document.getElementById('status');
    try {
        const response = await fetch(`${API_BASE}/`);
        if (response.ok) {
            statusDiv.className = 'status-indicator status-ok';
            statusDiv.textContent = '✅ API Server Connected';
        } else {
            throw new Error('API not responding');
        }
    } catch (error) {
        statusDiv.className = 'status-indicator status-error';
        statusDiv.textContent = '❌ API Server Offline';
    }
}

// Clear all markers from map
function clearMarkers() {
    markers.forEach(marker => marker.setMap(null));
    markers = [];
    clearBusinessMarkers();
    // Clear sample markers
    sampleMarkers.forEach(m => m.setMap(null));
    sampleMarkers = [];
}

// Clear business markers specifically
function clearBusinessMarkers() {
    // Close and remove any business-related InfoWindows from tracking
    const businessInfoWindows = openInfoWindows.filter(w => w._debugId && w._debugId.startsWith('business-'));
    businessInfoWindows.forEach(infoWindow => infoWindow.close());
    
    // Remove business InfoWindows from the tracking array
    openInfoWindows = openInfoWindows.filter(w => !w._debugId || !w._debugId.startsWith('business-'));
    
    // Clear the actual markers
    businessMarkers.forEach(marker => marker.setMap(null));
    businessMarkers.length = 0; // Faster array clearing
}

// Clear all info windows (optimized)
function closeAllInfoWindows() {
    // Batch close all InfoWindows for better performance
    for (let i = openInfoWindows.length - 1; i >= 0; i--) {
        openInfoWindows[i].close();
    }
    openInfoWindows.length = 0; // Faster array clearing
}

// Make function available globally for button clicks
window.closeAllInfoWindows = closeAllInfoWindows;

// Display routes from both addresses to the meeting point
function displayRoutesWithRenderers(address1, address2, meetingPoint, rendererA, rendererB, colorA, colorB, labelSuffix = '') {
    console.log('displayRoutes called with:', { address1, address2, meetingPoint });
    
    if (!directionsService) {
        console.error('DirectionsService not initialized');
        return;
    }
    
    if (!address1 || !address2 || !meetingPoint) {
        console.error('Missing required parameters for displayRoutes');
        return;
    }
    
    console.log('Requesting route 1: from', address1, 'to', meetingPoint);
    
    // Route from address 1 to meeting point
    directionsService.route({
        origin: { lat: address1.lat, lng: address1.lng },
        destination: { lat: meetingPoint.lat, lng: meetingPoint.lng },
        travelMode: google.maps.TravelMode.TRANSIT,
        transitOptions: {
            departureTime: new Date()
        }
    }, (result, status) => {
        console.log('Route 1 response:', status, result);
        if (status === 'OK') {
            rendererA.setMap(map);
            rendererA.setDirections(result);
            console.log('Route 1 displayed successfully');
            
            // Add click listener to route 1
            setTimeout(() => {
                try {
                    const route = result.routes[0];
                    addRouteClickListener(rendererA, route, `Route from Address A${labelSuffix ? ' - ' + labelSuffix : ''}`, colorA);
                } catch (e) {
                    console.error('Error adding click listener to route 1:', e);
                }
            }, 500);
        } else {
            console.error('Route 1 request failed', status);
        }
    });
    
    console.log('Requesting route 2: from', address2, 'to', meetingPoint);
    
    // Route from address 2 to meeting point  
    directionsService.route({
        origin: { lat: address2.lat, lng: address2.lng },
        destination: { lat: meetingPoint.lat, lng: meetingPoint.lng },
        travelMode: google.maps.TravelMode.TRANSIT,
        transitOptions: {
            departureTime: new Date()
        }
    }, (result, status) => {
        console.log('Route 2 response:', status, result);
        if (status === 'OK') {
            rendererB.setMap(map);
            rendererB.setDirections(result);
            console.log('Route 2 displayed successfully');
            
            // Add click listener to route 2
            setTimeout(() => {
                try {
                    const route = result.routes[0];
                    addRouteClickListener(rendererB, route, `Route from Address B${labelSuffix ? ' - ' + labelSuffix : ''}`, colorB);
                } catch (e) {
                    console.error('Error adding click listener to route 2:', e);
                }
            }, 500);
        } else {
            console.error('Route 2 request', status);
        }
    });
}

// Backwards-compatible wrapper using default renderers/colors
function displayRoutes(address1, address2, meetingPoint) {
    return displayRoutesWithRenderers(
        address1,
        address2,
        meetingPoint,
        directionsRenderer1,
        directionsRenderer2,
        '#4285f4',
        '#ea4335',
        'Default'
    );
}

// Add click listener to route polylines for showing instructions
function addRouteClickListener(renderer, route, routeName, color) {
    console.log('Adding click listener for:', routeName);
    
    try {
        // Create info window for route instructions
        const infoWindow = new google.maps.InfoWindow({
            maxWidth: 400
        });
        
        // Add unique identifier for debugging
        infoWindow._debugId = `route-${routeName.replace(/\s+/g, '-').toLowerCase()}`;
        
        // Wait for the renderer to be fully initialized
        setTimeout(() => {
            try {
                console.log('Creating clickable overlay for:', routeName);
                
                // Create a detailed route path from all the steps
                let routePath = [];
                
                // Build comprehensive path from all route steps
                route.legs.forEach((leg, legIndex) => {
                    leg.steps.forEach((step, stepIndex) => {
                        // Add all points from this step's path
                        if (step.path && step.path.length > 0) {
                            step.path.forEach(point => {
                                routePath.push(point);
                            });
                        } else {
                            // Fallback: use start and end points
                            if (step.start_location) {
                                routePath.push(step.start_location);
                            }
                            if (step.end_location) {
                                routePath.push(step.end_location);
                            }
                        }
                    });
                });
                
                // If we don't have enough points, try the overview polyline
                if (routePath.length < 10 && route.overview_polyline && route.overview_polyline.points) {
                    try {
                        if (typeof google.maps.geometry !== 'undefined' && typeof google.maps.geometry.encoding !== 'undefined') {
                            const decodedPath = google.maps.geometry.encoding.decodePath(route.overview_polyline.points);
                            routePath = decodedPath;
                            console.log('Using decoded overview polyline with', decodedPath.length, 'points for:', routeName);
                        }
                    } catch (error) {
                        console.error('Error decoding overview polyline:', error);
                    }
                }
                
                console.log('Built route path with', routePath.length, 'points for:', routeName);
                
                if (routePath.length === 0) {
                    console.error('No route path found for:', routeName);
                    return;
                }
                
                // Create an invisible but clickable polyline overlay
                const clickablePolyline = new google.maps.Polyline({
                    path: routePath,
                    strokeOpacity: 0, // Completely invisible
                    strokeWeight: 20, // Wide area for easy clicking
                    map: map,
                    clickable: true,
                    zIndex: 10000 // Very high z-index to ensure it's on top
                });
                
                console.log('Created clickable polyline overlay for:', routeName);
                
                // Add click listener to the overlay polyline
                const clickListener = google.maps.event.addListener(clickablePolyline, 'click', (event) => {
                    console.log('🔥 Clickable overlay clicked for route:', routeName);
                    routeClickedRecently = true; // Set flag to prevent map click
                    setTimeout(() => { routeClickedRecently = false; }, 200); // Reset flag after delay
                    event.stop(); // Prevent the event from bubbling to the map
                    showRouteInstructions(infoWindow, route, routeName, color, event.latLng);
                });
                
                // Add hover effects for visual feedback
                google.maps.event.addListener(clickablePolyline, 'mouseover', () => {
                    console.log('🖱️ Mouse over route:', routeName);
                    clickablePolyline.setOptions({ 
                        strokeOpacity: 0.3, 
                        strokeColor: color,
                        strokeWeight: 8
                    });
                    map.getDiv().style.cursor = 'pointer';
                });
                
                google.maps.event.addListener(clickablePolyline, 'mouseout', () => {
                    console.log('🖱️ Mouse out route:', routeName);
                    clickablePolyline.setOptions({ 
                        strokeOpacity: 0,
                        strokeWeight: 20
                    });
                    map.getDiv().style.cursor = '';
                });
                
                // Store for cleanup
                routes.push({
                    renderer,
                    clickablePolyline,
                    clickListener,
                    infoWindow,
                    routeName: routeName
                });
                
                console.log('✅ Clickable overlay added successfully for:', routeName);
                
            } catch (error) {
                console.error('Error in click listener setup:', error);
            }
        }, 1000); // Give more time for route to be fully rendered
        
    } catch (error) {
        console.error('Error setting up route click listener:', error);
    }
}

// Observe DOM changes to detect when DirectionsRenderer creates polylines
function observeDirectionsPolylines(renderer, route, routeName, color, infoWindow) {
    console.log('Starting DOM observation for polylines:', routeName);
    
    const mapDiv = map.getDiv();
    if (!mapDiv) {
        console.error('Map div not found for observation');
        return;
    }
    
    // Create a mutation observer to watch for new polylines
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    // Look for SVG elements that might contain our polylines
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const paths = node.querySelectorAll ? node.querySelectorAll('path[stroke]') : [];
                        const directPaths = node.tagName === 'path' && node.hasAttribute('stroke') ? [node] : [];
                        const allPaths = [...paths, ...directPaths];
                        
                        allPaths.forEach((path) => {
                            const stroke = path.getAttribute('stroke');
                            const strokeRgb = path.style.stroke;
                            
                            // Check if this path matches our route color
                            const isMatchingRoute = 
                                (color === '#4285f4' && (
                                    stroke === '#4285f4' || 
                                    stroke === 'rgb(66, 133, 244)' ||
                                    strokeRgb === 'rgb(66, 133, 244)' ||
                                    strokeRgb === '#4285f4'
                                )) ||
                                (color === '#ea4335' && (
                                    stroke === '#ea4335' || 
                                    stroke === 'rgb(234, 67, 53)' ||
                                    strokeRgb === 'rgb(234, 67, 53)' ||
                                    strokeRgb === '#ea4335'
                                ));
                            
                            if (isMatchingRoute) {
                                console.log('🎯 Found matching polyline path for:', routeName, 'color:', stroke || strokeRgb);
                                
                                // Add click listener to the SVG path element
                                path.style.cursor = 'pointer';
                                path.addEventListener('click', (event) => {
                                    console.log('🔥 SVG path clicked for route:', routeName);
                                    
                                    // Convert screen coordinates to map coordinates
                                    const rect = mapDiv.getBoundingClientRect();
                                    const x = event.clientX - rect.left;
                                    const y = event.clientY - rect.top;
                                    
                                    // Convert pixel coordinates to lat/lng (approximate)
                                    const bounds = map.getBounds();
                                    const projection = map.getProjection();
                                    
                                    if (bounds && projection) {
                                        const sw = bounds.getSouthWest();
                                        const ne = bounds.getNorthEast();
                                        const mapWidth = mapDiv.offsetWidth;
                                        const mapHeight = mapDiv.offsetHeight;
                                        
                                        const lat = sw.lat() + (ne.lat() - sw.lat()) * (1 - y / mapHeight);
                                        const lng = sw.lng() + (ne.lng() - sw.lng()) * (x / mapWidth);
                                        
                                        const clickPosition = new google.maps.LatLng(lat, lng);
                                        showRouteInstructions(infoWindow, route, routeName, color, clickPosition);
                                    }
                                    
                                    event.stopPropagation();
                                });
                                
                                console.log('✅ Click listener added to SVG path for:', routeName);
                            }
                        });
                    }
                });
            }
        });
    });
    
    // Start observing
    observer.observe(mapDiv, {
        childList: true,
        subtree: true
    });
    
    // Store observer for cleanup
    routes.push({
        renderer,
        observer,
        infoWindow,
        routeName
    });
    
    // Stop observing after a reasonable time
    setTimeout(() => {
        console.log('Stopping DOM observation for:', routeName);
        observer.disconnect();
    }, 5000);
}

// Helper function to check if a click is near a route path
function isClickNearRoute(clickLatLng, routePath, tolerancePixels = 50) {
    if (!routePath || routePath.length === 0) return false;
    
    try {
        // Convert tolerance from pixels to degrees (rough approximation)
        const tolerance = tolerancePixels * 0.0001; // Rough conversion
        
        for (let i = 0; i < routePath.length; i++) {
            const pathPoint = routePath[i];
            const distance = google.maps.geometry.spherical.computeDistanceBetween(clickLatLng, pathPoint);
            // If distance is less than ~50 meters, consider it a click on the route
            if (distance < 50) {
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('Error checking click near route:', error);
        return false;
    }
}

// Show route instructions in info window
function showRouteInstructions(infoWindow, route, routeName, color, position) {
    // Close any existing info windows
    closeAllInfoWindows();
    
    let content = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 380px; color: #202124;">
            <h3 style="margin: 0 0 12px 0; color: ${color}; font-size: 18px; font-weight: 600;">
                ${routeName}
            </h3>
    `;
    
    const legs = route.legs;
    let totalDistance = 0;
    let totalDuration = 0;
    let transportModes = new Set();
    
    // Calculate totals and collect transport modes
    legs.forEach(leg => {
        totalDistance += leg.distance.value;
        totalDuration += leg.duration.value;
        
        leg.steps.forEach(step => {
            if (step.transit && step.transit.line && step.transit.line.vehicle) {
                transportModes.add(step.transit.line.vehicle.type || 'BUS');
            } else {
                transportModes.add(step.travel_mode || 'WALKING');
            }
        });
    });
    
    // Create transport mode summary
    const modeIcons = Array.from(transportModes).map(mode => transportIcons[mode] || '🚶').join(' ');
    
    content += `
        <div style="background: #f8f9fa; padding: 12px; border-radius: 6px; margin-bottom: 14px; border: 1px solid #e1e3e1;">
            <div style="font-size: 14px; color: #202124; font-weight: 600; margin-bottom: 6px;">📏 Total Distance: ${(totalDistance / 1000).toFixed(1)} km</div>
            <div style="font-size: 14px; color: #202124; font-weight: 600; margin-bottom: 6px;">⏱️ Total Duration: ${Math.round(totalDuration / 60)} minutes</div>
            <div style="font-size: 14px; color: #1a73e8; font-weight: 500;">🚌 Transport: ${modeIcons}</div>
        </div>
        <div style="max-height: 280px; overflow-y: auto; border-radius: 6px;">
    `;
    
    // Add step-by-step instructions
    legs.forEach((leg, legIndex) => {
        if (legs.length > 1) {
            content += `<h4 style="margin: 12px 0 6px 0; color: #1a73e8; font-size: 15px; font-weight: 600;">🚶 Leg ${legIndex + 1}</h4>`;
        }
        
        leg.steps.forEach((step, stepIndex) => {
            const enhancedStep = formatEnhancedInstruction(step);
            const distance = step.distance.text;
            const duration = step.duration.text;
            
            // Different styling for transit vs walking steps
            const bgColor = enhancedStep.isTransit ? '#f0f7ff' : '#f8f9fa';
            const borderColor = enhancedStep.isTransit ? color : '#e1e3e1';
            
            content += `
                <div style="margin-bottom: 12px; padding: 10px; border-left: 4px solid ${borderColor}; background: ${bgColor}; border-radius: 0 6px 6px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <div style="font-size: 14px; margin-bottom: 6px; color: #202124; line-height: 1.4; font-weight: 500;">
                        ${enhancedStep.instruction}
                    </div>
                    ${enhancedStep.stopDetails ? `
                        <div style="font-size: 12px; color: #1a73e8; margin-bottom: 4px; font-weight: 500;">
                            📍 ${enhancedStep.stopDetails}
                        </div>
                    ` : ''}
                    ${enhancedStep.timeDetails ? `
                        <div style="font-size: 12px; color: #34a853; margin-bottom: 4px;">
                            ⏰ ${enhancedStep.timeDetails}
                        </div>
                    ` : ''}
                    <div style="font-size: 12px; color: #5f6368; font-weight: 500;">
                        📏 ${distance} • ⏱️ ${duration}
                    </div>
                </div>
            `;
        });
    });
    
    content += `
        </div>
    </div>
    `;
    
    infoWindow.setContent(content);
    infoWindow.setPosition(position);
    infoWindow.open(map);
    
    // Add to openInfoWindows array for tracking
    console.log('📋 Before adding route InfoWindow, openInfoWindows:', openInfoWindows.length);
    console.log('📋 Route InfoWindow ID:', infoWindow._debugId);
    openInfoWindows.push(infoWindow);
    console.log('📋 After adding route InfoWindow, openInfoWindows:', openInfoWindows.length);
    console.log('📋 Updated openInfoWindows IDs:', openInfoWindows.map(w => w._debugId || 'no-id'));
    
    console.log('Route instructions displayed for:', routeName);
}

// Clear all routes from the map
function clearRoutes() {
    console.log('Clearing routes...');
    
    // Clear directions renderers
    if (directionsRenderer1) {
        directionsRenderer1.setDirections({routes: []});
        directionsRenderer1.setMap(null);
    }
    if (directionsRenderer2) {
        directionsRenderer2.setDirections({routes: []});
        directionsRenderer2.setMap(null);
    }
    if (directionsRendererAlt1) {
        directionsRendererAlt1.setDirections({routes: []});
        directionsRendererAlt1.setMap(null);
    }
    if (directionsRendererAlt2) {
        directionsRendererAlt2.setDirections({routes: []});
        directionsRendererAlt2.setMap(null);
    }
    
    // Clear route click listeners and polylines
    routes.forEach(routeInfo => {
        if (routeInfo.clickListener) {
            google.maps.event.removeListener(routeInfo.clickListener);
        }
        if (routeInfo.listener) {
            google.maps.event.removeListener(routeInfo.listener);
        }
        if (routeInfo.mapListener) {
            google.maps.event.removeListener(routeInfo.mapListener);
        }
        if (routeInfo.clickablePolyline) {
            routeInfo.clickablePolyline.setMap(null);
        }
        if (routeInfo.polyline) {
            routeInfo.polyline.setMap(null);
        }
        if (routeInfo.infoWindow) {
            routeInfo.infoWindow.close();
        }
        if (routeInfo.observer) {
            routeInfo.observer.disconnect();
        }
    });
    routes = [];
    
    // Close all info windows
    closeAllInfoWindows();
    
    console.log('Routes cleared');
}

function renderSampledPoints(samplePoints, mapRef, color='#555') {
    if (!Array.isArray(samplePoints)) return;
    console.log('[Sampling] Rendering', samplePoints.length, 'route sampling points');
    // Provide quick stats for debugging
    if (samplePoints.length > 0) {
        const mins = samplePoints.map(p => p.max_travel_time_minutes).filter(v => typeof v === 'number');
        if (mins.length) {
            const min = Math.min(...mins), max = Math.max(...mins), avg = mins.reduce((a,b)=>a+b,0)/mins.length;
            console.log(`[Sampling] Max travel time minutes range: ${min}-${max} (avg ${avg.toFixed(1)})`);
        }
    }
    const markerScale = 12; // larger points
    const markerFill = '#d50000'; // red color for visibility
    samplePoints.forEach(pt => {
        try {
            if (!pt || typeof pt.lat !== 'number' || typeof pt.lng !== 'number') return;
            // Safe formatting
            const rf = (typeof pt.route_fraction === 'number') ? (pt.route_fraction * 100).toFixed(1) : '?';
            const off = (typeof pt.lateral_offset_m === 'number') ? pt.lateral_offset_m : '?';
            const maxM = (typeof pt.max_travel_time_minutes === 'number') ? pt.max_travel_time_minutes : '?';
            const diffM = (typeof pt.time_difference_minutes === 'number') ? pt.time_difference_minutes : '?';

            // Use a consistent red color and larger size for sampled points
            const fill = markerFill;
            const marker = new google.maps.Marker({
                position: { lat: pt.lat, lng: pt.lng },
                map: mapRef,
                zIndex: 5000,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: markerScale + 2,
                    fillColor: fill,
                    fillOpacity: 0.9,
                    strokeColor: '#8e0000',
                    strokeWeight: 1.4
                },
                title: `Route ${rf}% | Offset ${off}m\nMax ${maxM}m | Δ ${diffM}m`
            });
            sampleMarkers.push(marker);

            // Supplemental: small circle overlay to guarantee visibility
            try {
                const circle = new google.maps.Circle({
                    strokeColor: '#b71c1c',
                    strokeOpacity: 0.7,
                    strokeWeight: 1,
                    fillColor: '#ef5350',
                    fillOpacity: 0.35,
                    map: mapRef,
                    center: { lat: pt.lat, lng: pt.lng },
                    radius: 50,
                    zIndex: 4000
                });
                sampleMarkers.push(circle);
            } catch (e) {
                // ignore if circle fails
            }
        } catch (err) {
            console.warn('[Sampling] Failed to render a sample point:', err, pt);
        }
    });

    // Ensure viewport includes the sampled points for visibility
    try {
        const bounds = new google.maps.LatLngBounds();
        samplePoints.slice(0, 200).forEach(pt => {
            if (typeof pt.lat === 'number' && typeof pt.lng === 'number') {
                bounds.extend(new google.maps.LatLng(pt.lat, pt.lng));
            }
        });
        if (!bounds.isEmpty()) {
            mapRef.fitBounds(bounds);
        }
    } catch (e) {
        console.warn('[Sampling] Failed to fit bounds inside render:', e);
    }
}

// Display results on map
function displayResultsOnMap(data, options = {}) {
    console.log('displayResultsOnMap called with data:', data);
    const {
    renderers = { A: directionsRenderer1, B: directionsRenderer2 },
    colors = { A: '#4285f4', B: '#ea4335' },
        labelSuffix = 'Default',
        showBusinesses = true,
    optimalColor = '#34a853',
    betweenColor = null
    } = options;
    
    // Validate data structure
    if (!data) {
        console.error('No data provided to displayResultsOnMap');
        return;
    }
    
    // Try to handle different possible data structures
    let address1, address2, midpoint, optimal;
    
    if (data.address1 && data.address1.geocoded) {
        // Expected structure
    address1 = data.address1.geocoded;
    address2 = data.address2.geocoded;
    // Support both algorithms: default uses geographic_midpoint, route-midpoint uses route_midpoint
    midpoint = data.geographic_midpoint || data.route_midpoint || null;
    optimal = data.optimal_meeting_point;
        console.log('Using expected data structure');
    } else if (data.success && data.data) {
        // Maybe data is nested differently
        console.log('Trying nested data structure');
        return displayResultsOnMap(data.data);
    } else {
        console.error('Unknown data structure:', Object.keys(data));
        console.error('Full data:', data);
        return;
    }
    
    console.log('Addresses:', { address1, address2 });
    console.log('Midpoint:', midpoint);
    console.log('Optimal:', optimal);
    
    if (!address1 || !address2) {
        console.error('Invalid geocoded addresses:', { address1, address2 });
        return;
    }
    
    // Center map near a sensible point: midpoint if available, else optimal, else average of inputs
    let center;
    if (midpoint && typeof midpoint.lat === 'number' && typeof midpoint.lng === 'number') {
        center = { lat: midpoint.lat, lng: midpoint.lng };
    } else if (optimal && typeof optimal.lat === 'number' && typeof optimal.lng === 'number') {
        center = { lat: optimal.lat, lng: optimal.lng };
    } else if (address1 && address2) {
        center = { lat: (address1.lat + address2.lat) / 2, lng: (address1.lng + address2.lng) / 2 };
    } else {
        center = map.getCenter();
    }
    map.setCenter(center);
    map.setZoom(14);
    
    // Clear any existing markers
    // Note: In a production app, you'd want to store and clear previous markers
    
    // Add markers for start points
    const marker1 = new google.maps.Marker({
        position: { lat: address1.lat, lng: address1.lng },
        map: map,
        title: `Address 1: ${address1.formatted_address}`,
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="18" fill="#4285f4" stroke="white" stroke-width="3"/>
                    <text x="20" y="26" text-anchor="middle" fill="white" font-family="Arial" font-size="16" font-weight="bold">A</text>
                </svg>
            `),
            scaledSize: new google.maps.Size(40, 40)
        }
    });
    markers.push(marker1);
    
    const marker2 = new google.maps.Marker({
        position: { lat: address2.lat, lng: address2.lng },
        map: map,
        title: `Address 2: ${address2.formatted_address}`,
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="18" fill="#ea4335" stroke="white" stroke-width="3"/>
                    <text x="20" y="26" text-anchor="middle" fill="white" font-family="Arial" font-size="16" font-weight="bold">B</text>
                </svg>
            `),
            scaledSize: new google.maps.Size(40, 40)
        }
    });
    markers.push(marker2);
    
    // Add marker for optimal meeting point
    if (optimal) {
        const optimalMarker = new google.maps.Marker({
            position: { lat: optimal.lat, lng: optimal.lng },
            map: map,
            title: `Optimal Meeting Point (${labelSuffix}): ${optimal.name}`,
            icon: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">
                        <circle cx="25" cy="25" r="22" fill="${optimalColor}" stroke="white" stroke-width="4"/>
                        <text x="25" y="31" text-anchor="middle" fill="white" font-family="Arial" font-size="20" font-weight="bold">★</text>
                    </svg>
                `),
                scaledSize: new google.maps.Size(50, 50)
            }
        });
        markers.push(optimalMarker);
        
        // Display routes from both addresses to the optimal meeting point
        displayRoutesWithRenderers(address1, address2, optimal, renderers.A, renderers.B, colors.A, colors.B, labelSuffix);

        // If backend provided an overview polyline for the route between A and B (route-midpoint algo), draw it
        if (data.route && data.route.overview_polyline && typeof google.maps.geometry !== 'undefined' && google.maps.geometry.encoding) {
            try {
                const path = google.maps.geometry.encoding.decodePath(data.route.overview_polyline);
                const poly = new google.maps.Polyline({
                    path,
                    geodesic: true,
                    strokeColor: betweenColor || '#7b1fa2',
                    strokeOpacity: 0.9,
                    strokeWeight: 4,
                    clickable: true,
                    zIndex: 998
                });
                poly.setMap(map);

                // Build info content
                const distance = data.route.distance_meters ? `${(data.route.distance_meters/1000).toFixed(1)} km` : 'N/A';
                const duration = data.route.duration_seconds ? `${Math.round(data.route.duration_seconds/60)} min` : 'N/A';
                const infoWindow = new google.maps.InfoWindow({
                    content: `
                        <div style="padding:8px; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                            <div style="font-weight:600; margin-bottom:6px; color:${betweenColor || '#7b1fa2'};">🚇 Fastest Transit Route ${labelSuffix ? '('+labelSuffix+')' : ''}</div>
                            <div>⏱️ Duration: ${duration}</div>
                            <div>📏 Distance: ${distance}</div>
                        </div>
                    `
                });

                const listener = poly.addListener('click', (e) => {
                    routeClickedRecently = true;
                    setTimeout(() => { routeClickedRecently = false; }, 200);
                    closeAllInfoWindows();
                    infoWindow.setPosition(e.latLng);
                    infoWindow.open(map);
                    openInfoWindows.push(infoWindow);
                });

                routes.push({ polyline: poly, infoWindow, listener });
            } catch (err) {
                console.error('Failed to decode/plot overview polyline:', err);
            }
        }
        
        // Add info window for optimal point
        const meetingPointInfoWindow = new google.maps.InfoWindow({
            content: `
                <div style="padding: 12px; max-width: 280px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                    <h4 style="margin: 0 0 10px 0; color: #34a853; font-size: 17px; font-weight: 600;">🎯 ${optimal.name}</h4>
                    <p style="margin: 0 0 6px 0; font-size: 14px; color: #202124; line-height: 1.4;"><strong style="color: #34a853;">📍 Address:</strong> ${optimal.formatted_address}</p>
                    ${optimal.rating ? `<p style="margin: 0 0 6px 0; font-size: 14px; color: #202124;"><strong style="color: #34a853;">⭐ Rating:</strong> ${optimal.rating}/5</p>` : ''}
                    <p style="margin: 0 0 6px 0; font-size: 14px; color: #202124;"><strong style="color: #34a853;">🚇 From A:</strong> ${Math.round(optimal.time_from_address1/60)} min</p>
                    <p style="margin: 0 0 6px 0; font-size: 14px; color: #202124;"><strong style="color: #34a853;">🚇 From B:</strong> ${Math.round(optimal.time_from_address2/60)} min</p>
                    <p style="margin: 0; font-size: 14px; color: #202124;"><strong style="color: #34a853;">⚖️ Difference:</strong> ${optimal.time_difference_minutes} min</p>
                </div>
            `
        });
        
        // Add unique identifier for debugging
        meetingPointInfoWindow._debugId = `meeting-point-${optimal.name}`;
        
        optimalMarker.addListener('click', (event) => {
            event.stop(); // Stop event propagation to map
            markerClickedRecently = true;
            setTimeout(() => { markerClickedRecently = false; }, 200);
            
            closeAllInfoWindows();
            meetingPointInfoWindow.open(map, optimalMarker);
            openInfoWindows.push(meetingPointInfoWindow);
        });

            // Render route sampling points if provided (robust path)
            try {
                const samples = data.route_sampling_points;
                if (Array.isArray(samples)) {
                    if (samples.length > 0) {
                        if (sampleMarkers.length === 0) {
                            console.log('[Sampling] (displayResultsOnMap) Rendering', samples.length, 'samples');
                            renderSampledPoints(samples, map, '#7b1fa2');
                        } else {
                            console.log('[Sampling] (displayResultsOnMap) Samples already rendered; skipping');
                        }
                    } else {
                        console.warn('[Sampling] (displayResultsOnMap) Empty samples; trying polyline fallback');
                        const poly = data.route && data.route.overview_polyline;
                        const pts = decodePolyline(poly);
                        if (pts && pts.length && sampleMarkers.length === 0) {
                            const step = Math.max(1, Math.floor(pts.length / 40));
                            const fallbackSamples = pts.filter((_, i) => i % step === 0);
                            renderSampledPoints(fallbackSamples.map(p => ({ lat: p.lat, lng: p.lng })), map, '#d50000');
                        }
                    }
                }
            } catch (e) {
                console.warn('[Sampling] (displayResultsOnMap) Failed to render samples:', e);
            }
    } else if (midpoint && typeof midpoint.lat === 'number' && typeof midpoint.lng === 'number') {
        // Fallback: show the midpoint as a marker and draw routes to it
        const midMarker = new google.maps.Marker({
            position: { lat: midpoint.lat, lng: midpoint.lng },
            map: map,
            title: `Midpoint ${labelSuffix ? '('+labelSuffix+')' : ''}`,
            icon: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 50 50">
                        <circle cx="25" cy="25" r="22" fill="${optimalColor}" stroke="white" stroke-width="4"/>
                        <text x="25" y="31" text-anchor="middle" fill="white" font-family="Arial" font-size="16" font-weight="bold">M</text>
                    </svg>
                `),
                scaledSize: new google.maps.Size(44, 44)
            }
        });
        markers.push(midMarker);

        displayRoutesWithRenderers(address1, address2, midpoint, renderers.A, renderers.B, colors.A, colors.B, labelSuffix);
    }
    
    // Display businesses within walking circles (only for primary/default to avoid clutter)
    if (showBusinesses) {
        displayBusinesses(categorizedBusinesses);
    }
}



// Update route information
function updateRouteInfo(elementId, routeData) {
    const existingElement = document.getElementById(elementId);
    if (existingElement) {
        existingElement.remove();
    }
    
    const routeInfo = document.createElement('div');
    routeInfo.id = elementId;
    routeInfo.className = 'route-info';
    routeInfo.innerHTML = `
        <strong>📍 From:</strong> ${routeData.from.substring(0, 40)}...<br>
        <strong>🎯 To:</strong> ${routeData.to}<br>
        <strong>⏱️ Duration:</strong> ${routeData.duration}<br>
        <strong>📏 Distance:</strong> ${routeData.distance}<br>
        <strong>🚇 Transit Steps:</strong> ${routeData.steps}
    `;
    
    document.getElementById('results').appendChild(routeInfo);
}

// Extract detailed transit information from a step
function getTransitDetails(step) {
    if (!step.transit) {
        // Non-transit step (walking, etc.)
        const travelMode = step.travel_mode || 'WALKING';
        return {
            icon: transportIcons[travelMode] || '🚶',
            details: '',
            shortName: '',
            headsign: '',
            agencyName: '',
            vehicleType: travelMode
        };
    }
    
    const transit = step.transit;
    const line = transit.line;
    const vehicle = line.vehicle;
    
    // Get vehicle type and icon
    const vehicleType = vehicle.type || 'BUS';
    const icon = transportIcons[vehicleType] || transportIcons['OTHER'];
    
    // Get line details
    const shortName = line.short_name || line.name || '';
    const longName = line.name || '';
    const agencyName = line.agencies && line.agencies[0] ? line.agencies[0].name : '';
    const headsign = transit.headsign || '';
    
    // Get stops
    const departureStop = transit.departure_stop ? transit.departure_stop.name : '';
    const arrivalStop = transit.arrival_stop ? transit.arrival_stop.name : '';
    
    // Build detailed description
    let details = '';
    if (shortName) {
        details += `${shortName}`;
        if (longName && longName !== shortName) {
            details += ` (${longName})`;
        }
    } else if (longName) {
        details += longName;
    }
    
    if (headsign) {
        details += ` towards ${headsign}`;
    }
    
    if (agencyName && !details.includes(agencyName)) {
        details += ` - ${agencyName}`;
    }
    
    return {
        icon,
        details,
        shortName,
        headsign,
        agencyName,
        vehicleType,
        departureStop,
        arrivalStop,
        departureTime: transit.departure_time ? transit.departure_time.text : '',
        arrivalTime: transit.arrival_time ? transit.arrival_time.text : '',
        numStops: transit.num_stops || 0
    };
}

// Format enhanced step instruction with transit details
function formatEnhancedInstruction(step) {
    const transitDetails = getTransitDetails(step);
    const baseInstruction = step.instructions.replace(/<[^>]*>/g, ''); // Remove HTML tags
    
    if (!step.transit) {
        // Walking or other non-transit steps
        return {
            icon: transitDetails.icon,
            instruction: baseInstruction,
            details: '',
            isTransit: false
        };
    }
    
    // Transit step - enhance with detailed information
    let enhancedInstruction = `${transitDetails.icon} `;
    
    if (transitDetails.details) {
        enhancedInstruction += `Take ${transitDetails.details}`;
    } else {
        enhancedInstruction += baseInstruction;
    }
    
    // Add stop information
    let stopDetails = '';
    if (transitDetails.departureStop && transitDetails.arrivalStop) {
        stopDetails += `From: ${transitDetails.departureStop} → To: ${transitDetails.arrivalStop}`;
        if (transitDetails.numStops > 0) {
            stopDetails += ` (${transitDetails.numStops} stops)`;
        }
    }
    
    // Add timing information
    let timeDetails = '';
    if (transitDetails.departureTime && transitDetails.arrivalTime) {
        timeDetails = `Depart: ${transitDetails.departureTime} → Arrive: ${transitDetails.arrivalTime}`;
    }
    
    return {
        icon: transitDetails.icon,
        instruction: enhancedInstruction,
        stopDetails,
        timeDetails,
        isTransit: true,
        vehicleType: transitDetails.vehicleType
    };
}

// Display businesses on the map
function displayBusinesses(businesses) {
    clearBusinessMarkers();
    
    if (!businesses) return;
    
    Object.entries(businesses).forEach(([category, places]) => {
        const icon = businessIcons[category] || '📍';
        const isVisible = isBusinessCategoryVisible(category);
        
        if (!isVisible) return;
        
        places.forEach((place, index) => {
            if (place.lat && place.lng) {
                const marker = new google.maps.Marker({
                    position: { lat: place.lat, lng: place.lng },
                    map: map,
                    title: `${place.name} (${category})`,
                    icon: {
                        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                            <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25">
                                <circle cx="12.5" cy="12.5" r="10" fill="#667eea" stroke="white" stroke-width="2"/>
                                <text x="12.5" y="16" text-anchor="middle" fill="white" font-family="Arial" font-size="8">${icon}</text>
                            </svg>
                        `),
                        scaledSize: new google.maps.Size(25, 25)
                    }
                });
                
                businessMarkers.push(marker);
                
                const businessInfoWindow = new google.maps.InfoWindow({
                    content: `
                        <div style="padding: 12px; max-width: 220px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                            <h5 style="margin: 0 0 8px 0; color: #667eea; font-size: 16px; font-weight: 600;">${icon} ${place.name}</h5>
                            <p style="margin: 0 0 6px 0; font-size: 13px; color: #202124;"><strong style="color: #667eea;">📂 Category:</strong> ${category.replace('_', ' ')}</p>
                            <p style="margin: 0 0 6px 0; font-size: 13px; color: #202124; line-height: 1.4;"><strong style="color: #667eea;">📍 Address:</strong> ${place.formatted_address || place.vicinity || 'N/A'}</p>
                            ${place.rating ? `<p style="margin: 0 0 6px 0; font-size: 13px; color: #202124;"><strong style="color: #667eea;">⭐ Rating:</strong> ${place.rating}/5 ⭐</p>` : ''}
                            ${place.price_level ? `<p style="margin: 0; font-size: 13px; color: #202124;"><strong style="color: #667eea;">💰 Price:</strong> ${'$'.repeat(place.price_level)}</p>` : ''}
                        </div>
                    `
                });
                
                // Add unique identifier for debugging
                businessInfoWindow._debugId = `business-${category}-${place.name}`;
                
                marker.addListener('click', (event) => {
                    event.stop(); // Stop event propagation to map
                    markerClickedRecently = true;
                    setTimeout(() => { markerClickedRecently = false; }, 200);
                    
                    closeAllInfoWindows();
                    businessInfoWindow.open(map, marker);
                    openInfoWindows.push(businessInfoWindow);
                });
            }
        });
    });
    
    updateBusinessCount();
}

// Check if a business category is currently visible based on filters
function isBusinessCategoryVisible(category) {
    const checkbox = document.querySelector(`input[value="${category}"]`);
    return checkbox ? checkbox.checked : true;
}

// Update business count display
function updateBusinessCount() {
    const totalBusinesses = businessMarkers.length;
    const countElement = document.querySelector('.business-count');
    if (countElement) {
        countElement.textContent = `Showing ${totalBusinesses} businesses`;
    }
}

// Apply filters function called by the Apply Filters button
function applyFilters() {
    if (categorizedBusinesses) {
        displayBusinesses(categorizedBusinesses);
    }
}

// Form submission
document.getElementById('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const address1 = document.getElementById('address1').value.trim();
    const address2 = document.getElementById('address2').value.trim();
    
    console.log('=== FRONTEND: Form submitted ===');
    console.log('Address 1:', address1);
    console.log('Address 2:', address2);
    
    if (!address1 || !address2) {
        console.log('ERROR: Missing addresses');
        alert('Please enter both addresses');
        return;
    }
    
    const loadingDiv = document.getElementById('loading');
    const resultsDiv = document.getElementById('results');
    const searchBtn = document.getElementById('searchBtn');
    
    // Show loading state
    loadingDiv.style.display = 'block';
    resultsDiv.innerHTML = '';
    searchBtn.disabled = true;
    searchBtn.textContent = '🔍 Analyzing...';
    
    // Clear previous results
    clearMarkers();
    clearRoutes();
    closeAllInfoWindows();
    clearRoutes();
    
    const requestData = {
        address1: address1,
        address2: address2,
        search_radius: 2000
    };
    
    console.log('Request data:', requestData);
    console.log('API URL:', `${API_BASE}/api/find-middle-point`);
    
    try {
        console.log('Sending requests for both algorithms in parallel...');
        const [respDefault, respRoute] = await Promise.all([
            fetch(`${API_BASE}/api/find-middle-point`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            }),
            fetch(`${API_BASE}/api/find-middle-point`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...requestData, algorithm: 'route-midpoint' })
            })
        ]);

        const [resDefault, resRoute] = await Promise.all([
            respDefault.json().catch(() => null),
            respRoute.json().catch(() => null)
        ]);

        const okDefault = respDefault.ok && resDefault && resDefault.success && resDefault.data;
        const okRoute = respRoute.ok && resRoute && resRoute.success && resRoute.data;

        // Only show a single error when both algorithms fail; no map overlays.
        if (!okDefault && !okRoute) {
            resultsDiv.innerHTML = `
                <div class="error">❌ Error: ${
                    (resDefault && resDefault.error) || (resRoute && resRoute.error) || 'Both algorithms failed'
                }</div>`;
            return;
        }

        // Render default first (blue/red), with businesses
        if (okDefault) {
            currentData = resDefault.data; // keep latest
            setTimeout(() => {
                displayResultsOnMap(resDefault.data, {
                    renderers: { A: directionsRenderer1, B: directionsRenderer2 },
                    colors: { A: '#4285f4', B: '#ea4335' },
                    labelSuffix: 'Default',
                    showBusinesses: true,
                    optimalColor: '#34a853'
                });
            }, 50);
        }

        // Then overlay route-midpoint (purple/green), without duplicating businesses
        if (okRoute) {
            setTimeout(() => {
                // Skip overlay entirely if the route algorithm didn't produce a polyline or samples
                const polyline = resRoute.data.route && resRoute.data.route.overview_polyline;
                const hasSamples = Array.isArray(resRoute.data.route_sampling_points) && resRoute.data.route_sampling_points.length > 0;
                if (!polyline && !hasSamples) {
                    console.log('[Route overlay] No polyline or samples; skipping overlay rendering.');
                    return;
                }
                displayResultsOnMap(resRoute.data, {
                    renderers: { A: directionsRendererAlt1, B: directionsRendererAlt2 },
                    colors: { A: '#9c27b0', B: '#0f9d58' },
                    labelSuffix: 'Route Midpoint',
                    showBusinesses: false,
                    optimalColor: '#fbbc05',
                    betweenColor: '#7b1fa2'
                });
                // Render sampled points from route algorithm
                if (resRoute.data.route_sampling_points) {
                    if (!resRoute.data.route_sampling_points.length) {
                        console.warn('[Sampling] route_sampling_points empty in API response');
                        // Fallback: generate sparse samples from overview polyline
                        try {
                            const poly = resRoute.data.route && resRoute.data.route.overview_polyline;
                            if (!poly) return; // no polyline to sample from
                            const pts = decodePolyline(poly);
                            if (pts && pts.length) {
                                const step = Math.max(1, Math.floor(pts.length / 40));
                                const fallbackSamples = pts.filter((_, i) => i % step === 0);
                                renderSampledPoints(fallbackSamples.map(p => ({ lat: p.lat, lng: p.lng })), map, '#d50000');
                            }
                        } catch (e) {
                            console.warn('[Sampling] Fallback sampling failed:', e);
                        }
                    } else {
                        console.log('[Sampling] Received', resRoute.data.route_sampling_points.length, 'sampling points from backend');
                        console.log('[Sampling] First sample point example:', resRoute.data.route_sampling_points[0]);
                        renderSampledPoints(resRoute.data.route_sampling_points, map, '#7b1fa2');
                        // Auto-fit bounds to include addresses and sampling points once (helps if markers off-screen)
                        try {
                            const bounds = new google.maps.LatLngBounds();
                            if (resRoute.data.address1 && resRoute.data.address1.geocoded)
                                bounds.extend(new google.maps.LatLng(resRoute.data.address1.geocoded.lat, resRoute.data.address1.geocoded.lng));
                            if (resRoute.data.address2 && resRoute.data.address2.geocoded)
                                bounds.extend(new google.maps.LatLng(resRoute.data.address2.geocoded.lat, resRoute.data.address2.geocoded.lng));
                            resRoute.data.route_sampling_points.slice(0, 200).forEach(pt => {
                                if (typeof pt.lat === 'number' && typeof pt.lng === 'number') {
                                    bounds.extend(new google.maps.LatLng(pt.lat, pt.lng));
                                }
                            });
                            map.fitBounds(bounds);
                        } catch (e) {
                            console.warn('[Sampling] Failed to fit bounds:', e);
                        }
                    }
                } else {
                    console.warn('[Sampling] route_sampling_points key missing in response');
                    // Fallback: decode route overview polyline and render sparse points
                    try {
                        const poly = resRoute.data.route && resRoute.data.route.overview_polyline;
                        if (!poly) return; // no polyline to sample from
                        const pts = decodePolyline(poly);
                        if (pts && pts.length) {
                            const step = Math.max(1, Math.floor(pts.length / 40));
                            const fallbackSamples = pts.filter((_, i) => i % step === 0);
                            renderSampledPoints(fallbackSamples.map(p => ({ lat: p.lat, lng: p.lng })), map, '#d50000');
                        }
                    } catch (e) {
                        console.warn('[Sampling] Polyline fallback failed:', e);
                    }
                }
            }, 100);
        }

        // Update results panel summary for both
        const summaries = [];
        if (okDefault && resDefault.data.optimal_meeting_point) {
            const mp = resDefault.data.optimal_meeting_point;
            summaries.push(`
                <div class="result-item">
                    <h4>🎯 Optimal (Default)</h4>
                    <strong>${mp.name}</strong><br>
                    📍 ${mp.formatted_address}<br>
                    ${mp.rating ? `⭐ ${mp.rating}/5<br>` : ''}
                    🚇 Travel times: ${Math.round(mp.time_from_address1/60)}min / ${Math.round(mp.time_from_address2/60)}min<br>
                    ⚖️ Difference: ${mp.time_difference_minutes} minutes
                </div>
            `);
        }
        if (okRoute && resRoute.data.optimal_meeting_point) {
            const mp2 = resRoute.data.optimal_meeting_point;
            summaries.push(`
                <div class="result-item">
                    <h4>🎯 Optimal (Route Midpoint)</h4>
                    <strong>${mp2.name}</strong><br>
                    📍 ${mp2.formatted_address}<br>
                    ${mp2.rating ? `⭐ ${mp2.rating}/5<br>` : ''}
                    🚇 Travel times: ${Math.round(mp2.time_from_address1/60)}min / ${Math.round(mp2.time_from_address2/60)}min<br>
                    ⚖️ Difference: ${mp2.time_difference_minutes} minutes
                </div>
            `);
        }
        // If route algorithm returned minimax metrics but no optimal place, still show a card for its point
        if (okRoute && !resRoute.data.optimal_meeting_point && resRoute.data.route_minimax_metrics && resRoute.data.route_midpoint) {
            const mm = resRoute.data.route_minimax_metrics;
            const pt = resRoute.data.route_midpoint;
            summaries.push(`
                <div class="result-item">
                    <h4>🎯 Minimax Point (Route)</h4>
                    <strong>Transit Route Point</strong><br>
                    📍 (${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)})<br>
                    🚇 Max travel time: ${mm.max_travel_time_minutes || (mm.max_travel_time_seconds ? Math.round(mm.max_travel_time_seconds/60) : '?')} min<br>
                    ⚖️ Difference: ${mm.time_difference_minutes || (mm.time_difference_seconds ? Math.round(mm.time_difference_seconds/60) : '?')} min
                </div>
            `);
        }
        if (summaries.length > 0) {
            resultsDiv.innerHTML = summaries.join('');
        } else {
            resultsDiv.innerHTML = `
                <div class="error">
                    ⚠️ Oops :( no meeting point was found.
                </div>
            `;
        }

    } catch (error) {
        console.error('CATCH BLOCK TRIGGERED:', error);
        console.error('Error stack:', error.stack);
        resultsDiv.innerHTML = `
            <div class="error">
                ❌ Network error: ${error.message}
            </div>
        `;
    } finally {
        console.log('Resetting UI state');
        loadingDiv.style.display = 'none';
        searchBtn.disabled = false;
        searchBtn.textContent = '🚇 Find Meeting Point';
        console.log('=== FRONTEND: Request completed ===');
    }
});
// Google Places Autocomplete variables
let autocomplete1, autocomplete2;

// Initialize Google Places Autocomplete for address inputs
function initializeAutocomplete() {
    console.log('🔍 Initializing Google Places Autocomplete...');
    
    const address1Input = document.getElementById('address1');
    const address2Input = document.getElementById('address2');
    
    if (!address1Input || !address2Input) {
        console.error('Address input fields not found');
        return;
    }
    
    // Configure autocomplete options
    const autocompleteOptions = {
        types: ['geocode'], // Restrict to addresses
        fields: ['formatted_address', 'geometry', 'name', 'place_id'],
        componentRestrictions: { country: [] } // Allow all countries
    };
    
    try {
        // Initialize autocomplete for Address 1
        autocomplete1 = new google.maps.places.Autocomplete(address1Input, autocompleteOptions);
        autocomplete1.addListener('place_changed', () => {
            handlePlaceSelection(autocomplete1, 'address1');
        });
        
        // Initialize autocomplete for Address 2
        autocomplete2 = new google.maps.places.Autocomplete(address2Input, autocompleteOptions);
        autocomplete2.addListener('place_changed', () => {
            handlePlaceSelection(autocomplete2, 'address2');
        });
        
        console.log('✅ Google Places Autocomplete initialized successfully');
        
        // Add styling for autocomplete dropdown
        addAutocompleteStyles();
        
    } catch (error) {
        console.error('❌ Failed to initialize Google Places Autocomplete:', error);
    }
}

// Handle place selection from autocomplete
function handlePlaceSelection(autocomplete, inputId) {
    console.log(`🏠 Place selected for ${inputId}`);
    
    const place = autocomplete.getPlace();
    const input = document.getElementById(inputId);
    
    if (!place || !place.geometry) {
        console.log('❌ No geometry data for selected place');
        return;
    }
    
    console.log(`✅ Selected place: ${place.formatted_address || place.name}`);
    
    // Update the input value with the formatted address
    if (input) {
        input.value = place.formatted_address || place.name;
    }
    
    // Store place data for potential future use
    input.dataset.placeId = place.place_id || '';
    input.dataset.lat = place.geometry.location.lat();
    input.dataset.lng = place.geometry.location.lng();
    
    // Update location status for address1 if it was changed from auto-detected location
    if (inputId === 'address1') {
        const locationStatus = document.getElementById('locationStatus');
        if (locationStatus) {
            locationStatus.textContent = '(selected from suggestions)';
            locationStatus.style.color = '#1a73e8';
        }
    }
    
    console.log(`📍 Place coordinates: ${place.geometry.location.lat()}, ${place.geometry.location.lng()}`);
}

// Add custom styles for autocomplete dropdown
function addAutocompleteStyles() {
    // Check if styles already added
    if (document.getElementById('autocomplete-styles')) {
        return;
    }
    
    const styles = document.createElement('style');
    styles.id = 'autocomplete-styles';
    styles.textContent = `
        /* Google Places Autocomplete styling */
        .pac-container {
            background-color: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            margin-top: 2px;
            max-width: none !important;
            z-index: 10000;
        }
        
        .pac-container:after {
            display: none;
        }
        
        .pac-item {
            padding: 12px 16px;
            border-bottom: 1px solid #f0f0f0;
            cursor: pointer;
            line-height: 1.4;
        }
        
        .pac-item:last-child {
            border-bottom: none;
        }
        
        .pac-item:hover {
            background-color: #f8f9fa;
        }
        
        .pac-item-selected {
            background-color: #e3f2fd !important;
        }
        
        .pac-matched {
            font-weight: 600;
            color: #1a73e8;
        }
        
        .pac-item-query {
            color: #333;
            font-size: 14px;
        }
        
        .pac-secondary-text {
            color: #666;
            font-size: 12px;
            margin-top: 2px;
        }
        
        .pac-icon {
            background-image: none;
            background-size: 16px 16px;
            height: 16px;
            width: 16px;
            margin-right: 12px;
            margin-top: 2px;
        }
        
        .pac-icon-marker {
            background-color: #4285f4;
            border-radius: 50%;
            position: relative;
        }
        
        .pac-icon-marker:after {
            content: "📍";
            position: absolute;
            top: -2px;
            left: 2px;
            font-size: 12px;
        }
    `;
    
    document.head.appendChild(styles);
    console.log('✅ Autocomplete styles added');
}

// Enhanced input field setup with autocomplete hints
function setupInputFieldEnhancements() {
    const address1Input = document.getElementById('address1');
    const address2Input = document.getElementById('address2');
    
    if (address1Input) {
        // Add focus/blur handlers for better UX
        address1Input.addEventListener('focus', () => {
            console.log('📝 Address 1 input focused');
            if (address1Input.value === '' || address1Input.value === 'Times Square, New York, NY') {
                // Clear default value when user starts typing
                if (address1Input.value === 'Times Square, New York, NY') {
                    address1Input.value = '';
                }
            }
        });
        
        address1Input.addEventListener('input', () => {
            // Clear stored place data when user manually types
            delete address1Input.dataset.placeId;
            delete address1Input.dataset.lat;
            delete address1Input.dataset.lng;
        });
    }
    
    if (address2Input) {
        address2Input.addEventListener('focus', () => {
            console.log('📝 Address 2 input focused');
        });
        
        address2Input.addEventListener('input', () => {
            // Clear stored place data when user manually types
            delete address2Input.dataset.placeId;
            delete address2Input.dataset.lat;
            delete address2Input.dataset.lng;
        });
    }
}

// Geolocation functionality for preloading current address
async function getCurrentLocationAndAddress() {
    console.log('🌍 Attempting to get user location...');
    
    const locationStatus = document.getElementById('locationStatus');
    const address1Input = document.getElementById('address1');
    
    if (locationStatus) {
        locationStatus.textContent = '(detecting...)';
        locationStatus.style.color = '#666';
    }
    
    if (!navigator.geolocation) {
        console.log('❌ Geolocation not supported by this browser');
        if (locationStatus) {
            locationStatus.textContent = '(location not supported)';
            locationStatus.style.color = '#ff6b6b';
        }
        setDefaultAddress();
        return;
    }
    
    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                resolve,
                reject,
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000 // 5 minutes
                }
            );
        });
        
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        console.log(`📍 Got user location: ${lat}, ${lng}`);
        
        if (locationStatus) {
            locationStatus.textContent = '(loading address...)';
        }
        
        // Reverse geocode to get address
        await reverseGeocodeAndSetAddress(lat, lng);
        
    } catch (error) {
        console.log('❌ Geolocation error:', error.message);
        console.log('🔄 Falling back to default address');
        
        if (locationStatus) {
            locationStatus.textContent = '(location denied)';
            locationStatus.style.color = '#ff6b6b';
        }
        
        setDefaultAddress();
    }
}

// Reverse geocode coordinates to address using Google Maps API
async function reverseGeocodeAndSetAddress(lat, lng) {
    try {
        const geocoder = new google.maps.Geocoder();
        const latlng = { lat: lat, lng: lng };
        
        const result = await new Promise((resolve, reject) => {
            geocoder.geocode({ location: latlng }, (results, status) => {
                if (status === 'OK') {
                    resolve(results);
                } else {
                    reject(new Error(`Geocoding failed: ${status}`));
                }
            });
        });
        
        if (result && result.length > 0) {
            const address = result[0].formatted_address;
            console.log(`📍 Reverse geocoded address: ${address}`);
            
            // Set the address in the input field
            const address1Input = document.getElementById('address1');
            const locationStatus = document.getElementById('locationStatus');
            
            if (address1Input) {
                address1Input.value = address;
                address1Input.placeholder = 'Current location detected';
                console.log('✅ Current address loaded into Address 1 field');
            }
            
            if (locationStatus) {
                locationStatus.textContent = '(current location)';
                locationStatus.style.color = '#34a853';
            }
        } else {
            console.log('❌ No address found for coordinates');
            setDefaultAddress();
        }
    } catch (error) {
        console.error('❌ Reverse geocoding error:', error);
        setDefaultAddress();
    }
}

// Set a default address when geolocation fails
function setDefaultAddress() {
    console.log('🏠 Setting default address for Address 1');
    const address1Input = document.getElementById('address1');
    const locationStatus = document.getElementById('locationStatus');
    
    if (address1Input) {
        // Use a popular default location (Times Square, NYC)
        address1Input.value = 'Times Square, New York, NY';
        address1Input.placeholder = 'Start typing for suggestions...';
        console.log('✅ Default address set');
    }
    
    if (locationStatus) {
        locationStatus.textContent = '(default location)';
        locationStatus.style.color = '#ff9500';
    }
}

// Initialize geolocation when maps are ready
function initializeLocationDetection() {
    console.log('🚀 Initializing location detection...');
    
    // Wait a bit for the page to fully load
    setTimeout(() => {
        getCurrentLocationAndAddress();
    }, 1000);
}

// Optimized POI content creation function
function createPOIContent(place) {
    const name = place.name || 'Unknown Place';
    const address = place.formatted_address || 'N/A';
    const rating = place.rating;
    const totalRatings = place.user_ratings_total || 0;
    const type = place.types && place.types[0] ? place.types[0].replace(/_/g, ' ') : null;
    const website = place.website;
    
    // Pre-build content sections for better performance
    const sections = [
        `<h4 style="margin: 0 0 10px 0; color: #1a73e8; font-size: 16px; font-weight: 600;">🏛️ ${name}</h4>`,
        `<p style="margin: 0 0 6px 0; font-size: 14px; color: #202124; line-height: 1.4;"><strong style="color: #1a73e8;">📍 Address:</strong> ${address}</p>`
    ];
    
    if (rating) {
        sections.push(`<p style="margin: 0 0 6px 0; font-size: 14px; color: #202124;"><strong style="color: #1a73e8;">⭐ Rating:</strong> ${rating}/5 (${totalRatings} reviews)</p>`);
    }
    
    if (type) {
        sections.push(`<p style="margin: 0 0 6px 0; font-size: 14px; color: #202124;"><strong style="color: #1a73e8;">🏷️ Type:</strong> ${type}</p>`);
    }
    
    if (website) {
        sections.push(`<p style="margin: 0; font-size: 14px; color: #202124;"><strong style="color: #1a73e8;">🌐 Website:</strong> <a href="${website}" target="_blank" style="color: #1a73e8; text-decoration: none;">Visit</a></p>`);
    }
    
    return `
        <div style="padding: 12px; max-width: 280px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            ${sections.join('')}
        </div>
    `;
}

// Ensure the callback is globally accessible for Google Maps async loader
window.initMaps = initMaps;
