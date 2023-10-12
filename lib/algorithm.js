// @ts-ignore
const multicb = require('multicb')
const p = require('promisify-4loc')
const { BloomFilter } = require('bloom-filters')
const MsgV3 = require('ppppp-db/msg-v3')
const { EMPTY_RANGE, isEmptyRange, estimateMsgCount } = require('./range')

/**
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {import('ppppp-db/msg-v3').Msg} Msg
 * @typedef {import('ppppp-goals').Goal} Goal
 * @typedef {import('./range').Range} Range
 * @typedef {string} MsgID
 */

/**
 * @param {Iterable<unknown>} iter
 */
function countIter(iter) {
  let count = 0
  for (const _ of iter) count++
  return count
}

class Algorithm {
  /** @type {{ db: PPPPPDB }} */
  #peer

  /** @param {{ db: PPPPPDB }} peer */
  constructor(peer) {
    this.#peer = peer
  }

  /**
   * @param {string} rootID
   * @returns {Range}
   */
  haveRange(rootID) {
    const rootMsg = this.#peer.db.get(rootID)
    if (!rootMsg) return EMPTY_RANGE
    let minDepth = Number.MAX_SAFE_INTEGER
    let maxDepth = 0
    for (const rec of this.#peer.db.records()) {
      if (!rec?.msg?.data) continue
      const tangles = rec.msg.metadata.tangles
      if (rec.id === rootID) {
        minDepth = 0
      } else if (tangles[rootID]) {
        const depth = tangles[rootID].depth
        minDepth = Math.min(minDepth, depth)
        maxDepth = Math.max(maxDepth, depth)
      }
    }
    return [minDepth, maxDepth]
  }

  /**
   * @param {Range} localHaveRange
   * @param {Range} remoteHaveRange
   * @returns {Range}
   */
  #wantAllRange(localHaveRange, remoteHaveRange) {
    return remoteHaveRange
  }

  /**
   * @param {Range} localHaveRange
   * @param {Range} remoteHaveRange
   * @param {number} count
   * @returns {Range}
   */
  #wantNewestRange(localHaveRange, remoteHaveRange, count) {
    const [minLocalHave, maxLocalHave] = localHaveRange
    const [minRemoteHave, maxRemoteHave] = remoteHaveRange
    if (maxRemoteHave <= maxLocalHave) return EMPTY_RANGE
    const maxWant = maxRemoteHave
    const size = Math.max(maxWant - maxLocalHave, count)
    const minWant = Math.max(maxWant - size, minRemoteHave)
    return [minWant, maxWant]
  }

  /**
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
    if (!goal) return EMPTY_RANGE
    if (isEmptyRange(remoteHave)) return EMPTY_RANGE
    if (goal.type === 'all' || goal.type === 'set' || goal.type === 'record') {
      return this.#wantAllRange(localHave, remoteHave)
    } else if (goal.type === 'newest') {
      return this.#wantNewestRange(localHave, remoteHave, goal.count)
    } else if (goal.type === 'oldest') {
      return this.#wantOldestRange(localHave, remoteHave, goal.count)
    }
    return EMPTY_RANGE
  }

  /**
   * @param {string} rootID
   * @param {number} round
   * @param {Range} range
   * @param {Iterable<string>} extraIds
   * @returns {JSON}
   */
  bloomFor(rootID, round, range, extraIds = []) {
    const filterSize =
      (isEmptyRange(range) ? 2 : estimateMsgCount(range)) + countIter(extraIds)
    const filter = BloomFilter.create(2 * filterSize, 0.00001)
    if (!isEmptyRange(range)) {
      for (const msg of this.yieldMsgsIn(rootID, range)) {
        filter.add('' + round + MsgV3.getMsgID(msg))
      }
    }
    for (const msgId of extraIds) {
      filter.add('' + round + msgId)
    }
    return filter.saveAsJSON()
  }

  /**
   * @param {string} rootID
   * @param {number} round
   * @param {Range} range
   * @param {JSON} remoteBloomJSON
   * @returns
   */
  msgsMissing(rootID, round, range, remoteBloomJSON) {
    if (isEmptyRange(range)) return []
    const remoteFilter = BloomFilter.fromJSON(remoteBloomJSON)
    const missing = []
    for (const msg of this.yieldMsgsIn(rootID, range)) {
      const msgID = MsgV3.getMsgID(msg)
      if (!remoteFilter.has('' + round + msgID)) {
        missing.push(msgID)
      }
    }
    return missing
  }

  /**
   * @param {string} rootID
   * @param {Range} range
   */
  *yieldMsgsIn(rootID, range) {
    const [minDepth, maxDepth] = range
    const rootMsg = this.#peer.db.get(rootID)
    if (!rootMsg) return
    if (minDepth === 0) yield rootMsg
    for (const msg of this.#peer.db.msgs()) {
      const tangles = msg.metadata.tangles
      if (
        tangles[rootID] &&
        tangles[rootID].depth >= minDepth &&
        tangles[rootID].depth <= maxDepth
      ) {
        yield msg
      }
    }
  }

  /**
   * @param {string} rootID
   * @param {number} count
   */
  async pruneNewest(rootID, count) {
    const tangle = this.#peer.db.getTangle(rootID)
    const sorted = tangle.topoSort()
    if (sorted.length <= count) return
    const msgID = sorted[sorted.length - count] // New "oldest dataful msg"
    const { deletables, erasables } = tangle.getDeletablesAndErasables(msgID)
    const del = p(this.#peer.db.del)
    const erase = p(this.#peer.db.erase)
    for (const msgID of deletables) {
      await del(msgID)
    }
    for (const msgID of erasables) {
      await erase(msgID)
    }
  }

  /**
   * Filter out msgs I didn't actually ask for. "Trust but verify"
   * @param {string} rootID
   * @param {Array<Msg>} msgs
   * @param {Range} myWantRange
   * @returns {Array<Msg>}
   */
  #filterReceivedMsgs(rootID, msgs, myWantRange) {
    const [minWant, maxWant] = myWantRange

    const validNewMsgs = msgs
      .filter((msg) => {
        const depth = msg.metadata.tangles[rootID]?.depth ?? 0
        if (depth === 0 && MsgV3.getMsgID(msg) !== rootID) {
          return false // the rootMsg is the only acceptable depth-zero msg
        }
        if (!msg.data) {
          return depth < minWant
        } else {
          return minWant <= depth && depth <= maxWant
        }
      })
      .sort((a, b) => {
        const aDepth = a.metadata.tangles[rootID]?.depth ?? 0
        const bDepth = b.metadata.tangles[rootID]?.depth ?? 0
        return aDepth - bDepth
      })

    return validNewMsgs
  }

  /**
   * @param {string} rootID
   * @param {Array<Msg>} newMsgs
   * @param {Goal} goal
   * @param {Range} myWantRange
   */
  async commit(rootID, newMsgs, goal, myWantRange) {
    const validNewMsgs = this.#filterReceivedMsgs(rootID, newMsgs, myWantRange)

    // TODO: Simulate adding this whole tangle, and check if it's valid

    // Add new messages
    const doneAdding = multicb({ pluck: 1 })
    for (const msg of validNewMsgs) {
      this.#peer.db.add(msg, rootID, doneAdding())
    }
    try {
      await p(doneAdding)()
    } catch (err) {
      // TODO:
      // debug('commit failed %o', err)
    }

    if (goal.type === 'newest') {
      return await this.pruneNewest(rootID, goal.count)
    }
    if (goal.type === 'oldest') {
      throw new Error('not implemented') // TODO
    }
  }

  /**
   * @param {string} rootID
   * @param {Set<string>} msgIDs
   * @returns {Array<Msg>}
   */
  getTangleSlice(rootID, msgIDs) {
    if (msgIDs.size === 0) return []
    const tangle = this.#peer.db.getTangle(rootID)
    const sorted = tangle.topoSort()
    let oldestMsgID = null
    for (const msgID of sorted) {
      if (msgIDs.has(msgID)) {
        oldestMsgID = msgID
        break
      }
    }
    if (oldestMsgID === null) {
      throw new Error('No common msgID found in tangle given inputs')
    }
    const { erasables } = tangle.getDeletablesAndErasables(oldestMsgID)

    const msgs = []
    for (const msgID of sorted) {
      let isErasable = erasables.has(msgID)
      if (!msgIDs.has(msgID) && !isErasable) continue
      const msg = this.#peer.db.get(msgID)
      if (!msg) continue
      if (isErasable) {
        msgs.push({ ...msg, data: null })
      } else {
        msgs.push(msg)
      }
    }
    return msgs
  }
}

module.exports = Algorithm
