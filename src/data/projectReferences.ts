export type ProjectReferenceKind = 'method' | 'clinical' | 'technology' | 'hosting' | 'governance'

export interface ProjectReference {
  id: string
  citation: string
  url: string
  accessNote?: string
  kind: ProjectReferenceKind
}

// Canonical citations and readable source code are distinguished explicitly.
// A bibliography entry is not evidence that HelpMinths has passed an evaluation.
export const projectReferences: ProjectReference[] = [
  {
    id: 'sus',
    citation: 'Brooke, J. (1996). SUS: A “quick and dirty” usability scale. In P. W. Jordan et al. (Eds.), Usability Evaluation in Industry (pp. 189–194). Taylor & Francis.',
    url: 'https://www.usability.gov/how-to-and-tools/methods/system-usability-scale.html',
    accessNote: 'อ้างวิธี SUS มาตรฐาน 10 ข้อ: ข้อคี่ลบ 1 ข้อคู่ใช้ 5 ลบคำตอบ แล้วรวม × 2.5 ได้ 0–100 ไม่ใช่ร้อยละ ฉบับภาษาไทยในโครงการยังไม่ได้อ้างว่าเป็นคำแปลที่ผ่านการตรวจสอบ หน้าเว็บต้นทางเปิดไม่ได้จากคลาวด์เมื่อ 25 ต.ค. 2569',
    kind: 'method',
  },
  {
    id: 'sus-interpretation',
    citation: 'Bangor, A., Kortum, P. T., & Miller, J. T. (2008). An empirical evaluation of the System Usability Scale. International Journal of Human–Computer Interaction, 24(6), 574–594. https://doi.org/10.1080/10447310802205776',
    url: 'https://doi.org/10.1080/10447310802205776',
    accessNote: 'ใช้ประกอบการตีความ usability; ไม่แปลง SUS เป็นความแม่นยำของ AI และไม่ใช้ผลจากผู้เข้าร่วม 3–5 คนแทนประชากรทั้งหมด ฉบับเต็ม/DOI เปิดไม่ได้จากคลาวด์ในรอบนี้',
    kind: 'method',
  },
  {
    id: 'design-thinking',
    citation: 'Hasso Plattner Institute of Design at Stanford University. Design Thinking Bootleg.',
    url: 'https://dschool.stanford.edu/resources/design-thinking-bootleg',
    accessNote: 'กรอบ Empathize–Define–Ideate–Prototype–Test; persona และ journey ที่ยังไม่มีข้อมูลสัมภาษณ์รองรับต้องระบุเป็นสมมติฐาน หน้าเว็บต้นทางเปิดไม่ได้จากคลาวด์ในรอบนี้',
    kind: 'method',
  },
  {
    id: 'yolo',
    citation: 'Ultralytics. (2026). Object Detection documentation, source tag v8.3.253.',
    url: 'https://github.com/ultralytics/ultralytics/blob/v8.3.253/docs/en/tasks/detect.md',
    accessNote: 'ตรวจอ่าน source tag นี้เมื่อ 25 ต.ค. 2569 ยืนยันรูปแบบงาน detection และ API ฝึก/ประเมิน ไม่ใช่ผลวัดประสิทธิภาพไข่พยาธิของ HelpMinths และไม่ได้ระบุว่าเป็นรุ่นล่าสุด',
    kind: 'technology',
  },
  {
    id: 'render-free',
    citation: 'Render. Deploy for Free — limitations and operating behavior of free services.',
    url: 'https://render.com/docs/free',
    accessNote: 'ให้ตรวจ cold start การพักบริการ โควตา compute และข้อจำกัดพื้นที่ข้อมูลกับผู้ให้บริการก่อนใช้งานจริง หน้าเว็บถูก proxy ปฏิเสธเมื่อ 25 ต.ค. 2569 จึงไม่ยืนยันตัวเลขโควตาปัจจุบันในรายงานนี้',
    kind: 'hosting',
  },
  {
    id: 'render-pricing',
    citation: 'Render. Pricing.',
    url: 'https://render.com/pricing',
    accessNote: 'ตรวจราคาตามแผนและวันจัดซื้อจริง ค่าในเครื่องคำนวณของโครงการเป็นสมมติฐานที่ผู้ใช้กรอก ไม่ใช่ใบเสนอราคาจาก Render หน้าเว็บเปิดไม่ได้จากคลาวด์ในรอบนี้',
    kind: 'hosting',
  },
  {
    id: 'ai-evaluation',
    citation: 'Liu, X., Rivera, S. C., Moher, D., Calvert, M. J., & Denniston, A. K. (2020). Reporting guidelines for clinical trial reports for interventions involving artificial intelligence: the CONSORT-AI extension. Nature Medicine, 26, 1364–1374. https://doi.org/10.1038/s41591-020-1034-x',
    url: 'https://doi.org/10.1038/s41591-020-1034-x',
    accessNote: 'แนวทางรายงานการศึกษาทางคลินิกเมื่อขยายสู่งานที่เหมาะสม ไม่ใช่การรับรองต้นแบบนี้ งานทดสอบ usability ไม่แทนการประเมินโมเดลบนข้อมูลอิสระ ฉบับเต็มเปิดไม่ได้จากคลาวด์ในรอบนี้',
    kind: 'clinical',
  },
  {
    id: 'who-ai',
    citation: 'World Health Organization. (2021). Ethics and governance of artificial intelligence for health. ISBN 978-92-4-002920-0.',
    url: 'https://www.who.int/publications/i/item/9789240029200',
    accessNote: 'ใช้ประกอบการกำหนดผู้รับผิดชอบ สิทธิผู้ใช้ และการทบทวนโดยมนุษย์ ต้องประเมินข้อกำหนดของหน่วยงานและกฎหมายที่ใช้จริงก่อนนำไปใช้ทางคลินิก หน้าเว็บเปิดไม่ได้จากคลาวด์ในรอบนี้',
    kind: 'governance',
  },
  {
    id: 'cdc',
    citation: 'Centers for Disease Control and Prevention. DPDx — Laboratory Identification of Parasites of Public Health Concern.',
    url: 'https://www.cdc.gov/dpdx/az.html',
    accessNote: 'แหล่งให้ผู้เชี่ยวชาญตรวจ morphology ประกอบ ไม่ใช่ชุดข้อมูลฝึกที่ได้รับสิทธิ์โดยอัตโนมัติ รายละเอียดหลักฐานรายโครงสร้างอยู่ในเอกสาร Atlas ของโครงการ หน้าเว็บสดเปิดไม่ได้จากคลาวด์ในรอบนี้',
    kind: 'clinical',
  },
]

export const getProjectReference = (id: string) => projectReferences.find(reference => reference.id === id)
