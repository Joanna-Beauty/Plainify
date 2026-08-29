import { BookOpen, PanelLeftClose, PanelLeftOpen, RefreshCw, Settings } from 'lucide-react'

const navItems = [
  { id: 'library', label: '术语库', icon: BookOpen },
  { id: 'review', label: '快速复习', icon: RefreshCw },
  { id: 'settings', label: '设置', icon: Settings },
]

export function Brand() {
  return (
    <div className="brand" aria-label="加简大白话 · Plainify">
      <img alt="" aria-hidden="true" className="brand-mark" src="/favicon.svg" />
      <span className="brand-copy">
        <span className="brand-title">加简大白话 <small>· Plainify</small></span>
      </span>
    </div>
  )
}

export default function Sidebar({ collapsed, extensionReady, onToggle, page, setPage }) {
  return (
    <aside className={collapsed ? 'sidebar is-collapsed' : 'sidebar'}>
      <div className="sidebar-header">
        <Brand />
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开左侧边栏' : '收起左侧边栏'}
          className="sidebar-toggle"
          onClick={onToggle}
          title={collapsed ? '展开左侧边栏' : '收起左侧边栏'}
          type="button"
        >
          {collapsed
            ? <PanelLeftOpen aria-hidden="true" size={19} strokeWidth={1.8} />
            : <PanelLeftClose aria-hidden="true" size={19} strokeWidth={1.8} />}
        </button>
      </div>
      <nav className="side-nav" aria-label="主导航">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            aria-label={collapsed ? label : undefined}
            className={page === id ? 'side-nav-item active' : 'side-nav-item'}
            key={id}
            onClick={() => setPage(id)}
            title={collapsed ? label : undefined}
            type="button"
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="extension-state" title={collapsed ? (extensionReady ? '插件已连接' : '插件未连接') : undefined}>
        <div className={extensionReady ? 'status-line connected' : 'status-line'}>
          <span className="status-dot" aria-hidden="true" />
          <span>{extensionReady ? '插件已连接' : '插件未连接'}</span>
        </div>
        <p>{extensionReady ? '网页上选中的陌生词会自动回到这里。' : '安装插件后，可在任意网页直接收词。'}</p>
      </div>
    </aside>
  )
}
