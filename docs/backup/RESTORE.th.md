# สำรองและกู้คืน HelpMinths

จัดทำ 23 ตุลาคม 2569 (2026), เวลาอ้างอิงประเทศไทย

ชุดสำรองนี้ใช้ต่อได้โดยไม่ต้องเข้าบัญชี ChatGPT เดิม เก็บไฟล์ ZIP ที่ดาวน์โหลด
ไว้ในเครื่องและอีกแห่งหนึ่ง เช่น external drive หรือพื้นที่เก็บไฟล์ของคุณ
การเก็บลิงก์ในประวัติแชตเพียงอย่างเดียวไม่ได้เก็บไฟล์สำรองไว้กับคุณ
เมื่อแตกไฟล์จะได้โฟลเดอร์ `HelpMinths-backup-2026-10-23/`

## สิ่งที่อยู่ในชุดสำรอง

| รายการ | ใช้ทำอะไร |
|---|---|
| `source/` | โค้ดเว็บและ API, ภาพจริง, ภาพวาด/โมเดลที่สร้างด้วยโค้ด, ข้อมูล Atlas, แหล่งอ้างอิง, tests, lockfiles, Dockerfile และการตั้งค่า Render |
| `production-web/` | เว็บที่ build แล้ว รวม JavaScript, CSS, ฟอนต์, ภาพ และ service worker สำหรับเปิด Atlas และโหมดสาธิต |
| `git-history.bundle` | ประวัติโค้ดที่บันทึกใน Git สำหรับกู้คืน repository โดยไม่ต้องดึงจาก GitHub |
| `BACKUP-METADATA.json` และ `SHA256SUMS.txt` | ระบุรุ่นโค้ด ขอบเขตชุดสำรอง และตรวจว่าไฟล์เปลี่ยนหรือเสียหายหรือไม่ |
| `README-RESTORE.th.md` และ `NEW-ACCOUNT-PROMPT.th.txt` | คู่มือนี้และข้อความสำหรับเริ่มงานกับผู้ช่วยในบัญชีใหม่ มีสำเนาใน `source/docs/backup/` ด้วย |

โฟลเดอร์ dependencies ที่ติดตั้งแล้ว เช่น `node_modules` และ `.venv` ไม่จำเป็น
ต่อการสำรองซอร์สและไม่ควรนำข้ามระบบปฏิบัติการ ให้ติดตั้งใหม่จาก lockfiles
ส่วน `production-web/` เปิดสื่อการเรียนรู้ที่ build แล้วได้โดยไม่ต้องติดตั้ง npm

ชุดนี้รวมเฉพาะไฟล์ของโครงการที่มีอยู่จริง ไม่มี trained model weights หรือ
dataset ฝึก AI ที่ยังไม่ได้รับมา ไม่มีไฟล์ notebook ต้นฉบับที่แนบในแชตก่อนหน้า
เพราะไม่สามารถนำไฟล์นั้นเข้าพื้นที่งานได้ เก็บ notebook/weights ที่คุณมีแยกไว้
พร้อมข้อมูลที่มาและสิทธิ์ การเพิ่ม Strongyloides ใน Atlas ไม่ได้ฝึก AI เพิ่ม

แอพไม่มีฐานข้อมูลประวัติผู้ใช้บนเซิร์ฟเวอร์ ภาพอัปโหลดและประวัติผลตรวจอยู่
ในหน่วยความจำของหน้าเว็บ จึงไม่อยู่ใน ZIP; รายงาน JSON ที่ผู้ใช้ดาวน์โหลดไว้
ต้องเก็บแยกเอง ไม่มีรหัสผ่าน GitHub/Render, access token หรือบัญชีผู้ให้บริการ
อยู่ในชุดสำรอง การตั้งค่าบริการ Render จริงเป็นทรัพยากรในบัญชี Render ของคุณ

## เริ่มงานใน ChatGPT บัญชีใหม่

1. แตก ZIP เพื่อตรวจว่าเปิดไฟล์ได้ และเก็บ ZIP ต้นฉบับไว้
2. ในบัญชีใหม่ที่มีเครื่องมือทำงานกับไฟล์/โค้ด ให้อัปโหลด ZIP ชุดสำรอง
   แล้ววางข้อความจาก `NEW-ACCOUNT-PROMPT.th.txt`
3. ให้ผู้ช่วยอ่านคู่มือนี้ เอกสารหลักฐานใน `source/docs/atlas/` และ metadata
   ก่อนแก้โค้ด พร้อมตรวจรุ่นจาก metadata และผล SHA-256 ของไฟล์สำรอง
4. หากเครื่องมือของบัญชีใหม่ไม่รองรับ ZIP หรือรันโค้ด ใช้ repository
   <https://github.com/natchabuu-bit/helpminths> หรือทำตามวิธีกู้คืนในเครื่องด้านล่าง

ตรวจไฟล์หลังแตก ZIP โดยเปิด terminal ในโฟลเดอร์ชุดสำรองแล้วรัน
`sha256sum -c SHA256SUMS.txt` บน Linux/WSL หรือเครื่องที่มีคำสั่งนี้
ไฟล์ในรายการต้องผ่านทั้งหมด ดูรุ่นโค้ดและขอบเขตไฟล์ที่รวมใน `BACKUP-METADATA.json`
นอกจากนี้มี ZIP และไฟล์ค่า SHA-256 สำรองไว้ในโฟลเดอร์ `backups/`
ของ repository เพื่อดาวน์โหลดโดยไม่ผ่านประวัติ ChatGPT

เว็บไซต์เดิมคือ <https://helpminths.onrender.com> ไม่ต้องสร้างบริการซ้ำหากยังใช้
บริการเดิมได้ การปิดบัญชี ChatGPT ไม่ได้ย้ายหรือลบบัญชี GitHub/Render โดยตัวมันเอง

## กู้คืนจากซอร์สในเครื่อง — Linux, macOS หรือ WSL

ติดตั้ง Node.js 24 (หรือ 22.12 ขึ้นไป) และ Python 3.12 ก่อน การดาวน์โหลด
dependencies ครั้งแรกต้องใช้อินเทอร์เน็ต จากนั้นเปิด terminal ใน `source/`:

```bash
npm ci --no-audit --no-fund
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
npm run build
PORT=8081 bash scripts/start-production.sh
```

เปิด `http://localhost:8081` บนเครื่องที่รันคำสั่งนี้ เว็บและ API ใช้พอร์ตเดียวกัน
คำสั่งสุดท้ายต้องเปิดค้างไว้ เมื่อต้องการหยุดให้กด Ctrl+C
เปิด terminal อีกหน้าต่างเพื่อตรวจบริการ:

```bash
curl --fail http://localhost:8081/api/health
```

ควรได้ `status: "ok"` ส่วน `model_ready: false` หมายถึง API ทำงานแต่ยังไม่มี
โมเดลตรวจภาพจริง การส่งภาพตรวจจริงยังตอบว่าไม่มีโมเดล ไม่สร้างผลตรวจแทน

`scripts/install.sh` ของสภาพแวดล้อมเดิมอ้างพาธ `/workspace/helpminths`
จึงใช้คำสั่งข้างต้นเมื่อแตก ZIP ไปไว้พาธอื่น `start-production.sh` อ้างพาธ
จากตำแหน่งสคริปต์ จึงใช้กับโฟลเดอร์ที่กู้คืนได้

หากต้องพัฒนาต่อ หลังติดตั้ง dependencies แล้วใช้ `bash scripts/start.sh`
Frontend จะอยู่ที่พอร์ต 5173 และ API ที่ 8000 ใช้ `npm run build` ตรวจ TypeScript
และการ build; backend tests ใช้ `.venv/bin/python -m pytest backend/tests -q`

## เปิดด้วย Docker — รวมถึง Windows

ติดตั้งและเปิด Docker Desktop แล้วเปิด terminal ใน `source/`:

```bash
docker build -t helpminths-backup .
docker run --rm -p 8080:8000 helpminths-backup
```

เปิด `http://localhost:8080` การ build ครั้งแรกต้องดาวน์โหลด base images และ
dependencies จึงต้องมีอินเทอร์เน็ต Dockerfile นี้ยังไม่รวม runtime เสริมและ
weights สำหรับ AI ตรวจภาพจริง ถ้ารันบน Windows โดยไม่ใช้ Docker
ให้ใช้ WSL หรือสภาพแวดล้อมที่รองรับ Bash สำหรับคำสั่งเริ่มบริการข้างต้น

## เปิดเฉพาะเว็บที่ build แล้ว

เปิด terminal ใน `production-web/` แล้วรัน:

```bash
python3 -m http.server 8080
```

Windows ที่ติดตั้ง Python launcher ใช้ `py -m http.server 8080` ได้
เปิด `http://localhost:8080` เพื่อใช้ Atlas, ภาพประกอบ และโหมดสาธิต
วิธีนี้ไม่มี FastAPI `/api`; การตรวจ AI และ health check ของ API จึงใช้ไม่ได้
รอข้อความ **พร้อมใช้งานออฟไลน์** ก่อนทดสอบปิดเครือข่าย และเก็บ terminal
ที่ให้บริการไฟล์ไว้หากต้องการเปิดผ่าน localhost ต่อ อย่าเปิด `index.html`
ด้วยการดับเบิลคลิกเป็น `file://` เพราะโมดูลและ service worker ต้องใช้เว็บเซิร์ฟเวอร์

## กู้คืนประวัติ Git

จากโฟลเดอร์ชุดสำรองที่มี `git-history.bundle` และติดตั้ง Git แล้ว:

```bash
git clone git-history.bundle helpminths-restored
cd helpminths-restored
git bundle verify ../git-history.bundle
git log -1 --oneline
```

เทียบ commit กับไฟล์ metadata ของชุดสำรอง หากต้องการเลือก commit นั้นโดยตรง:

```bash
git checkout --detach SOURCE_COMMIT_FROM_METADATA
```

เปลี่ยน `SOURCE_COMMIT_FROM_METADATA` เป็นค่า commit จริงจาก metadata
หลัง clone จาก bundle ค่า `origin` จะชี้ไปยังไฟล์ bundle ในเครื่อง
เมื่อต้องการเชื่อม repository เดิมของคุณอีกครั้ง:

```bash
git remote set-url origin https://github.com/natchabuu-bit/helpminths.git
```

การอ่านโค้ดจาก ZIP/bundle ไม่ต้องใช้บัญชี ChatGPT เดิม ส่วนการ push หรือแก้
บริการโฮสต์ใช้สิทธิ์บัญชี GitHub/Render ของคุณผ่านช่องทางเข้าสู่ระบบปกติ

## อัปเดตเว็บไซต์เดิมบน Render

หลังนำโค้ดขึ้น repository ที่บริการเดิมเชื่อมอยู่ ให้เข้า Render → HelpMinths →
**Manual Deploy → Deploy latest commit** เพราะ `render.yaml` ตั้ง
`autoDeploy: false` รอให้สถานะ Live แล้วตรวจเว็บจริงอีกครั้ง
หากแอพแจ้งว่ามีเวอร์ชันใหม่พร้อมใช้ ให้ปิด HelpMinths ทุกแท็บแล้วเปิดใหม่

การ build หรือทดสอบในเครื่องไม่ได้เผยแพร่เว็บบน Render โดยอัตโนมัติ
หากต้องย้ายไปบัญชีโฮสต์ใหม่ ใช้ `Dockerfile`/`render.yaml` จากซอร์สเพื่อสร้าง
บริการในบัญชีนั้น แล้วใช้ URL ที่ผู้ให้บริการออกให้จริง

## ข้อมูลและขอบเขตเนื้อหา

- Atlas อ้างอิง 12 กลุ่ม รวม Strongyloides stercoralis ระยะ **rhabditiform**
  โดยเน้น genital primordium ในโมเดลและภาพวาด ภาพกล้องจริงที่รวมมาใช้ดู
  รูปร่างตัวอ่อนโดยรวม ยังไม่ยืนยันว่าเห็น genital primordium ชัดในภาพเหล่านั้น
- Ascaris มีไข่ไม่ปฏิสนธิ ไข่ปฏิสนธิระยะต้น cleavage และ embryonated
  พร้อมสวิตช์ decorticated แยกจากระยะพัฒนา ไข่ไม่ปฏิสนธิไม่พัฒนาเป็นระยะติดต่อ
- ภาพจริง OV, MIF และ Echinostoma ยังรอตรวจชนิดและสิทธิ์ ภาพ cleavage/
  decorticated ของ Ascaris ใช้ภาพวาดที่ติดป้ายชัดเจนเมื่อไม่มีภาพจริงที่ยืนยันได้
- ภาพ Buckelew ใช้เพื่อการศึกษาที่ไม่ใช่เชิงพาณิชย์ตาม **CC BY-NC 4.0**
  ต้องคงเครดิตและเงื่อนไข ไม่ใช่สิทธิ์แบบครอบคลุมสำหรับใช้เชิงพาณิชย์หรือ
  ฝึก AI จากทุกแหล่ง ดูทะเบียนภาพและหลักฐานรายชนิดใน `source/docs/atlas/`
- ข้อมูล Atlas เป็นสื่อการศึกษา ขอบเขตชนิดใน Atlas ไม่ยืนยันคลาสหรือความแม่นยำ
  ของ detector; ไม่มี trained weights ในชุดนี้ และยังไม่ยืนยันความแม่นยำทางคลินิก

สำหรับ AI จริง ดู `source/backend/README.md`, `requirements-model.txt`
และหัวข้อโมเดลใน README หลัก ต้องมี checkpoint ที่เชื่อถือได้และ adapter ที่ตรง
สถาปัตยกรรมก่อนตั้ง `HELPMINTHS_MODEL_PATH` อย่าใช้โมเดลทั่วไปแทนแล้วรายงาน
ว่าเป็นโมเดลตรวจพยาธิ
