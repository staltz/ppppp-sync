const test = require('node:test')
const assert = require('node:assert')
const p = require('node:util').promisify
const { createPeer } = require('./util')

test('sync feed msgs in realtime after the 9 rounds', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })

  await p(bob.db.feed.publish)({
    account: bobID,
    domain: 'post',
    data: { text: 'm0' },
  })
  assert('bob published post 0')

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
    assert.deepEqual(arr, ['m0'], 'alice has post 0 from bob')
  }

  await p(bob.db.feed.publish)({
    account: bobID,
    domain: 'post',
    data: { text: 'm1' },
  })
  assert('bob published post 1')

  await p(bob.db.feed.publish)({
    account: bobID,
    domain: 'post',
    data: { text: 'm2' },
  })
  assert('bob published post 2')

  {
    let arr
    for (let i = 0; i < 100; i++) {
      arr = [...alice.db.msgs()]
        .filter((msg) => msg.metadata.account === bobID && msg.data)
        .map((msg) => msg.data.text)
      if (arr.length < 3) {
        await p(setTimeout)(200)
        continue
      }
    }
    assert.deepEqual(arr, ['m0', 'm1', 'm2'], 'alice has posts 0..2 from bob')
  }

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

test('sync feed msgs in realtime after the 9 rounds, reverse', async (t) => {
  const alice = createPeer({ name: 'alice' })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })

  await p(bob.db.feed.publish)({
    account: bobID,
    domain: 'post',
    data: { text: 'm0' },
  })
  assert('bob published post 0')

  const bobPostsID = bob.db.feed.getID(bobID, 'post')

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === bobID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(arr, [], 'alice has no posts from bob')
  }

  bob.goals.set(bobPostsID, 'all')
  alice.goals.set(bobPostsID, 'all')

  const remoteBob = await p(alice.connect)(bob.getAddress())
  assert('bob connected to alice')

  // Reverse direction of who "starts"
  alice.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  {
    const arr = [...alice.db.msgs()]
      .filter((msg) => msg.metadata.account === bobID && msg.data)
      .map((msg) => msg.data.text)
    assert.deepEqual(arr, ['m0'], 'alice has post 0 from bob')
  }

  await p(bob.db.feed.publish)({
    account: bobID,
    domain: 'post',
    data: { text: 'm1' },
  })
  assert('bob published post 1')

  await p(bob.db.feed.publish)({
    account: bobID,
    domain: 'post',
    data: { text: 'm2' },
  })
  assert('bob published post 2')

  {
    let arr
    for (let i = 0; i < 100; i++) {
      arr = [...alice.db.msgs()]
        .filter((msg) => msg.metadata.account === bobID && msg.data)
        .map((msg) => msg.data.text)
      if (arr.length < 3) {
        await p(setTimeout)(200)
        continue
      }
    }
    assert.deepEqual(arr, ['m0', 'm1', 'm2'], 'alice has posts 0..2 from bob')
  }

  await p(remoteBob.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
