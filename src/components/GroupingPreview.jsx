import { ArrowRight, Sparkles, X } from 'lucide-react'

export default function GroupingPreview({ preview, onApply, onClose }) {
  return (
    <div className="confirm-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="grouping-preview-title"
        aria-modal="true"
        className="grouping-preview-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="modal-heading">
          <div>
            <span>整理前预览</span>
            <h2 id="grouping-preview-title">确认这次分组方案</h2>
          </div>
          <button aria-label="关闭分组预览" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        {preview.fallbackMessage ? <p className="preview-warning">{preview.fallbackMessage}</p> : null}
        <div className="preview-summary">
          <div><strong>{preview.existingAssignmentsCount}</strong><span>个词进入已有分组</span></div>
          <div><strong>{preview.newGroups.length}</strong><span>个建议新分组</span></div>
          {preview.mode === 'all' ? (
            <div><strong>{preview.removedGroups.length}</strong><span>个旧分组将删除</span></div>
          ) : null}
        </div>

        {preview.newGroups.length ? (
          <div className="new-group-list">
            <span>建议创建</span>
            <div>{preview.newGroups.map((group) => <strong key={group}>{group}</strong>)}</div>
          </div>
        ) : null}

        {preview.removedGroups.length ? (
          <div className="new-group-list removed-group-list">
            <span>应用后删除</span>
            <div>{preview.removedGroups.map((group) => <strong key={group}>{group}</strong>)}</div>
          </div>
        ) : null}

        <div className="preview-change-list" aria-label="术语分组变更">
          {preview.changes.map((change) => (
            <div className="preview-change-row" key={change.id}>
              <strong>{change.term}</strong>
              <span>{change.from}</span>
              <ArrowRight aria-hidden="true" size={13} />
              <span>{change.to}</span>
            </div>
          ))}
        </div>

        <div className="confirm-actions">
          <button className="secondary-button" onClick={onClose} type="button">暂不应用</button>
          <button className="primary-button" onClick={onApply} type="button">
            <Sparkles aria-hidden="true" size={15} />应用分组
          </button>
        </div>
      </section>
    </div>
  )
}
