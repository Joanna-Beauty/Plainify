import { useDeferredValue, useMemo, useState } from 'react'
import { Archive, ArrowRight, BookOpenCheck, FolderCog, MoreHorizontal, RefreshCw, Search, Sparkles, Undo2 } from 'lucide-react'
import GroupManager from '../components/GroupManager'
import GroupingPreview from '../components/GroupingPreview'
import TermCard from '../components/TermCard'
import { archivedCategoryFor, isArchived } from '../data/archive'

export default function LibraryPage({
  terms,
  groups,
  busy,
  canUndoGrouping,
  groupingPreview,
  onAdd,
  onApplyGrouping,
  onArchive,
  onCancelGrouping,
  onCreateGroup,
  onDelete,
  onDeleteGroup,
  onOpen,
  onRestore,
  onExplain,
  onMergeGroups,
  onOrganize,
  onRenameGroup,
  onStartReview,
  onUndoGrouping,
}) {
  const [newTerm, setNewTerm] = useState('')
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('全部术语')
  const [view, setView] = useState('library')
  const [showGroupManager, setShowGroupManager] = useState(false)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const activeTerms = useMemo(() => terms.filter((term) => !isArchived(term)), [terms])
  const archivedTerms = useMemo(() => terms.filter(isArchived), [terms])
  const isArchiveView = view === 'archive'
  const ungroupedCount = activeTerms.filter((term) => term.category === '未分组').length
  const effectiveCategory = activeCategory === '全部术语'
    || activeCategory === '未分组'
    || groups.includes(activeCategory)
    ? activeCategory
    : '全部术语'

  const categoryCounts = useMemo(() => {
    const counts = new Map(groups.map((group) => [group, 0]))
    for (const term of activeTerms) counts.set(term.category, (counts.get(term.category) || 0) + 1)
    const result = []
    if (counts.get('未分组')) result.push(['未分组', counts.get('未分组')])
    for (const group of groups) result.push([group, counts.get(group) || 0])
    for (const [group, count] of counts) {
      if (group !== '未分组' && !groups.includes(group)) result.push([group, count])
    }
    return result
  }, [activeTerms, groups])

  const visibleTerms = useMemo(() => activeTerms.filter((term) => {
    const inCategory = effectiveCategory === '全部术语' || term.category === effectiveCategory
    const haystack = `${term.term} ${term.explanation} ${term.analogy} ${term.category}`.toLowerCase()
    return inCategory && (!deferredQuery || haystack.includes(deferredQuery))
  }), [activeTerms, deferredQuery, effectiveCategory])

  const archivedSections = useMemo(() => {
    const buckets = new Map()
    for (const term of archivedTerms) {
      const category = archivedCategoryFor(term)
      const haystack = `${term.term} ${term.explanation} ${term.analogy} ${category}`.toLowerCase()
      if (deferredQuery && !haystack.includes(deferredQuery)) continue
      if (!buckets.has(category)) buckets.set(category, [])
      buckets.get(category).push(term)
    }

    const names = [
      ...(buckets.has('未分组') ? ['未分组'] : []),
      ...groups.filter((group) => buckets.has(group)),
      ...[...buckets.keys()].filter((group) => group !== '未分组' && !groups.includes(group)),
    ]
    return names.map((category) => ({ category, terms: buckets.get(category) }))
  }, [archivedTerms, deferredQuery, groups])

  async function submit(event) {
    event.preventDefault()
    if (!newTerm.trim()) return
    const added = await onAdd(newTerm)
    if (added) setNewTerm('')
  }

  function regroupAll(event) {
    event.currentTarget.closest('details')?.removeAttribute('open')
    onOrganize('all')
  }

  function showCategory(category) {
    setActiveCategory(category)
    setView('library')
  }

  return (
    <main className="page library-page">
      <header className="page-heading">
        <div>
          <h1>{isArchiveView ? '归档' : '你的个人术语库'}</h1>
          {isArchiveView ? <p>已经熟悉的术语收在这里，需要时可以恢复。</p> : null}
        </div>
        <a
          aria-label="打开加简大白话的 B 站主页"
          className="profile-avatar"
          href="https://space.bilibili.com/1469658337?spm_id_from=333.1007.0.0"
          rel="noreferrer"
          target="_blank"
          title="加简大白话的 B 站主页"
        >
          <img alt="" src="/plainify-avatar.png" />
        </a>
      </header>

      {!isArchiveView ? (
        <>
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
        </>
      ) : null}

      <div className="library-layout">
        <section className="term-section" aria-labelledby="term-list-title">
          <div className="section-toolbar">
            <h2 id="term-list-title">
              {isArchiveView ? '已归档' : '最近收录'}
              <span>{isArchiveView ? archivedTerms.length : activeTerms.length} 个术语</span>
            </h2>
            <div className="toolbar-actions">
              <label className="search-field">
                <Search aria-hidden="true" size={16} />
                <span className="sr-only">搜索术语</span>
                <input onChange={(event) => setQuery(event.target.value)} placeholder="搜索术语或解释" value={query} />
              </label>
              {!isArchiveView ? (
                <div className="organize-actions">
                  <button
                    className="secondary-button"
                    disabled={busy === 'organizing' || ungroupedCount === 0}
                    onClick={() => onOrganize('incremental')}
                    title={ungroupedCount ? '只整理未分组术语，不改变已有分组' : '暂无未分组术语'}
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" className={busy === 'organizing' ? 'spin' : ''} size={16} />
                    {busy === 'organizing' ? '正在整理' : `整理未分组 (${ungroupedCount})`}
                  </button>
                  {canUndoGrouping ? (
                    <button
                      aria-label="撤销上一次整理"
                      className="organize-icon-button"
                      disabled={busy === 'organizing'}
                      onClick={onUndoGrouping}
                      title="撤销上一次整理"
                      type="button"
                    >
                      <Undo2 aria-hidden="true" size={16} />
                    </button>
                  ) : null}
                  <details className="organize-menu">
                    <summary aria-label="更多分组选项" title="更多分组选项">
                      <MoreHorizontal aria-hidden="true" size={17} />
                    </summary>
                    <div>
                      <button disabled={busy === 'organizing' || !activeTerms.length} onClick={regroupAll} type="button">
                        重新整理全部术语
                      </button>
                      <small>可能改变现有分组</small>
                    </div>
                  </details>
                </div>
              ) : null}
            </div>
          </div>

          {isArchiveView ? (
            <div className="archive-list">
              {archivedSections.length ? archivedSections.map((section) => (
                <section className="archive-group" key={section.category}>
                  <header>
                    <h3>{section.category}</h3>
                    <span>{section.terms.length} 个术语</span>
                  </header>
                  <div className="term-list">
                    {section.terms.map((term) => (
                      <TermCard
                        key={term.id}
                        onDelete={onDelete}
                        onExplain={onExplain}
                        onOpen={onOpen}
                        onRestore={onRestore}
                        term={term}
                      />
                    ))}
                  </div>
                </section>
              )) : (
                <div className="empty-state">
                  <Archive aria-hidden="true" size={24} />
                  <h3>{archivedTerms.length ? '没有找到相关术语' : '还没有归档术语'}</h3>
                  <p>{archivedTerms.length ? '换个关键词再找找。' : '在首页给熟悉的术语打钩，它会出现在这里。'}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="term-list">
              {visibleTerms.length ? visibleTerms.map((term) => (
                <TermCard
                  key={term.id}
                  onArchive={onArchive}
                  onExplain={onExplain}
                  onOpen={onOpen}
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
          )}
        </section>

        <aside className="library-rail" aria-label="术语分组、归档与复习">
          <section className="category-section">
            <div className="category-heading">
              <h2>分组</h2>
              <button aria-label="管理分组" className="icon-button" onClick={() => setShowGroupManager(true)} title="管理分组" type="button">
                <FolderCog aria-hidden="true" size={16} />
              </button>
            </div>
            <button
              className={!isArchiveView && effectiveCategory === '全部术语' ? 'category-row active' : 'category-row'}
              onClick={() => showCategory('全部术语')}
              type="button"
            >
              <span>全部术语</span><strong>{activeTerms.length}</strong>
            </button>
            {categoryCounts.map(([category, count]) => (
              <button
                className={!isArchiveView && effectiveCategory === category ? 'category-row active' : 'category-row'}
                key={category}
                onClick={() => showCategory(category)}
                type="button"
              >
                <span>{category}</span><strong>{count}</strong>
              </button>
            ))}
          </section>
          <section className="archive-section">
            <button
              aria-current={isArchiveView ? 'page' : undefined}
              className={isArchiveView ? 'archive-entry active' : 'archive-entry'}
              onClick={() => setView('archive')}
              type="button"
            >
              <span className="archive-entry-icon"><Archive aria-hidden="true" size={17} /></span>
              <span><strong>归档</strong><small>已熟悉的术语</small></span>
              <b>{archivedTerms.length}</b>
            </button>
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
      {showGroupManager ? (
        <GroupManager
          groups={groups}
          onClose={() => setShowGroupManager(false)}
          onCreate={onCreateGroup}
          onDelete={onDeleteGroup}
          onMerge={onMergeGroups}
          onRename={onRenameGroup}
          terms={activeTerms}
        />
      ) : null}
      {groupingPreview ? (
        <GroupingPreview onApply={onApplyGrouping} onClose={onCancelGrouping} preview={groupingPreview} />
      ) : null}
    </main>
  )
}
