const test = require('node:test')
const assert = require('node:assert')
const p = require('node:util').promisify
const Keypair = require('ppppp-keypair')
const MsgV3 = require('ppppp-db/msg-v3')
const { createPeer } = require('./util')

const aliceKeypair = Keypair.generate('ed25519', 'alice')

//
// R-?-?-o-o
//   \
//    o
//
// where "o" is a record update and "?" is a ghost
test('sync goal=record with ghostSpan=2', async (t) => {
  const SPAN = 5
  const alice = createPeer({
    name: 'alice',
    keypair: aliceKeypair,
    record: { ghostSpan: SPAN },
  })
  const bob = createPeer({ name: 'bob' })

  await alice.db.loaded()
  await bob.db.loaded()

  // Alice sets up an account and a record
  const aliceID = await p(alice.db.account.create)({
    domain: 'account',
    _nonce: 'alice',
  })
  await p(alice.record.load)(aliceID)
  const aliceAccountRoot = alice.db.get(aliceID)

  // Bob knows Alice
  await p(bob.db.add)(aliceAccountRoot, aliceID)

  // Alice constructs a record
  await p(alice.record.update)('profile', { name: 'alice' })
  await p(alice.record.update)('profile', { age: 24 })
  await p(alice.record.update)('profile', { name: 'Alice' })
  await p(alice.record.update)('profile', { age: 25 })
  await p(alice.record.update)('profile', { name: 'ALICE' })
  let moot
  let rec1
  let rec2
  let rec3
  let rec4
  let rec5
  for (const rec of alice.db.records()) {
    if (rec.msg.metadata.dataSize === 0) moot = rec
    if (rec.msg.data?.update?.name === 'alice') rec1 = rec
    if (rec.msg.data?.update?.age === 24) rec2 = rec
    if (rec.msg.data?.update?.name === 'Alice') rec3 = rec
    if (rec.msg.data?.update?.age === 25) rec4 = rec
    if (rec.msg.data?.update?.name === 'ALICE') rec5 = rec
  }

  // Bob knows the whole record
  await p(bob.db.add)(moot.msg, moot.id)
  await p(bob.db.add)(rec1.msg, moot.id)
  await p(bob.db.add)(rec2.msg, moot.id)
  await p(bob.db.add)(rec3.msg, moot.id)
  await p(bob.db.add)(rec4.msg, moot.id)
  await p(bob.db.add)(rec5.msg, moot.id)

  // Bob knows a branched off msg that Alice doesn't know
  {
    const tangle = new MsgV3.Tangle(moot.id)
    tangle.add(moot.id, moot.msg)
    tangle.add(rec1.id, rec1.msg)
    const msg = MsgV3.create({
      keypair: aliceKeypair,
      domain: 'record_v1__profile',
      account: aliceID,
      accountTips: [aliceID],
      data: { update: { gender: 'w' }, supersedes: [] },
      tangles: {
        [moot.id]: tangle,
      },
    })
    const recX = await p(bob.db.add)(msg, moot.id)
    assert.equal(recX.id, 'Pd8e1aMN7yFWSr7yc1qycr', 'msg ID')
  }

  // Simulate Alice garbage collecting part of the record
  {
    const fieldRoots = alice.record._getFieldRoots('profile')
    assert.deepEqual(fieldRoots.age, [rec4.id])
    assert.deepEqual(fieldRoots.name, [rec5.id])
    const tangle = alice.db.getTangle(alice.record.getFeedID('profile'))
    const { deletables, erasables } = tangle.getDeletablesAndErasables(rec4.id)
    assert.equal(deletables.size, 2)
    assert.equal(erasables.size, 2)
    assert.ok(deletables.has(rec1.id))
    assert.ok(deletables.has(rec2.id))
    assert.ok(erasables.has(rec3.id))
    assert.ok(erasables.has(moot.id))

    for (const msgID of deletables) {
      await p(alice.db.ghosts.add)({ msgID, tangleID: moot.id, max: SPAN })
      await p(alice.db.del)(msgID)
    }
    for (const msgID of erasables) {
      if (msgID === moot.id) continue
      await p(alice.db.erase)(msgID)
    }
  }

  // Assert situation at Alice before tangleSync
  {
    const arr = [...alice.db.msgs()]
      .map((msg) => msg.data?.update)
      .filter((x) => !!x)
      .map((x) => x.age ?? x.name ?? x.gender)
    assert.deepEqual(arr, [25, 'ALICE'], 'alice has age+name record')
  }
  assert.deepEqual(alice.db.ghosts.get(moot.id), [rec1.id, rec2.id])

  // Trigger tangleSync
  alice.goals.set(moot.id, 'record')
  bob.goals.set(moot.id, 'record')
  const remoteAlice = await p(bob.connect)(alice.getAddress())
  assert('bob connected to alice')
  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  assert('tangleSync!')

  // Assert situation at Alice before tangleSync: she got the branched off msg
  {
    const arr = [...alice.db.msgs()]
      .map((msg) => msg.data?.update)
      .filter((x) => !!x)
      .map((x) => x.age ?? x.name ?? x.gender)
    assert.deepEqual(
      arr,
      [25, 'ALICE', 'w'],
      'alice has age+name+gender record'
    )
  }
  assert.deepEqual(alice.db.ghosts.get(moot.id), [rec2.id])

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
