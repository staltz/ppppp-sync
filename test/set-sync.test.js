const test = require('node:test')
const assert = require('node:assert')
const p = require('node:util').promisify
const Keypair = require('ppppp-keypair')
const MsgV4 = require('ppppp-db/msg-v4')
const { createPeer } = require('./util')

const aliceKeypair = Keypair.generate('ed25519', 'alice')

function getItems(subdomain, arr) {
  return arr
    .filter((msg) => msg.metadata.domain === `set_v1__${subdomain}`)
    .map((msg) => msg.data)
    .filter((data) => !!data)
    .map((data) => data.add?.[0] ?? '-' + data.del?.[0])
}

test('sync goal=set from scratch', async (t) => {
  const SPAN = 5
  const alice = createPeer({
    name: 'alice',
    global: {
      keypair: aliceKeypair,
    },
    set: { ghostSpan: SPAN },
  })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  // Alice sets up an account and a set
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  await p(alice.set.load)(aliceID)
  const aliceAccountRoot = alice.db.get(aliceID)

  // Bob knows Alice
  await p(bob.db.add)(aliceAccountRoot, aliceID)

  // Alice constructs a set
  await p(alice.set.add)('names', 'Alice')
  await p(alice.set.add)('names', 'Bob')
  const mootID = alice.set.getFeedID('names')

  // Assert situation at Alice before sync
  {
    const arr = getItems('names', [...alice.db.msgs()])
    assert.deepEqual(arr, ['Alice', 'Bob'], 'alice has Alice+Bob set')
  }

  // Assert situation at Bob before sync
  {
    const arr = getItems('names', [...bob.db.msgs()])
    assert.deepEqual(arr, [], 'alice has empty set')
  }

  // Trigger sync
  alice.goals.set(mootID, 'set')
  bob.goals.set(mootID, 'set')
  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')
  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  // Assert situation at Bob after sync
  {
    const arr = getItems('names', [...bob.db.msgs()])
    assert.deepEqual(arr, ['Alice', 'Bob'], 'alice has Alice+Bob set')
  }

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})

//
// R-?-?-?-?-o-o
//   \
//    o
//
// where "o" is a set update and "?" is a ghost
test('sync goal=set with ghostSpan=2', async (t) => {
  const SPAN = 5
  const alice = createPeer({
    name: 'alice',
    global: {
      keypair: aliceKeypair,
    },
    set: { ghostSpan: SPAN },
  })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  // Alice sets up an account and a set
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  await p(alice.set.load)(aliceID)
  const aliceAccountRoot = alice.db.get(aliceID)

  // Bob knows Alice
  await p(bob.db.add)(aliceAccountRoot, aliceID)

  // Alice constructs a set
  await p(alice.set.add)('follows', 'alice')
  await p(alice.set.add)('follows', 'bob')
  await p(alice.set.del)('follows', 'alice')
  await p(alice.set.del)('follows', 'bob')
  await p(alice.set.add)('follows', 'Alice')
  await p(alice.set.add)('follows', 'Bob')
  let moot
  let rec1
  let rec2
  let rec3
  let rec4
  let rec5
  let rec6
  for (const rec of alice.db.records()) {
    if (rec.msg.metadata.dataSize === 0) moot = rec
    if (rec.msg.data?.add?.[0] === 'alice') rec1 = rec
    if (rec.msg.data?.add?.[0] === 'bob') rec2 = rec
    if (rec.msg.data?.del?.[0] === 'alice') rec3 = rec
    if (rec.msg.data?.del?.[0] === 'bob') rec4 = rec
    if (rec.msg.data?.add?.[0] === 'Alice') rec5 = rec
    if (rec.msg.data?.add?.[0] === 'Bob') rec6 = rec
  }

  // Bob knows the whole set
  await p(bob.db.add)(moot.msg, moot.id)
  await p(bob.db.add)(rec1.msg, moot.id)
  await p(bob.db.add)(rec2.msg, moot.id)
  await p(bob.db.add)(rec3.msg, moot.id)
  await p(bob.db.add)(rec4.msg, moot.id)
  await p(bob.db.add)(rec5.msg, moot.id)
  await p(bob.db.add)(rec6.msg, moot.id)

  // Bob knows a branched off msg that Alice doesn't know
  {
    const tangle = new MsgV4.Tangle(moot.id)
    tangle.add(moot.id, moot.msg)
    tangle.add(rec1.id, rec1.msg)
    const msg = MsgV4.create({
      keypair: aliceKeypair,
      domain: 'set_v1__follows',
      account: aliceID,
      accountTips: [aliceID],
      data: { add: ['Carol'], del: [], supersedes: [] },
      tangles: {
        [moot.id]: tangle,
      },
    })
    await p(bob.db.add)(msg, moot.id)
  }

  // Simulate Alice garbage collecting part of the set
  {
    const itemRoots = alice.set._getItemRoots('follows')
    assert.deepEqual(itemRoots, { Alice: [rec5.id], Bob: [rec6.id] })
    const tangle = alice.db.getTangle(alice.set.getFeedID('follows'))
    const { deletables, erasables } = tangle.getDeletablesAndErasables(rec5.id)
    assert.equal(deletables.size, 2)
    assert.equal(erasables.size, 3)
    assert.ok(deletables.has(rec1.id))
    assert.ok(deletables.has(rec2.id))
    assert.ok(erasables.has(moot.id))
    assert.ok(erasables.has(rec3.id))
    assert.ok(erasables.has(rec4.id))

    for (const msgID of deletables) {
      await p(alice.db.ghosts.add)({ msgID, tangleID: moot.id, span: SPAN })
      await p(alice.db.del)(msgID)
    }
    for (const msgID of erasables) {
      if (msgID === moot.id) continue
      await p(alice.db.erase)(msgID)
    }
  }

  // Assert situation at Alice before sync
  {
    const arr = getItems('follows', [...alice.db.msgs()])
    assert.deepEqual(arr, ['Alice', 'Bob'], 'alice has Alice+Bob set')
  }
  assert.deepEqual(alice.db.ghosts.get(moot.id), [rec1.id, rec2.id])

  // Trigger sync
  alice.goals.set(moot.id, 'set')
  bob.goals.set(moot.id, 'set')
  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')
  bob.sync.start()
  await p(setTimeout)(1000)
  assert('sync!')

  // Assert situation at Alice after sync: she got the branched off msg
  {
    const arr = getItems('follows', [...alice.db.msgs()])
    assert.deepEqual(
      arr,
      ['Alice', 'Bob', 'Carol'],
      'alice has Alice+Bob+Carol set'
    )
  }
  assert.deepEqual(alice.db.ghosts.get(moot.id), [rec2.id])

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
