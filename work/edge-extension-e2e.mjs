import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const port = Number(process.env.BAIHUABEN_EDGE_DEBUG_PORT || 9333)
const base = `http://127.0.0.1:${port}`
const artifactDir = process.env.BAIHUABEN_E2E_ARTIFACT_DIR || '/tmp'

class CdpClient {
  constructor(url) {
    this.url = url
    this.id = 0
    this.pending = new Map()
    this.events = []
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) {
        this.events.push(message)
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
      else pending.resolve(message.result)
    })
    return this
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket?.close()
  }
}

async function getJson(path) {
  const response = await fetch(`${base}${path}`)
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json()
}

async function waitFor(check, label, timeoutMs = 15000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  }
  return response.result.value
}

async function connectTarget(predicate, label) {
  const target = await waitFor(async () => {
    const targets = await getJson('/json/list')
    return targets.find(predicate)
  }, label)
  const client = await new CdpClient(target.webSocketDebuggerUrl).connect()
  await client.send('Runtime.enable')
  await client.send('Page.enable').catch(() => {})
  await client.send('Log.enable').catch(() => {})
  return { client, target }
}

async function createTarget(browser, url) {
  const result = await browser.send('Target.createTarget', { url })
  return result.targetId
}

async function capture(client, filename) {
  const result = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const path = `${artifactDir}/${filename}`
  await fs.writeFile(path, Buffer.from(result.data, 'base64'))
  return path
}

const version = await waitFor(() => getJson('/json/version'), 'Edge DevTools endpoint')
const backendModelData = await (await fetch('http://127.0.0.1:8787/api/models')).json()
const expectedModels = Array.isArray(backendModelData.models) ? backendModelData.models : []
const browser = await new CdpClient(version.webSocketDebuggerUrl).connect()
const clients = [browser]

try {
  const configuredExtensionId = process.env.BAIHUABEN_EXTENSION_ID
  const extensionId = configuredExtensionId || await waitFor(async () => {
    const targets = await getJson('/json/list')
    const serviceWorker = targets.find((target) => target.type === 'service_worker' && target.url.endsWith('/background.js'))
    return serviceWorker ? new URL(serviceWorker.url).hostname : ''
  }, '白话本 service worker')

  const storageTargetId = await createTarget(browser, `chrome-extension://${extensionId}/popup.html`)
  const { client: worker } = await connectTarget(
    (target) => target.id === storageTargetId,
    '白话本扩展存储页',
  )
  clients.push(worker)
  await evaluate(worker, `chrome.storage.local.clear()`)
  console.log('STEP extension worker ready and storage cleared')

  const { client: reader } = await connectTarget(
    (target) => target.type === 'page' && target.url.includes('127.0.0.1:5184/extension-test.html'),
    '扩展验收页',
  )
  clients.push(reader)
  await reader.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })

  await reader.send('Page.reload', { ignoreCache: true })

  await waitFor(
    () => evaluate(reader, `document.readyState === 'complete'`),
    '扩展验收页加载',
  )
  console.log('STEP reader page ready')

  const selectContextWindow = () => evaluate(reader, `(() => {
    const node = document.querySelector('#selection-target').firstChild
    const start = node.nodeValue.indexOf('Context window')
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + 'Context window'.length)
    const current = window.getSelection()
    current.removeAllRanges()
    current.addRange(range)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return current.toString()
  })()`)
  assert.equal(await selectContextWindow(), 'Context window')

  await waitFor(
    () => evaluate(reader, `document.querySelector('#baihuaben-selection-button')?.style.display === 'flex'`),
    '选词解释按钮',
  )
  await evaluate(reader, `document.querySelector('#baihuaben-selection-button').click()`)

  const dismissedPreview = await waitFor(
    () => evaluate(reader, `(() => {
      const card = document.querySelector('#baihuaben-preview')
      if (card?.style.display !== 'flex') return null
      const rect = card.getBoundingClientRect()
      return {
        text: card.innerText,
        analogy: card.querySelector('[data-field="analogy"]')?.textContent || '',
        explanation: card.querySelector('[data-field="explanation"]')?.textContent || '',
        insideViewport: rect.left >= 0 && rect.top >= 0
          && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
      }
    })()`),
    '大白话解释预览',
  )
  assert.match(dismissedPreview.text, /术语解释/)
  assert.ok(dismissedPreview.analogy.length >= 8)
  assert.ok(dismissedPreview.explanation.length >= 8)
  assert.equal(dismissedPreview.insideViewport, true)
  assert.equal(await evaluate(worker, `chrome.storage.local.get('terms').then(({ terms }) => (terms || []).length)`), 0)
  console.log('STEP first preview generated without saving')

  await evaluate(reader, `document.querySelector('#baihuaben-preview [data-action="dismiss"]').click()`)
  await waitFor(
    () => evaluate(reader, `document.querySelector('#baihuaben-preview')?.style.display === 'none'`),
    '先不添加关闭预览',
  )
  assert.equal(await evaluate(reader, `document.querySelectorAll('.baihuaben-highlight').length`), 0)
  assert.equal(await evaluate(worker, `chrome.storage.local.get('terms').then(({ terms }) => (terms || []).length)`), 0)

  assert.equal(await selectContextWindow(), 'Context window')
  await waitFor(
    () => evaluate(reader, `document.querySelector('#baihuaben-selection-button')?.style.display === 'flex'`),
    '再次显示选词解释按钮',
  )
  await evaluate(reader, `document.querySelector('#baihuaben-selection-button').click()`)
  const savedPreview = await waitFor(
    () => evaluate(reader, `(() => {
      const card = document.querySelector('#baihuaben-preview')
      const explanation = card?.querySelector('[data-field="explanation"]')?.textContent || ''
      const analogy = card?.querySelector('[data-field="analogy"]')?.textContent || ''
      return card?.style.display === 'flex' && explanation.length >= 8 && analogy.length >= 8
        ? { explanation, analogy }
        : null
    })()`),
    '再次生成解释预览',
  )
  const previewScreenshot = await capture(reader, 'baihuaben-edge-selection-preview.png')
  await evaluate(reader, `document.querySelector('#baihuaben-preview [data-action="save"]').click()`)

  await waitFor(
    () => evaluate(worker, `chrome.storage.local.get('terms').then(({ terms }) =>
      (terms || []).some((item) => item.term === 'Context window'
        && item.explanation === ${JSON.stringify(savedPreview.explanation)}
        && item.analogy === ${JSON.stringify(savedPreview.analogy)}))`),
    '确认加入白话本',
  )
  await waitFor(
    () => evaluate(reader, `[...document.querySelectorAll('.baihuaben-highlight')]
      .some((item) => item.textContent === 'Context window')`),
    '保存后显示黄色高亮',
  )
  console.log('STEP inline selection confirmed and highlighted')

  await evaluate(reader, `(() => {
    const mark = [...document.querySelectorAll('.baihuaben-highlight')]
      .find((item) => item.textContent === 'Context window')
    mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })()`)
  const tooltip = await waitFor(
    () => evaluate(reader, `(() => {
      const tip = document.querySelector('#baihuaben-tooltip')
      return tip?.style.display === 'block' ? tip.textContent : ''
    })()`),
    '高亮悬停解释',
  )
  assert.ok(tooltip.includes(savedPreview.explanation))
  assert.equal(tooltip.includes('生活化类比'), false)
  const readerScreenshot = await capture(reader, 'baihuaben-edge-selection-highlight.png')

  const appTargetId = await createTarget(browser, 'http://127.0.0.1:5173/')
  const { client: app } = await connectTarget(
    (target) => target.id === appTargetId,
    '白话本应用页',
  )
  clients.push(app)
  await app.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await evaluate(app, `(() => {
    localStorage.removeItem('baihuaben:terms:v1')
    localStorage.removeItem('baihuaben:settings:v1')
    location.reload()
    return true
  })()`)

  await waitFor(
    () => evaluate(app, `document.body?.innerText.includes('插件已连接')`),
    '网站识别扩展',
  )
  await waitFor(
    () => evaluate(app, `JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
      .some((item) => item.term === 'Context window')`),
    '扩展术语同步到网站',
  )
  console.log('STEP website connected and received extension terms')
  await waitFor(
    () => evaluate(reader, `[...document.querySelectorAll('.baihuaben-highlight')]
      .some((item) => item.textContent === 'RAG')`),
    '网站术语同步到扩展页面',
  )

  const addedFromWebsite = await evaluate(app, `(() => {
    const input = document.querySelector('input[placeholder*="粘贴一个刚遇到的术语"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'EdgeSmokeTerm')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return input.value
  })()`)
  assert.equal(addedFromWebsite, 'EdgeSmokeTerm')
  await evaluate(app, `document.querySelector('button[type="submit"]')?.click()`)
  await waitFor(
    () => evaluate(app, `JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
      .some((item) => item.term === 'EdgeSmokeTerm')`),
    '网站新增术语',
  )
  await waitFor(
    () => evaluate(reader, `[...document.querySelectorAll('.baihuaben-highlight')]
      .some((item) => item.textContent === 'EdgeSmokeTerm')`),
    '网站新增术语反向高亮',
  )

  await evaluate(app, `document.querySelector('button[aria-label="查看 EdgeSmokeTerm 详情"]').click()`)
  await waitFor(
    () => evaluate(app, `Boolean(document.querySelector('[role="dialog"] textarea[name="explanation"]'))`),
    '术语详情抽屉',
  )
  await evaluate(app, `(() => {
    const input = document.querySelector('[role="dialog"] textarea[name="explanation"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(input, '这是网站详情编辑后同步到扩展的测试解释。')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('[role="dialog"] button[type="submit"]').click()
  })()`)
  await waitFor(
    () => evaluate(app, `JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
      .some((item) => item.term === 'EdgeSmokeTerm'
        && item.explanation === '这是网站详情编辑后同步到扩展的测试解释。'
        && item.status === 'ready')`),
    '术语详情保存',
  )
  await waitFor(
    () => evaluate(reader, `(() => {
      const mark = [...document.querySelectorAll('.baihuaben-highlight')]
        .find((item) => item.textContent === 'EdgeSmokeTerm')
      if (!mark) return false
      mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      return document.querySelector('#baihuaben-tooltip')?.textContent
        .includes('这是网站详情编辑后同步到扩展的测试解释。')
    })()`),
    '详情编辑同步到悬停解释',
  )

  await evaluate(app, `(() => {
    const input = document.querySelector('input[placeholder="搜索术语或解释"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'EdgeSmokeTerm')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await waitFor(
    () => evaluate(app, `document.querySelectorAll('.term-row').length === 1
      && document.querySelector('.term-row .term-name')?.textContent === 'EdgeSmokeTerm'`),
    '术语搜索过滤',
  )
  await evaluate(app, `(() => {
    const input = document.querySelector('input[placeholder="搜索术语或解释"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)

  await evaluate(app, `[...document.querySelectorAll('button')]
    .find((button) => button.textContent.includes('自动整理分组')).click()`)
  await waitFor(
    () => evaluate(app, `document.body.innerText.includes('DeepSeek 已重新整理全部分组')`),
    'DeepSeek 自动分组',
  )

  const reviewTerm = await evaluate(app, `(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '快速复习').click()
    return true
  })()`)
  assert.equal(reviewTerm, true)
  const reviewedName = await waitFor(
    () => evaluate(app, `document.querySelector('.flashcard h1')?.textContent || ''`),
    '快速复习卡片',
  )
  await evaluate(app, `document.querySelector('.reveal-button').click()`)
  await waitFor(
    () => evaluate(app, `Boolean(document.querySelector('.flashcard-answer'))`),
    '复习答案显示',
  )
  await evaluate(app, `document.querySelector('.review-known').click()`)
  await waitFor(
    () => evaluate(app, `JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
      .some((item) => item.term === ${JSON.stringify(reviewedName)} && item.reviewCount > 0 && item.mastered)`),
    '复习结果保存',
  )
  await evaluate(app, `document.querySelector('.back-button').click()`)
  await waitFor(
    () => evaluate(app, `Boolean(document.querySelector('.library-page'))`),
    '返回术语库',
  )

  const settingsState = await evaluate(app, `(() => {
    [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '设置')?.click()
    return true
  })()`)
  assert.equal(settingsState, true)
  const settings = await waitFor(
    () => evaluate(app, `(() => {
      const select = document.querySelector('select')
      const modelStatus = document.querySelector('.model-status')?.textContent || ''
      if (!document.body.innerText.includes('本机 DeepSeek 服务')
        || !select || select.disabled || !modelStatus.includes('获取到')) return null
      return {
        options: [...select.options].map((option) => option.value),
        modelStatus,
        hoverLabels: [...document.querySelectorAll('.segmented-control button')].map((button) => button.textContent.trim()),
        activeHoverLabel: document.querySelector('.segmented-control button[aria-pressed="true"]')?.textContent.trim() || '',
        hasUrlInput: [...document.querySelectorAll('input')].some((input) => /url/i.test(input.name + input.placeholder)),
        hasProviderSelect: document.body.innerText.includes('OpenAI') || document.body.innerText.includes('Anthropic'),
      }
    })()`),
    'DeepSeek 设置页',
  )
  assert.ok(settings.options.length > 0)
  assert.ok(settings.options.every((model) => /^deepseek(?:-|$)/i.test(model)))
  assert.deepEqual([...settings.options].sort(), [...expectedModels].sort())
  assert.deepEqual(settings.hoverLabels, ['大白话解释', '生活化类比', '全部展示'])
  assert.equal(settings.activeHoverLabel, '大白话解释')
  assert.equal(settings.hasUrlInput, false)
  assert.equal(settings.hasProviderSelect, false)
  assert.equal(await evaluate(app, `[...document.querySelectorAll('input')]
    .some((input) => /key/i.test(input.name + input.placeholder))`), false)
  console.log('STEP settings page loaded')

  await evaluate(app, `(() => {
    [...document.querySelectorAll('.segmented-control button')]
      .find((button) => button.textContent.trim() === '生活化类比').click()
  })()`)
  await waitFor(
    () => evaluate(app, `document.querySelector('.segmented-control button[aria-pressed="true"]')
      ?.textContent.trim() === '生活化类比'`),
    '生活化类比选项选中',
  )
  await evaluate(app, `document.querySelector('.settings-form button[type="submit"]').click()`)
  await waitFor(
    () => evaluate(worker, `chrome.storage.local.get('settings').then(({ settings }) =>
      settings?.hoverExplanationMode === 'analogy')`),
    '生活化类比悬停设置同步到插件',
  )
  const analogyTooltip = await waitFor(
    () => evaluate(reader, `(() => {
      const mark = [...document.querySelectorAll('.baihuaben-highlight')]
        .find((item) => item.textContent === 'Context window')
      mark?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const tip = document.querySelector('#baihuaben-tooltip')
      return tip?.style.display === 'block' ? tip.textContent : ''
    })()`),
    '生活化类比悬停内容',
  )
  assert.ok(analogyTooltip.includes('生活化类比'))
  assert.ok(analogyTooltip.includes(savedPreview.analogy))
  assert.equal(analogyTooltip.includes('大白话解释'), false)

  await evaluate(app, `(() => {
    [...document.querySelectorAll('.segmented-control button')]
      .find((button) => button.textContent.trim() === '全部展示').click()
  })()`)
  await waitFor(
    () => evaluate(app, `document.querySelector('.segmented-control button[aria-pressed="true"]')
      ?.textContent.trim() === '全部展示'`),
    '全部展示选项选中',
  )
  await evaluate(app, `document.querySelector('.settings-form button[type="submit"]').click()`)
  await waitFor(
    () => evaluate(worker, `chrome.storage.local.get('settings').then(({ settings }) =>
      settings?.hoverExplanationMode === 'both')`),
    '全部展示悬停设置同步到插件',
  )
  const combinedTooltip = await waitFor(
    () => evaluate(reader, `(() => {
      const mark = [...document.querySelectorAll('.baihuaben-highlight')]
        .find((item) => item.textContent === 'Context window')
      mark?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const tip = document.querySelector('#baihuaben-tooltip')
      return tip?.style.display === 'block' ? tip.textContent : ''
    })()`),
    '全部展示悬停内容',
  )
  assert.ok(combinedTooltip.includes('大白话解释'))
  assert.ok(combinedTooltip.includes('生活化类比'))
  const hoverModesScreenshot = await capture(reader, 'baihuaben-edge-hover-both.png')
  console.log('STEP hover explanation modes synchronized and rendered')
  const appScreenshot = await capture(app, 'baihuaben-edge-app-connected.png')

  await evaluate(worker, `chrome.storage.local.remove('popupPreview')`)
  const popupTargetId = await createTarget(browser, `chrome-extension://${extensionId}/popup.html`)
  const { client: popup } = await connectTarget(
    (target) => target.id === popupTargetId,
    '扩展弹窗',
  )
  clients.push(popup)
  await popup.send('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 620,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const popupState = await waitFor(
    () => evaluate(popup, `(() => {
      const input = document.querySelector('#term')
      const button = document.querySelector('#explain')
      return input && button ? { title: document.title, buttonText: button.textContent.trim() } : null
    })()`),
    '扩展弹窗控件',
  )
  assert.equal(popupState.title, '白话本')
  assert.equal(popupState.buttonText, '生成解释')
  const popupBackend = await waitFor(
    () => evaluate(popup, `(() => {
      const text = document.querySelector('#backend-status')?.textContent || ''
      return text.includes('正在检查') ? '' : text
    })()`),
    '扩展弹窗后端状态',
  )
  assert.match(popupBackend, /已就绪/)
  console.log('STEP popup query view ready')

  await evaluate(popup, `(() => {
    const input = document.querySelector('#term')
    input.value = 'PopupSmokeTerm'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#explain').click()
  })()`)
  await waitFor(
    () => evaluate(popup, `chrome.storage.local.get(['terms', 'popupPreview']).then(({ terms, popupPreview }) =>
      popupPreview?.item?.term === 'PopupSmokeTerm'
        && popupPreview.item.analogy
        && !(terms || []).some((item) => item.term === 'PopupSmokeTerm'))`),
    '扩展弹窗只生成解释不收录',
  )
  await popup.send('Page.reload', { ignoreCache: true })
  await waitFor(
    () => evaluate(popup, `document.querySelector('#result-view:not([hidden]) #result-term')?.textContent === 'PopupSmokeTerm'`),
    '扩展弹窗重开后保留最新查询',
  )
  assert.equal(await evaluate(popup, `document.querySelector('#query-view').hidden`), true)
  const popupScreenshot = await capture(popup, 'baihuaben-edge-popup-preview.png')
  await evaluate(popup, `document.querySelector('#add-to-library').click()`)
  await waitFor(
    () => evaluate(popup, `chrome.storage.local.get(['terms', 'popupPreview']).then(({ terms, popupPreview }) =>
      (terms || []).some((item) => item.term === 'PopupSmokeTerm' && item.analogy)
        && popupPreview?.saved === true)`),
    '扩展弹窗确认收录',
  )
  await evaluate(popup, `document.querySelector('#clear').click()`)
  await waitFor(
    () => evaluate(popup, `chrome.storage.local.get('popupPreview').then(({ popupPreview }) =>
      popupPreview === undefined && document.querySelector('#query-view:not([hidden])'))`),
    '扩展弹窗清空后允许新查询',
  )
  console.log('STEP popup preview persistence, save, and clear passed')

  const pageErrors = await Promise.all([
    evaluate(reader, `performance.getEntriesByType('resource').filter((entry) => entry.name.includes('chrome-error')).length`),
    evaluate(app, `document.querySelectorAll('vite-error-overlay').length`),
    evaluate(popup, `Boolean(document.querySelector('.status.error'))`),
  ])
  assert.deepEqual(pageErrors, [0, 0, false])
  const runtimeErrors = clients.flatMap((client) => client.events).filter((event) => (
    event.method === 'Runtime.exceptionThrown'
      || (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params?.entry?.level))
  ))
  assert.deepEqual(runtimeErrors, [])

  console.log(JSON.stringify({
    browser: version.Browser,
    extensionId,
    checks: {
      contentScriptInjected: true,
      inlineSelectionButton: true,
      previewBeforeSave: true,
      dismissWithoutSave: true,
      confirmedSaveAndHighlight: true,
      hoverTooltip: true,
      extensionToWebsiteSync: true,
      websiteToExtensionSync: true,
      websiteSearch: true,
      websiteTermEditing: true,
      websiteGrouping: true,
      websiteReview: true,
      popupPreviewPersistsBeforeSave: true,
      popupConfirmSaveAndClear: true,
      hoverExplanationModes: true,
      deepSeekOnlySettings: true,
    },
    screenshots: [previewScreenshot, readerScreenshot, hoverModesScreenshot, appScreenshot, popupScreenshot],
  }, null, 2))
} finally {
  for (const client of clients.reverse()) client.close()
}
