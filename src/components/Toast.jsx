import { CheckCircle2, Info, X } from 'lucide-react'

export default function Toast({ toast, onClose }) {
  if (!toast) return null
  const Icon = toast.type === 'success' ? CheckCircle2 : Info

  return (
    <div className={`toast ${toast.type || 'info'}`} role="status">
      <Icon aria-hidden="true" size={18} />
      <span>{toast.message}</span>
      <button aria-label="关闭提示" onClick={onClose} type="button"><X aria-hidden="true" size={15} /></button>
    </div>
  )
}
