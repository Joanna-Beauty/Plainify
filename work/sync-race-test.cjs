const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { webcrypto } = require('node:crypto')

const clone = (value) => structuredClone(value)
const storageListeners = []
const backgroundMessageListeners = []
const installedListeners = []
const fetches = []
const appMessages = []

let storage = {
  terms: [],
  settings: {
    apiKey: 'sk-test',
    autoExplain: true,
    hoverExplanationMode: 'both',
    model: 'deepseek-reasoner',
  },
}

function selectStorage(keys) {
  if (typeof keys === 'string') return { [keys]: clone(storage[keys]) }
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, clone(storage[key])]))
  if (keys && typeof keys === 'object') {
    return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
      key,
      storage[key] === undefined ? fallback : clone(storage[key]),
    ]))
  }
  return clone(storage)
}

const storageApi = {
  async get(keys) {
    return selectStorage(keys)
  },
  async set(updates) {
    const changes = {}
    for (const [key, value] of Object.entries(updates)) {
      const oldValue = clone(storage[key])
      storage[key] = clone(value)
      changes[key] = { oldValue, newValue: clone(value) }
    }
    for (const listener of storageListeners) listener(changes, 'local')
  },
}

const backgroundChrome = {
  contextMenus: {
    async removeAll() {},
    create() {},
    onClicked: { addListener() {} },
  },
  runtime: {
    onInstalled: { addListener(listener) { installedListeners.push(listener) } },
    onStartup: { addListener() {} },
    onMessage: { addListener(listener) { backgroundMessageListeners.push(listener) } },
  },
  scripting: { insertCSS: async () => {}, executeScript: async () => {} },
  storage: { local: storageApi },
  tabs: { query: async () => [] },
}

const backgroundContext = vm.createContext({
  chrome: backgroundChrome,
  console,
  crypto: webcrypto,
  Date,
  fetch(url, options) {
    return new Promise((resolve) => fetches.push({ url, options, resolve }))
  },
  Map,
  Promise,
  Set,
  String,
})

vm.runInContext(fs.readFileSync('extension/background.js', 'utf8'), backgroundContext)

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    const handled = backgroundMessageListeners.some((listener) => listener(message, {}, resolve))
    if (!handled) reject(new Error(`Unhandled message: ${message.type}`))
  })
}

const windowListeners = new Map()
const fakeWindow = {
  __baihuabenContentLoaded: false,
  addEventListener(type, listener) {
    const listeners = windowListeners.get(type) || []
    listeners.push(listener)
    windowListeners.set(type, listeners)
  },
  postMessage(data) {
    appMessages.push(clone(data))
    queueMicrotask(() => {
      for (const listener of windowListeners.get('message') || []) {
        listener({ source: fakeWindow, data })
      }
    })
  },
  setTimeout,
  clearTimeout,
}

const contentChrome = {
  runtime: {
    id: 'test-baihuaben-extension',
    onMessage: { addListener() {} },
    sendMessage: sendToBackground,
  },
  storage: {
    local: storageApi,
    onChanged: { addListener(listener) { storageListeners.push(listener) } },
  },
}

const documentElementAttributes = new Map()
const fakeDocument = {
  body: null,
  documentElement: {
    getAttribute(name) {
      return documentElementAttributes.get(name) || null
    },
    setAttribute(name, value) {
      documentElementAttributes.set(name, String(value))
    },
  },
  querySelector(selector) {
    return selector === 'meta[name="termly-app"][content="true"]' ? {} : null
  },
  addEventListener() {},
}

const contentContext = vm.createContext({
  chrome: contentChrome,
  console,
  document: fakeDocument,
  location: { hostname: '127.0.0.1', href: 'http://127.0.0.1:5173/' },
  Map,
  Promise,
  Set,
  String,
  window: fakeWindow,
})

vm.runInContext(fs.readFileSync('extension/term-data.js', 'utf8'), contentContext)
vm.runInContext(fs.readFileSync('extension/content.js', 'utf8'), contentContext)

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await flush()
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function run() {
  await Promise.all(installedListeners.map((listener) => listener()))
  await flush()

  assert.deepEqual(storage.settings, {
    autoExplain: true,
    hoverExplanationMode: 'both',
    model: 'deepseek-reasoner',
  })

  const previewPromise = sendToBackground({
    type: 'EXPLAIN_TERM',
    term: 'Context window',
    source: '测试文章',
    sourceUrl: 'https://example.com/article',
  })

  await waitFor(() => fetches.length === 1, 'localhost backend request')
  assert.deepEqual(storage.terms, [])

  const request = fetches.shift()
  assert.equal(request.url, 'http://127.0.0.1:8787/api/explain')
  assert.equal(JSON.parse(request.options.body).model, 'deepseek-reasoner')
  request.resolve({
    ok: true,
    async json() {
      return {
        ok: true,
        explanation: '模型一次最多能同时参考的内容范围。',
        analogy: '像桌面能同时摊开的资料数量。',
        category: '大模型基础',
      }
    },
  })

  const preview = await previewPromise
  assert.equal(preview.status, 'preview')
  assert.equal(preview.term.explanation, '模型一次最多能同时参考的内容范围。')
  assert.deepEqual(storage.terms, [])

  const result = await sendToBackground({
    type: 'SAVE_TERM',
    item: preview.term,
    source: '测试文章',
    sourceUrl: 'https://example.com/article',
  })
  assert.equal(result.status, 'saved')
  assert.equal(storage.terms[0].status, 'ready')

  const ready = clone(storage.terms[0])
  fakeWindow.postMessage({
    source: 'baihuaben-web',
    type: 'SYNC_TERMS',
    terms: [{ ...ready, explanation: '', analogy: '', category: '未分组', sourceUrl: '', status: 'pending' }],
  })
  await flush()
  await flush()

  assert.equal(storage.terms[0].status, 'ready')
  assert.equal(storage.terms[0].explanation, '模型一次最多能同时参考的内容范围。')
  assert.equal(storage.terms[0].analogy, '像桌面能同时摊开的资料数量。')
  assert.equal(storage.terms[0].sourceUrl, 'https://example.com/article')

  fakeWindow.postMessage({
    source: 'baihuaben-web',
    type: 'SYNC_TERMS',
    terms: [{ ...ready, analogy: '', status: 'ready' }],
  })
  await flush()
  await flush()
  assert.equal(storage.terms[0].analogy, '像桌面能同时摊开的资料数量。')

  fakeWindow.postMessage({
    source: 'baihuaben-web',
    type: 'SYNC_ALL',
    terms: storage.terms,
    settings: {
      apiKey: 'sk-new',
      provider: 'openai',
      baseUrl: 'https://wrong.example/v1',
      hoverExplanationMode: 'analogy',
      model: 'gpt-5',
    },
  })
  await flush()
  await flush()

  assert.deepEqual(storage.settings, {
    autoExplain: true,
    hoverExplanationMode: 'analogy',
    model: 'deepseek-chat',
  })
  assert.ok(appMessages.some((message) => (
    message.source === 'baihuaben-extension'
      && message.type === 'TERMS_CHANGED'
      && message.terms?.some((item) => item.status === 'ready')
  )))

  console.log('PASS explanation preview does not save until SAVE_TERM is confirmed')
  console.log('PASS stale website sync cannot overwrite a saved explanation or source URL')
  console.log('PASS stale ready terms cannot overwrite a saved analogy with an empty value')
  console.log('PASS explanation, analogy, and hover settings survive synchronization')
  console.log('PASS legacy API Key, provider, and base URL are removed from extension storage')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
