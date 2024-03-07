/**
 * @typedef {[number, number]} Range
 */

/**
 * @param {Range} range
 * @returns {boolean}
 */
function isEmptyRange(range) {
  const [min, max] = range
  return min > max
}

/**
 * @param {Range} range
 * @returns {number}
 */
function estimateMsgCount(range) {
  const [minDepth, maxDepth] = range
  const estimate = 2 * (maxDepth - minDepth + 1)
  if (estimate > 1000) return 1000
  else if (estimate < 5) return 5
  else return estimate
}

const EMPTY_RANGE = /** @type {Range} */ ([1, 0])

module.exports = {
  isEmptyRange,
  estimateMsgCount,
  EMPTY_RANGE,
}
