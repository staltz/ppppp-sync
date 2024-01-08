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
 * @param {Emitter & {
 *   db: PPPPPDB,
 *   dict: PPPPPDict,
 *   set: PPPPPSet,
 *   goals: PPPPPGoals,
 *   shse: SHSE
 * }} peer
 * @param {unknown} config
 */
function initSync(peer, config) {
  const debug = makeDebug(`ppppp:sync`)
  const algo = new Algorithm(peer)
  let started = false

  const streams = /** @type {Array<SyncStream>} */ ([])

  /**
   * @param {string} remoteId
   * @param {boolean} iamClient
   */
  function createStream(remoteId, iamClient) {
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
    if (rpc.shse.pubkey === peer.shse.pubkey) return // connecting to myself
    if (!iamClient) return
    const stream = createStream(rpc.shse.pubkey, true)
    const local = toPull.duplex(stream)

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
    if (started) stream.initiate()
  }
  peer.on('rpc:connect', onSyncRPCConnect)

  /**
   * @this {{shse: {pubkey: string}}}
   */
  function connect() {
    return toPull.duplex(createStream(this.shse.pubkey, false))
  }

  function start() {
    if (started) return
    started = true
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
exports.needs = ['db', 'dict', 'set', 'goals', 'shse']
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
