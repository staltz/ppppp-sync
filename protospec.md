The bloom filter is a representation of msgs I already have in my want-range,
so you know you can (probably?) skip sending them to me.

The "probably?" uncertainty is reduced by doing several rounds.


```mermaid
sequenceDiagram

participant A as Alice
participant B as Bob
note over A: I want to sync tangle<br/>with ID "T" and goal aliceG
note over B: I want to sync tangle<br/>with ID "T" and goal bobG
note over A: aliceHave := getHaveRange(T)
A->>B: Phase 1: Send T and aliceHave

%% opt Alice's have-range is empty
%%     B->>A: 2: Send local have-range and (empty) want-range for ID
%%     A->>B: Send local want-range for ID
%%     B->>A: All msgs in remote want-range
%%     note over A: done
%% end

Note over B: bobHave := getHaveRange(T)
Note over B: bobWant := getWantRange(bobHave, aliceHave, bobG)
B->>A: Phase 2: Send T, bobHave and bobWant

%% opt Bob's have-range is empty
%%       A->>B: All msgs in remote want-range
%%       note over B: done
%% end

Note over A: aliceWant := getWantRange(aliceHave, bobHave, aliceG)
Note over A: aliceBF0 := bloomFor(T, 0, aliceWant)
A->>B: Phase 3: Send T, aliceWant and aliceBF0
Note over B: aliceMiss0 := msgsMissing(T, 0, aliceWant, aliceBF0)
Note over B: bobBF0 := bloomFor(T, 0, bobWant)
B->>A: Phase 4: Send T, bobBF0 and aliceMiss0
Note over A: bobMiss0 := msgsMissing(T, 0, bobWant, bobBF0)
Note over A: aliceBF1 := bloomFor(T, 1, aliceWant, aliceMiss0)
A->>B: Phase 5: Send T, aliceBF1 and bobMiss0
Note over B: aliceMiss1 := msgsMissing(T, 1, aliceWant, aliceBF1)
Note over B: bobBF1 := bloomFor(T, 1, bobWant, bobMiss0)
B->>A: Phase 6: Send T, bobBF1 and aliceMiss1
Note over A: bobMiss1 := msgsMissing(T, 1, bobWant, bobBF1)
Note over A: aliceBF2 := bloomFor(T, 2, aliceWant, aliceMiss0 + aliceMiss1)
A->>B: Phase 7: Send T, aliceBF2 and bobMiss1
Note over B: aliceMiss2 := msgsMissing(T, 2, aliceWant, aliceBF2)
Note over B: aliceMiss := aliceMiss0 + aliceMiss1 + aliceMiss2
Note over B: aliceMsgs := tangleSlice(T, aliceMiss)
Note over B: bobBF2 := bloomFor(T, 2, bobWant, bobMiss0 + bobMiss1)
B->>A: Phase 8: Send T, bobBF2 and aliceMsgs
Note over A: commit(aliceMsgs)
Note over A: bobMiss2 := msgsMissing(T, 2, bobWant, bobBF2)
Note over A: bobMiss := bobMiss0 + bobMiss1 + bobMiss2
Note over A: bobMsgs := tangleSlice(T, bobMiss)
A->>B: Phase 9: Send T and bobMsgs
Note over B: commit(bobMsgs)
```

Methods:

```
/**
 * Determines the range of depths of msgs I have in the tangle
 */
getHaveRange(tangleID) -> [minDepth, maxDepth]
```

```
/**
 * Determines the range of depths of (new) msgs I want from the tangle
 */
getWantRange(localHaveRange, remoteHaveRange, goal) -> [minDepth, maxDepth]
```

```
/**
 * Creates a serialized bloom filter containing the identifiers `${round}${msgID}` for:
 * - Each msg in the tangle `tangleID` within depth `range` (inclusive)
 * - Each "ghost" msg ID for this tangle
 * - Each "extra" msg ID from `extraMsgIDs`
 */
bloomFor(tangleId, round, range, extraMsgIDs) -> Bloom
```

```
/**
 * Returns the msg IDs in the tangle `tangleID` which satisfy:
 * - `msg.metadata.tangles[tangleID].depth` within `range` (inclusive)
 * - `${round}${msgID}` not in `bloom`
 */
msgsMissing(tangleID, round, range, bloom) -> Array<MsgID>
```

```
/**
 * Identifies the lowest depth msg in `msgID` as "lowest" and then returns an
 * Array of msgs with:
 * - `lowest`
 * - msgs posterior to `lowest`
 * - trail from `lowest` to the root
 * The Array is topologically sorted.
 */
tangleSlice(tangleID, msgIDs) -> Array<Msg>
```

```
/**
 * Receives an Array of PPPPP msgs, validates and persists each in the database.
 */
commit(msgs) -> void
```

Peers exchange

```typescript
type Range = [number, number]

interface WithId {
  /** TangleID: msg hash of the tangle's root msg */
  id: string,
}

interface Data1 extends WithId {
  phase: 1,
  payload: Range,
}

interface Data2 extends WithId {
  phase: 2,
  payload: {
    haveRange: Range,
    wantRange: Range,
  }
}

interface Data3 extends WithId {
  phase: 3,
  payload: {
    wantRange: Range,
    bloom: string, // "bloom-filters" specific format TODO: generalize
  }
}

interface Data4567 extends WithId {
  phase: 4 | 5 | 6 | 7,
  payload: {
    msgIDs: Array<string>,
    bloom: string, // "bloom-filters" specific format TODO: generalize
  }
}

interface Data8 extends WithId {
  phase: 8,
  payload: {
    msgs: Array<Msg>,
    bloom: string,
  }
}

interface Data9 extends WithId {
  phase: 9,
  payload: Array<Msg>,
}

type Data = Data1 | Data2 | Data3 | Data4567 | Data8 | Data9
```