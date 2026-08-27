import { useEffect, useMemo, useState } from 'react'
import { archiveTermInList, archivedCategoryFor, isArchived, restoreTermInList } from './data/archive'
import Sidebar, { Brand } from './components/Sidebar'
import TermDrawer from './components/TermDrawer'
import Toast from './components/Toast'
import LibraryPage from './pages/LibraryPage'
import ReviewPage from './pages/ReviewPage'
import ModelSettingsPage from './pages/ModelSettingsPage'
import {
  ALL_TERMS,
  UNGROUPED,
  applyGroupingChanges,
  consolidateBroadGroups,
  createGroupingPreview,
  deleteGroup as deleteGroupData,
  groupNamesFromTerms,
  groupsAfterAutomaticGrouping,
  mergeGroupNames,
  mergeGroups as mergeGroupsData,
  normalizeGroupName,
  renameGroup as renameGroupData,
} from './data/grouping'
import { normalizeProviderSettings } from './data/modelProviders'
import { defaultSettings, seedTerms } from './data/seedTerms'
import { mergeExtensionTerms } from './data/termSync'
import { useLocalStorage } from './hooks/useLocalStorage'
import { explainTerm, getLocalExplanation, organizeLocally, organizeWithAi } from './services/ai'

const defaultGroups = groupNamesFromTerms(seedTerms)

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
    archived: Boolean(term.archived),
    archivedAt: String(term.archivedAt || ''),
    archivedCategory: term.archived ? String(term.archivedCategory || term.category || UNGROUPED) : '',
    status: term.status === 'ready' && term.explanation ? 'ready' : 'pending',
  }
}

export default function App() {
  const [page, setPage] = useState('library')
  const [terms, setTerms] = useLocalStorage('baihuaben:terms:v1', seedTerms)
  const [groups, setGroups] = useLocalStorage('baihuaben:groups:v1', defaultGroups)
  const [lastGroupingChange, setLastGroupingChange] = useLocalStorage('baihuaben:last-grouping:v1', null)
  const [storedSettings, setSettings] = useLocalStorage('baihuaben:settings:v1', defaultSettings)
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState(null)
  const [extensionReady, setExtensionReady] = useState(false)
  const [groupingPreview, setGroupingPreview] = useState(null)
  const settings = useMemo(() => normalizeProviderSettings(storedSettings), [storedSettings])
  const selectedTerm = useMemo(() => terms.find((term) => term.id === selectedId), [selectedId, terms])
  const activeTerms = useMemo(() => terms.filter((term) => !isArchived(term)), [terms])

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
    const discovered = groupNamesFromTerms(activeTerms)
    setGroups((current) => {
      const next = mergeGroupNames(current, discovered)
      return next.length === current.length && next.every((group, index) => group === current[index]) ? current : next
    })
  }, [activeTerms, setGroups])

  useEffect(() => {
    function handleExtensionMessage(event) {
      if (event.source !== window || event.data?.source !== 'baihuaben-extension') return
      if (!['READY', 'TERMS_CHANGED'].includes(event.data.type)) return
      setExtensionReady(true)
      const incoming = Array.isArray(event.data.terms) ? event.data.terms.map(normalizeIncomingTerm).filter((term) => term.term) : []
      if (!incoming.length) return
      setTerms((current) => mergeExtensionTerms(current, incoming))
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
      showToast(duplicate.archived ? '这个术语已归档，可以在详情中恢复。' : '这个术语已经在你的术语库里了。')
      return false
    }

    setBusy('adding')
    const local = getLocalExplanation(term)
    const item = normalizeIncomingTerm({
      id: crypto.randomUUID(),
      term,
      ...local,
      category: UNGROUPED,
      source,
      sourceUrl,
      status: local ? 'ready' : 'pending',
    })
    setTerms((current) => [item, ...current])

    if (settings.autoExplain && !local) {
      try {
        const generated = await explainTerm(term, settings)
        setTerms((current) => current.map((entry) => entry.id === item.id ? {
          ...entry,
          ...generated,
          category: UNGROUPED,
          status: 'ready',
        } : entry))
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
      setTerms((current) => current.map((entry) => entry.id === id ? {
        ...entry,
        ...generated,
        category: entry.category,
        status: 'ready',
      } : entry))
      showToast('解释已经补全。', 'success')
    } catch (error) {
      showToast(error.message)
    } finally {
      setBusy('')
    }
  }

  async function organizeTerms(mode = 'incremental') {
    const ungroupedCount = activeTerms.filter((term) => term.category === UNGROUPED).length
    if (!activeTerms.length || (mode !== 'all' && !ungroupedCount)) {
      showToast('现在没有需要整理的未分组术语。')
      return
    }
    setBusy('organizing')
    let organized
    let fallbackMessage = ''
    try {
      organized = await organizeWithAi(activeTerms, settings, mode, groups)
    } catch (error) {
      organized = organizeLocally(activeTerms, mode)
      fallbackMessage = `DeepSeek 暂不可用，以下是本地分组建议：${error.message}`
    } finally {
      setBusy('')
    }
    organized = consolidateBroadGroups(organized, mode, groups)
    const preview = createGroupingPreview(activeTerms, organized, groups, mode, fallbackMessage)
    if (!preview.changes.length && !preview.removedGroups.length) {
      showToast('这次整理没有产生需要应用的分组变化。')
      return
    }
    setGroupingPreview(preview)
  }

  function applyGroupingPreview() {
    if (!groupingPreview) return
    const updatedTerms = applyGroupingChanges(terms, groupingPreview.changes)
    const updatedGroups = groupsAfterAutomaticGrouping(
      groups,
      updatedTerms,
      groupingPreview.mode,
      groupingPreview.newGroups,
    )
    const snapshot = {
      changes: groupingPreview.changes,
      createdGroups: groupingPreview.newGroups,
      previousGroups: groupingPreview.mode === 'all' ? groups : null,
      createdAt: new Date().toISOString(),
    }
    setTerms(updatedTerms)
    setGroups(updatedGroups)
    setLastGroupingChange(snapshot)
    setGroupingPreview(null)
    const removedMessage = groupingPreview.removedGroups.length
      ? `，已删除 ${groupingPreview.removedGroups.length} 个旧分组`
      : ''
    showToast(`${groupingPreview.changes.length} 个术语已完成分组${removedMessage}，可以随时撤销。`, 'success')
  }

  function undoLastGrouping() {
    if (!lastGroupingChange || (!lastGroupingChange.changes?.length && !lastGroupingChange.previousGroups)) return
    const restored = applyGroupingChanges(terms, lastGroupingChange.changes, 'reverse')
    const occupied = new Set(restored.filter((term) => !isArchived(term)).map((term) => term.category))
    setTerms(restored)
    if (lastGroupingChange.previousGroups) {
      setGroups(lastGroupingChange.previousGroups)
    } else {
      setGroups((current) => current.filter((group) => (
        !lastGroupingChange.createdGroups?.includes(group) || occupied.has(group)
      )))
    }
    setLastGroupingChange(null)
    showToast('已撤销上一次自动整理。', 'success')
  }

  function validateGroupName(rawName, currentName = '') {
    const name = normalizeGroupName(rawName)
    if (!name) {
      showToast('请输入分组名称。')
      return ''
    }
    if (name === UNGROUPED || name === ALL_TERMS) {
      showToast(`“${name}”是系统保留名称，请换一个。`)
      return ''
    }
    const duplicate = groups.find((group) => (
      group !== currentName && group.toLocaleLowerCase('zh-CN') === name.toLocaleLowerCase('zh-CN')
    ))
    if (duplicate) {
      showToast('已经有同名分组，可以使用“合并分组”。')
      return ''
    }
    return name
  }

  function createGroup(rawName) {
    const name = validateGroupName(rawName)
    if (!name) return false
    setGroups((current) => [...current, name])
    setLastGroupingChange(null)
    showToast(`已新建分组“${name}”。`, 'success')
    return true
  }

  function renameGroup(source, rawTarget) {
    const target = validateGroupName(rawTarget, source)
    if (!target) return false
    if (source === target) return true
    const updated = renameGroupData(groups, terms, source, target)
    setGroups(updated.groups)
    setTerms(updated.terms)
    setLastGroupingChange(null)
    showToast(`已将“${source}”重命名为“${target}”。`, 'success')
    return true
  }

  function deleteGroup(target) {
    const count = activeTerms.filter((term) => term.category === target).length
    const updated = deleteGroupData(groups, terms, target)
    setGroups(updated.groups)
    setTerms(updated.terms)
    setLastGroupingChange(null)
    showToast(`已删除“${target}”，${count} 个术语回到未分组。`, 'success')
    return true
  }

  function mergeGroups(source, target) {
    if (!source || !target || source === target || !groups.includes(target)) return false
    const count = activeTerms.filter((term) => term.category === source).length
    const updated = mergeGroupsData(groups, terms, source, target)
    setGroups(updated.groups)
    setTerms(updated.terms)
    setLastGroupingChange(null)
    showToast(`已将“${source}”合并到“${target}”，移动了 ${count} 个术语。`, 'success')
    return true
  }

  function saveTerm(updated) {
    if (selectedTerm?.category !== updated.category) setLastGroupingChange(null)
    setTerms((current) => current.map((term) => term.id === updated.id ? { ...updated, status: updated.explanation ? 'ready' : 'pending' } : term))
    setSelectedId(null)
    showToast('术语修改已保存。', 'success')
  }

  function deleteTerm(id) {
    setTerms((current) => current.filter((term) => term.id !== id))
    setSelectedId(null)
    showToast('术语已删除。')
  }

  function archiveTerm(id) {
    setTerms((current) => archiveTermInList(current, id))
    setSelectedId(null)
    setLastGroupingChange(null)
    showToast('术语已归档，首页和网页高亮中都不再显示。', 'success')
  }

  function restoreTerm(id) {
    const archivedTerm = terms.find((term) => term.id === id)
    if (!archivedTerm?.archived) return
    const originalCategory = archivedCategoryFor(archivedTerm)
    const originalGroupStillExists = originalCategory === UNGROUPED || groups.includes(originalCategory)
    setTerms((current) => restoreTermInList(current, id, groups))
    setSelectedId(null)
    setLastGroupingChange(null)
    showToast(
      originalGroupStillExists
        ? `术语已恢复到“${originalCategory}”。`
        : '原分组已不存在，术语已恢复到“未分组”。',
      'success',
    )
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
          canUndoGrouping={Boolean(lastGroupingChange?.changes?.length || lastGroupingChange?.previousGroups)}
          groupingPreview={groupingPreview}
          groups={groups}
          onAdd={addTerm}
          onApplyGrouping={applyGroupingPreview}
          onArchive={archiveTerm}
          onCancelGrouping={() => setGroupingPreview(null)}
          onCreateGroup={createGroup}
          onDelete={deleteTerm}
          onDeleteGroup={deleteGroup}
          onExplain={explainPending}
          onMergeGroups={mergeGroups}
          onOpen={setSelectedId}
          onOrganize={organizeTerms}
          onRenameGroup={renameGroup}
          onStartReview={() => setPage('review')}
          onRestore={restoreTerm}
          onUndoGrouping={undoLastGrouping}
          terms={terms}
        />
      ) : null}
      {page === 'review' ? <ReviewPage onBack={() => setPage('library')} onReview={reviewTerm} terms={activeTerms} /> : null}
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
      {selectedTerm ? (
        <TermDrawer
          groups={groups}
          key={selectedTerm.id}
          onClose={() => setSelectedId(null)}
          onDelete={deleteTerm}
          onArchive={archiveTerm}
          onRestore={restoreTerm}
          onSave={saveTerm}
          term={selectedTerm}
        />
      ) : null}
      <Toast onClose={() => setToast(null)} toast={toast} />
    </div>
  )
}
