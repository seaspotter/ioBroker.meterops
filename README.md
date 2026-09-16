![Logo](admin/meterops.png)
# ioBroker.meterops

[![NPM version](https://img.shields.io/npm/v/iobroker.meterops.svg)](https://www.npmjs.com/package/iobroker.meterops)
[![Downloads](https://img.shields.io/npm/dm/iobroker.meterops.svg)](https://www.npmjs.com/package/iobroker.meterops)
![Number of Installations](https://iobroker.live/badges/meterops-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/meterops-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.meterops.png?downloads=true)](https://nodei.co/npm/iobroker.meterops/)

**Tests:** ![Test and Release](https://github.com/seaspotter/ioBroker.meterops/workflows/Test%20and%20Release/badge.svg)

## meterops adapter for ioBroker

Continuous meter-reading history with automatic device-swap handling and computed energy KPIs.

Meters get replaced over the years (a meter swap, a new wallbox, a new heat pump). MeterOps keeps a
*logical* reading per meter (e.g. "grid import") continuous across such swaps via a registry of
physical devices with validity periods and offsets, and computes a fixed catalog of energy KPIs
(self-consumption ratio, autarky, COP, specific yield, battery efficiency, and more) from whichever
roles you've actually configured. See [MeterOps-Concept.md](MeterOps-Concept.md) for the full design
background, KPI formulas, and the reasoning behind each architecture decision.

### Configuration

The admin UI has four tabs:

- **General** - which history instance (e.g. `influxdb.0`) meter/group/KPI/tariff states are
  automatically logged to, and the cron schedule for periodic snapshots (used for period-based KPIs,
  see below).
- **Meters** - each logical meter's role, label, unit, and its source history (the raw ioBroker state
  it reads from, with a validity period, scale, and offset - multiple sources per meter for device
  swaps).
- **Groups** - named sums over specific meters (e.g. "all wallboxes combined"), for reporting only.
- **Tariffs** - fixed-rate price registries (e.g. grid import/feed-in price) with validity periods.

### KPIs

Computed automatically once their required roles are configured - see
[MeterOps-Concept.md](MeterOps-Concept.md#kpi-catalog-fixed-code-no-user-defined-formulas) for exact
formulas:

| KPI | Needs |
|-----|-------|
| `total_consumption` | grid import/export, PV production, battery charge/discharge |
| `self_consumption_ratio` | PV production, grid export |
| `autarky` | total consumption, grid import |
| `pv_share_of_consumption` | PV production, grid export, total consumption |
| `cop` | heat pump electric + thermal |
| `battery_efficiency` | battery charge/discharge |
| `specific_yield` | PV production, installed kWp |
| `household_consumption` | total consumption minus known submeters (residual) |

Two variants of each are written: `kpis.*` (live, from each meter's lifetime-cumulative value) and
`periodKpis.*` (from the delta between two periodic snapshots - see the concept doc's note on why
ratio KPIs need this to stay physically meaningful once meters have been running for different
amounts of time).

## Developer manual
This section is intended for the developer.

### Scripts in `package.json`
Several npm scripts are predefined for your convenience. You can run them using `npm run <scriptname>`
| Script name | Description |
|-------------|-------------|
| `build` | Compile the TypeScript and React sources. |
| `watch` | Compile and watch for changes. |
| `build:react` / `watch:react` | Compile only the admin React UI. |
| `test:ts` | Executes the tests you defined in `*.test.ts` files. |
| `test:package` | Ensures your `package.json` and `io-package.json` are valid. |
| `test` | Performs a minimal test run on package files and your tests. |
| `check` | Performs a type-check on both the adapter and admin sources. |
| `lint` | Runs `ESLint` to check your code for formatting errors and potential bugs. |
| `translate` | Translates texts in your adapter to all required languages, see [`@iobroker/adapter-dev`](https://github.com/ioBroker/adapter-dev#manage-translations) for more details. |
| `release` | Bumps the version, updates the changelog, and publishes a release - see [`@alcalzone/release-script`](https://github.com/AlCalzone/release-script). |

### Test the adapter manually with dev-server
Since you set up `dev-server`, you can use it to run, test and debug your adapter.

You may start `dev-server` by calling from your dev directory:
```bash
dev-server watch
```

The ioBroker.admin interface will then be available at http://localhost:8082/

Please refer to the [`dev-server` documentation](https://github.com/ioBroker/dev-server#command-line) for more details.

### Publishing the adapter
Using GitHub Actions, you can enable automatic releases on npm whenever you push a new git tag that matches the form
`v<major>.<minor>.<patch>`. The necessary steps are described in `.github/workflows/test-and-release.yml`.

To get the adapter released in ioBroker, see the documentation
of [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories#requirements-for-adapter-to-get-added-to-the-latest-repository).

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
* (SeaSpotter) nothing yet

### 0.0.1 (2026-09-16)
* (SeaSpotter) initial release

Older entries are archived in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

## License
MIT License

Copyright (c) 2026 SeaSpotter <seatowage@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
