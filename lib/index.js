// @ts-ignore
const toPull = require('push-stream-to-pull-stream') // @ts-ignore
const getSeverity = require('ssb-network-errors')
const pull = require('pull-stream')
const makeDebug = require('debug')
const Algorithm = require('./algorithm')
const SyncStream = require('./stream')

/**
 * @typedef {ReturnType<import('ppppp-goals').init>} PPPPPGoal
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {import('node:events').EventEmitter} Emitter
 * @typedef {(cb: (err: Error) => void) => import('pull-stream').Duplex<unknown, unknown>} GetDuplex
 * @typedef {{ pubkey: string }} SHSE
 */

/**
 * @param {Error} err
 * @param {string} namespace
 * @param {string} methodName
 */
function isMuxrpcMissingError(err, namespace, methodName) {
  const jsErrorMessage = `method:${namespace},${methodName} is not in list of allowed methods`
  const goErrorMessage = `muxrpc: no such command: ${namespace}.${methodName}`
  return err.message === jsErrorMessage || err.message === goErrorMessage
}

/**
 * @param {{ db: PPPPPDB | null }} peer
 * @returns {asserts peer is { db: PPPPPDB }}
 */
function assertDBExists(peer) {
  if (!peer.db) throw new Error('tangleSync requires ppppp-db plugin')
}

/**
 * @param {{ goals: PPPPPGoal | null }} peer
 * @returns {asserts peer is { goals: PPPPPGoal }}
 */
function assertGoalsExists(peer) {
  if (!peer.goals) throw new Error('tangleSync requires ppppp-goals plugin')
}

/**
 * @param {{ shse: SHSE | null }} peer
 * @returns {asserts peer is { shse: SHSE }}
 */
function assertSHSEExists(peer) {
  if (!peer.shse) throw new Error('tangleSync requires secret-handshake-ext')
}

module.exports = {
  name: 'tangleSync',
  manifest: {
    connect: 'duplex',
    initiate: 'sync',
  },
  permissions: {
    anonymous: {
      allow: ['connect'],
    },
  },

  /**
   * @param {Emitter & {
   *   db: PPPPPDB | null,
   *   goals: PPPPPGoal | null,
   *   shse: SHSE | null
   * }} peer
   * @param {unknown} config
   */
  init(peer, config) {
    assertDBExists(peer)
    assertGoalsExists(peer)
    assertSHSEExists(peer)
    const debug = makeDebug(`ppppp:tangleSync`)
    const algo = new Algorithm(peer)

    const streams = /** @type {Array<SyncStream>} */ ([])

    /**
     * @param {string} remoteId
     * @param {boolean} iamClient
     */
    function createStream(remoteId, iamClient) {
      assertSHSEExists(peer)
      assertGoalsExists(peer)
      // prettier-ignore
      debug('Opening a stream with remote %s %s', iamClient ? 'server' : 'client', remoteId)
      const stream = new SyncStream(peer.shse.pubkey, debug, peer.goals, algo)
      streams.push(stream)
      return stream
    }

    /**
     * @param {{ shse: SHSE, tangleSync: { connect: GetDuplex } }} rpc
     * @param {boolean} iamClient
     */
    function onSyncRPCConnect(rpc, iamClient) {
      assertSHSEExists(peer)
      if (rpc.shse.pubkey === peer.shse.pubkey) return // connecting to myself
      if (!iamClient) return
      const local = toPull.duplex(createStream(rpc.shse.pubkey, true))

      let abort = /** @type {CallableFunction | null} */ (null)
      const remote = rpc.tangleSync.connect((networkError) => {
        if (networkError && getSeverity(networkError) >= 3) {
          if (isMuxrpcMissingError(networkError, 'tangleSync', 'connect')) {
            debug('peer %s does not support tangleSync', rpc.shse.pubkey)
            // } else if (isReconnectedError(networkError)) { // TODO: bring back
            // Do nothing, this is a harmless error
          } else {
            console.error(`rpc.tangleSync.connect exception:`, networkError)
          }
          abort?.(true, () => {})
        }
      })
      abort = pull(local, remote, local)
    }
    peer.on('rpc:connect', onSyncRPCConnect)

    /**
     * @this {{id: string}}
     */
    function connect() {
      // `this` refers to the remote peer who called this muxrpc API
      return toPull.duplex(createStream(this.id, false))
      // TODO: fix muxrpc to replace this.id with this.shse.pubkey.
      // this.id comes from muxrpc, not secret-stack
    }

    function initiate() {
      for (const stream of streams) {
        stream.initiate()
      }
    }

    return {
      connect,
      initiate,
    }
  },
}
