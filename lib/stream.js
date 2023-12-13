// @ts-ignore
const Pipeable = require('push-stream/pipeable')
const { isEmptyRange } = require('./range')

/**
 * @typedef {ReturnType<import('ppppp-goals').init>} PPPPPGoals
 * @typedef {import('ppppp-db/msg-v3').Msg} Msg
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

  /** Set of tangleId
   * @type {Set<string>} */
  #requested

  /** tangleId => goal
   * @type {PPPPPGoals}
   */
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

  /**
   *
   * @param {string} localId
   * @param {CallableFunction} debug
   * @param {PPPPPGoals} goals
   * @param {Algorithm} algo
   */
  constructor(localId, debug, goals, algo) {
    super()
    this.paused = false // TODO: should we start as paused=true?
    this.ended = false
    /** @type {any} */
    this.source = this.sink = null
    this.#myId = localId.slice(0, 6)
    this.#debug = debug
    this.#goals = goals
    this.#algo = algo
    this.#requested = new Set()
    this.#localHave = new Map()
    this.#localWant = new Map()
    this.#remoteHave = new Map()
    this.#remoteWant = new Map()
    this.#receivableMsgs = new Map()
    this.#sendableMsgs = new Map()
  }

  initiate() {
    for (const goal of this.#goals.list()) {
      this.#requested.add(goal.id)
    }
    this.resume()
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
    // prettier-ignore
    this.#debug('%s Stream OUT1: send local have-range %o for %s', this.#myId, localHaveRange, id)
    this.sink.write({ id, phase: 1, payload: localHaveRange })
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
    // prettier-ignore
    this.#debug('%s Stream OUT2: send local have-range %o and want-range %o for %s', this.#myId, haveRange, wantRange, id)
    this.sink.write({ id, phase: 2, payload: { haveRange, wantRange } })
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
    if (!haveRange) throw new Error('local have-range not set')
    const wantRange = this.#algo.wantRange(haveRange, remoteHaveRange, goal)
    this.#localWant.set(id, wantRange)
    const localBloom0 = this.#algo.bloomFor(id, 0, wantRange)
    this.sink.write({
      id,
      phase: 3,
      payload: { bloom: localBloom0, wantRange },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT3: send local want-range %o and bloom round 0 for %s', this.#myId, wantRange, id)
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
    const msgIDsForThem = this.#algo.msgsMissing(
      id,
      0,
      remoteWantRange,
      remoteBloom // representation of everything they have for me
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error('local want-range not set')
    const localBloom = this.#algo.bloomFor(id, 0, localWantRange)
    this.sink.write({
      id,
      phase: 4,
      payload: { bloom: localBloom, msgIDs: msgIDsForThem },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT4: send bloom round 0 plus msgIDs in %s: %o', this.#myId, id, msgIDsForThem)
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
    if (!remoteWantRange) throw new Error('remote want-range not set')
    this.#updateReceivableMsgs(id, msgIDsForMe)
    const msgIDsForThem = this.#algo.msgsMissing(
      id,
      round - 1,
      remoteWantRange,
      remoteBloom
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const extras = this.#receivableMsgs.get(id)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error('local want-range not set')
    const localBloom = this.#algo.bloomFor(id, round, localWantRange, extras)
    this.sink.write({
      id,
      phase,
      payload: { bloom: localBloom, msgIDs: msgIDsForThem },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT%s: send bloom round %s plus msgIDs in %s: %o', this.#myId, phase, round, id, msgIDsForThem)
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
    if (!remoteWantRange) throw new Error('remote want-range not set')
    this.#updateReceivableMsgs(id, msgIDsForMe)
    const msgIDsForThem = this.#algo.msgsMissing(
      id,
      round,
      remoteWantRange,
      remoteBloom
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const extras = this.#receivableMsgs.get(id)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error('local want-range not set')
    const localBloom = this.#algo.bloomFor(id, round, localWantRange, extras)
    this.sink.write({
      id,
      phase,
      payload: { bloom: localBloom, msgIDs: msgIDsForThem },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT%s: send bloom round %s plus msgIDs in %s: %o', this.#myId, phase, round, id, msgIDsForThem)
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
    if (!remoteWantRange) throw new Error('remote want-range not set')
    this.#updateReceivableMsgs(id, msgIDsForMe)
    const msgIDsForThem = this.#algo.msgsMissing(
      id,
      round,
      remoteWantRange,
      remoteBloom
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const msgIDs = this.#sendableMsgs.get(id) ?? new Set()
    const msgs = this.#algo.getTangleSlice(id, msgIDs)
    const extras = this.#receivableMsgs.get(id)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error('local want-range not set')
    const localBloom = this.#algo.bloomFor(id, round, localWantRange, extras)
    this.sink.write({
      id,
      phase: 8,
      payload: { msgs, bloom: localBloom },
    })
    // prettier-ignore
    this.#debug('%s Stream OUT8: send bloom round %s plus %s msgs in %s', this.#myId, round, msgs.length, id)
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
    if (!remoteWantRange) throw new Error('remote want-range not set')
    const msgIDsForThem = this.#algo.msgsMissing(
      id,
      round,
      remoteWantRange,
      remoteBloom
    )
    this.#updateSendableMsgs(id, msgIDsForThem)
    const msgIDs = this.#sendableMsgs.get(id) ?? new Set()
    const msgs = this.#algo.getTangleSlice(id, msgIDs)
    // prettier-ignore
    this.#debug('%s Stream OUT9: send %s msgs in %s', this.#myId, msgs.length, id)
    this.sink.write({ id, phase: 9, payload: msgs })

    const goal = this.#goals.get(id)
    if (!goal) throw new Error(`No goal found for "${id}"`)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error('local want-range not set')
    this.#requested.delete(id)
    this.#localHave.delete(id)
    this.#localWant.delete(id)
    this.#remoteHave.delete(id)
    this.#remoteWant.delete(id)
    this.#receivableMsgs.delete(id)
    this.#sendableMsgs.delete(id)
    if (msgsForMe.length === 0) return
    try {
      this.#algo.commit(id, msgsForMe, goal, localWantRange)
    } catch (err) {
      // prettier-ignore
      this.#debug('%s Stream could not commit received messages, because: %s', this.#myId, err)
    }
  }

  /**
   * @param {string} id
   * @param {Array<Msg>} msgsForMe
   * @returns
   */
  #consumeMissingMsgs(id, msgsForMe) {
    // prettier-ignore
    this.#debug('%s Stream  IN9:  got %s msgs in %s', this.#myId, msgsForMe.length, id)

    this.#requested.delete(id)
    this.#localHave.delete(id)
    this.#localWant.delete(id)
    this.#remoteHave.delete(id)
    this.#remoteWant.delete(id)
    this.#receivableMsgs.delete(id)
    this.#sendableMsgs.delete(id)

    if (msgsForMe.length === 0) return
    const goal = this.#goals.get(id)
    if (!goal) throw new Error(`No goal found for "${id}"`)
    const localWantRange = this.#localWant.get(id)
    if (!localWantRange) throw new Error('local want-range not set')
    try {
      this.#algo.commit(id, msgsForMe, goal, localWantRange)
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
    for (const msg of this.#algo.yieldMsgsIn(id, remoteWantRange)) {
      msgs.push(msg)
    }
    // prettier-ignore
    this.#debug('%s Stream OUT9: send %s msgs in %s', this.#myId, msgs.length, id)
    this.sink.write({ id, phase: 9, payload: msgs })
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
    const { id, phase, payload } = data

    switch (phase) {
      case 0: {
        return this.#sendLocalHave(id)
      }
      case 1: {
        return this.#sendLocalHaveAndWant(id, payload)
      }
      case 2: {
        const { haveRange, wantRange } = payload
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
        const haveRange = this.#remoteHave.get(id)
        if (haveRange && isEmptyRange(haveRange)) {
          // prettier-ignore
          this.#debug('%s Stream  IN3: received remote want-range want-range %o and remember empty have-range %o for %s', this.#myId, wantRange, haveRange, id)
          return this.#sendMsgsInRemoteWant(id, wantRange)
        } else {
          return this.#sendInitBloomRes(id, wantRange, bloom)
        }
      }
      case 4: {
        const { bloom, msgIDs } = payload
        return this.#sendBloomReq(id, phase + 1, 1, bloom, msgIDs)
      }
      case 5: {
        const { bloom, msgIDs } = payload
        return this.#sendBloomRes(id, phase + 1, 1, bloom, msgIDs)
      }
      case 6: {
        const { bloom, msgIDs } = payload
        return this.#sendBloomReq(id, phase + 1, 2, bloom, msgIDs)
      }
      case 7: {
        const { bloom, msgIDs } = payload
        return this.#sendMissingMsgsReq(id, 2, bloom, msgIDs)
      }
      case 8: {
        const { bloom, msgs } = payload
        return this.#sendMissingMsgsRes(id, 2, bloom, msgs)
      }
      case 9: {
        return this.#consumeMissingMsgs(id, payload)
      }
    }

    this.#debug('Stream IN: unknown %o', data)
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
