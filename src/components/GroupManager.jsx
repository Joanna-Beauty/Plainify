import { Combine, FolderPlus, Pencil, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'

export default function GroupManager({ groups, terms, onClose, onCreate, onDelete, onMerge, onRename }) {
  const [newGroup, setNewGroup] = useState('')
  const [editing, setEditing] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [mergeSource, setMergeSource] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [deleteTarget, setDeleteTarget] = useState('')
  const counts = useMemo(() => {
    const result = new Map(groups.map((group) => [group, 0]))
    for (const term of terms) {
      if (term.archived) continue
      if (result.has(term.category)) result.set(term.category, result.get(term.category) + 1)
    }
    return result
  }, [groups, terms])

  function create(event) {
    event.preventDefault()
    if (onCreate(newGroup)) setNewGroup('')
  }

  function startRename(group) {
    setEditing(group)
    setRenameDraft(group)
    setMergeSource('')
    setDeleteTarget('')
  }

  function saveRename(event) {
    event.preventDefault()
    if (onRename(editing, renameDraft)) setEditing('')
  }

  function startMerge(group) {
    setMergeSource(group)
    setMergeTarget(groups.find((candidate) => candidate !== group) || '')
    setEditing('')
    setDeleteTarget('')
  }

  function merge(event) {
    event.preventDefault()
    if (onMerge(mergeSource, mergeTarget)) setMergeSource('')
  }

  return (
    <div className="confirm-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="group-manager-title"
        aria-modal="true"
        className="group-manager-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="modal-heading">
          <div><span>术语库设置</span><h2 id="group-manager-title">管理分组</h2></div>
          <button aria-label="关闭分组管理" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <form className="new-group-form" onSubmit={create}>
          <label htmlFor="new-group-name">新建分组</label>
          <div>
            <input
              id="new-group-name"
              maxLength="40"
              onChange={(event) => setNewGroup(event.target.value)}
              placeholder="例如：前端工程"
              value={newGroup}
            />
            <button className="primary-button" disabled={!newGroup.trim()} type="submit">
              <FolderPlus aria-hidden="true" size={15} />新建
            </button>
          </div>
        </form>

        <div className="group-manager-list">
          {groups.length ? groups.map((group) => (
            <section className="group-manager-row" key={group}>
              <div className="group-manager-summary">
                <div><strong>{group}</strong><span>{counts.get(group) || 0} 个术语</span></div>
                <div className="group-manager-actions">
                  <button aria-label={`重命名 ${group}`} className="icon-button" onClick={() => startRename(group)} title="重命名" type="button">
                    <Pencil aria-hidden="true" size={15} />
                  </button>
                  <button aria-label={`合并 ${group}`} className="icon-button" disabled={groups.length < 2} onClick={() => startMerge(group)} title="合并到其他分组" type="button">
                    <Combine aria-hidden="true" size={15} />
                  </button>
                  <button aria-label={`删除 ${group}`} className="icon-button danger-icon" onClick={() => { setDeleteTarget(group); setEditing(''); setMergeSource('') }} title="删除分组" type="button">
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </div>
              </div>

              {editing === group ? (
                <form className="group-inline-form" onSubmit={saveRename}>
                  <input aria-label={`新的分组名称`} maxLength="40" onChange={(event) => setRenameDraft(event.target.value)} value={renameDraft} />
                  <button className="secondary-button" onClick={() => setEditing('')} type="button">取消</button>
                  <button className="primary-button" disabled={!renameDraft.trim()} type="submit">保存</button>
                </form>
              ) : null}

              {mergeSource === group ? (
                <form className="group-inline-form merge" onSubmit={merge}>
                  <span>合并到</span>
                  <select aria-label={`${group} 合并到`} onChange={(event) => setMergeTarget(event.target.value)} value={mergeTarget}>
                    {groups.filter((candidate) => candidate !== group).map((candidate) => (
                      <option key={candidate} value={candidate}>{candidate}</option>
                    ))}
                  </select>
                  <button className="secondary-button" onClick={() => setMergeSource('')} type="button">取消</button>
                  <button className="primary-button" disabled={!mergeTarget} type="submit">确认合并</button>
                </form>
              ) : null}

              {deleteTarget === group ? (
                <div className="group-delete-confirm">
                  <p>删除后，{counts.get(group) || 0} 个术语会回到“未分组”。</p>
                  <div>
                    <button className="secondary-button" onClick={() => setDeleteTarget('')} type="button">取消</button>
                    <button className="danger-button" onClick={() => { if (onDelete(group)) setDeleteTarget('') }} type="button">删除分组</button>
                  </div>
                </div>
              ) : null}
            </section>
          )) : <p className="group-manager-empty">还没有分组，可以先新建一个。</p>}
        </div>
      </section>
    </div>
  )
}
