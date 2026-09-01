export const modelProviders = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: '适合中文解释，价格相对轻量。',
    shortName: 'DS',
    color: '#4f6fe8',
    adapterId: 'deepseek-official',
    protocol: 'OpenAI 兼容',
    baseUrl: 'https://api.deepseek.com/v1',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-...',
    defaultModel: 'deepseek-chat',
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: '支持 GPT 系列模型。',
    shortName: 'OA',
    color: '#20231f',
    adapterId: 'openai-official',
    protocol: 'OpenAI 原生',
    baseUrl: 'https://api.openai.com/v1',
    consoleUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-proj-...',
    defaultModel: 'gpt-4o-mini',
    fallbackModels: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'],
  },
  {
    id: 'qwen',
    name: '阿里云百炼',
    description: '支持通义千问及百炼文本模型。',
    shortName: 'QW',
    color: '#d75a00',
    adapterId: 'dashscope-compatible',
    protocol: 'OpenAI 兼容',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    consoleUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    keyPlaceholder: 'sk-...',
    defaultModel: 'qwen-plus',
    fallbackModels: ['qwen-plus', 'qwen3.8-max', 'qwen3.7-plus'],
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI',
    description: '支持 Kimi 系列文本模型。',
    shortName: 'KM',
    color: '#6f55c8',
    adapterId: 'moonshot-compatible',
    protocol: 'OpenAI 兼容',
    baseUrl: 'https://api.moonshot.cn/v1',
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyPlaceholder: 'sk-...',
    defaultModel: 'kimi-k3',
    fallbackModels: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.5'],
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    description: '支持 GLM 系列文本模型。',
    shortName: 'GL',
    color: '#1769c2',
    adapterId: 'zhipu-compatible',
    protocol: 'OpenAI 兼容',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    consoleUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    keyPlaceholder: '请输入智谱 API Key',
    defaultModel: 'glm-5.3-flash',
    fallbackModels: ['glm-5.3-flash', 'glm-5.3', 'glm-5.2'],
  },
]

export const deepSeekProvider = modelProviders[0]
export const openAiProvider = modelProviders[1]

export function getProvider(providerId = 'deepseek') {
  return modelProviders.find((provider) => provider.id === providerId) || deepSeekProvider
}

export function normalizeProviderSettings(settings = {}) {
  const storedProvider = String(settings.provider || '')
  const storedModel = String(settings.model || '').trim()
  const inferredProvider = /^gpt-|^o\d/i.test(storedModel)
    ? 'openai'
    : /^qwen/i.test(storedModel)
      ? 'qwen'
      : /^(?:kimi-|moonshot-)/i.test(storedModel)
        ? 'moonshot'
        : /^glm-/i.test(storedModel)
          ? 'zhipu'
          : 'deepseek'
  const provider = getProvider(modelProviders.some((item) => item.id === storedProvider) ? storedProvider : inferredProvider)
  const hoverExplanationMode = ['explanation', 'analogy', 'both'].includes(settings.hoverExplanationMode)
    ? settings.hoverExplanationMode
    : 'both'
  const normalized = { ...settings }
  delete normalized.apiKey
  delete normalized.baseUrl
  const storedCatalogs = settings.modelCatalogs && typeof settings.modelCatalogs === 'object'
    ? settings.modelCatalogs
    : {}
  const modelCatalogs = Object.fromEntries(modelProviders.map((item) => {
    const storedModels = Array.isArray(storedCatalogs[item.id]) ? storedCatalogs[item.id] : []
    return [item.id, [...new Set(storedModels
      .map((model) => String(model || '').trim())
      .filter((model) => model && model !== item.defaultModel))]]
  }))
  const storedProviderModels = settings.providerModels && typeof settings.providerModels === 'object'
    ? settings.providerModels
    : {}
  const providerModels = Object.fromEntries(modelProviders.map((item) => [
    item.id,
    String(storedProviderModels[item.id] || (item.id === provider.id ? storedModel : '')).trim() || item.defaultModel,
  ]))
  return {
    ...normalized,
    provider: provider.id,
    model: storedModel || providerModels[provider.id],
    modelCatalogs,
    providerModels,
    autoExplain: settings.autoExplain !== false,
    hoverExplanationMode,
  }
}
