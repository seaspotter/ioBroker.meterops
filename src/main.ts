/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';
import { Cron } from 'croner';
import {
    parseRegistryConfig,
    resolveActiveSource,
    resolveLogicalValue,
    resolveTariffValue,
    RegistryConfigError,
} from './lib/registry';
import type { RegistryConfig } from './lib/registry-types';
import { REPEATABLE_ROLES } from './lib/registry-types';
import { evaluateKpis, getActiveKpis, KPI_NAMES, KPI_UNITS, type KpiId } from './lib/kpi';

class Meterops extends utils.Adapter {
    private registry: RegistryConfig | undefined;
    /** raw ioBroker state ID -> meter id, for the sources currently active */
    private readonly stateToMeter = new Map<string, string>();
    /** latest offset-corrected logical value per meter id */
    private readonly latestMeterValue = new Map<string, number>();
    private activeKpiIds: KpiId[] = [];
    private snapshotJob: Cron | undefined;

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
        this.setupSnapshotSchedule();

        await this.setState('info.connection', true, true);
    }

    /**
     * Schedules the periodic snapshot job (native.snapshotCron) that drives period-based KPI computation.
     */
    private setupSnapshotSchedule(): void {
        try {
            this.snapshotJob = new Cron(this.config.snapshotCron, () => {
                this.takeSnapshot().catch(err => this.log.error(`Snapshot failed: ${(err as Error).message}`));
            });
        } catch (err) {
            this.log.error(`Invalid snapshot schedule "${this.config.snapshotCron}": ${(err as Error).message}`);
        }
    }

    /**
     * Extends a state's common.custom with the configured history instance (native.historyInstance), so it
     * gets logged automatically. No-op if no history instance is configured.
     *
     * @param id - state id (relative to this adapter's namespace)
     */
    private async configureHistory(id: string): Promise<void> {
        const instance = this.config.historyInstance;
        if (!instance) {
            return;
        }
        await this.extendObjectAsync(id, { common: { custom: { [instance]: { enabled: true } } } });
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

            const stateId = `meters.${meterId}`;
            await this.setObjectNotExistsAsync(stateId, {
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
            await this.configureHistory(stateId);

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
            const stateId = `groups.${groupId}`;
            await this.setObjectNotExistsAsync(stateId, {
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
            await this.configureHistory(stateId);
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

            const stateId = `tariffs.${tariffId}`;
            await this.setObjectNotExistsAsync(stateId, {
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
            await this.configureHistory(stateId);
            await this.setState(stateId, { val: value, ack: true });
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
            const variants: [stateId: string, name: string][] = [
                [`kpis.${id}`, KPI_NAMES[id]],
                [`periodKpis.${id}`, `${KPI_NAMES[id]} (period)`],
            ];
            for (const [stateId, name] of variants) {
                await this.setObjectNotExistsAsync(stateId, {
                    type: 'state',
                    common: {
                        name,
                        type: 'number',
                        role: 'value',
                        unit: KPI_UNITS[id],
                        read: true,
                        write: false,
                    },
                    native: {},
                });
                await this.configureHistory(stateId);
            }
        }

        this.log.info(`Active KPIs: ${this.activeKpiIds.length ? this.activeKpiIds.join(', ') : '(none yet)'}`);
    }

    /**
     * Builds the role-keyed values map evaluateKpis() needs, from any meter-id-keyed value source (live
     * values or period deltas). Repeatable roles (known_subconsumer) are only included once every configured
     * instance has a value in the given source, to avoid aggregating a partial set.
     *
     * @param meterValue - current value per meter id, from whichever source (live or a snapshot delta)
     */
    private buildKpiValues(meterValue: ReadonlyMap<string, number>): Record<string, number> {
        if (!this.registry) {
            return {};
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
            const value = meterValue.get(meterId);
            if (value !== undefined) {
                values[meter.role] = value;
            }
        }

        if (subconsumerMeterIds.length > 0 && subconsumerMeterIds.every(id => meterValue.has(id))) {
            values.known_subconsumer = subconsumerMeterIds.reduce((sum, id) => sum + (meterValue.get(id) ?? 0), 0);
        }

        return values;
    }

    /**
     * Recomputes every active KPI from the latest known (live, lifetime-cumulative) meter values and writes
     * the changed ones. See MeterOps-Concept.md's ratio-KPI limitation - these are only physically meaningful
     * once every contributing meter has a comparable accumulation history; periodKpis.* (below) avoid that.
     */
    private recomputeKpis(): void {
        if (!this.registry || !this.activeKpiIds.length) {
            return;
        }
        const results = evaluateKpis(this.buildKpiValues(this.latestMeterValue));
        for (const [id, value] of Object.entries(results)) {
            if (value !== undefined) {
                void this.setState(`kpis.${id}`, { val: value, ack: true });
            }
        }
    }

    /**
     * Takes a dated snapshot of every meter's current value (native.snapshotCron) and, from the delta against
     * the previous snapshot, recomputes the period-based KPIs. Deltas cancel out any difference in how long
     * each raw counter has been accumulating, unlike the lifetime-cumulative kpis.* above.
     */
    private async takeSnapshot(): Promise<void> {
        if (!this.registry) {
            return;
        }
        this.log.info('Taking periodic snapshot for period-based KPIs');

        const deltas = new Map<string, number>();
        for (const [meterId, currentValue] of this.latestMeterValue.entries()) {
            const meter = this.registry.meters[meterId];
            const stateId = `snapshots.${meterId}`;

            const previous = await this.getStateAsync(stateId);
            if (previous && typeof previous.val === 'number') {
                deltas.set(meterId, currentValue - previous.val);
            } else {
                this.log.debug(`No prior snapshot for "${meterId}" yet - baseline set now, delta available next cycle`);
            }

            await this.setObjectNotExistsAsync(stateId, {
                type: 'state',
                common: {
                    name: `${meter.label} (snapshot)`,
                    type: 'number',
                    role: 'value',
                    unit: meter.unit,
                    read: true,
                    write: false,
                },
                native: {},
            });
            await this.configureHistory(stateId);
            await this.setState(stateId, { val: currentValue, ack: true });
        }

        await this.recomputePeriodKpis(deltas);
    }

    /**
     * Writes the period-based KPIs (periodKpis.*) computed from the given per-meter deltas.
     *
     * @param deltas - change since the previous snapshot, per meter id (only meters with both readings)
     */
    private async recomputePeriodKpis(deltas: ReadonlyMap<string, number>): Promise<void> {
        if (!this.registry || !this.activeKpiIds.length) {
            return;
        }
        const results = evaluateKpis(this.buildKpiValues(deltas));
        for (const [id, value] of Object.entries(results)) {
            if (value !== undefined) {
                await this.setState(`periodKpis.${id}`, { val: value, ack: true });
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
            this.snapshotJob?.stop();

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
