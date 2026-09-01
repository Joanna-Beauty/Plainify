import { seedTerms } from './seedTerms.js'

const seedTermIds = new Set(seedTerms.map((term) => term.id))

export function hasPersonalTerm(terms = []) {
  return terms.some((term) => term?.id && !seedTermIds.has(term.id))
}

export function isModelSetupError(error) {
  const code = String(error?.code || '')
  return code === 'backend_not_configured' || code.endsWith('_not_configured')
}

export function getOnboardingProgress({ modelConfigured, extensionReady, terms }) {
  const steps = {
    model: Boolean(modelConfigured),
    extension: Boolean(extensionReady),
    firstTerm: hasPersonalTerm(terms),
  }
  const completedCount = Object.values(steps).filter(Boolean).length
  return {
    steps,
    completedCount,
    complete: completedCount === Object.keys(steps).length,
  }
}
