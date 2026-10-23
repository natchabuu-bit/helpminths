import type { AtlasSource, AtlasStructure } from './atlasStructures';

const teachingRoot = 'https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/';

export const strongyloidesSources: Record<string, AtlasSource> = {
  'cdc-strongyloidiasis': {
    title: 'CDC DPDx — Strongyloidiasis',
    url: 'https://www.cdc.gov/dpdx/strongyloidiasis/index.html',
    note: 'แหล่งมาตรฐานสำหรับตัวอ่อน rhabditiform และการแยกจากพยาธิปากขอ; การเปิดตรวจหน้าเว็บสดรอบนี้ถูก proxy จำกัด จึงควรทบทวนฉบับล่าสุดก่อนใช้ทางคลินิก',
  },
  'openstax-strongyloidiasis': {
    title: 'OpenStax Microbiology — Strongyloidiasis',
    url: 'https://github.com/openstax/osbooks-microbiology/blob/f91d7fcdc7ebbafa36ec33099f78ff0a494f1c2b/modules/m58932/index.cnxml',
    note: 'อ่านส่วน Strongyloidiasis จากตำราทางการแล้ว รองรับการพบตัวอ่อนในอุจจาระและภาพรวมวงจรชีวิต ไม่ได้ใช้ยืนยันรายละเอียด genital primordium จากรูปถ่าย',
  },
  'buckelew-strongyloides-rhabditiform': {
    title: 'Buckelew — Strongyloides stercoralis rhabditiform',
    url: `${teachingRoot}Strongyloides%20stercoralis%20rhabditiform.htm`,
    note: 'อ่านคำบรรยายและตรวจภาพตัวอ่อน 100× แล้ว ใช้อ้างชนิด/ระยะตามผู้ถ่ายและภาพรวมเท่านั้น ไม่รับข้ออ้างในหน้าต้นฉบับที่ว่าตัวอ่อนแยกจากพยาธิปากขอไม่ได้ทั้งหมด และไม่อ้างว่าเห็น genital primordium ชัดในภาพนี้',
  },
  'buckelew-strongyloides-filariform': {
    title: 'Buckelew — Strongyloides filariform tail',
    url: `${teachingRoot}Strongyloides%20stercoralis%20filariform.htm`,
    note: 'อ่านคำบรรยายหางเว้าของระยะ filariform แล้ว ใช้แยกระยะที่กำลังอธิบาย ไม่ใช่ภาพ rhabditiform และไม่ได้นำรูปหางนี้มาเปลี่ยนชื่อระยะ',
  },
};

/** Coordinates describe a teaching model, not calibrated larval anatomy. */
export const strongyloidesStructures: AtlasStructure[] = [
  {
    id: 'cuticle', label: 'ผิวหุ้มลำตัวของตัวอ่อน (cuticle)', shortLabel: 'ผิวลำตัว',
    description: 'ผิวใสหุ้มลำตัวเรียวยาว แบบจำลองทำให้โปร่งเพื่อดูโครงสร้างภายใน ชั้นผิวนี้เป็นของตัวอ่อน ไม่ใช่เปลือกไข่ และไม่ได้แสดงจำนวนชั้นจุลกายวิภาค',
    position: [0, .20, .04], internal: false,
    sourceIds: ['cdc-strongyloidiasis', 'buckelew-strongyloides-rhabditiform'],
  },
  {
    id: 'buccal-cavity', label: 'ช่องปากสั้น (short buccal cavity)', shortLabel: 'ช่องปากสั้น',
    description: 'ช่องระหว่างปากกับหลอดอาหารของตัวอ่อน rhabditiform ค่อนข้างสั้น ใช้ประเมินร่วมกับ genital primordium ที่เด่น ตัวอ่อน rhabditiform ของพยาธิปากขอมีช่องปากยาวกว่าโดยทั่วไป ต้องเห็นส่วนหัวในโฟกัสจึงเปรียบเทียบได้',
    position: [-2.27, .03, .03], internal: true,
    sourceIds: ['cdc-strongyloidiasis'],
  },
  {
    id: 'rhabditoid-esophagus', label: 'หลอดอาหารแบบ rhabditoid และส่วนโป่ง (bulb)', shortLabel: 'หลอดอาหาร rhabditoid',
    description: 'หลอดอาหารอยู่ส่วนหน้าของลำตัวและมีส่วนโป่งช่วยให้สังเกตลักษณะ rhabditiform แบบจำลองแสดงรูปร่างรวม ไม่ใช้ความยาวหรือสัดส่วนที่วาดเป็นเกณฑ์วัดจริง',
    position: [-1.30, .10, .05], internal: true,
    sourceIds: ['cdc-strongyloidiasis'],
  },
  {
    id: 'genital-primordium', label: 'ตุ่มกำเนิดอวัยวะสืบพันธุ์ (genital primordium)', shortLabel: 'Genital primordium',
    description: 'กลุ่มเนื้อเยื่อตั้งต้นของระบบสืบพันธุ์อยู่ภายในบริเวณกลางลำตัว ตัวอ่อน rhabditiform ของ Strongyloides มีส่วนนี้ค่อนข้างใหญ่และเด่นกว่าพยาธิปากขอ แบบจำลองเน้นสีและขยายให้เรียนรู้ได้ชัด ไม่ใช่อวัยวะที่ยื่นออกนอกลำตัวหรืออวัยวะสืบพันธุ์ที่สมบูรณ์แล้ว',
    position: [.35, -.12, .065], internal: true,
    sourceIds: ['cdc-strongyloidiasis'],
  },
  {
    id: 'intestine', label: 'ลำไส้ของตัวอ่อน (intestine)', shortLabel: 'ลำไส้',
    description: 'ทางเดินอาหารต่อจากหลอดอาหารไปด้านท้าย ช่วยให้แยกแนวลำไส้ออกจาก genital primordium ที่อยู่ใกล้กัน ภาพจำลองแสดงเป็นแนวท่อโดยรวม ไม่ระบุเซลล์หรือออร์แกเนลล์ที่ภาพตัวอ่อนไม่ได้ยืนยัน',
    position: [1.0, -.01, .06], internal: true,
    sourceIds: ['cdc-strongyloidiasis'],
  },
  {
    id: 'pointed-tail', label: 'ปลายหางแหลมของระยะ rhabditiform', shortLabel: 'หางแหลม',
    description: 'ระยะ rhabditiform ที่แสดงมีหางเรียวแหลม อย่านำลักษณะหางเว้าของระยะ filariform มาใส่ในแบบจำลองนี้ หางเพียงจุดเดียวไม่เพียงพอแยกตัวอ่อน Strongyloides จากตัวอ่อนพยาธิปากขอ',
    position: [2.28, -.03, .015], internal: false,
    sourceIds: ['cdc-strongyloidiasis', 'buckelew-strongyloides-filariform'],
  },
];

export const strongyloidesComparison = [
  { feature: 'ระยะที่เปรียบเทียบ', strongyloides: 'ตัวอ่อน rhabditiform', hookworm: 'ตัวอ่อน rhabditiform' },
  { feature: 'ช่องปาก (buccal cavity)', strongyloides: 'สั้น', hookworm: 'ยาวกว่าโดยทั่วไป' },
  { feature: 'Genital primordium', strongyloides: 'ค่อนข้างใหญ่และเด่นชัด', hookworm: 'เล็กหรือเห็นไม่เด่น' },
  { feature: 'การอ่านลักษณะ', strongyloides: 'ดูส่วนหัวและกลางลำตัวร่วมกัน', hookworm: 'เปรียบเทียบตัวอ่อนระยะเดียวกัน' },
];

export const strongyloidesEvidenceNote = 'แบบจำลองนี้เป็นตัวอ่อนระยะ rhabditiform เน้น genital primordium ที่อยู่ภายในด้วยสีและขนาดเพื่อการเรียนรู้ สัดส่วนที่ขยายไม่ใช้แทนการวัดจริง ควรสังเกตช่องปากและโครงสร้างอื่นร่วมด้วย ภาพกล้องจุลทรรศน์ 100× ที่แนบใช้ดูภาพรวมและอาจไม่เห็นส่วนนี้ชัด';
