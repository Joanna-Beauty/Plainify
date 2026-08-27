(() => {
  function normalizeHighlightTerms(items) {
    const byName = new Map()
    for (const rawItem of Array.isArray(items) ? items : []) {
      if (!rawItem?.term || rawItem.archived === true) continue
      const item = {
        ...rawItem,
        term: String(rawItem.term).trim(),
        explanation: rawItem.explanation || '',
        analogy: rawItem.analogy || '',
      }
      const key = item.term.toLowerCase()
      const existing = byName.get(key)
      byName.set(key, existing ? {
        ...item,
        ...existing,
        explanation: existing.explanation || item.explanation,
        analogy: existing.analogy || item.analogy,
      } : item)
    }
    return [...byName.values()]
      .map((item) => ({
        ...item,
        explanation: item.explanation || '已收录，等待生成大白话解释。',
        analogy: item.analogy || '已收录，等待生成生活化类比。',
      }))
      .sort((a, b) => b.term.length - a.term.length)
  }

  globalThis.BaihuabenTermData = Object.freeze({ normalizeHighlightTerms })
})()
