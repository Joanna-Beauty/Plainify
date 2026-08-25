import { useMemo, useState } from 'react'
import { ArrowLeft, Check, RotateCcw, X } from 'lucide-react'

export default function ReviewPage({ terms, onReview, onBack }) {
  const queue = useMemo(() => [...terms]
    .sort((a, b) => Number(a.mastered) - Number(b.mastered) || a.reviewCount - b.reviewCount)
    .slice(0, 5), [terms])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [remembered, setRemembered] = useState(0)
  const current = queue[index]

  function rate(result) {
    onReview(current.id, result)
    if (result) setRemembered((value) => value + 1)
    setRevealed(false)
    setIndex((value) => value + 1)
  }

  function restart() {
    setIndex(0)
    setRemembered(0)
    setRevealed(false)
  }

  if (!current) {
    return (
      <main className="page review-page">
        <button className="back-button" onClick={onBack} type="button"><ArrowLeft size={17} />返回术语库</button>
        <section className="review-complete">
          <span className="complete-mark"><Check aria-hidden="true" size={28} /></span>
          <h1>这轮复习完成了</h1>
          <p>记住了 {remembered} 个，共复习 {queue.length} 个。忘记不算失败，下次再见一次就好。</p>
          <div className="complete-actions">
            <button className="secondary-button" onClick={restart} type="button"><RotateCcw size={16} />再来一轮</button>
            <button className="primary-button" onClick={onBack} type="button">回到术语库</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="page review-page">
      <header className="review-header">
        <button className="back-button" onClick={onBack} type="button"><ArrowLeft size={17} />返回术语库</button>
        <span>{index + 1} / {queue.length}</span>
      </header>
      <div className="review-progress" aria-label={`复习进度 ${index + 1}/${queue.length}`}>
        <span style={{ width: `${(index / queue.length) * 100}%` }} />
      </div>
      <section className={revealed ? 'flashcard revealed' : 'flashcard'}>
        <span className="flashcard-category">{current.category}</span>
        <h1><span>{current.term}</span></h1>
        {revealed ? (
          <div className="flashcard-answer">
            <p>{current.explanation}</p>
            {current.analogy ? <blockquote>{current.analogy}</blockquote> : null}
          </div>
        ) : (
          <button className="reveal-button" onClick={() => setRevealed(true)} type="button">想好以后，查看解释</button>
        )}
      </section>
      {revealed ? (
        <div className="review-actions">
          <button className="review-again" onClick={() => rate(false)} type="button"><X size={18} />还不熟</button>
          <button className="review-known" onClick={() => rate(true)} type="button"><Check size={18} />记住了</button>
        </div>
      ) : <p className="review-instruction">先用自己的话说一遍，不需要一字不差。</p>}
    </main>
  )
}
