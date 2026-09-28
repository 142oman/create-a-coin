"""Web app: brand and creator views, the backtest and the compare tool over a small JSON API.
Standard library only."""
import json
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import backtest, data, validate
from .builder import CampaignParams, build
from .config import CATEGORIES, FORMATS, QUALIFY_REACH, STEP_CHANCE, TIERS
from .simulate import SCENARIOS, simulate

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DOCS = {"methodology": "docs/METHODOLOGY.md", "one-pager": "docs/ONE_PAGER.md",
        "discussion": "docs/DISCUSSION.md", "backtest": "results/BACKTEST.md",
        "validation": "results/VALIDATION.md", "readme": "README.md"}


def _params(body):
    return CampaignParams(float(body["total_budget"]), body.get("categories") or [], body.get("platforms") or [],
                          body.get("tiers") or [], body.get("start_date") or None, body.get("end_date") or None,
                          body.get("formats") or [])


class State:
    dataset = None

    @classmethod
    def data(cls):
        if cls.dataset is None:
            cls.dataset = data.load()
        return cls.dataset


def _cached(name, compute):
    path = ROOT / "results" / name
    if not path.exists():
        compute(State.data())
    return json.loads(path.read_text(encoding="utf-8"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path == "/api/meta":
                ds = State.data()
                return self._json({
                    "categories": CATEGORIES, "tiers": TIERS, "formats": FORMATS, "step_chance": STEP_CHANCE,
                    "qualify_reach": QUALIFY_REACH,
                    "scenarios": {k: {"label": v["label"], "about": v["about"]} for k, v in SCENARIOS.items()},
                    "counts": {"campaigns": len(ds.campaigns), "creators": len(ds.creators), "posts": len(ds.posts)},
                    "campaigns": [{**c, "posts": len(ds.posts_by_campaign.get(c["campaign_id"], [])),
                                   "ladder": ds.ladder_by_campaign.get(c["campaign_id"], [])} for c in ds.campaigns],
                })
            if path == "/api/backtest":
                return self._json(_cached("backtest.json", backtest.run))
            if path == "/api/validation":
                return self._json(_cached("validation.json", validate.run))
            if path.startswith("/api/doc/"):
                name = path.rsplit("/", 1)[-1]
                if name not in DOCS:
                    return self._json({"error": "unknown document"}, HTTPStatus.NOT_FOUND)
                file = ROOT / DOCS[name]
                text = file.read_text(encoding="utf-8") if file.exists() else f"*{DOCS[name]} not generated yet.*"
                return self._json({"name": name, "markdown": text})
        except FileNotFoundError as e:
            return self._json({"error": str(e)}, HTTPStatus.SERVICE_UNAVAILABLE)
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            body = self._body()
            if path in ("/api/campaign", "/api/simulate"):
                params = _params(body)
                ds = State.data()
                if path == "/api/campaign":
                    return self._json(build(ds.before(params.start_date), params).to_dict())
                seed = body.get("seed")
                return self._json(simulate(ds, params, body.get("scenario") or "normal",
                                           int(seed) if seed not in (None, "") else None))
            if path == "/api/compare":
                return self._json(backtest.compare_manual(State.data(), body["campaign_id"], body["ladder"]))
        except (KeyError, ValueError, TypeError) as e:
            return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)


def serve(port=8000):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Creator Pool on http://localhost:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
