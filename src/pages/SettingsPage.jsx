import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  LoaderCircle,
  PlugZap,
  Puzzle,
  RefreshCw,
  Save,
  ServerCog,
} from 'lucide-react'
import { getProvider, normalizeProviderSettings } from '../data/providers'
import { fetchProviderModels, getBackendStatus, testAiConnection } from '../services/ai'

function modelOptionsFor(settings, remoteModels = []) {
  const provider = getProvider()
  const availableModels = remoteModels.length
    ? remoteModels
    : [settings.model, ...provider.fallbackModels]
  return [...new Set(availableModels.filter(Boolean))]
}

function backendState(status = {}) {
  return {
    loading: false,
    connected: true,
    configured: Boolean(status.configured),
    ready: Boolean(status.ready),
    providerStatus: String(status.providerStatus || 'unknown'),
    recoverable: Boolean(status.recoverable),
    retryAfterMs: Number(status.retryAfterMs || 0),
  }
}

function backendStatusText(status, modelCount = 0) {
  if (!status.configured) return '本机后端已连接；在 .env.local 配置 Key 后重启服务。'
  if (status.ready) return `后端与 DeepSeek 已连接，获取到 ${modelCount} 个可用模型。`
  if (status.providerStatus === 'insufficient_balance') {
    return 'DeepSeek 余额不足，正在等待充值到账；到账后会自动恢复，无需重启。'
  }
  if (status.providerStatus === 'rate_limited') return 'DeepSeek 请求频繁，正在后台自动重试。'
  if (status.providerStatus === 'auth_failed') return status.statusMessage || 'DeepSeek API Key 无效或没有权限。'
  if (status.recoverable) return `${status.statusMessage || 'DeepSeek 暂时不可用'}；正在后台自动重试。`
  return status.statusMessage || '正在检查 DeepSeek 真实连接状态。'
}

export default function SettingsPage({ settings, onSave, extensionReady, onSyncExtension, showToast }) {
  const normalizedSettings = useMemo(() => normalizeProviderSettings(settings), [settings])
  const [draft, setDraft] = useState(normalizedSettings)
  const [models, setModels] = useState(() => modelOptionsFor(normalizedSettings))
  const [testing, setTesting] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [backend, setBackend] = useState({
    loading: true,
    configured: false,
    connected: false,
    ready: false,
    providerStatus: 'unknown',
    recoverable: false,
    retryAfterMs: 0,
  })
  const [modelStatus, setModelStatus] = useState('正在连接本机 DeepSeek 服务…')
  const modelRequestId = useRef(0)

  function update(event) {
    const { name, type, checked, value } = event.target
    setDraft((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  const refreshBackend = useCallback(async (config, signal) => {
    const requestId = modelRequestId.current + 1
    modelRequestId.current = requestId
    setLoadingModels(true)
    setModelStatus('正在检查本机后端和 DeepSeek 真实连接…')
    try {
      const [statusResult, modelsResult] = await Promise.allSettled([
        getBackendStatus(signal, true),
        fetchProviderModels(config, signal),
      ])
      if (requestId !== modelRequestId.current) return
      if (statusResult.status === 'rejected') throw statusResult.reason
      const status = statusResult.value
      const fetchedModels = modelsResult.status === 'fulfilled' ? modelsResult.value : []
      const nextModels = modelOptionsFor(config, fetchedModels)
      setBackend(backendState(status))
      setModels(nextModels)
      setDraft((current) => nextModels.includes(current.model)
        ? current
        : { ...current, model: nextModels.includes('deepseek-chat') ? 'deepseek-chat' : nextModels[0] })
      setModelStatus(backendStatusText(status, nextModels.length))
    } catch (error) {
      if (requestId !== modelRequestId.current) return
      setBackend({
        loading: false,
        connected: false,
        configured: false,
        ready: false,
        providerStatus: 'backend_unreachable',
        recoverable: false,
        retryAfterMs: 0,
      })
      setModels(modelOptionsFor(config))
      setModelStatus(error.message)
    } finally {
      if (requestId === modelRequestId.current) setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => refreshBackend(normalizedSettings, controller.signal), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedSettings, refreshBackend])

  useEffect(() => {
    if (!backend.connected || !backend.configured || backend.ready || !backend.recoverable) return undefined
    let cancelled = false
    const delay = Math.max(2_000, Math.min(30_000, backend.retryAfterMs || 5_000))
    const timer = window.setTimeout(async () => {
      try {
        const status = await getBackendStatus(undefined, true)
        if (cancelled) return
        setBackend(backendState(status))
        setModelStatus(backendStatusText(status, models.length))
        if (status.ready) showToast('DeepSeek 充值已到账，连接已自动恢复。', 'success')
      } catch (error) {
        if (!cancelled) setModelStatus(error.message)
      }
    }, delay)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [backend, models.length, showToast])

  function save(event) {
    event.preventDefault()
    onSave(normalizeProviderSettings(draft))
  }

  async function testConnection() {
    setTesting(true)
    try {
      await testAiConnection(draft)
      showToast('DeepSeek 真实连接成功，可以开始解释术语了。', 'success')
    } catch (error) {
      showToast(error.message)
    } finally {
      setTesting(false)
      refreshBackend(draft)
    }
  }

  const backendLabel = backend.loading
    ? '正在检查本机后端'
    : backend.ready
      ? '后端与 DeepSeek 已就绪'
      : backend.providerStatus === 'insufficient_balance'
        ? '等待 DeepSeek 充值到账'
        : backend.configured
          ? '后端已启动，DeepSeek 正在恢复'
      : backend.connected
        ? '后端已启动，等待配置 Key'
        : '本机后端未连接'

  return (
    <main className="page settings-page">
      <header className="settings-heading">
        <h1>设置</h1>
        <p>DeepSeek API Key 只保存在本机后端，网页和扩展都不会读取它。</p>
      </header>
      <div className="settings-columns">
        <form className="settings-form" onSubmit={save}>
          <section className="settings-section">
            <div className="settings-section-heading">
              <ServerCog size={20} />
              <div><h2>本机 DeepSeek 服务</h2><p>接口地址和 API Key 均由后端管理。</p></div>
            </div>
            <div className={backend.ready ? 'provider-fixed backend-ready' : backend.recoverable ? 'provider-fixed backend-recovering' : 'provider-fixed'} aria-label="后端连接状态">
              <strong>DeepSeek</strong>
              <small>{backend.ready ? '已就绪' : backend.recoverable ? '自动恢复中' : '本机配置'}</small>
              <span>{backendLabel}</span>
            </div>
            <label>
              模型
              <span className="select-with-action">
                <select disabled={loadingModels} name="model" onChange={update} value={draft.model}>
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <button
                  aria-label="刷新后端状态和模型"
                  disabled={loadingModels}
                  onClick={() => refreshBackend(draft)}
                  title="刷新后端状态和模型"
                  type="button"
                >
                  {loadingModels ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
                </button>
              </span>
              <span className="model-status">{modelStatus}</span>
            </label>
            <label className="toggle-row">
              <span><strong>收录时自动解释</strong><small>关闭后，从网站手动添加的术语会先进入待解释状态。</small></span>
              <input checked={draft.autoExplain} name="autoExplain" onChange={update} type="checkbox" />
            </label>
            <fieldset className="hover-mode-field">
              <legend>网页悬停显示</legend>
              <div aria-label="鼠标悬停解释类型" className="segmented-control" role="group">
                {[
                  ['explanation', '大白话解释'],
                  ['analogy', '生活化类比'],
                  ['both', '全部展示'],
                ].map(([value, label]) => (
                  <button
                    aria-pressed={draft.hoverExplanationMode === value}
                    key={value}
                    onClick={() => setDraft((current) => ({ ...current, hoverExplanationMode: value }))}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <small>控制鼠标停在黄色高亮词上时显示哪种解释。</small>
            </fieldset>
            <div className="settings-actions">
              <button className="secondary-button" disabled={testing || !backend.configured} onClick={testConnection} type="button">
                {testing ? <LoaderCircle className="spin" size={16} /> : <PlugZap size={16} />}
                测试 DeepSeek
              </button>
              <button className="primary-button" type="submit"><Save size={16} />保存设置</button>
            </div>
          </section>
        </form>

        <aside className="extension-panel">
          <div className="extension-panel-icon"><Puzzle aria-hidden="true" size={25} /></div>
          <h2>浏览器扩展</h2>
          <p>选中术语后先查看大白话解释，再决定要不要加入个人术语库。</p>
          <div className={extensionReady ? 'extension-check connected' : 'extension-check'}>
            {extensionReady ? <CheckCircle2 size={17} /> : <span className="status-dot" />}
            {extensionReady ? '已检测到扩展' : '暂未检测到扩展'}
          </div>
          <div className="install-path">
            <span>本地扩展目录</span>
            <code>extension/</code>
          </div>
          <button className="secondary-button full" disabled={!extensionReady} onClick={() => onSyncExtension(draft)} type="button">
            <Puzzle size={16} />同步术语与插件设置
          </button>
          <p className="security-note">扩展只保存术语、模型名称和悬停方式；DeepSeek API Key 始终留在本机后端。</p>
        </aside>
      </div>
    </main>
  )
}
