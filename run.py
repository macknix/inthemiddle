"""Run the inthemiddle dev server: http://127.0.0.1:5001"""

from server.app import app

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
