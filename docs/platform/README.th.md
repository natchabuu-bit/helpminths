# คู่มือตั้งค่า HelpMinths AI platform

ปรับเอกสารวันที่ 30 ตุลาคม 2569 คู่มือนี้อธิบายซอร์สปัจจุบัน ไม่ยืนยันว่า Render deploy รุ่นนี้แล้ว ผล HelpMinths AI ต้องได้รับการตรวจสอบโดยผู้เชี่ยวชาญก่อนใช้ประกอบการตัดสินใจทางคลินิก

## โครงสร้างและสถานะเริ่มต้น

React19/TypeScript/Vite แสดงเว็บภาษาไทยและ Atlas Three.js; FastAPI/Pillow ตรวจภาพและเรียก optional Ultralytics YOLO; SQLite เก็บบัญชี/ผล/ประวัติ; normalized PNG อยู่ใน private filesystem Docker รวมเว็บและ API บน origin เดียวกัน ไม่มีบริการ AI ภายนอกที่ส่งภาพให้อัตโนมัติ

เมนูมีหน้าหลัก ตรวจภาพ Atlas ประวัติ ตรวจโดยผู้เชี่ยวชาญ ห้องเรียน รายงาน ประเมินและข้อเสนอแนะ และบัญชี/ตั้งค่า ไม่มีเมนูโครงงานหรือป้ายพื้นที่ทำงาน แบบประเมินการใช้งานยังมี SUS10ข้อ/ช่อง feedback แยกจากข้อผิดพลาดโมเดล

| ส่วน | สิ่งที่มีและสิ่งที่ต้องเตรียม |
| --- | --- |
| Atlas/คลังอ้างอิง/สาธิต | ใช้ไฟล์จริงใน repo มีเครดิตและป้ายสาธิต |
| คุณภาพภาพ | Heuristic ทำงานไม่ต้องมี YOLO เกณฑ์ต้องทวนกับอุปกรณ์จริง |
| บัญชี/ประวัติ/review/report/dashboard | ปิดจนตั้ง private directory ไม่มีผู้ใช้หรือข้อมูล seed |
| AI | Not configured จนติดตั้ง runtime และ trusted weights |
| แบบฝึกหัดมีคะแนน | รอผู้ตรวจที่ได้รับสิทธิ์อนุมัติภาพ คลังภาพ/บัตรฝึกยังใช้เรียนรู้ได้ |
| ประเมินโมเดล | Unavailable จนมีผลคำนวณจาก ground truth อิสระที่อนุมัติจริง |
| EPG/ความรุนแรงการติดเชื้อ | ไม่เปิด เพราะไม่มีวิธีตรวจ/มวลตัวอย่าง/สูตร protocol ที่ยืนยัน |

## ติดตั้งในเครื่องพัฒนา

ใช้ Node.js22.12+หรือ24 และ Python3.12 จากราก repository:

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
npm run build
PORT=8080 bash scripts/start-production.sh
```

เปิด `http://localhost:8080` เว็บ/API บน origin เดียวกัน ค่าเริ่มต้นไม่สร้างฐานข้อมูล สำหรับ Codex ที่ checkout อยู่ `/workspace/helpminths` ใช้ `bash scripts/install.sh` และ `bash scripts/start.sh` เพื่อเปิด Vite5173/API8000 ได้ Vite proxy รักษา Host เพื่อให้ตรวจ Origin/CSRF ถูกต้อง ให้ใช้ hostname เดิม เช่น localhost ตลอดเซสชัน ไม่สลับกับ127.0.0.1

`npm run preview` เป็น frontend preview ไม่ใช่ backend โหมด production script ตั้ง `HELPMINTHS_SERVE_WEB=1` และต้องมี dist ที่ build แล้ว Process ที่เปิดไว้ไม่เริ่มให้อัตโนมัติเมื่อเครื่องใหม่เริ่มทำงาน

## เปิดฐานข้อมูลและสร้างบัญชีแรก

เลือกโฟลเดอร์ส่วนตัวนอก public/dist และนอก Git บนเครื่องพัฒนาใช้ local directory โดยรู้ว่าไม่ได้สำรองอัตโนมัติ:

```bash
export HELPMINTHS_DATA_DIR=/workspace/.helpminths-data
export HELPMINTHS_STORAGE_DURABLE=0
export HELPMINTHS_COOKIE_SECURE=0
.venv/bin/python -m backend.platform.bootstrap --username operator
PORT=8080 bash scripts/start-production.sh
```

CLI ถามรหัสผ่าน/ยืนยันผ่าน terminal อย่างน้อย12ตัวอักษร ไม่ใส่ password ใน command line หรือ Git สร้างได้เมื่อยังไม่มีผู้ใช้เท่านั้น จากนั้นเปิดหน้า **บัญชีและการตั้งค่า** เข้าสู่ระบบ แล้ว admin สร้างบัญชีรายคนและกำหนดบทบาท

`COOKIE_SECURE=0` ใช้เฉพาะ HTTP local เว็บจริงต้อง HTTPS/ค่า1 ห้ามเปิด HTTP สาธารณะพร้อมข้อมูลจริง พาธตัวอย่างไม่ได้ทำให้ข้อมูล workspace คงอยู่หลังลบเครื่อง

| บทบาท | ความสามารถ |
| --- | --- |
| student | เรียนรู้/ทำแบบฝึกหัด/ดูประวัติการเรียนตน ไม่สร้างรายการตรวจหรือยืนยันผล |
| lab | อัปโหลด ดูประวัติ รายงาน/feedback รายการของตน และ Learning Lab |
| reviewer | ตรวจทานผล อนุมัติภาพเรียนรู้ ตรวจ feedback และชุดประเมินตามหน้าที่ |
| admin | สิทธิ์ reviewer และจัดการบัญชี/metadata รุ่นโมเดล/ลบตามสิทธิ์ผู้ดูแล |

Backend ตรวจสิทธิ์ทุกครั้ง รวม `/api/analyze` เดิมเมื่อเปิดฐานข้อมูล: ต้องเป็น lab/reviewer/admin และส่ง CSRF เช่นกัน Lab ไม่เห็นภาพบัญชีอื่น Reviewer/admin มี scope กว้างเพื่อทบทวน จึงให้สิทธิ์เฉพาะผู้ได้รับมอบหมาย ไม่มี public registration, MFA, SSO หรือ email reset password ในรุ่นนี้ การปิดบัญชี เปลี่ยนบทบาท/รหัสผ่านเพิกถอน sessions เดิม และต้องเหลือ admin ที่ใช้งานได้อย่างน้อยหนึ่งคน

## Configuration

ตั้ง environment ใน shell หรือ dashboard ของโฮสต์ **ไม่ได้อ่าน `.env` อัตโนมัติ** `.env.example` เป็นตัวอย่าง ไม่ใส่ secrets ใน source

| Variable | เริ่มต้น | ความหมาย |
| --- | --- | --- |
| `HELPMINTHS_DATA_DIR` | ว่าง | ปิด persistent platform เมื่อว่าง เมื่อตั้งต้อง private และเขียนได้ |
| `HELPMINTHS_STORAGE_DURABLE` | `0` | ตั้ง1เมื่อผู้ดูแลตรวจ mount ถาวรจริง ไม่สร้าง disk/backup |
| `HELPMINTHS_COOKIE_SECURE` | `1` | Secure cookie สำหรับ HTTPS; HTTP local ใช้0 |
| `HELPMINTHS_SESSION_HOURS` | `8` | อายุ session บังคับ1–168ชั่วโมง |
| `HELPMINTHS_SERVE_WEB` | ไม่เปิด | ตั้ง1ให้ FastAPI เสิร์ฟ dist |
| `PORT` | `8000` ใน script/container | พอร์ต production ตามโฮสต์ |
| `HELPMINTHS_MODEL_PATH` | ว่าง | Trusted YOLO detection `.pt` ไม่มี weights download อัตโนมัติ |
| `HELPMINTHS_TRAINING_DATASET_VERSION` | ว่าง | รุ่นชุดฝึกที่ผู้ดูแลประกาศ ไม่ตรวจ provenance อัตโนมัติ |
| `HELPMINTHS_VALIDATION_DATASET_VERSION` | ว่าง | รุ่นชุดทดสอบที่ประกาศ ไม่สร้าง metrics เอง |
| `HELPMINTHS_CONFIDENCE_THRESHOLD` | `.15` | Default inference threshold ช่วง.01–.99 |
| `HELPMINTHS_REVIEW_CONFIDENCE` | `.5` | เกณฑ์รายการความมั่นใจต่ำ ช่วง.01–.99 |

Quality variables ขึ้นต้น `HELPMINTHS_QUALITY_`:

| ส่วนท้าย variable | เริ่มต้น |
| --- | --- |
| `MIN_WIDTH`, `MIN_HEIGHT` | `512`, `384`พิกเซล |
| `MIN_FOCUS_VARIANCE` | `30` |
| `MIN_BRIGHTNESS`, `MAX_BRIGHTNESS` | `35`, `225` |
| `MIN_CONTRAST` | `12` |
| `MAX_CLIPPED_FRACTION` | `.45` |
| `THUMBNAIL_SIZE` | `512` สำหรับคำนวณ heuristic |
| `ALLOW_OVERRIDE` | `1` ข้าม warning ได้เมื่อยืนยัน/มีเหตุผล; ตั้ง0เพื่อบล็อก |

สัญญาณโฟกัส/ความสว่าง/contrast เป็นการคัดกรองเบื้องต้น ไม่รับรองภาพวินิจฉัย ศึกษาความสัมพันธ์กับผลผู้เชี่ยวชาญก่อนปรับค่าตามอุปกรณ์ เกณฑ์ผิดรูปแบบต้องแก้ configuration ไม่ถูกตีความเป็นผ่านโดยเงียบ

## ขั้นตอนตรวจและทบทวน

1. Lab/reviewer/admin เลือกภาพและรหัสตัวอย่างไม่ระบุตัวบุคคล เช่น `LAB01_0042` ใช้ ASCII/ตัวเลข/underscore/hyphen1–40ตัว ห้ามใส่ชื่อหรือเลขผู้ป่วย
2. กดตรวจคุณภาพหรือเริ่มตรวจ การเลือกไฟล์อย่างเดียวไม่เริ่ม inference ภาพ warning ต้องยืนยันข้อจำกัดพร้อมเหตุผลตามนโยบาย Backend ตรวจ quality ซ้ำเพื่อกันข้าม UI
3. เมื่อโมเดลพร้อม บันทึก normalized image, quality, threshold, checkpoint version และกรอบ/class/confidence จริง จำนวนมาจากข้อมูลที่บันทึก Confidence ไม่ใช่โอกาสติดเชื้อ ผล AI สำเร็จเริ่มเป็นรอทบทวน
4. ผู้ตรวจยืนยัน แก้ชื่อ/กรอบ ทำ false positive/ไม่แน่ใจ/ขอตรวจเพิ่ม หรือเพิ่มกรอบตกหล่น ต้องทวนทั้งภาพและจัดการ prediction เดิมครบก่อน verified
5. บันทึกด้วย expected revision กันผลเก่าทับผลใหม่ เก็บ original predictions แยกจาก annotations พร้อม reviewer/time/comments/audit ไม่เปลี่ยน weights
6. ค้นประวัติ/ดาวน์โหลด PDF/CSV ตามสิทธิ์ แยกจำนวน AI กับจำนวนยืนยัน/ไม่แน่ใจ ไม่แปลงจำนวนภาพเป็น EPG

ส่งตรงไป inference ขณะโมเดลไม่พร้อมจะได้ failed จริง ไม่เติมกรอบ การหยุดรอ/timeout บน browser ไม่รับประกันว่า CPU หยุดทันที กลับไปดูประวัติก่อนส่งซ้ำ ออกจากระบบล้างข้อมูลส่วนตัวบนหน้าเว็บ แต่ไม่ลบรายการในเซิร์ฟเวอร์

## โมเดลจริงและหลักฐานความแม่นยำ

```bash
.venv/bin/python -m pip install -r backend/requirements-model.txt
export HELPMINTHS_MODEL_PATH=/private/models/helpminths/best.pt
export HELPMINTHS_TRAINING_DATASET_VERSION=reviewed-training-v1
export HELPMINTHS_VALIDATION_DATASET_VERSION=independent-test-v1
```

Restart แล้วตรวจ `/api/health` และ `/api/platform/status` ใช้ `.pt` detection ที่เชื่อถือได้เท่านั้น เพราะ checkpoint อาจรันโค้ดระหว่างโหลด Runtime optional ไม่รวม Dockerfile เริ่มต้น ต้องเตรียม image ที่ติดตั้ง requirements-model พร้อม weights แยกจาก source และทดสอบเวอร์ชัน Ultralytics/PyTorch/ทรัพยากรเครื่อง แผน Free อาจไม่เหมาะกับ memory/latency นี้

ชื่อคลาสอ่าน `model.names` รุ่นเป็น16ตัวแรกของ SHA-256 พร้อม checksum เต็ม การเพิ่ม Atlas/กรอก metadata ไม่เพิ่มคลาสให้ weights ตัวเชื่อมใช้ CPU และ resize/NMS ของ Ultralytics ไม่มี tiling/โมเดล browser หรือ physical scale calibration ต้องประเมินผล resize ต่อไข่เล็กและการซูมกล้อง การทดสอบ API หรือ3ภาพไม่พิสูจน์ความแม่นยำจริง

ผู้มีสิทธิ์สร้างชุดประเมินจาก analysis สำเร็จ ระบุ dataset version/source/group code/ground-truth กรอบและชนิด พร้อมวิธีแยกข้อมูลอิสระและการทวนฉลาก เก็บผู้อนุมัติ เวลา และ digest prediction ทีมวิจัยต้องตรวจจริงว่าภาพ specimen/slide เดียวกันไม่รั่วข้าม train/test

คำนวณ one-to-one IoU matching ตาม confidence มี precision/recall/F1/AP101point/mAP50–95 และ confusion matrix พร้อม threshold/sample size ใช้ saved predictions หลัง inference threshold จึงไม่เทียบเท่า official COCO evaluator และไม่ดึงวัตถุที่กรองทิ้งกลับมา สูงสุด200ภาพ/ground truth5000วัตถุต่อชุด รอบคำนวณจำกัด prediction+ground truth รวม5000วัตถุ Feedback งานประจำไม่เป็น independent ground truth อัตโนมัติ ไม่มีชุดที่ผ่านเงื่อนไขแสดง unavailable

## Learning Lab และสิทธิ์ภาพ

คลังปัจจุบันใช้ภาพจริง11ภาพ9กลุ่มจาก Atlas พร้อมผู้สร้าง URL และคำบรรยายภายใต้ **CC BY-NC4.0 สำหรับการใช้ที่ไม่ใช่เชิงพาณิชย์** คงเครดิตและตรวจสิทธิ์ก่อนวิจัย/เผยแพร่/ใช้เชิงพาณิชย์ OV/MIF/Echinostoma ยังไม่มีภาพยืนยันในคลัง ห้ามเผยภาพส่วนตัวเพียงเพราะเคยใช้ทดสอบ

Reviewer/admin ต้องเปิดภาพและทวน label/สิทธิ์/ข้อจำกัดจริง แล้วบันทึก approval พร้อมเหตุผล เก็บผู้ตรวจ เวลา และ fingerprint ไฟล์/metadata ไม่มีการอนุมัติอัตโนมัติ การเปลี่ยน/ถอน approval ทำให้ชุดคำถามค้างส่งคะแนนไม่ได้ ต้องเริ่มใหม่

ผู้เรียนเลือก practice/pretest/posttest ตอบหรือเลือกยังระบุไม่ได้ คะแนนคำนวณจาก reference server-side เก็บ history/คำตอบผิด/คำอธิบายและ reviewer notes จริง คะแนนเรียนรู้ไม่ใช่ความแม่นยำ YOLO ภาพเปิดใน Atlas ได้อยู่แล้ว จึงไม่ใช่การสอบป้องกันการเปิดเฉลยหรือผลการศึกษาแบบควบคุม

แก้แหล่งภาพหรือ metadata แล้วรัน `node scripts/build-learning-catalog.mjs` ก่อนทดสอบ/build เก็บ JSON catalog ใน Git ให้ backend container ใช้ได้โดยไม่อ่าน TypeScript ขณะ runtime แหล่งข้อมูลและสิทธิ์อ่านต่อ [หลักฐาน Atlas](../atlas/README.th.md)

## รายงาน Dashboard และ feedback

PDF ใช้ Noto Sans Thai/HarfBuzz ที่รวมไว้ แสดง normalized original และ annotated image พร้อม quality/threshold/model/review/เวลา การย่อภาพลง PDF ไม่เปลี่ยน stored image รายงานใหม่แต่ละครั้งมี metadata/audit ไม่แก้ผลเดิม CSV UTF-8 BOM ใช้ csv.writer/ป้องกัน formula injection แยก predicted/reviewer/effective bbox ส่งออกสูงสุด1000รายการ/25000วัตถุ หรือเลือกIDตรงได้200รายการตามสิทธิ์

Dashboard ใช้ SQL aggregation ตาม scope แยก analysis/object และ AI/verified ไม่ตีความเป็น prevalence/incidence ขอบเขตวันใช้เวลาไทย ข้อมูลว่างแสดงว่างไม่ใช้กราฟตัวอย่าง

Feedback AI มี8หมวดพร้อม Analysis ID/Object ID ตามความเหมาะสม ปัญหาเทคนิค/อื่นส่งไม่ผูก analysis ได้ ผู้ตรวจ triage พร้อมเหตุผล Classification error/false positive/missed ที่ยืนยันต้องตรงกับ review จริง ปัญหาคุณภาพต้องมี warning ปัญหาเทคนิคต้องมี failed/error code ไม่เปิด training/evaluation eligibility หรือ deploy weights อัตโนมัติ

SUS อยู่แท็บแยก ใช้คำตอบ10ข้อครบคำนวณ0–100 เก็บคำตอบล่าสุดที่ `helpminths.feedback.v1` ใน browser ไม่ส่งฐานข้อมูลกลาง เป็นคะแนนความสะดวกใช้งาน ไม่ใช่ diagnostic accuracy

## Schema และการป้องกันข้อมูล

เปิด private path แล้วสร้าง `helpminths.sqlite3` กับ `images/` permissions0700/0600 ใช้ SQLite WAL/foreign keys และ schema version1 รุ่นไม่รองรับจะปฏิเสธ ไม่เดา migration ทับข้อมูล รุ่นก่อนเก็บผลใน memory จึงไม่มี clinical DB เดิมต้องย้าย

| ตาราง | เนื้อหา |
| --- | --- |
| `schema_version` | รุ่น schema ที่รองรับ |
| `users` | Username/password hash/role/active/created |
| `sessions` | Token hash/user/expiry ไม่มี raw token |
| `documents` | Kind/owner/JSON data/time/revision/soft-delete |
| `audit_logs` | Actor/action/before/after/time; SQL triggers ห้าม UPDATE/DELETE |

Document kinds ได้แก่ analysis, quality_assessment, review, feedback, report, model_version, learning_approval, learning_quiz, learning_attempt, evaluation_dataset, evaluation_result ไม่สร้างตารางซ้ำทุก entity

ภาพใช้ ID สุ่ม ล้าง EXIF/ICC และ metadata จึงไม่ใช่ raw byte-for-byte ถ้าจำเป็นต้องเก็บ raw เพื่อวิจัยให้จัดระบบต้นทางตามนโยบาย ไม่มีไฟล์ private ใน public/dist หรือ service worker cache

ตรวจภาพ20MB/40MP; จำกัด request body multipart รวม21MiB และ JSON1MiB รวม streamed/chunked; shared image-work slot ลด memory peak; login/analysis rate limit ต่อ process ไม่ใช่ distributed gateway หากเพิ่ม replica ต้องออกแบบ limits/DB/storage ใหม่

Session cookie HttpOnly/Secure/SameSite=Lax; writes ตรวจ CSRF/Origin; API no-store/nosniff ไม่มี application-level DB encryption หรือใบรับรอง penetration test ผู้ดูแลต้องจัด TLS/ดิสก์เข้ารหัส/สิทธิ์เครื่อง/backup/access policy

## สำรองข้อมูลและการเก็บรักษา

Git/ZIP โค้ดไม่รวม private data ต้องสำรอง SQLite **พร้อมภาพอย่างสอดคล้องกัน** รวม weights/configuration/runtime ตามสิทธิ์ และทดสอบ restore จริง เก็บแยกจาก repository สาธารณะ

วิธีง่ายสำหรับระบบเครื่องเดียวคือหยุดรับคำขอ/หยุด server ก่อน สำรองโฟลเดอร์ `HELPMINTHS_DATA_DIR` ทั้งโฟลเดอร์ รวม DB และ WAL/SHM หากยังอยู่ แล้วเริ่ม server ใหม่ การ copy เฉพาะ SQLite ขณะมี writer ไม่รับประกัน consistency ถ้าต้อง online backup ให้ใช้ SQLite backup API พร้อมวิธี snapshot ภาพให้สอดคล้องกันโดยผู้ดูแล ห้ามส่ง DB/ภาพจริงลง Git หรือแชตสาธารณะ

Restore บนพื้นที่ private ที่หยุด writer คง permissions/schema ที่รองรับ ทดสอบบัญชี/ภาพ/detail/report ก่อนเปิด เพิกถอน sessions ตามนโยบายเมื่อย้ายเครื่อง ชุดใน `backups/` เป็น snapshot ของวันที่สร้าง ไม่ใช่ backup บัญชีและข้อมูลรุ่นนี้

ยังไม่มี automatic retention job หรือหน้ากำหนดอายุข้อมูล ผู้ดูแลต้องกำหนดนโยบายสถาบัน ปุ่มเอารายการออกลบ image และ soft-delete analysis แต่คง metadata/review/audit จึงไม่ใช่การ erase ทุกสำเนาหรือ backup ห้ามแก้ audit โดยตรงเพื่อหลบข้อจำกัด

## Render และ production

`render.yaml` ใช้ Docker แผน Free, `autoDeploy:false`, health check `/api/health` Git push ไม่ทำให้เว็บใหม่ Live อัตโนมัติ เปิดบริการ Render → **Manual Deploy → Deploy latest commit** → รอ Live แล้วตรวจ commit/หน้าเว็บ/status จริง

Blueprint ไม่ mount persistent disk ไม่ติดตั้ง YOLO runtime/weights และไม่ bootstrap บัญชี ให้คง data directory ว่างหากยังไม่มี volume ถาวร การตั้ง path บน filesystem ชั่วคราวเปิด SQLite ได้แต่ข้อมูลอาจหายหลัง restart/redeploy ตั้ง durable1 ไม่แก้ปัญหานี้

ใช้ผลตรวจจริงต้องเลือกแผน/โฮสต์ที่รองรับ volume ก่อน ตั้ง path ไป volume ใช้ HTTPS/Securecookie1 สร้าง admin ผ่าน operator CLI ใน environment ที่ mount พื้นที่เดียวกัน ทดสอบ backup/restore และจัดทรัพยากรโมเดล หากไม่มี terminal/volume ห้ามทำ public bootstrap endpoint ให้ใช้ช่องทาง operator ที่โฮสต์รองรับ

Dockerfile เริ่มต้นรวม basic/PDF dependencies เท่านั้น ต้องเตรียม image/runtime แยกสำหรับ YOLO ไม่รวมภาพผู้ใช้/secrets ลง image ค่า durable เป็น declaration ไม่มีการตรวจสัญญาโฮสต์อัตโนมัติ

## ออฟไลน์และทดสอบ

Service worker production เก็บ app assets/Atlas/ภาพประกอบหลังเตรียมออนไลน์สำเร็จ ไม่ cache API/private image Atlas/บัตรฝึก/สาธิตใช้ offline ได้ ส่วน login/history/scored quiz/report/AI ต้องเชื่อม backend ใช้ LAN ได้หากเตรียม server/runtime/weights และอุปกรณ์เข้าถึงกันได้ ยังไม่มี YOLO ในโทรศัพท์โดยตรง

```bash
npm run build
.venv/bin/python -m pytest backend/tests -q
```

เปิด production server พอร์ต8080 แล้วรันทีละชุดเพื่อลด WebGL แย่งทรัพยากร:

```bash
HELPMINTHS_TEST_URL=http://127.0.0.1:8080 npm run test:e2e
HELPMINTHS_TEST_URL=http://127.0.0.1:8080 npm run test:feedback
HELPMINTHS_TEST_URL=http://127.0.0.1:8080 npm run test:offline
```

Playwright ใช้ `/usr/bin/chromium` หรือ `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; เครื่องอื่นติดตั้ง `npx playwright install chromium` Backend tests ใช้ temporary DB/ภาพสังเคราะห์/test predictor ไม่ใช่ผลตรวจจริง สำหรับ browser workflow ที่ต้องมีผลสำเร็จใช้ fixture แยก:

```bash
HELPMINTHS_ENABLE_TEST_FIXTURES=1 .venv/bin/python -m uvicorn backend.tests.ui_fixture:app --host 127.0.0.1 --port 8091
```

Fixture บังคับ local/test mode มี temporary accounts/DB/predictor และ header `X-HelpMinths-Test-Fixture: synthetic-only` ต้องตรวจ header ก่อนการทดสอบสร้างข้อมูล ห้าม deploy หรือใช้ผลเป็นหลักฐาน clinical accuracy เปิด server ปกติแบบไม่ตั้งฐานข้อมูลที่8082 อีก process แล้วรัน `npm run test:platform` (ค่าเริ่มต้น fixture8091/default8082; เปลี่ยนผ่าน `HELPMINTHS_PLATFORM_TEST_URL`/`HELPMINTHS_PLATFORM_DEFAULT_URL`) ห้ามชี้ URL ไปเว็บใช้งานจริง อ่าน [รายงานตรวจสอบ](VALIDATION.md) สำหรับผลที่รันจริง

การผ่าน build/API/browser/PDF tests เป็นหลักฐานซอฟต์แวร์ ก่อนศึกษากับผู้ใช้ยังต้องมี weights ที่เหมาะสม ภาพอิสระพร้อม annotation ที่ตรวจจริง สิทธิ์ข้อมูล แผนประเมิน และการอนุมัติของสถาบันตามขอบเขตงาน
