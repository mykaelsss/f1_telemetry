import hashlib

from starlette.datastructures import Headers, MutableHeaders

NOT_MODIFIED_HEADERS = (
    "cache-control",
    "content-location",
    "date",
    "etag",
    "expires",
    "vary",
)


def compute_etag(body: bytes) -> str:
    return f'"{hashlib.blake2b(body, digest_size=16).hexdigest()}"'


def if_none_match_hit(header: str | None, etag: str) -> bool:
    if not header:
        return False
    candidate = header.strip()
    if candidate == "*":
        return True
    target = etag.removeprefix("W/")
    return any(t.strip().removeprefix("W/") == target for t in candidate.split(","))


class ETagMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "GET":
            await self.app(scope, receive, send)
            return

        start = None
        chunks: list[bytes] = []

        async def buffer(message):
            nonlocal start
            if message["type"] == "http.response.start":
                start = message
                return
            if message["type"] != "http.response.body":
                await send(message)
                return
            chunks.append(message.get("body", b""))
            if message.get("more_body", False):
                return
            await self._complete(scope, start, b"".join(chunks), send)

        await self.app(scope, receive, buffer)

    async def _complete(self, scope, start, body, send):
        headers = MutableHeaders(raw=list(start["headers"]))
        if start["status"] != 200 or not body or "etag" in headers:
            await send(start)
            await send({"type": "http.response.body", "body": body})
            return

        etag = compute_etag(body)
        headers["etag"] = etag

        if if_none_match_hit(Headers(scope=scope).get("if-none-match"), etag):
            kept = [
                (key, value)
                for key, value in headers.raw
                if key.decode("latin-1").lower() in NOT_MODIFIED_HEADERS
            ]
            await send({"type": "http.response.start", "status": 304, "headers": kept})
            await send({"type": "http.response.body", "body": b""})
            return

        await send(
            {
                "type": "http.response.start",
                "status": start["status"],
                "headers": headers.raw,
            }
        )
        await send({"type": "http.response.body", "body": body})
