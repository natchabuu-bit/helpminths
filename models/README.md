# โมเดลตรวจวิเคราะห์จาก Google Drive

เจ้าของเลือกไฟล์จากลิงก์ Google Drive รหัส `1gw6sXzWF1bH4ikYcyOxVi7L4I5MFwK1N` เป็นแหล่งโมเดลรุ่นใหม่ การตั้งค่าอยู่ใน [source.json](source.json) และขั้นตอน Docker build จะดาวน์โหลดจากแหล่งนี้โดยตรง ไม่ต้องเพิ่ม ZIP ขนาดใหญ่ลง Git

เครือข่ายคลาวด์ที่ใช้พัฒนาเมื่อ 6 พฤศจิกายน 2569 ตอบ proxy403 ก่อนเชื่อมถึง Google Drive จึงยังไม่ได้เปิดไฟล์จากลิงก์นี้ เลือก checkpoint จริง หรือยืนยันความเข้ากันได้ของโมเดลใหม่ในสภาพแวดล้อมนี้ การตั้งค่าขั้นตอนดาวน์โหลดไม่ใช่หลักฐานว่าเว็บ Render ดาวน์โหลดหรือโหลดสำเร็จแล้ว

## ขั้นตอนเมื่อ deploy บน Render

1. Docker อ่าน `models/source.json` และดาวน์โหลดไฟล์ผ่านช่องทางสาธารณะของ Google Drive รองรับหน้ายืนยันไฟล์ขนาดใหญ่ ไม่ใช้รหัสผ่านหรือเรียกข้ามหน้าขอสิทธิ์
2. หากเป็น ZIP ผลฝึก จะเลือก `weights/best.pt` ที่มีเพียงไฟล์เดียวก่อน หรือ `best.pt` ที่ไม่กำกวม ถ้ามี checkpoint เดียวใน ZIP จะใช้ไฟล์นั้น หากมีหลายตัวที่เลือกไม่ได้ จะหยุดและแจ้งให้กำหนด `HELPMINTHS_MODEL_ARCHIVE_MEMBER`
3. อ่านเฉพาะไฟล์โมเดลออกมาเป็น `models/parasite_yolo.pt` ไม่แตกภาพข้อมูลฝึกหรือรันสคริปต์ใน ZIP ตรวจโครงสร้าง PyTorch ZIP/ความครบถ้วน/ขนาด และ SHA-256 ถ้ากำหนดไว้
4. บันทึกแหล่งที่มา host/รหัสไฟล์ SHA ของไฟล์ดาวน์โหลดและโมเดล ชื่อ checkpoint ที่เลือก และเวลาลงใน `models/parasite_yolo.provenance.json` ไม่บันทึก URL ที่อาจมี token
5. ติดตั้ง PyTorch/torchvision แบบ CPU และส่วนประมวลผล YOLO จากนั้นลองโหลดและประมวลผลภาพสังเคราะห์ว่าง 640×640 ด้วย `backend.verify_model` หากขั้นใดไม่ผ่าน build จะล้มเหลว ไม่ใช้โมเดลเก่าหรือโมเดลทั่วไปแทนแหล่งที่เลือก
6. เมื่อบริการเริ่มทำงาน ตรวจ `/api/health` ให้เป็น `model_ready: true` และ `model_name: parasite_yolo.pt` สถานะ Render Live หรือ HTTP200 เพียงอย่างเดียวยังไม่ยืนยันว่าโมเดลพร้อม

ตัวตรวจ build พิมพ์ SHA รุ่น ชื่อคลาสที่โมเดลกำหนด และหน่วยความจำสูงสุดที่วัดได้ พร้อม `diagnostic_accuracy_evaluated: false` การประมวลผลภาพสังเคราะห์ผ่านยืนยันเพียงความเข้ากันได้ของ runtime ไม่ใช่ความแม่นยำในการวินิจฉัย และไม่ยืนยันว่ารุ่นใหม่ใช้หน่วยความจำพอดีกับแผน Render ที่เลือก

เปิด Render → บริการ `helpminths` → **Manual Deploy → Deploy latest commit** เพื่อให้ขั้นตอนนี้ทำงาน `autoDeploy:false` ยังใช้เหมือนเดิม ไม่ต้องตั้งค่าตัวแปรใหม่สำหรับแหล่งเริ่มต้น เพราะลิงก์อยู่ในไฟล์ที่ commit แล้ว หากแก้ไฟล์ Drive เดิมโดยคง URL ให้เปลี่ยน SHA ที่กำหนด/ไฟล์ตั้งค่า หรือใช้ **Clear build cache & deploy** เพื่อไม่ใช้ผลดาวน์โหลดที่แคชไว้

## การกำหนดเอง

ค่า CLI มีลำดับสูงกว่า environment และ environment ที่ไม่ว่างมีลำดับสูงกว่า JSON:

| ตัวแปร build | ความหมาย |
| --- | --- |
| `HELPMINTHS_MODEL_URL` | แทน URL ใน `source.json` ด้วยลิงก์ดาวน์โหลดที่เลือก |
| `HELPMINTHS_MODEL_ARCHIVE_MEMBER` | พาธภายใน ZIP เช่น `results/train/weights/best.pt` เมื่อมีหลายโมเดล |
| `HELPMINTHS_MODEL_SHA256` | SHA-256 ของ checkpoint หลังเลือก/แตก ไม่ใช่ SHA ของ ZIP ภายนอก |
| `HELPMINTHS_FETCH_MODEL` | `1` ดาวน์โหลดแหล่งที่เลือก (ค่าเริ่มต้น); `0` ข้ามอย่างชัดแจ้งและใช้เฉพาะไฟล์ใน build context ถ้ามี |

ถ้าไม่ผ่านการดาวน์โหลด สิทธิ์ หรือโครงสร้างไฟล์ ให้ตรวจข้อความ build ไม่ต้องส่งรหัสผ่าน/token ในแชท ตัวนำเข้ารองรับ HTTPS, จำกัดไฟล์ดาวน์โหลด 512 MiB และ checkpoint 256 MiB ไม่รองรับ checkpoint pickle แบบเก่าที่ไม่มีโครงสร้าง PyTorch ZIP

รันด้วยตัวเองเมื่อเครื่องเข้าถึงแหล่งข้อมูลได้:

```bash
python -m backend.model_artifact --config models/source.json --output models/parasite_yolo.pt
python -m pip install --index-url https://download.pytorch.org/whl/cpu 'torch==2.5.1+cpu' 'torchvision==0.20.1+cpu'
python -m pip install -r backend/requirements-model.txt
YOLO_OFFLINE=true YOLO_AUTOINSTALL=false python -m backend.verify_model --model models/parasite_yolo.pt
```

คำสั่ง pip นอก Docker ควรใช้ virtual environment ของโครงการ ขั้นตอน Docker จำกัด dependency ด้วย CPU และ base constraints อยู่แล้ว ตั้ง `HELPMINTHS_MODEL_PATH` เป็นพาธอื่นได้หากเลือกโมเดลด้วยวิธีนั้น พาธที่ตั้งเองมีลำดับสูงกว่าการค้นหาไฟล์อัตโนมัติ และพาธที่ผิดจะไม่สลับไปโมเดลอื่นโดยเงียบ ๆ

## รุ่นเบาที่ไม่มีโมเดล

สำหรับทดสอบ Atlas/Dashboard โดยไม่ดึงโมเดล ให้เลือกอย่างชัดแจ้ง:

```bash
docker build --build-arg HELPMINTHS_FETCH_MODEL=0 -t helpminths:without-model .
```

หากไม่มี checkpoint ใน build context ด้วย API จะรายงาน `model_ready:false` ไม่มีผลตรวจทดแทน โมเดลยังถูก Git ignore เพื่อไม่เพิ่ม binary โดยไม่ตั้งใจ ส่วน `source.json` และ README ถูก commit ได้ ไฟล์โมเดลไม่ได้อยู่ในโฟลเดอร์เว็บ `public/` และไม่มี endpoint สำหรับส่ง checkpoint ให้ผู้เข้าเว็บ
