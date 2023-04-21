const { BloomFilter } = require('bloom-filters')
const FeedV1 = require('ppppp-db/feed-v1')
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
    let minDepth = Number.MAX_SAFE_INTEGER
    let maxDepth = 0
    for (const rec of this.#peer.db.records()) {
      if (!rec.msg) continue
      const tangles = rec.msg.metadata.tangles
      if (!rec.msg.content) continue
      if (rec.hash === rootMsgHash) {
        minDepth = 0
      } else if (tangles[rootMsgHash]) {
        const depth = tangles[rootMsgHash].depth
        minDepth = Math.min(minDepth, depth)
        maxDepth = Math.max(maxDepth, depth)
      }
    }
    return [minDepth, maxDepth]
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
    if (minDepth === 0) yield rootMsg
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

  async commit(rootMsgHash, newMsgs, goal, myWantRange) {
    // Filter out contentful newMsgs that are not in my want-range
    const [minWant, maxWant] = myWantRange
    const validNewMsgs = newMsgs
      .filter((msg) => {
        if (!msg.content) return true // contentless messages are always valid
        const depth = msg.metadata.tangles[rootMsgHash]?.depth ?? 0
        if (depth === 0 && FeedV1.getMsgHash(msg) !== rootMsgHash) {
          return false // the rootMsg is the only acceptable depth-zero msg
        }
        return minWant <= depth && depth <= maxWant
      })
      .sort((a, b) => {
        const aDepth = a.metadata.tangles[rootMsgHash]?.depth ?? 0
        const bDepth = b.metadata.tangles[rootMsgHash]?.depth ?? 0
        return aDepth - bDepth
      })

    // Simulate adding this whole tangle, and check if it's valid
    let err
    if ((err = this.#peer.db.validateTangle(rootMsgHash, validNewMsgs))) {
      throw err
    }

    // Add new messages TODO: optimize perf, avoiding await / try / catch
    for (const msg of newMsgs) {
      try {
        await p(this.#peer.db.add)(msg, rootMsgHash)
      } catch {}
    }

    // Prune. Ideally this should be in a garbage collection module
    const { type, count } = parseGoal(goal)
    if (type === 'newest') return await this.pruneNewest(rootMsgHash, count)
    if (type === 'oldest') throw new Error('not implemented') // TODO:
  }

  /**
   * @param {string} rootMsgHash
   * @param {Set<string>} msgHashes
   * @returns
   */
  getTangleSlice(rootMsgHash, msgHashes) {
    if (msgHashes.size === 0) return []
    const tangle = this.#peer.db.getTangle(rootMsgHash)
    const sorted = tangle.topoSort()
    let oldestMsgHash = null
    for (const msgHash of sorted) {
      if (msgHashes.has(msgHash)) {
        oldestMsgHash = msgHash
        break
      }
    }
    const { erasables } = tangle.getDeletablesAndErasables(oldestMsgHash)

    const msgs = []
    for (const msgHash of sorted) {
      let isErasable = erasables.includes(msgHash)
      if (!msgHashes.has(msgHash) && !isErasable) continue
      const msg = this.#peer.db.get(msgHash)
      if (!msg) continue
      if (isErasable) {
        msgs.push({ ...msg, content: null })
      } else {
        msgs.push(msg)
      }
    }
    return msgs
  }
}

module.exports = Algorithm
