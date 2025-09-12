#!/usr/bin/env python3
"""
Production runner for Meet in the Middle
- Serves the frontend SPA from ./public at "/"
- Mounts the existing Flask API (server.app) at "/api"
- Loads .env for GOOGLE_MAPS_API_KEY and other settings

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

from flask import Flask, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix
import ssl

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Load env from .env if present
load_dotenv(dotenv_path=PROJECT_ROOT / '.env')

# Import the Flask API app
from server.app import app as api_app  # noqa: E402

PUBLIC_DIR = PROJECT_ROOT / 'public'

# Build a small site app for static frontend
site_app = Flask(__name__, static_folder=None)

@site_app.route('/')
def serve_index():
    return send_from_directory(str(PUBLIC_DIR), 'index.html')

@site_app.route('/favicon.ico')
def serve_favicon():
    return send_from_directory(str(PUBLIC_DIR), 'favicon.ico')

@site_app.route('/scripts/<path:filename>')
def serve_scripts(filename):
    return send_from_directory(str(PUBLIC_DIR / 'scripts'), filename)

@site_app.route('/styles/<path:filename>')
def serve_styles(filename):
    return send_from_directory(str(PUBLIC_DIR / 'styles'), filename)

@site_app.route('/images/<path:filename>')
def serve_images(filename):
    return send_from_directory(str(PUBLIC_DIR / 'images'), filename)

@site_app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(str(PUBLIC_DIR / 'assets'), filename)

@site_app.route('/<path:subpath>')
def spa_fallback(subpath: str):
    # Let the SPA handle client-side routes; serve file if exists else index.html
    target = PUBLIC_DIR / subpath
    try:
        if target.is_file():
            rel = target.relative_to(PUBLIC_DIR)
            return send_from_directory(str(PUBLIC_DIR), str(rel))
    except Exception:
        pass
    return send_from_directory(str(PUBLIC_DIR), 'index.html')

# Mount API under /api using DispatcherMiddleware
try:
    from werkzeug.middleware.dispatcher import DispatcherMiddleware
    application = DispatcherMiddleware(site_app, {
        '/api': api_app,
    })
except Exception:
    # Fallback: just expose site_app; API will still be available at its native routes
    # if they were registered without a prefix. This is not ideal; prefer Werkzeug >=2.1.
    application = site_app

# Respect reverse proxy headers (X-Forwarded-*) when behind a proxy/HTTPS terminator
if os.getenv('TRUST_PROXY_HEADERS', '1') not in ('0', 'false', 'False', 'no', 'off'):
    # Trust a single proxy hop by default; tune via env
    x_for = int(os.getenv('PROXY_FIX_X_FOR', '1'))
    x_proto = int(os.getenv('PROXY_FIX_X_PROTO', '1'))
    x_host = int(os.getenv('PROXY_FIX_X_HOST', '1'))
    x_port = int(os.getenv('PROXY_FIX_X_PORT', '1'))
    x_prefix = int(os.getenv('PROXY_FIX_X_PREFIX', '1'))
    application = ProxyFix(application, x_for=x_for, x_proto=x_proto, x_host=x_host, x_port=x_port, x_prefix=x_prefix)


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

    ssl_cert = os.getenv('SSL_CERTFILE') or os.getenv('SSL_CERT')
    ssl_key = os.getenv('SSL_KEYFILE') or os.getenv('SSL_KEY')
    ssl_ca = os.getenv('SSL_CA_FILE') or os.getenv('SSL_CA')

    if ssl_cert and ssl_key:
        scheme = 'https'
        print(f"\n🔐 Starting Meet in the Middle (prod) on https://{host}:{port}")
        print(" - TLS: using provided SSL cert and key")
        print(" - Frontend: / -> ./public/index.html")
        print(" - API:      /api/*")

        # Build SSL context
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        try:
            if ssl_ca:
                context.load_verify_locations(ssl_ca)
        except Exception:
            pass
        context.load_cert_chain(certfile=ssl_cert, keyfile=ssl_key)

        # Use Werkzeug's run_simple to serve HTTPS directly
        from werkzeug.serving import run_simple
        run_simple(hostname=host, port=port, application=application, ssl_context=context, threaded=True)
    else:
        print(f"\n🚀 Starting Meet in the Middle (prod) on http://{host}:{port}")
        print(" - Frontend: / -> ./public/index.html")
        print(" - API:      /api/*")

        # Prefer waitress if available; otherwise use Werkzeug's run_simple
        try:
            from waitress import serve  # type: ignore
            print("Using waitress WSGI server")
            serve(application, host=host, port=port, threads=int(os.getenv('WSGI_THREADS', '8')))
        except Exception as e:
            print(f"[warn] waitress not available or failed ({e}); using Flask dev server")
            from werkzeug.serving import run_simple
            run_simple(hostname=host, port=port, application=application, threaded=True)


if __name__ == '__main__':
    main()
