const test = require('tape')
const ssbKeys = require('ssb-keys')
const path = require('path')
const os = require('os')
const rimraf = require('rimraf')
const SecretStack = require('secret-stack')
const caps = require('ssb-caps')
const FeedV1 = require('ppppp-db/lib/feed-v1')
const p = require('util').promisify
const { generateKeypair } = require('./util')

const createSSB = SecretStack({ appKey: caps.shs })
  .use(require('ppppp-db'))
  .use(require('ssb-box'))
  .use(require('../'))

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
  const ALICE_DIR = path.join(os.tmpdir(), 'dagsync-alice')
  const BOB_DIR = path.join(os.tmpdir(), 'dagsync-bob')

  rimraf.sync(ALICE_DIR)
  rimraf.sync(BOB_DIR)

  const aliceKeys = generateKeypair('alice')
  const alice = createSSB({
    keys: aliceKeys,
    path: ALICE_DIR,
  })

  const bobKeys = generateKeypair('bob')
  const bob = createSSB({
    keys: bobKeys,
    path: BOB_DIR,
  })

  const carolKeys = generateKeypair('carol')
  const carolID = carolKeys.id

  const daveKeys = generateKeypair('dave')
  const daveID = daveKeys.id

  await alice.db.loaded()
  await bob.db.loaded()

  const startA = await p(alice.db.create)({
    type: 'post',
    content: { text: 'A' },
    keys: aliceKeys,
  })
  const rootHashA = alice.db.getFeedRoot(aliceKeys.id, 'post')
  const rootMsgA = alice.db.get(rootHashA)

  await p(bob.db.add)(rootMsgA, rootHashA)
  await p(bob.db.add)(startA.msg, rootHashA)

  await p(setTimeout)(10)

  const replyB1 = await p(bob.db.create)({
    type: 'post',
    content: { text: 'B1' },
    tangles: [startA.hash],
    keys: bobKeys,
  })

  await p(setTimeout)(10)

  const replyB2 = await p(bob.db.create)({
    type: 'post',
    content: { text: 'B2' },
    tangles: [startA.hash],
    keys: bobKeys,
  })
  const rootHashB = bob.db.getFeedRoot(bobKeys.id, 'post')
  const rootMsgB = bob.db.get(rootHashB)

  await p(alice.db.add)(rootMsgB, rootHashB)
  await p(alice.db.add)(replyB1.msg, rootHashB)
  await p(alice.db.add)(replyB2.msg, rootHashB)

  await p(setTimeout)(10)

  const replyC1 = await p(alice.db.create)({
    type: 'post',
    content: { text: 'C1' },
    tangles: [startA.hash],
    keys: carolKeys,
  })
  // const rootHashC = alice.db.getFeedRoot(carolKeys.id, 'post')
  // const rootMsgC = alice.db.get(rootHashC)

  await p(setTimeout)(10)

  const replyD1 = await p(bob.db.create)({
    type: 'post',
    content: { text: 'D1' },
    tangles: [startA.hash],
    keys: daveKeys,
  })

  function getTexts(iter) {
    return [...iter].filter((msg) => msg.content).map((msg) => msg.content.text)
  }

  t.deepEquals(
    getTexts(alice.db.msgs()),
    ['A', 'B1', 'B2', 'C1'],
    'alice has a portion of the thread'
  )

  t.deepEquals(
    getTexts(bob.db.msgs()),
    ['A', 'B1', 'B2', 'D1'],
    'bob has another portion of the thread'
  )

  bob.tangleSync.setGoal(startA.hash, 'all')
  alice.tangleSync.setGoal(startA.hash, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  t.pass('tangleSync!')

  t.deepEquals(
    getTexts(alice.db.msgs()),
    ['A', 'B1', 'B2', 'C1', 'D1'],
    'alice has the full thread'
  )

  t.deepEquals(
    getTexts(bob.db.msgs()),
    ['A', 'B1', 'B2', 'D1', 'C1'],
    'bob has the full thread'
  )

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

// FIXME:
test.skip('sync a thread where first peer does not have the root', async (t) => {
  const ALICE_DIR = path.join(os.tmpdir(), 'dagsync-alice')
  const BOB_DIR = path.join(os.tmpdir(), 'dagsync-bob')

  rimraf.sync(ALICE_DIR)
  rimraf.sync(BOB_DIR)

  const alice = createSSB({
    keys: ssbKeys.generate('ed25519', 'alice'),
    path: ALICE_DIR,
  })

  const bob = createSSB({
    keys: ssbKeys.generate('ed25519', 'bob'),
    path: BOB_DIR,
  })

  await alice.db.loaded()
  await bob.db.loaded()

  const rootA = await p(alice.db.create)({
    feedFormat: 'classic',
    content: { type: 'post', text: 'A' },
    keys: alice.config.keys,
  })

  await p(setTimeout)(10)

  const replyA1 = await p(alice.db.create)({
    feedFormat: 'classic',
    content: { type: 'post', text: 'A1', root: rootA.key, branch: rootA.key },
    keys: alice.config.keys,
  })

  await p(setTimeout)(10)

  const replyA2 = await p(alice.db.create)({
    feedFormat: 'classic',
    content: { type: 'post', text: 'A2', root: rootA.key, branch: replyA1.key },
    keys: alice.config.keys,
  })

  t.deepEquals(
    alice.db.filterAsArray((msg) => true).map((msg) => msg.value.content.text),
    ['A', 'A1', 'A2'],
    'alice has the full thread'
  )

  t.deepEquals(
    bob.db.filterAsArray((msg) => true).map((msg) => msg.value.content.text),
    [],
    'bob has nothing'
  )

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  bob.threadSync.request(rootA.key)
  await p(setTimeout)(1000)
  t.pass('threadSync!')

  t.deepEquals(
    bob.db.filterAsArray((msg) => true).map((msg) => msg.value.content.text),
    ['A', 'A1', 'A2'],
    'bob has the full thread'
  )

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

// FIXME:
test.skip('sync a thread where second peer does not have the root', async (t) => {
  const ALICE_DIR = path.join(os.tmpdir(), 'dagsync-alice')
  const BOB_DIR = path.join(os.tmpdir(), 'dagsync-bob')

  rimraf.sync(ALICE_DIR)
  rimraf.sync(BOB_DIR)

  const alice = createSSB({
    keys: ssbKeys.generate('ed25519', 'alice'),
    path: ALICE_DIR,
  })

  const bob = createSSB({
    keys: ssbKeys.generate('ed25519', 'bob'),
    path: BOB_DIR,
  })

  await alice.db.loaded()
  await bob.db.loaded()

  const rootA = await p(alice.db.create)({
    feedFormat: 'classic',
    content: { type: 'post', text: 'A' },
    keys: alice.config.keys,
  })

  await p(setTimeout)(10)

  const replyA1 = await p(alice.db.create)({
    feedFormat: 'classic',
    content: { type: 'post', text: 'A1', root: rootA.key, branch: rootA.key },
    keys: alice.config.keys,
  })

  await p(setTimeout)(10)

  const replyA2 = await p(alice.db.create)({
    feedFormat: 'classic',
    content: { type: 'post', text: 'A2', root: rootA.key, branch: replyA1.key },
    keys: alice.config.keys,
  })

  t.deepEquals(
    alice.db.filterAsArray((msg) => true).map((msg) => msg.value.content.text),
    ['A', 'A1', 'A2'],
    'alice has the full thread'
  )

  t.deepEquals(
    bob.db.filterAsArray((msg) => true).map((msg) => msg.value.content.text),
    [],
    'bob has nothing'
  )

  const remoteBob = await p(alice.connect)(bob.getAddress())
  t.pass('alice connected to bob')

  alice.threadSync.request(rootA.key)
  await p(setTimeout)(1000)
  t.pass('threadSync!')

  t.deepEquals(
    bob.db.filterAsArray((msg) => true).map((msg) => msg.value.content.text),
    ['A', 'A1', 'A2'],
    'bob has the full thread'
  )

  await p(remoteBob.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
