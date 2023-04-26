The bloom filter is a representation of msgs I already have in my want-range,
so you know you can (probably?) skip sending them to me.

The "probably?" uncertainty is reduced by doing several rounds.


```mermaid
sequenceDiagram

participant A as Alice
participant B as Bob
note over A: I want to sync tangle with ID "T"
A->>B: 1: Send local have-range for T

%% opt Alice's have-range is empty
%%     B->>A: 2: Send local have-range and (empty) want-range for ID
%%     A->>B: Send local want-range for ID
%%     B->>A: All msgs in remote want-range
%%     note over A: done
%% end

Note over B: Calculate local want-range based on<br/>local have-range and remote have-range
B->>A: 2: Send local have-range and want-range for T

%% opt Bob's have-range is empty
%%       A->>B: All msgs in remote want-range
%%       note over B: done
%% end

Note over A: Calculate BF over all<br />msgs in my want-range
A->>B: 3: Send local want-range and BF for round 0
Note over B: Read BF to know which<br />msgs they are (maybe) missing
Note over B: Calculate BF over all<br />msgs in my want-range
B->>A: 4: Send BF for round 0 and A's round 0 missing msg IDs
Note over A: ...
A->>B: 5: Send BF for round 1 and B's missing round 0 msg IDs
Note over B: ...
B->>A: 6: Send BF for round 1 and A' missing round 1 msg IDs
Note over A: ...
A->>B: 7: Send BF for round 2 and B's missing round 2 msg IDs
Note over B: ...
B->>A: 8: Send BF for round 2 and A's missing msgs
Note over A: Commit received msgs
A->>B: 9: Send B's missing msgs
Note over B: Commit received msgs
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