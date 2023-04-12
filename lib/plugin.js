const toPull = require('push-stream-to-pull-stream')
const pull = require('pull-stream')
const makeDebug = require('debug')
const getSeverity = require('ssb-network-errors')
const Algorithm = require('./algorithm')
const SyncStream = require('./stream')

function isMuxrpcMissingError(err, namespace, methodName) {
  const jsErrorMessage = `method:${namespace},${methodName} is not in list of allowed methods`
  const goErrorMessage = `muxrpc: no such command: ${namespace}.${methodName}`
  return err.message === jsErrorMessage || err.message === goErrorMessage
}

module.exports = {
  name: 'tangleSync',
  manifest: {
    connect: 'duplex',
    request: 'sync',
  },
  permissions: {
    anonymous: {
      allow: ['connect'],
    },
  },
  init(peer, config) {
    const debug = makeDebug(`ppppp:tangleSync`)
    const algo = new Algorithm(peer)

    const streams = []
    function createStream(remoteId, iamClient) {
      // prettier-ignore
      debug('Opening a stream with remote %s %s', iamClient ? 'server' : 'client', remoteId)
      const stream = new SyncStream(peer.id, debug, algo)
      streams.push(stream)
      return stream
    }

    peer.on('rpc:connect', function onSyncRPCConnect(rpc, iamClient) {
      if (rpc.id === peer.id) return // local client connecting to local server
      if (!iamClient) return
      const local = toPull.duplex(createStream(rpc.id, true))

      const remote = rpc.tangleSync.connect((networkError) => {
        if (networkError && getSeverity(networkError) >= 3) {
          if (isMuxrpcMissingError(networkError, 'tangleSync', 'connect')) {
            console.warn(`peer ${rpc.id} does not support sync connect`)
            // } else if (isReconnectedError(networkError)) { // TODO: bring back
            // Do nothing, this is a harmless error
          } else {
            console.error(`rpc.tangleSync.connect exception:`, networkError)
          }
        }
      })

      pull(local, remote, local)
    })

    function connect() {
      // `this` refers to the remote peer who called this muxrpc API
      return toPull.duplex(createStream(this.id, false))
    }

    function request(id) {
      for (const stream of streams) {
        stream.request(id)
      }
    }
    return {
      connect,
      request,
    }
  },
}
