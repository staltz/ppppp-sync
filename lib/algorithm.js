const { BloomFilter } = require('bloom-filters')
const FeedV1 = require('ppppp-db/lib/feed-v1')
const p = require('util').promisify
const { isEmptyRange, estimateMsgCount } = require('./range')

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

  wantRange(rootMsgId, localHaveRange, remoteHaveRange) {
    if (isEmptyRange(remoteHaveRange)) return [1, 0]
    const [minLocalHave, maxLocalHave] = localHaveRange
    const [minRemoteHave, maxRemoteHave] = remoteHaveRange
    if (minRemoteHave !== 0) throw new Error('minRemoteHave must be 0')
    return [0, Math.max(maxLocalHave, maxRemoteHave)]
  }

  bloomFor(feedId, round, range, extraIds = []) {
    const filterSize =
      (isEmptyRange(range) ? 2 : estimateMsgCount(range)) + countIter(extraIds)
    const filter = BloomFilter.create(2 * filterSize, 0.00001)
    if (!isEmptyRange(range)) {
      for (const msg of this.yieldMsgsIn(feedId, range)) {
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

  async commit(newMsgs, rootMsgHash, cb) {
    newMsgs.sort((a, b) => {
      const aDepth = a.metadata.tangles[rootMsgHash].depth
      const bDepth = b.metadata.tangles[rootMsgHash].depth
      return aDepth - bDepth
    })
    for (const msg of newMsgs) {
      await p(this.#peer.db.add)(msg, rootMsgHash)
    }
    cb()
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
