const p = require('util').promisify
const dagSyncPlugin = require('./plugin')

module.exports = dagSyncPlugin('threadSync', (peer, config) => ({
  haveRange(rootMsgHash) {
    const rootMsg = peer.db.get(rootMsgHash)
    if (!rootMsg) return [1, 0]
    let maxDepth = 0
    for (const rec of peer.db.records()) {
      const tangles = rec.msg.metadata.tangles
      if (rec.hash !== rootMsgHash && tangles?.[rootMsgHash]) {
        const depth = tangles[rootMsgHash].depth
        maxDepth = Math.max(maxDepth, depth)
      }
    }
    return [0, maxDepth]
  },

  wantRange(rootMsgId, localHaveRange, remoteHaveRange) {
    const [minLocalHave, maxLocalHave] = localHaveRange
    const [minRemoteHave, maxRemoteHave] = remoteHaveRange
    if (minRemoteHave !== 0) throw new Error('minRemoteHave must be 0')
    return [0, Math.max(maxLocalHave, maxRemoteHave)]
  },

  estimateMsgCount(range) {
    const [minDepth, maxDepth] = range
    const estimate = 2 * (maxDepth - minDepth + 1)
    if (estimate > 1000) return 1000
    else if (estimate < 5) return 5
    else return estimate
  },

  *yieldMsgsIn(rootMsgHash, range) {
    const [minDepth, maxDepth] = range
    const rootMsg = peer.db.get(rootMsgHash)
    if (!rootMsg) return
    for (const msg of peer.db.msgs()) {
      const tangles = msg.metadata.tangles
      if (
        tangles[rootMsgHash] &&
        tangles[rootMsgHash].depth >= minDepth &&
        tangles[rootMsgHash].depth <= maxDepth
      ) {
        yield msg
      }
    }
  },

  async commit(newMsgs, rootMsgHash, cb) {
    newMsgs.sort((a, b) => {
      const aDepth = a.metadata.tangles[rootMsgHash].depth
      const bDepth = b.metadata.tangles[rootMsgHash].depth
      return aDepth - bDepth
    })
    for (const msg of newMsgs) {
      await p(peer.db.add)(msg, rootMsgHash)
    }
    cb()
  },
}))
