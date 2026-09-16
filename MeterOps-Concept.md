# MeterOps — Concept Sketch

Summary of the brainstorming around a continuous meter-reading history with
automatically computed energy KPIs. Starting point: a Google Sheet, hand-maintained
for years, with monthly meter readings (grid import, feed-in, PV production,
heat pump electric/thermal, wallbox main/slave, battery, ...) and derived
metrics (self-consumption ratio, COP, cost split, feed-in tariff).

## Core problem

Devices get replaced over the years (meter swaps, a new wallbox, a new heat
pump meter). A device swap must not show up as a jump in the *logical*
consumption figure ("garden water", "heat pump electric") — but the raw
values per physical device are exactly that: discontinuous.

## Architecture decision

**Separate the physical device from the logical quantity** via a registry
with validity periods — the same pattern applies to two independent things:

1. **Device registry** — which source state/meter was active from–to, with
   an offset (analogous: a tariff registry for price changes over time)
2. **Roles instead of device IDs** — the config names roles (`grid_import`,
   `grid_export`, `pv_production`, `heatpump_electric`, `heatpump_thermal`,
   `known_subconsumer`, ...), not devices. Roles come in two kinds:
   - **singleton** — exactly one instance expected (grid import, feed-in, ...)
   - **repeatable** — any number of freely named sub-meters (heat pump,
     wallbox main/slave, ...), e.g. for the household-consumption residual
   - `battery_charge` / `battery_discharge` are roles too (singleton, one
     battery) — needed to derive `total_consumption` below when a battery
     is present, not just for the wallbox-from-battery edge case

### KPI catalog (fixed code, no user-defined formulas)

```javascript
const KPI_CATALOG = {
  total_consumption: {
    type: 'formula',                // derived, not a separately metered role
    requires: ['grid_import', 'pv_production', 'grid_export',
               'battery_discharge', 'battery_charge'],
    calc: ({ grid_import, pv_production, grid_export,
             battery_discharge, battery_charge }) =>
      grid_import + pv_production + battery_discharge
        - grid_export - battery_charge
  },
  self_consumption_ratio: {
    type: 'formula',
    requires: ['pv_production', 'grid_export'],
    calc: ({ pv_production, grid_export }) =>
      (pv_production - grid_export) / pv_production
  },
  cop: {
    type: 'formula',
    requires: ['heatpump_thermal', 'heatpump_electric'],
    calc: ({ heatpump_thermal, heatpump_electric }) =>
      heatpump_thermal / heatpump_electric
  },
  autarky: {
    type: 'formula',
    requires: ['total_consumption', 'grid_import'],  // depends on another KPI, not just raw roles
    calc: ({ total_consumption, grid_import }) =>
      (total_consumption - grid_import) / total_consumption
  },
  household_consumption: {
    type: 'residual',              // residual quantity, not a fixed formula
    total: 'total_consumption',    // minuend: itself a computed KPI now
    subtract: 'known_subconsumer'  // subtrahend: sum of ALL instances of this role
  },
  // lifetime cumulative ratio (charge/discharge are lifetime counters) - a
  // period-based (e.g. monthly) efficiency to track degradation is a
  // Grafana concern on the historized series, not this KPI's job
  battery_efficiency: {
    type: 'formula',
    requires: ['battery_charge', 'battery_discharge'],
    calc: ({ battery_charge, battery_discharge }) => battery_discharge / battery_charge
  },
  // distinct from autarky: excludes battery's contribution, isolating PV's own share
  pv_share_of_consumption: {
    type: 'formula',
    requires: ['pv_production', 'grid_export', 'total_consumption'],
    calc: ({ pv_production, grid_export, total_consumption }) =>
      (pv_production - grid_export) / total_consumption
  },
  // pv_capacity_kwp isn't a role - it's a constant from systemParams,
  // threaded into the values map by the caller alongside the live roles
  specific_yield: {
    type: 'formula',
    requires: ['pv_production', 'pv_capacity_kwp'],
    calc: ({ pv_production, pv_capacity_kwp }) => pv_production / pv_capacity_kwp
  }
};

// Requirements may be raw configured roles OR other KPI ids (computed
// values) — total_consumption sits between the two. Resolve availability
// and evaluation order together via a simple fixed-point pass: repeatedly
// activate any KPI whose dependencies are already satisfied, until nothing
// new activates. Cheap for a catalog this size, and the output order is
// already a valid evaluation order (dependencies before dependents).
function getActiveKpis(configuredRoles) {
  const resolved = new Set(configuredRoles);
  const active = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const [id, def] of Object.entries(KPI_CATALOG)) {
      if (resolved.has(id)) continue;
      const deps = def.requires ?? [def.total, def.subtract];
      if (deps.every(d => resolved.has(d))) {
        resolved.add(id);
        active.push({ id, ...def });
        progress = true;
      }
    }
  }
  return active;
}
```

**Open edge case:** Overlapping sub-meters (e.g. a wallbox charging from the
battery, which is separately counted as `battery_discharge`) can cause
double-counting in `known_subconsumer` totals even though the energy
balance in `total_consumption` itself is now closed. Not generically
solvable — pure wiring knowledge. A plausibility check ("household
consumption negative → warning") is a plausible safety net, but not part
of phase 1.

**Known limitation:** `total_consumption` via the balance formula is only
as accurate as the underlying meters and battery round-trip efficiency —
charge/discharge losses (typically 5–15%) mean the formula slightly
under-counts consumption on days with heavy battery cycling. Not worth
correcting for in phase 1; revisit if `household_consumption` looks
systematically off in Phase 2. (`battery_efficiency` above now measures
this directly from real data instead of relying on the assumed range.)

**Known limitation:** the ratio-type KPIs (`self_consumption_ratio`,
`autarky`, `cop`, `battery_efficiency`, `pv_share_of_consumption`,
`specific_yield`) are computed live from each meter's *lifetime*
cumulative value. That's only physically meaningful once every
contributing meter has been accumulating over a comparable time window.
Confirmed as a real problem against the actual live setup: lifetime `cop`
came out as 7.19 (real heat pumps run 3–4.5), almost certainly because
`heatpump_electric`'s raw counter has a much shorter history than
`heatpump_thermal`'s — mixing a "young" total with an "old" total
distorts the ratio. `total_consumption` and `household_consumption`
aren't affected the same way (they're meant to be running lifetime
totals, and cross-checked consistent against the submeter sum). Not
fixed for phase 1 — either backfilling accurate `validFrom` per meter
(documents the mismatch, doesn't fix the underlying math) or moving
ratio KPIs to delta-based computation in Grafana (matches the pipeline's
original division of labor, but drops them from the adapter's own state
tree) would resolve it. Revisit once there's enough live history for the
mismatch to become negligible, or if it turns out to matter sooner.

**Resolved differently than expected — periodic snapshots:** the above
limitation is actually solved by returning to the tool's original
premise (a hand-maintained *monthly* reading history). A delta between
two snapshots taken at the same two points in time is comparable
regardless of when each raw counter started accumulating — any constant
head start cancels out in the subtraction. So alongside the live,
lifetime-cumulative `kpis.*` states, the adapter now also:

- runs a configurable cron schedule (`native.snapshotCron`, admin UI:
  General tab, default `0 0 1 * *` = monthly on the 1st) that snapshots
  every meter's current value to `snapshots.<meterId>`
- on each snapshot, computes the delta against the *previous* snapshot
  (read back from that same state, so it survives adapter restarts) and
  recomputes the ratio-type KPIs from those deltas into a parallel
  `periodKpis.*` namespace, reusing the exact same KPI catalog and
  `evaluateKpis()` - only the value source differs (deltas vs. live
  cumulative values)
- the first snapshot for a meter has no prior value to diff against, so
  it just sets the baseline; the delta (and period KPIs) become
  available starting the second scheduled run

`kpis.*` (live, lifetime) and `periodKpis.*` (delta-based, meaningful
regardless of mismatched counter ages) now coexist - the former for
"what's the value right now", the latter for "how did this period
actually perform."

**History logging is no longer manual either:** a new `native.historyInstance`
setting (admin UI: General tab, an instance picker filtered to adapters
with `common.getHistory`, e.g. `influxdb.0`) is applied via
`extendObject`'s `common.custom` to every state the adapter creates
(`meters.*`, `groups.*`, `kpis.*`, `periodKpis.*`, `tariffs.*`,
`snapshots.*`) - previously these states existed but nothing was
actually being persisted to history unless enabled by hand per state in
Admin's Objects tab.

### Registry extensions (added from real-data feedback)

- **`includeInResidual` (per meter, default `true`):** `known_subconsumer`
  instances are summed into `household_consumption`'s subtraction by
  default, but a meter can opt out (`includeInResidual: false`) to be
  tracked for its own sake without changing that residual — e.g. a
  submeter added purely out of curiosity.
- **Meter groups:** a named sum of specific meter ids, independent of the
  KPI catalog — e.g. `wallbox_total` combining two wallbox meters into one
  reported value. Only reported once every member has a value, same rule
  as the `known_subconsumer` aggregation.
- **`systemParams`:** constants that aren't live readings but feed certain
  KPIs — currently just `pvCapacityKwp` for `specific_yield`. Threaded
  into the KPI values map by the adapter alongside the live roles, so the
  KPI catalog doesn't need a separate mechanism for constants vs. readings.
- **Fixed-rate tariff registry:** validity-period entries per tariff id
  (`grid_price`, `feed_in_price`, ...), resolved once at adapter startup —
  not re-checked live, since a fixed contract rate changes rarely. Exposed
  as a plain current-price state, not folded into a "cost so far" KPI:
  multiplying a *lifetime cumulative* meter by a single current price
  would silently misreport cost across any historical price change. Actual
  period cost (e.g. "what did I pay this month") is a Grafana job — delta
  of the historized cumulative meter × the historized price series over
  that period — consistent with how rate/delta math is already delegated
  to Grafana rather than computed by the adapter.

## Resolver — core logic (database-centric)

```javascript
const CONFIG = {
  meters: {
    water_garden: {
      unit: 'm3',
      sources: [
        { rawSeries: 'water_meter_old', validFrom: '2018-06-01', validTo: '2021-09-14', offset: 0 },
        { rawSeries: 'water_meter_new', validFrom: '2021-09-15', validTo: null, offset: 4754.1 }
      ]
    }
    // more roles analogously: heatpump_electric, heatpump_thermal, grid_import, ...
  },
  tariffs: {
    grid_price: [
      { validFrom: '2018-06-01', validTo: '2022-12-31', value: 0.28 },
      { validFrom: '2023-01-01', validTo: null, value: 0.35 }
    ]
  },
  db: { type: 'influxdb', url: 'http://localhost:8086', logicalMeasurement: 'logical_meters' }
};

function resolveActiveEntry(registry, timestamp) {
  return registry.find(e =>
    timestamp >= new Date(e.validFrom) && (!e.validTo || timestamp <= new Date(e.validTo)));
}

function resolveMeterValue(meterId, timestamp, rawValue) {
  const entry = resolveActiveEntry(CONFIG.meters[meterId].sources, timestamp);
  if (!entry) throw new Error(`No registry entry for ${meterId} @ ${timestamp}`);
  return rawValue + entry.offset;
}

async function writeLogicalPoint(meterId, timestamp, value) {
  const line = `${CONFIG.db.logicalMeasurement},meter=${meterId} value=${value} ${timestamp.getTime()}000000`;
  const endpoint = CONFIG.db.type === 'influxdb' ? `${CONFIG.db.url}/write?db=energy` : `${CONFIG.db.url}/write`;
  await fetch(endpoint, { method: 'POST', body: line });
}
```

**Important:** the resolver only reads/writes against the database (the
history adapter already writes raw values there) — no dependency on a
running ioBroker instance at runtime.

## Pipeline

```
Raw data (history adapter, already in place)
   → Resolver (registry config, to be built)
      → new logical time series (same DB, new measurement)
         → Grafana (panels, transformations)
```

Grafana handles the *presentation logic* (consumption/day, ratios,
year-over-year comparisons via `time_shift`, COP calculated correctly as
sum/sum rather than an average of individual quotients — via the "Add
field from calculation" transformation on two aggregation queries). That
part is DB-agnostic because it operates on the query result. The
*aggregation query itself* (e.g. `GROUP BY time(1M)`) is not: calendar
months/years are native in InfluxQL/Flux, not in PromQL/MetricsQL
(VictoriaMetrics) — relevant to the parallel Influx→VM migration
consideration.

## Migrating historical data

One-off script: reads the old sheet rows (Sheets API/CSV export), runs them
through the same resolver/KPI logic, writes raw values + KPIs with the
historical timestamps into the DB. Never needed again afterwards. Registry
entries (device swaps, tariff changes) themselves: entered manually, once
(from memory/old invoices).

## Tool vs. ioBroker adapter

**Decided: build as an ioBroker adapter from the start**, not a
standalone script that might migrate later. The jsonConfig registry table
(state picker, date fields, no free text) is the concrete payoff, and
writing the resolver once against ioBroker's state/object model avoids
re-plumbing a script-based prototype into an adapter afterwards.

This reverses the original leaning below, kept for reference since part of
it still matters: the resolver's core logic (registry lookup, KPI
computation) only *needs* the DB, not a running ioBroker instance — that
stays true and is exactly why the one-off historical-migration script can
still call the same resolver module standalone, without a live adapter
instance. What changes is that this is no longer a reason to *default* to
a standalone tool; it's just a useful property of how the resolver module
is factored.

Original reasoning (superseded): no adapter scaffolding
(io-package.json, lifecycle, npm publishing) needed, usable by anyone
running Influx/VM, not just ioBroker users. An adapter would only pay off
if live state access (`subscribeForeignStates`) brings real value over a
cron script.

**Market check:** no existing ioBroker adapter covers this
(`energiefluss` = live visualization only, `energypilot` = control/
optimization, no reporting). An open community request
(ioBroker/AdapterRequests #943) confirms demand for similar PV statistics
— suggests community value if the tool becomes generic enough.

**Publishing cost, concretely:** having been through
`iobroker.victoriametrics`'s publishing process end-to-end (see "Lessons
from iobroker.victoriametrics" below), the adapter path has a real, known
tax — a checker/schema-conformance pass, two separate review rounds
(automated + human maintainer), and translation/English-only requirements.
Since the adapter is committed, that tax is accepted, not weighed against
a tool-only alternative anymore — but it's still worth front-loading the
lessons in Phase 1 rather than discovering them at submission time.

## Lessons from iobroker.victoriametrics (publishing pains to avoid)

Concrete friction from getting `iobroker.victoriametrics` through the
ioBroker checker and into the official repository — since MeterOps is an
adapter from Phase 1 (not a later migration), these are day-one design
decisions, not a fix-up pass before submission.

**io-package.json schema (biggest source of checker errors):**
- `encryptedNative` / `protectedNative` must be top-level keys, not nested
  under `common` — nesting produces confusing false-seeming "password not
  protected" warnings.
- `common.docs` needs an `en` key if present at all; if the README already
  covers English, omit `common.docs` rather than adding a redundant file.
- State `role` is semantically checked: a string-valued state can't use
  role `value` (numbers only) — needs `text`.
- `common.news` may only list versions actually published to npm.
- `common.title` is deprecated in favor of `titleLang`, despite some
  contribution docs still asking for both.
- `common.keywords` (io-package.json) forbids generic terms like
  "iobroker"/"adapter"/"smart home"; `package.json` keywords conversely
  *should* include "ioBroker" — easy to get backwards.
- i18n objects (name, desc, news, ...) need all supported languages filled
  in, not just en/de.
- `instanceObjects` needs an explicit `meta`-type object for any
  file-storage use (`writeFileAsync`) — otherwise it throws at runtime and
  silently discards data. Plan cache/meta objects up front.
- Admin jsonConfig/jsonCustom fields need all five responsive breakpoints
  (xs/sm/md/lg/xl) declared per field.
- `engines.node` / `admin.globalDependency` minimums move over time —
  pin conservatively and expect to bump them.

**Tooling/process:**
- `@alcalzone/release-script` doesn't auto-load the iobroker/license/
  manual-review plugins by default — needs an explicit
  `.releaseconfig.json`, or io-package.json version/news silently drift
  from package.json across a release.
- The CHANGELOG "WORK IN PROGRESS" placeholder must be a literal heading
  line release-script can find, not hidden in an HTML comment.
- npm trusted publishing (OIDC) needs a newer Node in the deploy job than
  the adapter's own `engines.node` may require.
- Dependabot needs an explicit cooldown (≥7 days) on npm updates, and the
  README needs a changelog-link footer to `CHANGELOG_OLD.md`.

**English-first / translation:**
- README.md must be the canonical English doc for official submission;
  German-first docs get moved to `docs/de/<adapter>.md` and linked from
  the English README.
- All runtime-facing strings (logs, errors, `sendTo` responses) must be
  English too — plan for a dedicated grep pass, since reviewers themselves
  can miss instances.
- Run `translate-adapter` for all ~11 languages from day one rather than
  just en/de.

**Repo/identity conventions:**
- GitHub repo name must exactly match `ioBroker.<name>` (capital B) —
  get this right before the first push, a rename later touches
  package.json, io-package.json, README, and LICENSE.
- `repository.url` in package.json needs to be publish-clean from the
  start.

**Checker reality:**
- The standalone web checker and the actual PR-time checker bot can
  disagree — treat the live PR-checker as authoritative.
- A human maintainer review follows automated-checker success and checks
  *different* things (i18n completeness, remaining non-English strings,
  a screenshot of any custom admin UI in the README) — budget for two
  distinct review passes, not one.

## Future ideas (not phase 1)

- **Power-to-energy integration ("simcounter")**: some devices only expose
  instantaneous power (W/kW), not a cumulative energy counter - e.g. air
  conditioning has no metering at all in the real setup used to validate
  this concept. A future resolver mode could numerically integrate a power
  reading over time into a synthetic cumulative counter, so such devices
  can still be registered as `known_subconsumer` instances. Real scope
  increase (accuracy/drift over integration gaps, restart handling), not
  attempted until a concrete device actually needs it.
- **Dynamic/spot tariffs**: the fixed-rate tariff registry (above) assumes
  a rarely-changing contract price. A Tibber/aWATTar-style spot tariff
  changes hourly and would need cost KPIs to read a live price series
  rather than a validity-period registry - a genuinely bigger design
  problem (correctly attributing consumption deltas to the price active
  *during* each delta, not just "the current price"). Not attempted until
  actually needed; the current live grid/feed-in price states found in the
  real setup turned out to be a fixed rate that merely lives in a state,
  not a spot tariff, so this wasn't blocking for now.

## Development stages

### Phase 1 — Adapter skeleton + resolver core

Goal: prove the registry/offset pattern end-to-end on real data, built
directly on ioBroker's state/object model from the first commit — no
standalone-script detour, since the adapter is the committed target.

1. Scaffold with `@iobroker/create-adapter` and bake the
   victoriametrics lessons into the template immediately: top-level
   `encryptedNative`/`protectedNative`, correct state roles/types,
   `meta`-type objects planned for any cached files,
   `.releaseconfig.json` with the full plugin set, English-only
   README/logs/errors from commit one.
2. Define the registry config shape (roles, sources — `rawSeries`,
   `validFrom`, `validTo`, `offset`, singleton vs. repeatable). Start it
   as a plain JSON field in adapter `native` config — the polished
   jsonConfig table (state picker, date fields) is worth deferring until
   the role types are validated by real usage, not guessed on day one.
3. Implement the resolver core (`resolveActiveEntry`, `resolveMeterValue`,
   `writeLogicalPoint`) inside the adapter's write cycle, reading raw
   values via ioBroker state/history access and writing logical states.
4. Prove it on the **grid trio** first — `grid_import`, `grid_export`,
   `pv_production` — since together they unlock `self_consumption_ratio`
   immediately: one slice validates registry/offset resolution *and* the
   fixed-formula KPI path, not just a clean series.
5. Separately validate the offset math against whichever meter actually
   had a real device swap (`water_garden` if that's still the one with
   known history) — the grid trio may pass with zero registry entries and
   never exercise that code path at all, so don't skip this check.
6. Extend the registry config to the remaining singleton roles.
7. Extend to repeatable roles (`heatpump_electric/thermal`, wallbox
   main/slave, ...).
8. Migrate historical sheet data: one-off script that imports the same
   resolver module standalone (no running adapter instance needed) and
   backfills historical timestamps into the DB.
9. Complete the KPI catalog (`getActiveKpis`, `cop`,
   `household_consumption` residual) once raw logical series exist for
   all configured roles.
10. Wire minimal Grafana panels — enough to sanity-check the output
    visually, not a finished dashboard.

### Phase 2 — Stabilize against real data

Goal: let the adapter run unattended for a while and see what breaks.

- Run the instance for a few weeks; watch for registry gaps
  (unregistered device, missing `validTo`) and resolver errors in the
  adapter log.
- Handle overlapping-sub-meter double-counting cases as they actually
  occur (e.g. wallbox charging from battery) — deliberately deferred
  from Phase 1, only worth solving once a real instance shows up.
- Add the plausibility check floated earlier (household consumption
  negative → warning) if the residual KPI turns out noisy in practice.
- Settle the final KPI set from actual usage, not from the initial guess.
- Resolve the Influx→VictoriaMetrics question here if it's still open —
  by now there's real query/aggregation experience to decide from.
- **Done:** the admin UI is a custom React app (`adminUI.config:
  "materialize"`, `@iobroker/adapter-react` 2.0.22 + `@material-ui/core`
  v4, built via `build-adapter react`) rather than a plain jsonConfig
  table — checked the real jsonConfig schema and confirmed table rows
  can't nest a sub-table, which per-meter source history (multiple
  time-bounded raw devices) needs. Scaffolded from
  `@iobroker/create-adapter`'s own React template (generated into a
  throwaway dir and merged in) so it matches current tooling/checker
  conventions exactly, rather than reconstructed from memory. Four tabs
  — General (history instance, snapshot-schedule cron editor), Meters
  (role/label/unit/includeInResidual fields plus a real nested
  add/remove sources sub-table per meter, with a live state picker for
  `stateId`), Groups (member checklist), Tariffs (validity-period
  entries) — all editing the single `native.registryConfig` JSON blob
  client-side (`src/lib/registry-json.ts`); `registry.ts`'s strict
  validation stays adapter-side only, unchanged. Known simplification:
  `historyInstance` is a plain text field, not a live-fetched dropdown
  of history-capable instances (jsonConfig's `instance` picker had a
  built-in filter for that; `adapter-react`'s `Connection` class only
  exposes per-adapter-name instance listing) — revisit if that's
  actually annoying to use.

### Phase 3 — Community readiness

Goal: only once the tool looks generic enough to be useful beyond your
own setup — this is where the publishing tax gets paid.

- Generalize docs and plausibility checks for other people's role
  configurations.
- Run `translate-adapter` for all supported languages.
- Budget two separate review passes: the automated checker, then a
  human maintainer review — each catches different things (see lessons
  above), so don't treat a clean checker run as done.

## Naming

Candidate: **MeterOps** — checked, no discoverable collision (web search
on npm/GitHub). Before finalizing, do a direct check on
`npmjs.com/package/meterops` and `github.com/search?q=meterops`.

Rejected due to collisions:
- **Energytrace** — TI trademark (MSP430 EnergyTrace technology) + an
  existing CLI tool `energytrace-util`
- **EnergyKeeper** — existing hardware brand with an app-store app
  (solar/battery control)
- **MeterSync** — existing taxi-meter SDK (Codeversant), different
  industry, lower risk, but actually taken
