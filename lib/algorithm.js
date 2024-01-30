const p = require('promisify-4loc')
const { BloomFilter } = require('bloom-filters')
const MsgV4 = require('ppppp-db/msg-v4')
const makeDebug = require('debug')
const debug = makeDebug('ppppp:sync')
const { EMPTY_RANGE, isEmptyRange, estimateMsgCount } = require('./range')

/**
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {ReturnType<import('ppppp-dict').init>} PPPPPDict
 * @typedef {ReturnType<import('ppppp-set').init>} PPPPPSet
 * @typedef {import('ppppp-db/msg-v4').Msg} Msg
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
  /** @type {ConstructorParameters<typeof Algorithm>[0]} */
  #peer

  /** @param {{ db: PPPPPDB, dict: PPPPPDict, set: PPPPPSet }} peer */
  constructor(peer) {
    this.#peer = peer
  }

  /**
   * Calculates the range ([minDepth, maxDepth]) of msgs that the peer has for
   * the given tangle known by the `rootID`.
   *
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
   * Calculates the range ([minDepth, maxDepth]) of msgs that the peer wants,
   * given the goal "all" and local and remote have ranges.
   *
   * @param {Range} localHaveRange
   * @param {Range} remoteHaveRange
   * @returns {Range}
   */
  #wantAllRange(localHaveRange, remoteHaveRange) {
    return remoteHaveRange
  }

  /**
   * Calculates the range ([minDepth, maxDepth]) of msgs that the peer wants,
   * given the goal "newest" (alongside with a `count` parameter) and local and
   * remote have ranges.
   *
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
   * Calculates the range ([minDepth, maxDepth]) of msgs that the peer wants,
   * given the goal "dict" or "set" and local and remote have ranges.
   *
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
   * Calculates the range ([minDepth, maxDepth]) of msgs that the peer wants,
   * given a `goal`.
   *
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
        const minDictGhostDepth = this.#peer.dict.minGhostDepth(goal.id)
        return this.#wantDictOrSetRange(minDictGhostDepth, remoteHave)

      case 'set':
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
   * Returns a bloom filter that represents the msgs that this peer has in the
   * database, matching the given tangle `rootID` and `range`. The `round` is
   * used to identify bloom filter items from different rounds.
   *
   * The bloom filter also includes account msgs that are outside the tangle
   * `rootID`, but required for validation of tangle `rootID` msgs.
   *
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
      const rangeMsgs = this.getMsgsInRange(rootID, range)
      const accountMsgs = this.getAccountMsgsFor(rangeMsgs)
      for (const msg of accountMsgs.concat(rangeMsgs)) {
        filter.add('' + round + MsgV4.getMsgID(msg))
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
   * Returns msg IDs for msgs that are missing in the remote peer's database for
   * the tangle `rootID` within `range`, judging by the given `remoteBloomJSON`
   * (and `round`) bloom filter.
   *
   * This may also contain account msgs that are outside the tangle `rootID`,
   * but required to validate the msgs in that tangle.
   *
   * @param {string} rootID
   * @param {number} round
   * @param {Range} range
   * @param {JSON} remoteBloomJSON
   * @returns {Array<MsgID>}
   */
  getMsgsMissing(rootID, round, range, remoteBloomJSON) {
    if (isEmptyRange(range)) return []
    const remoteFilter = BloomFilter.fromJSON(remoteBloomJSON)
    const missing = []
    const rangeMsgs = this.getMsgsInRange(rootID, range)
    const accountMsgs = this.getAccountMsgsFor(rangeMsgs)
    for (const msg of accountMsgs.concat(rangeMsgs)) {
      const msgID = MsgV4.getMsgID(msg)
      if (!remoteFilter.has('' + round + msgID)) {
        missing.push(msgID)
      }
    }
    return missing
  }

  /**
   * Returns an array of account msgs that are required for validating the given
   * `msgs`.
   *
   * @param {Array<Msg>} msgs
   * @returns {Array<Msg>}
   */
  getAccountMsgsFor(msgs) {
    const accountTips = /** @type {Map<MsgID, Set<string>>} */ (new Map())
    for (const msg of msgs) {
      if (MsgV4.isFeedMsg(msg)) {
        const set = accountTips.get(msg.metadata.account) ?? new Set()
        for (const tip of msg.metadata.accountTips) {
          set.add(tip)
        }
        accountTips.set(msg.metadata.account, set)
      }
    }

    const accountMsgs = []
    for (const [accountID, tips] of accountTips) {
      const accountTangle = this.#peer.db.getTangle(accountID)
      if (!accountTangle) continue
      accountMsgs.push(...accountTangle.slice([], [...tips]))
    }
    return accountMsgs
  }

  /**
   * Among the given `msgIDs`, find those that are account msgs and return them
   * as msgs.
   *
   * @param {Iterable<MsgID>} msgIDs
   * @returns {Array<Msg>}
   */
  filterAndFetchAccountMsgs(msgIDs) {
    const accountMsgs = []
    for (const msgID of msgIDs) {
      const msg = this.#peer.db.get(msgID)
      if (msg?.metadata.account === 'self') {
        accountMsgs.push(msg)
      }
    }
    return accountMsgs
  }

  /**
   * Returns msgs that have a depth within the given `range` for the tangle
   * `rootID`.
   *
   * @param {string} rootID
   * @param {Range} range
   * @returns {Array<Msg>}
   */
  getMsgsInRange(rootID, range) {
    const [minDepth, maxDepth] = range
    const rootMsg = this.#peer.db.get(rootID)
    if (!rootMsg) return []
    const msgs = []
    if (minDepth === 0) {
      msgs.push(rootMsg)
    }
    const tangle = this.#peer.db.getTangle(rootID)
    if (!tangle) return msgs
    for (const msg of tangle.slice()) {
      const depth = msg.metadata.tangles[rootID]?.depth ?? 0
      if (depth >= minDepth && depth <= maxDepth) {
        msgs.push(msg)
      }
    }
    return msgs
  }

  /**
   * Given the input msgs (or msg IDs), return those that are part of the tangle
   * `rootID`, plus dataless msgs part of a trail to the tangle root, including
   * the root itself.
   *
   * @param {string} rootID
   * @param {Set<string> | Array<Msg>} msgs
   * @returns {Array<Msg>}
   */
  getTangleMsgs(rootID, msgs) {
    if (Array.isArray(msgs) && msgs.length === 0) return []
    if (!Array.isArray(msgs) && msgs.size === 0) return []
    const msgIDs = [...msgs].map((m) =>
      typeof m === 'string' ? m : MsgV4.getMsgID(m)
    )
    const tangle = this.#peer.db.getTangle(rootID)
    if (!tangle) return []
    return tangle.slice(msgIDs, [])
  }

  /**
   * Erase or delete low-depth msgs from the tangle `rootID`, preserving at
   * least `count` high-depth msgs.
   *
   * @param {string} rootID
   * @param {number} count
   */
  async pruneNewest(rootID, count) {
    const tangle = this.#peer.db.getTangle(rootID)
    if (!tangle) return
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
   * Filter out msgs I didn't actually ask for. "Trust but verify". Also sort
   * them by depth. Also sorts such that (not-this-tangle) account msgs are
   * first.
   *
   * @param {string} rootID
   * @param {Array<Msg>} msgs
   * @param {Range} myWantRange
   * @returns {Array<Msg>}
   */
  #filterReceivedMsgs(rootID, msgs, myWantRange) {
    const [minWant, maxWant] = myWantRange

    const validNewMsgs = msgs
      .filter((msg) => {
        if (msg.metadata.account === 'self') return true
        const depth = msg.metadata.tangles[rootID]?.depth ?? 0
        if (depth === 0 && MsgV4.getMsgID(msg) !== rootID) {
          return false // the rootMsg is the only acceptable depth-zero msg
        }
        if (!msg.data) {
          return depth <= maxWant
        } else {
          return minWant <= depth && depth <= maxWant
        }
      })
      .sort((a, b) => {
        const aAccount = a.metadata.account
        const bAccount = b.metadata.account
        if (aAccount === 'self' && bAccount !== 'self') return -1
        if (aAccount !== 'self' && bAccount === 'self') return 1
        const aDepth = a.metadata.tangles[rootID]?.depth ?? 0
        const bDepth = b.metadata.tangles[rootID]?.depth ?? 0
        return aDepth - bDepth
      })

    return validNewMsgs
  }

  /**
   * Takes the new msgs and adds them to the database. Also performs pruning as
   * post-processing.
   *
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
        if (msg.metadata.account === 'self') {
          await p(this.#peer.db.add)(msg, null /* infer tangleID */)
        } else {
          await p(this.#peer.db.add)(msg, rootID)
        }
      } catch (err) {
        debug('Commit failed to add msg in db: %o', err)
      }
    }

    if (goal.type === 'newest') {
      return await this.pruneNewest(rootID, goal.count)
    }
  }
}

module.exports = Algorithm
