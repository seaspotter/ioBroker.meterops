// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            /** JSON-encoded RegistryConfig (see src/lib/registry-types.ts) */
            registryConfig: string;
            /** adapter instance id (e.g. "influxdb.0") to auto-configure history logging on, or "" to skip */
            historyInstance: string;
            /** cron expression: how often every meter's current value is snapshotted for period-based KPIs */
            snapshotCron: string;
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};