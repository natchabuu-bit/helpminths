export type SpeciesGroup = 'nematode' | 'trematode' | 'cestode';

export interface ParasiteSpecies {
  id: string;
  name: string;
  thaiName: string;
  group: SpeciesGroup;
  size: string;
  shape: string;
  description: string;
  color: string;
  features: string[];
  clinicalNote?: string;
}

/** Reference morphology, independent of the classes supported by an inference model. */
export const species: ParasiteSpecies[] = [
  {
    id: 'ascaris', name: 'Ascaris lumbricoides', thaiName: 'พยาธิไส้เดือน', group: 'nematode',
    size: '45–75 × 35–50 µm', shape: 'รูปรี · เปลือกหนา', color: '#d3a066',
    description: 'แบบจำลองไข่ที่ปฏิสนธิแล้ว มีเปลือกหนาและชั้นโปรตีนผิวนอกขรุขระ สีน้ำตาลจากน้ำดี รูปร่างอาจกลมถึงรี',
    features: ['ชั้นนอกขรุขระ (mammillated coat)', 'เปลือกหนาหลายชั้น', 'เซลล์ไข่อยู่กลางฟอง'],
    clinicalNote: 'ไข่ที่สูญเสียชั้นผิวนอกอาจดูเรียบ (decorticated) และไข่ที่ไม่ปฏิสนธิมีรูปร่างและขนาดต่างออกไป',
  },
  {
    id: 'trichuris', name: 'Trichuris trichiura', thaiName: 'พยาธิแส้ม้า', group: 'nematode',
    size: '50–55 × 20–25 µm', shape: 'ทรงถัง · จุกสองขั้ว', color: '#b98248',
    description: 'ไข่สีน้ำตาลเหลืองคล้ายถังหรือมะนาว เปลือกค่อนข้างหนา เรียบ และมีจุกใสยื่นออกที่ปลายทั้งสองข้าง',
    features: ['จุกใสที่ขั้วทั้งสอง (bipolar plugs)', 'เปลือกเรียบสีน้ำตาล', 'ทรงถังสมมาตร'],
  },
  {
    id: 'hookworm', name: 'Hookworm', thaiName: 'พยาธิปากขอ', group: 'nematode',
    size: '60–75 × 35–40 µm', shape: 'รูปรี · เปลือกบาง', color: '#c8bba5',
    description: 'ไข่รูปรี เปลือกบางและใส มีช่องว่างระหว่างเปลือกกับตัวอ่อน ตัวอย่างอุจจาระสดมักเห็นตัวอ่อนแบ่งเป็น 4–8 เซลล์',
    features: ['เปลือกบางและใส', 'ตัวอ่อนระยะแบ่งเซลล์', 'ช่องว่างรอบตัวอ่อน'],
    clinicalNote: 'ไข่ของ Ancylostoma และ Necator แยกชนิดจากลักษณะไข่เพียงอย่างเดียวได้ไม่แน่นอน',
  },
  {
    id: 'opisthorchis', name: 'Opisthorchis viverrini', thaiName: 'พยาธิใบไม้ตับ (OV)', group: 'trematode',
    size: '19–30 × 10–20 µm', shape: 'รูปรีขนาดเล็ก · มีฝาปิดและบ่า', color: '#c89b43',
    description: 'ไข่ขนาดเล็กสีน้ำตาลเหลือง มีฝาปิด (operculum) ที่ขั้วหนึ่งและบ่ารองรับฝา ปลายตรงข้ามอาจเห็นปุ่มเล็ก (abopercular knob) ภายในมีตัวอ่อน miracidium เมื่อขับออกมากับอุจจาระ',
    features: ['ฝาปิดและบ่า (operculum and shoulders)', 'ปุ่มเล็กที่ขั้วตรงข้ามฝา (abopercular knob)', 'ไข่สีน้ำตาลเหลือง มีตัวอ่อน miracidium'],
    clinicalNote: 'ไข่ของ OV คล้ายไข่พยาธิใบไม้ลำไส้ขนาดเล็กและ Clonorchis จึงไม่ควรยืนยันชนิดจากภาพไข่เพียงอย่างเดียว ต้องพิจารณาบริบทและวิธีตรวจยืนยันร่วมด้วย',
  },
  {
    id: 'taenia', name: 'Taenia spp.', thaiName: 'พยาธิตืด', group: 'cestode',
    size: '30–35 µm (เส้นผ่านศูนย์กลาง)', shape: 'ทรงกลม · ผนังเป็นลายรัศมี', color: '#ba8c58',
    description: 'ไข่กลม มีชั้น embryophore หนาและเป็นลายรัศมี ภายในมีตัวอ่อน oncosphere ที่มีตะขอ 3 คู่',
    features: ['ผนังหนาเป็นลายรัศมี', 'ตัวอ่อน oncosphere', 'ตะขอ 3 คู่ (6 hooks)'],
    clinicalNote: 'ไม่สามารถแยก T. solium ออกจาก T. saginata ด้วยลักษณะไข่เพียงอย่างเดียว จึงรายงานเป็น Taenia spp.',
  },
  {
    id: 'enterobius', name: 'Enterobius vermicularis', thaiName: 'พยาธิเข็มหมุด', group: 'nematode',
    size: '50–60 × 20–30 µm', shape: 'รูปตัว D · แบนด้านหนึ่ง', color: '#d4ccb0',
    description: 'ไข่ใส รูปรียาวและไม่สมมาตร ด้านหนึ่งแบน อีกด้านโค้ง ทำให้มีลักษณะคล้ายตัว D และมักพบตัวอ่อนภายใน',
    features: ['ด้านหนึ่งแบน (planoconvex)', 'เปลือกใส', 'อาจเห็นตัวอ่อนขดอยู่ภายใน'],
    clinicalNote: 'การเก็บตัวอย่างด้วยเทปใสบริเวณรอบทวารหนักเป็นวิธีที่ใช้ตรวจหาไข่ชนิดนี้',
  },
];

export const groupLabels: Record<SpeciesGroup, string> = {
  nematode: 'พยาธิตัวกลม', trematode: 'พยาธิใบไม้', cestode: 'พยาธิตืด',
};

export function getSpeciesById(id?: string): ParasiteSpecies {
  return species.find((item) => item.id === id) ?? species[0];
}

/** Unknown model labels must not silently open an unrelated Atlas specimen. */
export function matchSpeciesLabel(label?: string): ParasiteSpecies | undefined {
  if (!label) return undefined;
  const normalized = label.toLowerCase().replace(/[_-]+/g, ' ').trim();
  // OV is a species, not the whole Opisthorchis genus. Preserve the source label
  // elsewhere; recognize the historical Chula spelling only for Atlas lookup.
  const ovLabel = normalized.replace(/\./g, '').replace(/\s+/g, ' ');
  if (['ov', 'o viverrini', 'opisthorchis viverrini', 'opisthorchis viverrine'].includes(ovLabel)) {
    return species.find((item) => item.id === 'opisthorchis');
  }
  const direct = species.find((item) => item.id !== 'opisthorchis' && (item.id === label || normalized.includes(item.name.toLowerCase())));
  if (direct) return direct;
  const aliases: [string[], string][] = [
    [['ascaris', 'a. lumbricoides'], 'ascaris'],
    [['trichuris', 't. trichiura'], 'trichuris'],
    [['hookworm', 'ancylostoma', 'necator'], 'hookworm'],
    [['taenia'], 'taenia'],
    [['enterobius', 'e. vermicularis'], 'enterobius'],
  ];
  const found = aliases.find(([names]) => names.some((name) => normalized.includes(name)));
  return found ? species.find((item) => item.id === found[1]) : undefined;
}
