const MENU_ID = 'baihuaben-save-term'
const BACKEND_EXPLAIN_URL = 'http://127.0.0.1:8787/api/explain'
const DEFAULT_MODEL = 'deepseek-chat'
const SUPPORTED_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner'])
let storageQueue = Promise.resolve()

class BackendRequestError extends Error {
  constructor(message, code = 'request_failed', options = {}) {
    super(message)
    this.code = code
    this.recoverable = Boolean(options.recoverable)
    this.retryAfterMs = Number(options.retryAfterMs || 0)
  }
}

function withStorageLock(operation) {
  const pending = storageQueue.then(operation, operation)
  storageQueue = pending.catch(() => {})
  return pending
}

function normalizeSettings(settings = {}) {
  const storedModel = String(settings.model || '')
  const hoverExplanationMode = ['explanation', 'analogy', 'both'].includes(settings.hoverExplanationMode)
    ? settings.hoverExplanationMode
    : 'explanation'
  return {
    model: SUPPORTED_MODELS.has(storedModel) ? storedModel : DEFAULT_MODEL,
    autoExplain: settings.autoExplain !== false,
    hoverExplanationMode,
  }
}

async function migrateLegacySettings() {
  const stored = await chrome.storage.local.get('settings')
  const settings = stored.settings || {}
  const hasLegacySecret = ['apiKey', 'baseUrl', 'provider'].some((key) => Object.hasOwn(settings, key))
  if (hasLegacySecret) await chrome.storage.local.set({ settings: normalizeSettings(settings) })
}

function normalizeTerm(rawTerm) {
  const term = String(rawTerm || '').trim().replace(/\s+/g, ' ')
  if (!term) throw new Error('请先选中或输入一个术语')
  if (term.length > 120) throw new Error('选中的内容太长，请只保留术语本身')
  return term
}

function buildTerm(term, metadata = {}, generated = {}) {
  return {
    id: generated.id || crypto.randomUUID(),
    term,
    explanation: String(generated.explanation || ''),
    analogy: String(generated.analogy || ''),
    category: String(generated.category || '未分组'),
    source: metadata.source || generated.source || '来自网页插件',
    sourceUrl: metadata.sourceUrl || generated.sourceUrl || '',
    createdAt: generated.createdAt || new Date().toISOString(),
    reviewCount: Number(generated.reviewCount || 0),
    mastered: Boolean(generated.mastered),
    archived: Boolean(generated.archived),
    archivedAt: String(generated.archivedAt || ''),
    archivedCategory: generated.archived
      ? String(generated.archivedCategory || generated.category || '未分组')
      : '',
    status: generated.explanation ? 'ready' : 'pending',
  }
}

function mergeTermFields(primary, fallback = {}) {
  const explanation = String(primary.explanation || fallback.explanation || '')
  return {
    ...primary,
    explanation,
    analogy: String(primary.analogy || fallback.analogy || ''),
    category: String(primary.category || fallback.category || '未分组'),
    source: primary.sourceUrl ? primary.source : fallback.source || primary.source,
    sourceUrl: primary.sourceUrl || fallback.sourceUrl || '',
    archived: Boolean(primary.archived),
    archivedAt: String(primary.archivedAt || ''),
    archivedCategory: primary.archived
      ? String(primary.archivedCategory || primary.category || fallback.archivedCategory || '未分组')
      : '',
    status: explanation ? 'ready' : primary.status || fallback.status || 'pending',
  }
}

function mergeSyncedTerms(incomingTerms, storedTerms) {
  const storedById = new Map(storedTerms.map((item) => [item.id, item]))
  const storedByName = new Map()
  for (const stored of storedTerms) {
    const key = String(stored.term || '').trim().toLowerCase()
    if (!key) continue
    const existing = storedByName.get(key)
    storedByName.set(key, existing ? mergeTermFields(existing, stored) : stored)
  }
  const incomingByName = new Map()
  for (const incoming of incomingTerms) {
    const key = String(incoming?.term || '').trim().toLowerCase()
    if (!key) continue
    const existing = incomingByName.get(key)
    incomingByName.set(key, existing ? mergeTermFields(existing, incoming) : incoming)
  }

  return [...incomingByName.values()]
    .map((incoming) => {
      const stored = storedById.get(incoming.id) || storedByName.get(String(incoming.term).toLowerCase())
      return mergeTermFields(incoming, stored)
    })
}

async function requestExplanation(term, settings) {
  let response
  try {
    response = await fetch(BACKEND_EXPLAIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term, model: normalizeSettings(settings).model }),
    })
  } catch {
    throw new Error('无法连接加简大白话的本地服务，请检查常驻服务是否运行')
  }
  let data = {}
  try { data = await response.json() } catch { data = {} }
  if (!response.ok || data.ok === false) {
    throw new BackendRequestError(
      data.error || `本机后端请求失败（${response.status}）`,
      data.code,
      { recoverable: data.recoverable, retryAfterMs: data.retryAfterMs },
    )
  }
  if (!data.explanation) throw new Error('后端没有返回解释')
  return {
    explanation: String(data.explanation),
    analogy: String(data.analogy || ''),
    category: String(data.category || '未分组'),
  }
}

async function previewTerm(rawTerm, metadata = {}) {
  const term = normalizeTerm(rawTerm)
  const stored = await chrome.storage.local.get(['terms', 'settings'])
  const terms = Array.isArray(stored.terms) ? stored.terms : []
  const duplicate = terms.find((item) => String(item.term || '').toLowerCase() === term.toLowerCase())
  if (duplicate?.status === 'ready' && duplicate.explanation && duplicate.analogy) {
    return { status: 'exists', term: duplicate }
  }

  const generated = await requestExplanation(term, stored.settings || {})
  const preview = buildTerm(term, metadata, { ...duplicate, ...generated })
  if (!duplicate) return { status: 'preview', term: preview }

  await withStorageLock(async () => {
    const latest = await chrome.storage.local.get('terms')
    const latestTerms = Array.isArray(latest.terms) ? latest.terms : []
    await chrome.storage.local.set({
      terms: latestTerms.map((item) => item.id === duplicate.id ? { ...item, ...generated, status: 'ready' } : item),
    })
  })
  return { status: 'exists', term: { ...duplicate, ...generated, status: 'ready' } }
}

async function savePreparedTerm(rawItem, metadata = {}) {
  const term = normalizeTerm(rawItem?.term)
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get('terms')
    const terms = Array.isArray(stored.terms) ? stored.terms : []
    const duplicate = terms.find((item) => String(item.term || '').toLowerCase() === term.toLowerCase())
    if (duplicate) {
      const shouldAddExplanation = !duplicate.explanation && rawItem.explanation
      const shouldAddAnalogy = !duplicate.analogy && rawItem.analogy
      const shouldComplete = duplicate.status !== 'ready' && (duplicate.explanation || rawItem.explanation)
      const shouldAddSource = !duplicate.sourceUrl && metadata.sourceUrl
      const updated = shouldAddExplanation || shouldAddAnalogy || shouldComplete || shouldAddSource ? {
        ...duplicate,
        ...(shouldAddExplanation ? {
          explanation: String(rawItem.explanation),
        } : {}),
        ...(shouldAddAnalogy ? { analogy: String(rawItem.analogy) } : {}),
        ...(shouldComplete ? { status: 'ready' } : {}),
        ...(shouldAddSource ? { source: metadata.source, sourceUrl: metadata.sourceUrl } : {}),
      } : duplicate
      if (updated !== duplicate) {
        await chrome.storage.local.set({ terms: terms.map((item) => item.id === duplicate.id ? updated : item) })
      }
      return { status: 'exists', term: updated }
    }

    const item = buildTerm(term, metadata, { ...rawItem, category: '未分组' })
    await chrome.storage.local.set({ terms: [item, ...terms] })
    return { status: item.status === 'ready' ? 'saved' : 'pending', term: item }
  })
}

async function addTerm(rawTerm, metadata = {}) {
  const term = normalizeTerm(rawTerm)
  try {
    const preview = await previewTerm(term, metadata)
    if (preview.status === 'exists') return preview
    return savePreparedTerm(preview.term, metadata)
  } catch (error) {
    const result = await savePreparedTerm(buildTerm(term, metadata, { error: error.message }), metadata)
    return { ...result, status: 'pending', error: error.message }
  }
}

async function syncFromApp(incomingTerms, settings) {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get(['terms', 'settings'])
    const storedTerms = Array.isArray(stored.terms) ? stored.terms : []
    const updates = { terms: mergeSyncedTerms(incomingTerms, storedTerms) }
    if (settings) updates.settings = normalizeSettings(settings)
    await chrome.storage.local.set(updates)
    return updates.terms
  })
}

chrome.runtime.onInstalled.addListener(async () => {
  await migrateLegacySettings()
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '解释并加入个人术语库：“%s”',
    contexts: ['selection'],
  })

  const tabs = await chrome.tabs.query({})
  const webTabs = tabs.filter((tab) => tab.id && /^https?:/i.test(tab.url || ''))
  await Promise.allSettled(webTabs.flatMap((tab) => [
    chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] }),
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['term-data.js', 'content.js'] }),
  ]))
})

chrome.runtime.onStartup.addListener(() => {
  migrateLegacySettings().catch(() => {})
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return
  addTerm(info.selectionText, {
    source: tab?.title || '来自网页右键',
    sourceUrl: tab?.url || info.pageUrl || '',
  }).catch(() => {})
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let operation
  if (message?.type === 'EXPLAIN_TERM') {
    operation = previewTerm(message.term, { source: message.source, sourceUrl: message.sourceUrl })
  } else if (message?.type === 'SAVE_TERM') {
    operation = savePreparedTerm(message.item, { source: message.source, sourceUrl: message.sourceUrl })
  } else if (message?.type === 'ADD_TERM') {
    operation = addTerm(message.term, { source: message.source, sourceUrl: message.sourceUrl })
  } else if (message?.type === 'SYNC_TERMS' && Array.isArray(message.terms)) {
    operation = syncFromApp(message.terms)
  } else if (message?.type === 'SYNC_ALL' && Array.isArray(message.terms)) {
    operation = syncFromApp(message.terms, message.settings || {})
  } else {
    return false
  }

  operation
    .then((result) => sendResponse({ ok: true, ...(result || {}) }))
    .catch((error) => sendResponse({
      ok: false,
      error: error.message,
      code: error.code || 'request_failed',
      recoverable: Boolean(error.recoverable),
      retryAfterMs: Number(error.retryAfterMs || 0),
    }))
  return true
})
