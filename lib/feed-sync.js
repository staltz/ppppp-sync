const p = require('util').promisify
const FeedV1 = require('ppppp-db/lib/feed-v1')
const syncPlugin = require('./plugin')

module.exports = syncPlugin('feedSync', (peer, config) => {
  const limit = config.feedSync?.limit ?? 1000

  function* take(n, iter) {
    if (n === 0) return
    let i = 0
    for (const item of iter) {
      yield item
      if (++i >= n) break
    }
  }

  function* filter(iter, fn) {
    for (const item of iter) {
      if (fn(item)) yield item
    }
  }

  return {
    haveRange(feedId) {
      let minDepth = Number.MAX_SAFE_INTEGER
      let maxDepth = 0
      for (const msg of peer.db.msgs()) {
        if (FeedV1.getFeedId(msg) === feedId) {
          minDepth = Math.min(minDepth, msg.metadata.depth)
          maxDepth = Math.max(maxDepth, msg.metadata.depth)
        }
      }
      return [minDepth, maxDepth]
    },

    wantRange(feedId, localHaveRange, remoteHaveRange) {
      const [minLocalHave, maxLocalHave] = localHaveRange
      const [minRemoteHave, maxRemoteHave] = remoteHaveRange
      if (maxRemoteHave <= maxLocalHave) return [1, 0]
      const maxWant = maxRemoteHave
      const size = Math.max(maxWant - maxLocalHave, limit)
      const minWant = Math.max(maxWant - size, maxLocalHave + 1, minRemoteHave)
      return [minWant, maxWant]
    },

    estimateMsgCount(range) {
      const [minDepth, maxDepth] = range
      const estimate = 2 * (maxDepth - minDepth + 1)
      if (estimate > 1000) return 1000
      else if (estimate < 5) return 5
      else return estimate
    },

    *yieldMsgsIn(feedId, range) {
      const [minDepth, maxDepth] = range
      for (const msg of peer.db.msgs()) {
        if (
          FeedV1.getFeedId(msg) === feedId &&
          msg.metadata.depth >= minDepth &&
          msg.metadata.depth <= maxDepth
        ) {
          yield msg
        }
      }
    },

    async commit(newMsgs, feedId, cb) {
      newMsgs.sort((a, b) => a.metadata.depth - b.metadata.depth) // mutation
      const isRelevantRec = (rec) => FeedV1.getFeedId(rec.msg) === feedId

      // Find max sequence in the database
      let oldLastDepth = 0
      let oldCount = 0
      for (const rec of peer.db.records()) {
        if (!isRelevantRec(rec)) continue
        oldCount += 1
        oldLastDepth = Math.max(oldLastDepth, rec.msg.metadata.depth)
      }

      const isContinuation = newMsgs[0].metadata.depth === oldLastDepth + 1
      // Refuse creating holes in the feed
      if (!isContinuation && newMsgs.length < limit) {
        console.error(
          `feedSync failed to persist msgs for ${feedId} because ` +
            'they are not a continuation, and not enough messages'
        )
        return cb()
      }

      // Delete old messages in the database
      if (isContinuation) {
        // Delete just enough msgs to make room for the new ones
        const N = Math.max(0, oldCount + newMsgs.length - limit)
        for (const rec of take(N, filter(peer.db.records(), isRelevantRec))) {
          await p(peer.db.del)(rec.hash)
        }
      } else {
        // Delete all the old ones
        for (const rec of filter(peer.db.records(), isRelevantRec)) {
          await p(peer.db.del)(rec.hash)
        }
      }

      // Add new messages
      for (const msg of newMsgs) {
        await p(peer.db.add)(msg)
      }
      cb()
    },
  }
})
