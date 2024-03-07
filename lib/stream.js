// @ts-ignore
const Pipeable = require('push-stream/pipeable')
const { isRange, isEmptyRange } = require('./range')
const { isMsgId, isBloom, isMsgIds, isMsgs } = require('./util')

/**
 * @typedef {ReturnType<import('ppppp-goals').init>} PPPPPGoals
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {import('ppppp-db').RecPresent} Rec
 * @typedef {import('ppppp-db/msg-v4').Msg} Msg
 * @typedef {import('./range').Range} Range
 * @typedef {import('./algorithm')} Algorithm
 * @typedef {import('ppppp-goals').Goal} Goal
 * @typedef {string} MsgID
 * @typedef {{id: string}} WithId
 * @typedef {WithId & {phase: 0, payload?: undefined}} Data0
 * @typedef {WithId & {phase: 1, payload: Range}} Data1
 * @typedef {WithId & {phase: 2, payload: { haveRange: Range, wantRange: Range }}} Data2
 * @typedef {WithId & {phase: 3, payload: { wantRange: Range, bloom: JSON }}} Data3
 * @typedef {WithId & {phase: 4 | 5 | 6 | 7, payload: { msgIDs: Array<MsgID>, bloom: JSON }}} Data4567
 * @typedef {WithId & {phase: 8, payload: { msgs: Array<Msg>, bloom: JSON }}} Data8
 * @typedef {WithId & {phase: 9, payload: Array<Msg>}} Data9
 * @typedef {Data0 | Data1 | Data2 | Data3 | Data4567 | Data8 | Data9} Data
 */

class SyncStream extends Pipeable {
  #myId
  /** @type {Algorithm} */
  #algo
  /** @type {CallableFunction} */
  #debug
  /** @type {Set<string>} Set of tangleId */
  #requested
  /** @type {PPPPPDB} */
  #db
  /** @type {PPPPPGoals} */
  #goals
  /**
   * tangleId => have-range by local peer
   * @type {Map<string, [number, number]>}
   */
  #localHave
  /**
   * tangleId => want-range by local peer
   * @type {Map<string, [number, number]>}
   */
  #localWant
  /**
   * tangleId => have-range by remote peer
   * @type {Map<string, [number, number]>}
   */
  #remoteHave
  /**
   * tangleId => want-range by remote peer
   * @type {Map<string, [number, number]>}
   */
  #remoteWant
  /**
   * tangleId => Set of msgIDs
   * @type {Map<string, Set<string>>}
   */
  #receivableMsgs
  /**
   * tangleId => Set of msgIDs
   * @type {Map<string, Set<string>>}
   */
  #sendableMsgs
  /** @type {Set<string>} */
  #realtimeSyncing

  /**
   * @param {string} localId
   * @param {CallableFunction} debug
   * @param {PPPPPDB} db
   * @param {PPPPPGoals} goals
   * @param {Algorithm} algo
   */
  constructor(localId, debug, db, goals, algo) {
    super()
    this.paused = false // TODO: should we start as paused=true?
    this.ended = false
    /** @type {any} */
    this.source = this.sink = null
    this.#myId = localId.slice(0, 6)
    this.#debug = debug
    this.#db = db
    this.#goals = goals
    this.#algo = algo
    this.#requested = new Set()
    this.#realtimeSyncing = new Set()
    this.#localHave = new Map()
    this.#localWant = new Map()
    this.#remoteHave = new Map()
    this.#remoteWant = new Map()
    this.#receivableMsgs = new Map()
    this.#sendableMsgs = new Map()

    // Setup real-time syncing
    this.#db.onRecordAdded((/** @type {Rec} */ { id: msgID, msg }) => {
      if (!this.sink || this.sink.paused) return
      const tangleIDs = [msgID].concat(Object.keys(msg.metadata.tangles))
      for (const id of tangleIDs) {
        if (this.#realtimeSyncing.has(id)) {
          if (this.#receivableMsgs.has(msgID)) continue
          if (this.#receivableMsgs.get(id)?.has(msgID)) continue
          if (this.#sendableMsgs.has(msgID)) continue
          if (this.#sendableMsgs.get(id)?.has(msgID)) continue
          this.sink.write({ id, phase: 9, payload: [msg] })
          // prettier-ignore
          this.#debug('%s Stream OUTr: sent msg %s in %s', this.#myId, msgID, id)
          return
        }
      }
    })
  }

  initiate() {
    for (const goal of this.#goals.list()) {
      this.#requested.add(goal.id)
    }
    this.resume()

    this.#goals.watch((/** @type {any} */ goal) => {
      if (!this.#requested.has(goal.id) && goal.type !== 'none') {
        this.#requested.add(goal.id)
        this.resume()
      }
    })
  }

  #canSend() {
    return this.sink && !this.sink.paused && !this.ended
  }

  /**
   * @param {string} id
   * @param {Array<MsgID>} msgIDs
   */
  #updateSendableMsgs(id, msgIDs) {
    const set = this.#sendableMsgs.get(id) ?? new Set()
    for (const msgID of msgIDs) {
      set.add(msgID)
    }
    this.#sendableMsgs.set(id, set)
  }

  /**
   * @param {string} id
   * @param {Array<string>} msgIDs
   */
  #updateReceivableMsgs(id, msgIDs) {
    const set = this.#receivableMsgs.get(id) ?? new Set()
    for (const msgID of msgIDs) {
      set.add(msgID)
    }
    this.#receivableMsgs.set(id, set)
  }

  /**
   * @param {string} id
   */
  #sendLocalHave(id) {
    const localHaveRange = this.#algo.haveRange(id)
    this.#localHave.set(id, localHaveRange)
    this.sink.write({ id, phase: 1, payload: localHaveRange })
    // prettier-ignore
    this.#debug('%s Stream OUT1: sent local have-range %o for %s', this.#myId, localHaveRange, id)
  }

  /**
   * @param {string} id
   * @param {Range} remoteHaveRange
   */
  #sendLocalHaveAndWant(id, remoteHaveRange) {
    // prettier-ignore
    this.#debug('%s Stream  IN1:  got remote have-range %o for %s', this.#myId, remoteHaveRange, id)
    this.#remoteHave.set(id, remoteHaveRange)
    const goal = this.#goals.get(id)
    const haveRange = this.#algo.haveRange(id)
    const wantRange = this.#algo.wantRange(haveRange, remoteHaveRange, goal)
    this.#localHave.set(id, haveRange)
    this.#localWant.set(id, wantRange)
    this.sink.write({ id, phase: 2, payload: { haveRange, wantRange } })
    // prettier-ignore
    this.#debug('%s Stream OUT2: sent local have-range %o and want-range %o for %s', this.#myId, haveRange, wantRange, id)
  }

  /**
   * @param {string} id
   * @param {Range} remoteHaveRange
   * @param {Range} remoteWantRange
   */
  #sendLocalWantAndInitBloom(id, remoteHaveRange, remoteWantRange) {
    // prettier-ignore
    this.#debug('%s Stream  IN2:  got remote have-range %o and want-range %o for %s', this.#myId, remoteHaveRange, remoteWantRange, id)
    this.#remoteHave.set(id, remoteHaveRange)
    this.#remoteWant.set(id, remoteWantRange)
    const goal = this.#goals.get(id)
    const haveRange = this.#localHave.get(id)
    if (!haveRange) throw new Error(`Local have-range not set for ${id}`)
    const localWant = this.#algo.wantRange(haveRange, remoteHaveRange, goal)
    this.#localWant.set(id, localWant)
    const localBloom0 = this.#algo.bloomFor(id, 0, localWant)
    this.sink.write({
      id,
      phase: 3,
      payload: { bloom: localBloom0, wantRange: localWant },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT3: sent local want-range %o and bloom round 0 for %s', this.#myId, localWant, id)
  }

  /**
   * @param {string} id
   * @param {Range} remoteWantRange
   * @param {JSON} remoteBloom
   */
  #sendInitBloomRes(id, remoteWantRange, remoteBloom) {
    // prettier-ignore
    this.#debug('%s Stream  IN3:  got remote want-range %o and bloom round 0 for %s', this.#myId, remoteWantRange, id)
    this.#remoteWant.set(id, remoteWantRange)
    const msgIDsForThem = this.#algo.getMsgsMissing(
      id,
      0,
      remoteWantRange,
      remoteBloom // representation of everything they have for me
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error(`Local want-range not set for ${id}`)
    const localBloom = this.#algo.bloomFor(id, 0, localWantRange)
    this.sink.write({
      id,
      phase: 4,
      payload: { bloom: localBloom, msgIDs: msgIDsForThem },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT4: sent bloom round 0 plus msgIDs in %s: %o', this.#myId, id, msgIDsForThem)
  }

  /**
   * @param {string} id
   * @param {number} phase
   * @param {number} round
   * @param {JSON} remoteBloom
   * @param {Array<MsgID>} msgIDsForMe
   */
  #sendBloomReq(id, phase, round, remoteBloom, msgIDsForMe) {
    // prettier-ignore
    this.#debug('%s Stream  IN%s:  got bloom round %s plus msgIDs in %s: %o', this.#myId, phase-1, round-1, id, msgIDsForMe)
    const remoteWantRange = this.#remoteWant.get(id)
    if (!remoteWantRange) throw new Error(`Remote want-range not set for ${id}`)
    this.#updateReceivableMsgs(id, msgIDsForMe)
    const msgIDsForThem = this.#algo.getMsgsMissing(
      id,
      round - 1,
      remoteWantRange,
      remoteBloom
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const extras = this.#receivableMsgs.get(id)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error(`Local want-range not set for ${id}`)
    const localBloom = this.#algo.bloomFor(id, round, localWantRange, extras)
    this.sink.write({
      id,
      phase,
      payload: { bloom: localBloom, msgIDs: msgIDsForThem },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT%s: sent bloom round %s plus msgIDs in %s: %o', this.#myId, phase, round, id, msgIDsForThem)
  }

  /**
   * @param {string} id
   * @param {number} phase
   * @param {number} round
   * @param {JSON} remoteBloom
   * @param {Array<MsgID>} msgIDsForMe
   */
  #sendBloomRes(id, phase, round, remoteBloom, msgIDsForMe) {
    // prettier-ignore
    this.#debug('%s Stream  IN%s:  got bloom round %s plus msgIDs in %s: %o', this.#myId, phase-1, round, id, msgIDsForMe)
    const remoteWantRange = this.#remoteWant.get(id)
    if (!remoteWantRange) throw new Error(`Remote want-range not set for ${id}`)
    this.#updateReceivableMsgs(id, msgIDsForMe)
    const msgIDsForThem = this.#algo.getMsgsMissing(
      id,
      round,
      remoteWantRange,
      remoteBloom
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const extras = this.#receivableMsgs.get(id)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error(`Local want-range not set for ${id}`)
    const localBloom = this.#algo.bloomFor(id, round, localWantRange, extras)
    this.sink.write({
      id,
      phase,
      payload: { bloom: localBloom, msgIDs: msgIDsForThem },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT%s: sent bloom round %s plus msgIDs in %s: %o', this.#myId, phase, round, id, msgIDsForThem)
  }

  /**
   * @param {string} id
   * @param {number} round
   * @param {JSON} remoteBloom
   * @param {Array<MsgID>} msgIDsForMe
   */
  #sendMissingMsgsReq(id, round, remoteBloom, msgIDsForMe) {
    // prettier-ignore
    this.#debug('%s Stream  IN7:  got bloom round %s plus msgIDs in %s: %o', this.#myId, round, id, msgIDsForMe)
    const remoteWantRange = this.#remoteWant.get(id)
    if (!remoteWantRange) throw new Error(`Remote want-range not set for ${id}`)
    this.#updateReceivableMsgs(id, msgIDsForMe)
    const msgIDsForThem = this.#algo.getMsgsMissing(
      id,
      round,
      remoteWantRange,
      remoteBloom
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const msgIDs = this.#sendableMsgs.get(id) ?? new Set()
    const tangleMsgs = this.#algo.getTangleMsgs(id, msgIDs)
    const accountMsgs = this.#algo.filterAndFetchAccountMsgs(msgIDs)
    const msgs = accountMsgs.concat(tangleMsgs)
    const extras = this.#receivableMsgs.get(id)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error(`Local want-range not set for ${id}`)
    const localBloom = this.#algo.bloomFor(id, round, localWantRange, extras)
    this.sink.write({
      id,
      phase: 8,
      payload: { msgs, bloom: localBloom },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT8: sent bloom round %s plus %s msgs in %s', this.#myId, round, msgs.length, id)
    if (!this.#realtimeSyncing.has(id) && !isEmptyRange(remoteWantRange)) {
      this.#realtimeSyncing.add(id)
    }
  }

  /**
   * @param {string} id
   * @param {number} round
   * @param {JSON} remoteBloom
   * @param {Array<Msg>} msgsForMe
   */
  #sendMissingMsgsRes(id, round, remoteBloom, msgsForMe) {
    // prettier-ignore
    this.#debug('%s Stream  IN8:  got bloom round %s plus %s msgs in %s', this.#myId, round, msgsForMe.length, id)
    const remoteWantRange = this.#remoteWant.get(id)
    if (!remoteWantRange) throw new Error(`Remote want-range not set for ${id}`)
    const msgIDsForThem = this.#algo.getMsgsMissing(
      id,
      round,
      remoteWantRange,
      remoteBloom
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const msgIDs = this.#sendableMsgs.get(id) ?? new Set()
    const tangleMsgs = this.#algo.getTangleMsgs(id, msgIDs)
    const accountMsgs = this.#algo.filterAndFetchAccountMsgs(msgIDs)
    const msgs = accountMsgs.concat(tangleMsgs)
    this.sink.write({ id, phase: 9, payload: msgs })
    // prettier-ignore
    this.#debug('%s Stream OUT9: sent %s msgs in %s', this.#myId, msgs.length, id)
    if (!this.#realtimeSyncing.has(id) && !isEmptyRange(remoteWantRange)) {
      this.#realtimeSyncing.add(id)
    }
    this.#consumeMissingMsgs(id, msgsForMe)
  }

  /**
   * @param {string} id
   * @param {Array<Msg>} msgsForMe
   * @returns
   */
  #consumeMissingMsgs(id, msgsForMe) {
    this.#requested.delete(id)
    this.#localHave.delete(id)
    this.#remoteHave.delete(id)
    this.#remoteWant.delete(id)

    if (msgsForMe.length === 0) return
    const goal = this.#goals.get(id)
    if (!goal) {
      this.#debug('%s Stream exception: no goal found for %s', this.#myId, id)
      return
    }
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) {
      // prettier-ignore
      this.#debug('%s Stream exception: local want-range not set for %s', this.#myId, id)
      return
    }

    const validMsgs = this.#algo.filterReceivedMsgs(
      id,
      msgsForMe,
      localWantRange
    )
    const validMsgIDs = this.#algo.getMsgIDs(validMsgs)
    this.#updateReceivableMsgs(id, validMsgIDs)

    try {
      this.#algo.commit(id, validMsgs, goal)
    } catch (err) {
      // prettier-ignore
      this.#debug('%s Stream could not commit received messages, because: %s', this.#myId, err)
    }
  }

  /**
   * @param {string} id
   * @param {Range} remoteWantRange
   */
  #sendMsgsInRemoteWant(id, remoteWantRange) {
    const msgs = []
    const rangeMsgs = this.#algo.getMsgsInRange(id, remoteWantRange)
    const tangleMsgs = this.#algo.getTangleMsgs(id, rangeMsgs)
    const accountMsgs = this.#algo.getAccountMsgsFor(tangleMsgs)
    for (const msg of accountMsgs) msgs.push(msg)
    for (const msg of tangleMsgs) msgs.push(msg)
    const msgIDs = this.#algo.getMsgIDs(msgs)
    this.#updateSendableMsgs(id, msgIDs)
    this.sink.write({ id, phase: 9, payload: msgs })
    // prettier-ignore
    this.#debug('%s Stream OUT9: sent %s msgs in %s', this.#myId, msgs.length, id)
    if (!this.#realtimeSyncing.has(id) && !isEmptyRange(remoteWantRange)) {
      this.#realtimeSyncing.add(id)
    }
  }

  // source method
  resume() {
    if (!this.sink || this.sink.paused) return

    for (const id of this.#requested) {
      if (!this.#canSend()) return
      this.write({ id, phase: 0 })
    }
  }

  /**
   * sink method
   * @param {Data} data
   */
  write(data) {
    if (!data) return this.#debug('Invalid data from remote peer: missing data')
    // prettier-ignore
    if (typeof data !== 'object') return this.#debug('Invalid data from remote peer: not an object')
    // prettier-ignore
    if (Array.isArray(data)) return this.#debug('Invalid data from remote peer: is an array')
    const { id, phase, payload } = data
    // prettier-ignore
    if (typeof phase !== 'number') return this.#debug("Invalid data from remote peer: phase isn't a number")
    // prettier-ignore
    if (!isMsgId(id)) return this.#debug('Invalid data from remote peer: id is not a valid msg id')
    // prettier-ignore
    if (phase !== 0 && !payload) return this.#debug('Invalid data from remote peer: payload is missing')

    switch (phase) {
      case 0: {
        return this.#sendLocalHave(id)
      }
      case 1: {
        // prettier-ignore
        if (!isRange(payload)) return this.#debug('Invalid data from remote peer: payload is not a range in phase 1')

        return this.#sendLocalHaveAndWant(id, payload)
      }
      case 2: {
        const { haveRange, wantRange } = payload
        // prettier-ignore
        if (!isRange(haveRange) || !isRange(wantRange)) return this.#debug('Invalid data from remote peer: haveRange or wantRange is not a range in phase 2')

        if (isEmptyRange(haveRange)) {
          // prettier-ignore
          this.#debug('%s Stream  IN2: received remote have-range %o and want-range %o for %s', this.#myId, haveRange, wantRange, id)
          return this.#sendMsgsInRemoteWant(id, wantRange)
        } else {
          return this.#sendLocalWantAndInitBloom(id, haveRange, wantRange)
        }
      }
      case 3: {
        const { wantRange, bloom } = payload
        // prettier-ignore
        if (!isRange(wantRange)) return this.#debug('Invalid data from remote peer: wantRange is not a range in phase 3')
        // prettier-ignore
        if (!isBloom(bloom)) return this.#debug('Invalid data from remote peer: bloom is not a bloom in phase 3')

        const haveRange = this.#remoteHave.get(id)
        if (haveRange && isEmptyRange(haveRange)) {
          // prettier-ignore
          this.#debug('%s Stream  IN3: received remote want-range %o and remembers empty have-range %o for %s', this.#myId, wantRange, haveRange, id)
          return this.#sendMsgsInRemoteWant(id, wantRange)
        } else {
          return this.#sendInitBloomRes(id, wantRange, bloom)
        }
      }
      case 4: {
        const { bloom, msgIDs } = payload
        // prettier-ignore
        if (!isBloom(bloom)) return this.#debug('Invalid data from remote peer: bloom is not a bloom in phase 4')
        // prettier-ignore
        if (!isMsgIds(msgIDs)) return this.#debug('Invalid data from remote peer: msgIDs is not an array of msg ids in phase 4')

        return this.#sendBloomReq(id, phase + 1, 1, bloom, msgIDs)
      }
      case 5: {
        const { bloom, msgIDs } = payload
        // prettier-ignore
        if (!isBloom(bloom)) return this.#debug('Invalid data from remote peer: bloom is not a bloom in phase 5')
        // prettier-ignore
        if (!isMsgIds(msgIDs)) return this.#debug('Invalid data from remote peer: msgIDs is not an array of msg ids in phase 5')

        return this.#sendBloomRes(id, phase + 1, 1, bloom, msgIDs)
      }
      case 6: {
        const { bloom, msgIDs } = payload
        // prettier-ignore
        if (!isBloom(bloom)) return this.#debug('Invalid data from remote peer: bloom is not a bloom in phase 6')
        // prettier-ignore
        if (!isMsgIds(msgIDs)) return this.#debug('Invalid data from remote peer: msgIDs is not an array of msg ids in phase 6')

        return this.#sendBloomReq(id, phase + 1, 2, bloom, msgIDs)
      }
      case 7: {
        const { bloom, msgIDs } = payload
        // prettier-ignore
        if (!isBloom(bloom)) return this.#debug('Invalid data from remote peer: bloom is not a bloom in phase 7')
        // prettier-ignore
        if (!isMsgIds(msgIDs)) return this.#debug('Invalid data from remote peer: msgIDs is not an array of msg ids in phase 7')

        return this.#sendMissingMsgsReq(id, 2, bloom, msgIDs)
      }
      case 8: {
        const { bloom, msgs } = payload
        // prettier-ignore
        if (!isBloom(bloom)) return this.#debug('Invalid data from remote peer: bloom is not a bloom in phase 8')
        // prettier-ignore
        if (!isMsgs(msgs)) return this.#debug('Invalid data from remote peer: msgs is not an array of msgs in phase 8')

        return this.#sendMissingMsgsRes(id, 2, bloom, msgs)
      }
      case 9: {
        // prettier-ignore
        if (!isMsgs(payload)) return this.#debug('Invalid data from remote peer: payload is not an array of msgs in phase 9')

        // prettier-ignore
        this.#debug('%s Stream  IN9:  got %s msgs in %s', this.#myId, payload.length, id)
        return this.#consumeMissingMsgs(id, payload)
      }
      default: {
        // prettier-ignore
        return this.#debug('Invalid data from remote peer: phase is an invalid number')
      }
    }
  }

  /**
   * source method
   * @param {Error} err
   */
  abort(err) {
    this.ended = true
    if (this.source && !this.source.ended) this.source.abort(err)
    if (this.sink && !this.sink.ended) this.sink.end(err)
  }

  /**
   * sink method
   * @param {Error} err
   */
  end(err) {
    this.ended = true
    if (this.source && !this.source.ended) this.source.abort(err)
    if (this.sink && !this.sink.ended) this.sink.end(err)
  }
}

module.exports = SyncStream
