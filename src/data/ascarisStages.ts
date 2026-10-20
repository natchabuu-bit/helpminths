import { getAtlasStructures, type AtlasStructure } from './atlasStructures';
import { getAtlasPhotos, type AtlasPhoto } from './atlasPhotos';

export type AscarisStageId = 'unfertilized' | 'fertilized' | 'cleavage' | 'embryonated';
export interface AscarisStage {
  id: AscarisStageId;
  title: string;
  englishTitle: string;
  status: string;
  description: string;
  features: string[];
  size: string;
  shape: string;
  photoId?: string;
  photoNote?: string;
  sourceIds: string[];
}

const mixedPhotoId = 'ascaris-fertilized-unfertilized-buckelew';
export const ascarisStages: AscarisStage[] = [
  {
    id: 'unfertilized', title: 'ไข่ไม่ปฏิสนธิ', englishTitle: 'Unfertilized egg',
    status: 'ไม่เป็นระยะติดต่อ',
    description: 'ไข่ไม่ได้รับการปฏิสนธิ มักรียาวและมีเม็ดเนื้อหาภายในไม่เป็นระเบียบ ไม่พัฒนาเป็นตัวอ่อนระยะติดต่อ จึงแยกเป็นอีกลักษณะหนึ่ง ไม่วางเป็นขั้นแรกของลำดับพัฒนาไข่ปฏิสนธิ',
    features: ['รูปรียาวและขนาดแปรผัน', 'เม็ดภายในไม่เป็นระเบียบ ไม่มีตัวอ่อนที่พัฒนาแล้ว', 'ไม่สามารถพัฒนาเป็นไข่ระยะติดต่อ'],
    size: 'แปรผัน มักยาวกว่าไข่ปฏิสนธิ', shape: 'รูปรียาว · เนื้อหาภายในเป็นเม็ด',
    photoId: mixedPhotoId,
    photoNote: 'ดูฟองซ้ายล่างสุดในภาพรวม ผู้ถ่ายระบุว่าเป็นไข่ไม่ปฏิสนธิ ฟองอื่นในภาพไม่ใช่ตัวอย่างของระยะที่เลือกทั้งหมด',
    sourceIds: ['cdc-ascariasis', 'buckelew-ascaris', 'openstax-ascariasis'],
  },
  {
    id: 'fertilized', title: 'ไข่ปฏิสนธิระยะต้น', englishTitle: 'Fertilized egg',
    status: 'ยังไม่เป็นระยะติดต่อ',
    description: 'ไข่ที่ปฏิสนธิแล้วระยะต้นยังไม่มีตัวอ่อนที่พัฒนาเต็มที่ จึงยังไม่เป็นระยะติดต่อ ไข่ที่มีชีวิตสามารถพัฒนาต่อในสิ่งแวดล้อมเมื่อมีสภาพเหมาะสม',
    features: ['รูปร่างกลมถึงรี เปลือกค่อนข้างหนา', 'มวลเซลล์ไข่อยู่ภายใน ยังไม่มีตัวอ่อนขด', 'ไข่ปฏิสนธิระยะต้นยังไม่พร้อมติดต่อ'],
    size: '45–75 × 35–50 µm (ไข่ปฏิสนธิโดยทั่วไป)', shape: 'กลมถึงรี · เปลือกค่อนข้างหนา',
    photoId: mixedPhotoId,
    photoNote: 'ผู้ถ่ายระบุว่าฟองส่วนใหญ่เป็นไข่ปฏิสนธิ ยกเว้นฟองซ้ายล่างสุด ไม่ได้ระบุระยะย่อยของไข่ปฏิสนธิทุกฟอง จึงไม่ยืนยันว่าทุกฟองเป็นระยะเซลล์เดียว',
    sourceIds: ['cdc-ascariasis', 'buckelew-ascaris', 'openstax-ascariasis'],
  },
  {
    id: 'cleavage', title: 'ไข่ระยะแบ่งเซลล์', englishTitle: 'Cleavage stage',
    status: 'กำลังพัฒนา · ยังไม่ใช่ตัวอ่อนระยะติดต่อ',
    description: 'ไข่ปฏิสนธิเริ่มแบ่งเซลล์และพัฒนาตัวอ่อน ภาพวาดและโมเดลเลือกแสดงกลุ่มเซลล์ระยะหนึ่งเพื่อให้เทียบกับเซลล์ไข่เดี่ยวและตัวอ่อนขดได้ จำนวนเซลล์และตำแหน่งเป็นภาพอธิบาย ไม่ใช่เกณฑ์ตัดสินระยะติดต่อจากภาพเดียว',
    features: ['มวลภายในแบ่งเป็นหลายเซลล์ (blastomeres)', 'ยังไม่เห็นตัวอ่อนขดที่พัฒนาเต็มที่', 'จำนวนเซลล์เปลี่ยนไปตามการพัฒนา'],
    size: '45–75 × 35–50 µm (ไข่ปฏิสนธิโดยทั่วไป)', shape: 'กลมถึงรี · ภายในเป็นกลุ่มเซลล์',
    sourceIds: ['cdc-ascariasis'],
  },
  {
    id: 'embryonated', title: 'ไข่มีตัวอ่อน', englishTitle: 'Embryonated / Infective egg',
    status: 'อาจเป็นระยะติดต่อเมื่อพัฒนาเต็มที่และยังมีชีวิต',
    description: 'ไข่ที่มีตัวอ่อนพัฒนาเต็มที่และยังมีชีวิตเป็นระยะติดต่อเมื่อถูกกินเข้าสู่ร่างกาย แบบจำลองแสดงตัวอ่อนขดภายใน แต่การเห็นตัวอ่อนในภาพนิ่งเพียงอย่างเดียวไม่ยืนยันความมีชีวิตหรือความสามารถก่อการติดเชื้อ',
    features: ['เห็นตัวอ่อนขดภายในไข่ (larvated egg)', 'ไข่ที่พัฒนาเต็มที่และมีชีวิตเป็นระยะติดต่อ', 'ภาพนิ่งไม่ยืนยันความมีชีวิตหรือการติดต่อ'],
    size: '45–75 × 35–50 µm (ไข่ปฏิสนธิโดยทั่วไป)', shape: 'กลมถึงรี · ภายในมีตัวอ่อนขด',
    photoId: 'ascaris-embryonated-buckelew',
    photoNote: 'ต้นฉบับบรรยายว่ามีตัวอ่อนที่พัฒนาแล้วและผิวขรุขระ ภาพนี้แสดงลักษณะ embryonated แต่ไม่ใช่หลักฐานทดสอบความมีชีวิตหรือความสามารถก่อการติดเชื้อ',
    sourceIds: ['cdc-ascariasis', 'buckelew-ascaris', 'openstax-ascariasis'],
  },
];

export const ascarisDecorticatedNote = 'Decorticated egg คือไข่ที่ชั้นผิวนอกขรุขระ (mammillated coat) หลุดออก จึงดูผิวเรียบ เปลือกไข่ส่วนที่เหลือยังอยู่ พบได้ทั้งไข่ปฏิสนธิและไม่ปฏิสนธิ เป็นลักษณะของเปลือกที่พบร่วมกับระยะพัฒนา ไม่ใช่ระยะถัดจากไข่มีตัวอ่อน และไม่ได้ยืนยันว่าเป็นระยะติดต่อ';
export const ascarisDevelopmentNote = 'ลำดับพัฒนาของไข่ปฏิสนธิ: ระยะต้น → แบ่งเซลล์ → มีตัวอ่อนพัฒนาเต็มที่ ส่วนไข่ไม่ปฏิสนธิไม่พัฒนาไปตามลำดับนี้';

export function getAscarisStage(id: AscarisStageId): AscarisStage {
  return ascarisStages.find((stage) => stage.id === id) ?? ascarisStages[1];
}

/** Only reuse photographs whose captions support the selected category. */
export function getAscarisStagePhotos(stageId: AscarisStageId, decorticated: boolean): AtlasPhoto[] {
  const stage = getAscarisStage(stageId);
  if (decorticated || !stage.photoId) return [];
  const photo = getAtlasPhotos('ascaris').find((entry) => entry.id === stage.photoId);
  if (!photo) return [];
  const observableStructureIds = photo.observableStructureIds.filter((id) => stageId !== 'unfertilized' || id !== 'ovum');
  if (stageId === 'embryonated') observableStructureIds.push('larval-body');
  return [{ ...photo, observableStructureIds, stageNote: `${stage.photoNote} ภาพไม่มีแถบมาตราส่วน จึงวัดขนาดจริงจากภาพบนจอไม่ได้` }];
}

/** Anatomy changes with development; an absent outer coat is never left selectable. */
export function getAscarisStructures(stageId: AscarisStageId, decorticated = false): AtlasStructure[] {
  const base = getAtlasStructures('ascaris');
  const coat = base.find((part) => part.id === 'mammillated-coat')!;
  const shell = base.find((part) => part.id === 'shell')!;
  const space = base.find((part) => part.id === 'perivitelline-space')!;
  const outer: AtlasStructure[] = decorticated ? [] : [{ ...coat,
    position: stageId === 'unfertilized' ? [.4, .65, .17] : coat.position,
  }];
  outer.push({ ...shell, label: decorticated ? 'เปลือกที่ยังอยู่หลังชั้นผิวนอกหลุด' : stageId === 'unfertilized' ? 'เปลือกไข่ไม่ปฏิสนธิ' : shell.label,
    shortLabel: decorticated ? 'เปลือกผิวเรียบ' : 'เปลือกไข่',
    description: decorticated ? 'ชั้นผิวนอกขรุขระหลุดออก แต่เปลือกไข่ส่วนที่เหลือยังอยู่ การไม่มีชั้นผิวนอกไม่บอกว่าไข่ปฏิสนธิหรือมีตัวอ่อนแล้ว ต้องประเมินภายในร่วมด้วย' : stageId === 'unfertilized' ? 'ไข่ไม่ปฏิสนธิมักรียาวและมีเปลือกบางกว่าไข่ปฏิสนธิ รูปร่างและความหนาในแบบจำลองเป็นภาพอธิบาย ไม่ใช้แทนการวัดจริง' : shell.description,
    position: stageId === 'unfertilized' ? [0, .58, .12] : shell.position,
  });
  if (stageId === 'unfertilized') return [...outer, {
    id: 'granular-contents', label: 'เม็ดเนื้อหาภายในไข่ไม่ปฏิสนธิ', shortLabel: 'เม็ดเนื้อหาภายใน', internal: true,
    description: 'ภายในเป็นเม็ดเนื้อหาไม่เป็นระเบียบ ไม่ใช่กลุ่ม blastomeres ของไข่ปฏิสนธิ และไม่พัฒนาเป็นตัวอ่อนระยะติดต่อ ไม่ระบุเม็ดเหล่านี้เป็นออร์แกเนลล์จำเพาะ',
    position: [0, .03, .25], sourceIds: ['cdc-ascariasis'],
  }];
  const internal: AtlasStructure = stageId === 'fertilized' ? base.find((part) => part.id === 'ovum')! : stageId === 'cleavage' ? {
    id: 'blastomeres', label: 'เซลล์ระยะแบ่งตัว (blastomeres)', shortLabel: 'เซลล์แบ่งตัว', internal: true,
    description: 'มวลเซลล์ของไข่ปฏิสนธิแบ่งตัวระหว่างการพัฒนา ตัวอย่างในแบบจำลองแสดงหลายเซลล์เพื่อสื่อระยะหนึ่ง จำนวน รูปร่าง และการจัดวางไม่ใช่ค่าคงที่สำหรับวินิจฉัยระยะ',
    position: [0, .1, .24], sourceIds: ['cdc-ascariasis'],
  } : {
    id: 'larval-body', label: 'ตัวอ่อนขดภายในไข่ (larva)', shortLabel: 'ตัวอ่อนขด', internal: true,
    description: 'ตัวอ่อนพัฒนาอยู่ภายในเปลือกไข่ แบบจำลองแสดงรูปร่างขดโดยรวม ไม่ระบุระยะลอกคราบหรืออวัยวะย่อยจากภาพไข่ ความสามารถติดต่อยังขึ้นกับการพัฒนาเต็มที่และความมีชีวิต',
    position: [.1, .05, .15], sourceIds: ['cdc-ascariasis', 'buckelew-ascaris'],
  };
  return [...outer, internal, { ...space, label: 'ช่องว่างระหว่างเปลือกกับมวลภายใน',
    description: 'ช่องว่างรอบมวลเซลล์หรือตัวอ่อนช่วยแยกขอบภายในจากเปลือกได้ ความกว้างที่วาดเป็นภาพอธิบายและเปลี่ยนไปตามระยะและโฟกัส',
  }];
}
