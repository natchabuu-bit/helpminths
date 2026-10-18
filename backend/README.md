# HelpMinths API

API สำหรับรับภาพกล้องจุลทรรศน์และเรียกโมเดล YOLO detection ที่ฝึกแล้ว โดยไม่บันทึกภาพที่อัปโหลดลงดิสก์ ใช้ CPU จึงไม่จำเป็นต้องมี GPU

## เริ่มใช้งาน

รันจากราก repository:

```bash
python -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

`requirements.lock` ล็อกเวอร์ชันที่ทดสอบแล้ว รวมเครื่องมือทดสอบ Frontend development server ส่งคำขอ `/api` มาที่พอร์ต 8000 ไม่จำเป็นต้องเพิ่ม CORS สำหรับ workflow นี้ เปิดเอกสาร API ได้ที่ `http://localhost:8000/docs`

```bash
.venv/bin/python -m pytest backend/tests -q
```

## รันเว็บและ API ด้วย server เดียว

สร้าง frontend จากราก repository แล้วเปิดโหมด production:

```bash
npm ci
npm run build
HELPMINTHS_SERVE_WEB=1 .venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

เปิดเว็บที่พอร์ต 8000 ได้โดยตรง API ยังคงอยู่ใต้ `/api` บน origin เดียวกัน โหมดนี้ต้องมี `dist/index.html` จากการ build ก่อนเริ่ม server หากยังไม่ได้ build โปรแกรมจะหยุดพร้อมคำแนะนำให้รัน `npm run build` หากไม่ตั้ง `HELPMINTHS_SERVE_WEB=1` จะให้บริการเฉพาะ API เหมือนเดิม

## เชื่อมต่อโมเดลจริง

Repository นี้ยังไม่มีชุดข้อมูลหรือไฟล์ weights ที่ฝึกแล้ว Notebook ที่อ้างอิงไม่ได้เป็นโมเดลพร้อมใช้งาน API จะรายงาน `model_ready: false` และตอบ `503` เมื่อส่งภาพ จนกว่าจะเชื่อมต่อโมเดลสำเร็จ ไม่สร้างผลตรวจจำลอง

เมื่อมีไฟล์ YOLO detection `.pt` ที่ฝึกและตรวจสอบแล้ว:

```bash
.venv/bin/python -m pip install -r backend/requirements-model.txt
export HELPMINTHS_MODEL_PATH=/workspace/models/helpminths/best.pt
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

ใช้ weights จากแหล่งที่เชื่อถือได้เท่านั้น เพราะ checkpoint ของ PyTorch อาจมีโค้ดที่ทำงานระหว่างโหลด API ใช้ชื่อชนิดไข่จาก `model.names` และไม่กำหนด class mapping ขึ้นเอง การฝึกและประเมินโมเดลกับข้อมูลที่มี annotation ต้องทำก่อนนำไปใช้งานจริง

ตั้ง environment variable ใน cloud environment settings หรือ shell ก่อนเริ่ม API ไฟล์ `.env.example` เป็นตัวอย่างและไม่ได้ถูกอ่านอัตโนมัติ ไม่ควรเก็บข้อมูลผู้ป่วย ภาพ หรือโมเดลไว้ใน Git

## API

- `GET /api/health` → `{status, model_ready, model_name, message}`
- `POST /api/analyze` → multipart form: `image` และ `confidence` (ค่าเริ่มต้น `0.15`, ช่วง `0.01–0.99`)
- รองรับภาพ JPEG, PNG, WebP ไม่เกิน 20 MB และ 40 ล้านพิกเซล ตรวจข้อมูลภาพจริงและหมุนตาม EXIF ก่อนประมวลผล
- ผลลัพธ์: `{id, filename, width, height, model, duration_ms, detections}`
- แต่ละ detection: `{id, class_id, label, confidence, bbox: [x1,y1,x2,y2]}` พิกัดเป็นพิกเซลบนภาพที่หมุนถูกทิศแล้ว
- ไฟล์ไม่รองรับ `415`, ภาพเสีย `400`, ใหญ่เกินไป `413`, threshold ไม่ถูกต้อง `422`, โมเดลไม่พร้อม `503`

ผล AI เป็นข้อมูลประกอบการศึกษาและคัดกรอง ต้องมีผู้เชี่ยวชาญตรวจสอบยืนยัน ไม่สามารถใช้แทนการวินิจฉัยทางคลินิก

ยังไม่มีการพิสูจน์ความแม่นยำทางคลินิกหรือทดสอบกับ weights จริง การทดสอบ backend ตรวจพฤติกรรม API, การจัดการภาพ, EXIF, พิกัดกรอบ และ class mapping ด้วย predictor ที่ฉีดเข้าไปเฉพาะในการทดสอบ
