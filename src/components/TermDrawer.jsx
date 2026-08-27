import { useState } from 'react'
import { Archive, ArchiveRestore, Trash2, X } from 'lucide-react'
import { archivedCategoryFor } from '../data/archive'

export default function TermDrawer({ term, groups, onArchive, onClose, onDelete, onRestore, onSave }) {
  const [draft, setDraft] = useState(term)
  const displayedCategory = draft.archived ? archivedCategoryFor(draft) : draft.category
  const groupOptions = groups.includes(displayedCategory) || displayedCategory === '未分组'
    ? groups
    : [...groups, displayedCategory]

  function updateField(event) {
    setDraft((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  function submit(event) {
    event.preventDefault()
    onSave(draft)
  }

  return (
    <div className="drawer-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="drawer-title"
        aria-modal="true"
        className="term-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="drawer-header">
          <div>
            <span className="drawer-label">术语详情</span>
            <h2 id="drawer-title">{term.term}</h2>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={19} />
          </button>
        </header>
        <form className="drawer-form" onSubmit={submit}>
          <label>
            术语
            <input name="term" onChange={updateField} value={draft.term} />
          </label>
          <label>
            大白话解释
            <textarea name="explanation" onChange={updateField} rows="6" value={draft.explanation} />
          </label>
          <label>
            生活化类比
            <textarea name="analogy" onChange={updateField} rows="3" value={draft.analogy} />
          </label>
          <div className="form-grid">
            <label>
              分组
              <select disabled={draft.archived} name="category" onChange={updateField} value={displayedCategory}>
                <option value="未分组">未分组</option>
                {groupOptions.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </label>
            <label>
              来源
              <input name="source" onChange={updateField} value={draft.source} />
            </label>
          </div>
          <label>
            来源网站 URL
            <input
              name="sourceUrl"
              onChange={updateField}
              placeholder={draft.sourceUrl ? '' : '手动输入的术语没有来源 URL'}
              value={draft.sourceUrl || ''}
            />
          </label>
          <div className="drawer-actions">
            <button className="danger-button" onClick={() => onDelete(term.id)} type="button">
              <Trash2 aria-hidden="true" size={16} />
              删除术语
            </button>
            {term.archived ? (
              <button className="secondary-button" onClick={() => onRestore(term.id)} type="button">
                <ArchiveRestore aria-hidden="true" size={16} />
                恢复到术语库
              </button>
            ) : (
              <button className="secondary-button" onClick={() => onArchive(term.id)} type="button">
                <Archive aria-hidden="true" size={16} />
                归档术语
              </button>
            )}
            <button className="primary-button" type="submit">保存修改</button>
          </div>
        </form>
      </section>
    </div>
  )
}
