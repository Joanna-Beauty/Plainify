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
  await client.send('Page.bringToFront').catch(() => {})
  let timeout
  const result = await Promise.race([
    client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out capturing ${filename}`)), 15000)
    }),
  ]).finally(() => clearTimeout(timeout))
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
  }, '加简大白话 service worker')

  const storageTargetId = await createTarget(browser, `chrome-extension://${extensionId}/popup.html`)
  const { client: worker } = await connectTarget(
    (target) => target.id === storageTargetId,
    '加简大白话扩展存储页',
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
  await evaluate(reader, `(() => {
    const hostileStyle = document.createElement('style')
    hostileStyle.textContent = '#baihuaben-selection-button:hover { display: none !important; }'
    document.head.append(hostileStyle)
    const duplicate = document.createElement('button')
    duplicate.id = 'baihuaben-selection-button'
    duplicate.textContent = '重复按钮'
    document.documentElement.append(duplicate)
    const log = document.querySelector('#dynamic-log')
    window.__baihuabenScrollPulse = window.setInterval(() => {
      log.scrollTop = log.scrollTop === 0 ? 1 : 0
    }, 180)
  })()`)
  await waitFor(
    () => evaluate(reader, `document.querySelectorAll('#baihuaben-selection-button').length === 1`),
    '清理重复选词按钮',
  )
  const selectionButtonRect = await evaluate(reader, `(() => {
    const rect = document.querySelector('#baihuaben-selection-button').getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })()`)
  const selectionButtonPoint = {
    x: selectionButtonRect.x + selectionButtonRect.width / 2,
    y: selectionButtonRect.y + selectionButtonRect.height / 2,
  }
  await reader.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...selectionButtonPoint })
  await waitFor(
    () => evaluate(reader, `getComputedStyle(document.querySelector('#baihuaben-selection-button')).display === 'flex'`),
    '鼠标悬停时选词按钮保持显示',
  )
  await new Promise((resolve) => setTimeout(resolve, 2500))
  assert.equal(
    await evaluate(reader, `getComputedStyle(document.querySelector('#baihuaben-selection-button')).display`),
    'flex',
  )
  console.log('STEP selection button survived continuous background scrolling')
  await reader.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    ...selectionButtonPoint,
  })
  await reader.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    ...selectionButtonPoint,
  })
  const loadingPreview = await waitFor(
    () => evaluate(reader, `(() => {
      const card = document.querySelector('#baihuaben-preview')
      return card?.dataset.state === 'loading' ? {
        busy: card?.getAttribute('aria-busy'),
        state: card?.dataset.state,
        text: card?.innerText || '',
        saveDisabled: card?.querySelector('[data-action="save"]')?.disabled,
      } : null
    })()`),
    '真实鼠标点击后的加载反馈',
  )
  assert.equal(loadingPreview.busy, 'true')
  assert.equal(loadingPreview.state, 'loading')
  assert.match(loadingPreview.text, /正在生成大白话解释/)
  assert.match(loadingPreview.text, /正在生成生活化类比/)
  assert.equal(loadingPreview.saveDisabled, true)
  console.log('STEP loading feedback rendered immediately')

  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(
    await evaluate(reader, `getComputedStyle(document.querySelector('#baihuaben-preview')).display`),
    'flex',
  )
  console.log('STEP explanation preview survived continuous background scrolling')

  const dismissedPreview = await waitFor(
    () => evaluate(reader, `(() => {
      const card = document.querySelector('#baihuaben-preview')
      if (card?.style.display !== 'flex' || card.dataset.state === 'loading') return null
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
  assert.equal(dismissedPreview.text.includes('专业解释'), false)
  assert.equal(dismissedPreview.text.includes('通俗解释'), false)
  assert.equal(dismissedPreview.insideViewport, true)
  assert.equal(await evaluate(worker, `chrome.storage.local.get('terms').then(({ terms }) => (terms || []).length)`), 0)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(
    await evaluate(reader, `getComputedStyle(document.querySelector('#baihuaben-preview')).display`),
    'flex',
  )
  await evaluate(reader, `window.clearInterval(window.__baihuabenScrollPulse)`)
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
      return card?.style.display === 'flex'
        && card.dataset.state !== 'loading'
        && explanation.length >= 8
        && analogy.length >= 8
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
    '确认加入术语库',
  )
  await waitFor(
    () => evaluate(reader, `[...document.querySelectorAll('.baihuaben-highlight')]
      .some((item) => item.textContent === 'Context window')`),
    '保存后显示黄色高亮',
  )
  await waitFor(
    () => evaluate(reader, `document.querySelector('#baihuaben-preview')?.style.display === 'none'`),
    '保存提示关闭后检查悬停解释',
  )
  const duplicateHighlights = await evaluate(reader, `(() => {
    const marks = [...document.querySelectorAll('.baihuaben-highlight')]
      .filter((item) => item.textContent === 'Context window')
    return {
      count: marks.length,
      analogies: marks.map((item) => item.dataset.baihuabenAnalogy),
    }
  })()`)
  assert.equal(duplicateHighlights.count, 2)
  assert.deepEqual(duplicateHighlights.analogies, [savedPreview.analogy, savedPreview.analogy])
  console.log('STEP inline selection confirmed and highlighted')

  const highlightRect = await evaluate(reader, `(() => {
    const mark = [...document.querySelectorAll('.baihuaben-highlight')]
      .find((item) => item.textContent === 'Context window')
    const rect = mark.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })()`)
  await reader.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: highlightRect.x + highlightRect.width / 2,
    y: highlightRect.y + highlightRect.height / 2,
  })
  const highlightHoverState = await waitFor(
    () => evaluate(reader, `(() => {
      const mark = [...document.querySelectorAll('.baihuaben-highlight')]
        .find((item) => item.textContent === 'Context window')
      const icon = getComputedStyle(mark, '::after').content
      return icon.includes('💡') ? {
        icon,
        cursor: getComputedStyle(mark).cursor,
        tooltipPinned: document.querySelector('#baihuaben-tooltip')?.dataset.pinned,
      } : null
    })()`),
    '黄色高亮悬停灯泡',
  )
  assert.equal(highlightHoverState.cursor, 'pointer')
  assert.equal(highlightHoverState.icon.includes('?'), false)
  assert.equal(highlightHoverState.tooltipPinned, 'false')

  await evaluate(reader, `(() => {
    const mark = [...document.querySelectorAll('.baihuaben-highlight')]
      .find((item) => item.textContent === 'Context window')
    mark.click()
    mark.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  })()`)
  const pinnedTooltip = await waitFor(
    () => evaluate(reader, `(() => {
      const tip = document.querySelector('#baihuaben-tooltip')
      if (tip?.style.display !== 'block' || tip.dataset.pinned !== 'true') return null
      return {
        role: tip.getAttribute('role'),
        text: tip.innerText,
        closeLabel: tip.querySelector('[data-action="close"]')?.getAttribute('aria-label'),
        archiveText: tip.querySelector('[data-action="archive"]')?.textContent,
      }
    })()`),
    '点击后固定解释栏',
  )
  assert.equal(pinnedTooltip.role, 'dialog')
  assert.equal(pinnedTooltip.closeLabel, '关闭解释栏')
  assert.equal(pinnedTooltip.archiveText, '归档术语')
  assert.ok(pinnedTooltip.text.includes(savedPreview.explanation))
  await new Promise((resolve) => setTimeout(resolve, 800))
  assert.equal(
    await evaluate(reader, `document.querySelector('#baihuaben-tooltip')?.style.display`),
    'block',
  )
  const pinnedTooltipScreenshot = await capture(reader, 'baihuaben-edge-pinned-tooltip.png')
  await evaluate(reader, `document.querySelector('#baihuaben-tooltip [data-action="close"]').click()`)
  await waitFor(
    () => evaluate(reader, `document.querySelector('#baihuaben-tooltip')?.style.display === 'none'`),
    '关闭固定解释栏',
  )

  await evaluate(reader, `(() => {
    const mark = [...document.querySelectorAll('.baihuaben-highlight')]
      .find((item) => item.textContent === 'Context window')
    mark.click()
    document.querySelector('#baihuaben-tooltip [data-action="archive"]').click()
  })()`)
  const archivedTerm = await waitFor(
    () => evaluate(worker, `chrome.storage.local.get('terms').then(({ terms }) => {
      const item = (terms || []).find((term) => term.term === 'Context window')
      return item?.archived === true && item.archivedAt && item.archivedCategory ? item : null
    })`),
    '从固定解释栏归档术语',
  )
  assert.equal(archivedTerm.archivedCategory, archivedTerm.category || '未分组')
  await waitFor(
    () => evaluate(reader, `document.querySelector('#baihuaben-tooltip')?.style.display === 'none'
      && [...document.querySelectorAll('.baihuaben-highlight')]
        .every((item) => item.textContent !== 'Context window')`),
    '归档后关闭解释栏并移除当前页同名高亮',
  )
  assert.equal(
    await evaluate(reader, `[...document.querySelectorAll('.baihuaben-highlight')]
      .some((item) => item.textContent === 'Context window')`),
    false,
  )
  await evaluate(worker, `chrome.storage.local.get('terms').then(({ terms }) => chrome.storage.local.set({
    terms: (terms || []).map((item) => item.term === 'Context window'
      ? { ...item, archived: false, archivedAt: '', archivedCategory: '' }
      : item),
  }))`)
  await waitFor(
    () => evaluate(reader, `[...document.querySelectorAll('.baihuaben-highlight')]
      .filter((item) => item.textContent === 'Context window').length === 2`),
    '恢复后重新显示黄色高亮',
  )
  console.log('STEP pinned tooltip close and archive flow updated the current page immediately')

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
  assert.equal(await evaluate(reader, `document.querySelectorAll('#baihuaben-tooltip').length`), 1)
  await evaluate(reader, `(() => {
    const marks = [...document.querySelectorAll('.baihuaben-highlight')]
      .filter((item) => item.textContent === 'Context window')
    marks[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })()`)
  assert.equal(await evaluate(reader, `document.querySelectorAll('#baihuaben-tooltip').length`), 1)
  const readerScreenshot = await capture(reader, 'baihuaben-edge-selection-highlight.png')

  const appTargetId = await createTarget(browser, 'http://127.0.0.1:5173/')
  const { client: app } = await connectTarget(
    (target) => target.id === appTargetId,
    '加简大白话应用页',
  )
  clients.push(app)
  await app.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await waitFor(
    () => evaluate(app, `location.origin === 'http://127.0.0.1:5173' && document.readyState !== 'loading'`),
    '加简大白话应用页完成导航',
  )
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

  await evaluate(app, `(() => {
    const terms = JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
      .map((item) => item.term === 'Context window' ? { ...item, analogy: '' } : item)
    window.postMessage({ source: 'baihuaben-web', type: 'SYNC_TERMS', terms }, '*')
    return true
  })()`)
  await waitFor(
    () => evaluate(worker, `chrome.storage.local.get('terms').then(({ terms }) => {
      const matches = (terms || []).filter((item) => item.term === 'Context window')
      return matches.length === 1 && matches[0].analogy === ${JSON.stringify(savedPreview.analogy)}
    })`),
    '陈旧网站数据不能清空已有类比',
  )
  const postSyncHighlights = await waitFor(
    () => evaluate(reader, `(() => {
      const marks = [...document.querySelectorAll('.baihuaben-highlight')]
        .filter((item) => item.textContent === 'Context window')
      const analogies = marks.map((item) => item.dataset.baihuabenAnalogy)
      return marks.length === 2 && analogies.every(Boolean) ? { count: marks.length, analogies } : null
    })()`),
    '空类比同步后两处高亮保持一致',
  )
  assert.deepEqual(postSyncHighlights.analogies, [savedPreview.analogy, savedPreview.analogy])
  console.log('STEP stale empty analogy could not overwrite complete extension data')

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

  const ungroupedBefore = await evaluate(app, `JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
    .filter((item) => item.category === '未分组').length`)
  await evaluate(app, `[...document.querySelectorAll('button')]
    .find((button) => button.textContent.includes('整理未分组')).click()`)
  const groupingPreview = await waitFor(
    () => evaluate(app, `(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="grouping-preview-title"]')
      if (!dialog?.innerText.includes('整理前预览')) return null
      return {
        changes: dialog.querySelectorAll('.preview-change-row').length,
        canApply: [...dialog.querySelectorAll('button')]
          .some((button) => button.textContent.includes('应用分组')),
      }
    })()`),
    'DeepSeek 增量分组预览',
    45000,
  )
  assert.ok(groupingPreview.changes > 0)
  assert.equal(groupingPreview.canApply, true)
  await evaluate(app, `[...document.querySelectorAll('[role="dialog"] button')]
    .find((button) => button.textContent.includes('应用分组')).click()`)
  await waitFor(
    () => evaluate(app, `!document.querySelector('[role="dialog"][aria-labelledby="grouping-preview-title"]')
      && JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
        .filter((item) => item.category === '未分组').length < ${ungroupedBefore}`),
    '应用 DeepSeek 增量分组',
  )

  await evaluate(app, `(() => {
    const groups = JSON.parse(localStorage.getItem('baihuaben:groups:v1') || '[]')
    localStorage.setItem('baihuaben:groups:v1', JSON.stringify([...new Set([...groups, '应被删除的旧分组'])]))
    location.reload()
    return true
  })()`)
  await waitFor(
    () => evaluate(app, `JSON.parse(localStorage.getItem('baihuaben:groups:v1') || '[]')
      .includes('应被删除的旧分组') && Boolean(document.querySelector('.library-page'))`),
    '准备全量重分组的旧分组',
  )
  await evaluate(app, `(() => {
    document.querySelector('.organize-menu summary').click()
    Array.from(document.querySelectorAll('.organize-menu button'))
      .find((button) => button.textContent.includes('重新整理全部术语')).click()
  })()`)
  const fullGroupingPreview = await waitFor(
    () => evaluate(app, `(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="grouping-preview-title"]')
      if (!dialog?.innerText.includes('应被删除的旧分组')) return null
      return {
        text: dialog.innerText,
        removedGroups: Array.from(dialog.querySelectorAll('.removed-group-list strong')).map((item) => item.textContent),
      }
    })()`),
    '全量重分组预览旧分组删除',
    45000,
  )
  assert.ok(fullGroupingPreview.text.includes('个旧分组将删除'))
  assert.ok(fullGroupingPreview.removedGroups.includes('应被删除的旧分组'))
  await evaluate(app, `[...document.querySelectorAll('[role="dialog"] button')]
    .find((button) => button.textContent.includes('应用分组')).click()`)
  await waitFor(
    () => evaluate(app, `(() => {
      const terms = JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
      const groups = JSON.parse(localStorage.getItem('baihuaben:groups:v1') || '[]')
      const counts = new Map()
      for (const term of terms) counts.set(term.category, (counts.get(term.category) || 0) + 1)
      const termGroups = [...counts.keys()].filter((group) => group !== '未分组')
      return !groups.includes('应被删除的旧分组')
        && groups.length === termGroups.length
        && groups.every((group) => termGroups.includes(group))
        && groups.length <= 5
        && [...counts].filter(([group]) => group !== '未分组').every(([, count]) => count >= 3)
    })()`),
    '应用全量大类分组并删除旧分组',
  )
  console.log('STEP full regroup produced broad categories and removed obsolete groups')

  const reviewTerm = await evaluate(app, `(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '快速复习').click()
    return true
  })()`)
  assert.equal(reviewTerm, true)
  const reviewedNames = []
  for (let reviewIndex = 0; reviewIndex < 5; reviewIndex += 1) {
    const reviewedName = await waitFor(
      () => evaluate(app, `document.querySelector('.flashcard h1')?.textContent || ''`),
      `快速复习卡片 ${reviewIndex + 1}`,
    )
    reviewedNames.push(reviewedName)
    await evaluate(app, `document.querySelector('.reveal-button').click()`)
    await waitFor(
      () => evaluate(app, `Boolean(document.querySelector('.flashcard-answer'))`),
      `复习答案显示 ${reviewIndex + 1}`,
    )
    await evaluate(app, `document.querySelector('.review-known').click()`)
    await waitFor(
      () => evaluate(app, reviewIndex === 4
        ? `Boolean(document.querySelector('.review-complete'))`
        : `Boolean(document.querySelector('.reveal-button'))`),
      `复习进度推进 ${reviewIndex + 1}`,
    )
  }
  assert.equal(new Set(reviewedNames).size, 5)
  const reviewSummary = await evaluate(app, `document.querySelector('.review-complete')?.innerText || ''`)
  assert.ok(reviewSummary.includes('记住了 5 个，共复习 5 个'))
  assert.equal(await evaluate(app, `(() => {
    const reviewed = new Set(${JSON.stringify(reviewedNames)})
    return JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
      .filter((item) => reviewed.has(item.term))
      .every((item) => item.reviewCount > 0 && item.mastered)
  })()`), true)
  console.log('STEP completed a fixed five-term review queue without skips or duplicates')
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
  await waitFor(
    () => evaluate(app, `Boolean(document.querySelector('[data-settings-tab="general"]'))`),
    '设置默认进入通用设置',
  )
  await evaluate(app, `[...document.querySelectorAll('.settings-tabs button')]
    .find((button) => button.textContent.trim() === '模型').click()`)
  await waitFor(
    () => evaluate(app, `Boolean(document.querySelector('[data-settings-tab="model"] .provider-summary'))`),
    '已配置提供方卡片',
  )
  await evaluate(app, `document.querySelector('[data-settings-tab="model"] .provider-summary button').click()`)
  await waitFor(
    () => evaluate(app, `Boolean(document.querySelector('.provider-editor[data-editor-mode="edit"]'))`),
    '已配置提供方编辑器',
  )
  await evaluate(app, `document.querySelector('.provider-editor .custom-settings-toggle').click()`)
  const modelSettings = await waitFor(
    () => evaluate(app, `(() => {
      const editor = document.querySelector('.provider-editor[data-editor-mode="edit"]')
      if (!document.querySelector('[data-settings-tab="model"]') || !editor) return null
      const urlInput = document.querySelector('.adapter-url-field input')
      return {
        configuredProviders: [...document.querySelectorAll('.provider-summary')]
          .map((item) => item.dataset.providerId),
        adapter: document.querySelector('.provider-editor-title span')?.textContent.trim(),
        models: [...document.querySelectorAll('.model-catalog-row')].map((item) => item.dataset.modelId),
        hasKeyInput: Boolean(document.querySelector('input[name="deepseekApiKey"]')),
        apiUrl: urlInput?.value,
        apiUrlReadOnly: urlInput?.readOnly,
        hasCustomProviderButton: document.body.innerText.includes('添加自定义提供方'),
      }
    })()`),
    '模型设置页',
  )
  assert.deepEqual(modelSettings.configuredProviders, ['deepseek'])
  assert.equal(modelSettings.adapter, 'deepseek-official')
  assert.equal(modelSettings.models.includes('deepseek-chat'), false)
  assert.equal(modelSettings.hasKeyInput, true)
  assert.equal(modelSettings.apiUrl, 'https://api.deepseek.com/v1')
  assert.equal(modelSettings.apiUrlReadOnly, true)
  assert.equal(modelSettings.hasCustomProviderButton, false)

  await evaluate(app, `[...document.querySelectorAll('button')]
    .find((button) => button.textContent.trim() === '获取可用模型').click()`)
  const availableModels = await waitFor(
    () => evaluate(app, `(() => {
      const dialog = document.querySelector('.model-discovery-dialog')
      if (!dialog) return null
      return [...dialog.querySelectorAll('.model-discovery-list label span')].map((item) => item.textContent.trim())
    })()`),
    '可用模型选择弹窗',
  )
  const initialModels = new Set(modelSettings.models)
  assert.deepEqual(
    [...availableModels].sort(),
    expectedModels.filter((model) => model !== 'deepseek-chat' && !initialModels.has(model)).sort(),
  )
  if (availableModels.length) {
    await evaluate(app, `document.querySelector('.model-discovery-dialog .primary-button').click()`)
    const expectedCatalogSize = new Set([...initialModels, ...availableModels]).size
    await waitFor(
      () => evaluate(app, `[...document.querySelectorAll('.model-catalog-row')].length === ${expectedCatalogSize}`),
      '所选模型加入目录',
    )
  } else {
    await evaluate(app, `document.querySelector('button[aria-label="关闭模型选择"]').click()`)
  }

  await evaluate(app, `[...document.querySelectorAll('.settings-tabs button')]
    .find((button) => button.textContent.trim() === '通用设置').click()`)
  const generalSettings = await waitFor(
    () => evaluate(app, `(() => {
      if (!document.querySelector('[data-settings-tab="general"]')) return null
      return {
        hoverLabels: [...document.querySelectorAll('.segmented-control button')].map((button) => button.textContent.trim()),
        activeHoverLabel: document.querySelector('.segmented-control button[aria-pressed="true"]')?.textContent.trim() || '',
      }
    })()`),
    '通用设置页',
  )
  assert.deepEqual(generalSettings.hoverLabels, ['大白话解释', '生活化类比', '全部展示'])
  assert.equal(generalSettings.activeHoverLabel, '大白话解释')
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
  await evaluate(app, `document.querySelector('.general-settings-form button[type="submit"]').click()`)
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
  await evaluate(app, `document.querySelector('.general-settings-form button[type="submit"]').click()`)
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

  await evaluate(reader, `(() => {
    const mark = [...document.querySelectorAll('.baihuaben-highlight')]
      .find((item) => item.textContent === 'Context window')
    mark.click()
    document.querySelector('#baihuaben-tooltip [data-action="archive"]').click()
  })()`)
  const websiteArchivedTerm = await waitFor(
    () => evaluate(app, `(() => {
      const item = JSON.parse(localStorage.getItem('baihuaben:terms:v1') || '[]')
        .find((term) => term.term === 'Context window')
      return item?.archived === true && item.mastered === true
        && item.archivedAt && item.archivedCategory ? item : null
    })()`),
    '悬浮解释栏归档同步到网站归档库',
  )
  assert.equal(websiteArchivedTerm.archivedCategory, websiteArchivedTerm.category || '未分组')
  await waitFor(
    () => evaluate(reader, `[...document.querySelectorAll('.baihuaben-highlight')]
      .every((item) => item.textContent !== 'Context window')`),
    '网站联动归档后当前阅读页移除高亮',
  )
  await evaluate(app, `document.querySelector('button[aria-label="关闭设置"]')?.click()`)
  await waitFor(
    () => evaluate(app, `Boolean(document.querySelector('.library-page .archive-entry'))`),
    '返回网站术语库',
  )
  await evaluate(app, `document.querySelector('.library-page .archive-entry').click()`)
  await waitFor(
    () => evaluate(app, `[...document.querySelectorAll('.archive-list .term-name')]
      .some((item) => item.textContent.trim() === 'Context window')`),
    '归档术语显示在网站归档列表',
  )
  const archiveLibraryScreenshot = await capture(app, 'baihuaben-edge-archive-synced.png')
  console.log('STEP floating-panel archive synchronized into the website archive library')

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
  assert.equal(popupState.title, '加简大白话 · Plainify｜你的个人术语库')
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

  const popupLoading = await evaluate(popup, `(() => {
    const input = document.querySelector('#term')
    input.value = 'PopupSmokeTerm'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#explain').click()
    return {
      buttonText: document.querySelector('#explain').textContent.trim(),
      status: document.querySelector('#query-status').textContent.trim(),
    }
  })()`)
  assert.equal(popupLoading.buttonText, '正在生成…')
  assert.match(popupLoading.status, /DeepSeek 正在生成大白话解释和生活化类比/)
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
      selectionButtonSurvivesBackgroundScroll: true,
      selectionButtonSurvivesHover: true,
      duplicateSelectionButtonsRemoved: true,
      realPointerClickStartsPreview: true,
      previewBeforeSave: true,
      previewSurvivesBackgroundScroll: true,
      dismissWithoutSave: true,
      confirmedSaveAndHighlight: true,
      hoverLightBulb: true,
      clickPinsTooltip: true,
      pinnedTooltipSurvivesMouseout: true,
      pinnedTooltipCanClose: true,
      archiveFromPinnedTooltip: true,
      archiveClosesTooltipAndRemovesHighlights: true,
      archiveSynchronizesToWebsiteLibrary: true,
      restoreAddsHighlightsBack: true,
      hoverTooltip: true,
      duplicateHighlightsShareCompleteData: true,
      staleEmptyAnalogyCannotOverwrite: true,
      singleTooltipInstance: true,
      extensionToWebsiteSync: true,
      websiteToExtensionSync: true,
      websiteSearch: true,
      websiteTermEditing: true,
      websiteGrouping: true,
      broadFullRegroup: true,
      obsoleteGroupsRemoved: true,
      websiteReview: true,
      popupPreviewPersistsBeforeSave: true,
      popupConfirmSaveAndClear: true,
      hoverExplanationModes: true,
      providerSettingsTabs: true,
    },
    screenshots: [
      previewScreenshot,
      pinnedTooltipScreenshot,
      readerScreenshot,
      hoverModesScreenshot,
      appScreenshot,
      archiveLibraryScreenshot,
      popupScreenshot,
    ],
  }, null, 2))
} finally {
  for (const client of clients.reverse()) client.close()
}
