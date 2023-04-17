const { BloomFilter } = require('bloom-filters')
const FeedV1 = require('ppppp-db/lib/feed-v1')
const p = require('util').promisify
const { isEmptyRange, estimateMsgCount } = require('./range')
const { parseGoal } = require('./goal')

/**
 * @typedef {import('./range').Range} Range
 */

/**
 * @typedef {import('./goal').Goal} Goal
 */

function countIter(iter) {
  let count = 0
  for (const _ of iter) count++
  return count
}

class Algorithm {
  #peer

  constructor(peer) {
    this.#peer = peer
  }

  haveRange(rootMsgHash) {
    const rootMsg = this.#peer.db.get(rootMsgHash)
    if (!rootMsg) return [1, 0]
    let maxDepth = 0
    for (const rec of this.#peer.db.records()) {
      const tangles = rec.msg.metadata.tangles
      if (rec.hash !== rootMsgHash && tangles[rootMsgHash]) {
        const depth = tangles[rootMsgHash].depth
        maxDepth = Math.max(maxDepth, depth)
      }
    }
    return [0, maxDepth]
  }

  /**
   * @param {string} rootMsgHash
   * @param {Range} localHaveRange
   * @param {Range} remoteHaveRange
   * @returns {Range}
   */
  #wantAllRange(localHaveRange, remoteHaveRange) {
    return remoteHaveRange
  }

  /**
   * @param {string} rootMsgHash
   * @param {Range} localHaveRange
   * @param {Range} remoteHaveRange
   * @param {number} count
   * @returns {Range}
   */
  #wantNewestRange(localHaveRange, remoteHaveRange, count) {
    const [minLocalHave, maxLocalHave] = localHaveRange
    const [minRemoteHave, maxRemoteHave] = remoteHaveRange
    if (maxRemoteHave <= maxLocalHave) return [1, 0]
    const maxWant = maxRemoteHave
    const size = Math.max(maxWant - maxLocalHave, count)
    const minWant = Math.max(maxWant - size, maxLocalHave + 1, minRemoteHave)
    return [minWant, maxWant]
  }

  /**
   * @param {string} rootMsgHash
   * @param {Range} localHaveRange
   * @param {Range} remoteHaveRange
   * @param {number} count
   * @returns {Range}
   */
  #wantOldestRange(localHaveRange, remoteHaveRange, count) {
    // TODO: implement
    throw new Error('not implemented')
  }

  /**
   * @param {Range} localHave
   * @param {Range} remoteHave
   * @param {Goal?} goal
   * @returns {Range}
   */
  wantRange(localHave, remoteHave, goal) {
    if (!goal) return [1, 0]
    if (isEmptyRange(remoteHave)) return [1, 0]
    const { type, count } = parseGoal(goal)
    if (type === 'all') {
      return this.#wantAllRange(localHave, remoteHave)
    } else if (type === 'newest') {
      return this.#wantNewestRange(localHave, remoteHave, count)
    } else if (type === 'oldest') {
      return this.#wantOldestRange(localHave, remoteHave, count)
    }
  }

  bloomFor(rootMsgHash, round, range, extraIds = []) {
    const filterSize =
      (isEmptyRange(range) ? 2 : estimateMsgCount(range)) + countIter(extraIds)
    const filter = BloomFilter.create(2 * filterSize, 0.00001)
    if (!isEmptyRange(range)) {
      for (const msg of this.yieldMsgsIn(rootMsgHash, range)) {
        filter.add('' + round + FeedV1.getMsgHash(msg))
      }
    }
    for (const msgId of extraIds) {
      filter.add('' + round + msgId)
    }
    return filter.saveAsJSON()
  }

  msgsMissing(rootMsgHash, round, range, remoteBloomJSON) {
    if (isEmptyRange(range)) return []
    const remoteFilter = BloomFilter.fromJSON(remoteBloomJSON)
    const missing = []
    for (const msg of this.yieldMsgsIn(rootMsgHash, range)) {
      const msgHash = FeedV1.getMsgHash(msg)
      if (!remoteFilter.has('' + round + msgHash)) {
        missing.push(msgHash)
      }
    }
    return missing
  }

  *yieldMsgsIn(rootMsgHash, range) {
    const [minDepth, maxDepth] = range
    const rootMsg = this.#peer.db.get(rootMsgHash)
    if (!rootMsg) return
    for (const msg of this.#peer.db.msgs()) {
      const tangles = msg.metadata.tangles
      if (
        tangles[rootMsgHash] &&
        tangles[rootMsgHash].depth >= minDepth &&
        tangles[rootMsgHash].depth <= maxDepth
      ) {
        yield msg
      }
    }
  }

  async pruneNewest(rootMsgHash, count) {
    const tangle = this.#peer.db.getTangle(rootMsgHash)
    const sorted = tangle.topoSort()
    if (sorted.length <= count) return
    const msgHash = sorted[sorted.length - count]
    const { deletables, erasables } = tangle.getDeletablesAndErasables(msgHash)
    const del = p(this.#peer.db.del)
    const erase = p(this.#peer.db.erase)
    for (const msgHash of deletables) {
      await del(msgHash)
    }
    for (const msgHash of erasables) {
      await erase(msgHash)
    }
  }

  async commit(newMsgs, rootMsgHash, goal) {
    // Add new messages
    newMsgs.sort((a, b) => {
      const aDepth = a.metadata.tangles[rootMsgHash].depth
      const bDepth = b.metadata.tangles[rootMsgHash].depth
      return aDepth - bDepth
    })
    // FIXME: if invalid (does not reach root), reject
    // FIXME: if newMsgs are too new, drop my tangle and reset
    // FIXME: if newMsgs are too old, reject newMsgs
    for (const msg of newMsgs) {
      await p(this.#peer.db.add)(msg, rootMsgHash)
    }

    const { type, count } = parseGoal(goal)
    if (type === 'newest') return await this.pruneNewest(rootMsgHash, count)
    if (type === 'oldest') throw new Error('not implemented') // TODO:
  }

  getMsgs(msgIds) {
    const msgs = []
    for (const msgId of msgIds) {
      const msg = this.#peer.db.get(msgId)
      if (msg) msgs.push(msg)
    }
    return msgs
  }
}

module.exports = Algorithm
