const MENU_ID = 'baihuaben-save-term'
const BACKEND_EXPLAIN_URL = 'http://127.0.0.1:8787/api/explain'
const DEFAULT_MODELS = { deepseek: 'deepseek-chat', openai: 'gpt-4o-mini' }
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
  const provider = ['deepseek', 'openai'].includes(settings.provider) ? settings.provider : 'deepseek'
  const storedModel = String(settings.model || '').trim()
  const hoverExplanationMode = ['explanation', 'analogy', 'both'].includes(settings.hoverExplanationMode)
    ? settings.hoverExplanationMode
    : 'explanation'
  return {
    provider,
    model: storedModel || DEFAULT_MODELS[provider],
    autoExplain: settings.autoExplain !== false,
    hoverExplanationMode,
  }
}

async function migrateLegacySettings() {
  const stored = await chrome.storage.local.get('settings')
  const settings = stored.settings || {}
  const hasLegacySecret = ['apiKey', 'baseUrl'].some((key) => Object.hasOwn(settings, key))
  if (hasLegacySecret) await chrome.storage.local.set({ settings: normalizeSettings(settings) })
}

function normalizeTerm(rawTerm) {
  const term = String(rawTerm || '').trim().replace(/\s+/g, ' ')
  if (!term) throw new Error('请先选中或输入一个术语')
  if (term.length > 120) throw new Error('选中的内容太长，请只保留术语本身')
  return term
}

const TERM_FIELD_SCOPES = ['content', 'category', 'review', 'archive']

function validTimestamp(value, fallback = '') {
  const timestamp = String(value || '')
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : fallback
}

function latestTimestamp(...values) {
  return values
    .map((value) => validTimestamp(value))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || ''
}

function earliestTimestamp(...values) {
  return values
    .map((value) => validTimestamp(value))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || ''
}

function normalizeTermRecord(rawTerm = {}, options = {}) {
  const now = validTimestamp(options.now) || new Date().toISOString()
  const term = String(rawTerm.term || '').trim().replace(/\s+/g, ' ')
  const explanation = String(rawTerm.explanation || '')
  const archived = rawTerm.archived === true
  const createdAt = validTimestamp(rawTerm.createdAt, now)
  const baseUpdatedAt = validTimestamp(rawTerm.updatedAt, createdAt)
  const archivedAt = archived ? validTimestamp(rawTerm.archivedAt) : ''
  const lastReviewedAt = validTimestamp(rawTerm.lastReviewedAt)
  const fieldUpdatedAt = {
    content: validTimestamp(rawTerm.fieldUpdatedAt?.content, baseUpdatedAt),
    category: validTimestamp(rawTerm.fieldUpdatedAt?.category, baseUpdatedAt),
    review: validTimestamp(rawTerm.fieldUpdatedAt?.review, lastReviewedAt || baseUpdatedAt),
    archive: validTimestamp(rawTerm.fieldUpdatedAt?.archive, archivedAt || baseUpdatedAt),
  }
  const updatedAt = latestTimestamp(baseUpdatedAt, ...Object.values(fieldUpdatedAt)) || createdAt
  const category = String(rawTerm.category || '未分组').trim() || '未分组'
  return {
    ...rawTerm,
    id: String(rawTerm.id || options.id || ''),
    term,
    explanation,
    analogy: String(rawTerm.analogy || ''),
    category,
    source: String(rawTerm.source ?? options.source ?? '来自网页插件'),
    sourceUrl: String(rawTerm.sourceUrl || ''),
    createdAt,
    updatedAt,
    fieldUpdatedAt,
    reviewCount: Math.max(0, Number(rawTerm.reviewCount || 0)),
    mastered: Boolean(rawTerm.mastered),
    lastReviewedAt,
    archived,
    archivedAt,
    archivedCategory: archived
      ? String(rawTerm.archivedCategory || category).trim() || '未分组'
      : '',
    status: explanation ? 'ready' : 'pending',
  }
}

function touchTerm(term, changes, scopes, updatedAt = new Date().toISOString()) {
  const current = normalizeTermRecord(term, { now: updatedAt })
  const nextScopes = Array.isArray(scopes) ? scopes : [scopes]
  const fieldUpdatedAt = { ...current.fieldUpdatedAt }
  for (const scope of nextScopes) {
    if (TERM_FIELD_SCOPES.includes(scope)) fieldUpdatedAt[scope] = updatedAt
  }
  return normalizeTermRecord({ ...current, ...changes, updatedAt, fieldUpdatedAt }, { now: updatedAt })
}

function scopeSource(primary, fallback, scope) {
  const primaryTime = Date.parse(primary.fieldUpdatedAt[scope]) || 0
  const fallbackTime = Date.parse(fallback.fieldUpdatedAt[scope]) || 0
  if (scope === 'content' && fallbackTime === primaryTime) {
    const contentScore = (term) => ['term', 'explanation', 'analogy', 'source', 'sourceUrl']
      .filter((field) => String(term[field] || '').trim()).length
    if (contentScore(fallback) > contentScore(primary)) return fallback
  }
  return fallbackTime > primaryTime ? fallback : primary
}

function mergeTermRecords(primaryRecord, fallbackRecord) {
  const primary = normalizeTermRecord(primaryRecord, { now: primaryRecord?.createdAt })
  const fallback = normalizeTermRecord(fallbackRecord, { now: fallbackRecord?.createdAt })
  const content = scopeSource(primary, fallback, 'content')
  const category = scopeSource(primary, fallback, 'category')
  const review = scopeSource(primary, fallback, 'review')
  const archive = scopeSource(primary, fallback, 'archive')
  const fieldUpdatedAt = Object.fromEntries(TERM_FIELD_SCOPES.map((scope) => [
    scope,
    latestTimestamp(primary.fieldUpdatedAt[scope], fallback.fieldUpdatedAt[scope]),
  ]))
  return normalizeTermRecord({
    ...fallback,
    ...primary,
    id: primary.id || fallback.id,
    term: content.term,
    explanation: content.explanation,
    analogy: content.analogy,
    source: content.source,
    sourceUrl: content.sourceUrl,
    category: category.category,
    reviewCount: review.reviewCount,
    mastered: review.mastered,
    lastReviewedAt: review.lastReviewedAt,
    archived: archive.archived,
    archivedAt: archive.archivedAt,
    archivedCategory: archive.archivedCategory,
    createdAt: earliestTimestamp(primary.createdAt, fallback.createdAt),
    updatedAt: latestTimestamp(primary.updatedAt, fallback.updatedAt, ...Object.values(fieldUpdatedAt)),
    fieldUpdatedAt,
  }, { now: primary.createdAt || fallback.createdAt })
}

function buildTerm(term, metadata = {}, generated = {}) {
  const now = new Date().toISOString()
  return normalizeTermRecord({
    id: generated.id || crypto.randomUUID(),
    term,
    explanation: String(generated.explanation || ''),
    analogy: String(generated.analogy || ''),
    category: String(generated.category || '未分组'),
    source: metadata.source || generated.source || '来自网页插件',
    sourceUrl: metadata.sourceUrl || generated.sourceUrl || '',
    createdAt: generated.createdAt || now,
    updatedAt: generated.updatedAt || now,
    reviewCount: Number(generated.reviewCount || 0),
    mastered: Boolean(generated.mastered),
    archived: Boolean(generated.archived),
    archivedAt: String(generated.archivedAt || ''),
    archivedCategory: generated.archived
      ? String(generated.archivedCategory || generated.category || '未分组')
      : '',
  }, { now })
}

function mergeTermFields(primary, fallback = {}) {
  return mergeTermRecords(primary, fallback)
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
      body: JSON.stringify({
        term,
        provider: normalizeSettings(settings).provider,
        model: normalizeSettings(settings).model,
      }),
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
      terms: latestTerms.map((item) => item.id === duplicate.id
        ? touchTerm(item, generated, 'content')
        : item),
    })
  })
  return { status: 'exists', term: touchTerm(duplicate, generated, 'content') }
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
      const updated = shouldAddExplanation || shouldAddAnalogy || shouldComplete || shouldAddSource ? touchTerm(duplicate, {
        ...(shouldAddExplanation ? {
          explanation: String(rawItem.explanation),
        } : {}),
        ...(shouldAddAnalogy ? { analogy: String(rawItem.analogy) } : {}),
        ...(shouldAddSource ? { source: metadata.source, sourceUrl: metadata.sourceUrl } : {}),
      }, 'content') : duplicate
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

async function archiveTerm(id, rawTerm) {
  const termName = String(rawTerm || '').trim().toLowerCase()
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get('terms')
    const terms = Array.isArray(stored.terms) ? stored.terms : []
    const index = terms.findIndex((item) => (
      (id && item.id === id)
      || (termName && String(item.term || '').trim().toLowerCase() === termName)
    ))
    if (index < 0) throw new Error('术语库里找不到这个术语')

    const current = terms[index]
    if (current.archived === true) return { status: 'archived', term: current }
    const archivedAt = new Date().toISOString()
    const archived = touchTerm(current, {
      archived: true,
      archivedAt,
      archivedCategory: String(current.category || '未分组'),
    }, 'archive', archivedAt)
    const nextTerms = [...terms]
    nextTerms[index] = archived
    await chrome.storage.local.set({ terms: nextTerms })
    return { status: 'archived', term: archived }
  })
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
  } else if (message?.type === 'ARCHIVE_TERM') {
    operation = archiveTerm(message.id, message.term)
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
