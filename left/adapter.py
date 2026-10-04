#!/usr/bin/env python3
"""
Adapter: exposes POST /prompt {"prompt": ...} -> {"text": ...}
in front of a Lucy ADK server, which natively speaks A2A JSON-RPC.

Usage:
    LUCY_URL=http://localhost:8101 PORT=9101 python3 lucy-adapter.py

Stdlib only -- no dependencies.
"""
import json, os, uuid, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

LUCY_URL = os.getenv("LUCY_URL", "http://localhost:8000").rstrip("/")
PORT     = int(os.getenv("PORT", "9000"))
TIMEOUT  = int(os.getenv("LUCY_TIMEOUT", "600"))


def call_lucy(prompt: str, session: str, context: dict | None = None) -> dict:
    """Send one prompt over A2A JSON-RPC.

    Returns {"text": str, "state": str, "needs_input": bool}.
    Lucy is NOT a pure prompt->text service: a turn can come back in three
    shapes, and a comparison harness has to distinguish them or it will
    silently score an empty string as an answer. See README.
    """
    payload = {
        "jsonrpc": "2.0",
        "id": uuid.uuid4().hex,
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": prompt}],
                "messageId": uuid.uuid4().hex,
                # contextId is what carries multi-turn continuity.
                "contextId": session,
            },
            "configuration": {
                "acceptedOutputModes": ["text/plain"],
                "userId": "dualing-ai",
                # Supplying context up front stops the orchestrator from
                # spending a turn on ask_human just to collect it.
                "context": context or {},
            },
        },
    }
    req = urllib.request.Request(
        LUCY_URL + "/",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    resp = json.load(urllib.request.urlopen(req, timeout=TIMEOUT))

    # JSON-RPC errors come back with HTTP 200 -- check explicitly.
    if "error" in resp and "result" not in resp:
        raise RuntimeError(resp["error"].get("message") or str(resp["error"]))

    result = resp["result"]
    state = (result.get("status") or {}).get("state")

    if state == "failed":
        msg = (result["status"].get("message") or {}).get("parts", [{}])
        raise RuntimeError(msg[0].get("text", "task failed"))

    # HITL: the agent paused to ask a question via the ask_human tool. The
    # answer text is absent; the question lives in a `data` part. Reply on the
    # SAME contextId to continue. Treating this as an empty answer is the
    # single easiest way to get a misleading comparison.
    if state == "input-required":
        sm = (result.get("status") or {}).get("message") or {}
        for part in sm.get("parts", []):
            if part.get("kind") == "data":
                q = (part.get("data") or {}).get("args", {}).get("question", "")
                return {"text": q, "state": state, "needs_input": True}
        return {"text": "", "state": state, "needs_input": True}

    # Text may be in status.message OR in artifacts -- check both, in this
    # order. A successful turn frequently puts the answer in artifacts and
    # leaves status.message empty, so checking only one silently yields "".
    msg = (result.get("status") or {}).get("message") or {}
    for part in msg.get("parts", []):
        if part.get("kind") == "text" and part.get("text", "").strip():
            return {"text": part["text"], "state": state, "needs_input": False}
    for artifact in result.get("artifacts", []):
        for part in artifact.get("parts", []):
            if part.get("kind") == "text" and part.get("text", "").strip():
                return {"text": part["text"], "state": state, "needs_input": False}
    return {"text": "", "state": state, "needs_input": False}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path.rstrip("/") != "/prompt":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        prompt = body.get("prompt", "")
        # Give each side its own session namespace so the two instances
        # never share conversational state.
        session = body.get("session") or f"dualing-{os.getenv('SIDE','x')}-{uuid.uuid4().hex[:8]}"
        try:
            r = call_lucy(prompt, session, body.get("context"))
            out = {**r, "session": session}
            code = 200
        except Exception as e:
            out = {"error": str(e)}
            code = 502
        payload = json.dumps(out).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
        else:
            self.send_error(404)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"adapter: POST http://0.0.0.0:{PORT}/prompt  ->  {LUCY_URL}", flush=True)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
