"""Authorized Unicode Thai PDF and CSV exports of actual analysis records."""
from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageFont

from backend.platform.auth import assert_access, get_store, require_user
from backend.platform.store import flatten_document
from backend.platform._report_data import analysis_documents, analysis_query, flattened_analysis, latest_review, object_rows

router = APIRouter(prefix='/api/platform', tags=['Smart reports'])
FONT_DIR = Path(__file__).resolve().parents[1] / 'assets' / 'fonts'
DISCLAIMER = 'ผลลัพธ์จาก HelpMinths AI เป็นผลการวิเคราะห์โดยระบบปัญญาประดิษฐ์ ควรได้รับการตรวจสอบโดยผู้เชี่ยวชาญก่อนนำไปใช้ประกอบการตัดสินใจทางคลินิก'
MAX_EXPORT_OBJECTS = 25_000
CSV_FIELDS = ['analysis_id', 'sample_code', 'analysis_timestamp', 'analysis_status', 'object_id', 'object_origin',
              'predicted_class', 'confidence', 'predicted_bbox', 'reviewer_bbox', 'effective_bbox', 'reviewer_label', 'review_action', 'expert_verification_status',
              'reviewer_id', 'reviewed_at', 'quality_status', 'inference_ms', 'model', 'model_version']


def safe_csv_cell(value) -> str:
    if value is None:
        return ''
    text = str(value).replace('\0', '')
    # Spaces/tabs before formula characters are also handled by common spreadsheets.
    if text.lstrip(' \t\r\n').startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')):
        return "'" + text
    return text


def csv_bytes(store, analyses: list[dict]) -> bytes:
    output = io.StringIO(newline='')
    writer = csv.writer(output, lineterminator='\r\n')
    writer.writerow(CSV_FIELDS)
    exported_objects = 0
    for document in analyses:
        analysis = flattened_analysis(document)
        rows = object_rows(store, document)
        exported_objects += len(rows)
        if exported_objects > MAX_EXPORT_OBJECTS:
            raise HTTPException(413, 'ผลส่งออกเกิน 25,000 วัตถุ กรุณาลดช่วงข้อมูล')
        if not rows:
            rows = [{}]  # Preserve a real zero-object/failed analysis without inventing an object.
        for row in rows:
            values = [analysis['id'], analysis.get('sample_code'), analysis.get('created_at'), analysis.get('status'),
                      row.get('object_id'), row.get('origin'), row.get('predicted_class'), row.get('confidence'),
                      *[json.dumps(row.get(key), ensure_ascii=False) if row.get(key) is not None else ''
                        for key in ('predicted_bbox', 'reviewer_bbox', 'effective_bbox')], row.get('reviewer_label'),
                      row.get('review_action'), analysis.get('review_status'), row.get('reviewer_id'), row.get('reviewed_at'),
                      analysis.get('quality', {}).get('overall_status', analysis.get('quality', {}).get('status', 'unavailable')),
                      analysis.get('duration_ms'), analysis.get('model'), analysis.get('model_version')]
            writer.writerow([safe_csv_cell(value) for value in values])
    return ('\ufeff' + output.getvalue()).encode('utf-8')


def report_ready() -> bool:
    try:
        import fpdf  # noqa: F401
        import uharfbuzz  # noqa: F401
    except ImportError:
        return False
    return all((FONT_DIR / name).is_file() for name in ('NotoSansThai-Regular.ttf', 'NotoSansThai-Bold.ttf'))


def _display_time(value: str | None) -> str:
    if not value:
        return 'ยังไม่มีข้อมูล'
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(ZoneInfo('Asia/Bangkok')).strftime('%Y-%m-%d %H:%M:%S %z')
    except (ValueError, TypeError):
        return str(value)


def _report_images(path: Path, rows: list[dict]) -> tuple[bytes, bytes, float]:
    # Render thumbnails for the report only; the private original is unchanged.
    with Image.open(path) as source:
        original_width, original_height = source.size
        source.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        image = source.convert('RGB')
    original = io.BytesIO()
    image.save(original, format='PNG')
    draw = ImageDraw.Draw(image)
    scale_x, scale_y = image.width / original_width, image.height / original_height
    width = max(2, round(image.width / 350))
    font = ImageFont.truetype(str(FONT_DIR / 'NotoSansThai-Regular.ttf'), max(12, round(image.width / 65)))
    for index, row in enumerate(rows, 1):
        bbox = row.get('effective_bbox', row.get('bbox'))
        if not bbox or len(bbox) != 4:
            continue
        x1, y1, x2, y2 = [float(value) for value in bbox]
        x1, x2, y1, y2 = x1 * scale_x, x2 * scale_x, y1 * scale_y, y2 * scale_y
        corrected_bbox = row.get('reviewer_bbox') is not None and row.get('reviewer_bbox') != row.get('predicted_bbox')
        color = '#196db0' if row.get('origin') == 'expert_added' else '#a12b37' if row.get('review_action') == 'false_positive' else '#b35c00' if corrected_bbox else '#107c5a'
        draw.rectangle((x1, y1, x2, y2), outline=color, width=width)
        label = ('E' if row.get('origin') == 'expert_added' else 'D') + str(index)
        text_box = draw.textbbox((0, 0), label, font=font)
        text_w, text_h = text_box[2] + 8, text_box[3] - text_box[1] + 8
        top = max(0, y1 - text_h)
        draw.rectangle((x1, top, min(image.width, x1 + text_w), top + text_h), fill=color)
        draw.text((x1 + 4, top + 2 - text_box[1]), label, fill='white', font=font)
    annotated = io.BytesIO()
    image.save(annotated, format='PNG')
    aspect = image.height / image.width
    image.close()
    return original.getvalue(), annotated.getvalue(), aspect


def make_pdf(analysis: dict, review: dict | None, rows: list[dict], image_path: Path, report_id: str, generated_at: str) -> bytes:
    if not report_ready():
        raise HTTPException(503, 'PDF reports Not configured: ติดตั้งส่วนสร้าง PDF และฟอนต์ภาษาไทยก่อนใช้งาน')
    from fpdf import FPDF
    from fpdf.enums import XPos, YPos
    from fontTools.ttLib import TTFont

    class ReportPDF(FPDF):
        def footer(self):
            self.set_y(-16)
            self.set_font('NotoThai', size=8)
            self.set_text_color(78, 99, 118)
            self.cell(0, 5, f'HelpMinths AI | {report_id} | {self.page_no()}/{{nb}}', align='C')

    pdf = ReportPDF(format='A4')
    pdf.set_margins(14, 14, 14)
    pdf.set_auto_page_break(True, margin=23)
    pdf.add_font('NotoThai', fname=str(FONT_DIR / 'NotoSansThai-Regular.ttf'))
    pdf.add_font('NotoThai', style='B', fname=str(FONT_DIR / 'NotoSansThai-Bold.ttf'))
    pdf.set_text_shaping(True)
    pdf.alias_nb_pages()
    pdf.set_title('HelpMinths AI — รายงานผลวิเคราะห์ภาพ')
    pdf.set_author('HelpMinths AI')
    cmap = TTFont(FONT_DIR / 'NotoSansThai-Regular.ttf').getBestCmap()

    def text(value) -> str:
        # Keep unrenderable code points explicit rather than silently dropping data.
        return ''.join(character if ord(character) in cmap or character in '\n\t' else f'[U+{ord(character):04X}]' for character in str(value or ''))

    def paragraph(value, *, bold=False, size=10, color=(23, 44, 64), spacing=2):
        pdf.set_font('NotoThai', 'B' if bold else '', size)
        pdf.set_text_color(*color)
        pdf.multi_cell(0, 5.7 if size <= 10 else 7.2, text(value), align='L', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(spacing)

    def section(value):
        pdf.ln(3)
        paragraph(value, bold=True, size=13, color=(29, 87, 126), spacing=3)

    pdf.add_page()
    paragraph('HelpMinths AI', bold=True, size=22, color=(23, 66, 98))
    paragraph('รายงานการวิเคราะห์ภาพกล้องจุลทรรศน์ / Microscopy analysis report', size=13)
    paragraph(f'Report ID: {report_id}\nAnalysis ID: {analysis["id"]}\nรหัสตัวอย่าง: {analysis.get("sample_code") or "ไม่ระบุ"}\nรหัสสถานที่: {analysis.get("site_code") or "ไม่ระบุ"}')
    paragraph(f'วันที่วิเคราะห์: {_display_time(analysis.get("created_at"))}\nสร้างรายงาน: {_display_time(generated_at)}\nสถานะการประมวลผล: {analysis.get("status", "ไม่ระบุ")}\nสถานะผู้เชี่ยวชาญ: {analysis.get("review_status", "pending")}')
    paragraph(f'โมเดล: {analysis.get("model") or "Not configured"}\nรุ่นโมเดล: {analysis.get("model_version") or "ไม่มีข้อมูลรุ่น"}\nInference latency: {analysis.get("duration_ms") if analysis.get("duration_ms") is not None else "ไม่มีข้อมูล"} ms')
    if analysis.get('error_message'):
        paragraph(f'ข้อผิดพลาด: {analysis["error_message"]}', color=(147, 42, 56))
    review_data = review.get('data', review) if review else {}
    if review_data:
        paragraph(f'ผู้ตรวจสอบ: {review_data.get("reviewer_username") or review_data.get("reviewer_id", "ไม่ระบุ")}\nตรวจเมื่อ: {_display_time(review_data.get("reviewed_at"))}\nสถานะการตรวจ: {review_data.get("status")}\nหมายเหตุ: {review_data.get("comment") or "ไม่มี"}')
    else:
        paragraph('ยังไม่มีผลตรวจสอบจากผู้เชี่ยวชาญ ผลนี้เป็นผล AI ที่ยังไม่ยืนยัน', color=(128, 80, 22))
    section('1. ภาพต้นฉบับและภาพแสดงตำแหน่ง')
    paragraph('ภาพต้นฉบับที่ปรับ EXIF orientation และลบ metadata เพื่อจัดเก็บอย่างปลอดภัย ไม่มีการสร้างหรือเติมภาพไข่ขึ้นใหม่', size=9)
    available = pdf.epw
    image_width = (available - 6) / 2
    original_image, annotated_image, aspect = _report_images(image_path, rows)
    image_height = min(90, image_width * aspect)
    if pdf.get_y() + image_height + 18 > pdf.h - 24:
        pdf.add_page()
    y = pdf.get_y()
    pdf.image(io.BytesIO(original_image), x=pdf.l_margin, y=y, w=image_width, h=image_height, keep_aspect_ratio=True)
    pdf.image(io.BytesIO(annotated_image), x=pdf.l_margin + image_width + 6, y=y, w=image_width, h=image_height, keep_aspect_ratio=True)
    pdf.set_y(y + image_height + 3)
    paragraph('ภาพในรายงานย่อไม่เกิน 1,600 พิกเซลเพื่อจัดหน้า ต้นฉบับในระบบไม่ได้ลดความละเอียด\nซ้าย: ภาพต้นฉบับ | ขวา: กรอบที่ใช้แสดงผล (effective bbox) ของวัตถุ AI (D) และวัตถุที่ผู้เชี่ยวชาญเพิ่ม (E)\nกรอบแสดงตำแหน่งที่ผู้เชี่ยวชาญตรวจทานเมื่อมี มิฉะนั้นใช้ตำแหน่ง AI เดิม พิกัดทั้งสองเก็บแยกกันในตารางรายวัตถุ\nสีเขียว: AI / สีส้ม: ตำแหน่งแก้ไขโดยผู้เชี่ยวชาญ / สีแดง: marked false positive / สีน้ำเงิน: เพิ่มโดยผู้เชี่ยวชาญ', size=9)
    section('2. คุณภาพภาพเบื้องต้น')
    quality = analysis.get('quality', {})
    paragraph(f'สถานะคุณภาพภาพ: {quality.get("overall_status", quality.get("status", "ไม่มีข้อมูล"))}')
    checks = quality.get('checks', [])
    if isinstance(checks, dict):
        checks = [{'name': key, **value} if isinstance(value, dict) else {'name': key, 'value': value} for key, value in checks.items()]
    for check in checks:
        paragraph(f'{check.get("label", check.get("name", check.get("id", "รายการ")))}: {check.get("status", "ไม่ระบุ")} | {check.get("message", check.get("description", ""))} | ค่า {check.get("value", "ไม่ระบุ")}', size=9)
    paragraph('การประเมินด้วย heuristic นี้ไม่ยืนยันว่าภาพเหมาะสมสำหรับวินิจฉัยทางคลินิก', size=9)
    section('3. ผลรายวัตถุและการตรวจทาน')
    for index, row in enumerate(rows, 1):
        prefix = ('E' if row.get('origin') == 'expert_added' else 'D') + str(index)
        score = f'{row["confidence"]:.4f}' if isinstance(row.get('confidence'), (int, float)) else 'ไม่ใช่ค่าจากโมเดล'
        reviewer_label = row.get('reviewer_label') or ('ไม่ใช่วัตถุเป้าหมาย (false positive)' if row.get('review_action') == 'false_positive' else 'ยังไม่สามารถยืนยัน' if row.get('review_action') in ('uncertain', 'request_review') else 'ยังไม่ยืนยัน')
        paragraph(f'{prefix} | ID {row.get("object_id")}\nAI: {row.get("predicted_class") or "ไม่มี prediction"} | Model confidence: {score}\nผู้เชี่ยวชาญ: {reviewer_label} | Action: {row.get("review_action", "unreviewed")}\nพิกัดในภาพต้นฉบับ [x1,y1,x2,y2]\nAI bbox (prediction เดิม): {row.get("predicted_bbox")}\nReviewer bbox (ผู้เชี่ยวชาญ): {row.get("reviewer_bbox")}\nEffective bbox (กรอบที่แสดง): {row.get("effective_bbox", row.get("bbox"))}', size=9)
    if not rows:
        paragraph('ไม่พบวัตถุในผลที่จัดเก็บ การไม่พบในภาพนี้ไม่ยืนยันว่าไม่มีพยาธิ')
    predicted_counts = {}
    for detection in analysis.get('detections', []):
        label = detection.get('label', '')
        predicted_counts[label] = predicted_counts.get(label, 0) + 1
    paragraph('จำนวนที่ AI ตรวจพบตามชื่อคลาส: ' + (', '.join(f'{label}: {count}' for label, count in predicted_counts.items()) or '0'))
    from backend.platform.analyses import effective_counts
    counts = effective_counts(analysis, review)
    paragraph(f'จำนวนวัตถุที่ผู้เชี่ยวชาญตรวจทาน: {counts["confirmed_total"]} | False positive: {counts["false_positive_total"]} | Uncertain: {counts["uncertain_total"]}')
    paragraph('จำนวนตามฉลากผู้เชี่ยวชาญ: ' + (', '.join(f'{label}: {count}' for label, count in counts['by_confirmed_class'].items()) or '0'))
    paragraph('การตรวจทานรายวัตถุไม่เท่ากับการยืนยันผลทั้งภาพ โปรดอ่านสถานะ Expert verification ข้างต้นร่วมด้วย', size=9)
    paragraph('Model confidence เป็นค่าของโมเดล ไม่ใช่โอกาสติดเชื้อ ไม่คำนวณ EPG หรือระดับความรุนแรงจากภาพทั่วไป', size=9)
    section('4. ข้อจำกัดและสถานะผล')
    paragraph(DISCLAIMER, size=10)
    paragraph('การแก้ไขผลโดยผู้เชี่ยวชาญไม่เปลี่ยน prediction เดิมหรือ model weights โดยอัตโนมัติ รายงานนี้อ้าง revision ' + str(analysis.get('revision', 'ไม่ระบุ')), size=9)
    return bytes(pdf.output())


@router.post('/analyses/{analysis_id}/report.pdf')
def create_report(analysis_id: str, request: Request, user: Annotated[dict, Depends(require_user)]):
    from backend.platform.analyses import analysis_image_path, get_analysis
    store = get_store(request)
    document = get_analysis(store, analysis_id, user)
    analysis = flatten_document(document)
    path = analysis_image_path(store, document)
    if not path.is_file():
        raise HTTPException(410, 'ภาพต้นฉบับไม่พร้อมใช้งานหรือถูกลบตามนโยบายเก็บรักษา')
    report_id, generated_at = uuid.uuid4().hex, datetime.now(timezone.utc).isoformat()
    try:
        from backend.platform.quality import image_work_slot
        with image_work_slot():
            payload = make_pdf(analysis, latest_review(store, document), object_rows(store, document), path, report_id, generated_at)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(500, 'สร้างรายงาน PDF ไม่สำเร็จ กรุณาตรวจข้อมูลและส่วนสร้างรายงาน') from None
    store.create_document('report', {'analysis_id': analysis_id, 'analysis_revision': analysis['revision'], 'format': 'pdf',
                          'generated_at': generated_at, 'generated_by': user['id'], 'model_version': analysis.get('model_version'),
                          'review_status': analysis.get('review_status')}, document['owner_id'], user['id'], document_id=report_id)
    return Response(payload, media_type='application/pdf', headers={'Content-Disposition': f'attachment; filename="HelpMinths-{analysis_id}.pdf"', 'Cache-Control': 'no-store'})


@router.get('/analyses/{analysis_id}/export.csv')
def export_analysis(analysis_id: str, request: Request, user: Annotated[dict, Depends(require_user)]):
    from backend.platform.analyses import get_analysis
    store = get_store(request)
    document = get_analysis(store, analysis_id, user)
    return Response(csv_bytes(store, [document]), media_type='text/csv; charset=utf-8', headers={'Content-Disposition': f'attachment; filename="HelpMinths-{analysis_id}.csv"', 'Cache-Control': 'no-store'})


@router.get('/exports.csv')
def export_many(request: Request, user: Annotated[dict, Depends(require_user)], ids: str | None = None,
                date_from: str | None = None, date_to: str | None = None, predicted_class: str | None = None,
                analysis_status: str | None = None, review_status: str | None = None, model_version: str | None = None, site_code: str | None = None):
    from backend.platform.analyses import get_analysis
    store = get_store(request)
    if ids:
        selected = list(dict.fromkeys(value.strip() for value in ids.split(',') if value.strip()))
        if not selected or len(selected) > 200:
            raise HTTPException(422, 'ส่งออกรายการที่เลือกได้ครั้งละ 1–200 รายการ')
        documents, object_count = [], 0
        for analysis_id in selected:
            document = get_analysis(store, analysis_id, user)
            object_count += len(document['data'].get('detections', []))
            if object_count > MAX_EXPORT_OBJECTS:
                raise HTTPException(413, 'ผลส่งออกเกิน 25,000 วัตถุ กรุณาลดจำนวนรายการ')
            documents.append(document)
    else:
        filters = dict(date_from=date_from, date_to=date_to, predicted_class=predicted_class, analysis_status=analysis_status,
                       review_status=review_status, model_version=model_version, site_code=site_code)
        where, parameters = analysis_query(user, filters)
        with store.connection() as connection:
            total = connection.execute(f'SELECT COUNT(*) FROM documents d WHERE {where}', parameters).fetchone()[0]
            object_count = connection.execute(f"SELECT COALESCE(SUM(json_array_length(d.data,'$.detections')),0) FROM documents d WHERE {where}", parameters).fetchone()[0]
        if object_count > MAX_EXPORT_OBJECTS:
            raise HTTPException(413, 'ผลส่งออกเกิน 25,000 วัตถุ กรุณาระบุช่วงข้อมูลเพิ่มเติม')
        if total > 1000:
            raise HTTPException(413, 'ผลส่งออกเกิน 1,000 รายการ กรุณาระบุช่วงวันที่หรือตัวกรองเพิ่มเติม')
        documents = analysis_documents(store, user, filters, limit=1000)
    return Response(csv_bytes(store, documents), media_type='text/csv; charset=utf-8', headers={'Content-Disposition': 'attachment; filename="HelpMinths-analyses.csv"', 'Cache-Control': 'no-store'})


@router.get('/reports')
def list_reports(request: Request, user: Annotated[dict, Depends(require_user)], limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0)):
    store = get_store(request)
    owner_id = None if user['role'] in ('admin', 'reviewer') else user['id']
    items = store.list_documents('report', owner_id=owner_id, limit=limit, offset=offset)
    return {'items': [flatten_document(item) for item in items], 'total': store.count_documents('report', owner_id=owner_id), 'limit': limit, 'offset': offset}
