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
    id: 'schistosoma-mansoni', name: 'Schistosoma mansoni', thaiName: 'พยาธิใบไม้เลือดแมนโซไน', group: 'trematode',
    size: '114–180 × 45–70 µm', shape: 'รูปรียาว · หนามด้านข้าง', color: '#d8b57c',
    description: 'ไข่รูปรียาว ไม่มีฝาปิด มีหนามด้านข้างที่เด่นชัด ภายในไข่ที่เจริญเต็มที่จะมีตัวอ่อน miracidium',
    features: ['หนามใหญ่ด้านข้าง (lateral spine)', 'ไม่มีฝาปิด (non-operculate)', 'มีตัวอ่อน miracidium'],
    clinicalNote: 'ตำแหน่งของหนามช่วยแยกจาก S. haematobium แต่ต้องพิจารณาภาพและบริบททางคลินิกร่วมด้วย',
  },
  {
    id: 'schistosoma-haematobium', name: 'Schistosoma haematobium', thaiName: 'พยาธิใบไม้เลือดฮีมาโทเบียม', group: 'trematode',
    size: '110–170 × 40–70 µm', shape: 'รูปรียาว · หนามปลายขั้ว', color: '#d4b985',
    description: 'ไข่รูปรียาว มีหนามแหลมที่ปลายขั้ว ไม่มีฝาปิด และอาจเห็นตัวอ่อน miracidium อยู่ภายใน',
    features: ['หนามที่ปลายขั้ว (terminal spine)', 'ไม่มีฝาปิด', 'ตัวอ่อนอยู่ในเปลือกใส'],
    clinicalNote: 'มักตรวจหาไข่ในปัสสาวะ ควรอ้างอิงชนิดสิ่งส่งตรวจและประวัติการสัมผัสโรคร่วมด้วย',
  },
  {
    id: 'schistosoma-japonicum', name: 'Schistosoma japonicum', thaiName: 'พยาธิใบไม้เลือดจาโปนิคุม', group: 'trematode',
    size: '70–100 × 55–64 µm', shape: 'กลมรี · ปุ่มเล็กด้านข้าง', color: '#d1bf91',
    description: 'ไข่ค่อนข้างกลมถึงรี มีปุ่มหรือหนามเล็กด้านข้างซึ่งอาจเห็นได้ยาก ต่างจากหนามขนาดใหญ่ของ S. mansoni',
    features: ['ปุ่มด้านข้างขนาดเล็ก', 'รูปร่างค่อนข้างกลม', 'ไม่มีฝาปิด'],
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
  const normalized = label.toLowerCase().replace(/[_-]+/g, ' ');
  const direct = species.find((item) => item.id === label || normalized.includes(item.name.toLowerCase()));
  if (direct) return direct;
  const aliases: [string[], string][] = [
    [['ascaris', 'a. lumbricoides'], 'ascaris'],
    [['trichuris', 't. trichiura'], 'trichuris'],
    [['hookworm', 'ancylostoma', 'necator'], 'hookworm'],
    [['mansoni'], 'schistosoma-mansoni'],
    [['haematobium'], 'schistosoma-haematobium'],
    [['japonicum'], 'schistosoma-japonicum'],
    [['taenia'], 'taenia'],
    [['enterobius', 'e. vermicularis'], 'enterobius'],
  ];
  const found = aliases.find(([names]) => names.some((name) => normalized.includes(name)));
  return found ? species.find((item) => item.id === found[1]) : undefined;
}
