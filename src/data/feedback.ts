export const susQuestions = [
  'ฉันคิดว่าฉันอยากใช้ระบบนี้บ่อย ๆ',
  'ฉันพบว่าระบบนี้ซับซ้อนโดยไม่จำเป็น',
  'ฉันคิดว่าระบบนี้ใช้งานง่าย',
  'ฉันคิดว่าฉันต้องได้รับความช่วยเหลือจากผู้มีความรู้ทางเทคนิคจึงจะใช้ระบบนี้ได้',
  'ฉันพบว่าฟังก์ชันต่าง ๆ ในระบบนี้ทำงานร่วมกันได้ดี',
  'ฉันคิดว่าระบบนี้มีความไม่สอดคล้องกันมากเกินไป',
  'ฉันคิดว่าคนส่วนใหญ่จะเรียนรู้การใช้ระบบนี้ได้อย่างรวดเร็ว',
  'ฉันพบว่าระบบนี้ใช้งานยุ่งยาก',
  'ฉันรู้สึกมั่นใจมากในการใช้ระบบนี้',
  'ฉันต้องเรียนรู้หลายสิ่งก่อนที่จะเริ่มใช้ระบบนี้ได้',
] as const

export const susOptions = [
  { value: 1, label: 'ไม่เห็นด้วยอย่างยิ่ง' },
  { value: 2, label: 'ไม่เห็นด้วย' },
  { value: 3, label: 'เป็นกลาง' },
  { value: 4, label: 'เห็นด้วย' },
  { value: 5, label: 'เห็นด้วยอย่างยิ่ง' },
] as const

/** SUS measures perceived usability. Its 0–100 score is not a percentage. */
export function calculateSUS(answers: readonly (number | null)[]): number | null {
  if (answers.length !== 10 || answers.some(value => value === null || !Number.isInteger(value) || value < 1 || value > 5)) return null
  return answers.reduce<number>((sum, value, index) => sum + (index % 2 === 0 ? value! - 1 : 5 - value!), 0) * 2.5
}
