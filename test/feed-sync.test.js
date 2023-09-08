const test = require('node:test')
const assert = require('node:assert')
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

  const carolID = await p(alice.db.account.create)({
    keypair: carolKeypair,
    domain: 'account',
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

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  assert('tangleSync!')

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
    domain: 'account',
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

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  assert('tangleSync!')

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
    domain: 'account',
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

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  assert('tangleSync!')

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
