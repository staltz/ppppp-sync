const test = require('node:test')
const assert = require('node:assert')
const p = require('util').promisify
const Keypair = require('ppppp-keypair')
const { createPeer } = require('./util')

const aliceKeypair = Keypair.generate('ed25519', 'alice')
const bobKeys = Keypair.generate('ed25519', 'bob')

function getAccount(iter) {
  return [...iter]
    .filter((m) => m.metadata.account === 'self' && m.data?.action === 'add')
    .map((m) => m.data.key.bytes)
}

test('sync an account tangle', async (t) => {
  const alice = createPeer({ name: 'alice', keypair: aliceKeypair })
  const bob = createPeer({ name: 'bob', keypair: bobKeys })

  await alice.db.loaded()
  await bob.db.loaded()

  // Alice's account tangle
  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })

  const aliceKeypair1 = Keypair.generate('ed25519', 'alice1')
  await p(alice.db.account.add)({
    account: aliceID,
    keypair: aliceKeypair1,
  })

  const aliceKeypair2 = Keypair.generate('ed25519', 'alice2')
  await p(alice.db.account.add)({
    account: aliceID,
    keypair: aliceKeypair2,
  })

  assert.deepEqual(
    getAccount(alice.db.msgs()),
    [aliceKeypair.public, aliceKeypair1.public, aliceKeypair2.public],
    'alice has her account tangle'
  )

  assert.deepEqual(
    getAccount(bob.db.msgs()),
    [],
    "bob doesn't have alice's account tangle"
  )


  // start() on purpose before connect, to test whether this also works
  bob.sync.start()
  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')

  // Set goals on purpose after connect, to test whether this also works
  bob.goals.set(aliceID, 'all')
  alice.goals.set(aliceID, 'all')

  await p(setTimeout)(1000)
  assert('sync!')

  assert.deepEqual(
    getAccount(bob.db.msgs()),
    [aliceKeypair.public, aliceKeypair1.public, aliceKeypair2.public],
    "bob has alice's account tangle"
  )

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
