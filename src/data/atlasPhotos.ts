/** Real microscopy assets; licenses apply to photographs separately from app source. */
export interface AtlasPhoto {
  id: string; speciesId: string; src: string; sourceTaxon: string;
  caption: string; credit: string; license: string; licenseUrl: string;
  sourceUrl: string; sourceImageUrl: string; changes: string;
  observableStructureIds: string[]; stageNote?: string;
}

export const atlasPhotos: AtlasPhoto[] = [
  {
    "id": "ascaris-fertilized-unfertilized-buckelew",
    "speciesId": "ascaris",
    "src": "/atlas/photos/ascaris-fertilized-unfertilized-buckelew.jpg",
    "sourceTaxon": "Ascaris lumbricoides",
    "caption": "ภาพไข่ Ascaris lumbricoides หลายระยะ ผู้เขียนระบุว่าส่วนใหญ่เป็นไข่ปฏิสนธิ ยกเว้นฟองซ้ายล่าง (400×)",
    "credit": "Thomas P. Buckelew, Ph.D. — Parasitology Educational Archive",
    "license": "CC BY-NC 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
    "sourceUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/Ascaris%20lumbricoides%20ova.htm",
    "sourceImageUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/images/Ascaris%20eggs%20fertilized%20and%20unfertilized.jpg",
    "changes": "ภาพต้นฉบับ ไม่มีการครอปหรือปรับสี",
    "observableStructureIds": [
      "mammillated-coat",
      "shell",
      "ovum"
    ],
    "stageNote": "คำบรรยายระยะไข่อ้างตามผู้ถ่าย ภาพไม่มีแถบมาตราส่วน จึงใช้วัดขนาดไมโครเมตรจากภาพโดยตรงไม่ได้"
  },
  {
    "id": "ascaris-embryonated-buckelew",
    "speciesId": "ascaris",
    "src": "/atlas/photos/ascaris-embryonated-buckelew.jpg",
    "sourceTaxon": "Ascaris lumbricoides",
    "caption": "ไข่ Ascaris lumbricoides ระยะมีตัวอ่อน เห็นผิวเปลือกขรุขระและตัวอ่อนภายใน (ต้นฉบับระบุ 400×)",
    "credit": "Thomas P. Buckelew, Ph.D. — Parasitology Educational Archive",
    "license": "CC BY-NC 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
    "sourceUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/Ascaris%20lumbricoides%20ova.htm",
    "sourceImageUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/images/Ascaris%20eggs%20fertilized%20and%20embryonated.jpg",
    "changes": "ภาพต้นฉบับ ไม่มีการครอปหรือปรับสี",
    "observableStructureIds": [
      "mammillated-coat",
      "shell"
    ],
    "stageNote": "ภาพนี้เป็นระยะไข่มีตัวอ่อน การพัฒนาภายในจึงต่างจากไข่ที่เพิ่งขับออกมากับอุจจาระ"
  },
  {
    "id": "trichuris-buckelew",
    "speciesId": "trichuris",
    "src": "/atlas/photos/trichuris-buckelew.jpg",
    "sourceTaxon": "Trichuris trichiura",
    "caption": "ไข่ Trichuris trichiura รูปทรงคล้ายถัง ปลายทั้งสองมีจุก (ต้นฉบับระบุ 400×)",
    "credit": "Thomas P. Buckelew, Ph.D. — Parasitology Educational Archive",
    "license": "CC BY-NC 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
    "sourceUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/Trichuris%20trichiura%20ova.htm",
    "sourceImageUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/images/Trichuris%20trichiura%20egg.jpg",
    "changes": "ภาพต้นฉบับ ไม่มีการครอปหรือปรับสี",
    "observableStructureIds": [
      "shell",
      "polar-plugs"
    ],
    "stageNote": "ไม่มีแถบมาตราส่วน ห้ามอนุมานขนาดจริงจากขนาดบนจอ"
  },
  {
    "id": "hookworm-buckelew",
    "speciesId": "hookworm",
    "src": "/atlas/photos/hookworm-buckelew.jpg",
    "sourceTaxon": "Ancylostoma duodenale (Hookworm group)",
    "caption": "ตัวอย่างไข่พยาธิปากขอ ต้นฉบับระบุ Ancylostoma duodenale (400×)",
    "credit": "Thomas P. Buckelew, Ph.D. — Parasitology Educational Archive",
    "license": "CC BY-NC 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
    "sourceUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/Ancylostoma%20duodenale%20ova.htm",
    "sourceImageUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/images/Ancylostoma%20duodenale%20egg2.jpg",
    "changes": "ภาพต้นฉบับ ไม่มีการครอปหรือปรับสี",
    "observableStructureIds": [
      "shell",
      "ovoid-contour"
    ],
    "stageNote": "ใช้แสดงกลุ่ม Hookworm เท่านั้น ภาพไข่ทั่วไปแยก Ancylostoma และ Necator อย่างน่าเชื่อถือไม่ได้ ภาพนี้ไม่เห็นเซลล์แบ่งตัวทุกส่วนชัดเจน"
  },
  {
    "id": "taenia-buckelew",
    "speciesId": "taenia",
    "src": "/atlas/photos/taenia-buckelew.jpg",
    "sourceTaxon": "Taeniidae (typical taeniid egg)",
    "caption": "ตัวอย่างไข่กลุ่ม Taeniidae เห็น embryophore มีลายรัศมี (400×) ใช้ประกอบการเรียนรู้ Taenia spp.",
    "credit": "Thomas P. Buckelew, Ph.D. — Parasitology Educational Archive",
    "license": "CC BY-NC 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
    "sourceUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/egg_capsule_of_a_typical_taeniid.htm",
    "sourceImageUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/images/Taenia%20saginata%20egg.jpg",
    "changes": "ภาพต้นฉบับ ไม่มีการครอปหรือปรับสี",
    "observableStructureIds": [
      "embryophore",
      "radial-striations"
    ],
    "stageNote": "หน้าต้นฉบับบรรยายเป็น typical taeniid แม้ชื่อไฟล์ระบุ T. saginata ไข่เพียงอย่างเดียวไม่ยืนยัน T. saginata หรือ T. solium และไม่ใช่ภาพยืนยันชนิดด้วยวิธีโมเลกุล"
  },
  {
    "id": "enterobius-buckelew",
    "speciesId": "enterobius",
    "src": "/atlas/photos/enterobius-buckelew.jpg",
    "sourceTaxon": "Enterobius vermicularis",
    "caption": "ไข่ Enterobius vermicularis ด้านหนึ่งแบน ลักษณะคล้ายตัว D (ต้นฉบับระบุ 400×)",
    "credit": "Thomas P. Buckelew, Ph.D. — Parasitology Educational Archive",
    "license": "CC BY-NC 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
    "sourceUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/Enterobius%20vermicularis%20ova.htm",
    "sourceImageUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/images/Enterobius%20ova.jpg",
    "changes": "ภาพต้นฉบับ ไม่มีการครอปหรือปรับสี",
    "observableStructureIds": [
      "shell",
      "flattened-side"
    ],
    "stageNote": "ไม่มีแถบมาตราส่วนและไม่ได้ระบุวิธีเตรียมสไลด์"
  },
  {
    "id": "hymenolepis-nana-buckelew",
    "speciesId": "hymenolepis-nana",
    "src": "/atlas/photos/hymenolepis-nana-buckelew.jpg",
    "sourceTaxon": "Hymenolepis nana",
    "caption": "ภาพไข่ Hymenolepis nana (ในแหล่งเดิมใช้ชื่อ Vampirolepis nana) ที่กำลังขยาย 400× เห็นตัวอ่อนและเส้นใยขั้วไข่",
    "credit": "Thomas P. Buckelew, Ph.D. — Parasitology Educational Archive",
    "license": "CC BY-NC 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
    "sourceUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/Vampirolepis%20nana%20ova.htm",
    "sourceImageUrl": "https://raw.githubusercontent.com/tombuckelew/parasitology-images/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/images/Vampirolepis%20nana%20egg.jpg",
    "changes": "ภาพต้นฉบับ ไม่มีการครอปหรือปรับสี",
    "observableStructureIds": [
      "outer-membrane",
      "inner-membrane",
      "embryo",
      "polar-filaments"
    ],
    "stageNote": "ต้นฉบับระบุกำลังขยาย 400× แต่ไม่มีแถบมาตราส่วน จึงวัดขนาดจริงจากภาพบนจอไม่ได้"
  },
  {
    "id": "hymenolepis-diminuta-buckelew",
    "speciesId": "hymenolepis-diminuta",
    "src": "/atlas/photos/hymenolepis-diminuta-buckelew.jpg",
    "sourceTaxon": "Hymenolepis diminuta",
    "caption": "ภาพไข่ Hymenolepis diminuta ที่กำลังขยาย 400× เห็นผนังชั้นนอกแยกจาก embryophore และตัวอ่อน hexacanth ไม่มีเส้นใยขั้วไข่",
    "credit": "Thomas P. Buckelew, Ph.D. — Parasitology Educational Archive",
    "license": "CC BY-NC 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
    "sourceUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/Hymenolepis%20diminuta%20ova.htm",
    "sourceImageUrl": "https://raw.githubusercontent.com/tombuckelew/parasitology-images/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/images/Hymenolepis%20diminuta%20egg%202.jpg",
    "changes": "ภาพต้นฉบับ ไม่มีการครอปหรือปรับสี",
    "observableStructureIds": [
      "outer-membrane",
      "inner-membrane",
      "embryo"
    ],
    "stageNote": "ต้นฉบับระบุกำลังขยาย 400× แต่ไม่มีแถบมาตราส่วน จึงวัดขนาดจริงจากภาพบนจอไม่ได้"
  },
  {
    "id": "fasciolopsis-buski-buckelew",
    "speciesId": "fasciolopsis",
    "src": "/atlas/photos/fasciolopsis-buski-buckelew.jpg",
    "sourceTaxon": "Fasciolopsis buski",
    "caption": "ภาพไข่ Fasciolopsis buski ที่กำลังขยาย 400× แหล่งต้นฉบับระบุว่าไข่แยกจาก Fasciola hepatica ด้วยรูปร่างเพียงอย่างเดียวไม่ได้",
    "credit": "Thomas P. Buckelew, Ph.D. — Parasitology Educational Archive",
    "license": "CC BY-NC 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
    "sourceUrl": "https://github.com/tombuckelew/parasitology-images/blob/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/Fasciolopsis%20buski%20ova.htm",
    "sourceImageUrl": "https://raw.githubusercontent.com/tombuckelew/parasitology-images/901b77d18f847eedc36e9c653bddb121224ff1c8/site/Buckelew/images/Fasciolopsis%20buski%20egg%20capsule.jpg",
    "changes": "ภาพต้นฉบับ ไม่มีการครอปหรือปรับสี",
    "observableStructureIds": [
      "shell",
      "operculum"
    ],
    "stageNote": "ต้นฉบับระบุกำลังขยาย 400× แต่ไม่มีแถบมาตราส่วน จึงวัดขนาดจริงจากภาพบนจอไม่ได้"
  }
];

export function getAtlasPhotos(speciesId: string): AtlasPhoto[] {
  return atlasPhotos.filter((photo) => photo.speciesId === speciesId);
}
