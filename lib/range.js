function isEmptyRange(range) {
  const [min, max] = range
  return min > max
}

function estimateMsgCount(range) {
  const [minDepth, maxDepth] = range
  const estimate = 2 * (maxDepth - minDepth + 1)
  if (estimate > 1000) return 1000
  else if (estimate < 5) return 5
  else return estimate
}

module.exports = {
  isEmptyRange,
  estimateMsgCount
}
