export const deepSeekProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  defaultModel: 'deepseek-chat',
  fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
}

export function getProvider() {
  return deepSeekProvider
}

export function normalizeProviderSettings(settings = {}) {
  const storedModel = String(settings.model || '')
  const isDeepSeekModel = /^deepseek(?:-|$)/i.test(storedModel)
  const hoverExplanationMode = ['explanation', 'analogy', 'both'].includes(settings.hoverExplanationMode)
    ? settings.hoverExplanationMode
    : 'explanation'
  const normalized = { ...settings }
  delete normalized.apiKey
  delete normalized.baseUrl
  delete normalized.provider
  return {
    ...normalized,
    model: isDeepSeekModel ? storedModel : deepSeekProvider.defaultModel,
    autoExplain: settings.autoExplain !== false,
    hoverExplanationMode,
  }
}
