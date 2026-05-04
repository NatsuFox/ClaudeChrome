#!/usr/bin/env python3
"""Generate endpoint documentation and Python client scaffolds.

Input is a JSON endpoint spec collected from ClaudeChrome browser MCP tools. The
script intentionally does not talk to the browser or network; it turns extracted
facts into durable local artifacts.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional
from urllib.parse import urlparse


HTTP_METHODS_WITH_BODY = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass
class Endpoint:
    name: str
    method: str
    host: str
    path: str
    kind: str = "unknown"
    headers: Dict[str, Any] = field(default_factory=dict)
    params: Dict[str, Any] = field(default_factory=dict)
    query_shape: Dict[str, Any] = field(default_factory=dict)
    body_shape: Dict[str, Any] = field(default_factory=dict)
    data: Dict[str, Any] = field(default_factory=dict)
    signature_mode: Optional[str] = None
    response_type: Optional[str] = None
    notes: List[str] = field(default_factory=list)
    source: Dict[str, Any] = field(default_factory=dict)

    @property
    def full_url(self) -> str:
        return f"{self.host.rstrip('/')}/{self.path.lstrip('/')}"

    @property
    def method_name(self) -> str:
        return safe_identifier(self.name)


def safe_identifier(value: str, fallback: str = "endpoint") -> str:
    value = re.sub(r"[^0-9A-Za-z]+", "_", value.strip().lower()).strip("_")
    if not value:
        value = fallback
    if value[0].isdigit():
        value = f"endpoint_{value}"
    return value


def class_name(value: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", value)
    if not words:
        return "ExtractedApiClient"
    candidate = "".join(word[:1].upper() + word[1:] for word in words)
    if candidate[0].isdigit():
        candidate = f"Api{candidate}"
    if not candidate.endswith("Client"):
        candidate += "Client"
    return candidate


def redact_sensitive_headers(headers: Mapping[str, Any]) -> Dict[str, Any]:
    redacted = {}
    for key, value in headers.items():
        lower = key.lower()
        if any(token in lower for token in ("authorization", "cookie", "token", "secret", "csrf")):
            redacted[key] = "<redacted>"
        else:
            redacted[key] = value
    return redacted


def load_spec(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("Endpoint spec must be a JSON object")
    return data


def endpoint_items(spec: Mapping[str, Any]) -> Iterable[Mapping[str, Any]]:
    raw = spec.get("endpoints") or spec.get("confirmed_endpoints") or []
    if not isinstance(raw, list):
        raise ValueError("`endpoints` or `confirmed_endpoints` must be a list")
    for item in raw:
        if isinstance(item, Mapping):
            yield item


def split_host_path(item: Mapping[str, Any]) -> tuple[str, str]:
    host = str(item.get("host") or item.get("base_url") or "").strip()
    path = str(item.get("path") or item.get("endpoint") or "").strip()
    url = str(item.get("url") or "").strip()
    if url and (not host or not path):
        parsed = urlparse(url)
        if parsed.scheme and parsed.netloc:
            host = host or f"{parsed.scheme}://{parsed.netloc}"
            path = path or parsed.path or "/"
    if host.startswith("//"):
        host = f"https:{host}"
    if not host:
        host = "https://example.invalid"
    if not path:
        path = "/"
    return host.rstrip("/"), f"/{path.lstrip('/')}"


def normalize_endpoint(item: Mapping[str, Any], index: int) -> Endpoint:
    host, path = split_host_path(item)
    name = str(item.get("name") or item.get("label") or f"endpoint_{index + 1}")
    method = str(item.get("method") or "GET").upper()
    headers = item.get("headers") or item.get("request_headers") or {}
    if not isinstance(headers, Mapping):
        headers = {}
    params = item.get("params") or item.get("query") or {}
    if not isinstance(params, Mapping):
        params = {}
    query_shape = item.get("query_shape") or {}
    if not isinstance(query_shape, Mapping):
        query_shape = {}
    body_shape = item.get("body_shape") or item.get("body_hint") or {}
    if not isinstance(body_shape, Mapping):
        body_shape = {}
    data = item.get("data") or {}
    if not isinstance(data, Mapping):
        data = {}
    notes = item.get("notes") or []
    if isinstance(notes, str):
        notes = [notes]
    elif not isinstance(notes, list):
        notes = []
    return Endpoint(
        name=name,
        method=method,
        host=host,
        path=path,
        kind=str(item.get("kind") or "unknown"),
        headers=redact_sensitive_headers(headers),
        params=dict(params),
        query_shape=dict(query_shape),
        body_shape=dict(body_shape),
        data=dict(data),
        signature_mode=item.get("signature_mode"),
        response_type=item.get("response_type"),
        notes=[str(note) for note in notes],
        source={key: item[key] for key in ("request_id", "id", "runtime_method") if key in item},
    )


def normalize_spec(spec: Mapping[str, Any]) -> Dict[str, Any]:
    endpoints = [normalize_endpoint(item, index) for index, item in enumerate(endpoint_items(spec))]
    return {
        "page": spec.get("page") or spec.get("bound_tab") or {},
        "evidence": spec.get("evidence") or spec.get("observed_requests") or [],
        "endpoints": [endpoint_to_dict(endpoint) for endpoint in endpoints],
    }


def endpoint_to_dict(endpoint: Endpoint) -> Dict[str, Any]:
    return {
        "name": endpoint.name,
        "method": endpoint.method,
        "host": endpoint.host,
        "path": endpoint.path,
        "url": endpoint.full_url,
        "kind": endpoint.kind,
        "headers": endpoint.headers,
        "params": endpoint.params,
        "query_shape": endpoint.query_shape,
        "body_shape": endpoint.body_shape,
        "data": endpoint.data,
        "signature_mode": endpoint.signature_mode,
        "response_type": endpoint.response_type,
        "notes": endpoint.notes,
        "source": endpoint.source,
    }


def json_block(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)


def render_markdown(normalized: Mapping[str, Any], title: str) -> str:
    page = normalized.get("page") or {}
    evidence = normalized.get("evidence") or []
    endpoints = [normalize_endpoint(item, index) for index, item in enumerate(normalized.get("endpoints", []))]
    lines = [f"# {title}", ""]
    if isinstance(page, Mapping) and page:
        lines.extend(["## Page", ""])
        for key in ("title", "url", "tab_id", "tabId"):
            if key in page:
                lines.append(f"- `{key}`: `{page[key]}`")
        lines.append("")
    lines.extend(["## Endpoints", ""])
    for endpoint in endpoints:
        lines.extend([
            f"### `{endpoint.name}`",
            "",
            f"- Method: `{endpoint.method}`",
            f"- URL: `{endpoint.full_url}`",
            f"- Source: `{endpoint.kind}`",
        ])
        if endpoint.signature_mode:
            lines.append(f"- Signature: `{endpoint.signature_mode}`")
        if endpoint.response_type:
            lines.append(f"- Response type: `{endpoint.response_type}`")
        if endpoint.params or endpoint.query_shape:
            lines.extend(["", "Query/params:", "", "```json", json_block(endpoint.params or endpoint.query_shape), "```"])
        if endpoint.body_shape or endpoint.data:
            lines.extend(["", "Body shape:", "", "```json", json_block(endpoint.body_shape or endpoint.data), "```"])
        if endpoint.headers:
            lines.extend(["", "Headers:", "", "```json", json_block(endpoint.headers), "```"])
        if endpoint.notes:
            lines.extend(["", "Notes:"])
            lines.extend([f"- {note}" for note in endpoint.notes])
        lines.append("")
    if evidence:
        lines.extend(["## Evidence", "", "```json", json_block(evidence), "```"])
    return "\n".join(lines).rstrip() + "\n"


def render_client(normalized: Mapping[str, Any], client_name: str) -> str:
    endpoints = [normalize_endpoint(item, index) for index, item in enumerate(normalized.get("endpoints", []))]
    default_host = endpoints[0].host if endpoints else "https://example.invalid"
    cls = class_name(client_name)
    method_blocks = [render_method(endpoint) for endpoint in endpoints]
    return f'''#!/usr/bin/env python3
"""Generated API client scaffold.

Generated from ClaudeChrome endpoint extraction artifacts. Review dynamic signing,
authentication, CSRF, nonce, and timestamp requirements before using against a
live service.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Mapping, Optional

import requests

logger = logging.getLogger(__name__)


class {cls}:
    """Requests-based client for extracted endpoints."""

    def __init__(self, base_url: str = "{default_host}", session: Optional[requests.Session] = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.session.headers.update({{
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (compatible; ClaudeChromeEndpointExtractor/1.0)",
        }})

    def _request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        logger.debug("%s %s", method, url)
        response = self.session.request(method, url, **kwargs)
        response.raise_for_status()
        return response

{''.join(method_blocks)}

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    client = {cls}()
    print("Client initialized. Fill in required dynamic params before calling endpoints.")
'''


def render_method(endpoint: Endpoint) -> str:
    name = endpoint.method_name
    params_payload = endpoint.params or endpoint.query_shape
    body_payload = endpoint.body_shape or endpoint.data
    headers_payload = endpoint.headers
    url_expr = f'"{endpoint.full_url}"'
    kwargs_lines = []
    if headers_payload:
        kwargs_lines.append(f"headers={{**{json_block(headers_payload)}, **(headers or {{}})}}")
    elif True:
        kwargs_lines.append("headers=headers")
    if params_payload:
        kwargs_lines.append(f"params={{**{json_block(params_payload)}, **(params or {{}})}}")
    else:
        kwargs_lines.append("params=params")
    if endpoint.method in HTTP_METHODS_WITH_BODY:
        if body_payload:
            kwargs_lines.append(f"json={{**{json_block(body_payload)}, **(json_body or {{}})}}")
        else:
            kwargs_lines.append("json=json_body")
    kwargs = ",\n            ".join(kwargs_lines)
    doc_notes = []
    if endpoint.signature_mode:
        doc_notes.append(f"Signature requirement: {endpoint.signature_mode}.")
    if endpoint.notes:
        doc_notes.extend(endpoint.notes)
    note_text = "\n        ".join(doc_notes) if doc_notes else "Review required auth and dynamic params before use."
    return f'''
    def {name}(
        self,
        *,
        params: Optional[Mapping[str, Any]] = None,
        json_body: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> requests.Response:
        """Call `{endpoint.name}`.

        {note_text}
        """
        return self._request(
            "{endpoint.method}",
            {url_expr},
            {kwargs},
        )
'''


def write_outputs(spec_path: Path, output_dir: Path, client_name: str, title: str) -> None:
    spec = load_spec(spec_path)
    normalized = normalize_spec(spec)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "endpoints.normalized.json").write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_dir / "ENDPOINTS.md").write_text(render_markdown(normalized, title), encoding="utf-8")
    client_path = output_dir / "api_client.py"
    client_path.write_text(render_client(normalized, client_name), encoding="utf-8")
    client_path.chmod(0o755)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", required=True, type=Path, help="JSON endpoint spec to convert")
    parser.add_argument("--output-dir", required=True, type=Path, help="Directory for generated artifacts")
    parser.add_argument("--client-name", default="ExtractedApiClient", help="Python client class name seed")
    parser.add_argument("--title", default="Extracted Endpoints", help="Markdown title")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    write_outputs(args.spec, args.output_dir, args.client_name, args.title)
    print(f"Wrote endpoint artifacts to {args.output_dir}")


if __name__ == "__main__":
    main()
