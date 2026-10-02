"""Web app: the landing page, the advertiser and creator flows, and Compare, over a small JSON API.
Standard library only. Benchmark (web/benchmark.html) is served as a static page; its API routes
below are self-contained and never touch this module's World/State. The Advertiser page's /api/publish
runs on benchmark.py too (benchmark.advertiser_run), so the advertiser and Benchmark share one engine. Backtest, the page that used to
live here, is gone — replaced by Benchmark; its CLI (`python -m ladder backtest`) is unaffected."""
import json
import os
import threading
import traceback
from dataclasses import asdict
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import benchmark, data, simulate
from .config import ALL_FORMATS, CATEGORIES, FORMATS, NAME, PLATFORM_OF, REVIEW_DAYS, TIERS
from .history import replay

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DOCS = {"methodology": "docs/METHODOLOGY.md", "one-pager": "docs/ONE_PAGER.md",
        "discussion": "docs/DISCUSSION.md", "readme": "README.md"}
MAX_BODY = 1_000_000   # bytes; the largest real request is a few hundred
BRIEF_LADDER = [[10000, 500], [50000, 2000], [100000, 5000], [500000, 15000]]


class State:
    lock = threading.Lock()
    world = None
    summary = None

    @classmethod
    def ready(cls):
        with cls.lock:
            if cls.world is None:
                cls.set_world(data.load())
        return cls

    @classmethod
    def set_world(cls, world):
        cls.world = world
        _, _, cls.summary = replay(world)


def meta():
    s = State.ready()
    w = s.world
    return {
        "name": NAME, "categories": CATEGORIES, "formats": FORMATS, "platform_of": PLATFORM_OF, "tiers": TIERS,
        "review_days": REVIEW_DAYS, "recipe": asdict(w.recipe), "params": w.params,
        "counts": {"campaigns": len(w.campaigns), "creators": len(w.creators), "posts": len(w.posts)},
        "scenarios": {k: v["label"] for k, v in simulate.SCENARIOS.items()},
        "brief_ladder": BRIEF_LADDER,
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "Clearing"   # no Python version in the Server header
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")   # always serve the latest page and script
        super().end_headers()

    def _json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, default=_plain).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("request too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/healthz":   # for the host's health check; answers without touching the world
                return self._json({"ok": True})
            if url.path == "/api/meta":
                return self._json(meta())
            if url.path == "/api/benchmark":   # Benchmark: self-contained, reads nothing from the world
                return self._json(benchmark.run(int(q.get("seed", 1)), int(q.get("n", 400)), q.get("scenario", "all")))
            if url.path == "/api/benchmark/start":
                return self._json({"id": benchmark.start_job(int(q.get("seed", 1)), int(q.get("n", 400)), q.get("scenario", "all"), q.get("mode") in ("entropy", "unbiased"))})
            if url.path == "/api/benchmark/progress":
                return self._json(benchmark.job_status(q.get("id", "")))
            if url.path == "/api/compare/random-ladder":   # a starting ladder for the Compare page's old way
                return self._json({"rungs": benchmark.random_old_ladder(float(q.get("budget", 500000)))})
            if url.path == "/api/typical-budget":
                s = State.ready()
                cats = [c for c in q.get("categories", "").split(",") if c]
                fmts = [f for f in q.get("formats", "").split(",") if f]
                return self._json({"budget": simulate.typical_budget(s.world, cats, fmts)})
            if url.path == "/api/creator/profiles":
                return self._json(simulate.profiles(State.ready().world, int(q.get("seed", 1))))
            if url.path.startswith("/api/doc/"):
                name = url.path.rsplit("/", 1)[-1]
                if name not in DOCS:
                    return self._json({"error": "unknown document"}, HTTPStatus.NOT_FOUND)
                f = ROOT / DOCS[name]
                return self._json({"name": name, "markdown": f.read_text(encoding="utf-8") if f.exists() else ""})
        except benchmark.Busy as e:
            return self._json({"error": str(e)}, HTTPStatus.TOO_MANY_REQUESTS)
        except (KeyError, ValueError) as e:
            return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except Exception:   # never leak a traceback to a visitor; the log still has it
            traceback.print_exc()
            return self._json({"error": "Something went wrong on the server. Please try again."}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._body()
            s = State.ready()
            if path == "/api/publish":   # the Advertiser page runs on benchmark.py's market and engine calls
                return self._json(benchmark.advertiser_run(body["budget"], body["max_cpm"], body.get("scenario") or "normal",
                                                          body.get("seed") or 1, body.get("days") or 14))
            if path == "/api/creator/campaigns":
                return self._json(simulate.campaign_cards(s.world, s.summary, body["creator_id"], int(body.get("seed", 1))))
            if path == "/api/creator/run":
                return self._json(simulate.creator_run(s.world, s.summary, body["creator_id"], body["card"],
                                                       int(body.get("seed", 1))))
            if path == "/api/compare":   # benchmark.py's synthetic market, not ladder/compare.py's real campaigns
                return self._json(benchmark.compare(body["budget"], body["old"]["rungs"], body.get("fair_cpm")))
        except (KeyError, ValueError, TypeError) as e:
            return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except Exception:
            traceback.print_exc()
            return self._json({"error": "Something went wrong on the server. Please try again."}, HTTPStatus.INTERNAL_SERVER_ERROR)
        return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)


def _plain(x):
    if isinstance(x, (set, tuple)):
        return list(x)
    return str(x)


def serve(port=None, host=None):
    """Locally: 127.0.0.1:8000. On a host that sets PORT (Railway and the like): all interfaces on that port."""
    port = port or int(os.environ.get("PORT", 8000))
    host = host or os.environ.get("HOST") or ("0.0.0.0" if "PORT" in os.environ else "127.0.0.1")
    State.ready()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"{NAME} on http://{'localhost' if host == '127.0.0.1' else host}:{port}  (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
