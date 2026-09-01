import { ExternalLink } from 'lucide-react'

const SOCIAL_PROFILE_URL = 'https://space.bilibili.com/1469658337?spm_id_from=333.1007.0.0'

export function SocialProfile({ compact = false }) {
  return (
    <a
      aria-label="打开加简Joanna的 B 站主页"
      className={compact ? 'social-profile compact mobile-social-profile' : 'social-profile'}
      href={SOCIAL_PROFILE_URL}
      rel="noreferrer"
      target="_blank"
      title="在 B 站关注加简Joanna"
    >
      <span className="social-avatar">
        <img alt="" src="/plainify-avatar.png" />
      </span>
      {compact ? (
        <span className="social-compact-label">B站</span>
      ) : (
        <span className="social-copy">
          <strong>在 B 站关注我</strong>
          <span>加简Joanna</span>
        </span>
      )}
      {compact ? null : <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />}
    </a>
  )
}

export default function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-identity" aria-label="加简大白话 · Plainify｜用大白话，读懂复杂术语">
        <img alt="" aria-hidden="true" className="brand-mark" src="/favicon.svg" />
        <span className="app-identity-copy">
          <span className="brand-title">加简大白话 · Plainify</span>
          <span aria-hidden="true" className="identity-divider" />
          <span className="brand-tagline">用大白话，读懂复杂术语</span>
        </span>
      </div>
      <SocialProfile compact />
    </header>
  )
}
