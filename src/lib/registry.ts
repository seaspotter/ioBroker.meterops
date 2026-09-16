import type { MeterConfig, MeterSource, RegistryConfig, SingletonRole } from './registry-types';
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
    return rawValue + source.offset;
}
