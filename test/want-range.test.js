const test = require('node:test')
const assert = require('node:assert')
const Algorithm = require('../lib/algorithm')

const EMPTY = [1, 0]

test('want-range for goal=newest-3', (t) => {
  const algo = new Algorithm({ db: null })
  const goal = { type: 'newest', count: 3 }

  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 3], goal), [2, 3])
  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 5], goal), [3, 5])
  assert.deepStrictEqual(algo.wantRange([1, 3], [2, 4], goal), [2, 4])
  assert.deepStrictEqual(algo.wantRange([1, 5], [2, 4], goal), [3, 4])
  assert.deepStrictEqual(algo.wantRange([1, 3], [4, 6], goal), [4, 6])
  assert.deepStrictEqual(algo.wantRange([4, 6], [1, 3], goal), EMPTY)
  assert.deepStrictEqual(algo.wantRange([1, 3], [6, 7], goal), [6, 7])
})

test('want-range for goal=all', (t) => {
  const algo = new Algorithm({ db: null })
  const goal = { type: 'all' }

  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 3], goal), [1, 3])
  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 5], goal), [1, 5])
  assert.deepStrictEqual(algo.wantRange([1, 3], [2, 4], goal), [2, 4])
  assert.deepStrictEqual(algo.wantRange([1, 5], [2, 4], goal), [2, 4])
  assert.deepStrictEqual(algo.wantRange([1, 3], [4, 6], goal), [4, 6])
  assert.deepStrictEqual(algo.wantRange([4, 6], [1, 3], goal), [1, 3])
  assert.deepStrictEqual(algo.wantRange([1, 3], [6, 7], goal), [6, 7])
})

test('want-range for goal=dict', (t) => {
  const algo = new Algorithm({ db: null, dict: { minGhostDepth: () => 3 } })
  const goal = { type: 'dict' }

  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 3], goal), [3, 3])
  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 5], goal), [3, 5])
  assert.deepStrictEqual(algo.wantRange([1, 3], [2, 4], goal), [3, 4])
  assert.deepStrictEqual(algo.wantRange([1, 5], [2, 4], goal), [3, 4])
  assert.deepStrictEqual(algo.wantRange([1, 3], [4, 6], goal), [4, 6])
  assert.deepStrictEqual(algo.wantRange([4, 6], [1, 3], goal), [3, 3])
  assert.deepStrictEqual(algo.wantRange([1, 3], [6, 7], goal), [6, 7])
})
