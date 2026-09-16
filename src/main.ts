/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';
import {
    parseRegistryConfig,
    resolveActiveSource,
    resolveLogicalValue,
    resolveTariffValue,
    RegistryConfigError,
} from './lib/registry';
import type { RegistryConfig } from './lib/registry-types';
import { REPEATABLE_ROLES } from './lib/registry-types';
import { evaluateKpis, getActiveKpis, KPI_UNITS, type KpiId } from './lib/kpi';

class Meterops extends utils.Adapter {
    private registry: RegistryConfig | undefined;
    /** raw ioBroker state ID -> meter id, for the sources currently active */
    private readonly stateToMeter = new Map<string, string>();
    /** latest offset-corrected logical value per meter id */
    private readonly latestMeterValue = new Map<string, number>();
    private activeKpiIds: KpiId[] = [];

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'meterops',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        // this.on('objectChange', this.onObjectChange.bind(this));
        // this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);

        try {
            this.registry = parseRegistryConfig(this.config.registryConfig);
        } catch (err) {
            if (err instanceof RegistryConfigError) {
                this.log.error(`Invalid registry config: ${err.message}`);
            } else {
                throw err;
            }
            return;
        }

        const meterCount = Object.keys(this.registry.meters).length;
        this.log.info(`Loaded registry config with ${meterCount} meter(s)`);

        await this.setupMeters(this.registry);
        await this.setupGroups(this.registry);
        await this.setupKpis(this.registry);
        await this.setupTariffs(this.registry);

        await this.setState('info.connection', true, true);
    }

    /**
     * Creates the logical state for each configured meter and subscribes to its currently active raw source.
     *
     * @param registry - parsed registry config
     */
    private async setupMeters(registry: RegistryConfig): Promise<void> {
        const now = new Date();

        for (const [meterId, meter] of Object.entries(registry.meters)) {
            const source = resolveActiveSource(meter, now);
            if (!source) {
                this.log.warn(`Meter "${meterId}" has no registry source active right now - skipping`);
                continue;
            }

            await this.setObjectNotExistsAsync(`meters.${meterId}`, {
                type: 'state',
                common: {
                    name: meter.label,
                    type: 'number',
                    role: 'value',
                    unit: meter.unit,
                    read: true,
                    write: false,
                },
                native: {},
            });

            this.stateToMeter.set(source.stateId, meterId);
            this.subscribeForeignStates(source.stateId);
            this.log.debug(
                `Meter "${meterId}" resolved to source ${source.stateId} (scale ${source.scale ?? 1}, offset ${source.offset})`,
            );
        }
    }

    /**
     * Creates a state for every configured meter group (e.g. "all wallboxes combined").
     *
     * @param registry - parsed registry config
     */
    private async setupGroups(registry: RegistryConfig): Promise<void> {
        for (const [groupId, group] of Object.entries(registry.groups ?? {})) {
            await this.setObjectNotExistsAsync(`groups.${groupId}`, {
                type: 'state',
                common: {
                    name: group.label,
                    type: 'number',
                    role: 'value',
                    unit: group.unit,
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
    }

    /**
     * Recomputes every configured meter group from the latest known meter values and writes the changed ones.
     * A group is only reported once every one of its members has reported a value, to avoid summing a
     * partial set.
     */
    private recomputeGroups(): void {
        if (!this.registry) {
            return;
        }

        for (const [groupId, group] of Object.entries(this.registry.groups ?? {})) {
            if (!group.members.every(id => this.latestMeterValue.has(id))) {
                continue;
            }
            const sum = group.members.reduce((total, id) => total + (this.latestMeterValue.get(id) ?? 0), 0);
            void this.setState(`groups.${groupId}`, { val: sum, ack: true });
        }
    }

    /**
     * Resolves each configured tariff's currently active price once at startup and writes it. Fixed-rate
     * contracts change rarely, so this isn't re-checked live - see resolveTariffValue.
     *
     * @param registry - parsed registry config
     */
    private async setupTariffs(registry: RegistryConfig): Promise<void> {
        const now = new Date();

        for (const [tariffId, entries] of Object.entries(registry.tariffs ?? {})) {
            const value = resolveTariffValue(entries, now);
            if (value === undefined) {
                this.log.warn(`Tariff "${tariffId}" has no entry active right now - skipping`);
                continue;
            }

            await this.setObjectNotExistsAsync(`tariffs.${tariffId}`, {
                type: 'state',
                common: {
                    name: tariffId,
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                },
                native: {},
            });
            await this.setState(`tariffs.${tariffId}`, { val: value, ack: true });
        }
    }

    /**
     * Creates a state for every KPI whose roles are actually configured in the registry (not just those with
     * a live value yet - see MeterOps-Concept.md's getActiveKpis).
     *
     * @param registry - parsed registry config
     */
    private async setupKpis(registry: RegistryConfig): Promise<void> {
        const configuredRoles = new Set<string>(
            Object.values(registry.meters)
                .filter(m => m.role !== 'known_subconsumer' || m.includeInResidual !== false)
                .map(m => m.role),
        );
        if (registry.systemParams?.pvCapacityKwp !== undefined) {
            configuredRoles.add('pv_capacity_kwp');
        }
        this.activeKpiIds = getActiveKpis(configuredRoles);

        for (const id of this.activeKpiIds) {
            await this.setObjectNotExistsAsync(`kpis.${id}`, {
                type: 'state',
                common: {
                    name: id,
                    type: 'number',
                    role: 'value',
                    unit: KPI_UNITS[id],
                    read: true,
                    write: false,
                },
                native: {},
            });
        }

        this.log.info(`Active KPIs: ${this.activeKpiIds.length ? this.activeKpiIds.join(', ') : '(none yet)'}`);
    }

    /**
     * Recomputes every active KPI from the latest known meter values and writes the changed ones. Repeatable
     * roles (known_subconsumer) are only included once every configured instance has reported a value, to
     * avoid computing a residual from a partial sum.
     */
    private recomputeKpis(): void {
        if (!this.registry || !this.activeKpiIds.length) {
            return;
        }

        const values: Record<string, number> = {};
        const pvCapacityKwp = this.registry.systemParams?.pvCapacityKwp;
        if (pvCapacityKwp !== undefined) {
            values.pv_capacity_kwp = pvCapacityKwp;
        }

        const subconsumerMeterIds = Object.entries(this.registry.meters)
            .filter(
                ([, m]) => (REPEATABLE_ROLES as readonly string[]).includes(m.role) && m.includeInResidual !== false,
            )
            .map(([meterId]) => meterId);

        for (const [meterId, meter] of Object.entries(this.registry.meters)) {
            if ((REPEATABLE_ROLES as readonly string[]).includes(meter.role)) {
                continue; // aggregated separately below
            }
            const value = this.latestMeterValue.get(meterId);
            if (value !== undefined) {
                values[meter.role] = value;
            }
        }

        if (subconsumerMeterIds.length > 0 && subconsumerMeterIds.every(id => this.latestMeterValue.has(id))) {
            values.known_subconsumer = subconsumerMeterIds.reduce(
                (sum, id) => sum + (this.latestMeterValue.get(id) ?? 0),
                0,
            );
        }

        const results = evaluateKpis(values);
        for (const [id, value] of Object.entries(results)) {
            if (value !== undefined) {
                void this.setState(`kpis.${id}`, { val: value, ack: true });
            }
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            // clearInterval(interval1);

            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  */
    // private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
    //     if (obj) {
    //         // The object was changed
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         // The object was deleted
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }

    /**
     * Is called if a subscribed (raw source) state changes - resolves it through the registry and writes the
     * corresponding logical meter state.
     *
     * @param id - State ID
     * @param state - State object
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || !this.registry) {
            return;
        }

        const meterId = this.stateToMeter.get(id);
        if (!meterId) {
            return;
        }

        const meter = this.registry.meters[meterId];
        if (typeof state.val !== 'number') {
            this.log.warn(`Meter "${meterId}": raw value from ${id} is not a number (${JSON.stringify(state.val)})`);
            return;
        }

        try {
            const logicalValue = resolveLogicalValue(meter, new Date(state.ts), state.val);
            void this.setState(`meters.${meterId}`, { val: logicalValue, ack: true });
            this.latestMeterValue.set(meterId, logicalValue);
            this.recomputeGroups();
            this.recomputeKpis();
        } catch (err) {
            this.log.error(`Failed to resolve meter "${meterId}" from ${id}: ${(err as Error).message}`);
        }
    }
    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  */
    //
    // private onMessage(obj: ioBroker.Message): void {
    //     if (typeof obj === 'object' && obj.message) {
    //         if (obj.command === 'send') {
    //             // e.g. send email or pushover or whatever
    //             this.log.info('send command');
    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
    //         }
    //     }
    // }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Meterops(options);
} else {
    // otherwise start the instance directly
    (() => new Meterops())();
}
