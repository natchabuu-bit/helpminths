import { useState } from 'react'
import { Play } from 'lucide-react'

const videoSource = '/media/helpminths-introduction-30s.mp4'

export default function IntroVideo() {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  return <details className="intro-video" onToggle={event => {
    setOpen(event.currentTarget.open)
    if (!event.currentTarget.open) setFailed(false)
  }}>
    <summary><Play size={18} aria-hidden="true"/><span>ดูวิดีโอแนะนำ <span className="intro-video-duration">(30 วินาที)</span></span></summary>
    {open && <div className="intro-video-content">
      <video className="intro-video-player" controls playsInline preload="none"
        poster="/media/helpminths-introduction-poster.jpg"
        aria-label="วิดีโอแนะนำการใช้งาน HelpMinths" onError={() => setFailed(true)}>
        <source src={videoSource} type="video/mp4"/>
        <track kind="captions" src="/media/helpminths-introduction-th.vtt" srcLang="th" label="ภาษาไทย"/>
        เบราว์เซอร์นี้ไม่รองรับการเล่นวิดีโอ กรุณาเปิดไฟล์ MP4 จากลิงก์ด้านล่าง
      </video>
      {failed && <p className="intro-video-error" role="status">ยังเล่นวิดีโอไม่ได้ โปรดตรวจการเชื่อมต่อ หรือลองเปิดวิดีโอจากลิงก์ด้านล่าง</p>}
      <div className="intro-video-links">
        <a href={videoSource} target="_blank" rel="noopener noreferrer">เปิดวิดีโอในหน้าใหม่</a>
        <a href="/media/helpminths-introduction-credits.txt" target="_blank" rel="noopener noreferrer">เครดิตภาพและดนตรี</a>
      </div>
      <details className="intro-video-transcript">
        <summary>อ่านเนื้อหาวิดีโอ</summary>
        <ol>
          <li>HelpMinths รวมการตรวจภาพ การเรียนรู้ และการติดตามผลไว้ในเว็บเดียว</li>
          <li>อัปโหลดหรือถ่ายภาพ ตรวจคุณภาพ แล้วดูกรอบ ชนิด และค่าความมั่นใจของ AI พร้อมโหมดสาธิต</li>
          <li>Atlas 3D เทียบภาพจริง หมุน ซูม เลือกโครงสร้าง และสำรวจระยะไข่กับตัวอ่อน</li>
          <li>ส่งต่อผู้เชี่ยวชาญ ตอบกลับ ขอภาพเพิ่ม และยืนยันผล โดยแยกจากผล AI</li>
          <li>ดูประวัติรายวัน สถานะรอตรวจหรือเสร็จสิ้น และการแจ้งเตือนคำตอบในงานของฉัน</li>
          <li>สถิติโรค กรองพื้นที่ เปรียบเทียบปี ดูแนวโน้ม โรงเรียนควรติดตาม และตารางรายชื่อ</li>
          <li>ออกรายงาน PDF/CSV ประเมินโมเดล และส่งแบบประเมิน SUS กับข้อเสนอแนะ</li>
          <li>สมัครและตั้งค่าบัญชีตามบทบาท พร้อมอนุมัติสิทธิ์และคลังภาพหลังบ้านของ Super Admin</li>
        </ol>
        <p>ภาพในวิดีโอเป็นข้อมูลสาธิต ผล AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ</p>
      </details>
    </div>}
  </details>
}
