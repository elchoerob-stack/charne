---
name: stack-lld
description: Low-level design (LLD) and object-oriented design for writing and refactoring classes and modules, covering 20 concepts — OOP pillars, SOLID, DRY / KISS / YAGNI, composition over inheritance, UML class diagrams, the Singleton, Factory, Abstract Factory, Builder, Prototype, Adapter, Decorator, Facade, Proxy, Observer, Strategy, Command and State patterns, thread safety, and machine coding rounds. Use it whenever Jacques designs or refactors classes, interfaces or modules in C# (cBots, the WPF orchestrator) or TypeScript (Foreman, Keystone), asks which design pattern fits, says code is getting messy, duplicated or hard to change, has a race condition or shared-state bug, prepares for a machine coding / LLD interview, or wants to learn or be quizzed on a pattern — even if he only says "clean this up" or "how should I structure these classes".
---

# LLD — 20 concepts, applied

From the "Full Stack AI Engineer" skill-set list. Two jobs: **design and
refactor** real code, and **coach** the concepts.

The first question for any pattern is "what change is this protecting
against?" If there's no likely change, the pattern is cost with no benefit —
that's YAGNI, and it wins ties.

## Principles (01–05)

| # | Concept | Apply it as | Smell that calls for it |
|---|---|---|---|
| 01 | OOP pillars | **Encapsulation**: state private, change it through methods that keep invariants. **Abstraction**: callers see what, not how. **Inheritance**: only for a true is-a with shared behaviour. **Polymorphism**: replace `switch (type)` with one interface, many implementations. | Public mutable fields; `switch` on a type string repeated in several places |
| 02 | SOLID | **S** one reason to change per class. **O** add behaviour by adding a class, not editing a long if-chain. **L** a subclass must work anywhere the base does. **I** small interfaces. **D** depend on interfaces; inject concrete classes at the edge. | A 1 000-line `Robot`/`Agent` class; tests impossible without the real broker or API |
| 03 | DRY / KISS / YAGNI | DRY applies to *knowledge* (one place for a rule like transfer-duty brackets or the risk %), not to code that merely looks alike. KISS: the simplest thing that works. YAGNI: don't build for a requirement nobody has. | The same constant in three files; a plugin system with one plugin |
| 04 | Composition over inheritance | Build behaviour from small parts passed in (`new Bot(entry, exit, sizer, filters)`), not deep base-class trees. | `GoldScalpBotV3 : GoldScalpBotV2 : BaseScalper : BaseBot` |
| 05 | UML class diagrams | Draw in Mermaid `classDiagram` before writing 5+ related classes. Show only: classes, key fields/methods, and the relations (inheritance ◁, composition ◆, association →). | Can't explain the design without opening the code |

## Patterns (06–18)

| # | Pattern | Use when | His-world example | Don't use when |
|---|---|---|---|---|
| 06 | Singleton | Exactly one instance is a real constraint (one DB connection pool, one config) | Foreman's `db` module export — a module-level instance is the TS/JS singleton | You just want global access — inject instead; singletons hide dependencies and break tests |
| 07 | Factory | Creation logic depends on input; callers shouldn't know concrete classes | `createNotifier("ntfy" \| "webhook" \| "email")` | One concrete class |
| 08 | Abstract Factory | Families of related objects that must match | Broker adapters: cTrader vs MT5 each give matching `OrderClient` + `MarketData` | Only one family |
| 09 | Builder | Many optional parameters or step-by-step construction with validation at `build()` | Building a quote/job card, a backtest config, an LLM request | 2–3 required params — use a constructor |
| 10 | Prototype | Copying a configured object is cheaper or clearer than building it | Clone a strategy config to make variant B for testing | Deep-copy semantics unclear (shared references) |
| 11 | Adapter | Wrap an incompatible API behind your interface | Evolve DMS / Infomedia / broker APIs behind one internal interface | You own both sides — just change one |
| 12 | Decorator | Add behaviour (logging, retry, caching, timing) around an object without changing it | `withRetry(withLogging(llmClient))`; a risk-check wrapper around order placement | The added behaviour is core, not optional |
| 13 | Facade | One simple entry point over a messy subsystem | `foreman.runTask(id)` hiding queue, browser, agent, notify | The subsystem is already simple |
| 14 | Proxy | Same interface, controls access: lazy load, cache, auth, remote | Caching proxy for a slow parts catalogue; read-only proxy for a demo account | Decorator fits better (adding features vs controlling access) |
| 15 | Observer | Many listeners react to an event without the source knowing them | Task finished → notify phone, update board, write report | Only one listener — just call it |
| 16 | Strategy | Swap an algorithm at runtime behind one interface | Entry rules, position sizing, stop placement in cBots; matching algorithms in Keystone | Only one algorithm and no plan for a second |
| 17 | Command | Turn an action into an object: queue it, log it, undo it, replay it | Foreman's recorded workflow steps; queued agent tasks | Simple direct calls with no queue/undo need |
| 18 | State | Behaviour changes with an explicit state; transitions are rules | Job card (booked → in workshop → awaiting parts → QC → invoiced); deal transfer stages; bot (flat → pending → in position → trailing) | Two states and one flag is clearer |

## Concurrency and practice (19–20)

| # | Concept | Apply it as |
|---|---|---|
| 19 | Thread safety | Prefer immutable data and message passing over shared mutable state. In C#: `lock` around shared state, `ConcurrentDictionary`, `Interlocked`, never `async void` except event handlers; cTrader calls `OnBar`/`OnTick` on one thread, but timers and `BeginInvokeOnMainThread` don't. In Node: single thread, but `await` points interleave — a check-then-act across an `await` is a race (use a transaction, a lock flag, or a queue). WPF: UI only on the dispatcher thread. |
| 20 | Machine coding | 90-minute build of a working small system (parking lot, rate limiter, splitwise, elevator, LRU cache). Order: clarify → entities and relations (UML) → interfaces → core flow working end-to-end → extensions → tests. Readable, extensible, runs — in that order of marks. |

## Refactor output

When asked to clean up code:

1. **Smells** found, each tied to a row above (one line each).
2. **Target design** — Mermaid class diagram if more than three classes.
3. **Steps** in a safe order (tests first if none exist), each small enough to
   commit alone.
4. **Code** for the changed parts.

For cBots, keep his hard rule: risk values stay `const`, never injected or
`[Parameter]`. A Strategy for sizing is fine, as long as its numbers are
constants inside it.

## Coaching loop

1. The concept in plain words + the problem it solves.
2. Before/after code (C# or TS — ask which, default to the one he's working in).
3. Where it fits — or doesn't — in his current code.
4. A small exercise; mark it.
5. For machine coding practice: set the problem, time-box, then review
   against the order in row 20.

Track progress as `LLD 12/20 ✓` lines when he's working through the list.
