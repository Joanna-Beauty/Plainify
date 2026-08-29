import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Copy,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  FileCog,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plus,
  Puzzle,
  RefreshCcw,
  Save,
  Settings2,
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
  openLocalConfigFile,
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

function uniqueModels(...groups) {
  return [...new Set(groups.flat().map((model) => String(model || '').trim()).filter(Boolean))]
}

function comparableBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function providerCatalog(settings, provider) {
  return uniqueModels(settings.modelCatalogs?.[provider.id] || [])
    .filter((model) => model !== provider.defaultModel)
}

function modelDisplayName(modelId) {
  return String(modelId)
    .split('-')
    .map((part) => {
      if (/^gpt$/i.test(part)) return 'GPT'
      if (/^deepseek$/i.test(part)) return 'DeepSeek'
      if (/^o\d/i.test(part)) return part.toUpperCase()
      if (/^\d/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

export default function SettingsPage({
  settings,
  onClose,
  onSave,
  extensionReady,
  onSyncExtension,
  showToast,
}) {
  const normalizedSettings = useMemo(() => normalizeProviderSettings(settings), [settings])
  const showToastRef = useRef(showToast)
  const apiKeyInputRef = useRef(null)
  const [activeTab, setActiveTab] = useState('general')
  const [draft, setDraft] = useState(normalizedSettings)
  const [providers, setProviders] = useState(() => modelProviders.map((provider) => ({
    ...provider,
    configured: false,
    keyLastFour: '',
  })))
  const [activeProviderId, setActiveProviderId] = useState(normalizedSettings.provider)
  const [selectedModelsByProvider, setSelectedModelsByProvider] = useState(() => ({
    [normalizedSettings.provider]: normalizedSettings.model,
  }))
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [providerEditorMode, setProviderEditorMode] = useState('add')
  const [customSettingsOpen, setCustomSettingsOpen] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState(normalizedSettings.provider)
  const [editorCatalog, setEditorCatalog] = useState([])
  const [editorModel, setEditorModel] = useState(normalizedSettings.model)
  const [apiKey, setApiKey] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingProvider, setSavingProvider] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [openingConfig, setOpeningConfig] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState([])
  const [checkedModels, setCheckedModels] = useState(() => new Set())
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
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
  const catalogModelSet = useMemo(() => new Set(editorCatalog), [editorCatalog])
  const modelsAvailableToAdd = useMemo(
    () => availableModels.filter((model) => (
      model !== selectedProvider.defaultModel && !catalogModelSet.has(model)
    )),
    [availableModels, catalogModelSet, selectedProvider.defaultModel],
  )
  const allModelsChecked = modelsAvailableToAdd.length > 0
    && modelsAvailableToAdd.every((model) => checkedModels.has(model))

  useEffect(() => {
    showToastRef.current = showToast
  }, [showToast])

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
      if (modelDialogOpen) setModelDialogOpen(false)
      else if (providerEditorOpen) setProviderEditorOpen(false)
      else onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [modelDialogOpen, onClose, providerEditorOpen])

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
      }))
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
      : selectedModelsByProvider[provider.id] || provider.defaultModel
    setSelectedProviderId(provider.id)
    setEditorModel(nextModel)
    setEditorCatalog(providerCatalog(draft, provider))
    setProviderEditorMode(mode)
    setCustomSettingsOpen(false)
    setApiKey('')
    setApiBaseUrl(currentStatus?.baseUrl || provider.baseUrl)
    setShowKey(false)
    setAvailableModels([])
    setCheckedModels(new Set())
    setModelDialogOpen(false)
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
    setCheckedModels(new Set())
    setModelDialogOpen(false)
  }

  function selectSettingsTab(tabId) {
    if (tabId === activeTab) return
    closeProviderEditor()
    setCustomSettingsOpen(false)
    setActiveTab(tabId)
  }

  function selectProvider(providerId) {
    resetProviderEditor(providerId, 'add')
  }

  function nextSettingsFor(provider, model, catalog = editorCatalog) {
    return normalizeProviderSettings({
      ...draft,
      provider: provider.id,
      model,
      modelCatalogs: {
        ...draft.modelCatalogs,
        [provider.id]: uniqueModels(catalog).filter((item) => item !== provider.defaultModel),
      },
    })
  }

  function applySavedProvider(result, catalog = editorCatalog) {
    const provider = getProvider(result.activeProvider)
    const activeModel = result.activeModel || provider.defaultModel
    const nextCatalog = uniqueModels(catalog, result.models || [])
      .filter((model) => model !== provider.defaultModel)
    const next = nextSettingsFor(provider, activeModel, nextCatalog)
    setProviders((current) => current.map((item) => item.id === provider.id
      ? { ...item, ...result.provider, configured: true }
      : item))
    setActiveProviderId(provider.id)
    setSelectedProviderId(provider.id)
    setSelectedModelsByProvider((current) => ({ ...current, [provider.id]: activeModel }))
    setEditorModel(activeModel)
    setEditorCatalog(nextCatalog)
    setApiBaseUrl(result.provider?.baseUrl || provider.baseUrl)
    setDraft(next)
    setBackend((current) => ({
      ...current,
      connected: true,
      configured: true,
      ready: true,
      providerStatus: 'ready',
      recoverable: false,
    }))
    onSave(next)
    return next
  }

  async function saveProvider(event) {
    event.preventDefault()
    if (providerEditorMode === 'add' && !apiKey.trim()) {
      showToast(`请粘贴 ${selectedProvider.name} API Key。`)
      apiKeyInputRef.current?.focus()
      return
    }

    setSavingProvider(true)
    try {
      const baseUrlChanged = comparableBaseUrl(apiBaseUrl) !== comparableBaseUrl(providerStatus.baseUrl || selectedProvider.baseUrl)
      if (apiKey.trim() || providerEditorMode === 'add' || baseUrlChanged) {
        const result = await saveProviderCredential(
          selectedProvider.id,
          apiKey.trim(),
          editorModel,
          apiBaseUrl.trim(),
        )
        applySavedProvider(result)
        setApiKey('')
        setShowKey(false)
        setProviderEditorMode('edit')
        setCustomSettingsOpen(true)
        showToast(`${selectedProvider.name} 配置已验证并保存在本机。`, 'success')
      } else {
        const result = await activateProvider(selectedProvider.id, editorModel)
        const next = nextSettingsFor(selectedProvider, result.activeModel)
        setActiveProviderId(result.activeProvider)
        setSelectedModelsByProvider((current) => ({
          ...current,
          [result.activeProvider]: result.activeModel,
        }))
        setDraft(next)
        onSave(next)
        showToast(
          result.activeModel === selectedProvider.defaultModel
            ? `已恢复为 ${selectedProvider.name} 官方默认模型。`
            : `已切换到 ${selectedProvider.name} · ${result.activeModel}。`,
          'success',
        )
      }
    } catch (error) {
      showToast(error.message)
    } finally {
      setSavingProvider(false)
    }
  }

  async function fetchAvailableModels() {
    setLoadingModels(true)
    try {
      const remoteModels = await fetchProviderModels({
        provider: selectedProvider.id,
        apiKey: apiKey.trim(),
        baseUrl: apiBaseUrl.trim(),
      })
      const discoveredModels = uniqueModels(remoteModels)
      const selectableModels = discoveredModels.filter((model) => (
        model !== selectedProvider.defaultModel && !catalogModelSet.has(model)
      ))
      setAvailableModels(discoveredModels)
      setCheckedModels(new Set(selectableModels))
      setModelDialogOpen(true)
    } catch (error) {
      showToast(error.message)
    } finally {
      setLoadingModels(false)
    }
  }

  function addSelectedModels() {
    const selectedModels = modelsAvailableToAdd.filter((model) => checkedModels.has(model))
    if (!selectedModels.length) return
    setEditorCatalog((current) => uniqueModels(current, selectedModels))
    setModelDialogOpen(false)
    showToast(`已选择 ${selectedModels.length} 个模型，点击保存后生效。`, 'success')
  }

  function restoreDefaultModel() {
    setEditorModel(selectedProvider.defaultModel)
    setEditorCatalog([])
    setAvailableModels([])
    setCheckedModels(new Set())
    setModelDialogOpen(false)
    showToast(`已恢复官方默认模型 ${selectedProvider.defaultModel}，点击保存后生效。`)
  }

  function removeCatalogModel(model) {
    setEditorCatalog((current) => current.filter((item) => item !== model))
    if (editorModel === model) setEditorModel(selectedProvider.defaultModel)
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

  async function openConfig() {
    setOpeningConfig(true)
    try {
      await openLocalConfigFile()
      showToast('已打开本机配置文件。', 'success')
    } catch (error) {
      showToast(error.message)
    } finally {
      setOpeningConfig(false)
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
          <div className="settings-header-actions">
            <button className="config-file-button" disabled={openingConfig} onClick={openConfig} type="button">
              {openingConfig ? <LoaderCircle className="spin" size={17} /> : <FileCog size={17} />}
              打开配置文件
            </button>
            <button aria-label="关闭设置" className="settings-close-button" onClick={onClose} title="关闭设置" type="button">
              <X size={25} />
            </button>
          </div>
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
                  <section className="settings-block">
                    <div className="settings-block-heading">
                      <div><h3>解释与收录</h3><p>控制新术语何时生成解释。</p></div>
                    </div>
                    <label className="preference-row">
                      <span><strong>收录时自动解释</strong><small>关闭后，新术语会先进入待解释状态。</small></span>
                      <input checked={draft.autoExplain} name="autoExplain" onChange={updateGeneral} type="checkbox" />
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
                    </fieldset>
                  </section>

                  <section className="settings-block extension-settings-block">
                    <div className="settings-block-heading">
                      <div><h3>浏览器扩展</h3><p>同步术语和网页悬停偏好。</p></div>
                      <div className={extensionReady ? 'extension-check connected' : 'extension-check'}>
                        {extensionReady ? <CheckCircle2 size={15} /> : <span className="status-dot" />}
                        {extensionReady ? '已连接' : '未连接'}
                      </div>
                    </div>
                    <div className="extension-setting-row">
                      <div className="extension-directory"><span>本地扩展目录</span><code>extension/</code></div>
                      <button className="secondary-button" disabled={!extensionReady} onClick={() => onSyncExtension(draft)} type="button">
                        <Puzzle size={16} />同步到扩展
                      </button>
                    </div>
                  </section>

                  <div className="settings-actions">
                    <button className="primary-button" type="submit"><Save size={16} />保存通用设置</button>
                  </div>
                </form>
              </div>
            ) : activeTab === 'model' ? (
              <div className="settings-pane" data-settings-tab="model">
                <div className="settings-pane-heading model-pane-heading">
                  <h2>模型</h2>
                  <p>填入各提供方的 <mark>API</mark> 密钥即可使用其模型。</p>
                </div>

                <div className="configured-provider-list">
                  {configuredProviders.map((provider) => {
                    const ready = provider.id !== activeProviderId || backend.ready
                    return (
                      <section className="provider-summary" data-provider-id={provider.id} key={provider.id}>
                        <div>
                          <strong>{provider.name}<span className={ready ? 'provider-live-dot ready' : 'provider-live-dot'} /></strong>
                        </div>
                        <button onClick={() => openEditProvider(provider.id)} type="button">编辑</button>
                      </section>
                    )
                  })}
                </div>

                {providerEditorOpen ? (
                  <form className="provider-editor" data-editor-mode={providerEditorMode} onSubmit={saveProvider}>
                    {providerEditorMode === 'edit' ? (
                      <div className="provider-editor-title">
                        <strong>{selectedProvider.name}</strong>
                        <span>{selectedProvider.adapterId}</span>
                      </div>
                    ) : (
                      <label className="provider-select-field">
                        <span>提供方</span>
                        <select onChange={(event) => selectProvider(event.target.value)} value={selectedProvider.id}>
                          {availableProviders.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.name}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="provider-key-field">
                      <span><mark>API</mark> 密钥{providerEditorMode === 'add' ? '（必填）' : ''}</span>
                      <span className="password-field">
                        <KeyRound aria-hidden="true" size={17} />
                        <input
                          autoComplete="off"
                          name={`${selectedProvider.id}ApiKey`}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder={providerStatus.configured ? '已配置，输入新值可替换' : selectedProvider.keyPlaceholder}
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

                    <button
                      aria-expanded={customSettingsOpen}
                      className="custom-settings-toggle"
                      onClick={() => setCustomSettingsOpen((open) => !open)}
                      type="button"
                    >
                      {customSettingsOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      自定义设置
                    </button>

                    {customSettingsOpen ? (
                      <div className="custom-settings-content">
                        <label className="adapter-url-field">
                          <span><mark>API</mark> 地址</span>
                          <input
                            autoComplete="off"
                            onChange={(event) => setApiBaseUrl(event.target.value)}
                            placeholder={selectedProvider.baseUrl}
                            type="url"
                            value={apiBaseUrl}
                          />
                        </label>

                        <section className="model-catalog-section">
                          <div className="model-catalog-heading">
                            <div>
                              <h3>模型目录</h3>
                              <p>
                                正在使用 {editorModel === selectedProvider.defaultModel
                                  ? `${selectedProvider.defaultModel}（官方默认）`
                                  : editorModel}
                              </p>
                            </div>
                            <div className="model-catalog-actions">
                              {editorModel !== selectedProvider.defaultModel || editorCatalog.length ? (
                                <button onClick={restoreDefaultModel} type="button">
                                  <RefreshCcw size={15} />恢复默认模型
                                </button>
                              ) : null}
                              <button
                                disabled={loadingModels}
                                onClick={fetchAvailableModels}
                                title={`获取 ${selectedProvider.name} 可用模型`}
                                type="button"
                              >
                                {loadingModels ? <LoaderCircle className="spin" size={15} /> : <CloudDownload size={15} />}
                                获取可用模型
                              </button>
                            </div>
                          </div>

                          {editorCatalog.length ? (
                            <div className="model-catalog-list">
                              {editorCatalog.map((model) => {
                                const current = editorModel === model
                                return (
                                  <div className={current ? 'model-catalog-row current' : 'model-catalog-row'} data-model-id={model} key={model}>
                                    <span className="model-id-field">{model}</span>
                                    <span className="model-name-field">{modelDisplayName(model)}</span>
                                    <button
                                      aria-label={current ? `${model} 已选择` : `使用 ${model}`}
                                      className="model-activate-button"
                                      disabled={current}
                                      onClick={() => setEditorModel(model)}
                                      title={current ? '已选择' : '设为当前模型'}
                                      type="button"
                                    >
                                      {current ? <Check size={18} /> : <ChevronRight size={19} />}
                                    </button>
                                    <button
                                      aria-label={`从目录移除 ${model}`}
                                      className="model-delete-button"
                                      onClick={() => removeCatalogModel(model)}
                                      title="从目录移除"
                                      type="button"
                                    >
                                      <Trash2 size={18} />
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="model-catalog-empty">
                              <strong>暂未添加自定义模型</strong>
                              <span>当前会使用 {selectedProvider.defaultModel}。</span>
                            </div>
                          )}

                          <button
                            className="add-model-button"
                            disabled={loadingModels}
                            onClick={fetchAvailableModels}
                            title={`从 ${selectedProvider.name} 可用模型中添加`}
                            type="button"
                          >
                            <Plus size={17} />添加模型
                          </button>
                        </section>
                      </div>
                    ) : null}

                    <footer className="provider-editor-footer">
                      {providerEditorMode === 'edit' ? (
                        <button
                          aria-label={`删除 ${selectedProvider.name} 提供方`}
                          className="remove-provider-button"
                          disabled={deleting}
                          onClick={removeKey}
                          title="删除提供方"
                          type="button"
                        >
                          {deleting ? <LoaderCircle className="spin" size={18} /> : <Trash2 size={18} />}
                        </button>
                      ) : <span />}
                      <div>
                        <button className="provider-cancel-button" onClick={closeProviderEditor} type="button">取消</button>
                        <button className="provider-save-button" disabled={savingProvider} type="submit">
                          {savingProvider ? <LoaderCircle className="spin" size={17} /> : null}
                          保存
                        </button>
                      </div>
                    </footer>
                  </form>
                ) : null}

                {(!providerEditorOpen || providerEditorMode === 'edit') && availableProviders.length ? (
                  <button className="add-provider-button" disabled={loading} onClick={openAddProvider} type="button">
                    {loading ? <LoaderCircle className="spin" size={19} /> : <Plus size={21} />}
                    {loading ? '正在读取提供方' : '添加提供方'}
                  </button>
                ) : null}
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

      {modelDialogOpen ? (
        <div className="model-discovery-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setModelDialogOpen(false)
        }}>
          <section aria-labelledby="model-discovery-title" aria-modal="true" className="model-discovery-dialog" role="dialog">
            <header>
              <h2 id="model-discovery-title">选择要添加的模型</h2>
              <button aria-label="关闭模型选择" onClick={() => setModelDialogOpen(false)} title="关闭" type="button"><X size={23} /></button>
            </header>
            <p>以下是 {selectedProvider.name} 的可用模型，勾选要添加到目录的模型。</p>
            <div className="model-discovery-toolbar">
              <button
                disabled={!modelsAvailableToAdd.length}
                onClick={() => setCheckedModels(allModelsChecked ? new Set() : new Set(modelsAvailableToAdd))}
                type="button"
              >
                {allModelsChecked ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="model-discovery-list">
              {modelsAvailableToAdd.length ? modelsAvailableToAdd.map((model) => (
                <label key={model}>
                  <input
                    checked={checkedModels.has(model)}
                    onChange={() => setCheckedModels((current) => {
                      const next = new Set(current)
                      if (next.has(model)) next.delete(model)
                      else next.add(model)
                      return next
                    })}
                    type="checkbox"
                  />
                  <span>{model}</span>
                </label>
              )) : <div className="model-discovery-empty">当前清单中没有其他可添加模型。</div>}
            </div>
            <footer>
              <button className="secondary-button" onClick={() => setModelDialogOpen(false)} type="button">取消</button>
              <button className="primary-button" disabled={!checkedModels.size} onClick={addSelectedModels} type="button">添加所选</button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
