"""Model inventory: actual configured checkpoint metadata and explicit declarations."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.platform.auth import get_store, require_roles, require_user
from backend.platform.store import flatten_document

router = APIRouter(prefix='/api/platform', tags=['Model versions'])


def configured_model(request: Request) -> dict:
    service = request.app.state.model_service
    metadata = getattr(service, 'metadata', None)
    if callable(metadata):
        metadata = metadata()
    metadata = metadata if isinstance(metadata, dict) else {}
    allowed = {'version', 'sha256', 'name', 'task', 'device', 'imgsz', 'runtime', 'framework', 'ultralytics_version', 'inference_imgsz', 'nms_iou',
               'training_dataset_version', 'validation_dataset', 'dataset_metadata_status'}
    metadata = {key: value for key, value in metadata.items() if key in allowed}
    version = metadata.get('version') or metadata.get('sha256') or getattr(service, 'version', None)
    return {'ready': bool(service.ready), 'name': service.name if service.ready else None, 'version': version if service.ready else None,
            'metadata': metadata if service.ready else {}, 'message': service.message}


class ModelDeclaration(BaseModel):
    model_name: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=128)
    training_dataset_version: str | None = Field(default=None, max_length=160)
    validation_dataset: str | None = Field(default=None, max_length=160)
    notes: str = Field(default='', max_length=2000)


@router.get('/models')
def model_versions(request: Request, user: Annotated[dict, Depends(require_user)], limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
    store = get_store(request)
    records = store.list_documents('model_version', limit=limit, offset=offset)
    return {'items': [flatten_document(item) for item in records], 'total': store.count_documents('model_version'), 'limit': limit, 'offset': offset,
            'configured_model': configured_model(request),
            'deployment_policy': 'เปลี่ยนโมเดลผ่านการตั้งค่าผู้ดูแลและเริ่มบริการใหม่เท่านั้น Feedback และการแก้ annotation ไม่ฝึกหรือ deploy โมเดลอัตโนมัติ'}


@router.post('/models', status_code=201)
def declare_model(body: ModelDeclaration, request: Request, user: Annotated[dict, Depends(require_roles('admin'))]):
    store = get_store(request)
    current = configured_model(request)
    if not current['ready'] or not current['version'] or body.version != current['version'] or body.model_name != current['name']:
        raise HTTPException(422, 'บันทึกข้อมูลได้เฉพาะชื่อและรุ่นของ checkpoint ที่ระบบโหลดจริงอยู่ขณะนี้')
    with store.transaction() as connection:
        exists = connection.execute("SELECT id FROM documents WHERE kind='model_version' AND deleted_at IS NULL AND json_extract(data,'$.version')=?", (body.version,)).fetchone()
        if exists:
            raise HTTPException(409, 'มีข้อมูลรุ่นโมเดลนี้แล้ว')
        data = body.model_dump()
        data.update(checkpoint_metadata=current['metadata'], deployment_status='configured', evaluation_metrics=None,
                    declaration_source='authenticated_administrator', release_timestamp=None)
        return flatten_document(store.create_document('model_version', data, user['id'], user['id'], conn=connection))
