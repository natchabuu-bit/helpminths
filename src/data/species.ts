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
  {
    id: 'mif', name: 'Minute intestinal flukes (MIF)', thaiName: 'พยาธิใบไม้ลำไส้ขนาดเล็ก (MIF)', group: 'trematode',
    size: 'ประมาณ 20–35 × 10–20 µm (ขึ้นกับชนิด)', shape: 'รูปรีขนาดเล็ก · มีฝาปิด', color: '#c5a159',
    description: 'กลุ่มพยาธิใบไม้ลำไส้ขนาดเล็ก เช่น Haplorchis, Heterophyes และ Metagonimus มีไข่รูปรีสีน้ำตาลเหลืองและฝาปิด โดยมากมีตัวอ่อน miracidium เมื่อขับออกมากับอุจจาระ ขนาด บ่า และผิวเปลือกแตกต่างกันตามชนิด',
    features: ['ไข่ขนาดเล็ก มีฝาปิด (operculum)', 'โดยมากมีตัวอ่อน miracidium ภายใน', 'รูปร่างและรายละเอียดเปลือกแตกต่างกันในแต่ละชนิด'],
    clinicalNote: 'MIF เป็นกลุ่มอ้างอิง ไม่ใช่ชื่อพยาธิชนิดเดียว ไข่อาจคล้าย OV และ Clonorchis มาก จึงไม่ควรยืนยันชนิดจากภาพไข่เพียงอย่างเดียว ต้องใช้บริบทและวิธีตรวจยืนยันร่วมด้วย',
  },
  {
    id: 'hymenolepis-nana', name: 'Hymenolepis nana', thaiName: 'พยาธิตืดแคระ', group: 'cestode',
    size: '30–50 µm (เส้นผ่านศูนย์กลางโดยประมาณ)', shape: 'กลมถึงรี · มีเส้นใยที่ขั้ว', color: '#d8c78f',
    description: 'ไข่กลมถึงรี มีเยื่อหุ้มสองชั้นและช่องว่างระหว่างเยื่อ ภายในมีตัวอ่อน oncosphere ที่มีตะขอ 3 คู่ เยื่อชั้นในหนาตัวบริเวณขั้วทั้งสองและมีเส้นใยขั้วยื่นเข้าไปในช่องว่างระหว่างเยื่อ',
    features: ['เยื่อหุ้มสองชั้นและขั้วหนาสองด้าน', 'เส้นใยขั้ว 4–8 เส้น (polar filaments)', 'ตัวอ่อน oncosphere มีตะขอ 3 คู่ (6 hooks)'],
    clinicalNote: 'ควรเห็น polar filaments และโครงสร้างภายในประกอบการแยกจาก H. diminuta เส้นใยอาจไม่ชัดเมื่อภาพไม่อยู่ในระยะโฟกัส จึงไม่ควรตัดสินจากการไม่เห็นเส้นใยในภาพเดียว',
  },
  {
    id: 'hymenolepis-diminuta', name: 'Hymenolepis diminuta', thaiName: 'พยาธิตืดหนู', group: 'cestode',
    size: '70–85 × 60–80 µm', shape: 'กลมถึงรี · ไม่มีเส้นใยที่ขั้ว', color: '#bcab6f',
    description: 'ไข่กลมถึงรี ขนาดใหญ่กว่าไข่ H. nana โดยทั่วไป มีเยื่อชั้นนอกค่อนข้างหนาและเยื่อชั้นในบาง ล้อมตัวอ่อน oncosphere ที่มีตะขอ 3 คู่ และไม่มี polar filaments',
    features: ['เยื่อชั้นนอกค่อนข้างหนา', 'ไม่มีเส้นใยขั้ว (no polar filaments)', 'ตัวอ่อน oncosphere มีตะขอ 3 คู่ (6 hooks)'],
    clinicalNote: 'ใช้ขนาดที่สอบเทียบด้วยสเกลและรายละเอียดเยื่อหุ้มร่วมกับการประเมิน polar filaments เพื่อแยกจาก H. nana ขนาดในภาพที่ไม่มีสเกลไม่เพียงพอต่อการยืนยันชนิด',
  },
  {
    id: 'echinostoma', name: 'Echinostoma spp.', thaiName: 'พยาธิใบไม้ลำไส้ขนาดกลาง', group: 'trematode',
    size: 'ประมาณ 80–135 × 55–80 µm (ขึ้นกับชนิด)', shape: 'รูปรี · มีฝาปิด', color: '#b48e4b',
    description: 'ใช้ Echinostoma spp. เป็นตัวแทนการเรียนรู้ในกลุ่มพยาธิใบไม้ลำไส้ขนาดกลาง ไข่รูปรีสีน้ำตาลเหลือง มีฝาปิดและมักยังไม่มีตัวอ่อนเมื่อออกมากับอุจจาระสด รายละเอียดและขนาดแตกต่างกันตามชนิด',
    features: ['ฝาปิดที่ขั้วหนึ่ง (operculum)', 'ภายในมักยังไม่เป็นตัวอ่อนในอุจจาระสด', 'ภายในมีเซลล์ไข่และเซลล์ไข่แดง'],
    clinicalNote: 'คำว่าขนาดกลางหมายถึงการจัดกลุ่มอ้างอิงของพยาธิตัวเต็มวัย ไม่ใช่เกณฑ์ขนาดไข่ตายตัว ไข่อาจทับซ้อนกับ Fasciolopsis และ Fasciola จึงไม่ควรยืนยันชนิด Echinostoma จากภาพไข่เพียงอย่างเดียว หนามรอบหัวเป็นลักษณะของตัวเต็มวัย ไม่ใช่ไข่',
  },
  {
    id: 'fasciolopsis', name: 'Fasciolopsis buski', thaiName: 'พยาธิใบไม้ลำไส้ขนาดใหญ่', group: 'trematode',
    size: '130–150 × 60–90 µm', shape: 'รูปรีขนาดใหญ่ · มีฝาปิด', color: '#a98443',
    description: 'ใช้ Fasciolopsis buski เป็นตัวแทนการเรียนรู้ในกลุ่มพยาธิใบไม้ลำไส้ขนาดใหญ่ ไข่รูปรีขนาดใหญ่ เปลือกค่อนข้างบาง สีน้ำตาลเหลือง มีฝาปิดที่อาจเห็นไม่ชัด และมักยังไม่มีตัวอ่อนเมื่อออกมากับอุจจาระสด',
    features: ['ไข่รูปรีขนาดใหญ่ มีฝาปิด', 'เปลือกค่อนข้างบาง', 'ภายในมักยังไม่เป็นตัวอ่อนในอุจจาระสด'],
    clinicalNote: 'คำว่าขนาดใหญ่เป็นการจัดกลุ่มอ้างอิงของตัวเต็มวัย ไม่ใช่เกณฑ์ขนาดไข่ตายตัว ไข่คล้าย Fasciola hepatica/F. gigantica มากและทับซ้อนกับ Echinostoma บางชนิด จึงไม่สามารถยืนยัน F. buski จากภาพไข่เพียงอย่างเดียว',
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
  // Match these reference groups and species explicitly. A generic Hymenolepis
  // label, Fasciola or Clonorchis must not silently resolve to a different taxon.
  const referenceAliases: [string[], string][] = [
    [[
      'mif', 'ไข่พยาธิใบไม้ลำไส้ขนาดเล็ก (mif)', 'พยาธิใบไม้ลำไส้ขนาดเล็ก (mif)', 'พยาธิใบไม้ลำไส้ขนาดเล็ก', 'minute intestinal fluke', 'minute intestinal flukes', 'minute intestinal flukes (mif)',
      'small intestinal fluke', 'small intestinal flukes',
      'haplorchis taichui', 'h taichui', 'haplorchis yokogawai', 'h yokogawai',
      'haplorchis pumilio', 'h pumilio', 'heterophyes heterophyes', 'h heterophyes',
      'metagonimus yokogawai', 'm yokogawai', 'stellantchasmus falcatus', 's falcatus',
    ], 'mif'],
    [['hymenolepis nana', 'h nana', 'dwarf tapeworm', 'พยาธิตืดแคระ'], 'hymenolepis-nana'],
    [['hymenolepis diminuta', 'h diminuta', 'rat tapeworm', 'พยาธิตืดหนู'], 'hymenolepis-diminuta'],
    [[
      'echinostoma', 'echinostoma spp', 'echinostoma sp', 'echinostoma revolutum',
      'e revolutum', 'echinostoma ilocanum', 'e ilocanum', 'medium intestinal fluke',
      'medium intestinal flukes', 'พยาธิใบไม้ลำไส้ขนาดกลาง',
    ], 'echinostoma'],
    [['fasciolopsis', 'fasciolopsis buski', 'f buski', 'giant intestinal fluke', 'large intestinal fluke', 'large intestinal flukes', 'พยาธิใบไม้ลำไส้ขนาดใหญ่'], 'fasciolopsis'],
  ];
  const referenceMatch = referenceAliases.find(([names]) => names.includes(ovLabel));
  if (referenceMatch) return species.find((item) => item.id === referenceMatch[1]);
  const legacyIds = ['ascaris', 'trichuris', 'hookworm', 'taenia', 'enterobius'];
  const direct = species.find((item) =>
    item.id !== 'opisthorchis' && (item.id === label || (legacyIds.includes(item.id) && normalized.includes(item.name.toLowerCase()))),
  );
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
