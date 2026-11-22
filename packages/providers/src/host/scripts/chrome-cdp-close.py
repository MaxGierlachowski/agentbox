#!/usr/bin/env python3
"""Usage: chrome-cdp-close.py [MAINPID]. ExecStop helper for agentbox-chrome: ask Chrome to shut down cleanly via CDP Browser.close
(flushes the cookie store), stdlib only. Exits 0 even if Chrome is already gone; systemd then
waits for the main PID and falls back to SIGTERM/SIGKILL after TimeoutStopSec."""
import base64, json, os, socket, struct, sys, time, urllib.request
from urllib.parse import urlparse

PORT = int(os.environ.get("CDP_PORT", "9333"))
try:
    ver = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=3))
except Exception:
    sys.exit(0)
u = urlparse(ver["webSocketDebuggerUrl"])
s = socket.create_connection(("127.0.0.1", PORT), timeout=5)
key = base64.b64encode(os.urandom(16)).decode()
s.sendall((f"GET {u.path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nUpgrade: websocket\r\n"
           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
if b" 101 " not in s.recv(4096).split(b"\r\n", 1)[0]:
    sys.exit(0)
payload = json.dumps({"id": 1, "method": "Browser.close"}).encode()
mask = os.urandom(4)
hdr = bytes([0x81]) + (bytes([0x80 | len(payload)]) if len(payload) < 126 else bytes([0x80 | 126]) + struct.pack(">H", len(payload)))
s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
try:
    s.recv(4096)
except Exception:
    pass

# Wait for the browser process to finish its shutdown so systemd doesn't SIGTERM it mid-flush.
if len(sys.argv) > 1 and sys.argv[1].isdigit():
    pid = int(sys.argv[1])
    for _ in range(200):
        try:
            os.kill(pid, 0)
        except OSError:
            break
        time.sleep(0.1)
