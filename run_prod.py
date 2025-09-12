#!/usr/bin/env python3
"""
Production runner for Meet in the Middle
- Serves the Flask API under /api/*
- Serves the frontend from ./public on the same port
- Reads environment from .env (GOOGLE_MAPS_API_KEY, PORT, MIDDLEPOINT_ALGORITHM, SHOW_ROUTE_SAMPLES)

Usage:
  python3 run_prod.py

Environment:
  PORT=8000 (default)        # Port to bind
  HOST=0.0.0.0 (default)     # Host interface
  GOOGLE_MAPS_API_KEY=...    # Required for full functionality
  MIDDLEPOINT_ALGORITHM=...  # optional: default | route-midpoint
  SHOW_ROUTE_SAMPLES=true    # optional: show route sampling points
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Load env from .env if present
load_dotenv(dotenv_path=PROJECT_ROOT / '.env')

from flask import send_from_directory, abort

# Import the Flask app (API) from server package
from server.app import app  # noqa: E402

PUBLIC_DIR = PROJECT_ROOT / 'public'
ASSET_SUBDIRS = {'scripts', 'styles', 'images', 'assets', 'fonts'}

# --- Static file routes on same Flask app ---
@app.route('/')
def serve_index():
    """Serve the main SPA index."""
    return send_from_directory(str(PUBLIC_DIR), 'index.html')

@app.route('/favicon.ico')
def serve_favicon():
    # Serve favicon if present, otherwise 404
    fav = PUBLIC_DIR / 'favicon.ico'
    if fav.exists():
        return send_from_directory(str(PUBLIC_DIR), 'favicon.ico')
    abort(404)

@app.route('/<path:filename>')
def serve_static(filename: str):
    """Serve static assets; fall back to index.html for unknown non-API routes (SPA).
    Avoid intercepting API routes.
    """
    # Never handle API paths here
    if filename.startswith('api/'):
        abort(404)

    requested = PUBLIC_DIR / filename

    # Serve existing files directly
    if requested.is_file():
        # Slightly longer cache for assets subfolders
        cache_timeout = 3600 if (requested.parent.name in ASSET_SUBDIRS) else 300
        return send_from_directory(str(PUBLIC_DIR), filename, cache_timeout=cache_timeout)

    # If it's a directory request for a known asset subdir, abort 404
    if requested.is_dir():
        abort(404)

    # SPA fallback: serve index for any other unknown route
    return send_from_directory(str(PUBLIC_DIR), 'index.html')


def main():
    host = os.getenv('HOST', '0.0.0.0')
    try:
        port = int(os.getenv('PORT', '8000'))
    except ValueError:
        port = 8000

    api_key = os.getenv('GOOGLE_MAPS_API_KEY')
    if not api_key or api_key == 'your_api_key_here':
        print("\n" + "="*60)
        print("Warning: GOOGLE_MAPS_API_KEY is not configured.")
        print("The site will load, but API functionality will be limited.")
        print("Set it in your environment or .env file.")
        print("="*60 + "\n")

    # Run Flask production server (for true production, run behind gunicorn/uwsgi)
    # Debug off, threaded on for concurrency.
    print(f"\n🚀 Starting Meet in the Middle (prod) on http://{host}:{port}")
    print(" - Static: ./public (/, /scripts, /styles, etc)")
    print(" - API:    /api/*")
    app.run(host=host, port=port, debug=False, threaded=True)


if __name__ == '__main__':
    main()
