const termInput = document.querySelector('#term')
const explainButton = document.querySelector('#explain')
const addButton = document.querySelector('#add-to-library')
const clearButton = document.querySelector('#clear')
const queryView = document.querySelector('#query-view')
const resultView = document.querySelector('#result-view')
const queryStatus = document.querySelector('#query-status')
const resultStatus = document.querySelector('#result-status')
const backendStatus = document.querySelector('#backend-status')
const footer = document.querySelector('footer')
let selectionContext = { source: '手动输入', sourceUrl: '' }
let selectionText = ''
let currentPreview = null
let backendRetryTimer = null

function setStatus(element, message, type = '') {
  element.textContent = message
  element.className = `status${type ? ` ${type}` : ''}`
}

async function loadSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' })
    if (response?.text) {
      selectionText = response.text.slice(0, 120)
      termInput.value = selectionText
      selectionContext = {
        source: response.source || tab.title || '来自网页插件',
        sourceUrl: response.sourceUrl || tab.url || '',
      }
    }
  } catch {
    // Some browser pages do not allow content scripts; manual input still works.
  }
}

async function checkBackend() {
  window.clearTimeout(backendRetryTimer)
  try {
    const response = await fetch('http://127.0.0.1:8787/api/health?probe=1')
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error()
    if (data.ready) {
      footer.className = 'ready'
      backendStatus.textContent = '本机 DeepSeek 服务已就绪'
      return
    }
    if (data.providerStatus === 'insufficient_balance') {
      footer.className = 'recovering'
      backendStatus.textContent = '余额不足，充值到账后自动恢复'
    } else if (data.recoverable) {
      footer.className = 'recovering'
      backendStatus.textContent = 'DeepSeek 暂不可用，正在自动重连'
    } else {
      footer.className = 'error'
      backendStatus.textContent = data.configured ? data.statusMessage : '本机服务已启动，等待配置 Key'
    }
    if (data.recoverable) {
      const delay = Math.max(2_000, Math.min(30_000, Number(data.retryAfterMs || 5_000)))
      backendRetryTimer = window.setTimeout(checkBackend, delay)
    }
  } catch {
    footer.className = 'error'
    backendStatus.textContent = '本机服务未启动，请运行 npm run dev'
  }
}

function renderPreview(preview) {
  currentPreview = preview
  const item = preview.item || {}
  queryView.hidden = true
  resultView.hidden = false
  document.querySelector('#result-term').textContent = item.term || ''
  document.querySelector('#plain-explanation').textContent = item.explanation || '这个术语暂时还没有大白话解释。'
  document.querySelector('#analogy').textContent = item.analogy || '这个术语暂时还没有生活化类比。'
  const saved = preview.saved || preview.status === 'exists'
  addButton.disabled = saved
  addButton.textContent = saved ? '已在术语库' : '加入术语库'
  setStatus(resultStatus, saved ? '这个术语已经收录，可以在术语库里查看。' : '解释已生成，确认后才会收录。', saved ? 'success' : '')
}

async function showQueryView() {
  currentPreview = null
  queryView.hidden = false
  resultView.hidden = true
  termInput.value = ''
  selectionText = ''
  selectionContext = { source: '手动输入', sourceUrl: '' }
  setStatus(queryStatus, '')
  await loadSelection()
  termInput.focus()
}

explainButton.addEventListener('click', async () => {
  const term = termInput.value.trim()
  if (!term) {
    setStatus(queryStatus, '请先选中或输入一个术语。', 'error')
    termInput.focus()
    return
  }
  explainButton.disabled = true
  explainButton.textContent = '正在生成…'
  setStatus(queryStatus, 'DeepSeek 正在生成大白话解释和生活化类比，请稍候。')
  try {
    const metadata = term === selectionText
      ? selectionContext
      : { source: '手动输入', sourceUrl: '' }
    const result = await chrome.runtime.sendMessage({ type: 'EXPLAIN_TERM', term, ...metadata })
    if (!result?.ok) throw new Error(result?.error || '解释失败')
    const preview = {
      item: result.term,
      metadata,
      status: result.status,
      saved: result.status === 'exists',
      queriedAt: new Date().toISOString(),
    }
    await chrome.storage.local.set({ popupPreview: preview })
    renderPreview(preview)
  } catch (error) {
    setStatus(queryStatus, error.message, 'error')
    checkBackend()
  } finally {
    explainButton.disabled = false
    explainButton.textContent = '生成解释'
  }
})

addButton.addEventListener('click', async () => {
  if (!currentPreview?.item || currentPreview.saved) return
  addButton.disabled = true
  addButton.textContent = '正在添加…'
  setStatus(resultStatus, '')
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'SAVE_TERM',
      item: currentPreview.item,
      ...currentPreview.metadata,
    })
    if (!result?.ok) throw new Error(result?.error || '添加失败')
    currentPreview = {
      ...currentPreview,
      item: result.term || currentPreview.item,
      status: 'exists',
      saved: true,
    }
    await chrome.storage.local.set({ popupPreview: currentPreview })
    renderPreview(currentPreview)
  } catch (error) {
    addButton.disabled = false
    addButton.textContent = '重新添加'
    setStatus(resultStatus, error.message, 'error')
  }
})

clearButton.addEventListener('click', async () => {
  clearButton.disabled = true
  try {
    await chrome.storage.local.remove('popupPreview')
    await showQueryView()
  } finally {
    clearButton.disabled = false
  }
})

document.querySelector('#open-app').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://127.0.0.1:5173/' })
})

chrome.storage.local.get('popupPreview').then((stored) => {
  if (stored.popupPreview?.item?.term) renderPreview(stored.popupPreview)
  else showQueryView()
})
checkBackend()
