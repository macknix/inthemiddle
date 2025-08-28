#!/usr/bin/env python3
"""
Main entry point for the Meet in the Middle application
"""

import sys
import os

# Add the server directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'server'))

from server.app import app

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
