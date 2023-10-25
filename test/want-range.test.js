const test = require('node:test')
const assert = require('node:assert')
const p = require('node:util').promisify
const Algorithm = require('../lib/algorithm')

test('want-range for goal=newest-3', async (t) => {
  const algo = new Algorithm({ db: null })
  const goal = { type: 'newest', count: 3 }

  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 3], goal), [2, 3])
  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 5], goal), [3, 5])
  assert.deepStrictEqual(algo.wantRange([1, 3], [2, 4], goal), [2, 4])
  assert.deepStrictEqual(algo.wantRange([1, 5], [2, 4], goal), [3, 4])
  assert.deepStrictEqual(algo.wantRange([1, 3], [4, 6], goal), [4, 6])
  assert.deepStrictEqual(algo.wantRange([4, 6], [1, 3], goal), [1, 0])
  assert.deepStrictEqual(algo.wantRange([1, 3], [6, 7], goal), [6, 7])
})

test('want-range for goal=all', async (t) => {
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

test('want-range for goal=record', async (t) => {
  const algo = new Algorithm({ db: null })
  const goal = { type: 'record' }

  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 3], goal), [2, 3])
  assert.deepStrictEqual(algo.wantRange([2, 4], [1, 5], goal), [2, 5])
  assert.deepStrictEqual(algo.wantRange([1, 3], [2, 4], goal), [2, 4])
  assert.deepStrictEqual(algo.wantRange([1, 5], [2, 4], goal), [2, 4])
  assert.deepStrictEqual(algo.wantRange([1, 3], [4, 6], goal), [4, 6])
  assert.deepStrictEqual(algo.wantRange([4, 6], [1, 3], goal), [1, 0])
  assert.deepStrictEqual(algo.wantRange([1, 3], [6, 7], goal), [6, 7])
})
