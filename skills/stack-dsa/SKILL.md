---
name: stack-dsa
description: Data structures and algorithms coach and problem-solver covering 20 patterns — arrays and strings, hashing, two pointers, sliding window, prefix sum, binary search, stack and queue, monotonic stack, linked list, recursion, backtracking, trees and BST, heap / priority queue, tries, graph BFS / DFS, topological sort, Dijkstra, union find, greedy, dynamic programming. Use it whenever Jacques is solving a LeetCode-style or interview problem, asks which algorithm or data structure fits, asks for Big-O, hits slow code on large data (bar series, trade lists, dealer job lists, parts supersession chains), or wants to practise or be quizzed on DSA — even if he just pastes a problem statement or says "this loop is too slow".
---

# DSA — 20 patterns, applied

From the "Full Stack AI Engineer" skill-set list. Two jobs:

1. **Solve / optimise.** Given a problem or slow code, recognise the pattern,
   state the complexity before and after, write the solution.
2. **Coach.** Teach a pattern, set practice, mark answers.

## Step 1 — read the constraints, pick the budget

| n up to | Budget | Usually means |
|---|---|---|
| 10–20 | O(2ⁿ), O(n!) | Backtracking, bitmask DP |
| 500 | O(n³) | Interval DP, Floyd–Warshall |
| 5 000 | O(n²) | Simple DP, all pairs |
| 10⁵–10⁶ | O(n log n) or O(n) | Sort, heap, binary search, two pointers, sliding window, hashing |
| 10⁹+ | O(log n) or O(1) | Binary search on the answer, maths |

## Step 2 — match the signal to the pattern

| # | Pattern | Reach for it when… | Core move | Typical cost |
|---|---|---|---|---|
| 01 | Arrays and strings | In-place edits, reversal, rotation, char counting | Index arithmetic; build output with a list then join | O(n) |
| 02 | Hashing | "Seen before?", counts, pairs summing to k, grouping | `Map`/`Set`/`dict`; key = the thing you'd look up | O(n) time, O(n) space |
| 03 | Two pointers | Sorted array, pairs/triplets, palindromes, merge two lists | `l`, `r` moving towards each other or same direction | O(n) |
| 04 | Sliding window | Contiguous subarray/substring with a max/min/at-most-k condition | Grow `r`; shrink `l` while invalid; record best | O(n) |
| 05 | Prefix sum | Many range-sum queries; subarray sum = k | `pre[i+1] = pre[i] + a[i]`; sum(l..r) = `pre[r+1]-pre[l]`; hash map of prefix counts | O(n) build, O(1) query |
| 06 | Binary search | Sorted data, or "minimum x such that ok(x)" (monotone predicate) | `lo, hi`; `while lo < hi`; test mid; keep the invariant | O(log n) |
| 07 | Stack and queue | Matching brackets, undo, BFS order, most-recent-first | Stack = LIFO, queue/deque = FIFO | O(n) |
| 08 | Monotonic stack | Next greater/smaller element, histogram area, stock span | Stack of indices kept increasing/decreasing; pop while the new value breaks order | O(n) |
| 09 | Linked list | Reverse, detect cycle, middle, merge, k-th from end | Dummy head; fast/slow pointers | O(n), O(1) space |
| 10 | Recursion | Problem = smaller copy of itself | Base case first; trust the recursive call; watch stack depth | Varies |
| 11 | Backtracking | All subsets/permutations/combinations, N-queens, sudoku | choose → recurse → un-choose; prune early | Exponential, pruned |
| 12 | Trees and BST | Hierarchies, ordered data, LCA, validate BST | DFS (pre/in/post) or BFS by level; in-order of BST is sorted | O(n) |
| 13 | Heap / priority queue | Top-k, k-th largest, merge k sorted, scheduling, running median | Min-heap of size k; two heaps for median | O(n log k) |
| 14 | Tries | Prefix search, autocomplete, word dictionary | Node = map of children + `end` flag | O(word length) |
| 15 | Graphs BFS / DFS | Connectivity, islands, shortest path in an unweighted graph | Adjacency list + `visited`; BFS for fewest steps | O(V + E) |
| 16 | Topological sort | Dependencies, build/course order, detect cycles in a DAG | Kahn's: in-degree 0 into a queue | O(V + E) |
| 17 | Dijkstra | Shortest path with non-negative weights | Min-heap of (dist, node); skip stale entries | O((V + E) log V) |
| 18 | Union find | Dynamic connectivity, merging groups, cycle in undirected graph, Kruskal | `find` with path compression + union by rank | ≈ O(α(n)) per op |
| 19 | Greedy | Intervals, scheduling, "take the best local choice" that can be proved safe | Sort by the right key (often end time); argue exchange | O(n log n) |
| 20 | Dynamic programming | Optimal count/min/max with overlapping subproblems | Define state → recurrence → base case → order; then shrink memory | States × transitions |

## Step 3 — answer format

For a problem:

1. **Pattern** and the signal that gave it away (one line).
2. **Brute force** and its cost, in one line — it shows the jump.
3. **Approach** in 3–5 bullets.
4. **Code** — TypeScript or Python by default (C# if it's for a cBot), with
   a few comments at the non-obvious lines.
5. **Complexity**: time and space.
6. **Edge cases** checked: empty, one element, duplicates, negatives, overflow.

For slow real code: profile the hot loop first (what's n?), then name the
pattern that replaces it. Real examples from his world:

- Matching every buyer to every listing is O(B×L) — fine at 200×300, not at
  20k×50k; index listings by suburb/price band (hashing) first.
- Rolling high/low over N bars → monotonic deque, O(n) not O(n·window).
- Parts supersession chains (A→B→C) → graph walk with a visited set (cycles
  exist in real catalogues); many lookups → union find or precomputed final part.
- Range P&L over a trade list → prefix sums.
- Session/day windows on tick data → sliding window.

## Coaching loop

When he wants to learn or practise:

1. Explain the pattern with a picture in ASCII (pointers moving, a window
   sliding, a stack growing).
2. Give the template code for the pattern.
3. Set **one easy and one medium** problem (describe it fully; name the
   LeetCode number if it's a well-known one).
4. Ask him to say the pattern and complexity **before** coding. Mark his
   solution: correctness, complexity, edge cases, clarity.
5. Space repetition: when he returns, start with one quick problem from a
   pattern he's done before.

Track progress as `DSA 06/20 ✓` lines when he's working through the list.
