import { expect } from 'chai';
import { parseRegistryConfig, RegistryConfigError, resolveLogicalValue, resolveTariffValue } from './registry';

describe('registry config', () => {
    it('parses a valid config', () => {
        const config = parseRegistryConfig(
            JSON.stringify({
                meters: {
                    water_garden: {
                        role: 'known_subconsumer',
                        label: 'Garden water',
                        unit: 'm3',
                        sources: [
                            {
                                stateId: 'raw.water_meter_old',
                                validFrom: '2018-06-01',
                                validTo: '2021-09-14',
                                offset: 0,
                            },
                            { stateId: 'raw.water_meter_new', validFrom: '2021-09-15', validTo: null, offset: 4754.1 },
                        ],
                    },
                },
            }),
        );
        expect(config.meters.water_garden.sources).to.have.length(2);
    });

    it('rejects invalid JSON', () => {
        expect(() => parseRegistryConfig('{not json')).to.throw(RegistryConfigError, /not valid JSON/);
    });

    it('rejects a config without a meters object', () => {
        expect(() => parseRegistryConfig(JSON.stringify({}))).to.throw(RegistryConfigError, /meters/);
    });

    it('rejects a meter with no sources', () => {
        expect(() =>
            parseRegistryConfig(
                JSON.stringify({
                    meters: { grid_import: { role: 'grid_import', label: 'Grid import', unit: 'kWh', sources: [] } },
                }),
            ),
        ).to.throw(RegistryConfigError, /needs at least one entry/);
    });

    it('rejects a singleton role configured twice', () => {
        const source = { stateId: 'raw.a', validFrom: '2020-01-01', validTo: null, offset: 0 };
        expect(() =>
            parseRegistryConfig(
                JSON.stringify({
                    meters: {
                        a: { role: 'grid_import', label: 'A', unit: 'kWh', sources: [source] },
                        b: { role: 'grid_import', label: 'B', unit: 'kWh', sources: [source] },
                    },
                }),
            ),
        ).to.throw(RegistryConfigError, /singleton but configured twice/);
    });

    it('allows a repeatable role configured more than once', () => {
        const source = { stateId: 'raw.a', validFrom: '2020-01-01', validTo: null, offset: 0 };
        const config = parseRegistryConfig(
            JSON.stringify({
                meters: {
                    heatpump: { role: 'known_subconsumer', label: 'Heat pump', unit: 'kWh', sources: [source] },
                    wallbox: { role: 'known_subconsumer', label: 'Wallbox', unit: 'kWh', sources: [source] },
                },
            }),
        );
        expect(Object.keys(config.meters)).to.have.length(2);
    });

    it('rejects a non-boolean includeInResidual', () => {
        const source = { stateId: 'raw.a', validFrom: '2020-01-01', validTo: null, offset: 0 };
        expect(() =>
            parseRegistryConfig(
                JSON.stringify({
                    meters: {
                        a: {
                            role: 'known_subconsumer',
                            label: 'A',
                            unit: 'kWh',
                            sources: [source],
                            includeInResidual: 'yes',
                        },
                    },
                }),
            ),
        ).to.throw(RegistryConfigError, /includeInResidual/);
    });

    it('parses a valid group referencing existing meters', () => {
        const source = { stateId: 'raw.a', validFrom: '2020-01-01', validTo: null, offset: 0 };
        const config = parseRegistryConfig(
            JSON.stringify({
                meters: {
                    wallbox_1: { role: 'known_subconsumer', label: 'Wallbox 1', unit: 'kWh', sources: [source] },
                    wallbox_2: { role: 'known_subconsumer', label: 'Wallbox 2', unit: 'kWh', sources: [source] },
                },
                groups: {
                    wallbox_total: { label: 'All wallboxes', unit: 'kWh', members: ['wallbox_1', 'wallbox_2'] },
                },
            }),
        );
        expect(config.groups?.wallbox_total.members).to.deep.equal(['wallbox_1', 'wallbox_2']);
    });

    it('rejects a group referencing an unknown meter', () => {
        const source = { stateId: 'raw.a', validFrom: '2020-01-01', validTo: null, offset: 0 };
        expect(() =>
            parseRegistryConfig(
                JSON.stringify({
                    meters: { a: { role: 'known_subconsumer', label: 'A', unit: 'kWh', sources: [source] } },
                    groups: { g: { label: 'G', unit: 'kWh', members: ['a', 'does_not_exist'] } },
                }),
            ),
        ).to.throw(RegistryConfigError, /unknown meter/);
    });

    it('rejects a group id that collides with a meter id', () => {
        const source = { stateId: 'raw.a', validFrom: '2020-01-01', validTo: null, offset: 0 };
        expect(() =>
            parseRegistryConfig(
                JSON.stringify({
                    meters: { a: { role: 'known_subconsumer', label: 'A', unit: 'kWh', sources: [source] } },
                    groups: { a: { label: 'A group', unit: 'kWh', members: ['a'] } },
                }),
            ),
        ).to.throw(RegistryConfigError, /collides with a meter id/);
    });

    it('accepts a numeric systemParams.pvCapacityKwp', () => {
        const config = parseRegistryConfig(JSON.stringify({ meters: {}, systemParams: { pvCapacityKwp: 9.9 } }));
        expect(config.systemParams?.pvCapacityKwp).to.equal(9.9);
    });

    it('rejects a non-numeric systemParams.pvCapacityKwp', () => {
        expect(() =>
            parseRegistryConfig(JSON.stringify({ meters: {}, systemParams: { pvCapacityKwp: '9.9' } })),
        ).to.throw(RegistryConfigError, /pvCapacityKwp/);
    });

    it('parses valid tariffs', () => {
        const config = parseRegistryConfig(
            JSON.stringify({
                meters: {},
                tariffs: {
                    grid_price: [
                        { validFrom: '2018-06-01', validTo: '2022-12-31', value: 0.28 },
                        { validFrom: '2023-01-01', validTo: null, value: 0.35 },
                    ],
                },
            }),
        );
        expect(config.tariffs?.grid_price).to.have.length(2);
    });

    it('rejects a tariff with no entries', () => {
        expect(() => parseRegistryConfig(JSON.stringify({ meters: {}, tariffs: { grid_price: [] } }))).to.throw(
            RegistryConfigError,
            /needs at least one entry/,
        );
    });

    it('rejects a tariff entry with a non-numeric value', () => {
        expect(() =>
            parseRegistryConfig(
                JSON.stringify({
                    meters: {},
                    tariffs: { grid_price: [{ validFrom: '2020-01-01', validTo: null, value: '0.28' }] },
                }),
            ),
        ).to.throw(RegistryConfigError, /needs a numeric "value"/);
    });
});

describe('resolveTariffValue', () => {
    const gridPrice = [
        { validFrom: '2018-06-01', validTo: '2022-12-31', value: 0.28 },
        { validFrom: '2023-01-01', validTo: null, value: 0.35 },
    ];

    it('resolves the price active at a given date', () => {
        expect(resolveTariffValue(gridPrice, new Date('2020-01-01'))).to.equal(0.28);
        expect(resolveTariffValue(gridPrice, new Date('2024-01-01'))).to.equal(0.35);
    });

    it('returns undefined when no entry covers the timestamp', () => {
        expect(resolveTariffValue(gridPrice, new Date('2000-01-01'))).to.be.undefined;
    });
});

describe('resolveLogicalValue', () => {
    const waterGarden = {
        role: 'known_subconsumer' as const,
        label: 'Garden water',
        unit: 'm3',
        sources: [
            { stateId: 'raw.water_meter_old', validFrom: '2018-06-01', validTo: '2021-09-14', offset: 0 },
            { stateId: 'raw.water_meter_new', validFrom: '2021-09-15', validTo: null, offset: 4754.1 },
        ],
    };

    it('applies zero offset for the original device', () => {
        expect(resolveLogicalValue(waterGarden, new Date('2020-01-01'), 100)).to.equal(100);
    });

    it('applies the offset after the device swap, continuing the logical series', () => {
        expect(resolveLogicalValue(waterGarden, new Date('2021-10-01'), 10)).to.equal(4764.1);
    });

    it('throws when no registry entry covers the timestamp', () => {
        expect(() => resolveLogicalValue(waterGarden, new Date('2000-01-01'), 10)).to.throw(
            RegistryConfigError,
            /No registry source/,
        );
    });

    it('applies scale before offset, for sources reporting in a different unit', () => {
        // real case: grid_import from the household meter reports Wh, but the
        // logical meter is defined in kWh
        const gridImport = {
            role: 'grid_import' as const,
            label: 'Grid import',
            unit: 'kWh',
            sources: [
                { stateId: 'example.grid_meter...import_wh', validFrom: '2020-01-01', validTo: null, scale: 0.001, offset: 0 },
            ],
        };
        expect(resolveLogicalValue(gridImport, new Date('2024-01-01'), 5000000)).to.be.closeTo(5000.000, 1e-9);
    });
});
