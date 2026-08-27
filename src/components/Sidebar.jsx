import { BookOpen, RefreshCw, Settings } from 'lucide-react'

const navItems = [
  { id: 'library', label: '术语库', icon: BookOpen },
  { id: 'review', label: '快速复习', icon: RefreshCw },
  { id: 'settings', label: '设置', icon: Settings },
]

export function Brand() {
  return (
    <div className="brand" aria-label="加简大白话 · Plainify｜你的个人术语库">
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-copy">
        <span className="brand-title">加简大白话 <small>· Plainify</small></span>
        <span className="brand-tagline">你的个人术语库</span>
      </span>
    </div>
  )
}

export default function Sidebar({ page, setPage, extensionReady }) {
  return (
    <aside className="sidebar">
      <Brand />
      <nav className="side-nav" aria-label="主导航">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            className={page === id ? 'side-nav-item active' : 'side-nav-item'}
            key={id}
            onClick={() => setPage(id)}
            type="button"
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="extension-state">
        <div className={extensionReady ? 'status-line connected' : 'status-line'}>
          <span className="status-dot" aria-hidden="true" />
          {extensionReady ? '插件已连接' : '插件未连接'}
        </div>
        <p>{extensionReady ? '网页上选中的陌生词会自动回到这里。' : '安装插件后，可在任意网页直接收词。'}</p>
      </div>
    </aside>
  )
}
