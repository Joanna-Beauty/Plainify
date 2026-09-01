import { useCallback, useEffect, useMemo, useState } from 'react'
import { archiveTermInList, archivedCategoryFor, isArchived, restoreTermInList } from './data/archive'
import AppHeader from './components/AppHeader'
import Sidebar from './components/Sidebar'
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
import { getOnboardingProgress, isModelSetupError } from './data/onboarding'
import { reviewTermInList } from './data/review'
import { defaultSettings, seedTerms } from './data/seedTerms'
import { mergeExtensionTerms } from './data/termSync'
import {
  clearSupersededTombstones,
  createTermTombstone,
  normalizeTermList,
  normalizeTermRecord,
  normalizeTermText,
  stampChangedTerms,
  termKey,
  touchTerm,
} from './data/terms'
import { useLocalStorage } from './hooks/useLocalStorage'
import { explainTerm, getAiProviders, getLocalExplanation, organizeLocally, organizeWithAi } from './services/ai'

const defaultGroups = groupNamesFromTerms(seedTerms)

export default function App() {
  const [page, setPage] = useState('library')
  const [terms, setTerms] = useLocalStorage('baihuaben:terms:v1', seedTerms)
  const [groups, setGroups] = useLocalStorage('baihuaben:groups:v1', defaultGroups)
  const [lastGroupingChange, setLastGroupingChange] = useLocalStorage('baihuaben:last-grouping:v1', null)
  const [termTombstones, setTermTombstones] = useLocalStorage('baihuaben:term-tombstones:v1', {})
  const [storedSettings, setSettings] = useLocalStorage('baihuaben:settings:v1', defaultSettings)
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState(null)
  const [extensionReady, setExtensionReady] = useState(false)
  const [modelSetup, setModelSetup] = useState({ checked: false, configured: false })
  const [groupingPreview, setGroupingPreview] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage('baihuaben:sidebar-collapsed:v1', false)
  const [onboardingCollapsed, setOnboardingCollapsed] = useLocalStorage('baihuaben:onboarding-collapsed:v1', false)
  const [settingsTab, setSettingsTab] = useState('general')
  const settings = useMemo(() => normalizeProviderSettings(storedSettings), [storedSettings])
  const selectedTerm = useMemo(() => terms.find((term) => term.id === selectedId), [selectedId, terms])
  const activeTerms = useMemo(() => terms.filter((term) => !isArchived(term)), [terms])
  const onboardingProgress = useMemo(() => getOnboardingProgress({
    modelConfigured: modelSetup.configured,
    extensionReady,
    terms,
  }), [extensionReady, modelSetup.configured, terms])

  function showToast(message, type = 'info', action = null) {
    setToast({ id: Date.now(), message, type, action })
  }

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), toast.action ? 8000 : 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const hasLegacySecret = ['apiKey', 'baseUrl'].some((key) => Object.hasOwn(storedSettings, key))
    if (hasLegacySecret) setSettings(settings)
  }, [setSettings, settings, storedSettings])

  useEffect(() => {
    setTerms((current) => normalizeTermList(current))
  }, [setTerms])

  useEffect(() => {
    const controller = new AbortController()
    getAiProviders(controller.signal)
      .then((result) => setModelSetup({
        checked: true,
        configured: Boolean(result.providers?.some((provider) => provider.configured)),
      }))
      .catch((error) => {
        if (error.name !== 'AbortError') setModelSetup({ checked: true, configured: false })
      })
    return () => controller.abort()
  }, [])

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
      const incoming = Array.isArray(event.data.terms) ? event.data.terms.map((term) => normalizeTermRecord(term, {
        id: term.id || crypto.randomUUID(),
        now: term.createdAt,
      })).filter((term) => term.term) : []
      if (!incoming.length) return
      setTerms((current) => mergeExtensionTerms(current, incoming, termTombstones))
      setTermTombstones((current) => clearSupersededTombstones(current, incoming))
    }
    window.addEventListener('message', handleExtensionMessage)
    window.postMessage({ source: 'baihuaben-web', type: 'PING' }, '*')
    return () => window.removeEventListener('message', handleExtensionMessage)
  }, [setTermTombstones, setTerms, termTombstones])

  useEffect(() => {
    if (!extensionReady) return
    window.postMessage({ source: 'baihuaben-web', type: 'SYNC_ALL', terms, settings }, '*')
  }, [extensionReady, settings, terms])

  const reconcileProviderSelection = useCallback(({ provider, model, configured }) => {
    setSettings((current) => {
      const normalized = normalizeProviderSettings(current)
      const next = normalizeProviderSettings({ ...normalized, provider, model })
      return next.provider === normalized.provider && next.model === normalized.model ? current : next
    })
    if (typeof configured === 'boolean') {
      setModelSetup({ checked: true, configured })
    }
  }, [setSettings])

  function openSettings(tab = 'general') {
    setSettingsTab(tab)
    setPage('settings')
  }

  function navigateToPage(nextPage) {
    if (nextPage === 'settings') setSettingsTab('general')
    setPage(nextPage)
  }

  function showModelSetupToast(message) {
    setModelSetup({ checked: true, configured: false })
    showToast(message, 'info', { label: '去连接模型', onClick: () => openSettings('model') })
  }

  async function addTerm(rawTerm, source = '手动输入', sourceUrl = '') {
    const term = normalizeTermText(rawTerm)
    if (!term) return false
    const duplicate = terms.find((item) => item.term.toLowerCase() === term.toLowerCase())
    if (duplicate) {
      setSelectedId(duplicate.id)
      showToast(duplicate.archived ? '这个术语已归档，可以在详情中恢复。' : '这个术语已经在你的术语库里了。')
      return false
    }

    setBusy('adding')
    const local = getLocalExplanation(term)
    const now = new Date().toISOString()
    const item = normalizeTermRecord({
      id: crypto.randomUUID(),
      term,
      ...local,
      category: UNGROUPED,
      source,
      sourceUrl,
      createdAt: now,
      updatedAt: now,
      status: local ? 'ready' : 'pending',
    }, { now })
    setTerms((current) => [item, ...current])
    setTermTombstones((current) => clearSupersededTombstones(current, [item]))

    if (settings.autoExplain && !local) {
      try {
        const generated = await explainTerm(term, settings)
        setTerms((current) => current.map((entry) => entry.id === item.id ? touchTerm(entry, {
          ...generated,
          category: UNGROUPED,
        }, 'content') : entry))
        showToast('已经用大白话解释并收录。', 'success')
      } catch (error) {
        if (isModelSetupError(error)) {
          showModelSetupToast('术语已保存，连接模型后即可补全大白话解释。')
        } else {
          showToast(`术语已保存，但解释生成失败：${error.message}`)
        }
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
      setTerms((current) => current.map((entry) => entry.id === id ? touchTerm(entry, {
        ...generated,
        category: entry.category,
      }, 'content') : entry))
      showToast('解释已经补全。', 'success')
    } catch (error) {
      if (isModelSetupError(error)) {
        showModelSetupToast('还没有可用的模型服务，连接后再生成解释。')
      } else {
        showToast(error.message)
      }
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
    const groupedTerms = applyGroupingChanges(terms, groupingPreview.changes)
    const updatedTerms = stampChangedTerms(terms, groupedTerms, 'category')
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
    showToast(`${groupingPreview.changes.length} 个术语已完成分组${removedMessage}。`, 'success')
  }

  function undoLastGrouping() {
    if (!lastGroupingChange || (!lastGroupingChange.changes?.length && !lastGroupingChange.previousGroups)) return
    const regrouped = applyGroupingChanges(terms, lastGroupingChange.changes, 'reverse')
    const restored = stampChangedTerms(terms, regrouped, 'category')
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
    setTerms(stampChangedTerms(terms, updated.terms, ['category', 'archive']))
    setLastGroupingChange(null)
    showToast(`已将“${source}”重命名为“${target}”。`, 'success')
    return true
  }

  function deleteGroup(target) {
    const count = activeTerms.filter((term) => term.category === target).length
    const updated = deleteGroupData(groups, terms, target)
    setGroups(updated.groups)
    setTerms(stampChangedTerms(terms, updated.terms, 'category'))
    setLastGroupingChange(null)
    showToast(`已删除“${target}”，${count} 个术语回到未分组。`, 'success')
    return true
  }

  function mergeGroups(source, target) {
    if (!source || !target || source === target || !groups.includes(target)) return false
    const count = activeTerms.filter((term) => term.category === source).length
    const updated = mergeGroupsData(groups, terms, source, target)
    setGroups(updated.groups)
    setTerms(stampChangedTerms(terms, updated.terms, ['category', 'archive']))
    setLastGroupingChange(null)
    showToast(`已将“${source}”合并到“${target}”，移动了 ${count} 个术语。`, 'success')
    return true
  }

  function saveTerm(updated) {
    if (!selectedTerm) return
    const normalizedName = normalizeTermText(updated.term)
    if (!normalizedName) {
      showToast('请输入术语名称。')
      return
    }
    const duplicate = terms.find((term) => term.id !== updated.id && termKey(term.term) === termKey(normalizedName))
    if (duplicate) {
      showToast('已经有同名术语，请换一个名称。')
      return
    }
    const contentChanged = ['term', 'explanation', 'analogy', 'source', 'sourceUrl']
      .some((field) => String(selectedTerm[field] || '') !== String(updated[field] || ''))
    const categoryChanged = selectedTerm.category !== updated.category
    const scopes = [contentChanged ? 'content' : '', categoryChanged ? 'category' : ''].filter(Boolean)
    const next = scopes.length
      ? touchTerm(selectedTerm, { ...updated, term: normalizedName }, scopes)
      : selectedTerm
    if (categoryChanged) setLastGroupingChange(null)
    setTerms((current) => current.map((term) => term.id === next.id ? next : term))
    setTermTombstones((current) => clearSupersededTombstones(current, [next]))
    setSelectedId(null)
    showToast('术语修改已保存。', 'success')
  }

  function deleteTerm(id) {
    const deleted = terms.find((term) => term.id === id)
    if (!deleted) return
    const tombstone = createTermTombstone(deleted)
    setTermTombstones((current) => ({ ...current, [termKey(deleted.term)]: tombstone }))
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
    setTerms((current) => reviewTermInList(current, id, remembered))
  }

  function saveSettings(nextSettings) {
    const normalized = normalizeProviderSettings(nextSettings)
    setSettings(normalized)
    showToast('通用设置已保存。', 'success')
  }

  return (
    <div className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <AppHeader />
      <Sidebar
        collapsed={sidebarCollapsed}
        extensionReady={extensionReady}
        onToggle={() => setSidebarCollapsed((current) => !current)}
        page={page}
        setPage={navigateToPage}
      />
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
          onCollapseOnboarding={() => setOnboardingCollapsed(true)}
          onExpandOnboarding={() => setOnboardingCollapsed(false)}
          onOpenExtensionSetup={() => openSettings('general')}
          onOpenModelSetup={() => openSettings('model')}
          onOrganize={organizeTerms}
          onRenameGroup={renameGroup}
          onStartReview={() => setPage('review')}
          onRestore={restoreTerm}
          onUndoGrouping={undoLastGrouping}
          onboarding={modelSetup.checked ? { ...onboardingProgress, collapsed: onboardingCollapsed } : null}
          terms={terms}
        />
      ) : null}
      {page === 'review' ? <ReviewPage onBack={() => setPage('library')} onReview={reviewTerm} terms={activeTerms} /> : null}
      {page === 'settings' ? (
        <ModelSettingsPage
          extensionReady={extensionReady}
          initialTab={settingsTab}
          onClose={() => setPage('library')}
          onProviderResolved={reconcileProviderSelection}
          onSave={saveSettings}
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
          <button className={page === id ? 'active' : ''} key={id} onClick={() => navigateToPage(id)} type="button">{label}</button>
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
