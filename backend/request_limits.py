"""Bound API request bodies before multipart uploads can exhaust temporary disk."""
from __future__ import annotations

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class RequestBodyLimitMiddleware:
    def __init__(self, app, upload_limit: int = 21 * 1024 * 1024, json_limit: int = 1024 * 1024):
        self.app = app
        self.upload_limit = upload_limit  # A 20 MB image plus multipart fields/headers.
        self.json_limit = json_limit

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope.get('path', '').startswith('/api/'):
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        multipart = headers.get(b'content-type', b'').lower().startswith(b'multipart/form-data')
        limit = self.upload_limit if multipart else self.json_limit
        detail = 'คำขอมีขนาดเกินกำหนด กรุณาลดขนาดภาพหรือข้อมูลแล้วลองอีกครั้ง'
        if b'content-length' in headers:
            try:
                length = int(headers[b'content-length'])
                if length < 0:
                    raise ValueError
            except ValueError:
                return await JSONResponse({'detail': 'Content-Length ไม่ถูกต้อง'}, status_code=400)(scope, receive, send)
            if length > limit:
                return await JSONResponse({'detail': detail}, status_code=413)(scope, receive, send)
        consumed = 0

        async def limited_receive():
            nonlocal consumed
            message = await receive()
            if message['type'] == 'http.request':
                consumed += len(message.get('body', b''))
                if consumed > limit:
                    # FastAPI preserves HTTPException from request parsing, including
                    # unknown-length/chunked uploads. No oversized chunk is spooled.
                    raise HTTPException(status_code=413, detail=detail)
            return message

        return await self.app(scope, limited_receive, send)
