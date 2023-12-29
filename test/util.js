const OS = require('node:os')
const Path = require('node:path')
const rimraf = require('rimraf')
const caps = require('ppppp-caps')
const Keypair = require('ppppp-keypair')

function createPeer(config) {
  if (config.name) {
    const name = config.name
    const tmp = OS.tmpdir()
    config.global ??= {}
    config.global.path ??= Path.join(tmp, `ppppp-sync-${name}-${Date.now()}`)
    config.global.keypair ??= Keypair.generate('ed25519', name)
    delete config.name
  }
  if (!config.global) {
    throw new Error('need config.global in createPeer()')
  }
  if (!config.global.path) {
    throw new Error('need config.global.path in createPeer()')
  }
  if (!config.global.keypair) {
    throw new Error('need config.global.keypair in createPeer()')
  }

  rimraf.sync(config.global.path)
  return require('secret-stack/bare')()
    .use(require('secret-stack/plugins/net'))
    .use(require('secret-handshake-ext/secret-stack'))
    .use(require('ppppp-db'))
    .use(require('ppppp-dict'))
    .use(require('ppppp-set'))
    .use(require('ppppp-goals'))
    .use(require('ssb-box'))
    .use(require('../lib'))
    .call(null, {
      shse: { caps },
      ...config,
      global: {
        connections: {
          incoming: {
            net: [{ scope: 'device', transform: 'shse', port: null }],
          },
          outgoing: {
            net: [{ transform: 'shse' }],
          },
        },
        ...config.global,
      },
    })
}

module.exports = { createPeer }
