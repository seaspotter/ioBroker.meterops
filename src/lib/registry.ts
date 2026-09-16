import type {
    MeterConfig,
    MeterGroupConfig,
    MeterSource,
    RegistryConfig,
    SingletonRole,
    TariffEntry,
} from './registry-types';
import { SINGLETON_ROLES } from './registry-types';

/** Thrown when native.registryConfig is missing, malformed, or violates the schema (e.g. a duplicate singleton role). */
export class RegistryConfigError extends Error {}

/**
 * Parses and validates the raw JSON from the adapter's native.registryConfig field.
 *
 * @param raw - JSON-encoded RegistryConfig
 */
export function parseRegistryConfig(raw: string): RegistryConfig {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new RegistryConfigError(`Registry config is not valid JSON: ${(err as Error).message}`);
    }
    validateRegistryConfig(parsed);
    return parsed;
}

function validateRegistryConfig(parsed: unknown): asserts parsed is RegistryConfig {
    if (typeof parsed !== 'object' || parsed === null || !('meters' in parsed)) {
        throw new RegistryConfigError('Registry config must be an object with a "meters" key');
    }
    const meters = parsed.meters;
    if (typeof meters !== 'object' || meters === null || Array.isArray(meters)) {
        throw new RegistryConfigError('"meters" must be an object keyed by meter id');
    }

    const seenSingletonRoles = new Map<SingletonRole, string>();

    for (const [meterId, meter] of Object.entries(meters as Record<string, unknown>)) {
        validateMeterConfig(meterId, meter);

        if ((SINGLETON_ROLES as readonly string[]).includes(meter.role)) {
            const role = meter.role as SingletonRole;
            const existing = seenSingletonRoles.get(role);
            if (existing) {
                throw new RegistryConfigError(
                    `Role "${role}" is singleton but configured twice: "${existing}" and "${meterId}"`,
                );
            }
            seenSingletonRoles.set(role, meterId);
        }
    }

    const meterIds = new Set(Object.keys(meters));
    const rest = parsed as Record<string, unknown>;
    validateGroups(rest.groups, meterIds);
    validateSystemParams(rest.systemParams);
    validateTariffs(rest.tariffs);
}

function validateTariffs(tariffs: unknown): void {
    if (tariffs === undefined) {
        return;
    }
    if (typeof tariffs !== 'object' || tariffs === null || Array.isArray(tariffs)) {
        throw new RegistryConfigError('"tariffs" must be an object keyed by tariff id');
    }
    for (const [tariffId, entries] of Object.entries(tariffs)) {
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new RegistryConfigError(`Tariff "${tariffId}" needs at least one entry`);
        }
        entries.forEach((entry, index) => validateTariffEntry(tariffId, index, entry));
    }
}

function validateTariffEntry(tariffId: string, index: number, entry: unknown): asserts entry is TariffEntry {
    if (typeof entry !== 'object' || entry === null) {
        throw new RegistryConfigError(`Tariff "${tariffId}" entry #${index} must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.validFrom !== 'string' || Number.isNaN(Date.parse(e.validFrom))) {
        throw new RegistryConfigError(`Tariff "${tariffId}" entry #${index} has an invalid "validFrom"`);
    }
    if (e.validTo !== null && (typeof e.validTo !== 'string' || Number.isNaN(Date.parse(e.validTo)))) {
        throw new RegistryConfigError(`Tariff "${tariffId}" entry #${index} has an invalid "validTo"`);
    }
    if (typeof e.value !== 'number' || !Number.isFinite(e.value)) {
        throw new RegistryConfigError(`Tariff "${tariffId}" entry #${index} needs a numeric "value"`);
    }
}

function validateGroups(groups: unknown, meterIds: ReadonlySet<string>): void {
    if (groups === undefined) {
        return;
    }
    if (typeof groups !== 'object' || groups === null || Array.isArray(groups)) {
        throw new RegistryConfigError('"groups" must be an object keyed by group id');
    }

    for (const [groupId, group] of Object.entries(groups)) {
        if (meterIds.has(groupId)) {
            throw new RegistryConfigError(`Group id "${groupId}" collides with a meter id`);
        }
        validateMeterGroupConfig(groupId, group, meterIds);
    }
}

function validateMeterGroupConfig(
    groupId: string,
    group: unknown,
    meterIds: ReadonlySet<string>,
): asserts group is MeterGroupConfig {
    if (typeof group !== 'object' || group === null) {
        throw new RegistryConfigError(`Group "${groupId}" must be an object`);
    }
    const g = group as Record<string, unknown>;
    if (!Array.isArray(g.members) || g.members.length === 0) {
        throw new RegistryConfigError(`Group "${groupId}" needs at least one entry in "members"`);
    }
    for (const memberId of g.members) {
        if (typeof memberId !== 'string' || !meterIds.has(memberId)) {
            throw new RegistryConfigError(`Group "${groupId}" references unknown meter "${String(memberId)}"`);
        }
    }
}

function validateSystemParams(systemParams: unknown): void {
    if (systemParams === undefined) {
        return;
    }
    if (typeof systemParams !== 'object' || systemParams === null) {
        throw new RegistryConfigError('"systemParams" must be an object');
    }
    const p = systemParams as Record<string, unknown>;
    if (p.pvCapacityKwp !== undefined && (typeof p.pvCapacityKwp !== 'number' || !Number.isFinite(p.pvCapacityKwp))) {
        throw new RegistryConfigError('"systemParams.pvCapacityKwp" must be a number');
    }
}

function validateMeterConfig(meterId: string, meter: unknown): asserts meter is MeterConfig {
    if (typeof meter !== 'object' || meter === null) {
        throw new RegistryConfigError(`Meter "${meterId}" must be an object`);
    }
    const m = meter as Record<string, unknown>;
    if (typeof m.role !== 'string' || !m.role) {
        throw new RegistryConfigError(`Meter "${meterId}" is missing a "role" string`);
    }
    if (!Array.isArray(m.sources) || m.sources.length === 0) {
        throw new RegistryConfigError(`Meter "${meterId}" needs at least one entry in "sources"`);
    }
    if (m.includeInResidual !== undefined && typeof m.includeInResidual !== 'boolean') {
        throw new RegistryConfigError(`Meter "${meterId}" has a non-boolean "includeInResidual"`);
    }
    m.sources.forEach((source, index) => validateMeterSource(meterId, index, source));
}

function validateMeterSource(meterId: string, index: number, source: unknown): asserts source is MeterSource {
    if (typeof source !== 'object' || source === null) {
        throw new RegistryConfigError(`Meter "${meterId}" source #${index} must be an object`);
    }
    const s = source as Record<string, unknown>;
    if (typeof s.stateId !== 'string' || !s.stateId) {
        throw new RegistryConfigError(`Meter "${meterId}" source #${index} needs a "stateId"`);
    }
    if (typeof s.validFrom !== 'string' || Number.isNaN(Date.parse(s.validFrom))) {
        throw new RegistryConfigError(`Meter "${meterId}" source #${index} has an invalid "validFrom"`);
    }
    if (s.validTo !== null && (typeof s.validTo !== 'string' || Number.isNaN(Date.parse(s.validTo)))) {
        throw new RegistryConfigError(`Meter "${meterId}" source #${index} has an invalid "validTo"`);
    }
    if (s.scale !== undefined && (typeof s.scale !== 'number' || !Number.isFinite(s.scale))) {
        throw new RegistryConfigError(`Meter "${meterId}" source #${index} has a non-numeric "scale"`);
    }
    if (typeof s.offset !== 'number' || !Number.isFinite(s.offset)) {
        throw new RegistryConfigError(`Meter "${meterId}" source #${index} needs a numeric "offset"`);
    }
}

/**
 * Finds the source active for a meter at a given point in time, or undefined if none is registered.
 *
 * @param meter - the meter to resolve a source for
 * @param timestamp - point in time to resolve against
 */
export function resolveActiveSource(meter: MeterConfig, timestamp: Date): MeterSource | undefined {
    return meter.sources.find(
        s => timestamp >= new Date(s.validFrom) && (!s.validTo || timestamp <= new Date(s.validTo)),
    );
}

/**
 * Applies the registry offset to a raw reading to continue the logical series across a device swap.
 *
 * @param meter - the meter to resolve the value for
 * @param timestamp - point in time the raw value was recorded
 * @param rawValue - raw reading from the active source's stateId
 */
export function resolveLogicalValue(meter: MeterConfig, timestamp: Date, rawValue: number): number {
    const source = resolveActiveSource(meter, timestamp);
    if (!source) {
        throw new RegistryConfigError(`No registry source covers ${timestamp.toISOString()}`);
    }
    return rawValue * (source.scale ?? 1) + source.offset;
}

/**
 * Finds the tariff value active at a given point in time, or undefined if no entry covers it. Only meant for
 * fixed-rate contracts with rare changes - resolved once at adapter startup, not re-checked live.
 *
 * @param entries - a tariff's validity-period entries
 * @param timestamp - point in time to resolve against
 */
export function resolveTariffValue(entries: readonly TariffEntry[], timestamp: Date): number | undefined {
    return entries.find(e => timestamp >= new Date(e.validFrom) && (!e.validTo || timestamp <= new Date(e.validTo)))
        ?.value;
}
