const test = require('tape')
const path = require('path')
const os = require('os')
const rimraf = require('rimraf')
const SecretStack = require('secret-stack')
const caps = require('ssb-caps')
const p = require('util').promisify
const { generateKeypair } = require('./util')

const createSSB = SecretStack({ appKey: caps.shs })
  .use(require('ppppp-db'))
  .use(require('ssb-box'))
  .use(require('../lib'))

const ALICE_DIR = path.join(os.tmpdir(), 'dagsync-alice')
const BOB_DIR = path.join(os.tmpdir(), 'dagsync-bob')
const aliceKeys = generateKeypair('alice')
const bobKeys = generateKeypair('bob')

function getIdentity(iter) {
  return [...iter]
    .filter((msg) => msg.metadata.group === null && msg.data)
    .map((msg) => msg.data.add)
}

test('sync an identity tangle', async (t) => {
  rimraf.sync(ALICE_DIR)
  rimraf.sync(BOB_DIR)

  const alice = createSSB({
    keys: aliceKeys,
    path: ALICE_DIR,
  })

  const bob = createSSB({
    keys: bobKeys,
    path: BOB_DIR,
  })

  await alice.db.loaded()
  await bob.db.loaded()

  // Alice's identity tangle
  await alice.db.loaded()
  const aliceGroupRec0 = await p(alice.db.group.create)({ _nonce: 'alice' })
  const aliceId = aliceGroupRec0.hash
  await p(alice.db.add)(aliceGroupRec0.msg, aliceId)

  const aliceKeys1 = generateKeypair('alice1')
  await p(alice.db.group.add)({ group: aliceId, keys: aliceKeys1 })

  const aliceKeys2 = generateKeypair('alice2')
  await p(alice.db.group.add)({ group: aliceId, keys: aliceKeys2 })

  t.deepEquals(
    getIdentity(alice.db.msgs()),
    [aliceKeys.id, aliceKeys1.id, aliceKeys2.id],
    "alice has her identity tangle"
  )

  t.deepEquals(
    getIdentity(bob.db.msgs()),
    [],
    "bob doesn't have alice's identity tangle"
  )

  bob.tangleSync.setGoal(aliceId, 'all')
  alice.tangleSync.setGoal(aliceId, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  t.pass('tangleSync!')

  t.deepEquals(
    getIdentity(bob.db.msgs()),
    [aliceKeys.id, aliceKeys1.id, aliceKeys2.id],
    "bob has alice's identity tangle"
  )

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
