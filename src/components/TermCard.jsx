import { Check, Clock3, ExternalLink, MoreHorizontal, Sparkles } from 'lucide-react'

export default function TermCard({ term, onOpen, onToggleMastered, onExplain }) {
  const isPending = term.status !== 'ready'
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
      className={term.mastered ? 'term-row mastered' : 'term-row'}
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
          <div className="pending-explanation">
            <Clock3 aria-hidden="true" size={16} />
            <span>已收录，等待生成大白话解释。</span>
            <button
              className="text-button"
              onClick={(event) => { event.stopPropagation(); onExplain(term.id) }}
              type="button"
            >
              <Sparkles aria-hidden="true" size={14} />
              生成解释
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
        <span className={term.category === '未分组' ? 'category-tag ungrouped' : 'category-tag'}>{term.category}</span>
        <div className="row-actions">
          <button
            aria-label={term.mastered ? `将 ${term.term} 标为待复习` : `将 ${term.term} 标为已掌握`}
            className={term.mastered ? 'icon-button mastered' : 'icon-button'}
            onClick={(event) => { event.stopPropagation(); onToggleMastered(term.id) }}
            title={term.mastered ? '标为待复习' : '标为已掌握'}
            type="button"
          >
            <Check aria-hidden="true" size={16} />
          </button>
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
