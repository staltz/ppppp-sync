const toPull = require('push-stream-to-pull-stream')
const pull = require('pull-stream')
const makeDebug = require('debug')
const getSeverity = require('ssb-network-errors')
const syncAlgorithm = require('./old-algorithm')
const SyncStream = require('./stream')

function isMuxrpcMissingError(err, namespace, methodName) {
  const jsErrorMessage = `method:${namespace},${methodName} is not in list of allowed methods`
  const goErrorMessage = `muxrpc: no such command: ${namespace}.${methodName}`
  return err.message === jsErrorMessage || err.message === goErrorMessage
}

module.exports = function makeSyncPlugin(name, getOpts) {
  return {
    name: name,
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
      const debug = makeDebug(`ppppp:${name}`)
      const opts = getOpts(peer, config)
      const algo = syncAlgorithm(opts)

      algo.getMsgs = function getMsgs(msgIds) {
        const msgs = []
        for (const msgId of msgIds) {
          const msg = peer.db.get(msgId)
          if (msg) msgs.push(msg)
        }
        return msgs
      }

      const streams = []
      function createStream(remoteId, isClient) {
        // prettier-ignore
        debug('Opening a stream with remote %s %s', isClient ? 'server' : 'client', remoteId)
        const stream = new SyncStream(peer.id, debug, algo)
        streams.push(stream)
        return stream
      }

      peer.on('rpc:connect', function onSyncRPCConnect(rpc, isClient) {
        if (rpc.id === peer.id) return // local client connecting to local server
        if (!isClient) return
        const local = toPull.duplex(createStream(rpc.id, true))

        const remote = rpc[name].connect((networkError) => {
          if (networkError && getSeverity(networkError) >= 3) {
            if (isMuxrpcMissingError(networkError, name, 'connect')) {
              console.warn(`peer ${rpc.id} does not support sync connect`)
              // } else if (isReconnectedError(networkError)) { // TODO: bring back
              // Do nothing, this is a harmless error
            } else {
              console.error(`rpc.${name}.connect exception:`, networkError)
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
}
