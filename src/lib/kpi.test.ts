import { expect } from 'chai';
import { evaluateKpis, getActiveKpis } from './kpi';

describe('getActiveKpis', () => {
    it('activates nothing when no roles are available', () => {
        expect(getActiveKpis([])).to.deep.equal([]);
    });

    it('activates self_consumption_ratio from pv_production + grid_export alone', () => {
        expect(getActiveKpis(['pv_production', 'grid_export'])).to.deep.equal(['self_consumption_ratio']);
    });

    it('activates cop from the heat pump roles alone', () => {
        expect(getActiveKpis(['heatpump_thermal', 'heatpump_electric'])).to.deep.equal(['cop']);
    });

    it('activates total_consumption, self_consumption_ratio and autarky from the grid/PV/battery roles', () => {
        const active = getActiveKpis([
            'grid_import',
            'grid_export',
            'pv_production',
            'battery_charge',
            'battery_discharge',
        ]);
        expect(active).to.have.members(['total_consumption', 'self_consumption_ratio', 'autarky']);
        // total_consumption must be computed before autarky, which depends on it
        expect(active.indexOf('total_consumption')).to.be.lessThan(active.indexOf('autarky'));
    });

    it('additionally activates household_consumption once known_subconsumer is available', () => {
        const active = getActiveKpis([
            'grid_import',
            'grid_export',
            'pv_production',
            'battery_charge',
            'battery_discharge',
            'known_subconsumer',
        ]);
        expect(active).to.include('household_consumption');
        expect(active.indexOf('total_consumption')).to.be.lessThan(active.indexOf('household_consumption'));
    });
});

describe('evaluateKpis', () => {
    it('computes total_consumption, self_consumption_ratio and autarky from real-shaped values', () => {
        const results = evaluateKpis({
            grid_import: 10,
            grid_export: 5,
            pv_production: 20,
            battery_charge: 2,
            battery_discharge: 1,
        });

        // 10 + 20 + 1 - 5 - 2
        expect(results.total_consumption).to.be.closeTo(24, 1e-9);
        // (20 - 5) / 20
        expect(results.self_consumption_ratio).to.be.closeTo(0.75, 1e-9);
        // (24 - 10) / 24
        expect(results.autarky).to.be.closeTo((24 - 10) / 24, 1e-9);
        expect(results.household_consumption).to.be.undefined;
        expect(results.cop).to.be.undefined;
    });

    it('computes household_consumption as total_consumption minus the pre-aggregated known_subconsumer sum', () => {
        const results = evaluateKpis({
            grid_import: 10,
            grid_export: 5,
            pv_production: 20,
            battery_charge: 2,
            battery_discharge: 1,
            known_subconsumer: 6, // pre-summed by the caller across all instances
        });

        expect(results.household_consumption).to.be.closeTo(24 - 6, 1e-9);
    });

    it('computes cop independently of the grid/PV roles', () => {
        const results = evaluateKpis({ heatpump_thermal: 30, heatpump_electric: 10 });
        expect(results.cop).to.be.closeTo(3, 1e-9);
    });
});
