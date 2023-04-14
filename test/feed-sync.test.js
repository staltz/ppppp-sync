const test = require('tape')
const path = require('path')
const os = require('os')
const rimraf = require('rimraf')
const SecretStack = require('secret-stack')
const caps = require('ssb-caps')
const FeedV1 = require('ppppp-db/lib/feed-v1')
const p = require('util').promisify
const { generateKeypair } = require('./util')

const createPeer = SecretStack({ appKey: caps.shs })
  .use(require('ppppp-db'))
  .use(require('ssb-box'))
  .use(require('../'))

test('sync a normal feed', async (t) => {
  const ALICE_DIR = path.join(os.tmpdir(), 'dagsync-alice')
  const BOB_DIR = path.join(os.tmpdir(), 'dagsync-bob')

  rimraf.sync(ALICE_DIR)
  rimraf.sync(BOB_DIR)

  const alice = createPeer({
    keys: generateKeypair('alice'),
    path: ALICE_DIR,
  })

  const bob = createPeer({
    keys: generateKeypair('bob'),
    path: BOB_DIR,
  })

  await alice.db.loaded()
  await bob.db.loaded()

  const carolKeys = generateKeypair('carol')
  const carolMsgs = []
  const carolID = carolKeys.id
  const carolID_b58 = FeedV1.stripAuthor(carolID)
  for (let i = 1; i <= 10; i++) {
    const rec = await p(alice.db.create)({
      type: 'post',
      content: { text: 'm' + i },
      keys: carolKeys,
    })
    carolMsgs.push(rec.msg)
  }
  t.pass('alice has msgs 1..10 from carol')

  const carolRootHash = alice.db.getFeedRoot(carolID, 'post')
  const carolRootMsg = alice.db.get(carolRootHash)

  await p(bob.db.add)(carolRootMsg, carolRootHash)
  for (let i = 0; i < 7; i++) {
    await p(bob.db.add)(carolMsgs[i], carolRootHash)
  }

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.who === carolID_b58 && msg.content)
      .map((msg) => msg.content.text)
    t.deepEquals(
      arr,
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
      'bob has msgs 1..7 from carol'
    )
  }

  bob.tangleSync.setGoal(carolRootHash, 'all')
  alice.tangleSync.setGoal(carolRootHash, 'all')

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  bob.tangleSync.initiate()
  await p(setTimeout)(1000)
  t.pass('tangleSync!')

  {
    const arr = [...bob.db.msgs()]
      .filter((msg) => msg.metadata.who === carolID_b58 && msg.content)
      .map((msg) => msg.content.text)
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

// FIXME:
test.skip('sync a sliced feed', async (t) => {})

// FIXME:
test.skip('delete old msgs and sync latest msgs', async (t) => {
  const ALICE_DIR = path.join(os.tmpdir(), 'dagsync-alice')
  const BOB_DIR = path.join(os.tmpdir(), 'dagsync-bob')

  rimraf.sync(ALICE_DIR)
  rimraf.sync(BOB_DIR)

  const alice = createPeer({
    keys: generateKeypair('alice'),
    path: ALICE_DIR,
  })

  const bob = createPeer({
    keys: generateKeypair('bob'),
    path: BOB_DIR,
    feedSync: {
      limit: 3,
    },
  })

  await alice.db.loaded()
  await bob.db.loaded()

  const carolKeys = generateKeypair('carol')
  const carolMsgs = []
  const carolID = carolKeys.id
  for (let i = 1; i <= 10; i++) {
    const msg = await p(alice.db.create)({
      feedFormat: 'classic',
      content: { type: 'post', text: 'm' + i },
      keys: carolKeys,
    })
    carolMsgs.push(msg)
  }
  t.pass('alice has msgs 1..10 from carol')

  await p(bob.db.add)(carolMsgs[5].value)
  await p(bob.db.add)(carolMsgs[6].value)
  await p(bob.db.add)(carolMsgs[7].value)

  {
    const arr = bob.db
      .filterAsArray((msg) => msg?.value.author === carolID)
      .map((msg) => msg.value.content.text)
    t.deepEquals(arr, ['m6', 'm7', 'm8'], 'bob has msgs 6..8 from carol')
  }

  const remoteAlice = await p(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  bob.feedSync.request(carolID)
  await p(setTimeout)(1000)
  t.pass('feedSync!')

  {
    const arr = bob.db
      .filterAsArray((msg) => msg?.value.author === carolID)
      .map((msg) => msg.value.content.text)
    t.deepEquals(arr, ['m8', 'm9', 'm10'], 'bob has msgs 8..10 from carol')
  }

  await p(remoteAlice.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
})
