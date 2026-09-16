// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            /** JSON-encoded RegistryConfig (see src/lib/registry-types.ts) */
            registryConfig: string;
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};