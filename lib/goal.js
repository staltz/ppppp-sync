/**
 * @typedef {'all'} GoalAll
 */

/**
 * @typedef {`newest-${number}`} GoalNewest
 */

/**
 * @typedef {`oldest-${number}`} GoalOldest
 */

/**
 * @typedef {GoalAll|GoalNewest|GoalOldest} Goal
 */

/**
 * @typedef {{type: 'all'; count: never}} ParsedAll
 */

/**
 * @typedef {{type: 'newest' |'oldest'; count: number}} ParsedLimited
 */

/**
 * @typedef {ParsedAll | ParsedLimited} ParsedGoal
 */

/**
 * @param {Goal} goal
 * @returns {ParsedGoal}
 */
function parseGoal(goal) {
  if (goal === 'all') {
    return { type: 'all' }
  }

  const matchN = goal.match(/^newest-(\d+)$/)
  if (matchN) {
    return { type: 'newest', count: Number(matchN[1]) }
  }

  const matchO = goal.match(/^oldest-(\d+)$/)
  if (matchO) {
    return { type: 'oldest', count: Number(matchO[1]) }
  }

  throw new Error(`Invalid goal: ${goal}`)
}

module.exports = {
  parseGoal,
}
