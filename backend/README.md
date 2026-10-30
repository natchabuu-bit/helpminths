# HelpMinths AI API

FastAPI สำหรับตรวจคุณภาพภาพ เรียก YOLO detection ที่ฝึกแล้ว และจัดการบัญชี ประวัติ การตรวจทาน และรายงานบนพื้นที่ส่วนตัว ระบบบัญชีและ SQLite เปิดเมื่อระบุ `HELPMINTHS_DATA_DIR` เท่านั้น ไม่มีการสร้างผู้ใช้หรือผลตรวจเริ่มต้น อ่าน [คู่มือตั้งค่าแพลตฟอร์ม](../docs/platform/README.th.md) สำหรับ configuration, deployment, roles และ backup

## ติดตั้งและรัน

จากราก repository ใช้ Python 3.12:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

`requirements.lock` รวม dependencies และเครื่องมือทดสอบที่ล็อกเวอร์ชันแล้ว PDF ภาษาไทยใช้ fpdf2/HarfBuzz กับ Noto Sans Thai ที่รวมไว้ภายใต้ SIL OFL ไม่เรียกฟอนต์ภายนอก ส่วน Ultralytics/PyTorch ติดตั้งเพิ่มเติมเมื่อมี weights ที่เชื่อถือได้

เปิด OpenAPI ที่ `http://localhost:8000/docs` หรือ `/openapi.json` สำหรับ schema ล่าสุด หากต้องการเว็บบน server เดียว:

```bash
npm ci
npm run build
HELPMINTHS_SERVE_WEB=1 .venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

โหมดนี้ต้องมี `dist/index.html` มิฉะนั้น startup จะหยุดพร้อมคำแนะนำ `.env` ไม่ถูกอ่านอัตโนมัติ ต้อง export variables หรือกำหนดผ่านโฮสต์ก่อนเริ่ม process

## บัญชีแรกและการยืนยันคำขอ

```bash
export HELPMINTHS_DATA_DIR=/private/persistent/helpminths
# ใช้0เฉพาะ HTTP ในเครื่อง ตั้ง1เมื่อใช้ HTTPS จริง
export HELPMINTHS_COOKIE_SECURE=0
.venv/bin/python -m backend.platform.bootstrap --username operator
```

CLI ถามรหัสผ่านอย่างน้อย12ตัวอักษรผ่าน getpass และสร้างได้เมื่อยังไม่มีบัญชีเท่านั้น เข้าสู่ระบบจากหน้า **บัญชีและการตั้งค่า** แล้ว admin สร้าง reviewer/lab/student ต่อได้ ไม่มี public registration หรือรหัสผ่านเริ่มต้น

Passwords เป็น salted scrypt; เก็บเฉพาะ hash ของ session token ใน SQLite Cookie `helpminths_session` ใช้ HttpOnly/SameSite=Lax/Secure ค่าเริ่มต้น การปิดบัญชี เปลี่ยนบทบาท หรือเปลี่ยนรหัสผ่านจะเพิกถอน sessions เดิม

`GET /api/platform/session` คืน user และ `csrf_token` ให้ client บน origin เดียวกัน ทุก authenticated POST/PATCH/DELETE ต้องส่ง `X-CSRF-Token` คู่กับ cookie ตรวจ Origin ของคำขอเบราว์เซอร์ด้วย ไม่เปิด wildcard CORS ใช้ frontend API client ที่รวมไว้ได้เลย Vite proxy รักษา Host เดิมเพื่อการตรวจ Origin ให้เข้าเว็บด้วย hostname เดิมตลอดเซสชัน เช่นใช้ localhost สม่ำเสมอ

Lab เข้าถึงรายการของตนเอง Reviewer/admin เข้าถึงรายการเพื่อทบทวนตามหน้าที่ นักศึกษาใช้ Learning Lab แต่สร้างรายการตรวจหรือยืนยันผลไม่ได้ จัดการผู้ใช้เฉพาะ admin ลบรายการเฉพาะเจ้าของหรือ admin โดยตรวจ revision

## สถานะ configuration

- ไม่ตั้ง data directory: session คืน `configured:false`; endpoints ฐานข้อมูลตอบ503; Atlas/สาธิต/quality ยังใช้ได้ API เดิม `/api/analyze` ไม่เก็บภาพ/ผลลงดิสก์
- ตั้ง data directory แต่ไม่มีผู้ใช้: สร้าง schema เปล่าและ private image directory; `bootstrap_required:true`; ต้องใช้ CLI สร้าง admin
- ไม่มีโมเดลพร้อมใช้: health/status รายงาน readyfalse; inference ตอบ503 ไม่มีคำทำนายทดแทน
- ส่งตรงไป persistent inference ขณะโมเดลไม่พร้อม: อาจสร้างรายการ **failed** พร้อม quality/image ตามจริง คืน `analysis_id` เพื่อการตรวจสอบ ไม่ได้คืนผล AI สำเร็จ

Health พร้อมตอบไม่ได้แปลว่า model/database พร้อม ให้ตรวจ `/api/platform/status` ร่วมด้วย

## API หลัก

พาธในตารางต่อจาก `/api/platform` เว้นแต่ระบุเต็ม รายละเอียด fields/เพดานแต่ละ endpoint ดู OpenAPI

| Method และพาธ | ความสามารถ/สิทธิ์ |
| --- | --- |
| `GET /api/health` | Health และสถานะโมเดลสาธารณะ |
| `GET /status`, `GET /session` | Configuration และ session ปัจจุบัน |
| `POST /login`, `POST /logout` | เข้าสู่ระบบ/ออกจากระบบ logout ต้อง CSRF |
| `GET/POST /users`, `PATCH /users/{id}` | Admin จัดการบัญชี ไม่คืน password hash |
| `GET /quality/config`, `POST /quality` | Threshold และ heuristic quality; multipart image ไม่เก็บภาพ |
| `POST /analyses` | Lab/reviewer/admin; multipart image/sample_code/site_code/confidence/acknowledge_quality/quality_comment |
| `GET /analyses`, `GET /analyses/{id}` | ค้นหา กรอง แบ่งหน้า และ detail ตามสิทธิ์ |
| `GET /analyses/{id}/image` | Normalized PNG ส่วนตัว ตรวจสิทธิ์ทุกครั้ง |
| `DELETE /analyses/{id}?expected_revision=…` | เจ้าของ/admin เอาภาพออกและ soft-delete คง audit |
| `GET/POST /analyses/{id}/reviews` | ประวัติ/สร้าง review; POST เฉพาะ reviewer/admin |
| `GET /analyses/{id}/audit` | ประวัติผลก่อนหลังตามสิทธิ์ |
| `POST /analyses/{id}/report.pdf` | PDF ภาษาไทยจาก record จริง มี CSRF บันทึก metadata การสร้าง |
| `GET /analyses/{id}/export.csv`, `GET /exports.csv` | CSV รายกรณีหรือหลายกรณีตามสิทธิ์/ตัวกรอง |
| `GET /reports`, `GET /dashboard` | Metadata รายงานและสรุป SQL ตาม scope |
| `GET/POST /feedback`, `PATCH /feedback/{id}` | ส่ง feedback; reviewer/admin ตรวจหลักฐาน |
| `GET/POST /models` | รุ่นจริง; POST admin บันทึก declaration ของรุ่นที่โหลดอยู่ ไม่ deploy weights |
| `GET /evaluation` | Independent evaluation ที่คำนวณจริง หรือ unavailable |
| `GET/POST /evaluation/datasets`, `POST /evaluation/run` | Reviewer/admin อนุมัติ ground truth อิสระและคำนวณ |
| `GET /learning/catalog` | คลังพร้อมที่มา/สิทธิ์/สถานะอนุมัติ ไม่ต้อง login |
| `POST /learning/approvals` | Reviewer/admin ทวนฉลาก สิทธิ์ และข้อจำกัด |
| `POST /learning/quizzes`, `GET /learning/quizzes/{id}` | แบบฝึกหัดจากภาพที่อนุมัติแล้วของผู้ใช้ที่ login |
| `GET /learning/quizzes/{id}/images/{question_id}` | ภาพคำถามตามสิทธิ์ quiz |
| `POST /learning/quizzes/{id}/submit` | ให้คะแนน server-side บันทึกได้ครั้งเดียว |
| `GET /learning/attempts`, `GET /learning/attempts/{id}`, `GET /learning/progress` | คะแนน คำตอบ ความก้าวหน้าจริง |

List endpoints ใช้ `limit`/`offset` ประวัติกรอง Analysis ID, วันที่, predicted class, analysis/review status, model version และ site code ขอบเขตวันใช้เวลาไทย ส่วน timestamps เก็บ UTC

## ภาพและผลตรวจ

รองรับ JPEG/PNG/WebP ไม่เกิน20MB/40ล้านพิกเซล ตรวจ bytes/format/decode/decompression limit และหมุนตาม EXIF ก่อนใช้ พิกัด `[x1,y1,x2,y2]` เป็นพิกเซลบนภาพที่แก้ orientation แล้ว Prediction มี `{id,class_id,label,confidence,bbox}`

ก่อน persistent inference จะประเมิน quality อีกครั้งบน backend ภาพ warning ต้องมี `acknowledge_quality=true` พร้อมเหตุผลไม่ว่างเมื่อเปิด override ถ้าปิด override จะข้ามไม่ได้ ผล quality ถูกบันทึกสำหรับ workflow จริง

ภาพ persisted เป็น PNG ที่แก้ orientation/สีและล้าง metadata ชื่อไฟล์เป็น ID สุ่ม **ไม่ใช่ต้นฉบับแบบ byte-for-byte** หากต้องเก็บ raw เพื่อวิจัยให้ใช้ระบบต้นทางตามนโยบายสถาบัน ภาพ/DB อยู่นอก public/dist API ส่ง no-store และไม่อยู่ใน offline cache

API เดิม `POST /api/analyze` ยังทำงานชั่วคราว รับ `image`, `confidence` เริ่มต้น.15, `acknowledge_quality`, `quality_comment` ไม่สร้าง record/review/report ผลตอบกลับคง fields เดิม เพิ่ม quality/model_version/storage ตามจริง เมื่อเปิดฐานข้อมูล เส้นทางเดิมนี้บังคับบัญชี lab/reviewer/admin และ CSRF เช่นเดียวกัน เพื่อไม่ให้ข้ามสิทธิ์ผ่าน API หน้าตรวจใช้ platform API เมื่อเปิดระบบบัญชีแล้ว

## โมเดลและการประเมิน

```bash
.venv/bin/python -m pip install -r backend/requirements-model.txt
export HELPMINTHS_MODEL_PATH=/private/models/best.pt
export HELPMINTHS_TRAINING_DATASET_VERSION=reviewed-training-v1
export HELPMINTHS_VALIDATION_DATASET_VERSION=independent-test-v1
```

Restart API ใช้ `.pt` detection ที่เชื่อถือได้เพราะ checkpoint อาจเรียกโค้ดระหว่างโหลด ไม่มี download weights อัตโนมัติ ใช้ `model.names` และ SHA-256 จริง ไม่สร้าง mapping ตาม Atlas เอง ประมวลผล CPU/ปรับภาพและ NMS ตาม Ultralytics ยังไม่มี tiled inference และไม่มีการทดสอบ weights จริงใน repo นี้ Dataset metadata จาก env เป็นคำประกาศผู้ดูแล ไม่ใช่ provenance ที่ตรวจอัตโนมัติ

การประเมินต้องมี analysis สำเร็จ/รุ่นจริง, ground-truth กรอบ/ชนิดที่ตรวจแล้ว และคำอธิบายการแยก test set อิสระ เก็บ group_code ไม่ระบุตัวบุคคลเพื่ออ้าง slide/specimen สูงสุด200ภาพ/ground truth5000วัตถุต่อชุด; รอบคำนวณจำกัด prediction+ground truth รวม5000วัตถุ

คำนวณ one-to-one IoU matching ตาม confidence มี precision/recall/F1/AP101point/mAP50–95 และ confusion matrix ที่จับคู่แยกขั้นตอน Metrics ใช้ saved detections หลัง inference threshold ไม่เทียบเท่า official COCO evaluator และเรียกวัตถุที่กรองทิ้งกลับมาไม่ได้ ต้องระบุ threshold/dataset/sample size การยืนยัน feedback ไม่เปลี่ยนเป็น ground truth หรือข้อมูลฝึกอัตโนมัติ ความเป็นอิสระของข้อมูลต้องตรวจจริงโดยทีมวิจัย

## ข้อผิดพลาดและขีดจำกัด

`400` ภาพเสีย, `401` session ขาด/หมดอายุ, `403` สิทธิ์/CSRF, `409` revision/สถานะขัดกัน, `410` ภาพถูกนำออก, `413` เกินขีดจำกัด, `415` ชนิดภาพ, `422` input/quality, `429` rate/busy, `503` ฐานข้อมูล/โมเดล/dependency ไม่พร้อม

จำกัด request body ก่อน multipart parser: ภาพรวม multipart21MiB (รวม overhead) และ JSON1MiB ทั้ง Content-Length และ streaming; ไฟล์ภาพยังจำกัด20MiB มี rate limit login/persistent analysis ต่อ process และ shared image-work slot สำหรับ decode/quality/inference/PDF เมื่อ busy ตอบ429พร้อม Retry-After ไม่ใช่ distributed queue หากเพิ่ม replica ต้องเพิ่ม shared limits และออกแบบ DB/storage ที่เหมาะสม CSV UTF-8 BOM ใช้ csv.writer/ป้องกัน formula injection แบบกรองสูงสุด1000รายการ/25000วัตถุ เลือก ID โดยตรงสูงสุด200รายการ

SQLite schema version1 สร้างเมื่อเปิด private directory ไม่มี seed เก็บ entities ใน generic JSON documents พร้อม owner/revision/soft-delete และ append-only audit triggers อ่าน schema/backup/retention ในคู่มือแพลตฟอร์ม

## ทดสอบ

```bash
.venv/bin/python -m pytest backend/tests -q
```

ครอบคลุม upload/EXIF, quality, auth/CSRF/ACL, immutable prediction/review/audit, counting, learning, Thai PDF/CSV, SQL aggregation และ evaluation math ด้วยภาพสังเคราะห์/predictor ที่ฉีดเฉพาะ tests อ่าน [หลักฐานตรวจสอบ](../docs/platform/VALIDATION.md) การผ่าน tests ไม่ยืนยันความแม่นยำ YOLO หรือรับรองการใช้งานทางคลินิก

`backend.tests.ui_fixture` เป็น server เฉพาะทดสอบ ต้องเปิดด้วย env ใช้ temporary DB/บัญชี/ตัวทำนายสังเคราะห์ ห้ามใช้เป็น production app หรือหลักฐานความแม่นยำ ดูวิธีรันในคู่มือแพลตฟอร์ม
