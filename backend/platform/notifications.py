"""Private notifications point to one expert response in one referral.

Notification ownership is deliberately stricter than clinical expert access:
an expert can review a permitted case, but cannot open another user's inbox.
"""
from __future__ import annotations

import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from .auth import get_store, require_user
from .store import PlatformStore, utc_now

router = APIRouter(prefix="/api/platform", tags=["Account notifications"])
EXPERT_RESPONSE_ACTIONS = {"reply", "request_more", "confirmed", "review"}


def create_response_notification(store: PlatformStore, referral: dict[str, Any],
                                 message: dict[str, Any], expert: dict[str, Any], *, conn) -> None:
    """Called in the same transaction as its immutable conversation message."""
    action = message["data"].get("action")
    recipient = referral["owner_id"]
    if action not in EXPERT_RESPONSE_ACTIONS or not recipient or recipient == expert["id"]:
        return
    analysis = store.get_document("analysis", referral["data"]["analysis_id"], conn=conn)
    if analysis is None or analysis["owner_id"] != recipient:
        raise HTTPException(409, "รายการส่งต่อไม่ตรงกับเจ้าของผลวิเคราะห์")
    # A stable message key makes the response-to-notification relation one to one.
    identifier = uuid.uuid5(uuid.NAMESPACE_URL, f"helpminths:response-notification:{message['id']}").hex
    store.create_document("notification", {
        "analysis_id": analysis["id"], "referral_id": referral["id"],
        "message_id": message["id"], "sample_code": analysis["data"].get("sample_code") or "",
        "kind": action, "comment": message["data"].get("comment", ""),
        "expert_name": expert.get("full_name") or expert["username"], "read_at": None,
    }, recipient, expert["id"], document_id=identifier, conn=conn)


def _present_notification(document: dict[str, Any]) -> dict[str, Any]:
    data = document["data"]
    return {"id": document["id"], "created_at": document["created_at"],
            **{key: data.get(key) for key in (
                "analysis_id", "referral_id", "message_id", "sample_code", "kind",
                "comment", "expert_name", "read_at")}}


def _inbox_query() -> str:
    # Deleted cases/referrals are unavailable, so their notifications must not
    # show a private comment that no longer has a navigable source record.
    return (
        " FROM documents n "
        "JOIN documents a ON a.id=json_extract(n.data,'$.analysis_id') "
        "JOIN documents r ON r.id=json_extract(n.data,'$.referral_id') "
        "WHERE n.kind='notification' AND n.deleted_at IS NULL AND n.owner_id=? "
        "AND a.kind='analysis' AND a.deleted_at IS NULL AND a.owner_id=n.owner_id "
        "AND r.kind='referral' AND r.deleted_at IS NULL AND r.owner_id=n.owner_id "
        "AND json_extract(r.data,'$.analysis_id')=a.id"
    )


@router.get("/notifications")
def list_notifications(request: Request, response: Response,
                       user: Annotated[dict[str, Any], Depends(require_user)],
                       limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    store = get_store(request)
    query = _inbox_query()
    with store.connection() as conn:
        conn.execute("BEGIN")
        total = conn.execute("SELECT COUNT(*)" + query, (user["id"],)).fetchone()[0]
        unread = conn.execute("SELECT COUNT(*)" + query + " AND json_extract(n.data,'$.read_at') IS NULL",
                              (user["id"],)).fetchone()[0]
        rows = conn.execute("SELECT n.*" + query + " ORDER BY n.created_at DESC,n.rowid DESC LIMIT ? OFFSET ?",
                            (user["id"], limit, offset)).fetchall()
    response.headers["Cache-Control"] = "private, no-store"
    return {"items": [_present_notification({**dict(row), "data": json.loads(row["data"])}) for row in rows],
            "total": total, "unread_count": unread, "limit": limit, "offset": offset}


@router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: str, request: Request, response: Response,
                      user: Annotated[dict[str, Any], Depends(require_user)]) -> dict[str, Any]:
    store = get_store(request)
    with store.transaction() as conn:
        row = conn.execute("SELECT n.*" + _inbox_query() + " AND n.id=?",
                           (user["id"], notification_id)).fetchone()
        if row is None:
            raise HTTPException(404, "ไม่พบการแจ้งเตือนนี้")
        notification = {**dict(row), "data": json.loads(row["data"])}
        if notification["data"].get("read_at") is None:
            notification = store.update_document("notification", notification_id,
                                                 {**notification["data"], "read_at": utc_now()}, user["id"],
                                                 expected_revision=notification["revision"], conn=conn)
    response.headers["Cache-Control"] = "private, no-store"
    return _present_notification(notification)
