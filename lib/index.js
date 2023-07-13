const toPull = require('push-stream-to-pull-stream')
const pull = require('pull-stream')
const makeDebug = require('debug')
const getSeverity = require('ssb-network-errors')
const Algorithm = require('./algorithm')
const SyncStream = require('./stream')

/**
 * @typedef {import('./goal').Goal} Goal
 */

function isMuxrpcMissingError(err, namespace, methodName) {
  const jsErrorMessage = `method:${namespace},${methodName} is not in list of allowed methods`
  const goErrorMessage = `muxrpc: no such command: ${namespace}.${methodName}`
  return err.message === jsErrorMessage || err.message === goErrorMessage
}

module.exports = {
  name: 'tangleSync',
  manifest: {
    connect: 'duplex',
    setGoal: 'sync',
    initiate: 'sync',
  },
  permissions: {
    anonymous: {
      allow: ['connect'],
    },
  },
  init(peer, config) {
    const debug = makeDebug(`ppppp:tangleSync`)
    const goals = new Map()
    const algo = new Algorithm(peer)

    const streams = []
    function createStream(remoteId, iamClient) {
      // prettier-ignore
      debug('Opening a stream with remote %s %s', iamClient ? 'server' : 'client', remoteId)
      const stream = new SyncStream(peer.pubkey, debug, goals, algo)
      streams.push(stream)
      return stream
    }

    peer.on('rpc:connect', function onSyncRPCConnect(rpc, iamClient) {
      // TODO: eliminate SSB base64 `.id`, use SHSE `.pubkey` instead
      if (rpc.id === peer.pubkey) return // local client connecting to local server
      if (!iamClient) return
      const local = toPull.duplex(createStream(rpc.id, true))

      let abort
      const remote = rpc.tangleSync.connect((networkError) => {
        if (networkError && getSeverity(networkError) >= 3) {
          if (isMuxrpcMissingError(networkError, 'tangleSync', 'connect')) {
            debug('peer %s does not support tangleSync', rpc.id)
            // } else if (isReconnectedError(networkError)) { // TODO: bring back
            // Do nothing, this is a harmless error
          } else {
            console.error(`rpc.tangleSync.connect exception:`, networkError)
          }
          abort?.(true, () => {})
        }
      })
      abort = pull(local, remote, local)
    })

    function connect() {
      // `this` refers to the remote peer who called this muxrpc API
      return toPull.duplex(createStream(this.id, false))
    }

    /**
     * @param {string} tangleId
     * @param {Goal} goal
     */
    function setGoal(tangleId, goal = 'all') {
      goals.set(tangleId, goal)
    }

    function initiate() {
      for (const stream of streams) {
        stream.initiate()
      }
    }

    return {
      connect,
      setGoal,
      initiate,
    }
  },
}
