const test = require('tape')
const path = require('path')
const os = require('os')
const rimraf = require('rimraf')
const SecretStack = require('secret-stack')
const caps = require('ssb-caps')
const p = require('util').promisify
const Algorithm = require('../lib/algorithm')
const { generateKeypair } = require('./util')

const createPeer = SecretStack({ appKey: caps.shs })
  .use(require('ppppp-db'))
  .use(require('ssb-box'))
  .use(require('../lib'))

const ALICE_DIR = path.join(os.tmpdir(), 'dagsync-alice')
const BOB_DIR = path.join(os.tmpdir(), 'dagsync-bob')
const aliceKeys = generateKeypair('alice')
const bobKeys = generateKeypair('bob')

test('sync a feed with goal=all', async (t) => {
  rimraf.sync(ALICE_DIR)
  rimraf.sync(BOB_DIR)

  const alice = createPeer({
    keys: aliceKeys,
    path: ALICE_DIR,
  })

  const bob = createPeer({
    keys: bobKeys,
    path: BOB_DIR,
  })

  await alice.db.loaded()
  const aliceGroupRec0 = await p(alice.db.group.create)({ _nonce: 'alice' })
  const aliceId = aliceGroupRec0.hash
  await p(alice.db.add)(aliceGroupRec0.msg, aliceId)

  await bob.db.loaded()
  const bobGroupRec0 = await p(bob.db.group.create)({ _nonce: 'bob' })
  const bobId = bobGroupRec0.hash
  await p(bob.db.add)(bobGroupRec0.msg, bobId)

  const carolKeys = generateKeypair('carol')
  const carolGroupRec0 = await p(alice.db.group.create)({
    keys: carolKeys,
    _nonce: 'carol',
  })
  const carolId = carolGroupRec0.hash

  // Bob knows Alice
  await p(bob.db.add)(carolGroupRec0.msg, carolId)

  const carolMsgs = []
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.feed.publish)({
      group: carolId,
      type: 'post',
      data: { text: 'm' + i },
      keys: carolKeys,
    })
    carolMsgs.push(rec.msg)
  }
  t.pass('alice has msgs 1..10 from carol')

  const carolPostsRootHash = alice.db.feed.getRoot(carolId, 'post')
  const carolPostsRootMsg = alice.db.get(carolPostsRootHash)

  await p(bob.db.add)(carolPostsRootMsg, carolPostsRootHash)
  for (let i = 0; i < 7; i++) {
    await p(bob.db.add)(carolMsgs[i], carolPostsRootHash)
  }

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.group === carolId && msg.data)
      .map((msg) => msg.data.text)
    t.deepEquals(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
      'bob has msgs 1..7 from carol'
    )
  }

  bob.tangleSync.setGoal(carolPostsRootHash, 'all')
  alice.tangleSync.setGoal(carolPostsRootHash, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  t.pass('tangleSync!')

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.group === carolId && msg.data)
      .map((msg) => msg.data.text)
    t.deepEquals(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10'],
      'bob has msgs 1..10 from carol'
    )
  }

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

test('sync a feed with goal=newest', async (t) => {
  rimraf.sync(ALICE_DIR)
  rimraf.sync(BOB_DIR)

  const alice = createPeer({
    keys: aliceKeys,
    path: ALICE_DIR,
  })

  const bob = createPeer({
    keys: bobKeys,
    path: BOB_DIR,
  })

  await alice.db.loaded()
  const aliceGroupRec0 = await p(alice.db.group.create)({ _nonce: 'alice' })
  const aliceId = aliceGroupRec0.hash
  await p(alice.db.add)(aliceGroupRec0.msg, aliceId)

  await bob.db.loaded()
  const bobGroupRec0 = await p(bob.db.group.create)({ _nonce: 'bob' })
  const bobId = bobGroupRec0.hash
  await p(bob.db.add)(bobGroupRec0.msg, bobId)

  const carolKeys = generateKeypair('carol')
  const carolGroupRec0 = await p(alice.db.group.create)({
    keys: carolKeys,
    _nonce: 'carol',
  })
  const carolId = carolGroupRec0.hash

  // Bob knows Alice
  await p(bob.db.add)(carolGroupRec0.msg, carolId)

  const carolMsgs = []
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.feed.publish)({
      group: carolId,
      type: 'post',
      data: { text: 'm' + i },
      keys: carolKeys,
    })
    carolMsgs.push(rec.msg)
  }
  t.pass('alice has msgs 1..10 from carol')

  const carolPostsRootHash = alice.db.feed.getRoot(carolId, 'post')
  const carolPostsRootMsg = alice.db.get(carolPostsRootHash)

  await p(bob.db.add)(carolPostsRootMsg, carolPostsRootHash)
  for (let i = 0; i < 7; i++) {
    await p(bob.db.add)(carolMsgs[i], carolPostsRootHash)
  }

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.group === carolId && msg.data)
      .map((msg) => msg.data.text)
    t.deepEquals(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
      'bob has msgs 1..7 from carol'
    )
  }

  bob.tangleSync.setGoal(carolPostsRootHash, 'newest-5')
  alice.tangleSync.setGoal(carolPostsRootHash, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  t.pass('tangleSync!')

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.group === carolId && msg.data)
      .map((msg) => msg.data.text)
    t.deepEquals(
      arr,
      ['m6', 'm7', 'm8', 'm9', 'm10'],
      'bob has msgs 6..10 from carol'
    )
  }

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

test('sync a feed with goal=newest but too far behind', async (t) => {
  rimraf.sync(ALICE_DIR)
  rimraf.sync(BOB_DIR)

  const alice = createPeer({
    keys: aliceKeys,
    path: ALICE_DIR,
  })

  const bob = createPeer({
    keys: bobKeys,
    path: BOB_DIR,
  })

  await alice.db.loaded()
  const aliceGroupRec0 = await p(alice.db.group.create)({ _nonce: 'alice' })
  const aliceId = aliceGroupRec0.hash
  await p(alice.db.add)(aliceGroupRec0.msg, aliceId)

  await bob.db.loaded()
  const bobGroupRec0 = await p(bob.db.group.create)({ _nonce: 'bob' })
  const bobId = bobGroupRec0.hash
  await p(bob.db.add)(bobGroupRec0.msg, bobId)

  const carolKeys = generateKeypair('carol')
  const carolGroupRec0 = await p(alice.db.group.create)({
    keys: carolKeys,
    _nonce: 'carol',
  })
  const carolId = carolGroupRec0.hash

  // Bob knows Alice
  await p(bob.db.add)(carolGroupRec0.msg, carolId)

  const carolMsgs = []
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.feed.publish)({
      group: carolId,
      type: 'post',
      data: { text: 'm' + i },
      keys: carolKeys,
    })
    carolMsgs.push(rec.msg)
  }

  const carolPostsRootHash = alice.db.feed.getRoot(carolId, 'post')
  const carolPostsRootMsg = alice.db.get(carolPostsRootHash)

  const algo = new Algorithm(alice)
  await algo.pruneNewest(carolPostsRootHash, 5)
  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.group === carolId && msg.data)
      .map((msg) => msg.data.text)
    t.deepEquals(
      arr,
      ['m6', 'm7', 'm8', 'm9', 'm10'],
      'alice has msgs 6..10 from carol'
    )
  }

  await p(bob.db.add)(carolPostsRootMsg, carolPostsRootHash)
  for (let i = 0; i < 2; i++) {
    await p(bob.db.add)(carolMsgs[i], carolPostsRootHash)
  }

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.group === carolId && msg.data)
      .map((msg) => msg.data.text)
    t.deepEquals(arr, ['m1', 'm2'], 'bob has msgs 1..2 from carol')
  }

  alice.tangleSync.setGoal(carolPostsRootHash, 'newest-5')
  bob.tangleSync.setGoal(carolPostsRootHash, 'newest-5')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  t.pass('tangleSync!')

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.group === carolId && msg.data)
      .map((msg) => msg.data.text)
    t.deepEquals(
      arr,
      ['m6', 'm7', 'm8', 'm9', 'm10'],
      'bob has msgs 6..10 from carol'
    )
  }

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
