"""Start server, then open the user's default browser once it is ready."""
import threading
import time
import urllib.request
import webbrowser

URL = 'http://127.0.0.1:8766'


def ready():
    try:
        with urllib.request.urlopen(URL + '/api/status', timeout=1) as r:
            return r.status == 200 and b'"mode":"local"' in r.read()
    except Exception:
        return False


def open_when_ready():
    for _ in range(60):
        if ready():
            webbrowser.open(URL)
            return
        time.sleep(.5)


if __name__ == '__main__':
    if ready():
        webbrowser.open(URL)
    else:
        import uvicorn
        print('Cliploom is running at ' + URL + '\nKeep this window open. Press Ctrl+C to stop.')
        threading.Thread(target=open_when_ready, daemon=True).start()
        uvicorn.run('app:app', host='127.0.0.1', port=8766)
