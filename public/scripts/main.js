const API_BASE = 'http://localhost:5001';
let map;
let directionsService;
let directionsRenderer1, directionsRenderer2;
let currentData = null;
let markers = [];
let businessMarkers = [];
let openInfoWindows = [];
let routes = [];
let categorizedBusinesses = {};
let routeClickedRecently = false;
let markerClickedRecently = false;

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
        if (currentTime - lastMapClickTime < 100) {
            return;
        }
        lastMapClickTime = currentTime;
        
        console.log('🗺️ Map click detected!');
        console.log('  - event.placeId:', event.placeId);
        console.log('  - routeClickedRecently:', routeClickedRecently);
        console.log('  - markerClickedRecently:', markerClickedRecently);
        console.log('  - openInfoWindows.length:', openInfoWindows.length);
        console.log('  - openInfoWindows IDs:', openInfoWindows.map(w => w._debugId || 'no-id'));
        
        // Handle POI clicks - prevent default and create our own InfoWindow
        if (event.placeId) {
            console.log('🏛️ POI clicked with placeId:', event.placeId);
            
            // Prevent Google's default InfoWindow from opening
            event.stop();
            
            markerClickedRecently = true;
            setTimeout(() => { markerClickedRecently = false; }, 200);
            
            // Close our existing InfoWindows first
            closeAllInfoWindows();
            
            // Create our own POI InfoWindow using Places service
            const service = new google.maps.places.PlacesService(map);
            service.getDetails({
                placeId: event.placeId,
                fields: ['name', 'formatted_address', 'rating', 'user_ratings_total', 'types', 'website']
            }, (place, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK && place) {
                    const poiInfoWindow = new google.maps.InfoWindow({
                        content: `
                            <div style="padding: 10px; max-width: 250px;">
                                <h4 style="margin: 0 0 8px 0; color: #1a73e8;">🏛️ ${place.name}</h4>
                                <p style="margin: 0 0 5px 0; font-size: 13px;"><strong>📍 Address:</strong> ${place.formatted_address || 'N/A'}</p>
                                ${place.rating ? `<p style="margin: 0 0 5px 0; font-size: 13px;"><strong>⭐ Rating:</strong> ${place.rating}/5 (${place.user_ratings_total || 0} reviews)</p>` : ''}
                                ${place.types ? `<p style="margin: 0 0 5px 0; font-size: 13px;"><strong>🏷️ Type:</strong> ${place.types[0].replace(/_/g, ' ')}</p>` : ''}
                                ${place.website ? `<p style="margin: 0; font-size: 13px;"><strong>🌐 Website:</strong> <a href="${place.website}" target="_blank">Visit</a></p>` : ''}
                            </div>
                        `,
                        position: event.latLng
                    });
                    
                    // Add debug ID and track it
                    poiInfoWindow._debugId = `poi-${event.placeId}`;
                    poiInfoWindow.open(map);
                    openInfoWindows.push(poiInfoWindow);
                    
                    console.log('📋 Created custom POI InfoWindow:', poiInfoWindow._debugId);
                    console.log('📋 Current openInfoWindows:', openInfoWindows.length);
                } else {
                    console.error('Failed to get place details:', status);
                }
            });
            
            return;
        }
        
        // Handle regular map clicks (empty space)
        if (!routeClickedRecently && !markerClickedRecently) {
            console.log('✅ Closing all InfoWindows due to empty map click');
            closeAllInfoWindows();
            console.log('  - After closing, openInfoWindows.length:', openInfoWindows.length);
        } else {
            console.log('❌ Not closing popups:', {
                routeClickedRecently,
                markerClickedRecently,
                openInfoWindowsCount: openInfoWindows.length
            });
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
    
    checkApiStatus();
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
}

// Clear business markers specifically
function clearBusinessMarkers() {
    console.log('🧹 Clearing business markers. Current openInfoWindows:', openInfoWindows.length);
    
    // Close and remove any business-related InfoWindows from tracking
    const businessInfoWindows = openInfoWindows.filter(w => w._debugId && w._debugId.startsWith('business-'));
    businessInfoWindows.forEach(infoWindow => {
        console.log('🧹 Closing business InfoWindow:', infoWindow._debugId);
        infoWindow.close();
    });
    
    // Remove business InfoWindows from the tracking array
    openInfoWindows = openInfoWindows.filter(w => !w._debugId || !w._debugId.startsWith('business-'));
    
    // Clear the actual markers
    businessMarkers.forEach(marker => marker.setMap(null));
    businessMarkers = [];
    
    console.log('🧹 After clearing business markers. Remaining openInfoWindows:', openInfoWindows.length);
    console.log('🧹 Remaining openInfoWindows IDs:', openInfoWindows.map(w => w._debugId || 'no-id'));
}

// Clear all info windows
function closeAllInfoWindows() {
    openInfoWindows.forEach(infoWindow => {
        infoWindow.close();
    });
    openInfoWindows = [];
}

// Make function available globally for button clicks
window.closeAllInfoWindows = closeAllInfoWindows;

// Display routes from both addresses to the meeting point
function displayRoutes(address1, address2, meetingPoint) {
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
            directionsRenderer1.setMap(map);
            directionsRenderer1.setDirections(result);
            console.log('Route 1 displayed successfully');
            
            // Add click listener to route 1
            setTimeout(() => {
                try {
                    const route = result.routes[0];
                    addRouteClickListener(directionsRenderer1, route, 'Route from Address A', '#4285f4');
                } catch (e) {
                    console.error('Error adding click listener to route 1:', e);
                }
            }, 500);
        } else {
            console.error('Route 1 request failed:', status);
            // Try driving mode as fallback
            console.log('Trying driving mode for route 1...');
            directionsService.route({
                origin: { lat: address1.lat, lng: address1.lng },
                destination: { lat: meetingPoint.lat, lng: meetingPoint.lng },
                travelMode: google.maps.TravelMode.DRIVING
            }, (result2, status2) => {
                console.log('Route 1 driving fallback response:', status2, result2);
                if (status2 === 'OK') {
                    directionsRenderer1.setMap(map);
                    directionsRenderer1.setDirections(result2);
                    console.log('Route 1 displayed with driving mode');
                    
                    // Add click listener
                    setTimeout(() => {
                        try {
                            const route = result2.routes[0];
                            addRouteClickListener(directionsRenderer1, route, 'Route from Address A (Driving)', '#4285f4');
                        } catch (e) {
                            console.error('Error adding click listener to route 1 (driving):', e);
                        }
                    }, 500);
                } else {
                    console.error('Route 1 driving mode also failed:', status2);
                }
            });
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
            directionsRenderer2.setMap(map);
            directionsRenderer2.setDirections(result);
            console.log('Route 2 displayed successfully');
            
            // Add click listener to route 2
            setTimeout(() => {
                try {
                    const route = result.routes[0];
                    addRouteClickListener(directionsRenderer2, route, 'Route from Address B', '#ea4335');
                } catch (e) {
                    console.error('Error adding click listener to route 2:', e);
                }
            }, 500);
        } else {
            console.error('Route 2 request failed:', status);
            // Try driving mode as fallback
            console.log('Trying driving mode for route 2...');
            directionsService.route({
                origin: { lat: address2.lat, lng: address2.lng },
                destination: { lat: meetingPoint.lat, lng: meetingPoint.lng },
                travelMode: google.maps.TravelMode.DRIVING
            }, (result2, status2) => {
                console.log('Route 2 driving fallback response:', status2, result2);
                if (status2 === 'OK') {
                    directionsRenderer2.setMap(map);
                    directionsRenderer2.setDirections(result2);
                    console.log('Route 2 displayed with driving mode');
                    
                    // Add click listener
                    setTimeout(() => {
                        try {
                            const route = result2.routes[0];
                            addRouteClickListener(directionsRenderer2, route, 'Route from Address B (Driving)', '#ea4335');
                        } catch (e) {
                            console.error('Error adding click listener to route 2 (driving):', e);
                        }
                    }, 500);
                } else {
                    console.error('Route 2 driving mode also failed:', status2);
                }
            });
        }
    });
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
        <div style="font-family: Arial, sans-serif; max-width: 350px;">
            <h3 style="margin: 0 0 10px 0; color: ${color}; font-size: 16px;">
                ${routeName}
            </h3>
    `;
    
    const legs = route.legs;
    let totalDistance = 0;
    let totalDuration = 0;
    
    // Calculate totals
    legs.forEach(leg => {
        totalDistance += leg.distance.value;
        totalDuration += leg.duration.value;
    });
    
    content += `
        <div style="background: #f5f5f5; padding: 8px; border-radius: 4px; margin-bottom: 10px;">
            <strong>Total Distance:</strong> ${(totalDistance / 1000).toFixed(1)} km<br>
            <strong>Total Duration:</strong> ${Math.round(totalDuration / 60)} minutes
        </div>
        <div style="max-height: 200px; overflow-y: auto;">
    `;
    
    // Add step-by-step instructions
    legs.forEach((leg, legIndex) => {
        if (legs.length > 1) {
            content += `<h4 style="margin: 10px 0 5px 0; color: #666;">Leg ${legIndex + 1}</h4>`;
        }
        
        leg.steps.forEach((step, stepIndex) => {
            const instruction = step.instructions.replace(/<[^>]*>/g, ''); // Remove HTML tags
            const distance = step.distance.text;
            const duration = step.duration.text;
            
            content += `
                <div style="margin-bottom: 8px; padding: 6px; border-left: 3px solid ${color}; background: #fafafa;">
                    <div style="font-size: 13px; margin-bottom: 2px;">
                        ${instruction}
                    </div>
                    <div style="font-size: 11px; color: #666;">
                        ${distance} • ${duration}
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

// Display results on map
function displayResultsOnMap(data) {
    console.log('displayResultsOnMap called with data:', data);
    
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
        midpoint = data.geographic_midpoint;
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
    
    // Center map on midpoint
    const center = { lat: midpoint.lat, lng: midpoint.lng };
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
            title: `Optimal Meeting Point: ${optimal.name}`,
            icon: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">
                        <circle cx="25" cy="25" r="22" fill="#34a853" stroke="white" stroke-width="4"/>
                        <text x="25" y="31" text-anchor="middle" fill="white" font-family="Arial" font-size="20" font-weight="bold">★</text>
                    </svg>
                `),
                scaledSize: new google.maps.Size(50, 50)
            }
        });
        markers.push(optimalMarker);
        
        // Display routes from both addresses to the optimal meeting point
        displayRoutes(address1, address2, optimal);
        
        // Add info window for optimal point
        const meetingPointInfoWindow = new google.maps.InfoWindow({
            content: `
                <div style="padding: 10px; max-width: 250px;">
                    <h4 style="margin: 0 0 8px 0; color: #34a853;">🎯 ${optimal.name}</h4>
                    <p style="margin: 0 0 5px 0; font-size: 13px;"><strong>📍 Address:</strong> ${optimal.formatted_address}</p>
                    ${optimal.rating ? `<p style="margin: 0 0 5px 0; font-size: 13px;"><strong>⭐ Rating:</strong> ${optimal.rating}/5</p>` : ''}
                    <p style="margin: 0 0 5px 0; font-size: 13px;"><strong>🚇 From A:</strong> ${Math.round(optimal.time_from_address1/60)} min</p>
                    <p style="margin: 0 0 5px 0; font-size: 13px;"><strong>🚇 From B:</strong> ${Math.round(optimal.time_from_address2/60)} min</p>
                    <p style="margin: 0; font-size: 13px;"><strong>⚖️ Difference:</strong> ${optimal.time_difference_minutes} min</p>
                </div>
            `
        });
        
        // Add unique identifier for debugging
        meetingPointInfoWindow._debugId = `meeting-point-${optimal.name}`;
        
        optimalMarker.addListener('click', (event) => {
            console.log('🎯 Meeting point marker clicked:', optimal.name);
            console.log('🔍 MeetingPointInfoWindow ID:', meetingPointInfoWindow._debugId);
            event.stop(); // Stop event propagation to map
            markerClickedRecently = true;
            setTimeout(() => { markerClickedRecently = false; }, 200);
            
            console.log('📋 Before opening meeting point popup, openInfoWindows:', openInfoWindows.length);
            console.log('📋 Current openInfoWindows IDs:', openInfoWindows.map(w => w._debugId || 'no-id'));
            closeAllInfoWindows();
            console.log('📋 After closeAllInfoWindows, openInfoWindows:', openInfoWindows.length);
            meetingPointInfoWindow.open(map, optimalMarker);
            openInfoWindows.push(meetingPointInfoWindow);
            console.log('📋 After opening meeting point popup, openInfoWindows:', openInfoWindows.length);
            console.log('📋 New openInfoWindows IDs:', openInfoWindows.map(w => w._debugId || 'no-id'));
        });
    }
    
    // Display businesses within walking circles
    displayBusinesses(categorizedBusinesses);
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
                        <div style="padding: 8px; max-width: 200px;">
                            <h5 style="margin: 0 0 5px 0; color: #667eea;">${icon} ${place.name}</h5>
                            <p style="margin: 0 0 5px 0; font-size: 12px;"><strong>Category:</strong> ${category.replace('_', ' ')}</p>
                            <p style="margin: 0 0 5px 0; font-size: 12px;"><strong>Address:</strong> ${place.formatted_address || place.vicinity || 'N/A'}</p>
                            ${place.rating ? `<p style="margin: 0 0 5px 0; font-size: 12px;"><strong>Rating:</strong> ${place.rating}/5 ⭐</p>` : ''}
                            ${place.price_level ? `<p style="margin: 0; font-size: 12px;"><strong>Price:</strong> ${'$'.repeat(place.price_level)}</p>` : ''}
                        </div>
                    `
                });
                
                // Add unique identifier for debugging
                businessInfoWindow._debugId = `business-${category}-${place.name}`;
                
                marker.addListener('click', (event) => {
                    console.log('🏪 Business marker clicked:', place.name);
                    console.log('🔍 BusinessInfoWindow ID:', businessInfoWindow._debugId);
                    event.stop(); // Stop event propagation to map
                    markerClickedRecently = true;
                    setTimeout(() => { 
                        markerClickedRecently = false;
                        console.log('⏰ markerClickedRecently flag reset');
                    }, 200);
                    
                    console.log('📋 Before opening business popup, openInfoWindows:', openInfoWindows.length);
                    console.log('📋 Current openInfoWindows IDs:', openInfoWindows.map(w => w._debugId || 'no-id'));
                    closeAllInfoWindows();
                    console.log('📋 After closeAllInfoWindows, openInfoWindows:', openInfoWindows.length);
                    businessInfoWindow.open(map, marker);
                    openInfoWindows.push(businessInfoWindow);
                    console.log('📋 After opening business popup, openInfoWindows:', openInfoWindows.length);
                    console.log('📋 New openInfoWindows IDs:', openInfoWindows.map(w => w._debugId || 'no-id'));
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
        search_radius: 2000  // Fixed radius since we're not using the input anymore
    };
    
    console.log('Request data:', requestData);
    console.log('API URL:', `${API_BASE}/api/find-middle-point`);
    
    try {
        console.log('Sending request...');
        const response = await fetch(`${API_BASE}/api/find-middle-point`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });
        
        console.log('Response received:', response.status, response.statusText);
        
        let result;
        try {
            result = await response.json();
        } catch (parseError) {
            console.error('Failed to parse JSON response:', parseError);
            throw new Error('Invalid JSON response from server');
        }
        
        console.log('Full API response:', JSON.stringify(result, null, 2));
        
        if (response.ok && result && result.success) {
            console.log('SUCCESS: Request completed successfully');
            console.log('Result data structure:', JSON.stringify(result.data, null, 2));
            
            // Validate the data structure before proceeding
            if (!result.data) {
                console.error('No data in successful response');
                resultsDiv.innerHTML = `
                    <div class="error">
                        ❌ Error: No data returned from server
                    </div>
                `;
                return;
            }
            
            currentData = result.data;
            
            // Add a small delay to ensure DOM is ready
            setTimeout(() => {
                displayResultsOnMap(result.data);
            }, 100);
            
            const optimal = result.data.optimal_meeting_point;
            if (optimal) {
                resultsDiv.innerHTML = `
                    <div class="result-item">
                        <h4>🎯 Optimal Meeting Point</h4>
                        <strong>${optimal.name}</strong><br>
                        📍 ${optimal.formatted_address}<br>
                        ${optimal.rating ? `⭐ ${optimal.rating}/5<br>` : ''}
                        🚇 Travel times: ${Math.round(optimal.time_from_address1/60)}min / ${Math.round(optimal.time_from_address2/60)}min<br>
                        ⚖️ Difference: ${optimal.time_difference_minutes} minutes
                    </div>
                `;
            }
        } else {
            console.log('ERROR: Request failed with result:', result);
            resultsDiv.innerHTML = `
                <div class="error">
                    ❌ Error: ${result.error || 'Unknown error occurred'}
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

// Helper function to find DirectionsRenderer polylines on the map
function findDirectionsPolylines(map, targetColor) {
    const foundPolylines = [];
    
    // This is a workaround since Google Maps doesn't expose DirectionsRenderer polylines directly
    // We'll search through the map's overlays to find polylines that match our route colors
    try {
        // Get all overlays from the map
        const overlays = [];
        
        // Try to access the map's internal structure (this is hacky but necessary)
        // Look for polylines with matching colors
        const mapDiv = map.getDiv();
        if (mapDiv) {
            // Search for SVG polylines in the DOM that match our route colors
            const svgElements = mapDiv.querySelectorAll('svg path[stroke]');
            svgElements.forEach((path) => {
                const stroke = path.getAttribute('stroke');
                if (stroke && (stroke.includes(targetColor) || 
                    (targetColor === '#4285f4' && (stroke.includes('rgb(66, 133, 244)') || stroke.includes('#4285f4'))) ||
                    (targetColor === '#ea4335' && (stroke.includes('rgb(234, 67, 53)') || stroke.includes('#ea4335'))))) {
                    console.log('Found matching SVG path element for color:', targetColor);
                    // This approach would require creating polylines from SVG paths
                    // which is complex, so we'll use a different approach
                }
            });
        }
        
        // Alternative approach: Use reflection to access internal polylines
        // This is not guaranteed to work across all Google Maps versions
        if (map.__gm && map.__gm.overlayLayer) {
            // Try to access overlays through internal API
            console.log('Attempting to access internal overlays...');
        }
        
    } catch (error) {
        console.error('Error finding DirectionsRenderer polylines:', error);
    }
    
    return foundPolylines;
}

// Fallback approach when we can't access actual polylines
function addFallbackClickDetection(renderer, route, routeName, color, infoWindow) {
    console.log('Using fallback click detection for:', routeName);
    
    try {
        // Create a custom polyline for click detection using overview_path
        let routePath = [];
        
        // Try to get path from overview_polyline first
        if (route.overview_polyline && route.overview_polyline.points) {
            try {
                if (typeof google.maps.geometry === 'undefined' || typeof google.maps.geometry.encoding === 'undefined') {
                    console.error('Google Maps geometry library not loaded!');
                    throw new Error('Geometry library not available');
                }
                const decodedPath = google.maps.geometry.encoding.decodePath(route.overview_polyline.points);
                routePath = decodedPath;
                console.log('Successfully decoded', decodedPath.length, 'points from overview polyline');
            } catch (error) {
                console.error('Error decoding overview polyline:', error);
                routePath = [];
            }
        }
        
        if (routePath.length === 0) {
            // Fallback: build path from legs and steps
            console.log('Building path from route steps for:', routeName);
            route.legs.forEach((leg, legIndex) => {
                leg.steps.forEach((step, stepIndex) => {
                    if (step.start_location) {
                        routePath.push(new google.maps.LatLng(
                            step.start_location.lat(), 
                            step.start_location.lng()
                        ));
                    }
                    if (step.end_location) {
                        routePath.push(new google.maps.LatLng(
                            step.end_location.lat(), 
                            step.end_location.lng()
                        ));
                    }
                });
            });
        }
        
        if (routePath.length === 0) {
            console.error('No route path found for fallback detection:', routeName);
            return;
        }
        
        // FALLBACK: Add map click listener that checks if click is near the route
        const mapClickListener = google.maps.event.addListener(map, 'click', (event) => {
            // Check if click is near this route
            if (isClickNearRoute(event.latLng, routePath, 20)) { // 20 meter tolerance
                console.log('🎯 Fallback: Map click detected near route:', routeName);
                showRouteInstructions(infoWindow, route, routeName, color, event.latLng);
            }
        });
        
        // Store references for cleanup
        routes.push({ 
            renderer, 
            mapListener: mapClickListener,
            infoWindow,
            routePath: routePath,
            isFallback: true
        });
        
        console.log('Fallback click detection added for:', routeName);
        
    } catch (error) {
        console.error('Error in fallback click detection:', error);
    }
}

// Make functions globally available for the HTML
window.closeAllInfoWindows = closeAllInfoWindows;
window.applyFilters = applyFilters;
