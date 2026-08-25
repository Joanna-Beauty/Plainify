import { useEffect, useMemo, useState } from 'react'
import Sidebar, { Brand } from './components/Sidebar'
import TermDrawer from './components/TermDrawer'
import Toast from './components/Toast'
import LibraryPage from './pages/LibraryPage'
import ReviewPage from './pages/ReviewPage'
import ModelSettingsPage from './pages/ModelSettingsPage'
import { normalizeProviderSettings } from './data/modelProviders'
import { defaultSettings, seedTerms } from './data/seedTerms'
import { useLocalStorage } from './hooks/useLocalStorage'
import { explainTerm, getLocalExplanation, organizeLocally, organizeWithAi } from './services/ai'

function normalizeIncomingTerm(term) {
  return {
    id: term.id || crypto.randomUUID(),
    term: String(term.term || '').trim(),
    explanation: String(term.explanation || ''),
    analogy: String(term.analogy || ''),
    category: String(term.category || '未分组'),
    source: String(term.source || '来自网页插件'),
    sourceUrl: String(term.sourceUrl || ''),
    createdAt: term.createdAt || new Date().toISOString(),
    reviewCount: Number(term.reviewCount || 0),
    mastered: Boolean(term.mastered),
    status: term.status === 'ready' && term.explanation ? 'ready' : 'pending',
  }
}

export default function App() {
  const [page, setPage] = useState('library')
  const [terms, setTerms] = useLocalStorage('baihuaben:terms:v1', seedTerms)
  const [storedSettings, setSettings] = useLocalStorage('baihuaben:settings:v1', defaultSettings)
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState(null)
  const [extensionReady, setExtensionReady] = useState(false)
  const settings = useMemo(() => normalizeProviderSettings(storedSettings), [storedSettings])
  const selectedTerm = useMemo(() => terms.find((term) => term.id === selectedId), [selectedId, terms])

  function showToast(message, type = 'info') {
    setToast({ id: Date.now(), message, type })
  }

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const hasLegacySecret = ['apiKey', 'baseUrl', 'provider'].some((key) => Object.hasOwn(storedSettings, key))
    if (hasLegacySecret) setSettings(settings)
  }, [setSettings, settings, storedSettings])

  useEffect(() => {
    function handleExtensionMessage(event) {
      if (event.source !== window || event.data?.source !== 'baihuaben-extension') return
      if (!['READY', 'TERMS_CHANGED'].includes(event.data.type)) return
      setExtensionReady(true)
      const incoming = Array.isArray(event.data.terms) ? event.data.terms.map(normalizeIncomingTerm).filter((term) => term.term) : []
      if (!incoming.length) return
      setTerms((current) => {
        const incomingByName = new Map(incoming.map((term) => [term.term.toLowerCase(), term]))
        const existing = new Set(current.map((term) => term.term.toLowerCase()))
        let changed = false
        const updated = current.map((term) => {
          const received = incomingByName.get(term.term.toLowerCase())
          if (!received) return term
          const sourceWasAdded = !term.sourceUrl && received.sourceUrl
          const explanationWasAdded = term.status !== 'ready' && received.status === 'ready'
          if (!sourceWasAdded && !explanationWasAdded) return term
          changed = true
          return {
            ...term,
            ...(sourceWasAdded ? { source: received.source, sourceUrl: received.sourceUrl } : {}),
            ...(explanationWasAdded ? {
              explanation: received.explanation,
              analogy: received.analogy,
              category: received.category,
              status: 'ready',
            } : {}),
          }
        })
        const additions = incoming.filter((term) => !existing.has(term.term.toLowerCase()))
        return additions.length || changed ? [...additions, ...updated] : current
      })
    }
    window.addEventListener('message', handleExtensionMessage)
    window.postMessage({ source: 'baihuaben-web', type: 'PING' }, '*')
    return () => window.removeEventListener('message', handleExtensionMessage)
  }, [setTerms])

  useEffect(() => {
    if (!extensionReady) return
    window.postMessage({ source: 'baihuaben-web', type: 'SYNC_TERMS', terms }, '*')
  }, [extensionReady, terms])

  async function addTerm(rawTerm, source = '手动输入', sourceUrl = '') {
    const term = rawTerm.trim().replace(/\s+/g, ' ')
    if (!term) return false
    const duplicate = terms.find((item) => item.term.toLowerCase() === term.toLowerCase())
    if (duplicate) {
      setSelectedId(duplicate.id)
      showToast('这个术语已经在你的术语库里了。')
      return false
    }

    setBusy('adding')
    const local = getLocalExplanation(term)
    const item = normalizeIncomingTerm({
      id: crypto.randomUUID(),
      term,
      ...local,
      category: local?.category || '未分组',
      source,
      sourceUrl,
      status: local ? 'ready' : 'pending',
    })
    setTerms((current) => [item, ...current])

    if (settings.autoExplain && !local) {
      try {
        const generated = await explainTerm(term, settings)
        setTerms((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...generated, status: 'ready' } : entry))
        showToast('已经用大白话解释并收录。', 'success')
      } catch (error) {
        showToast(`术语已保存，但解释生成失败：${error.message}`)
      }
    } else if (local) {
      showToast('已经解释并收录到术语库。', 'success')
    } else {
      showToast('术语已保存到“未分组”，连接 AI 后可以补全解释。')
    }
    setBusy('')
    return true
  }

  async function explainPending(id) {
    const term = terms.find((item) => item.id === id)
    if (!term) return
    setBusy(`explain:${id}`)
    try {
      const generated = await explainTerm(term.term, settings)
      setTerms((current) => current.map((entry) => entry.id === id ? { ...entry, ...generated, status: 'ready' } : entry))
      showToast('解释已经补全。', 'success')
    } catch (error) {
      showToast(error.message)
    } finally {
      setBusy('')
    }
  }

  async function organizeTerms() {
    if (!terms.length) return
    setBusy('organizing')
    try {
      const organized = await organizeWithAi(terms, settings)
      setTerms(organized)
      showToast('DeepSeek 已重新整理全部分组。', 'success')
    } catch (error) {
      setTerms(organizeLocally(terms))
      showToast(`DeepSeek 分组暂不可用，已完成本地分组：${error.message}`)
    } finally {
      setBusy('')
    }
  }

  function saveTerm(updated) {
    setTerms((current) => current.map((term) => term.id === updated.id ? { ...updated, status: updated.explanation ? 'ready' : 'pending' } : term))
    setSelectedId(null)
    showToast('术语修改已保存。', 'success')
  }

  function deleteTerm(id) {
    setTerms((current) => current.filter((term) => term.id !== id))
    setSelectedId(null)
    showToast('术语已删除。')
  }

  function toggleMastered(id) {
    setTerms((current) => current.map((term) => term.id === id ? { ...term, mastered: !term.mastered } : term))
  }

  function reviewTerm(id, remembered) {
    setTerms((current) => current.map((term) => term.id === id ? {
      ...term,
      mastered: remembered,
      reviewCount: term.reviewCount + 1,
      lastReviewedAt: new Date().toISOString(),
    } : term))
  }

  function saveSettings(nextSettings) {
    const normalized = normalizeProviderSettings(nextSettings)
    setSettings(normalized)
    if (extensionReady) {
      window.postMessage({ source: 'baihuaben-web', type: 'SYNC_ALL', terms, settings: normalized }, '*')
    }
    showToast('设置已保存在当前浏览器。', 'success')
  }

  function syncExtension(config) {
    window.postMessage({ source: 'baihuaben-web', type: 'SYNC_ALL', terms, settings: config }, '*')
    showToast('术语和模型设置已同步到插件。', 'success')
  }

  return (
    <div className="app-shell">
      <Sidebar extensionReady={extensionReady} page={page} setPage={setPage} />
      <header className="mobile-header"><Brand /></header>
      {page === 'library' ? (
        <LibraryPage
          busy={busy}
          onAdd={addTerm}
          onExplain={explainPending}
          onOpen={setSelectedId}
          onOrganize={organizeTerms}
          onStartReview={() => setPage('review')}
          onToggleMastered={toggleMastered}
          terms={terms}
        />
      ) : null}
      {page === 'review' ? <ReviewPage onBack={() => setPage('library')} onReview={reviewTerm} terms={terms} /> : null}
      {page === 'settings' ? (
        <ModelSettingsPage
          extensionReady={extensionReady}
          onSave={saveSettings}
          onSyncExtension={syncExtension}
          settings={settings}
          showToast={showToast}
        />
      ) : null}
      <nav className="mobile-nav" aria-label="移动端导航">
        {[
          ['library', '术语库'],
          ['review', '复习'],
          ['settings', '设置'],
        ].map(([id, label]) => (
          <button className={page === id ? 'active' : ''} key={id} onClick={() => setPage(id)} type="button">{label}</button>
        ))}
      </nav>
      {selectedTerm ? <TermDrawer key={selectedTerm.id} onClose={() => setSelectedId(null)} onDelete={deleteTerm} onSave={saveTerm} term={selectedTerm} /> : null}
      <Toast onClose={() => setToast(null)} toast={toast} />
    </div>
  )
}
