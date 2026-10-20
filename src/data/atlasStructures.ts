/**
 * Diagnostic egg morphology, rather than an organelle atlas. Positions are in
 * the model's local coordinates (long axis = x); the renderer applies its own
 * rotation. Model colours, cut surfaces and distances are explanatory choices.
 */
export interface AtlasStructure {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  position: [number, number, number];
  internal: boolean;
  sourceIds: string[];
}

export interface AtlasSource {
  title: string;
  url: string;
  note?: string;
}

const cdcNote = 'แหล่งอ้างอิงมาตรฐานด้าน morphology ของ CDC DPDx; การเปิดตรวจหน้าเว็บสดจากสภาพแวดล้อมนี้ถูกจำกัด จึงควรตรวจฉบับล่าสุดก่อนใช้อ้างอิงทางคลินิก';
const teachingNote = 'อ่านคำบรรยายต้นฉบับในสำเนาคลังภาพการสอนของ Dr. Thomas P. Buckelew แล้ว; เป็นเอกสารการสอน ไม่ใช่การรับรองผลวินิจฉัย';
const buckelewBase = 'https://github.com/tombuckelew/parasitology-images/blob/main/site/Buckelew/';

export const atlasSources: Record<string, AtlasSource> = {
  'cdc-ascariasis': { title: 'CDC DPDx — Ascariasis', url: 'https://www.cdc.gov/dpdx/ascariasis/index.html', note: cdcNote },
  'cdc-trichuriasis': { title: 'CDC DPDx — Trichuriasis', url: 'https://www.cdc.gov/dpdx/trichuriasis/index.html', note: cdcNote },
  'cdc-hookworm': { title: 'CDC DPDx — Hookworm (Intestinal)', url: 'https://www.cdc.gov/dpdx/hookworm/index.html', note: cdcNote },
  'cdc-opisthorchiasis': { title: 'CDC DPDx — Opisthorchiasis', url: 'https://www.cdc.gov/dpdx/opisthorchiasis/index.html', note: cdcNote },
  'cdc-taeniasis': { title: 'CDC DPDx — Taeniasis', url: 'https://www.cdc.gov/dpdx/taeniasis/index.html', note: cdcNote },
  'cdc-enterobiasis': { title: 'CDC DPDx — Enterobiasis', url: 'https://www.cdc.gov/dpdx/enterobiasis/index.html', note: cdcNote },
  'cdc-heterophyiasis': { title: 'CDC DPDx — Heterophyiasis', url: 'https://www.cdc.gov/dpdx/heterophyiasis/index.html', note: cdcNote },
  'cdc-metagonimiasis': { title: 'CDC DPDx — Metagonimiasis', url: 'https://www.cdc.gov/dpdx/metagonimiasis/index.html', note: cdcNote },
  'cdc-hymenolepiasis': { title: 'CDC DPDx — Hymenolepiasis', url: 'https://www.cdc.gov/dpdx/hymenolepiasis/index.html', note: cdcNote },
  'cdc-echinostomiasis': { title: 'CDC DPDx — Echinostomiasis', url: 'https://www.cdc.gov/dpdx/echinostomiasis/index.html', note: cdcNote },
  'cdc-fasciolopsiasis': { title: 'CDC DPDx — Fasciolopsiasis', url: 'https://www.cdc.gov/dpdx/fasciolopsiasis/index.html', note: cdcNote },
  'buckelew-ascaris': { title: 'Buckelew — Ascaris lumbricoides ova', url: `${buckelewBase}Ascaris%20lumbricoides%20ova.htm`, note: teachingNote },
  'buckelew-trichuris': { title: 'Buckelew — Trichuris trichiura ova', url: `${buckelewBase}Trichuris%20trichiura%20ova.htm`, note: teachingNote },
  'buckelew-hookworm': { title: 'Buckelew — Ancylostoma duodenale ova', url: `${buckelewBase}Ancylostoma%20duodenale%20ova.htm`, note: teachingNote },
  'buckelew-necator': { title: 'Buckelew — Necator americanus ova', url: `${buckelewBase}Necator%20americanus%20ova.htm`, note: teachingNote },
  'buckelew-taeniid': { title: 'Buckelew — Egg capsule of a typical taeniid', url: `${buckelewBase}egg_capsule_of_a_typical_taeniid.htm`, note: teachingNote },
  'buckelew-enterobius': { title: 'Buckelew — Enterobius vermicularis ova', url: `${buckelewBase}Enterobius%20vermicularis%20ova.htm`, note: teachingNote },
  'buckelew-nana': { title: 'Buckelew — Vampirolepis (Hymenolepis) nana ova', url: `${buckelewBase}Vampirolepis%20nana%20ova.htm`, note: teachingNote },
  'buckelew-diminuta': { title: 'Buckelew — Hymenolepis diminuta ova', url: `${buckelewBase}Hymenolepis%20diminuta%20ova.htm`, note: teachingNote },
  'buckelew-diminuta-hooks': { title: 'Buckelew — Six-hooked Hymenolepis diminuta larva', url: `${buckelewBase}egg_capsule_of_hymenolepis_dimin.htm`, note: teachingNote },
  'buckelew-fasciolopsis': { title: 'Buckelew — Fasciolopsis buski ova', url: `${buckelewBase}Fasciolopsis%20buski%20ova.htm`, note: teachingNote },
};

export const atlasEvidenceNote = 'แบบจำลองแสดงโครงสร้างของไข่และตัวอ่อน ไม่ใช่ออร์แกเนลล์ระดับเซลล์ สี การแยกชั้น และขนาดส่วนต่าง ๆ เป็นภาพอธิบาย โครงสร้างบางส่วนอาจไม่เห็นในภาพกล้องจุลทรรศน์ระนาบเดียวหรือพบต่างกันตามระยะพัฒนา';

function feature(
  id: string,
  label: string,
  shortLabel: string,
  description: string,
  position: [number, number, number],
  internal: boolean,
  ...sourceIds: string[]
): AtlasStructure {
  return { id, label, shortLabel, description, position, internal, sourceIds };
}

const structures: Record<string, AtlasStructure[]> = {
  ascaris: [
    feature('mammillated-coat', 'ชั้นผิวนอกขรุขระ (mammillated coat)', 'ผิวนอกขรุขระ', 'ชั้นผิวนอกของไข่ที่ปฏิสนธิแล้วมีปุ่มขรุขระ ไข่ที่ชั้นนี้หลุดออกจะดูเรียบ จึงไม่ควรใช้ผิวขรุขระเป็นเงื่อนไขเพียงข้อเดียว', [.35, .79, .2], false, 'cdc-ascariasis', 'buckelew-ascaris'),
    feature('shell', 'เปลือกไข่หนา (eggshell)', 'เปลือกหนา', 'เปลือกห่อหุ้มเซลล์ไข่และช่วยป้องกันสิ่งแวดล้อม การแยกแนวชั้นในแบบจำลองใช้สื่อความหนา ไม่ใช่การยืนยันจำนวนหรือความหนาของชั้นจากภาพถ่าย', [0, .69, .12], false, 'cdc-ascariasis'),
    feature('ovum', 'เซลล์ไข่ในไข่ที่ปฏิสนธิแล้ว (ovum)', 'เซลล์ไข่', 'แบบจำลองนี้เลือกแสดงไข่ที่ปฏิสนธิแล้วแต่ยังไม่พัฒนาเป็นตัวอ่อน เมื่อไข่พัฒนาในสิ่งแวดล้อม รูปร่างภายในจะเปลี่ยนและอาจเห็นตัวอ่อนขดอยู่', [0, 0, .2], true, 'cdc-ascariasis', 'buckelew-ascaris'),
    feature('perivitelline-space', 'ช่องว่างระหว่างเปลือกกับเซลล์ไข่', 'ช่องว่างภายใน', 'บริเวณรอบเซลล์ไข่ภายในเปลือก ช่วยให้แยกขอบเซลล์ออกจากผนังไข่ได้ ความกว้างที่เห็นขึ้นกับระยะพัฒนาและระนาบโฟกัส', [.9, .1, .15], true, 'cdc-ascariasis'),
  ],
  trichuris: [
    feature('shell', 'เปลือกไข่เรียบค่อนข้างหนา', 'เปลือกเรียบ', 'เปลือกสีน้ำตาลเหลืองค่อนข้างหนา มีรูปทรงคล้ายถังหรือมะนาว สีและความเข้มอาจเปลี่ยนตามวิธีเตรียมตัวอย่าง', [0, .58, .1], false, 'cdc-trichuriasis'),
    feature('polar-plugs', 'จุกที่ขั้วทั้งสอง (bipolar plugs)', 'จุกสองขั้ว', 'จุกใสอยู่ที่ปลายทั้งสองข้าง เป็นจุดสังเกตสำคัญร่วมกับรูปทรงและขนาด แสดงให้เห็นด้านหนึ่งได้ชัดเมื่อหมุนไข่ตามแกนยาว', [1.46, 0, .05], false, 'cdc-trichuriasis', 'buckelew-trichuris'),
    feature('ovum', 'มวลเซลล์ไข่ที่ยังไม่เป็นตัวอ่อน', 'เซลล์ไข่', 'ไข่ที่ออกมากับอุจจาระสดมักยังไม่พัฒนาเป็นตัวอ่อน ภาพตัดนี้จึงแสดงมวลเซลล์ไข่โดยไม่ใส่ตัวหนอนหรืออวัยวะที่ยังไม่พัฒนา', [0, 0, .2], true, 'cdc-trichuriasis'),
    feature('perivitelline-space', 'ช่องว่างภายในรอบเซลล์ไข่', 'ช่องว่างภายใน', 'ช่องว่างแยกมวลเซลล์ไข่จากผนัง ภาพตัดช่วยสังเกตขอบเปลือก มวลภายใน และจุกขั้วร่วมกัน ไม่ใช่ช่องที่เปิดสู่ภายนอก', [.92, .03, .15], true, 'cdc-trichuriasis'),
  ],
  hookworm: [
    feature('shell', 'เปลือกไข่บางและใส', 'เปลือกบาง', 'เปลือกบางเรียบ ล้อมมวลตัวอ่อนและช่องว่างภายใน ลักษณะไข่เพียงอย่างเดียวแยก Ancylostoma จาก Necator ไม่ได้อย่างน่าเชื่อถือ', [0, .72, .1], false, 'cdc-hookworm', 'buckelew-hookworm'),
    feature('blastomeres', 'เซลล์ระยะแบ่งตัว (blastomeres)', 'เซลล์แบ่งตัว', 'ตัวอย่างสดมักเห็นเซลล์ระยะแบ่งตัวราว 4–8 เซลล์ จำนวนและรูปร่างเปลี่ยนตามเวลา แบบจำลองเลือกจำนวนเพื่ออธิบายระยะหนึ่ง ไม่ใช่ค่าตายตัวทุกฟอง', [0, .1, .2], true, 'cdc-hookworm', 'buckelew-necator'),
    feature('perivitelline-space', 'ช่องว่างระหว่างเปลือกกับมวลเซลล์', 'ช่องว่างรอบเซลล์', 'บริเวณใสรอบมวลเซลล์เป็นจุดเปรียบเทียบที่มีประโยชน์กับไข่เปลือกหนา ความชัดขึ้นกับโฟกัสและวิธีเตรียมตัวอย่าง', [.95, .05, .1], true, 'cdc-hookworm'),
    feature('ovoid-contour', 'แนวรูปรีของไข่', 'แนวรูปรี', 'รูปรีของเปลือกช่วยประเมินภาพรวมร่วมกับเปลือกบางและมวลเซลล์ภายใน จุดนี้เป็นลักษณะรูปร่าง ไม่ใช่ออร์แกเนลล์หรือโครงสร้างแยกชั้น', [1.3, .12, .05], false, 'cdc-hookworm'),
  ],
  opisthorchis: [
    feature('shell', 'เปลือกไข่ขนาดเล็กสีน้ำตาลเหลือง', 'เปลือกไข่', 'ไข่ OV มีขนาดเล็กมาก ต้องเทียบสเกลที่สอบเทียบแล้ว ภาพขยายใน Atlas ไม่ใช้เปรียบเทียบขนาดจริงข้ามชนิด', [0, .61, .05], false, 'cdc-opisthorchiasis'),
    feature('operculum', 'ฝาปิด (operculum)', 'ฝาปิด', 'ฝาปิดอยู่ที่ขั้วหนึ่งของไข่ ใช้สังเกตร่วมกับบ่าและปลายตรงข้าม ไม่ควรแยก OV จากพยาธิใบไม้ชนิดใกล้เคียงด้วยฝาปิดเพียงจุดเดียว', [-1.188, 0, .05], false, 'cdc-opisthorchiasis'),
    feature('opercular-shoulders', 'บ่ารองรับฝาปิด (opercular shoulders)', 'บ่ารองฝา', 'ขอบบ่ายกขึ้นตรงรอยต่อฝาและตัวไข่ เป็นลักษณะสำคัญของไข่กลุ่ม Opisthorchis แต่ความชัดอาจเปลี่ยนตามมุมและระนาบโฟกัส', [-1.188, .333, .05], false, 'cdc-opisthorchiasis'),
    feature('abopercular-knob', 'ปุ่มที่ขั้วตรงข้ามฝาปิด', 'ปุ่มปลายตรงข้าม', 'ปลายตรงข้ามฝาอาจเห็นปุ่มเล็ก หรือ abopercular knob ภาพตัดขยายปุ่มเพื่อให้เรียนรู้ได้ ไม่ใช่เกณฑ์ยืนยันชนิดด้วยตัวเอง', [1.36, 0, .05], false, 'cdc-opisthorchiasis'),
    feature('miracidium', 'ตัวอ่อน miracidium ภายในไข่', 'Miracidium', 'ไข่ OV มีตัวอ่อนพัฒนาอยู่แล้วเมื่อออกมากับอุจจาระ แบบจำลองแสดงรูปร่างรวมของตัวอ่อน ไม่ยืนยันตำแหน่งอวัยวะหรือขน cilia จากภาพไข่', [0, 0, .2], true, 'cdc-opisthorchiasis'),
  ],
  taenia: [
    feature('embryophore', 'ชั้นหุ้มตัวอ่อนหนา (embryophore)', 'Embryophore', 'ชั้นหุ้มตัวอ่อนที่เห็นเด่นมีลักษณะหนา ส่วนเยื่อหุ้มชั้นนอกอาจหลุดหายไปก่อนตรวจ จึงไม่ควรเข้าใจว่าภาพทุกฟองต้องเห็นเยื่อบางรอบนอก', [0, .88, .08], false, 'cdc-taeniasis', 'buckelew-taeniid'),
    feature('radial-striations', 'ลายเป็นรัศมีของ embryophore', 'ลายรัศมี', 'แนวลายรัศมีรอบชั้นหุ้มเป็นลักษณะสำคัญของไข่ taeniid ลายในแบบจำลองเป็นภาพอธิบาย ไม่ใช้แยก T. solium และ T. saginata', [.68, .68, .05], false, 'cdc-taeniasis', 'buckelew-taeniid'),
    feature('embryo', 'ตัวอ่อน oncosphere หรือ hexacanth', 'Oncosphere', 'ตัวอ่อนอยู่ภายใน embryophore มีตะขอรวม 6 อัน ควรประเมินร่วมกับขนาดและลายชั้นหุ้ม ไม่รายงานชนิด Taenia จากไข่เพียงอย่างเดียว', [0, 0, .2], true, 'cdc-taeniasis'),
    feature('hooks', 'ตะขอ 3 คู่ (six hooks)', 'ตะขอ 3 คู่', 'ตัวอ่อนมีตะขอ 3 คู่ แบบจำลองแยกให้เห็นครบเพื่อการเรียนรู้ แต่ภาพกล้องระนาบเดียวอาจเห็นไม่ครบทั้ง 6 อัน', [.2, 0, .49], true, 'cdc-taeniasis'),
  ],
  enterobius: [
    feature('shell', 'เปลือกไข่ใสและค่อนข้างหนา', 'เปลือกใส', 'เปลือกใสห่อหุ้มตัวอ่อน รูปร่างไม่สมมาตรเป็นจุดสังเกตสำคัญกว่าสี ซึ่งอาจขึ้นกับแสงและวิธีเตรียมสไลด์', [0, .65, .1], false, 'cdc-enterobiasis'),
    feature('flattened-side', 'ด้านแบนของเปลือก (planoconvex)', 'ด้านแบน', 'ด้านหนึ่งแบน อีกด้านโค้ง ทำให้ดูคล้ายตัว D มุมของไข่บนสไลด์อาจทำให้ด้านแบนไม่เด่น จึงควรเปลี่ยนระนาบโฟกัสร่วมด้วย', [0, -.25, .05], false, 'cdc-enterobiasis', 'buckelew-enterobius'),
    feature('larval-body', 'ตัวอ่อนที่ขดอยู่ภายใน', 'ตัวอ่อน', 'ภายในอาจเห็นตัวอ่อนกำลังพัฒนา รูปร่างขึ้นกับระยะของไข่ แบบจำลองเลือกแสดงตัวอ่อนขดและไม่ได้จำลองระบบอวัยวะย่อย', [.1, .05, .1], true, 'cdc-enterobiasis'),
    feature('perivitelline-space', 'ช่องว่างระหว่างตัวอ่อนกับเปลือก', 'ช่องว่างรอบตัวอ่อน', 'ช่องว่างช่วยให้ติดตามแนวตัวอ่อนแยกจากเปลือกได้ การเก็บไข่ชนิดนี้มักใช้เทปใสรอบทวารหนัก ไม่ใช่อาศัยอุจจาระเพียงอย่างเดียว', [1.05, .05, .1], true, 'cdc-enterobiasis'),
  ],
  mif: [
    feature('shell', 'เปลือกไข่ของกลุ่ม MIF', 'เปลือกไข่', 'MIF รวมพยาธิใบไม้ลำไส้ขนาดเล็กหลายชนิด เปลือกและรูปทรงแตกต่างกัน แบบจำลองเป็นภาพรวม ไม่ใช่ไข่ของชนิดใดชนิดหนึ่ง', [0, .61, .05], false, 'cdc-heterophyiasis', 'cdc-metagonimiasis'),
    feature('operculum', 'ฝาปิดที่ขั้วไข่ (operculum)', 'ฝาปิด', 'ฝาปิดเป็นลักษณะร่วมของไข่กลุ่มตัวอย่างนี้ แต่ความเด่นของขอบฝาและบ่าต่างกัน ไม่สามารถใช้แบบจำลองรวมยืนยันชื่อชนิดจากภาพจริง', [-1.118, 0, .05], false, 'cdc-heterophyiasis', 'cdc-metagonimiasis'),
    feature('miracidium', 'ตัวอ่อน miracidium', 'Miracidium', 'ไข่ของ MIF กลุ่มอ้างอิง เช่น Heterophyes และ Metagonimus มีตัวอ่อนเมื่อขับออกมากับอุจจาระ ภาพตัดแสดงตัวอ่อนโดยรวม ไม่ใส่อวัยวะย่อยที่ภาพไข่ไม่รองรับ', [0, 0, .2], true, 'cdc-heterophyiasis', 'cdc-metagonimiasis'),
    feature('abopercular-end', 'ปลายไข่ตรงข้ามฝาปิด', 'ปลายตรงข้ามฝา', 'รูปร่างบริเวณนี้อาจต่างกันตามชนิด จึงไม่สร้างปุ่มแบบ OV ให้เป็นลักษณะตายตัวของ MIF ทั้งกลุ่ม ไข่ MIF อาจคล้าย OV และต้องตรวจยืนยันเพิ่มเติม', [1.23, 0, .05], false, 'cdc-heterophyiasis', 'cdc-metagonimiasis'),
  ],
  'hymenolepis-nana': [
    feature('outer-membrane', 'เยื่อหุ้มไข่ชั้นนอก', 'เยื่อชั้นนอก', 'เยื่อบางชั้นนอกล้อมช่องว่างและชั้นหุ้มตัวอ่อน การมองเห็นขอบเยื่อสองชั้นช่วยเปรียบเทียบกับไข่พยาธิตืดกลุ่มอื่น', [0, .86, .05], false, 'cdc-hymenolepiasis'),
    feature('inner-membrane', 'เยื่อชั้นในหรือ embryophore', 'เยื่อชั้นใน', 'ชั้นหุ้มตัวอ่อนอยู่ด้านใน โดยมีขั้วหนาสองด้าน เป็นจุดกำเนิดของเส้นใยขั้ว ไม่ใช่เยื่อของเซลล์เดี่ยว', [0, .58, .05], true, 'cdc-hymenolepiasis', 'buckelew-nana'),
    feature('polar-thickenings', 'บริเวณขั้วหนาสองขั้ว', 'ขั้วหนา', 'เยื่อชั้นในหนาตัวที่ขั้วทั้งสอง จากขั้วเหล่านี้มีเส้นใยยื่นเข้าสู่ช่องว่างระหว่างเยื่อ ช่วยแยก H. nana จาก H. diminuta', [.59, 0, .1], true, 'cdc-hymenolepiasis'),
    feature('polar-filaments', 'เส้นใยขั้ว (polar filaments)', 'เส้นใยขั้ว', 'เส้นใยประมาณ 4–8 เส้นออกจากบริเวณขั้วและทอดอยู่ระหว่างเยื่อ ความชัดขึ้นกับโฟกัส การไม่เห็นเส้นใยในภาพเดียวไม่เพียงพอจะตัด H. nana ออก', [.75, .2, .2], true, 'cdc-hymenolepiasis', 'buckelew-nana'),
    feature('embryo', 'ตัวอ่อน oncosphere', 'Oncosphere', 'ตัวอ่อนมีตะขออยู่ภายในเยื่อชั้นใน ต้องพิจารณาร่วมกับเส้นใยขั้ว เยื่อหุ้ม และขนาดที่สอบเทียบแล้ว', [0, 0, .2], true, 'cdc-hymenolepiasis', 'buckelew-nana'),
    feature('hooks', 'ตะขอของตัวอ่อน 3 คู่', 'ตะขอ 3 คู่', 'ตัวอ่อนมีตะขอรวม 6 อัน แบบจำลองขยายและแยกตะขอให้เห็นครบ ภาพจริงอาจเห็นเพียงบางอันในระนาบโฟกัสนั้น', [.17, 0, .42], true, 'cdc-hymenolepiasis', 'buckelew-nana'),
  ],
  'hymenolepis-diminuta': [
    feature('outer-membrane', 'เยื่อหุ้มไข่ชั้นนอกค่อนข้างหนา', 'เยื่อชั้นนอก', 'เยื่อชั้นนอกค่อนข้างหนา ไข่โดยทั่วไปมีขนาดใหญ่กว่า H. nana แต่ต้องมีสเกลที่สอบเทียบ ไม่ใช้ขนาดการแสดงผลบนหน้าจอตัดสิน', [0, .87, .05], false, 'cdc-hymenolepiasis'),
    feature('inner-membrane', 'เยื่อชั้นในหุ้มตัวอ่อน', 'เยื่อชั้นใน', 'เยื่อชั้นในค่อนข้างบางและแยกจากชั้นนอก ชนิดนี้ไม่มี polar filaments จึงไม่ได้ใส่เส้นใยหรือขั้วหนาแบบ H. nana ในแบบจำลอง', [0, .58, .05], true, 'cdc-hymenolepiasis', 'buckelew-diminuta'),
    feature('intermembrane-space', 'ช่องว่างระหว่างเยื่อหุ้มสองชั้น', 'ช่องว่างระหว่างเยื่อ', 'ช่องว่างคั่นระหว่างเยื่อชั้นนอกและ embryophore ไม่มีเส้นใยขั้ว อย่างไรก็ตาม ควรประเมินภาพหลายระนาบก่อนสรุปว่าภาพจริงไม่มีเส้นใย', [.82, .15, .1], true, 'cdc-hymenolepiasis', 'buckelew-diminuta'),
    feature('embryo', 'ตัวอ่อน oncosphere หรือ hexacanth', 'Oncosphere', 'ตัวอ่อนอยู่ภายในเยื่อชั้นในและมีตะขอ 6 อัน เป็นโครงสร้างของตัวอ่อน ไม่ใช่หน่วยเซลล์หรือออร์แกเนลล์', [0, 0, .2], true, 'cdc-hymenolepiasis', 'buckelew-diminuta'),
    feature('hooks', 'ตะขอของตัวอ่อน 3 คู่', 'ตะขอ 3 คู่', 'ตะขอรวม 6 อันอยู่กับตัวอ่อน hexacanth การแสดงให้เห็นครบเป็นภาพอธิบาย รูปร่างและการซ้อนกันในภาพจริงอาจทำให้เห็นไม่ครบ', [.17, 0, .42], true, 'cdc-hymenolepiasis', 'buckelew-diminuta-hooks'),
  ],
  echinostoma: [
    feature('shell', 'เปลือกไข่ค่อนข้างบาง', 'เปลือกไข่', 'ไข่รูปรีสีน้ำตาลเหลือง ขนาดและรายละเอียดแตกต่างกันระหว่างชนิดใน Echinostoma หนามรอบหัวเป็นลักษณะของตัวเต็มวัย จึงไม่ใส่ในแบบจำลองไข่', [0, .72, .05], false, 'cdc-echinostomiasis'),
    feature('operculum', 'ฝาปิดที่ขั้วไข่ (operculum)', 'ฝาปิด', 'มีฝาปิดที่ขั้วหนึ่ง ซึ่งอาจเห็นไม่ชัดเมื่อภาพไม่อยู่ในโฟกัส ลักษณะนี้ไม่เพียงพอแยกจากไข่พยาธิใบไม้ขนาดใหญ่อื่น', [-1.232, 0, .05], false, 'cdc-echinostomiasis'),
    feature('ovum', 'เซลล์ไข่ที่ยังไม่พัฒนาเป็นตัวอ่อน', 'เซลล์ไข่', 'ไข่ที่ออกมากับอุจจาระมักยังไม่เป็นตัวอ่อน แบบจำลองจึงแสดงเซลล์ไข่และเซลล์ไข่แดง แทนการวาด miracidium ที่พัฒนาแล้ว', [-.24, .05, .2], true, 'cdc-echinostomiasis'),
    feature('yolk-cells', 'เซลล์ไข่แดง (vitelline cells)', 'เซลล์ไข่แดง', 'เซลล์ไข่แดงเป็นวัสดุเลี้ยงตัวอ่อนในระยะพัฒนา จำนวนและการจัดวางในภาพตัดเป็นภาพอธิบาย ไม่ใช่ค่าคงที่สำหรับแยกชนิด', [.4, .2, .2], true, 'cdc-echinostomiasis'),
  ],
  fasciolopsis: [
    feature('shell', 'เปลือกไข่รูปรีขนาดใหญ่', 'เปลือกไข่', 'เปลือกค่อนข้างบาง สีน้ำตาลเหลือง ไข่คล้าย Fasciola มากและไม่สามารถยืนยัน F. buski ด้วยลักษณะไข่เพียงอย่างเดียว', [0, .69, .05], false, 'cdc-fasciolopsiasis', 'buckelew-fasciolopsis'),
    feature('operculum', 'ฝาปิดที่อาจเห็นไม่ชัด', 'ฝาปิด', 'ฝาปิดอยู่ขั้วหนึ่งของไข่และอาจไม่เด่นในภาพจริง แบบจำลองขยายแนวขอบฝาเพื่อให้เข้าใจตำแหน่ง ไม่ใช่ลักษณะเฉพาะที่ยืนยันชนิด', [-1.452, 0, .05], false, 'cdc-fasciolopsiasis'),
    feature('ovum', 'เซลล์ไข่ในไข่ที่ยังไม่เป็นตัวอ่อน', 'เซลล์ไข่', 'ไข่ที่ขับออกมาโดยทั่วไปยังไม่เป็นตัวอ่อน แบบจำลองจึงไม่ใส่ miracidium ที่พัฒนาแล้ว การพัฒนาภายในจะเปลี่ยนไปเมื่ออยู่ในสิ่งแวดล้อมที่เหมาะสม', [-.28, .05, .2], true, 'cdc-fasciolopsiasis'),
    feature('yolk-cells', 'เซลล์ไข่แดงรอบเซลล์ไข่', 'เซลล์ไข่แดง', 'ภายในมีเซลล์ไข่แดงประกอบกับเซลล์ไข่ ภาพตัดใช้แสดงองค์ประกอบทั่วไปของไข่ระยะนี้ ไม่ใช้จำนวนหรือสีของเม็ดในแบบจำลองเป็นเกณฑ์วินิจฉัย', [.4, .2, .2], true, 'cdc-fasciolopsiasis'),
  ],
};

/** Unsupported species must never silently inherit an unrelated egg anatomy. */
export function getAtlasStructures(speciesId: string): AtlasStructure[] {
  return structures[speciesId] ?? [];
}
