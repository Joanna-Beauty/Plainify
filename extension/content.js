(() => {
  const extensionInstanceId = chrome.runtime.id
  const ownerAttribute = 'data-baihuaben-extension-owner'
  const existingOwner = document.documentElement.getAttribute(ownerAttribute)
  if (existingOwner && existingOwner !== extensionInstanceId) return
  document.documentElement.setAttribute(ownerAttribute, extensionInstanceId)

  if (window.__baihuabenContentLoaded) return
  window.__baihuabenContentLoaded = true

  const APP_HOSTS = new Set(['127.0.0.1', 'localhost'])
  const PROVIDER_NAMES = {
    deepseek: 'DeepSeek',
    openai: 'OpenAI',
    qwen: '阿里云百炼',
    moonshot: 'Moonshot AI',
    zhipu: '智谱 AI',
  }
  const DEFAULT_MODELS = {
    deepseek: 'deepseek-chat',
    openai: 'gpt-4o-mini',
    qwen: 'qwen-plus',
    moonshot: 'kimi-k3',
    zhipu: 'glm-5.3-flash',
  }
  const isAppPage = APP_HOSTS.has(location.hostname) && Boolean(document.querySelector('meta[name="termly-app"][content="true"]'))
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'])
  let terms = []
  let settings = {
    provider: 'deepseek',
    providerName: 'DeepSeek',
    model: DEFAULT_MODELS.deepseek,
    hoverExplanationMode: 'both',
  }
  let scanTimer = null
  let tooltip = null
  let pinnedTooltip = null
  let selectionButton = null
  let selectedText = ''
  let selectedRect = null
  let previewCard = null
  let previewItem = null
  let previewStatus = ''
  let previewRequestId = 0
  let scrollFrame = 0

  function keepSingleUiElement(selector, current) {
    if (!current) return
    for (const element of document.querySelectorAll(selector)) {
      if (element !== current) element.remove()
    }
    if (!current.isConnected) document.documentElement.append(current)
  }

  function removeDuplicateUi() {
    keepSingleUiElement('#baihuaben-tooltip', tooltip)
    keepSingleUiElement('#baihuaben-selection-button', selectionButton)
    keepSingleUiElement('#baihuaben-preview', previewCard)
  }

  function normalizeTerms(items) {
    return globalThis.BaihuabenTermData.normalizeHighlightTerms(items)
  }

  function normalizeSettings(value = {}) {
    const model = String(value.model || '').trim()
    const inferredProvider = /^(?:gpt-|chatgpt-|o\d(?:-|$))/i.test(model)
      ? 'openai'
      : /^qwen/i.test(model)
        ? 'qwen'
        : /^(?:kimi-|moonshot-)/i.test(model)
          ? 'moonshot'
          : /^glm-/i.test(model)
            ? 'zhipu'
            : 'deepseek'
    const provider = Object.hasOwn(PROVIDER_NAMES, value.provider) ? value.provider : inferredProvider
    return {
      provider,
      providerName: PROVIDER_NAMES[provider],
      model: model || DEFAULT_MODELS[provider],
      hoverExplanationMode: ['explanation', 'analogy', 'both'].includes(value.hoverExplanationMode)
        ? value.hoverExplanationMode
        : 'both',
    }
  }

  function formatModelLabel(value = settings) {
    const providerName = String(value.providerName || PROVIDER_NAMES[value.provider] || '模型')
    const model = String(value.model || DEFAULT_MODELS[value.provider] || '').trim()
    return model ? `${providerName} · ${model}` : providerName
  }

  function refreshDisplayedModelHints() {
    const hint = tooltip?.querySelector('.baihuaben-model-hint')
    if (hint) hint.textContent = `当前模型：${formatModelLabel()}`
    if (previewStatus === 'loading') {
      const status = previewCard?.querySelector('[data-field="status"]')
      if (status) status.textContent = `${formatModelLabel()} 正在生成，通常需要几秒。`
    }
  }

  async function refreshActiveModel() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_MODEL' })
      if (!result?.ok || !result.modelInfo) return
      settings = {
        ...settings,
        provider: result.modelInfo.provider || settings.provider,
        providerName: result.modelInfo.providerName || settings.providerName,
        model: result.modelInfo.model || settings.model,
      }
      refreshDisplayedModelHints()
    } catch {
      // The stored settings remain a usable fallback while the local service is unavailable.
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
      mark.dataset.baihuabenId = item.id || ''
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
    if (pinnedTooltip) {
      const pinnedStillExists = terms.some((item) => (
        (pinnedTooltip.id && item.id === pinnedTooltip.id)
        || item.term.toLowerCase() === pinnedTooltip.term.toLowerCase()
      ))
      if (!pinnedStillExists) hideTooltip(true)
    }
    clearHighlights()
    scan()
  }

  function ensureTooltip() {
    if (!tooltip) {
      tooltip = document.createElement('div')
      tooltip.id = 'baihuaben-tooltip'
      tooltip.addEventListener('click', async (event) => {
        const button = event.target.closest('button')
        const action = button?.dataset.action
        if (action === 'close') {
          hideTooltip(true)
          return
        }
        if (action !== 'archive' || !pinnedTooltip) return

        const status = tooltip.querySelector('[data-field="status"]')
        button.disabled = true
        button.textContent = '正在归档…'
        status.textContent = ''
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'ARCHIVE_TERM',
            id: pinnedTooltip.id,
            term: pinnedTooltip.term,
          })
          if (!result?.ok) throw new Error(result?.error || '归档失败')
          hideTooltip(true)
        } catch (error) {
          button.disabled = false
          button.textContent = '归档术语'
          status.textContent = error.message
        }
      })
    }
    keepSingleUiElement('#baihuaben-tooltip', tooltip)
    return tooltip
  }

  function showTooltip(mark, pinned = false) {
    if (previewCard?.style.display === 'flex') return
    if (pinnedTooltip && !pinned) return
    const element = ensureTooltip()
    const title = document.createElement('strong')
    title.textContent = mark.dataset.baihuabenTerm || ''
    const content = document.createElement('div')
    content.className = 'baihuaben-tooltip-content'
    const children = []
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
    content.append(...children)
    const modelHint = document.createElement('small')
    modelHint.className = 'baihuaben-model-hint'
    modelHint.textContent = `当前模型：${formatModelLabel()}`
    if (pinned) {
      const header = document.createElement('header')
      const closeButton = document.createElement('button')
      closeButton.type = 'button'
      closeButton.dataset.action = 'close'
      closeButton.setAttribute('aria-label', '关闭解释栏')
      closeButton.title = '关闭解释栏'
      closeButton.textContent = '×'
      header.append(title, closeButton)

      const footer = document.createElement('footer')
      const status = document.createElement('p')
      const archiveButton = document.createElement('button')
      status.dataset.field = 'status'
      status.setAttribute('aria-live', 'polite')
      archiveButton.type = 'button'
      archiveButton.dataset.action = 'archive'
      archiveButton.title = '归档术语'
      archiveButton.textContent = '归档术语'
      footer.append(status, archiveButton)
      element.replaceChildren(header, content, modelHint, footer)
      pinnedTooltip = {
        id: mark.dataset.baihuabenId || '',
        term: mark.dataset.baihuabenTerm || '',
      }
    } else {
      element.replaceChildren(title, content, modelHint)
    }
    element.dataset.pinned = String(pinned)
    element.setAttribute('role', pinned ? 'dialog' : 'tooltip')
    element.setAttribute('aria-label', pinned ? `${title.textContent}的解释` : '')
    element.style.setProperty('display', 'block', 'important')
    const markRect = mark.getBoundingClientRect()
    const tipRect = element.getBoundingClientRect()
    const left = Math.max(12, Math.min(markRect.left, window.innerWidth - tipRect.width - 12))
    const below = markRect.bottom + 8
    const top = below + tipRect.height < window.innerHeight ? below : Math.max(12, markRect.top - tipRect.height - 8)
    element.style.left = `${left}px`
    element.style.top = `${top}px`
  }

  function hideTooltip(force = false) {
    if (pinnedTooltip && !force) return
    if (tooltip) tooltip.style.setProperty('display', 'none', 'important')
    if (force) {
      pinnedTooltip = null
      if (tooltip) tooltip.dataset.pinned = 'false'
    }
  }

  function hideSelectionButton() {
    if (selectionButton) selectionButton.style.setProperty('display', 'none', 'important')
    selectedText = ''
    selectedRect = null
  }

  function hidePreview() {
    if (previewCard) previewCard.style.setProperty('display', 'none', 'important')
    previewItem = null
    previewStatus = ''
    previewRequestId += 1
  }

  function positionFloating(element, rect, gap = 9) {
    element.style.setProperty('display', 'flex', 'important')
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
    if (previewCard) {
      keepSingleUiElement('#baihuaben-preview', previewCard)
      return previewCard
    }
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
        <button type="button" data-action="save">加入术语库</button>
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
        saveButton.textContent = result.status === 'exists' ? '已在术语库' : '已加入术语库 ✓'
        status.textContent = '以后在网页里遇到它，会自动显示黄色高亮。'
        window.setTimeout(hidePreview, 1400)
      } catch (error) {
        saveButton.disabled = false
        saveButton.textContent = '重新添加'
        status.textContent = error.message
      }
    })
    keepSingleUiElement('#baihuaben-preview', previewCard)
    return previewCard
  }

  function showPreview(item, status, rect, error = '', modelInfo = settings) {
    const card = ensurePreviewCard()
    const isLoading = status === 'loading'
    const hasError = status === 'error' || Boolean(error)
    previewItem = isLoading || hasError ? null : item
    previewStatus = status
    card.dataset.state = status
    card.setAttribute('aria-busy', String(isLoading))
    card.querySelector('[data-field="term"]').textContent = item.term || ''
    card.querySelector('[data-field="explanation"]').textContent = isLoading
      ? '正在生成大白话解释…'
      : item.explanation || (hasError ? '这次没有生成成功。' : '暂时没有大白话解释。')
    const analogy = card.querySelector('[data-field="analogy"]')
    analogy.textContent = isLoading
      ? '正在生成生活化类比…'
      : item.analogy || (hasError ? '这次没有生成成功。' : '暂时没有生活化类比。')
    const statusLine = card.querySelector('[data-field="status"]')
    statusLine.textContent = isLoading
      ? `${formatModelLabel(modelInfo)} 正在生成，通常需要几秒。`
      : error || (status === 'exists' ? '这个术语已在术语库。' : `由 ${formatModelLabel(modelInfo)} 生成。`)
    const dismissButton = card.querySelector('[data-action="dismiss"]')
    const saveButton = card.querySelector('[data-action="save"]')
    dismissButton.textContent = status === 'exists' || isLoading ? '关闭' : '先不添加'
    saveButton.disabled = status === 'exists' || isLoading || hasError
    saveButton.textContent = status === 'exists'
      ? '已在术语库'
      : isLoading
        ? '解释生成后可添加'
        : hasError
          ? '暂时无法添加'
          : '加入术语库'
    positionFloating(card, rect, 10)
  }

  function ensureSelectionButton() {
    if (selectionButton) {
      keepSingleUiElement('#baihuaben-selection-button', selectionButton)
      return selectionButton
    }
    selectionButton = document.createElement('button')
    selectionButton.id = 'baihuaben-selection-button'
    selectionButton.type = 'button'
    selectionButton.textContent = '用大白话解释'
    selectionButton.addEventListener('pointerdown', (event) => event.preventDefault())
    selectionButton.addEventListener('click', async () => {
      if (!selectedText || !selectedRect) return
      const term = selectedText
      const rect = selectedRect
      const requestId = ++previewRequestId
      selectionButton.disabled = true
      selectionButton.textContent = '正在解释…'
      showPreview({ term, explanation: '', analogy: '' }, 'loading', rect)
      hideSelectionButton()
      try {
        const modelInfoPromise = chrome.runtime.sendMessage({ type: 'GET_ACTIVE_MODEL' })
        const explanationPromise = chrome.runtime.sendMessage({
          type: 'EXPLAIN_TERM',
          term,
          source: document.title || location.hostname,
          sourceUrl: location.href,
        })
        const modelResult = await modelInfoPromise.catch(() => null)
        if (requestId !== previewRequestId) return
        if (modelResult?.ok && modelResult.modelInfo) {
          showPreview({ term, explanation: '', analogy: '' }, 'loading', rect, '', modelResult.modelInfo)
        }
        const result = await explanationPromise
        if (requestId !== previewRequestId) return
        if (!result?.ok) throw new Error(result?.error || '解释失败')
        showPreview(result.term, result.status, rect, '', result.modelInfo || settings)
      } catch (error) {
        if (requestId !== previewRequestId) return
        showPreview({ term, explanation: '' }, 'error', rect, error.message)
      } finally {
        selectionButton.disabled = false
        selectionButton.textContent = '用大白话解释'
      }
    })
    keepSingleUiElement('#baihuaben-selection-button', selectionButton)
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

  function scheduleSelectionButton(event) {
    if (event?.target.closest?.('#baihuaben-selection-button, #baihuaben-preview')) return
    window.setTimeout(showSelectionButton, 0)
  }

  function repositionSelectionButton() {
    hideTooltip()
    if (!selectionButton || selectionButton.style.display !== 'flex' || !selectedText) return
    window.cancelAnimationFrame(scrollFrame)
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0
      const selection = window.getSelection()
      const value = selection?.toString().trim().replace(/\s+/g, ' ') || ''
      if (!selection || selection.rangeCount === 0 || value !== selectedText) return
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      if ((!rect.width && !rect.height) || rect.bottom < 0 || rect.top > window.innerHeight) return
      selectedRect = {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }
      positionFloating(selectionButton, rect)
    })
  }

  document.addEventListener('mouseover', (event) => {
    const mark = event.target.closest?.('.baihuaben-highlight')
    if (mark) showTooltip(mark)
  }, true)
  document.addEventListener('mouseout', (event) => {
    if (event.target.closest?.('.baihuaben-highlight')) hideTooltip()
  }, true)
  document.addEventListener('click', (event) => {
    const mark = event.target.closest?.('.baihuaben-highlight')
    if (mark) showTooltip(mark, true)
  }, true)

  if (!isAppPage) {
    document.addEventListener('mouseup', scheduleSelectionButton, true)
    document.addEventListener('keyup', scheduleSelectionButton, true)
    document.addEventListener('mousedown', (event) => {
      if (!event.target.closest?.('#baihuaben-selection-button, #baihuaben-preview')) hideSelectionButton()
    }, true)
    document.addEventListener('scroll', repositionSelectionButton, { capture: true, passive: true })
    window.addEventListener('resize', repositionSelectionButton, { passive: true })
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
    if (!isAppPage) refreshActiveModel()
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
      refreshDisplayedModelHints()
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
      removeDuplicateUi()
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
