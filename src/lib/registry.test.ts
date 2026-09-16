import { expect } from 'chai';
import { parseRegistryConfig, RegistryConfigError, resolveLogicalValue } from './registry';

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
});
