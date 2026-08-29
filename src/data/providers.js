export const modelProviders = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: '适合中文解释，价格相对轻量。',
    adapterId: 'deepseek-official',
    baseUrl: 'https://api.deepseek.com/v1',
    keyPlaceholder: 'sk-...',
    defaultModel: 'deepseek-chat',
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: '支持 GPT 系列模型。',
    adapterId: 'openai-official',
    baseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-proj-...',
    defaultModel: 'gpt-4o-mini',
    fallbackModels: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'],
  },
]

export const deepSeekProvider = modelProviders[0]
export const openAiProvider = modelProviders[1]

export function getProvider(providerId = 'deepseek') {
  return modelProviders.find((provider) => provider.id === providerId) || deepSeekProvider
}

export function normalizeProviderSettings(settings = {}) {
  const storedProvider = String(settings.provider || '')
  const inferredProvider = /^gpt-|^o\d/i.test(String(settings.model || '')) ? 'openai' : 'deepseek'
  const provider = getProvider(modelProviders.some((item) => item.id === storedProvider) ? storedProvider : inferredProvider)
  const hoverExplanationMode = ['explanation', 'analogy', 'both'].includes(settings.hoverExplanationMode)
    ? settings.hoverExplanationMode
    : 'explanation'
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
  return {
    ...normalized,
    provider: provider.id,
    model: String(settings.model || '').trim() || provider.defaultModel,
    modelCatalogs,
    autoExplain: settings.autoExplain !== false,
    hoverExplanationMode,
  }
}
