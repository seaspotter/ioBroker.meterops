// Fixed KPI catalog - no user-defined formulas. See MeterOps-Concept.md.
//
// Each entry's dependencies may be raw roles (from the registry) or other
// KPI ids (computed values) - total_consumption sits between the two, since
// household_consumption and autarky both depend on it. getActiveKpis /
// evaluateKpis resolve availability and evaluation order together via a
// fixed-point pass: cheap for a catalog this size, and the output order is
// already valid (dependencies before dependents).

export type KpiId =
    | 'total_consumption'
    | 'self_consumption_ratio'
    | 'cop'
    | 'autarky'
    | 'household_consumption'
    | 'battery_efficiency'
    | 'pv_share_of_consumption'
    | 'specific_yield';

interface FormulaKpiDef {
    type: 'formula';
    requires: readonly string[];
    calc: (values: Readonly<Record<string, number>>) => number;
}

interface ResidualKpiDef {
    type: 'residual';
    /** minuend - typically another computed KPI (e.g. total_consumption) */
    total: string;
    /** subtrahend - the pre-aggregated sum of all instances of a repeatable role */
    subtract: string;
}

type KpiDef = FormulaKpiDef | ResidualKpiDef;

/** unit each KPI is reported in, for state object creation */
export const KPI_UNITS: Record<KpiId, string> = {
    total_consumption: 'kWh',
    self_consumption_ratio: '',
    cop: '',
    autarky: '',
    household_consumption: 'kWh',
    battery_efficiency: '',
    pv_share_of_consumption: '',
    specific_yield: 'kWh/kWp',
};

/** human-readable English name each KPI is reported under (common.name), rather than the raw snake_case id */
export const KPI_NAMES: Record<KpiId, string> = {
    total_consumption: 'Total consumption',
    self_consumption_ratio: 'Self-consumption ratio',
    cop: 'Coefficient of performance (COP)',
    autarky: 'Autarky',
    household_consumption: 'Household consumption',
    battery_efficiency: 'Battery round-trip efficiency',
    pv_share_of_consumption: 'PV share of consumption',
    specific_yield: 'Specific yield',
};

export const KPI_CATALOG: Record<KpiId, KpiDef> = {
    total_consumption: {
        type: 'formula',
        requires: ['grid_import', 'pv_production', 'grid_export', 'battery_discharge', 'battery_charge'],
        calc: v => v.grid_import + v.pv_production + v.battery_discharge - v.grid_export - v.battery_charge,
    },
    self_consumption_ratio: {
        type: 'formula',
        requires: ['pv_production', 'grid_export'],
        calc: v => (v.pv_production - v.grid_export) / v.pv_production,
    },
    cop: {
        type: 'formula',
        requires: ['heatpump_thermal', 'heatpump_electric'],
        calc: v => v.heatpump_thermal / v.heatpump_electric,
    },
    autarky: {
        type: 'formula',
        requires: ['total_consumption', 'grid_import'],
        calc: v => (v.total_consumption - v.grid_import) / v.total_consumption,
    },
    household_consumption: {
        type: 'residual',
        total: 'total_consumption',
        subtract: 'known_subconsumer',
    },
    // lifetime cumulative ratio (charge/discharge are lifetime counters) - a period-based
    // (e.g. monthly) efficiency to track degradation is a Grafana concern on the historized
    // series, consistent with how rate/delta calculations are already delegated to Grafana.
    battery_efficiency: {
        type: 'formula',
        requires: ['battery_charge', 'battery_discharge'],
        calc: v => v.battery_discharge / v.battery_charge,
    },
    // distinct from autarky: excludes battery's contribution, so it isolates PV's own share
    pv_share_of_consumption: {
        type: 'formula',
        requires: ['pv_production', 'grid_export', 'total_consumption'],
        calc: v => (v.pv_production - v.grid_export) / v.total_consumption,
    },
    // lifetime cumulative kWh/kWp, not the industry-standard annual specific yield - an
    // annual figure needs a period delta on the historized series, a Grafana concern like
    // battery_efficiency's period-based variant above. pv_capacity_kwp comes from
    // systemParams, a constant threaded into the values map by the caller.
    specific_yield: {
        type: 'formula',
        requires: ['pv_production', 'pv_capacity_kwp'],
        calc: v => v.pv_production / v.pv_capacity_kwp,
    },
};

function dependenciesOf(def: KpiDef): readonly string[] {
    return def.type === 'formula' ? def.requires : [def.total, def.subtract];
}

/**
 * Determines which KPIs can be computed from the given available values (raw roles and/or
 * already-computed KPI ids), in a valid evaluation order (dependencies before dependents).
 *
 * @param availableKeys - roles/KPI ids for which a current value exists
 */
export function getActiveKpis(availableKeys: Iterable<string>): KpiId[] {
    const resolved = new Set<string>(availableKeys);
    const active: KpiId[] = [];
    let progress = true;
    while (progress) {
        progress = false;
        for (const id of Object.keys(KPI_CATALOG) as KpiId[]) {
            if (resolved.has(id)) {
                continue;
            }
            if (dependenciesOf(KPI_CATALOG[id]).every(d => resolved.has(d))) {
                resolved.add(id);
                active.push(id);
                progress = true;
            }
        }
    }
    return active;
}

/**
 * Computes every KPI whose dependencies are satisfied by the given values.
 *
 * @param values - current values keyed by role (repeatable roles pre-aggregated by the caller)
 */
export function evaluateKpis(values: Readonly<Record<string, number>>): Partial<Record<KpiId, number>> {
    const working: Record<string, number> = { ...values };
    const results: Partial<Record<KpiId, number>> = {};

    for (const id of getActiveKpis(Object.keys(values))) {
        const def = KPI_CATALOG[id];
        const value = def.type === 'formula' ? def.calc(working) : working[def.total] - working[def.subtract];
        working[id] = value;
        results[id] = value;
    }
    return results;
}
