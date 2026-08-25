(() => {
  if (window.__baihuabenContentLoaded) return
  window.__baihuabenContentLoaded = true

  const APP_HOSTS = new Set(['127.0.0.1', 'localhost'])
  const isAppPage = APP_HOSTS.has(location.hostname) && Boolean(document.querySelector('meta[name="termly-app"][content="true"]'))
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'])
  let terms = []
  let settings = { hoverExplanationMode: 'explanation' }
  let scanTimer = null
  let tooltip = null
  let selectionButton = null
  let selectedText = ''
  let selectedRect = null
  let previewCard = null
  let previewItem = null
  let previewStatus = ''

  function normalizeTerms(items) {
    return (Array.isArray(items) ? items : [])
      .filter((item) => item?.term)
      .map((item) => ({
        ...item,
        explanation: item.explanation || '已收录，等待生成大白话解释。',
        analogy: item.analogy || '已收录，等待生成生活化类比。',
      }))
      .sort((a, b) => b.term.length - a.term.length)
  }

  function normalizeSettings(value = {}) {
    return {
      hoverExplanationMode: ['explanation', 'analogy', 'both'].includes(value.hoverExplanationMode)
        ? value.hoverExplanationMode
        : 'explanation',
    }
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function isAsciiWord(value) {
    return /^[a-z0-9_. -]+$/i.test(value)
  }

  function hasValidBoundary(text, start, match) {
    if (!isAsciiWord(match)) return true
    const before = text[start - 1] || ''
    const after = text[start + match.length] || ''
    return !/[a-z0-9_]/i.test(before) && !/[a-z0-9_]/i.test(after)
  }

  function shouldSkip(node) {
    const parent = node.parentElement
    if (!parent || !node.nodeValue?.trim()) return true
    if (SKIP_TAGS.has(parent.tagName) || parent.isContentEditable) return true
    if (parent.closest('.baihuaben-highlight, #baihuaben-tooltip, #baihuaben-selection-button, #baihuaben-preview, [aria-hidden="true"]')) return true
    return false
  }

  function highlightTextNode(node, regex, byName) {
    if (shouldSkip(node)) return
    const text = node.nodeValue
    regex.lastIndex = 0
    let match = regex.exec(text)
    if (!match) return

    const fragment = document.createDocumentFragment()
    let cursor = 0
    let changed = false
    do {
      const value = match[0]
      if (!hasValidBoundary(text, match.index, value)) {
        match = regex.exec(text)
        continue
      }
      if (match.index > cursor) fragment.append(document.createTextNode(text.slice(cursor, match.index)))
      const item = byName.get(value.toLowerCase())
      const mark = document.createElement('span')
      mark.className = 'baihuaben-highlight'
      mark.dataset.baihuabenTerm = item.term
      mark.dataset.baihuabenExplanation = item.explanation
      mark.dataset.baihuabenAnalogy = item.analogy
      mark.textContent = value
      fragment.append(mark)
      cursor = match.index + value.length
      changed = true
      match = regex.exec(text)
    } while (match)

    if (!changed) return
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)))
    node.replaceWith(fragment)
  }

  function scan(root = document.body) {
    if (isAppPage || !root || !terms.length) return
    const byName = new Map(terms.map((item) => [item.term.toLowerCase(), item]))
    const regex = new RegExp(terms.map((item) => escapeRegExp(item.term)).join('|'), 'gi')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    for (const node of nodes) highlightTextNode(node, regex, byName)
  }

  function clearHighlights() {
    for (const mark of document.querySelectorAll('.baihuaben-highlight')) {
      mark.replaceWith(document.createTextNode(mark.textContent || ''))
    }
    document.body?.normalize()
  }

  function refresh(items) {
    terms = normalizeTerms(items)
    if (isAppPage) return
    clearHighlights()
    scan()
  }

  function ensureTooltip() {
    if (tooltip) return tooltip
    tooltip = document.createElement('div')
    tooltip.id = 'baihuaben-tooltip'
    document.documentElement.append(tooltip)
    return tooltip
  }

  function showTooltip(mark) {
    hidePreview()
    const element = ensureTooltip()
    const title = document.createElement('strong')
    title.textContent = mark.dataset.baihuabenTerm || ''
    const children = [title]
    const addSection = (label, value, missingText = '') => {
      const section = document.createElement('section')
      const sectionLabel = document.createElement('span')
      const body = document.createElement('p')
      sectionLabel.textContent = label
      body.textContent = value || missingText
      section.append(sectionLabel, body)
      children.push(section)
    }
    if (settings.hoverExplanationMode === 'explanation' || settings.hoverExplanationMode === 'both') {
      addSection('大白话解释', mark.dataset.baihuabenExplanation, '这个术语暂时还没有大白话解释。')
    }
    if (settings.hoverExplanationMode === 'analogy' || settings.hoverExplanationMode === 'both') {
      addSection('生活化类比', mark.dataset.baihuabenAnalogy, '这个术语暂时还没有生活化类比。')
    }
    element.replaceChildren(...children)
    element.style.display = 'block'
    const markRect = mark.getBoundingClientRect()
    const tipRect = element.getBoundingClientRect()
    const left = Math.max(12, Math.min(markRect.left, window.innerWidth - tipRect.width - 12))
    const below = markRect.bottom + 8
    const top = below + tipRect.height < window.innerHeight ? below : Math.max(12, markRect.top - tipRect.height - 8)
    element.style.left = `${left}px`
    element.style.top = `${top}px`
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none'
  }

  function hideSelectionButton() {
    if (selectionButton) selectionButton.style.display = 'none'
    selectedText = ''
    selectedRect = null
  }

  function hidePreview() {
    if (previewCard) previewCard.style.display = 'none'
    previewItem = null
    previewStatus = ''
  }

  function positionFloating(element, rect, gap = 9) {
    element.style.display = 'flex'
    const elementRect = element.getBoundingClientRect()
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - elementRect.width - 10))
    const below = rect.bottom + gap
    const top = below + elementRect.height < window.innerHeight
      ? below
      : Math.max(10, rect.top - elementRect.height - gap)
    element.style.left = `${left}px`
    element.style.top = `${top}px`
  }

  function ensurePreviewCard() {
    if (previewCard) return previewCard
    previewCard = document.createElement('section')
    previewCard.id = 'baihuaben-preview'
    previewCard.setAttribute('role', 'dialog')
    previewCard.setAttribute('aria-label', '术语大白话解释')
    previewCard.innerHTML = `
      <header>
        <span>术语解释</span>
        <button type="button" data-action="close" aria-label="关闭解释">×</button>
      </header>
      <strong data-field="term"></strong>
      <section class="baihuaben-preview-copy" data-kind="explanation">
        <span>大白话解释</span>
        <p data-field="explanation"></p>
      </section>
      <section class="baihuaben-preview-copy" data-kind="analogy">
        <span>生活化类比</span>
        <p data-field="analogy"></p>
      </section>
      <p data-field="status" aria-live="polite"></p>
      <div class="baihuaben-preview-actions">
        <button type="button" data-action="dismiss">先不添加</button>
        <button type="button" data-action="save">加入白话本</button>
      </div>
    `
    previewCard.addEventListener('click', async (event) => {
      const action = event.target.closest('button')?.dataset.action
      if (action === 'close' || action === 'dismiss') {
        hidePreview()
        return
      }
      if (action !== 'save' || !previewItem || previewStatus === 'exists') return

      const saveButton = previewCard.querySelector('[data-action="save"]')
      const status = previewCard.querySelector('[data-field="status"]')
      saveButton.disabled = true
      saveButton.textContent = '正在添加…'
      status.textContent = ''
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'SAVE_TERM',
          item: previewItem,
          source: document.title || location.hostname,
          sourceUrl: location.href,
        })
        if (!result?.ok) throw new Error(result?.error || '添加失败')
        previewStatus = 'exists'
        saveButton.textContent = result.status === 'exists' ? '已在白话本' : '已加入白话本 ✓'
        status.textContent = '以后在网页里遇到它，会自动显示黄色高亮。'
        window.setTimeout(hidePreview, 1400)
      } catch (error) {
        saveButton.disabled = false
        saveButton.textContent = '重新添加'
        status.textContent = error.message
      }
    })
    document.documentElement.append(previewCard)
    return previewCard
  }

  function showPreview(item, status, rect, error = '') {
    const card = ensurePreviewCard()
    previewItem = item
    previewStatus = status
    card.querySelector('[data-field="term"]').textContent = item.term || ''
    card.querySelector('[data-field="explanation"]').textContent = item.explanation || error
    const analogy = card.querySelector('[data-field="analogy"]')
    analogy.textContent = item.analogy || (error ? '' : '暂时没有生活化类比。')
    const statusLine = card.querySelector('[data-field="status"]')
    statusLine.textContent = error
    const dismissButton = card.querySelector('[data-action="dismiss"]')
    const saveButton = card.querySelector('[data-action="save"]')
    dismissButton.textContent = status === 'exists' ? '关闭' : '先不添加'
    saveButton.disabled = status === 'exists' || Boolean(error)
    saveButton.textContent = status === 'exists' ? '已在白话本' : error ? '暂时无法添加' : '加入白话本'
    positionFloating(card, rect, 10)
  }

  function ensureSelectionButton() {
    if (selectionButton) return selectionButton
    selectionButton = document.createElement('button')
    selectionButton.id = 'baihuaben-selection-button'
    selectionButton.type = 'button'
    selectionButton.textContent = '用大白话解释'
    selectionButton.addEventListener('pointerdown', (event) => event.preventDefault())
    selectionButton.addEventListener('click', async () => {
      if (!selectedText || !selectedRect) return
      const term = selectedText
      const rect = selectedRect
      selectionButton.disabled = true
      selectionButton.textContent = '正在解释…'
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'EXPLAIN_TERM',
          term,
          source: document.title || location.hostname,
          sourceUrl: location.href,
        })
        if (!result?.ok) throw new Error(result?.error || '解释失败')
        showPreview(result.term, result.status, rect)
      } catch (error) {
        showPreview({ term, explanation: '' }, 'error', rect, error.message)
      } finally {
        selectionButton.disabled = false
        selectionButton.textContent = '用大白话解释'
        hideSelectionButton()
      }
    })
    document.documentElement.append(selectionButton)
    return selectionButton
  }

  function showSelectionButton() {
    if (isAppPage) return
    const selection = window.getSelection()
    const value = selection?.toString().trim().replace(/\s+/g, ' ') || ''
    if (!selection || selection.isCollapsed || !value || value.length > 120 || selection.rangeCount === 0) {
      hideSelectionButton()
      return
    }
    const anchorElement = selection.anchorNode?.parentElement
    if (!anchorElement || SKIP_TAGS.has(anchorElement.tagName) || anchorElement.isContentEditable) {
      hideSelectionButton()
      return
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (!rect.width && !rect.height) {
      hideSelectionButton()
      return
    }
    if (selectedText !== value) hidePreview()
    selectedText = value
    selectedRect = {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    }
    positionFloating(ensureSelectionButton(), rect)
  }

  function scheduleSelectionButton() {
    window.setTimeout(showSelectionButton, 0)
  }

  document.addEventListener('mouseover', (event) => {
    const mark = event.target.closest?.('.baihuaben-highlight')
    if (mark) showTooltip(mark)
  }, true)
  document.addEventListener('mouseout', (event) => {
    if (event.target.closest?.('.baihuaben-highlight')) hideTooltip()
  }, true)

  if (!isAppPage) {
    document.addEventListener('mouseup', scheduleSelectionButton, true)
    document.addEventListener('keyup', scheduleSelectionButton, true)
    document.addEventListener('mousedown', (event) => {
      if (!event.target.closest?.('#baihuaben-selection-button, #baihuaben-preview')) hideSelectionButton()
    }, true)
    document.addEventListener('scroll', () => {
      hideSelectionButton()
      hidePreview()
    }, { capture: true, passive: true })
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GET_SELECTION') {
      sendResponse({
        text: window.getSelection()?.toString().trim() || '',
        source: document.title || location.hostname,
        sourceUrl: location.href,
      })
      return true
    }
    if (message?.type === 'HIGHLIGHT_NOW') {
      chrome.storage.local.get('terms').then((stored) => refresh(stored.terms))
      sendResponse({ ok: true })
      return true
    }
    return false
  })

  chrome.storage.local.get(['terms', 'settings']).then((stored) => {
    settings = normalizeSettings(stored.settings)
    refresh(stored.terms)
    if (isAppPage) {
      window.postMessage({
        source: 'baihuaben-extension',
        type: 'READY',
        terms: stored.terms || [],
      }, '*')
    }
  })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.settings) {
      settings = normalizeSettings(changes.settings.newValue)
      hideTooltip()
    }
    if (!changes.terms) return
    refresh(changes.terms.newValue)
    if (isAppPage) {
      window.postMessage({ source: 'baihuaben-extension', type: 'TERMS_CHANGED', terms: changes.terms.newValue || [] }, '*')
    }
  })

  if (!isAppPage) {
    const observer = new MutationObserver((mutations) => {
      const onlyExtensionNodes = mutations.every((mutation) => [...mutation.addedNodes].every((node) => (
        node.nodeType === Node.TEXT_NODE
        || node.classList?.contains('baihuaben-highlight')
        || node.id === 'baihuaben-selection-button'
        || node.id === 'baihuaben-tooltip'
        || node.id === 'baihuaben-preview'
      )))
      if (!terms.length || onlyExtensionNodes) return
      window.clearTimeout(scanTimer)
      scanTimer = window.setTimeout(() => scan(), 300)
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  if (isAppPage) {
    window.addEventListener('message', async (event) => {
      if (event.source !== window || event.data?.source !== 'baihuaben-web') return
      if (event.data.type === 'PING') {
        const stored = await chrome.storage.local.get('terms')
        window.postMessage({ source: 'baihuaben-extension', type: 'READY', terms: stored.terms || [] }, '*')
      }
      if (event.data.type === 'SYNC_TERMS' && Array.isArray(event.data.terms)) {
        await chrome.runtime.sendMessage({ type: 'SYNC_TERMS', terms: event.data.terms })
      }
      if (event.data.type === 'SYNC_ALL' && Array.isArray(event.data.terms)) {
        await chrome.runtime.sendMessage({
          type: 'SYNC_ALL',
          terms: event.data.terms,
          settings: event.data.settings || {},
        })
      }
    })
  }
})()
