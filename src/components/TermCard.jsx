import { ArchiveRestore, Check, Clock3, ExternalLink, LoaderCircle, MoreHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { archivedCategoryFor } from '../data/archive'

export default function TermCard({ term, busy, onArchive, onDelete, onOpen, onRestore, onExplain }) {
  const isPending = term.status !== 'ready'
  const isGenerating = busy === `explain:${term.id}`
  const displayCategory = term.archived ? archivedCategoryFor(term) : term.category
  let sourceHost = ''
  if (term.sourceUrl) {
    try {
      sourceHost = new URL(term.sourceUrl).hostname.replace(/^www\./, '')
    } catch {
      sourceHost = term.sourceUrl
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(term.id)
    }
  }

  return (
    <article
      className={term.archived ? 'term-row archived' : 'term-row'}
      onClick={() => onOpen(term.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex="0"
    >
      <div className="term-row-main">
        <div className="term-title-line">
          <h3 className="term-name"><span>{term.term}</span></h3>
          {term.sourceUrl ? (
            <a
              className="term-source source-link"
              href={term.sourceUrl}
              onClick={(event) => event.stopPropagation()}
              rel="noreferrer"
              target="_blank"
              title={term.sourceUrl}
            >
              <ExternalLink aria-hidden="true" size={11} />
              <span>{term.source || sourceHost}</span>
              {term.source && sourceHost ? <small>{sourceHost}</small> : null}
            </a>
          ) : <span className="term-source">{term.source}</span>}
        </div>
        {isPending ? (
          <div aria-busy={isGenerating} className="pending-explanation" data-state={isGenerating ? 'loading' : 'idle'}>
            {isGenerating
              ? <LoaderCircle aria-hidden="true" className="spin" size={16} />
              : <Clock3 aria-hidden="true" size={16} />}
            <span aria-atomic="true" aria-live="polite">
              {isGenerating ? '正在生成大白话解释，通常需要几秒。' : '已收录，等待生成大白话解释。'}
            </span>
            <button
              aria-label={isGenerating ? `正在生成 ${term.term} 的解释` : `生成 ${term.term} 的解释`}
              className="text-button"
              disabled={Boolean(busy)}
              onClick={(event) => { event.stopPropagation(); onExplain(term.id) }}
              type="button"
            >
              {isGenerating
                ? <LoaderCircle aria-hidden="true" className="spin" size={14} />
                : <Sparkles aria-hidden="true" size={14} />}
              {isGenerating ? '生成中' : '生成解释'}
            </button>
          </div>
        ) : (
          <>
            <p className="term-explanation">{term.explanation}</p>
            {term.analogy ? <p className="term-analogy">{term.analogy}</p> : null}
          </>
        )}
      </div>
      <div className="term-row-side">
        <span className={displayCategory === '未分组' ? 'category-tag ungrouped' : 'category-tag'}>{displayCategory}</span>
        <div className="row-actions">
          {term.archived ? (
            <>
              <button
                aria-label={`恢复 ${term.term}`}
                className="icon-button restore-button"
                onClick={(event) => { event.stopPropagation(); onRestore(term.id) }}
                title="恢复到术语库"
                type="button"
              >
                <ArchiveRestore aria-hidden="true" size={16} />
              </button>
              <button
                aria-label={`删除 ${term.term}`}
                className="icon-button danger-icon"
                onClick={(event) => { event.stopPropagation(); onDelete(term.id) }}
                title="永久删除"
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </>
          ) : (
            <button
              aria-label={`将 ${term.term} 归档`}
              className="icon-button"
              onClick={(event) => { event.stopPropagation(); onArchive(term.id) }}
              title="已经熟悉，归档"
              type="button"
            >
              <Check aria-hidden="true" size={16} />
            </button>
          )}
          <button
            aria-label={`查看 ${term.term} 详情`}
            className="icon-button"
            onClick={(event) => { event.stopPropagation(); onOpen(term.id) }}
            title="查看与编辑"
            type="button"
          >
            <MoreHorizontal aria-hidden="true" size={17} />
          </button>
        </div>
      </div>
    </article>
  )
}
