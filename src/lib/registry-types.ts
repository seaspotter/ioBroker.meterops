// Roles the registry config can assign to a meter instance.
// Kept in sync with the role list in MeterOps-Concept.md.

export const SINGLETON_ROLES = [
    'grid_import',
    'grid_export',
    'pv_production',
    'heatpump_electric',
    'heatpump_thermal',
    'battery_charge',
    'battery_discharge',
] as const;

// Repeatable: any number of freely named instances (heat pump, wallbox
// main/slave, ...) all summed together as the subtrahend of the
// household_consumption residual.
export const REPEATABLE_ROLES = ['known_subconsumer'] as const;

export type SingletonRole = (typeof SINGLETON_ROLES)[number];
export type RepeatableRole = (typeof REPEATABLE_ROLES)[number];
export type Role = SingletonRole | RepeatableRole;

/** One physical device's contribution to a meter's logical history, valid for a date range. */
export interface MeterSource {
    /** ioBroker state ID this source reads its raw value from */
    stateId: string;
    /** ISO date (YYYY-MM-DD), inclusive */
    validFrom: string;
    /** ISO date (YYYY-MM-DD), inclusive, or null if still active */
    validTo: string | null;
    /** raw reading is multiplied by this before offset is added - e.g. 0.001 to convert a Wh source into a kWh meter. Defaults to 1. */
    scale?: number;
    /** added to the scaled reading to continue the logical series across a device swap */
    offset: number;
}

/** A configured logical meter: a role plus the physical devices that fed it over time. */
export interface MeterConfig {
    /** role determines which KPIs can use this meter, and whether it must be unique */
    role: Role;
    /** display label, mainly useful to tell repeatable-role instances apart */
    label: string;
    /** unit of the logical (offset-corrected) value, e.g. "kWh" or "m3" */
    unit: string;
    /** device history for this meter, ordered or not - resolved by validFrom/validTo */
    sources: MeterSource[];
}

/** The full registry: every configured meter, keyed by a freely chosen meter id. */
export interface RegistryConfig {
    /** key = freely chosen meter instance id, e.g. "water_garden", "wallbox_main" */
    meters: Record<string, MeterConfig>;
}
