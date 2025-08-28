#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simple HTTP server to serve the map interface
Run this to serve the HTML file with proper headers for Google Maps API
"""

import http.server
import socketserver
import os
import webbrowser
import threading
import time

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def log_message(self, format, *args):
        # Suppress log messages for cleaner output
        pass

def serve_map_interface():
    PORT = 8080
    
    # Change to the project directory
    os.chdir('/Users/macknixon/projects/meet-in-the-middle')
    
    with socketserver.TCPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
        print(f"🌐 Map Interface Server Starting...")
        print(f"📍 Serving at: http://localhost:{PORT}")
        print(f"🗺️  Map Interface: http://localhost:{PORT}/map_interface.html")
        print(f"📱 Web Interface: http://localhost:{PORT}/web_interface.html")
        print(f"🛑 Press Ctrl+C to stop the server")
        print()
        
        # Auto-open browser after a short delay
        def open_browser():
            time.sleep(1)
            webbrowser.open(f'http://localhost:{PORT}/map_interface.html')
        
        browser_thread = threading.Thread(target=open_browser)
        browser_thread.daemon = True
        browser_thread.start()
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Server shutting down...")
            httpd.shutdown()

if __name__ == "__main__":
    serve_map_interface()
