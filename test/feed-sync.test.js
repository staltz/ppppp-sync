const test = require('tape')
const p = require('node:util').promisify
const Keypair = require('ppppp-keypair')
const Algorithm = require('../lib/algorithm')
const { createPeer } = require('./util')

const carolKeypair = Keypair.generate('ed25519', 'carol')

test('sync a feed with goal=all', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  const carolID = await p(alice.db.identity.create)({
    keypair: carolKeypair,
    domain: 'account',
    _nonce: 'carol',
  })
  const carolIDMsg = alice.db.get(carolID)

  // Bob knows Carol
  await p(bob.db.add)(carolIDMsg, carolID)

  const carolMsgs = []
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.feed.publish)({
      identity: carolID,
      domain: 'post',
      data: { text: 'm' + i },
      keypair: carolKeypair,
    })
    carolMsgs.push(rec.msg)
  }
  t.pass('alice has msgs 1..10 from carol')

  const carolPostsRootHash = alice.db.feed.getId(carolID, 'post')
  const carolPostsRootMsg = alice.db.get(carolPostsRootHash)

  await p(bob.db.add)(carolPostsRootMsg, carolPostsRootHash)
  for (let i = 0; i < 7; i++) {
    await p(bob.db.add)(carolMsgs[i], carolPostsRootHash)
  }

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.identity === carolID && msg.data)
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
      .filter((msg) => msg.metadata.identity === carolID && msg.data)
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
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  const carolID = await p(alice.db.identity.create)({
    keypair: carolKeypair,
    domain: 'account',
    _nonce: 'carol',
  })
  const carolIDMsg = alice.db.get(carolID)

  // Bob knows Carol
  await p(bob.db.add)(carolIDMsg, carolID)

  const carolMsgs = []
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.feed.publish)({
      identity: carolID,
      domain: 'post',
      data: { text: 'm' + i },
      keypair: carolKeypair,
    })
    carolMsgs.push(rec.msg)
  }
  t.pass('alice has msgs 1..10 from carol')

  const carolPostsRootHash = alice.db.feed.getId(carolID, 'post')
  const carolPostsRootMsg = alice.db.get(carolPostsRootHash)

  await p(bob.db.add)(carolPostsRootMsg, carolPostsRootHash)
  for (let i = 0; i < 7; i++) {
    await p(bob.db.add)(carolMsgs[i], carolPostsRootHash)
  }

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.identity === carolID && msg.data)
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
      .filter((msg) => msg.metadata.identity === carolID && msg.data)
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
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  const carolID = await p(alice.db.identity.create)({
    keypair: carolKeypair,
    domain: 'account',
    _nonce: 'carol',
  })
  const carolIDMsg = alice.db.get(carolID)

  // Bob knows Carol
  await p(bob.db.add)(carolIDMsg, carolID)

  const carolMsgs = []
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.feed.publish)({
      identity: carolID,
      domain: 'post',
      data: { text: 'm' + i },
      keypair: carolKeypair,
    })
    carolMsgs.push(rec.msg)
  }

  const carolPostsRootHash = alice.db.feed.getId(carolID, 'post')
  const carolPostsRootMsg = alice.db.get(carolPostsRootHash)

  const algo = new Algorithm(alice)
  await algo.pruneNewest(carolPostsRootHash, 5)
  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.identity === carolID && msg.data)
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
      .filter((msg) => msg.metadata.identity === carolID && msg.data)
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
      .filter((msg) => msg.metadata.identity === carolID && msg.data)
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
