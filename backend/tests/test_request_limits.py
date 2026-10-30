"""Actual body-stream limits apply before file decoding or multipart spooling."""
import asyncio

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.testclient import TestClient

from backend.request_limits import RequestBodyLimitMiddleware


def application():
    app = FastAPI()
    app.add_middleware(RequestBodyLimitMiddleware, upload_limit=1024, json_limit=128)

    @app.post('/api/file')
    async def file(image: UploadFile = File()):
        try:
            return {'bytes': len(await image.read())}
        finally:
            await image.close()

    @app.post('/api/json')
    async def json(request: Request):
        return {'bytes': len(await request.body())}

    return app


def test_known_length_rejected_before_endpoint_and_valid_multipart_allowed():
    with TestClient(application()) as client:
        assert client.post('/api/file', files={'image': ('image.png', b'x' * 2048, 'image/png')}).status_code == 413
        assert client.post('/api/json', content=b'x' * 129).status_code == 413
        assert client.post('/api/file', files={'image': ('image.png', b'x' * 100, 'image/png')}).json() == {'bytes': 100}


def test_unknown_length_body_is_bounded_for_multipart_and_json():
    async def run(path, content_type, chunks):
        messages = []
        iterator = iter(chunks)

        async def receive():
            chunk = next(iterator, None)
            return {'type': 'http.request', 'body': chunk or b'', 'more_body': chunk is not None}

        async def send(message):
            messages.append(message)

        await application()({'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
                             'method': 'POST', 'scheme': 'http', 'path': path, 'raw_path': path.encode(),
                             'query_string': b'', 'headers': [(b'content-type', content_type)],
                             'server': ('testserver', 80), 'client': ('127.0.0.1', 1234)}, receive, send)
        return next(item['status'] for item in messages if item['type'] == 'http.response.start')

    assert asyncio.run(run('/api/json', b'application/json', [b'x' * 80, b'y' * 80])) == 413
    opening = b'--test\r\nContent-Disposition: form-data; name="image"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'
    assert asyncio.run(run('/api/file', b'multipart/form-data; boundary=test', [opening, b'x' * 600, b'y' * 600])) == 413
