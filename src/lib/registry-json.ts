// Small, permissive helpers for the React admin UI: parse/serialize the registryConfig JSON blob
// without throwing on partially-edited/invalid content (the strict validation in registry.ts is for
// the running adapter, not for an in-progress edit in the admin UI).
import type { RegistryConfig } from './registry-types';

const EMPTY_REGISTRY: RegistryConfig = { meters: {} };

/**
 * Parses native.registryConfig for the admin UI, falling back to an empty registry on invalid JSON.
 *
 * @param raw - the raw native.registryConfig string, possibly undefined or mid-edit invalid
 */
export function parseRegistryConfigLoose(raw: string | undefined): RegistryConfig {
    if (!raw) {
        return EMPTY_REGISTRY;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && 'meters' in parsed) {
            return parsed as RegistryConfig;
        }
    } catch {
        // fall through to default below
    }
    return EMPTY_REGISTRY;
}

/**
 * Serializes a RegistryConfig back into the form stored in native.registryConfig.
 *
 * @param registry - the registry to serialize
 */
export function serializeRegistryConfig(registry: RegistryConfig): string {
    return JSON.stringify(registry);
}
