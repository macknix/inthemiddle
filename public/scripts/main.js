const API_BASE = 'http://localhost:5001';
let map, map1, map2;
let directionsService, directionsRenderer1, directionsRenderer2;
let currentData = null;
let markers = [];
let businessMarkers = [];
let openInfoWindows = [];
let walkingCircles = [];
let categorizedBusinesses = {};

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
    // Main overview map
    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 13,
        center: { lat: 40.7128, lng: -74.0060 }, // Default to NYC
        mapTypeId: 'roadmap'
    });
    
    // Route maps
    map1 = new google.maps.Map(document.getElementById('mapRoute1'), {
        zoom: 13,
        center: { lat: 40.7128, lng: -74.0060 },
        mapTypeId: 'roadmap'
    });
    
    map2 = new google.maps.Map(document.getElementById('mapRoute2'), {
        zoom: 13,
        center: { lat: 40.7128, lng: -74.0060 },
        mapTypeId: 'roadmap'
    });
    
    // Initialize directions service
    directionsService = new google.maps.DirectionsService();
    directionsRenderer1 = new google.maps.DirectionsRenderer({
        map: map1,
        polylineOptions: {
            strokeColor: '#4285f4',
            strokeWeight: 6
        }
    });
    directionsRenderer2 = new google.maps.DirectionsRenderer({
        map: map2,
        polylineOptions: {
            strokeColor: '#ea4335',
            strokeWeight: 6
        }
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
    businessMarkers.forEach(marker => marker.setMap(null));
    businessMarkers = [];
}

// Clear all info windows
function closeAllInfoWindows() {
    openInfoWindows.forEach(infoWindow => {
        infoWindow.close();
    });
    openInfoWindows = [];
}

// Clear walking distance circles
function clearWalkingCircles() {
    walkingCircles.forEach(circle => {
        circle.setMap(null);
    });
    walkingCircles = [];
}

// Create walking distance circles around a point
function createWalkingCircles(center) {
    // Average walking speed is about 80 meters per minute
    const walkingSpeed = 80; // meters per minute
    
    const circles = [
        { time: 5, color: '#4caf50', radius: 5 * walkingSpeed },   // 5 min = ~400m
        { time: 10, color: '#ffc107', radius: 10 * walkingSpeed }, // 10 min = ~800m
        { time: 15, color: '#f44336', radius: 15 * walkingSpeed }  // 15 min = ~1200m
    ];
    
    circles.forEach(circleConfig => {
        const circle = new google.maps.Circle({
            strokeColor: circleConfig.color,
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: circleConfig.color,
            fillOpacity: 0.15,
            map: map,
            center: center,
            radius: circleConfig.radius
        });
        
        walkingCircles.push(circle);
    });
}

// Clear all routes from the route maps
function clearRoutes() {
    if (directionsRenderer1) {
        directionsRenderer1.setDirections({routes: []});
    }
    if (directionsRenderer2) {
        directionsRenderer2.setDirections({routes: []});
    }
}

// Display results on map
function displayResultsOnMap(data) {
    // Clear previous markers and info windows first
    clearMarkers();
    clearBusinessMarkers();
    closeAllInfoWindows();
    clearWalkingCircles();
    
    // Store business data for filtering
    categorizedBusinesses = data.categorized_businesses || {};
    
    const address1 = data.address1.geocoded;
    const address2 = data.address2.geocoded;
    const midpoint = data.geographic_midpoint;
    const optimal = data.optimal_meeting_point;
    
    // Center map on midpoint
    const center = { lat: midpoint.lat, lng: midpoint.lng };
    map.setCenter(center);
    map.setZoom(14);
    
    // Add click listener to map to close info windows when clicking on empty space
    map.addListener('click', () => {
        closeAllInfoWindows();
    });
    
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
        
        // Create walking distance circles around the optimal meeting point
        createWalkingCircles({ lat: optimal.lat, lng: optimal.lng });
        
        // Add info window for optimal point
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="padding: 10px; max-width: 250px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h4 style="margin: 0; color: #34a853;">🎯 ${optimal.name}</h4>
                        <button onclick="closeAllInfoWindows()" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #666;">×</button>
                    </div>
                    <p style="margin: 0 0 5px 0; font-size: 13px;"><strong>📍 Address:</strong> ${optimal.formatted_address}</p>
                    ${optimal.rating ? `<p style="margin: 0 0 5px 0; font-size: 13px;"><strong>⭐ Rating:</strong> ${optimal.rating}/5</p>` : ''}
                    <p style="margin: 0 0 5px 0; font-size: 13px;"><strong>🚇 From A:</strong> ${Math.round(optimal.time_from_address1/60)} min</p>
                    <p style="margin: 0 0 5px 0; font-size: 13px;"><strong>🚇 From B:</strong> ${Math.round(optimal.time_from_address2/60)} min</p>
                    <p style="margin: 0; font-size: 13px;"><strong>⚖️ Difference:</strong> ${optimal.time_difference_minutes} min</p>
                </div>
            `
        });
        openInfoWindows.push(infoWindow);
        
        optimalMarker.addListener('click', () => {
            closeAllInfoWindows();
            infoWindow.open(map, optimalMarker);
            openInfoWindows.push(infoWindow);
        });
    }
    
    // Show alternative meeting points as smaller markers
    if (data.nearby_alternatives) {
        data.nearby_alternatives.slice(0, 5).forEach((alt, index) => {
            if (alt.lat && alt.lng && alt.name !== optimal?.name) {
                const altMarker = new google.maps.Marker({
                    position: { lat: alt.lat, lng: alt.lng },
                    map: map,
                    title: `Alternative: ${alt.name}`,
                    icon: {
                        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
                                <circle cx="15" cy="15" r="12" fill="#ffc107" stroke="white" stroke-width="2"/>
                                <text x="15" y="19" text-anchor="middle" fill="white" font-family="Arial" font-size="10" font-weight="bold">${index + 2}</text>
                            </svg>
                        `),
                        scaledSize: new google.maps.Size(30, 30)
                    }
                });
                markers.push(altMarker);
                
                const altInfoWindow = new google.maps.InfoWindow({
                    content: `
                        <div style="padding: 8px; max-width: 200px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                <h5 style="margin: 0; color: #ffc107;">📍 ${alt.name}</h5>
                                <button onclick="closeAllInfoWindows()" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #666;">×</button>
                            </div>
                            <p style="margin: 0; font-size: 12px;">${alt.formatted_address || 'Alternative meeting spot'}</p>
                            ${alt.rating ? `<p style="margin: 5px 0 0 0; font-size: 12px;">⭐ ${alt.rating}/5</p>` : ''}
                        </div>
                    `
                });
                openInfoWindows.push(altInfoWindow);
                
                altMarker.addListener('click', () => {
                    closeAllInfoWindows();
                    altInfoWindow.open(map, altMarker);
                    openInfoWindows.push(altInfoWindow);
                });
            }
        });
    }
    
    // Display businesses within walking circles
    displayBusinesses(categorizedBusinesses);
}

// Display routes on separate maps
function displayRoutes(data) {
    const address1 = data.address1.geocoded;
    const address2 = data.address2.geocoded;
    const optimal = data.optimal_meeting_point;
    
    if (!optimal) return;
    
    // Route from address 1 to meeting point
    directionsService.route({
        origin: { lat: address1.lat, lng: address1.lng },
        destination: { lat: optimal.lat, lng: optimal.lng },
        travelMode: google.maps.TravelMode.TRANSIT
    }, (result, status) => {
        if (status === 'OK') {
            directionsRenderer1.setDirections(result);
            
            // Add route info
            const route = result.routes[0];
            const leg = route.legs[0];
            updateRouteInfo('route1Info', {
                from: address1.formatted_address,
                to: optimal.name,
                duration: leg.duration.text,
                distance: leg.distance.text,
                steps: leg.steps.length
            });
        }
    });
    
    // Route from address 2 to meeting point
    directionsService.route({
        origin: { lat: address2.lat, lng: address2.lng },
        destination: { lat: optimal.lat, lng: optimal.lng },
        travelMode: google.maps.TravelMode.TRANSIT
    }, (result, status) => {
        if (status === 'OK') {
            directionsRenderer2.setDirections(result);
            
            // Add route info
            const route = result.routes[0];
            const leg = route.legs[0];
            updateRouteInfo('route2Info', {
                from: address2.formatted_address,
                to: optimal.name,
                duration: leg.duration.text,
                distance: leg.distance.text,
                steps: leg.steps.length
            });
        }
    });
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
                
                const infoWindow = new google.maps.InfoWindow({
                    content: `
                        <div style="padding: 8px; max-width: 200px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                <h5 style="margin: 0; color: #667eea;">${icon} ${place.name}</h5>
                                <button onclick="closeAllInfoWindows()" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #666;">×</button>
                            </div>
                            <p style="margin: 0 0 5px 0; font-size: 12px;"><strong>Category:</strong> ${category.replace('_', ' ')}</p>
                            <p style="margin: 0 0 5px 0; font-size: 12px;"><strong>Address:</strong> ${place.formatted_address || place.vicinity || 'N/A'}</p>
                            ${place.rating ? `<p style="margin: 0 0 5px 0; font-size: 12px;"><strong>Rating:</strong> ${place.rating}/5 ⭐</p>` : ''}
                            ${place.price_level ? `<p style="margin: 0; font-size: 12px;"><strong>Price:</strong> ${'$'.repeat(place.price_level)}</p>` : ''}
                        </div>
                    `
                });
                
                marker.addListener('click', () => {
                    closeAllInfoWindows();
                    infoWindow.open(map, marker);
                    openInfoWindows.push(infoWindow);
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

// Tab switching
document.getElementById('overviewTab').addEventListener('click', () => {
    document.getElementById('overviewTab').classList.add('active');
    document.getElementById('routesTab').classList.remove('active');
    
    document.getElementById('mapsContainer').className = 'maps-container single-map';
    document.getElementById('map').style.display = 'block';
    document.getElementById('mapRoute1').style.display = 'none';
    document.getElementById('mapRoute2').style.display = 'none';
});

document.getElementById('routesTab').addEventListener('click', () => {
    document.getElementById('routesTab').classList.add('active');
    document.getElementById('overviewTab').classList.remove('active');
    
    document.getElementById('mapsContainer').className = 'maps-container split-map';
    document.getElementById('map').style.display = 'none';
    document.getElementById('mapRoute1').style.display = 'block';
    document.getElementById('mapRoute2').style.display = 'block';
    
    // Trigger resize
    setTimeout(() => {
        google.maps.event.trigger(map1, 'resize');
        google.maps.event.trigger(map2, 'resize');
        if (currentData) {
            displayRoutes(currentData);
        }
    }, 100);
});

// Form submission
document.getElementById('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const address1 = document.getElementById('address1').value.trim();
    const address2 = document.getElementById('address2').value.trim();
    
    if (!address1 || !address2) {
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
    clearWalkingCircles();
    
    try {
        const response = await fetch(`${API_BASE}/api/find-middle-point`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                address1: address1,
                address2: address2,
                search_radius: 2000  // Fixed radius since we're not using the input anymore
            })
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            currentData = result.data;
            displayResultsOnMap(result.data);
            
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
            resultsDiv.innerHTML = `
                <div class="error">
                    ❌ Error: ${result.error || 'Unknown error occurred'}
                </div>
            `;
        }
        
    } catch (error) {
        resultsDiv.innerHTML = `
            <div class="error">
                ❌ Network error: ${error.message}
            </div>
        `;
    } finally {
        loadingDiv.style.display = 'none';
        searchBtn.disabled = false;
        searchBtn.textContent = '🚇 Find Meeting Point';
    }
});

// Make functions globally available for the HTML
window.closeAllInfoWindows = closeAllInfoWindows;
window.applyFilters = applyFilters;
