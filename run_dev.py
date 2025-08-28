#!/usr/bin/env python3
"""
Development server script for Meet in the Middle application
Starts both the Flask API server and the static file server
"""

import subprocess
import sys
import os
import time
import signal
import threading

def run_api_server():
    """Run the Flask API server"""
    try:
        # Change to project root and activate virtual environment
        project_root = os.path.dirname(os.path.abspath(__file__))
        os.chdir(project_root)
        
        # Add project root to Python path
        sys.path.insert(0, project_root)
        
        # Import and run the Flask app directly
        from server.app import app
        app.run(debug=True, host='0.0.0.0', port=5001, use_reloader=False)
    except KeyboardInterrupt:
        print("\n🛑 API Server stopped")

def run_static_server():
    """Run the static file server"""
    try:
        # Change to project root
        project_root = os.path.dirname(os.path.abspath(__file__))
        os.chdir(project_root)
        
        # Add project root to Python path
        sys.path.insert(0, project_root)
        
        # Import and run the static server
        from server.serve_map import serve_map_interface
        serve_map_interface()
    except KeyboardInterrupt:
        print("\n🛑 Static Server stopped")

def main():
    print("🚀 Starting Meet in the Middle Development Servers...")
    print("="*60)
    print("📡 API Server will start on: http://localhost:5001")
    print("🌐 Web Interface will start on: http://localhost:8082")
    print("="*60)
    
    # Start API server in a separate thread
    api_thread = threading.Thread(target=run_api_server, daemon=True)
    api_thread.start()
    
    # Give API server time to start
    time.sleep(2)
    
    # Start static server in main thread
    try:
        run_static_server()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down servers...")
        sys.exit(0)

if __name__ == '__main__':
    main()
