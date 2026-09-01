import assert from 'node:assert/strict'
import { getOnboardingProgress, hasPersonalTerm, isModelSetupError } from '../src/data/onboarding.js'
import { seedTerms } from '../src/data/seedTerms.js'

assert.equal(hasPersonalTerm(seedTerms), false)
assert.equal(hasPersonalTerm([...seedTerms, { id: 'personal-term', term: 'LoRA' }]), true)

const emptyProgress = getOnboardingProgress({
  modelConfigured: false,
  extensionReady: false,
  terms: seedTerms,
})
assert.equal(emptyProgress.completedCount, 0)
assert.equal(emptyProgress.complete, false)

const partialProgress = getOnboardingProgress({
  modelConfigured: true,
  extensionReady: false,
  terms: [...seedTerms, { id: 'personal-term', term: 'LoRA' }],
})
assert.deepEqual(partialProgress.steps, { model: true, extension: false, firstTerm: true })
assert.equal(partialProgress.completedCount, 2)

const completeProgress = getOnboardingProgress({
  modelConfigured: true,
  extensionReady: true,
  terms: [...seedTerms, { id: 'personal-term', term: 'LoRA' }],
})
assert.equal(completeProgress.complete, true)

assert.equal(isModelSetupError({ code: 'backend_not_configured' }), true)
assert.equal(isModelSetupError({ code: 'openai_not_configured' }), true)
assert.equal(isModelSetupError({ code: 'backend_unreachable' }), false)

console.log('PASS 首次上手进度排除示例术语，并识别模型未配置错误')
