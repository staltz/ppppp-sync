// @ts-ignore
const toPull = require('push-stream-to-pull-stream') // @ts-ignore
const getSeverity = require('ssb-network-errors')
const pull = require('pull-stream')
const makeDebug = require('debug')
const Algorithm = require('./algorithm')
const SyncStream = require('./stream')

/**
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {ReturnType<import('ppppp-dict').init>} PPPPPDict
 * @typedef {ReturnType<import('ppppp-set').init>} PPPPPSet
 * @typedef {ReturnType<import('ppppp-goals').init>} PPPPPGoals
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
  if (!peer.db) throw new Error('sync requires ppppp-db plugin')
}

/**
 * @param {{ goals: PPPPPGoals | null }} peer
 * @returns {asserts peer is { goals: PPPPPGoals }}
 */
function assertGoalsExists(peer) {
  if (!peer.goals) throw new Error('sync requires ppppp-goals plugin')
}

/**
 * @param {{ shse: SHSE | null }} peer
 * @returns {asserts peer is { shse: SHSE }}
 */
function assertSHSEExists(peer) {
  if (!peer.shse) throw new Error('sync requires secret-handshake-ext')
}

/**
 * @param {Emitter & {
 *   db: PPPPPDB | null,
 *   dict: PPPPPDict | null,
 *   set: PPPPPSet | null,
 *   goals: PPPPPGoals | null,
 *   shse: SHSE | null
 * }} peer
 * @param {unknown} config
 */
function initSync(peer, config) {
  assertDBExists(peer)
  assertGoalsExists(peer)
  assertSHSEExists(peer)
  const debug = makeDebug(`ppppp:sync`)
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
   * @param {{ shse: SHSE, sync: { connect: GetDuplex } }} rpc
   * @param {boolean} iamClient
   */
  function onSyncRPCConnect(rpc, iamClient) {
    assertSHSEExists(peer)
    if (rpc.shse.pubkey === peer.shse.pubkey) return // connecting to myself
    if (!iamClient) return
    const local = toPull.duplex(createStream(rpc.shse.pubkey, true))

    let abort = /** @type {CallableFunction | null} */ (null)
    const remote = rpc.sync.connect((networkError) => {
      if (networkError && getSeverity(networkError) >= 3) {
        if (isMuxrpcMissingError(networkError, 'sync', 'connect')) {
          debug('peer %s does not support sync', rpc.shse.pubkey)
          // } else if (isReconnectedError(networkError)) { // TODO: bring back
          // Do nothing, this is a harmless error
        } else {
          console.error(`rpc.sync.connect exception:`, networkError)
        }
        abort?.(true, () => {})
      }
    })
    abort = pull(local, remote, local)
  }
  peer.on('rpc:connect', onSyncRPCConnect)

  /**
   * @this {{shse: {pubkey: string}}}
   */
  function connect() {
    return toPull.duplex(createStream(this.shse.pubkey, false))
  }

  function start() {
    for (const stream of streams) {
      stream.initiate()
    }
  }

  return {
    connect,
    start,
  }
}

exports.name = 'sync'
exports.manifest = {
  connect: 'duplex',
  initiate: 'sync',
}
exports.init = initSync
exports.permissions = {
  anonymous: {
    allow: ['connect'],
  },
}
