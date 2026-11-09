# เฟส 1: ตรวจโค้ดตกค้างก่อนลบ

สถานะ: ผู้ใช้ยืนยันให้ลบแล้ว ดำเนินการล้างโค้ดและตรวจครบเฟส 1 ก่อนแยก branch เฟส 2

- Branch: `ui/phase-1-cleanup-audit`
- จุดเริ่มต้น: `2a8a1fa46cfbe04d800bf6f88e0315a8b6ed68c4`
- ผู้ใช้ยืนยัน “ยืนยัน ทำเฟส2” จึงลบเฉพาะรายการหลักที่ตรวจสอบไว้

## ไฟล์ที่ยืนยันและลบแล้ว

| ไฟล์ | หลักฐาน |
| --- | --- |
| `src/components/LearningLab.tsx` | ไม่มี consumer, re-export หรือ dynamic import จากไฟล์อื่น พบชื่อ component เฉพาะ declaration ในไฟล์ตนเอง |
| `src/styles/learning-lab.css` | มี import เพียงแห่งเดียวจาก `LearningLab.tsx:7`; class ของ stylesheet นี้ไม่ถูกใช้ใน TS/TSX อื่น |
| `src/components/OfflinePanel.tsx` | ไม่มี consumer, re-export หรือ dynamic import จากไฟล์อื่น |
| `src/styles/offline.css` | มี import เพียงแห่งเดียวจาก `OfflinePanel.tsx:4` |

การตรวจครอบคลุม entry ของเว็บหลักและหลังบ้าน, imports/exports, ชื่อไฟล์และ component, รูปแบบ dynamic import/glob, runtime markup, scripts และ tests ไม่มี `import.meta.glob` ที่ดึงสอง component นี้เข้ามา ทั้งสองยังอยู่ในขอบเขต `tsconfig.json` ที่ typecheck ทุกไฟล์ใน `src` แต่ไม่อยู่ใน dependency graph ของหน้าเว็บ

## CSS ตกค้างที่ยืนยันและลบแล้วเป็น selector

| ไฟล์ | ขอบเขต |
| --- | --- |
| `src/styles/global.css:44–45,48–50,225–226` | กฎ `.sidebar-learning` และลูกของมัน รวม pseudo-element และกฎ responsive เก็บ selector อื่นใน media query เดิม |
| `src/styles/platform-shell.css:1` | เฉพาะ fragment `.platform-shell .sidebar-learning{display:none}` ไฟล์ส่วนอื่นยังใช้งานอยู่ |
| `src/styles/instrument-shell.css:56–59` | overrides ของ `.offline-panel`, `.offline-panel.is-offline`, `.offline-details-toggle`, `.offline-install` ที่ไม่มี markup ใช้งานนอก panel |

พบ `.learning-icon` และ `.eyebrow` แบบ standalone ที่ `global.css:46–47` ไม่ถูกใช้งานเช่นกัน แต่ยังไม่รวมในขอบเขตหลักข้างต้น เพื่อไม่ขยายการลบ selector ทั่วไปโดยอัตโนมัติ

## สิ่งที่ต้องเก็บ

- `src/offline.ts`, การเรียก `registerOfflineSupport()` ใน `src/main.tsx`, `public/sw.js`, `public/manifest.webmanifest`, manifest link และ Vite precache ยังใช้งานจริง การลบ UI panel ไม่ใช่การยกเลิกระบบออฟไลน์
- `atlasPhotos`, `species` และข้อมูล/ภาพ Atlas ยังมี consumer ใน Atlas, Scan และ App
- Tests ที่ตรวจว่า `.offline-panel` ไม่ปรากฏยังมีความหมายและต้องเก็บไว้
- Skip link, `focus-visible`, `aria-current`, focus trap ของ modal และ `prefers-reduced-motion` เป็นโค้ดที่ยังใช้งานและไม่อยู่ในขอบเขตลบ
- ข้อความปัจจุบันใน `src/App.tsx` คือ “ผลจาก AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ และไม่ใช้แทนการวินิจฉัยทางคลินิก” โดยคำว่า “ผล AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ” ตามคำสั่งล่าสุดยังไม่ปรากฏตรงตัว จะรักษาข้อความเตือนและใช้ถ้อยคำตรงตามที่กำหนดเมื่อปรับเฟส 2 ไม่แก้ข้อความในรอบ audit นี้

## ขอบเขตที่ห้ามแก้

ไม่มีการแก้ `backend/`, `models/`, `public/atlas/`, `src/platform/api.ts` หรือ `src/components/AtlasModel.tsx` ลบหลังผู้ใช้ยืนยันเท่านั้น และยังไม่ merge เฟสนี้เข้า `main`

## Baseline ก่อนลบ

ตรวจด้วยโค้ดแอปเดิมครบแล้ว:

| คำสั่ง | ผล |
| --- | --- |
| `npm run typecheck` | ผ่าน |
| `npm run build` | ผ่าน ทั้ง public/admin entry |
| `npm run test:interface` | ผ่าน 3/3 กรณี |
| `npm run test:e2e` | ผ่าน 14/14 กรณี |

Browser tests ใช้ API บน localhost:8152 แบบปิด model และ database โดยไม่แก้ backend source และไม่เชื่อมข้อมูลจริง การจำลองผล inference ของ E2E เป็นสัญญาทดสอบ UI เท่านั้น ไม่ใช่หลักฐานความแม่นยำทางคลินิก ชุด interface ตรวจ skip link และ reduced motion ด้วย

ไม่มีการแก้ test เพื่อให้ผ่าน ไม่มีการเปลี่ยนชื่อเมนูหรือข้อความในเฟส audit ตรวจ `git diff` ยืนยันว่าส่วนที่ห้ามแก้ยังตรงกับจุดเริ่มต้น หลังได้รับอนุมัติและลบจริง ต้องรันคำสั่งเหล่านี้อีกครั้งก่อนปิดเฟส 1


## ผลตรวจหลังลบจริง

- `npm run typecheck`: ผ่าน
- `npm run build`: ผ่าน
- `npm run test:interface`: ผ่าน 3/3 กรณี
- `npm run test:e2e`: ผ่าน 14/14 กรณี
- ไม่เปลี่ยนชื่อเมนูหรือ tests ในเฟส 1 ไม่แก้ส่วนที่ห้ามแก้ ระบบออฟไลน์และ accessibility เดิมยังอยู่ครบ
- `.learning-icon` และ `.eyebrow` แบบ standalone ยังเก็บไว้ตามขอบเขตหลักที่ยืนยัน
