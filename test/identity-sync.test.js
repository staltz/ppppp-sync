const test = require('tape')
const p = require('util').promisify
const Keypair = require('ppppp-keypair')
const { createPeer } = require('./util')

const aliceKeypair = Keypair.generate('ed25519', 'alice')
const bobKeys = Keypair.generate('ed25519', 'bob')

function getIdentity(iter) {
  return [...iter]
    .filter((msg) => msg.metadata.identity === 'self' && msg.data)
    .map((msg) => msg.data.add)
}

test('sync an identity tangle', async (t) => {
  const alice = createPeer({ name: 'alice', keypair: aliceKeypair })
  const bob = createPeer({ name: 'bob', keypair: bobKeys })

  await alice.db.loaded()
  await bob.db.loaded()

  // Alice's identity tangle
  await alice.db.loaded()
  const aliceID = await p(alice.db.identity.create)({
    domain: 'account',
    _nonce: 'alice',
  })

  const aliceKeypair1 = Keypair.generate('ed25519', 'alice1')
  await p(alice.db.identity.add)({
    identity: aliceID,
    keypair: aliceKeypair1,
  })

  const aliceKeypair2 = Keypair.generate('ed25519', 'alice2')
  await p(alice.db.identity.add)({
    identity: aliceID,
    keypair: aliceKeypair2,
  })

  t.deepEquals(
    getIdentity(alice.db.msgs()),
    [aliceKeypair.public, aliceKeypair1.public, aliceKeypair2.public],
    'alice has her identity tangle'
  )

  t.deepEquals(
    getIdentity(bob.db.msgs()),
    [],
    "bob doesn't have alice's identity tangle"
  )

  bob.tangleSync.setGoal(aliceID, 'all')
  alice.tangleSync.setGoal(aliceID, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  t.pass('tangleSync!')

  t.deepEquals(
    getIdentity(bob.db.msgs()),
    [aliceKeypair.public, aliceKeypair1.public, aliceKeypair2.public],
    "bob has alice's identity tangle"
  )

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
