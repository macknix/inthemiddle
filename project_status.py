#!/usr/bin/env python3
"""
Meet in the Middle - Project Status and Quick Start Guide
"""

import os

def print_banner():
    print("🗺️  Meet in the Middle - Project Status")
    print("="*60)

def print_structure():
    print("\n📁 Project Structure:")
    print("""
meet-in-the-middle/
├── 🌐 public/               # Frontend (served at :8082)
│   ├── index.html          # Main interface
│   ├── styles/main.css     # Application styles  
│   ├── scripts/main.js     # Frontend logic
│   └── *.html             # Other pages
├── 🐍 server/              # Backend Python code
│   ├── app.py             # Flask API (:5001)
│   ├── maps_service.py    # Google Maps integration
│   ├── serve_map.py       # Static file server
│   └── tests/             # Test files
├── 🔧 Configuration Files
│   ├── main.py            # Alternative entry point
│   ├── run_dev.py         # Development server
│   ├── requirements.txt   # Dependencies
│   └── .env              # API keys
└── 🧪 test_setup.py       # Setup verification
""")

def print_servers():
    print("\n🚀 Server Configuration:")
    print("├── 📡 Flask API Server:     http://localhost:5001")
    print("├── 🌐 Static File Server:   http://localhost:8082")
    print("└── 🧪 Application URL:      http://localhost:8082")

def print_usage():
    print("\n💻 Quick Start Commands:")
    print("""
# 1. Activate virtual environment:
source env/bin/activate

# 2. Start both servers (OPTION A - Automatic):
python run_dev.py

# 3. OR start servers manually (OPTION B - Manual):
# Terminal 1: Flask API
python main.py

# Terminal 2: Static server  
python server/serve_map.py

# 4. Test the setup:
python test_setup.py

# 5. Open application:
# Visit http://localhost:8082 in your browser
""")

def print_endpoints():
    print("\n🔗 API Endpoints:")
    print("├── GET  /                     # Health check")
    print("├── POST /api/geocode          # Address geocoding") 
    print("└── POST /api/find-middle-point # Find meeting point")

def print_status():
    # Check if servers might be running
    api_status = "🟢 Ready" if os.path.exists("env/bin/python") else "🔴 Setup needed"
    env_status = "🟢 Configured" if os.path.exists(".env") else "🟡 Check .env"
    
    print(f"\n📊 Current Status:")
    print(f"├── Python Environment: {api_status}")
    print(f"├── Environment Config: {env_status}")
    print(f"└── Project Structure:  🟢 Ready")

def main():
    print_banner()
    print_structure()
    print_servers()
    print_endpoints()
    print_usage()
    print_status()
    
    print("\n✨ Your 'Meet in the Middle' app is ready!")
    print("📖 For detailed setup instructions, see README.md")
    print("🐛 For issues, check the test_setup.py output")

if __name__ == '__main__':
    main()
