import { useDeferredValue, useMemo, useState } from 'react'
import { ArrowRight, BookOpenCheck, RefreshCw, Search, Sparkles } from 'lucide-react'
import TermCard from '../components/TermCard'

export default function LibraryPage({
  terms,
  busy,
  onAdd,
  onOpen,
  onToggleMastered,
  onExplain,
  onOrganize,
  onStartReview,
}) {
  const [newTerm, setNewTerm] = useState('')
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('全部术语')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const categoryCounts = useMemo(() => {
    const counts = new Map()
    for (const term of terms) counts.set(term.category, (counts.get(term.category) || 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => {
      if (a === '未分组') return -1
      if (b === '未分组') return 1
      return a.localeCompare(b, 'zh-CN')
    })
  }, [terms])

  const visibleTerms = useMemo(() => terms.filter((term) => {
    const inCategory = activeCategory === '全部术语' || term.category === activeCategory
    const haystack = `${term.term} ${term.explanation} ${term.analogy} ${term.category}`.toLowerCase()
    return inCategory && (!deferredQuery || haystack.includes(deferredQuery))
  }), [activeCategory, deferredQuery, terms])

  async function submit(event) {
    event.preventDefault()
    if (!newTerm.trim()) return
    const added = await onAdd(newTerm)
    if (added) setNewTerm('')
  }

  return (
    <main className="page library-page">
      <header className="page-heading">
        <div>
          <h1>把陌生词，讲成人话。</h1>
          <p>遇到看不懂的技术词，先存下来，理解可以慢慢发生。</p>
        </div>
        <div className="profile-avatar" aria-label="本地个人术语库">本地</div>
      </header>

      <form className="capture-bar" onSubmit={submit}>
        <label className="sr-only" htmlFor="new-term">要解释的术语</label>
        <input
          autoComplete="off"
          id="new-term"
          onChange={(event) => setNewTerm(event.target.value)}
          placeholder="粘贴一个刚遇到的术语，比如：RAG"
          value={newTerm}
        />
        <button disabled={busy === 'adding' || !newTerm.trim()} type="submit">
          <Sparkles aria-hidden="true" size={17} />
          {busy === 'adding' ? '正在解释' : '解释并收录'}
        </button>
      </form>
      <p className="capture-hint">按 Enter 也能收录，AI 会用大白话解释，并先放进“未分组”。</p>

      <div className="library-layout">
        <section className="term-section" aria-labelledby="term-list-title">
          <div className="section-toolbar">
            <h2 id="term-list-title">最近收录 <span>{terms.length} 个术语</span></h2>
            <div className="toolbar-actions">
              <label className="search-field">
                <Search aria-hidden="true" size={16} />
                <span className="sr-only">搜索术语</span>
                <input onChange={(event) => setQuery(event.target.value)} placeholder="搜索术语或解释" value={query} />
              </label>
              <button className="secondary-button" disabled={busy === 'organizing'} onClick={onOrganize} type="button">
                <RefreshCw aria-hidden="true" className={busy === 'organizing' ? 'spin' : ''} size={16} />
                {busy === 'organizing' ? '正在整理' : '自动整理分组'}
              </button>
            </div>
          </div>
          <div className="term-list">
            {visibleTerms.length ? visibleTerms.map((term) => (
              <TermCard
                key={term.id}
                onExplain={onExplain}
                onOpen={onOpen}
                onToggleMastered={onToggleMastered}
                term={term}
              />
            )) : (
              <div className="empty-state">
                <Search aria-hidden="true" size={24} />
                <h3>没有找到相关术语</h3>
                <p>换个关键词，或者回到“全部术语”看看。</p>
              </div>
            )}
          </div>
        </section>

        <aside className="library-rail" aria-label="术语分组与复习">
          <section className="category-section">
            <h2>分组</h2>
            <button
              className={activeCategory === '全部术语' ? 'category-row active' : 'category-row'}
              onClick={() => setActiveCategory('全部术语')}
              type="button"
            >
              <span>全部术语</span><strong>{terms.length}</strong>
            </button>
            {categoryCounts.map(([category, count]) => (
              <button
                className={activeCategory === category ? 'category-row active' : 'category-row'}
                key={category}
                onClick={() => setActiveCategory(category)}
                type="button"
              >
                <span>{category}</span><strong>{count}</strong>
              </button>
            ))}
          </section>
          <section className="review-prompt">
            <BookOpenCheck aria-hidden="true" size={21} />
            <h2>今天复习 5 个</h2>
            <p>从还没掌握的词开始，看看自己能不能先说出意思。</p>
            <button onClick={onStartReview} type="button">
              开始快速复习
              <ArrowRight aria-hidden="true" size={15} />
            </button>
          </section>
        </aside>
      </div>
    </main>
  )
}
