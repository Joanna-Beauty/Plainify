import { ArrowRight, CheckCircle2, Info, X } from 'lucide-react'

export default function Toast({ toast, onClose }) {
  if (!toast) return null
  const Icon = toast.type === 'success' ? CheckCircle2 : Info

  function runAction() {
    toast.action?.onClick?.()
    onClose()
  }

  return (
    <div className={`toast ${toast.type || 'info'}`} role="status">
      <Icon aria-hidden="true" size={18} />
      <span>{toast.message}</span>
      {toast.action ? (
        <button className="toast-action" onClick={runAction} type="button">
          {toast.action.label}
          <ArrowRight aria-hidden="true" size={14} />
        </button>
      ) : null}
      <button aria-label="关闭提示" className="toast-close" onClick={onClose} type="button">
        <X aria-hidden="true" size={15} />
      </button>
    </div>
  )
}
