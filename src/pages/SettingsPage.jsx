import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Copy,
  Database,
  Edit3,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plus,
  RefreshCcw,
  Save,
  ServerCog,
  Settings2,
  ShieldCheck,
  TvMinimalPlay,
  Trash2,
  X,
} from 'lucide-react'
import { getProvider, modelProviders, normalizeProviderSettings } from '../data/providers'
import {
  activateProvider,
  deleteProviderCredential,
  fetchProviderModels,
  getAiProviders,
  getBackendStatus,
  saveProviderCredential,
} from '../services/ai'

const SETTINGS_TABS = [
  { id: 'general', label: '通用设置', icon: Settings2 },
  { id: 'model', label: '模型', icon: Database },
  { id: 'contact', label: '联系与反馈', icon: MessagesSquare },
]

const CONTACT_CHANNELS = [
  { id: 'email', label: '邮箱', value: '827228539@qq.com', icon: Mail, href: 'mailto:827228539@qq.com' },
  {
    id: 'wechat',
    label: '微信',
    value: 'around_9',
    icon: MessageCircle,
  },
  { id: 'bilibili', label: 'B 站', value: '加简Joanna', icon: TvMinimalPlay },
  { id: 'xiaohongshu', label: '小红书', value: '加简Joanna', icon: MessagesSquare },
]

const FEEDBACK_FORM_URL = 'https://my.feishu.cn/share/base/form/shrcnNIBOZIPMz8pMKyFIqZLtmb'

const HOVER_MODE_OPTIONS = [
  {
    value: 'both',
    label: '解释和类比',
    description: '同时展示两种内容，悬停卡片会更长。',
  },
  {
    value: 'explanation',
    label: '大白话解释',
    description: '快速查看术语的核心含义。',
  },
  {
    value: 'analogy',
    label: '生活化类比',
    description: '用熟悉的生活场景帮助理解。',
  },
]

function uniqueModels(...groups) {
  return [...new Set(groups.flat().map((model) => String(model || '').trim()).filter(Boolean))]
}

function providerCatalog(settings, provider) {
  return uniqueModels(settings.modelCatalogs?.[provider.id] || [])
    .filter((model) => model !== provider.defaultModel)
}

export default function SettingsPage({
  settings,
  initialTab = 'general',
  onClose,
  onSave,
  extensionReady,
  onProviderResolved,
  showToast,
}) {
  const normalizedSettings = useMemo(() => normalizeProviderSettings(settings), [settings])
  const showToastRef = useRef(showToast)
  const onProviderResolvedRef = useRef(onProviderResolved)
  const apiKeyInputRef = useRef(null)
  const [activeTab, setActiveTab] = useState(initialTab)
  const [draft, setDraft] = useState(normalizedSettings)
  const [providers, setProviders] = useState(() => modelProviders.map((provider) => ({
    ...provider,
    configured: false,
    keyLastFour: '',
  })))
  const [activeProviderId, setActiveProviderId] = useState(normalizedSettings.provider)
  const [selectedModelsByProvider, setSelectedModelsByProvider] = useState(
    () => normalizedSettings.providerModels,
  )
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [providerEditorMode, setProviderEditorMode] = useState('add')
  const [endpointMode, setEndpointMode] = useState('official')
  const [selectedProviderId, setSelectedProviderId] = useState(normalizedSettings.provider)
  const [editorCatalog, setEditorCatalog] = useState([])
  const [editorModel, setEditorModel] = useState(normalizedSettings.model)
  const [apiKey, setApiKey] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingProvider, setSavingProvider] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState([])
  const [verification, setVerification] = useState({ status: 'idle', message: '' })
  const [switchingProviderId, setSwitchingProviderId] = useState('')
  const [backend, setBackend] = useState({
    connected: false,
    configured: false,
    ready: false,
    providerStatus: 'unknown',
    recoverable: false,
    statusMessage: '',
    retryAfterMs: 0,
  })

  const selectedProvider = getProvider(selectedProviderId)
  const providerStatus = providers.find((provider) => provider.id === selectedProvider.id) || selectedProvider
  const configuredProviders = providers.filter((provider) => provider.configured)
  const availableProviders = providers.filter((provider) => !provider.configured)
  const activeProvider = providers.find((provider) => provider.id === activeProviderId)
    || getProvider(activeProviderId)

  useEffect(() => {
    showToastRef.current = showToast
  }, [showToast])

  useEffect(() => {
    onProviderResolvedRef.current = onProviderResolved
  }, [onProviderResolved])

  useEffect(() => setDraft((current) => normalizeProviderSettings({
    ...current,
    autoExplain: normalizedSettings.autoExplain,
    hoverExplanationMode: normalizedSettings.hoverExplanationMode,
  })), [normalizedSettings.autoExplain, normalizedSettings.hoverExplanationMode])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      if (providerEditorOpen) setProviderEditorOpen(false)
      else onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, providerEditorOpen])

  const refreshOverview = useCallback(async (signal) => {
    setLoading(true)
    try {
      const [providerResult, healthResult] = await Promise.all([
        getAiProviders(signal),
        getBackendStatus(signal, false),
      ])
      const nextProviders = modelProviders.map((provider) => ({
        ...provider,
        ...(providerResult.providers || []).find((item) => item.id === provider.id),
      }))
      const nextProviderId = providerResult.activeProvider || normalizedSettings.provider
      const nextProvider = getProvider(nextProviderId)
      const nextModel = providerResult.activeModel || normalizedSettings.model || nextProvider.defaultModel
      setProviders(nextProviders)
      setActiveProviderId(nextProviderId)
      setSelectedModelsByProvider((current) => ({ ...current, [nextProviderId]: nextModel }))
      setBackend({ ...healthResult, connected: true })
      setDraft((current) => normalizeProviderSettings({
        ...current,
        provider: nextProviderId,
        model: nextModel,
        providerModels: {
          ...current.providerModels,
          [nextProviderId]: nextModel,
        },
      }))
      onProviderResolvedRef.current?.({
        provider: nextProviderId,
        model: nextModel,
        configured: Boolean(nextProviders.some((provider) => provider.configured)),
      })
      return { providers: nextProviders, activeProviderId: nextProviderId, activeModel: nextModel }
    } catch (error) {
      if (error.name === 'AbortError') return null
      setBackend((current) => ({ ...current, connected: false, statusMessage: error.message }))
      return null
    } finally {
      setLoading(false)
    }
  }, [normalizedSettings.model, normalizedSettings.provider])

  useEffect(() => {
    const controller = new AbortController()
    refreshOverview(controller.signal)
    return () => controller.abort()
  }, [refreshOverview])

  useEffect(() => {
    if (!backend.connected || !backend.configured || backend.ready || !backend.recoverable) return undefined
    const delay = Math.max(2_000, Math.min(30_000, backend.retryAfterMs || 5_000))
    const timer = window.setTimeout(async () => {
      try {
        const status = await getBackendStatus(undefined, true)
        setBackend({ ...status, connected: true })
        if (status.ready) showToastRef.current(`${status.provider} 已自动恢复连接。`, 'success')
      } catch (error) {
        setBackend((current) => ({ ...current, connected: false, statusMessage: error.message }))
      }
    }, delay)
    return () => window.clearTimeout(timer)
  }, [
    backend.configured,
    backend.connected,
    backend.ready,
    backend.recoverable,
    backend.retryAfterMs,
  ])

  function updateGeneral(event) {
    const { name, checked } = event.target
    setDraft((current) => ({ ...current, [name]: checked }))
  }

  function saveGeneral(event) {
    event.preventDefault()
    onSave(normalizeProviderSettings(draft))
  }

  function resetProviderEditor(providerId, mode) {
    const provider = getProvider(providerId)
    const currentStatus = providers.find((item) => item.id === provider.id)
    const nextModel = provider.id === activeProviderId
      ? draft.model
      : selectedModelsByProvider[provider.id] || draft.providerModels?.[provider.id] || provider.defaultModel
    const storedCatalog = uniqueModels(provider.defaultModel, providerCatalog(draft, provider), nextModel)
    setSelectedProviderId(provider.id)
    setEditorModel(nextModel)
    setEditorCatalog(storedCatalog.filter((model) => model !== provider.defaultModel))
    setProviderEditorMode(mode)
    setEndpointMode(currentStatus?.customBaseUrl ? 'custom' : 'official')
    setApiKey('')
    setApiBaseUrl(currentStatus?.baseUrl || provider.baseUrl)
    setShowKey(false)
    setAvailableModels(mode === 'edit' ? storedCatalog : [])
    setVerification(mode === 'edit'
      ? { status: 'success', message: '配置已保存；更换密钥或地址后需要重新测试。' }
      : { status: 'idle', message: '' })
  }

  function openAddProvider() {
    const provider = availableProviders[0]
    if (!provider) return
    resetProviderEditor(provider.id, 'add')
    setProviderEditorOpen(true)
    window.setTimeout(() => apiKeyInputRef.current?.focus(), 0)
  }

  function openEditProvider(providerId) {
    resetProviderEditor(providerId, 'edit')
    setProviderEditorOpen(true)
  }

  function closeProviderEditor() {
    setProviderEditorOpen(false)
    setApiKey('')
    setApiBaseUrl('')
    setShowKey(false)
    setAvailableModels([])
    setVerification({ status: 'idle', message: '' })
  }

  function selectSettingsTab(tabId) {
    if (tabId === activeTab) return
    closeProviderEditor()
    setActiveTab(tabId)
  }

  function selectProvider(providerId) {
    resetProviderEditor(providerId, 'add')
  }

  function nextSettingsFor(provider, model, catalog = editorCatalog, makeActive = true) {
    return normalizeProviderSettings({
      ...draft,
      ...(makeActive ? { provider: provider.id, model } : {}),
      modelCatalogs: {
        ...draft.modelCatalogs,
        [provider.id]: uniqueModels(catalog).filter((item) => item !== provider.defaultModel),
      },
      providerModels: {
        ...draft.providerModels,
        [provider.id]: model,
      },
    })
  }

  function applySavedProvider(result, catalog = editorCatalog) {
    const savedProvider = selectedProvider
    const savedModel = result.savedModel || editorModel || savedProvider.defaultModel
    const nextCatalog = uniqueModels(catalog, result.models || [])
      .filter((model) => model !== savedProvider.defaultModel)
    const nextActiveProvider = getProvider(result.activeProvider)
    const nextActiveModel = result.activeModel || draft.providerModels?.[nextActiveProvider.id]
      || nextActiveProvider.defaultModel
    const next = normalizeProviderSettings({
      ...nextSettingsFor(savedProvider, savedModel, nextCatalog, false),
      provider: nextActiveProvider.id,
      model: nextActiveModel,
    })
    setProviders((current) => current.map((item) => item.id === savedProvider.id
      ? { ...item, ...result.provider, configured: true }
      : item))
    setActiveProviderId(nextActiveProvider.id)
    setSelectedProviderId(savedProvider.id)
    setSelectedModelsByProvider((current) => ({
      ...current,
      [savedProvider.id]: savedModel,
      [nextActiveProvider.id]: nextActiveModel,
    }))
    setEditorModel(savedModel)
    setEditorCatalog(nextCatalog)
    setApiBaseUrl(result.provider?.baseUrl || savedProvider.baseUrl)
    setDraft(next)
    if (nextActiveProvider.id === savedProvider.id) {
      setBackend((current) => ({
        ...current,
        connected: true,
        configured: true,
        ready: true,
        providerStatus: 'ready',
        recoverable: false,
      }))
    }
    onSave(next)
    onProviderResolvedRef.current?.({
      provider: nextActiveProvider.id,
      model: nextActiveModel,
      configured: true,
    })
    return next
  }

  function invalidateVerification() {
    setVerification({ status: 'idle', message: '' })
    setAvailableModels([])
  }

  function updateApiKey(value) {
    setApiKey(value)
    invalidateVerification()
  }

  function selectEndpointMode(mode) {
    setEndpointMode(mode)
    setApiBaseUrl(mode === 'official' ? selectedProvider.baseUrl : '')
    invalidateVerification()
  }

  function updateApiBaseUrl(value) {
    setApiBaseUrl(value)
    invalidateVerification()
  }

  async function saveProvider(event) {
    event.preventDefault()
    if (providerEditorMode === 'add' && !apiKey.trim()) {
      showToast(`请粘贴 ${selectedProvider.name} API Key。`)
      apiKeyInputRef.current?.focus()
      return
    }

    if (verification.status !== 'success' || !availableModels.includes(editorModel)) {
      showToast('请先完成联通测试并选择一个可用模型。')
      return
    }

    setSavingProvider(true)
    try {
      const shouldActivate = configuredProviders.length === 0 || selectedProvider.id === activeProviderId
      const result = await saveProviderCredential(
        selectedProvider.id,
        apiKey.trim(),
        editorModel,
        apiBaseUrl.trim(),
        shouldActivate,
      )
      applySavedProvider(result, availableModels)
      closeProviderEditor()
      showToast(
        shouldActivate
          ? `${selectedProvider.name} 已保存并设为当前模型服务。`
          : `${selectedProvider.name} 已保存，可在服务列表中切换使用。`,
        'success',
      )
    } catch (error) {
      showToast(error.message)
    } finally {
      setSavingProvider(false)
    }
  }

  async function fetchAvailableModels() {
    if (providerEditorMode === 'add' && !apiKey.trim()) {
      showToast(`请先填写 ${selectedProvider.name} API Key。`)
      apiKeyInputRef.current?.focus()
      return
    }
    if (!apiBaseUrl.trim()) {
      showToast('请先填写 API 地址。')
      return
    }
    setLoadingModels(true)
    setVerification({ status: 'loading', message: '' })
    try {
      const remoteModels = await fetchProviderModels({
        provider: selectedProvider.id,
        apiKey: apiKey.trim(),
        baseUrl: apiBaseUrl.trim(),
      })
      const discoveredModels = uniqueModels(remoteModels)
      if (!discoveredModels.length) throw new Error('当前 API 地址没有返回可用的文本模型。')
      const preferredModel = providerEditorMode === 'edit' && discoveredModels.includes(editorModel)
        ? editorModel
        : discoveredModels.includes(selectedProvider.defaultModel)
          ? selectedProvider.defaultModel
          : discoveredModels[0]
      setAvailableModels(discoveredModels)
      setEditorCatalog(discoveredModels.filter((model) => model !== selectedProvider.defaultModel))
      setEditorModel(preferredModel)
      setVerification({
        status: 'success',
        message: `联通成功，已获取 ${discoveredModels.length} 个可用模型；未发起对话生成。`,
      })
    } catch (error) {
      setVerification({ status: 'error', message: error.message })
      showToast(error.message)
    } finally {
      setLoadingModels(false)
    }
  }

  async function switchProvider(provider) {
    if (provider.id === activeProviderId || switchingProviderId) return
    const model = selectedModelsByProvider[provider.id]
      || draft.providerModels?.[provider.id]
      || provider.defaultModel
    setSwitchingProviderId(provider.id)
    try {
      const result = await activateProvider(provider.id, model)
      const next = nextSettingsFor(provider, result.activeModel, providerCatalog(draft, provider))
      setActiveProviderId(result.activeProvider)
      setSelectedModelsByProvider((current) => ({ ...current, [provider.id]: result.activeModel }))
      setDraft(next)
      setBackend((current) => ({
        ...current,
        configured: true,
        ready: true,
        providerStatus: 'ready',
        recoverable: false,
      }))
      onSave(next)
      showToast(`已切换到 ${provider.name} · ${result.activeModel}。`, 'success')
    } catch (error) {
      showToast(error.message)
    } finally {
      setSwitchingProviderId('')
    }
  }

  async function removeKey() {
    if (!window.confirm(`删除本机保存的 ${selectedProvider.name} API Key？`)) return
    setDeleting(true)
    try {
      await deleteProviderCredential(selectedProvider.id)
      const next = normalizeProviderSettings({
        ...draft,
        modelCatalogs: {
          ...draft.modelCatalogs,
          [selectedProvider.id]: [],
        },
      })
      setDraft(next)
      onSave(next)
      closeProviderEditor()
      await refreshOverview()
      showToast(`${selectedProvider.name} API Key 已从本机配置中删除。`, 'success')
    } catch (error) {
      showToast(error.message)
    } finally {
      setDeleting(false)
    }
  }

  async function copyContact(label, value) {
    try {
      await navigator.clipboard.writeText(value)
      showToast(`${label}已复制。`, 'success')
    } catch {
      showToast(`复制失败，请手动复制：${value}`)
    }
  }

  return (
    <div
      className="settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <main aria-labelledby="settings-title" aria-modal="true" className="settings-dialog" role="dialog">
        <header className="settings-dialog-header">
          <h1 id="settings-title">设置</h1>
          <button aria-label="关闭设置" className="settings-close-button" onClick={onClose} title="关闭设置" type="button">
            <X size={25} />
          </button>
        </header>

        <div className="settings-dialog-body">
          <nav aria-label="设置分类" className="settings-tabs">
            {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
              <button
                aria-current={activeTab === id ? 'page' : undefined}
                className={activeTab === id ? 'active' : ''}
                key={id}
                onClick={() => selectSettingsTab(id)}
                type="button"
              >
                <Icon aria-hidden="true" size={21} />
                {label}
              </button>
            ))}
          </nav>

          <section className="settings-content">
            {activeTab === 'general' ? (
              <div className="settings-pane" data-settings-tab="general">
                <div className="settings-pane-heading">
                  <h2>通用设置</h2>
                  <p>调整术语收录和网页阅读时的显示方式。</p>
                </div>

                <form className="general-settings-form" onSubmit={saveGeneral}>
                  <section className="settings-block extension-settings-block" data-general-setting="extension">
                    <div className="settings-block-heading">
                      <div><h3>浏览器扩展</h3><p>扩展连接后，术语和网页悬停偏好会自动同步。</p></div>
                      <div className={extensionReady ? 'extension-check connected' : 'extension-check'}>
                        {extensionReady ? <CheckCircle2 size={15} /> : <span className="status-dot" />}
                        {extensionReady ? '已连接' : '未连接'}
                      </div>
                    </div>
                    <div className="extension-directory"><span>本地扩展目录</span><code>extension/</code></div>
                    {extensionReady ? (
                      <div className="extension-install-success">
                        <CheckCircle2 aria-hidden="true" size={17} />
                        <span><strong>扩展已经可以使用</strong><small>网页选词和术语同步已连接。</small></span>
                      </div>
                    ) : (
                      <div className="extension-install-guide">
                        <ol>
                          <li><span>1</span><p>打开 <code>chrome://extensions</code> 或 <code>edge://extensions</code></p></li>
                          <li><span>2</span><p>开启“开发者模式”，点击“加载已解压的扩展程序”</p></li>
                          <li><span>3</span><p>选择项目中的 <code>extension/</code>，再刷新本页面</p></li>
                        </ol>
                        <p className="extension-permission-note">
                          <ShieldCheck aria-hidden="true" size={16} />
                          网页权限仅用于读取你主动选中的文字和显示术语高亮；API Key 不会进入扩展。
                        </p>
                      </div>
                    )}
                  </section>

                  <section className="general-preference-card settings-block" data-general-setting="capture">
                    <div className="preference-section-heading">
                      <h3>收录方式</h3>
                      <p>决定新术语收录后是否立即生成解释。</p>
                    </div>
                    <label className="preference-row">
                      <span><strong>收录时自动解释</strong><small>关闭后，新术语会先进入待解释状态。</small></span>
                      <input checked={draft.autoExplain} name="autoExplain" onChange={updateGeneral} type="checkbox" />
                    </label>
                  </section>

                  <section className="general-preference-card settings-block" data-general-setting="hover">
                    <div className="preference-section-heading">
                      <h3>网页悬停卡片</h3>
                      <p>选择鼠标停在网页高亮术语上时显示的内容。</p>
                    </div>
                    <fieldset className="hover-mode-field">
                      <legend className="sr-only">网页悬停卡片内容</legend>
                      <div className="hover-mode-options">
                        {HOVER_MODE_OPTIONS.map(({ value, label, description }) => (
                          <label
                            className={draft.hoverExplanationMode === value
                              ? 'hover-mode-option selected'
                              : 'hover-mode-option'}
                            key={value}
                          >
                            <input
                              checked={draft.hoverExplanationMode === value}
                              name="hoverExplanationMode"
                              onChange={() => setDraft((current) => ({ ...current, hoverExplanationMode: value }))}
                              type="radio"
                              value={value}
                            />
                            <span><strong>{label}</strong><small>{description}</small></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </section>

                  <div className="settings-actions">
                    <button className="primary-button" type="submit"><Save size={16} />保存通用设置</button>
                  </div>
                </form>
              </div>
            ) : activeTab === 'model' ? (
              <div className="settings-pane" data-settings-tab="model">
                <div className="settings-pane-heading model-pane-heading">
                  <h2>模型服务</h2>
                  <p>配置多个模型服务，并选择当前用于生成解释的服务。</p>
                </div>

                <div className="model-service-workspace">
                  <aside className="model-service-list" aria-label="已配置模型服务">
                    <div className="configured-provider-list">
                      {configuredProviders.map((provider) => {
                        const isActive = provider.id === activeProviderId
                        const model = selectedModelsByProvider[provider.id]
                          || draft.providerModels?.[provider.id]
                          || (isActive ? draft.model : provider.defaultModel)
                        return (
                          <section
                            className={isActive ? 'provider-summary active' : 'provider-summary'}
                            data-provider-id={provider.id}
                            key={provider.id}
                            style={{ '--provider-color': provider.color }}
                          >
                            <button
                              aria-label={isActive ? `${provider.name} 当前正在使用` : `切换到 ${provider.name}`}
                              aria-pressed={isActive}
                              className="provider-summary-main"
                              disabled={isActive || Boolean(switchingProviderId)}
                              onClick={() => switchProvider(provider)}
                              type="button"
                            >
                              <span className="provider-monogram">{provider.shortName}</span>
                              <span className="provider-summary-copy">
                                <strong>{provider.name}</strong>
                                <small>{model}</small>
                              </span>
                              <span className={isActive ? 'provider-use-state active' : 'provider-use-state'}>
                                {switchingProviderId === provider.id
                                  ? <LoaderCircle className="spin" size={15} />
                                  : isActive ? <Check size={15} /> : null}
                                {isActive ? '当前使用' : '设为当前'}
                              </span>
                            </button>
                            <button
                              aria-label={`编辑 ${provider.name}`}
                              className="provider-edit-button"
                              onClick={() => openEditProvider(provider.id)}
                              title="编辑配置"
                              type="button"
                            >
                              <Edit3 size={17} />
                            </button>
                          </section>
                        )
                      })}
                    </div>

                    {availableProviders.length ? (
                      <button className="add-provider-button" disabled={loading} onClick={openAddProvider} type="button">
                        {loading ? <LoaderCircle className="spin" size={18} /> : <Plus size={19} />}
                        {loading ? '正在读取服务' : '添加模型服务'}
                      </button>
                    ) : null}
                  </aside>

                  <div className="model-service-detail">
                    {providerEditorOpen ? (
                      <form className="provider-editor" data-editor-mode={providerEditorMode} onSubmit={saveProvider}>
                        <header className="provider-editor-title">
                          <div>
                            <strong>{providerEditorMode === 'add' ? '添加模型服务' : `编辑 ${selectedProvider.name}`}</strong>
                            <span>{providerEditorMode === 'add' ? '完成联通测试后再选择模型。' : selectedProvider.protocol}</span>
                          </div>
                          <button aria-label="关闭编辑" onClick={closeProviderEditor} title="关闭" type="button"><X size={19} /></button>
                        </header>

                        {providerEditorMode === 'add' ? (
                          <label className="provider-select-field">
                            <span>模型厂商</span>
                            <select onChange={(event) => selectProvider(event.target.value)} value={selectedProvider.id}>
                              {availableProviders.map((provider) => (
                                <option key={provider.id} value={provider.id}>{provider.name}</option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        <fieldset className="provider-endpoint-field">
                          <legend>API 地址</legend>
                          <div aria-label="API 地址类型" className="endpoint-mode-control" role="group">
                            <button
                              aria-pressed={endpointMode === 'official'}
                              onClick={() => endpointMode !== 'official' && selectEndpointMode('official')}
                              type="button"
                            >官方 API</button>
                            <button
                              aria-pressed={endpointMode === 'custom'}
                              onClick={() => endpointMode !== 'custom' && selectEndpointMode('custom')}
                              type="button"
                            >自定义地址</button>
                          </div>
                          {endpointMode === 'custom' ? (
                            <input
                              aria-label="自定义 API 地址"
                              autoComplete="off"
                              onChange={(event) => updateApiBaseUrl(event.target.value)}
                              placeholder="https://your-api.example.com/v1"
                              required
                              type="url"
                              value={apiBaseUrl}
                            />
                          ) : (
                            <div className="official-endpoint-preview"><ServerCog size={16} /><span>{selectedProvider.baseUrl}</span></div>
                          )}
                        </fieldset>

                        <label className="provider-key-field">
                          <span className="provider-key-label">
                            <span>API Key{providerEditorMode === 'add' ? '（必填）' : ''}</span>
                            <a href={selectedProvider.consoleUrl} rel="noreferrer" target="_blank">
                              获取 API Key
                              <ExternalLink aria-hidden="true" size={13} />
                            </a>
                          </span>
                          <span className="password-field">
                            <KeyRound aria-hidden="true" size={17} />
                            <input
                              autoComplete="off"
                              name={`${selectedProvider.id}ApiKey`}
                              onChange={(event) => updateApiKey(event.target.value)}
                              placeholder={providerStatus.configured ? `已保存 ····${providerStatus.keyLastFour || ''}` : selectedProvider.keyPlaceholder}
                              ref={apiKeyInputRef}
                              required={providerEditorMode === 'add'}
                              type={showKey ? 'text' : 'password'}
                              value={apiKey}
                            />
                            <button
                              aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                              onClick={() => setShowKey((value) => !value)}
                              title={showKey ? '隐藏 API Key' : '显示 API Key'}
                              type="button"
                            >
                              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </span>
                        </label>

                        <section className="model-verification" data-status={verification.status}>
                          <div className="model-verification-copy">
                            {verification.status === 'success' ? <CheckCircle2 size={20} /> : <ShieldCheck size={20} />}
                            <span>
                              <strong>{verification.status === 'success' ? '联通成功' : verification.status === 'error' ? '联通失败' : '尚未联通测试'}</strong>
                              <small>{verification.message || '完成联通测试后，可以选择当前账号可用的模型。'}</small>
                            </span>
                          </div>
                          <button disabled={loadingModels} onClick={fetchAvailableModels} type="button">
                            {loadingModels ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
                            {loadingModels ? '正在测试' : verification.status === 'success' ? '重新测试' : '联通测试并获取模型'}
                          </button>
                        </section>

                        {verification.status === 'success' && availableModels.length ? (
                          <label className="verified-model-field">
                            <span>模型</span>
                            <div>
                              <select onChange={(event) => setEditorModel(event.target.value)} value={editorModel}>
                                {availableModels.map((model) => (
                                  <option key={model} value={model}>
                                    {model === selectedProvider.defaultModel ? `${model}（官方推荐）` : model}
                                  </option>
                                ))}
                              </select>
                              <button aria-label="刷新模型列表" disabled={loadingModels} onClick={fetchAvailableModels} title="刷新模型列表" type="button">
                                <RefreshCcw size={17} />
                              </button>
                            </div>
                            <small>可自由切换当前账号返回的文本模型。</small>
                          </label>
                        ) : null}

                        <footer className="provider-editor-footer">
                          {providerEditorMode === 'edit' ? (
                            <button
                              aria-label={`删除 ${selectedProvider.name} 配置`}
                              className="remove-provider-button"
                              disabled={deleting}
                              onClick={removeKey}
                              title="删除配置"
                              type="button"
                            >
                              {deleting ? <LoaderCircle className="spin" size={18} /> : <Trash2 size={18} />}
                            </button>
                          ) : <span />}
                          <div>
                            <button className="provider-cancel-button" onClick={closeProviderEditor} type="button">取消</button>
                            <button
                              className="provider-save-button"
                              disabled={savingProvider || verification.status !== 'success'}
                              type="submit"
                            >
                              {savingProvider ? <LoaderCircle className="spin" size={17} /> : null}
                              {configuredProviders.length === 0 ? '保存并开始使用' : '保存配置'}
                            </button>
                          </div>
                        </footer>
                      </form>
                    ) : configuredProviders.length ? (
                      <section className="active-provider-detail" style={{ '--provider-color': activeProvider.color }}>
                        <header>
                          <span className="provider-monogram">{activeProvider.shortName}</span>
                          <div><strong>{activeProvider.name}</strong><small>{activeProvider.protocol}</small></div>
                          <span className="active-provider-badge"><Check size={15} />当前使用</span>
                        </header>
                        <dl>
                          <div><dt>当前模型</dt><dd>{selectedModelsByProvider[activeProvider.id] || draft.model}</dd></div>
                          <div><dt>API 地址</dt><dd>{activeProvider.baseUrl}</dd></div>
                          <div><dt>API Key</dt><dd>已保存 ····{activeProvider.keyLastFour || '••••'}</dd></div>
                        </dl>
                        <footer>
                          <button className="primary-button" onClick={() => openEditProvider(activeProvider.id)} type="button"><Edit3 size={16} />编辑配置</button>
                        </footer>
                      </section>
                    ) : (
                      <section className="model-service-empty">
                        <Database size={24} />
                        <strong>还没有模型服务</strong>
                        <span>从左侧添加第一个服务，保存后会自动设为当前使用。</span>
                      </section>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="settings-pane contact-settings-pane" data-settings-tab="contact">
                <div className="settings-pane-heading">
                  <h2>联系与反馈</h2>
                  <p>遇到问题或有新的想法，可以通过以下方式联系。</p>
                </div>

                <a
                  className="feedback-form-link"
                  href={FEEDBACK_FORM_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="feedback-form-icon"><ListChecks aria-hidden="true" size={21} /></span>
                  <span className="feedback-form-copy">
                    <strong>需求登记表</strong>
                    <small>前往飞书填写问题、建议或功能需求</small>
                  </span>
                  <ExternalLink aria-hidden="true" size={19} />
                </a>

                <section aria-label="联系方式" className="contact-channel-list">
                  {CONTACT_CHANNELS.map(({ id, label, value, icon: Icon, href }) => (
                    <div className="contact-channel-row" key={id}>
                      <span className="contact-channel-icon"><Icon aria-hidden="true" size={20} /></span>
                      <span className="contact-channel-copy">
                        <small>{label}</small>
                        {href ? <a href={href}>{value}</a> : <strong>{value}</strong>}
                      </span>
                      <button
                        aria-label={`复制${label}`}
                        className="contact-copy-button"
                        onClick={() => copyContact(label, value)}
                        title={`复制${label}`}
                        type="button"
                      >
                        <Copy aria-hidden="true" size={18} />
                      </button>
                    </div>
                  ))}
                </section>
              </div>
            )}
          </section>
        </div>
      </main>

    </div>
  )
}
