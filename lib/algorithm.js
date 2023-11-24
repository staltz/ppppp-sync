const p = require('promisify-4loc')
const { BloomFilter } = require('bloom-filters')
const MsgV3 = require('ppppp-db/msg-v3')
const makeDebug = require('debug')
const debug = makeDebug('ppppp:sync')
const { EMPTY_RANGE, isEmptyRange, estimateMsgCount } = require('./range')

/**
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {ReturnType<import('ppppp-dict').init>} PPPPPDict
 * @typedef {ReturnType<import('ppppp-set').init>} PPPPPSet
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

/**
 * @param {{ dict: PPPPPDict | null }} peer
 * @returns {asserts peer is { dict: PPPPPDict }}
 */
function assertDictPlugin(peer) {
  if (!peer.dict) {
    throw new Error('sync plugin requires ppppp-dict plugin')
  }
}

/**
 * @param {{ set: PPPPPSet | null }} peer
 * @returns {asserts peer is { set: PPPPPSet }}
 */
function assertSetPlugin(peer) {
  if (!peer.set) {
    throw new Error('sync plugin requires ppppp-set plugin')
  }
}

class Algorithm {
  /** @type {{ db: PPPPPDB, dict: PPPPPDict | null, set: PPPPPSet | null }} */
  #peer

  /** @param {{ db: PPPPPDB, dict: PPPPPDict | null, set: PPPPPSet | null }} peer */
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
      if (!rec?.msg?.data && rec.id !== rootID) continue
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
    if (maxRemoteHave < minLocalHave) return EMPTY_RANGE
    const maxWant = maxRemoteHave
    const size = Math.max(maxWant - maxLocalHave, count)
    const minWant = Math.max(
      maxWant - size + 1,
      maxLocalHave - size + 1,
      minRemoteHave
    )
    return [minWant, maxWant]
  }

  /**
   * @param {number} minGhostDepth
   * @param {Range} remoteHaveRange
   * @returns {Range}
   */
  #wantDictOrSetRange(minGhostDepth, remoteHaveRange) {
    const [minRemoteHave, maxRemoteHave] = remoteHaveRange
    if (maxRemoteHave < minGhostDepth) return EMPTY_RANGE
    const maxWant = maxRemoteHave
    const minWant = Math.max(minGhostDepth, minRemoteHave)
    return [minWant, maxWant]
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

    switch (goal.type) {
      case 'all':
        return this.#wantAllRange(localHave, remoteHave)

      case 'dict':
        assertDictPlugin(this.#peer)
        const minDictGhostDepth = this.#peer.dict.minGhostDepth(goal.id)
        return this.#wantDictOrSetRange(minDictGhostDepth, remoteHave)

      case 'set':
        assertSetPlugin(this.#peer)
        const minSetGhostDepth = this.#peer.set.minGhostDepth(goal.id)
        return this.#wantDictOrSetRange(minSetGhostDepth, remoteHave)

      case 'newest':
        return this.#wantNewestRange(localHave, remoteHave, goal.count)

      case 'none':
        return EMPTY_RANGE

      default:
        throw new Error(`Unrecognized goal type: ${goal.type}`)
    }
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
    const ghosts = this.#peer.db.ghosts.get(rootID)
    for (const ghostMsgID of ghosts) {
      // No need to check depths because the `range` is by definition taking
      // into account local ghost depths
      filter.add('' + round + ghostMsgID)
    }
    for (const msgID of extraIds) {
      filter.add('' + round + msgID)
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
          return depth <= maxWant
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
    for (const msg of validNewMsgs) {
      try {
        await p(this.#peer.db.add)(msg, rootID) //, doneAdding())
      } catch (err) {
        debug('Commit failed to add msg in db: %o', err)
      }
    }

    if (goal.type === 'newest') {
      return await this.pruneNewest(rootID, goal.count)
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
