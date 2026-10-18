# HelpMinths

เว็บภาษาไทยสำหรับสำรวจภาพไข่พยาธิจากกล้องจุลทรรศน์ พร้อม Atlas 3D แบบอินเทอร์แอคทีฟ โทนเข้ม รองรับมือถือและคอมพิวเตอร์

## เผยแพร่บน Render

[เปิดหน้าสร้าง HelpMinths บน Render](https://render.com/deploy?repo=https://github.com/natchabuu-bit/helpminths)

ลิงก์นี้เป็นหน้าตรวจสอบและสร้างบริการในบัญชี Render ของคุณ ยังไม่ใช่ URL ของแอปที่เผยแพร่แล้ว

1. เข้าสู่ระบบ Render แล้วเปิดลิงก์ข้างต้น หากระบบขอเชื่อม GitHub ให้เลือก repository `natchabuu-bit/helpminths`
2. ตรวจรายการบริการ `helpminths` ซึ่งตั้งค่าเป็นแผน Free ใน `render.yaml` แล้วกด Deploy Blueprint หรือ Create New Resources ตามปุ่มที่แสดง
3. รอให้ build และ deploy เสร็จ เมื่อบริการแสดง Live ให้เปิด URL ที่ Render แสดงในหน้าบริการ ลิงก์นั้นจึงเป็นเว็บไซต์ที่เปิดจากมือถือได้

Blueprint ใช้ Docker ให้เว็บและ API อยู่ในบริการเดียว ตั้ง health check เป็น `/api/health` และปิดการ deploy อัตโนมัติจากการ push ครั้งถัดไป หากติดขั้นตอนเชื่อมบัญชี ให้ใช้หน้า Render โดยตรง ไม่ต้องส่งรหัสผ่านหรือ token ในแชต

การเผยแพร่ครั้งแรกเปิดใช้งานเว็บ Atlas และโหมดสาธิตได้ ส่วน AI ตรวจภาพจริงยังต้องเชื่อม trained weights ที่เข้ากันได้ตามหัวข้อโมเดลด้านล่าง

## เริ่มใช้งาน

ต้องใช้ Node.js 22.12+ หรือ 24 และ Python 3.12 ใช้ checkout ปัจจุบันได้เลย ไม่ต้องสร้าง Git worktree

```bash
cd /workspace/helpminths
bash scripts/install.sh
bash scripts/start.sh
```

Frontend พอร์ต 5173 จะส่ง `/api` ไปยัง FastAPI พอร์ต 8000 ผ่าน Vite proxy ในเครื่องเดียวกัน ต้องเปิดทั้งสองบริการ กระบวนการที่รันอยู่จะไม่ติดไปกับ snapshot เมื่อเริ่มเครื่องใหม่ให้รัน `bash scripts/start.sh` อีกครั้ง ใช้ HTTPS สำหรับการเปิดจากมือถือผ่านบริการโฮสต์

## เปิดจากมือถือหรือเผยแพร่เป็นเว็บไซต์

พาธไฟล์ในเครื่องคลาวด์และลิงก์คู่มือ README ไม่ใช่ URL เว็บไซต์สาธารณะ การ Publish สภาพแวดล้อม Codex เก็บสภาพแวดล้อมพัฒนา แต่ไม่ได้เผยแพร่ HelpMinths เป็นเว็บโฮสต์

เตรียม production ให้ frontend และ API อยู่ภายใต้เว็บไซต์เดียวกันได้แล้ว:

```bash
npm run build
PORT=8080 bash scripts/start-production.sh
```

คำสั่งนี้ใช้เว็บที่ build แล้ว ไม่ต้องเปิด Vite ควบคู่ เหมาะสำหรับนำไปตั้งค่าบนบริการโฮสต์ที่มี HTTPS และ public ingress ของตัวเอง ค่า `PORT` ต้องตรงกับที่โฮสต์กำหนด

สำหรับบริการที่รองรับ Docker:

```bash
docker build -t helpminths .
docker run --rm -p 8080:8000 helpminths
```

Dockerfile ไม่รวมไฟล์โมเดล รหัสลับ หรือภาพของผู้ใช้ การตรวจ AI จริงยังต้องติดตั้ง runtime ของโมเดลและเชื่อม trained weights แยกต่างหาก Dockerfile เป็น configuration สำหรับ deployment; อ่านรายงานการทดสอบปัจจุบันก่อนถือว่า image ได้ build ในเครื่องใดแล้ว

สถานะตรวจสอบ: production แบบรันตรงผ่าน browser tests 6/6 และ backend tests 15/15 และ build Docker image พร้อมทดสอบ HTML, JS/CSS, API health และการจัดการไฟล์อัปโหลดผ่านแล้ว ในคลาวด์นี้ใช้การตั้งค่า proxy DNS และ CA ของแพลตฟอร์มชั่วคราวระหว่าง build โดยยังตรวจ TLS และไม่เก็บ credentials หรือ CA secret ใน image ส่วน Dockerfile สำหรับ Render ไม่ต้องใช้การตั้งค่าเฉพาะคลาวด์นี้ การบันทึกโค้ดบน GitHub ยังไม่ใช่การสร้างบริการหรือยืนยันว่าเว็บไซต์บน Render เป็น Live แล้ว

การสมัครบัญชี Render ไม่ได้สร้างบริการหรือเชื่อมบัญชีกับเครื่องมือในแชตโดยอัตโนมัติ ใช้ลิงก์ Blueprint ด้านบนเพื่อสร้างบริการในบัญชีของคุณ แล้วใช้ URL ที่ Render ออกให้ ไม่ต้องซื้อโดเมนหรือส่งรหัสผ่านและ access token ในแชต

## ฟีเจอร์

- เลือกภาพ JPEG, PNG หรือ WebP สูงสุด 20 MB จากเครื่อง หรือเปิดกล้องมือถือผ่าน file input `capture="environment"` การเปิดกล้องขึ้นอยู่กับเบราว์เซอร์/อุปกรณ์
- ลากวางภาพ ตรวจตำแหน่งด้วยกรอบรายฟอง เลือกผล ปรับตัวกรองความมั่นใจ และดาวน์โหลดรายงาน JSON
- Atlas ไข่พยาธิอ้างอิง 8 ชนิด: หมุน ซูม หยุดหมุน รีเซ็ต ดูภาพตัดภายใน และค้นหาจุดสังเกต พร้อมภาพ SVG สำรองเมื่อไม่มี WebGL
- ประวัติผลตรวจในหน่วยความจำของเซสชันปัจจุบัน ล้างเมื่อรีเฟรชหรือปิดหน้า บริการ API ไม่บันทึกภาพลงดิสก์
- โหมดสาธิตแยกชัดเจนว่าเป็นภาพวาดและข้อมูลจำลอง ไม่ใช่ผลตรวจจาก AI

## สถานะโมเดลและ dataset

แหล่งอ้างอิงที่ผู้ใช้ให้: [Kaggle notebook](https://www.kaggle.com/code/mohaliy2016/ai4ntd-kk2-0-p1-5-sth-schm-v2-notebook)

**ยังไม่มี trained weights ใน repository นี้** ไฟล์ notebook ที่แนบมีขนาดเกินขีดจำกัด 32 MiB ของเครื่องมือ และการอ่าน Kaggle จากเครื่องคลาวด์ถูก network proxy ปฏิเสธในรอบสร้าง จึงยังยืนยันสถาปัตยกรรม รายชื่อคลาส dataset หรือประสิทธิภาพของโมเดลต้นฉบับไม่ได้ Atlas เป็นคลังอ้างอิงแยกจากคลาสของโมเดล

API มี adapter เสริมสำหรับ **Ultralytics YOLO detection `.pt` ที่ฝึกแล้ว** นี่เป็นรูปแบบที่ระบบรองรับ ไม่ใช่ข้อยืนยันว่า notebook ที่ให้มาใช้ YOLO หากต้นฉบับใช้รูปแบบอื่น ต้องเพิ่ม adapter ให้ตรงกับโมเดลก่อน

เชื่อมโมเดลที่ทราบแหล่งที่มาและเชื่อถือได้:

```bash
cd /workspace/helpminths
.venv/bin/python -m pip install -r backend/requirements-model.txt
# วาง best.pt ของโปรเจกต์ไว้ใน models/ โดยไม่เพิ่มไฟล์ใหญ่ลง Git
export HELPMINTHS_MODEL_PATH=/workspace/helpminths/models/best.pt
bash scripts/start.sh
```

ชื่อคลาสดึงจาก `model.names` โดยตรง ไม่มีการเดาชื่อชนิดหรือใช้โมเดล COCO ทั่วไปแทนโมเดลไข่พยาธิ เมื่อไม่มีโมเดล `/api/health` จะตอบ `model_ready: false` และการส่งภาพตรวจจริงจะได้รับ HTTP 503 พร้อมคำอธิบาย ไม่ได้สร้างผลตรวจปลอม

`HELPMINTHS_MODEL_PATH` เป็นพาธไฟล์ในเครื่อง ไม่ใช่รหัสลับ ตั้งค่าผ่าน environment ก่อนเริ่ม API แล้วรีสตาร์ตบริการ ต้องตรวจความเข้ากันได้ของโมเดลและชุดทดสอบจริงก่อนใช้ในงานคัดกรอง ผลจาก AI ไม่ใช่การวินิจฉัยทางคลินิกและต้องให้ผู้เชี่ยวชาญยืนยัน

## การตรวจสอบ

```bash
npm run build
.venv/bin/python -m pytest backend/tests -q
curl --fail http://127.0.0.1:8000/api/health
```

Backend tests ตรวจไฟล์ไม่ถูกต้อง ขนาดภาพ ขนาดไฟล์ EXIF orientation ชื่อคลาสและขอบเขตกรอบ โดยใช้ตัวทดสอบแทน predictor เฉพาะ unit test ไม่ใช่การยืนยันความแม่นยำโมเดลจริง

Browser tests ใช้ Playwright โดยเปิดเว็บและ API ด้วย `bash scripts/start.sh` ไว้ก่อน แล้วรัน `npm run test:e2e` ในอีกเทอร์มินัล ถ้ามี Chromium ที่ `/usr/bin/chromium` จะใช้ได้เลย หรือกำหนด `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; เครื่องอื่นติดตั้งด้วย `npx playwright install chromium` ก่อน ชุดทดสอบตรวจ workflow จริงกับข้อมูลสาธิต และทดสอบสัญญา API ด้วย response จำลองหนึ่งกรณี โดยไม่อ้างว่าเป็นผลจากโมเดลจริง

ดูสัญญา API และรายละเอียดการติดตั้งที่ [backend/README.md](backend/README.md)

## เทคโนโลยี

React 19 + TypeScript + Vite, Three.js / React Three Fiber, FastAPI + Pillow ฟอนต์ Noto Sans Thai และ Inter ติดตั้งในโปรเจกต์และไม่ต้องเรียกเว็บฟอนต์ภายนอก

แบบจำลอง Atlas เป็นภาพอธิบาย morphology ไม่ใช่ภาพถ่ายหรือโครงสร้างสแกน และไม่ใช้สเกลเทียบกันระหว่างชนิด เนื้อหาอ้างอิงรูปแบบลักษณะทั่วไปจาก CDC DPDx โปรดตรวจเอกสารปฐมภูมิและให้ผู้เชี่ยวชาญทบทวนก่อนใช้สอนหรืออ้างอิงทางคลินิก
