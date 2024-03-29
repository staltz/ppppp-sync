const test = require('node:test')
const assert = require('node:assert')
const p = require('util').promisify
const Keypair = require('ppppp-keypair')
const { createPeer } = require('./util')

const carolKeypair = Keypair.generate('ed25519', 'carol')
const daveKeypair = Keypair.generate('ed25519', 'dave')

function getTexts(iter) {
  return [...iter].filter((msg) => msg.data?.text).map((msg) => msg.data.text)
}

/*
BEFORE dagsync:
```mermaid
graph TB;
  subgraph Bob
    direction TB
    rootAb[root by A]
    replyB1b[reply by B]
    replyB2b[reply by B]
    replyD1b[reply by D]
    rootAb-->replyB1b-->replyB2b & replyD1b
  end
  subgraph Alice
    direction TB
    rootAa[root by A]
    replyB1a[reply by B]
    replyB2a[reply by B]
    replyC1a[reply by C]
    rootAa-->replyB1a-->replyB2a
    rootAa-->replyC1a
  end
```

AFTER dagsync:
```mermaid
graph TB;
  subgraph Bob
    rootA[root by A]
    replyB1[reply by B]
    replyB2[reply by B]
    replyC1[reply by C]
    replyD1[reply by D]
    rootA-->replyB1-->replyB2 & replyD1
    rootA-->replyC1
  end
```
*/
test('sync a thread where both peers have portions', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  const aliceIDMsg = alice.db.get(aliceID)

  await bob.db.loaded()
  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })
  const bobIDMsg = bob.db.get(bobID)

  // Alice created Carol
  const carolID = await p(alice.db.account.create)({
    subdomain: 'account',
    keypair: carolKeypair,
    _nonce: 'carol',
  })
  const carolIDMsg = alice.db.get(carolID)

  // Alice created Dave
  const daveID = await p(alice.db.account.create)({
    subdomain: 'account',
    keypair: daveKeypair,
    _nonce: 'dave',
  })
  const daveIDMsg = alice.db.get(daveID)

  // Alice knows Bob
  await p(alice.db.add)(bobIDMsg, bobID)

  // Bob knows Alice, Carol, and Dave
  await p(bob.db.add)(aliceIDMsg, aliceID)
  await p(bob.db.add)(carolIDMsg, carolID)
  await p(bob.db.add)(daveIDMsg, daveID)

  const startA = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A' },
  })
  const rootHashA = alice.db.feed.getID(aliceID, 'post')
  const rootMsgA = alice.db.get(rootHashA)

  await p(bob.db.add)(rootMsgA, rootHashA)
  await p(bob.db.add)(startA.msg, rootHashA)

  const replyB1 = await p(bob.db.feed.publish)({
    account: bobID,
    domain: 'post',
    data: { text: 'B1' },
    tangles: [startA.id],
  })

  const replyB2 = await p(bob.db.feed.publish)({
    account: bobID,
    domain: 'post',
    data: { text: 'B2' },
    tangles: [startA.id],
  })
  const rootHashB = bob.db.feed.getID(bobID, 'post')
  const rootMsgB = bob.db.get(rootHashB)

  await p(alice.db.add)(rootMsgB, rootHashB)
  await p(alice.db.add)(replyB1.msg, rootHashB)
  await p(alice.db.add)(replyB2.msg, rootHashB)

  const replyC1 = await p(alice.db.feed.publish)({
    account: carolID,
    domain: 'post',
    data: { text: 'C1' },
    tangles: [startA.id],
    keypair: carolKeypair,
  })

  const replyD1 = await p(bob.db.feed.publish)({
    account: daveID,
    domain: 'post',
    data: { text: 'D1' },
    tangles: [startA.id],
    keypair: daveKeypair,
  })

  assert.deepEqual(
    getTexts(alice.db.msgs()),
    ['A', 'B1', 'B2', 'C1'],
    'alice has a portion of the thread'
  )

  assert.deepEqual(
    getTexts(bob.db.msgs()),
    ['A', 'B1', 'B2', 'D1'],
    'bob has another portion of the thread'
  )

  bob.goals.set(startA.id, 'all')
  alice.goals.set(startA.id, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')

  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  assert.deepEqual(
    getTexts(alice.db.msgs()),
    ['A', 'B1', 'B2', 'C1', 'D1'],
    'alice has the full thread'
  )

  assert.deepEqual(
    getTexts(bob.db.msgs()),
    ['A', 'B1', 'B2', 'D1', 'C1'],
    'bob has the full thread'
  )

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

test('sync a thread where initiator does not have the root', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  const aliceIDMsg = alice.db.get(aliceID)

  await bob.db.loaded()
  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })
  const bobIDMsg = bob.db.get(bobID)

  // Alice knows Bob
  await p(alice.db.add)(bobIDMsg, bobID)

  // Bob knows Alice
  await p(bob.db.add)(aliceIDMsg, aliceID)

  const rootA = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A' },
  })

  const replyA1 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A1' },
    tangles: [rootA.id],
  })

  const replyA2 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A2' },
    tangles: [rootA.id],
  })

  assert.deepEqual(
    getTexts(alice.db.msgs()),
    ['A', 'A1', 'A2'],
    'alice has the full thread'
  )

  assert.deepEqual(getTexts(bob.db.msgs()), [], 'bob has nothing')

  bob.goals.set(rootA.id, 'all')
  // ON PURPOSE: alice does not set the goal
  // alice.goals.set(rootA.id, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')

  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  assert.deepEqual(
    getTexts(bob.db.msgs()),
    ['A', 'A1', 'A2'],
    'bob has the full thread'
  )

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

test('sync a thread where receiver does not have the root', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  const aliceIDMsg = alice.db.get(aliceID)

  await bob.db.loaded()
  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })
  const bobIDMsg = bob.db.get(bobID)

  // Alice knows Bob
  await p(alice.db.add)(bobIDMsg, bobID)

  // Bob knows Alice
  await p(bob.db.add)(aliceIDMsg, aliceID)

  const rootA = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A' },
  })

  const replyA1 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A1' },
    tangles: [rootA.id],
  })

  const replyA2 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A2' },
    tangles: [rootA.id],
  })

  assert.deepEqual(
    getTexts(alice.db.msgs()),
    ['A', 'A1', 'A2'],
    'alice has the full thread'
  )

  assert.deepEqual(getTexts(bob.db.msgs()), [], 'bob has nothing')

  bob.goals.set(rootA.id, 'all')
  alice.goals.set(rootA.id, 'all')

  const remoteBob = await p(alice.connect)(bob.getAddress())
  assert('alice connected to bob')

  alice.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  assert.deepEqual(
    getTexts(bob.db.msgs()),
    ['A', 'A1', 'A2'],
    'bob has the full thread'
  )

  await p(remoteBob.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

test('sync a thread with reactions too', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  const aliceIDMsg = alice.db.get(aliceID)

  await bob.db.loaded()
  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })
  const bobIDMsg = bob.db.get(bobID)

  // Alice knows Bob
  await p(alice.db.add)(bobIDMsg, bobID)

  // Bob knows Alice
  await p(bob.db.add)(aliceIDMsg, aliceID)

  const rootA = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A' },
  })

  const replyA1 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A1' },
    tangles: [rootA.id],
  })

  const replyA2 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'A2' },
    tangles: [rootA.id],
  })

  const reactionA3 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'reaction',
    data: { text: 'yes', link: replyA1.id },
    tangles: [rootA.id, replyA1.id],
  })

  assert.deepEqual(
    getTexts(alice.db.msgs()),
    ['A', 'A1', 'A2', 'yes'],
    'alice has the full thread'
  )

  assert.deepEqual(getTexts(bob.db.msgs()), [], 'bob has nothing')

  bob.goals.set(rootA.id, 'all')
  alice.goals.set(rootA.id, 'all')

  const remoteBob = await p(alice.connect)(bob.getAddress())
  assert('alice connected to bob')

  alice.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  assert.deepEqual(
    getTexts(bob.db.msgs()),
    ['A', 'A1', 'A2', 'yes'],
    'bob has the full thread'
  )

  await p(remoteBob.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
