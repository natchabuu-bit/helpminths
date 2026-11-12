"""Credential-free connection diagnostics for hosting logs.

Never return provider exception text: libpq can include a URI, hostname,
username, password, certificate location, or other private connection data.
Only a finite set of static codes and operator instructions leaves this module.
"""
from __future__ import annotations


_MESSAGES = {
    "DB_AUTH": "ฐานข้อมูลไม่ยอมรับชื่อผู้ใช้หรือรหัสผ่าน ตรวจชื่อผู้ใช้จาก Session pooler และรหัสผ่านฐานข้อมูล Supabase",
    "DB_DATABASE_NAME": "ไม่พบชื่อฐานข้อมูลปลายทาง ตรวจส่วนท้าย URI จาก Supabase Connect ซึ่งโดยปกติเป็น /postgres",
    "DB_POOLER_IDENTITY": "Pooler ไม่พบโครงการหรือชื่อผู้ใช้ คัดลอก host และชื่อผู้ใช้ทั้งหมดจาก Supabase Connect > Session pooler",
    "DB_DNS": "ค้นหาที่อยู่ฐานข้อมูลไม่ได้ ตรวจ host จาก Supabase Connect > Session pooler",
    "DB_NETWORK": "เครือข่ายเข้าถึงฐานข้อมูลไม่ได้ ตรวจ Session pooler ที่รองรับ IPv4 และการจำกัดเครือข่ายของโครงการ",
    "DB_TIMEOUT": "เชื่อมต่อฐานข้อมูลไม่สำเร็จภายในเวลาที่กำหนด ตรวจสถานะโครงการและ Session pooler ใน Supabase",
    "DB_TLS": "ตรวจการเชื่อมต่อ TLS ของฐานข้อมูลไม่ผ่าน ตรวจค่า sslmode และใบรับรอง โดยคงการเข้ารหัสไว้",
    "DB_CONNECTION_LIMIT": "ฐานข้อมูลมีการเชื่อมต่อเต็ม ตรวจการใช้งานและการเชื่อมต่อที่ค้างใน Supabase",
    "DB_UNAVAILABLE": "ฐานข้อมูลยังไม่พร้อมรับการเชื่อมต่อ ตรวจสถานะโครงการและเปิดโครงการกลับหากถูกพัก",
    "DB_CONNECTION_FAILED": "เชื่อมต่อฐานข้อมูลภายนอกไม่ได้ ตรวจสถานะ Supabase และค่าการเชื่อมต่อส่วนตัวบน Render",
}


def connection_failure_message(error: BaseException) -> str:
    """Classify privately, exposing no original message or connection argument."""
    state = getattr(error, "sqlstate", None)
    # This text is inspected only for known patterns; no part is echoed, even
    # for an unrecognized error. Poolers do not always supply SQLSTATE on connect.
    text = str(error).casefold()
    if any(part in text for part in ("tenant or user not found", "tenant not found", "invalid tenant")):
        code = "DB_POOLER_IDENTITY"
    elif state in {"28P01", "28000"} or any(part in text for part in (
        "password authentication failed", "authentication failed", "invalid password", "wrong password", "no password supplied",
    )):
        code = "DB_AUTH"
    elif state == "3D000" or ("database" in text and "does not exist" in text):
        code = "DB_DATABASE_NAME"
    elif state == "53300" or any(part in text for part in (
        "too many connections", "max client connections", "maximum clients", "remaining connection slots",
    )):
        code = "DB_CONNECTION_LIMIT"
    elif state == "57P03" or any(part in text for part in (
        "database system is starting up", "database system is shutting down", "database system is in recovery",
    )):
        code = "DB_UNAVAILABLE"
    elif any(part in text for part in (
        "could not translate host name", "failed to resolve host", "name or service not known",
        "nodename nor servname", "temporary failure in name resolution", "no address associated with hostname",
    )):
        code = "DB_DNS"
    elif any(part in text for part in (
        "ssl connection has been closed unexpectedly", "server closed the connection unexpectedly",
        "connection reset by peer", "ssl syscall error: eof detected",
    )):
        code = "DB_NETWORK"
    elif ("certificate" in text and "does not match" in text) or any(part in text for part in (
        "certificate verify failed", "certificate verification failed", "ssl error", "ssl connection",
        "tls error", "does not support ssl", "root certificate file", "certificate does not match host",
    )):
        code = "DB_TLS"
    elif any(part in text for part in (
        "network is unreachable", "no route to host", "connection refused", "cannot assign requested address",
    )):
        code = "DB_NETWORK"
    elif "timeout" in text or "timed out" in text:
        code = "DB_TIMEOUT"
    else:
        code = "DB_CONNECTION_FAILED"
    return f"[{code}] {_MESSAGES[code]}"
