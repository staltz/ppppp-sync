const test = require('node:test')
const assert = require('node:assert')
const p = require('node:util').promisify
const Keypair = require('ppppp-keypair')
const Algorithm = require('../lib/algorithm')
const { createPeer } = require('./util')

const carolKeypair = Keypair.generate('ed25519', 'carol')
const bobKeypair2 = Keypair.generate('ed25519', 'bob2')

test('sync a feed without pre-knowing the owner account', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })

  for (let i = 1; i <= 5; i++) {
    await p(bob.db.feed.publish)({
      account: bobID,
      domain: 'post',
      data: { text: 'm' + i },
    })
  }
  assert('bob published posts 1..5')

  const bobPostsID = bob.db.feed.getID(bobID, 'post')

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === bobID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(arr, [], 'alice has no posts from bob')
  }

  bob.goals.set(bobPostsID, 'all')
  alice.goals.set(bobPostsID, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')

  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === bobID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5'],
      'alice has posts 1..5 from bob'
    )
  }

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

test('sync a feed with updated msgs from new account keypair', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })

  for (let i = 1; i <= 5; i++) {
    await p(bob.db.feed.publish)({
      account: bobID,
      domain: 'post',
      data: { text: 'm' + i },
    })
  }
  assert('bob published posts 1..5')

  const bobPostsID = bob.db.feed.getID(bobID, 'post')

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === bobID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(arr, [], 'alice has no posts from bob')
  }

  bob.goals.set(bobPostsID, 'all')
  alice.goals.set(bobPostsID, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')

  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === bobID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5'],
      'alice has posts 1..5 from bob'
    )
  }

  await p(remoteAlice.close)(true)

  // --------------------------------------------
  // Bob adds a new keypair and published with it
  // --------------------------------------------
  const consent = bob.db.account.consent({
    account: bobID,
    keypair: bobKeypair2,
  })
  await p(bob.db.account.add)({
    account: bobID,
    keypair: bobKeypair2,
    consent,
    powers: [],
  })
  for (let i = 6; i <= 7; i++) {
    await p(bob.db.feed.publish)({
      account: bobID,
      keypair: bobKeypair2,
      domain: 'post',
      data: { text: 'm' + i },
    })
  }
  assert('bob with new keypair published posts 6..7')

  const remoteAlice2 = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')

  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === bobID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
      'alice has posts 1..7 from bob'
    )
  }

  await p(remoteAlice2.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

test('sync a feed with goal=all', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  const carolID = await p(alice.db.account.create)({
    keypair: carolKeypair,
    subdomain: 'account',
    _nonce: 'carol',
  })
  const carolAccountRoot = alice.db.get(carolID)

  // Bob knows Carol
  await p(bob.db.add)(carolAccountRoot, carolID)

  const carolMsgs = []
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.feed.publish)({
      account: carolID,
      domain: 'post',
      data: { text: 'm' + i },
      keypair: carolKeypair,
    })
    carolMsgs.push(rec.msg)
  }
  assert('alice has msgs 1..10 from carol')

  const carolPostsMootID = alice.db.feed.getID(carolID, 'post')
  const carolPostsMoot = alice.db.get(carolPostsMootID)

  await p(bob.db.add)(carolPostsMoot, carolPostsMootID)
  for (let i = 0; i < 7; i++) {
    await p(bob.db.add)(carolMsgs[i], carolPostsMootID)
  }

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
      'bob has msgs 1..7 from carol'
    )
  }

  bob.goals.set(carolPostsMootID, 'all')
  alice.goals.set(carolPostsMootID, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')

  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
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

  const carolID = await p(alice.db.account.create)({
    keypair: carolKeypair,
    subdomain: 'account',
    _nonce: 'carol',
  })
  const carolAccountRoot = alice.db.get(carolID)

  // Bob knows Carol
  await p(bob.db.add)(carolAccountRoot, carolID)

  const carolMsgs = []
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.feed.publish)({
      account: carolID,
      domain: 'post',
      data: { text: 'm' + i },
      keypair: carolKeypair,
    })
    carolMsgs.push(rec.msg)
  }
  assert('alice has msgs 1..10 from carol')

  const carolPostsMootID = alice.db.feed.getID(carolID, 'post')
  const carolPostsMoot = alice.db.get(carolPostsMootID)

  await p(bob.db.add)(carolPostsMoot, carolPostsMootID)
  for (let i = 0; i < 7; i++) {
    await p(bob.db.add)(carolMsgs[i], carolPostsMootID)
  }

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
      'bob has msgs 1..7 from carol'
    )
  }

  bob.goals.set(carolPostsMootID, 'newest-5')
  alice.goals.set(carolPostsMootID, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')

  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
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

  const carolID = await p(alice.db.account.create)({
    keypair: carolKeypair,
    subdomain: 'account',
    _nonce: 'carol',
  })
  const carolIDMsg = alice.db.get(carolID)

  // Bob knows Carol
  await p(bob.db.add)(carolIDMsg, carolID)

  const carolMsgs = []
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.feed.publish)({
      account: carolID,
      domain: 'post',
      data: { text: 'm' + i },
      keypair: carolKeypair,
    })
    carolMsgs.push(rec.msg)
  }

  const carolPostsMootID = alice.db.feed.getID(carolID, 'post')
  const carolPostsMoot = alice.db.get(carolPostsMootID)

  const algo = new Algorithm(alice)
  await algo.pruneNewest(carolPostsMootID, 5)
  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
      arr,
      ['m6', 'm7', 'm8', 'm9', 'm10'],
      'alice has msgs 6..10 from carol'
    )
  }

  await p(bob.db.add)(carolPostsMoot, carolPostsMootID)
  for (let i = 0; i < 2; i++) {
    await p(bob.db.add)(carolMsgs[i], carolPostsMootID)
  }

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(arr, ['m1', 'm2'], 'bob has msgs 1..2 from carol')
  }

  alice.goals.set(carolPostsMootID, 'newest-5')
  bob.goals.set(carolPostsMootID, 'newest-8')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')

  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
      arr,
      ['m6', 'm7', 'm8', 'm9', 'm10'],
      'bob has msgs 6..10 from carol'
    )
  }

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

// Bob replicates a small "newest" part of Carol's feed, then
// Alice replicates what Bob has, even though she wants more.
// Finally, Alice replicates from Carol the whole feed.
test('sync small newest slice of a feed, then the whole feed', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })
  const carol = createPeer({ name: 'carol' })

  await alice.db.loaded()
  await bob.db.loaded()
  await carol.db.loaded()

  const carolID = await p(carol.db.account.create)({
    subdomain: 'account',
    _nonce: 'carol',
  })
  const carolIDMsg = carol.db.get(carolID)

  // Alice and Bob know Carol
  await p(alice.db.add)(carolIDMsg, carolID)
  await p(bob.db.add)(carolIDMsg, carolID)

  const carolPosts = []
  for (let i = 1; i <= 9; i++) {
    const rec = await p(carol.db.feed.publish)({
      account: carolID,
      domain: 'post',
      data: { text: 'm' + i },
    })
    carolPosts.push(rec.msg)
  }

  const carolPostsMootID = carol.db.feed.getID(carolID, 'post')
  const carolPostsMoot = carol.db.get(carolPostsMootID)

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(arr, [], 'bob has nothing from carol')
  }

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(arr, [], 'alice has nothing from carol')
  }

  alice.goals.set(carolPostsMootID, 'all')
  bob.goals.set(carolPostsMootID, 'newest-4')
  carol.goals.set(carolPostsMootID, 'all')

  const bobDialingCarol = await p(bob.connect)(carol.getAddress())
  assert('bob connected to carol')

  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
      arr,
      ['m6', 'm7', 'm8', 'm9'],
      'bob has msgs 6..9 from carol'
    )
  }

  await p(bobDialingCarol.close)(true)

  const aliceDialingBob = await p(alice.connect)(bob.getAddress())
  assert('alice connected to bob')

  alice.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(
      arr,
      ['m6', 'm7', 'm8', 'm9'],
      'alice has msgs 6..9 from carol'
    )
  }

  await p(aliceDialingBob.close)(true)

  const aliceDialingCarol = await p(alice.connect)(carol.getAddress())
  assert('alice connected to alice')

  alice.sync.start()
  await p(setTimeout)(2000)
  assert('sync!')

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === carolID && msg.data)
      .map((msg) => msg.data.text)
      .sort()
    assert.deepEqual(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'],
      'alice has msgs 1..9 from carol'
    )
  }

  await p(aliceDialingCarol.close)(true)

  await p(alice.close)(true)
  await p(bob.close)(true)
  await p(carol.close)(true)
})
