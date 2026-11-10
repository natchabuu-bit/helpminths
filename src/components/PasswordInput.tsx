import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useId, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import '../styles/account.css'

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** The field name appended to the Thai show/hide action. */
  toggleLabel?: string
}

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput({ id, disabled, toggleLabel = 'รหัสผ่าน', ...props }, ref) {
  const generatedId = useId()
  const inputId = id ?? `password-${generatedId}`
  const [visible, setVisible] = useState(false)
  return <span className="password-input">
    <input {...props} ref={ref} id={inputId} type={visible ? 'text' : 'password'} disabled={disabled}/>
    <button className="password-visibility-button" type="button" disabled={disabled} aria-label={`${visible ? 'ซ่อน' : 'แสดง'}${toggleLabel}`} aria-pressed={visible} aria-controls={inputId} onClick={() => setVisible(current => !current)}>
      {visible ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}<span aria-hidden="true">{visible ? 'ซ่อน' : 'แสดง'}</span>
    </button>
  </span>
})

export default PasswordInput
