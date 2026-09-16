import React from 'react';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import TextField from '@material-ui/core/TextField';
import Button from '@material-ui/core/Button';
import IconButton from '@material-ui/core/IconButton';

import type { RegistryConfig, TariffEntry } from '../../../src/lib/registry-types';

interface TariffsTabProps {
    registry: RegistryConfig;
    onChange: (next: RegistryConfig) => void;
}

interface TariffsTabState {
    newTariffId: string;
}

/** Editor for fixed-rate tariffs (grid_price, feed_in_price, ...) and their validity-period entries. */
export default class TariffsTab extends React.Component<TariffsTabProps, TariffsTabState> {
    /** @param props - current registry and the change handler */
    constructor(props: TariffsTabProps) {
        super(props);
        this.state = { newTariffId: '' };
    }

    private updateTariff(tariffId: string, entries: TariffEntry[]): void {
        this.props.onChange({
            ...this.props.registry,
            tariffs: { ...this.props.registry.tariffs, [tariffId]: entries },
        });
    }

    private removeTariff(tariffId: string): void {
        const tariffs = { ...this.props.registry.tariffs };
        delete tariffs[tariffId];
        this.props.onChange({ ...this.props.registry, tariffs });
    }

    private addTariff(): void {
        const id = this.state.newTariffId.trim();
        if (!id || this.props.registry.tariffs?.[id]) {
            return;
        }
        this.updateTariff(id, [{ validFrom: new Date().toISOString().slice(0, 10), validTo: null, value: 0 }]);
        this.setState({ newTariffId: '' });
    }

    private addEntry(tariffId: string, entries: TariffEntry[]): void {
        this.updateTariff(tariffId, [
            ...entries,
            { validFrom: new Date().toISOString().slice(0, 10), validTo: null, value: 0 },
        ]);
    }

    private updateEntry(tariffId: string, entries: TariffEntry[], index: number, patch: Partial<TariffEntry>): void {
        const next = entries.slice();
        next[index] = { ...next[index], ...patch };
        this.updateTariff(tariffId, next);
    }

    private removeEntry(tariffId: string, entries: TariffEntry[], index: number): void {
        this.updateTariff(
            tariffId,
            entries.filter((_, i) => i !== index),
        );
    }

    /** @returns each tariff's entry table, plus the new-tariff form */
    render(): React.JSX.Element {
        const tariffs = this.props.registry.tariffs ?? {};

        return (
            <div>
                {Object.entries(tariffs).map(([tariffId, entries]) => (
                    <div
                        key={tariffId}
                        style={{ marginBottom: 24 }}
                    >
                        <h4>
                            {tariffId}{' '}
                            <IconButton
                                size="small"
                                onClick={() => this.removeTariff(tariffId)}
                                title="Remove tariff"
                            >
                                &#10005;
                            </IconButton>
                        </h4>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Valid from</TableCell>
                                    <TableCell>Valid to</TableCell>
                                    <TableCell>Value</TableCell>
                                    <TableCell />
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {entries.map((entry, index) => (
                                    <TableRow key={index}>
                                        <TableCell>
                                            <TextField
                                                type="date"
                                                value={entry.validFrom}
                                                onChange={e =>
                                                    this.updateEntry(tariffId, entries, index, {
                                                        validFrom: e.target.value,
                                                    })
                                                }
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <TextField
                                                type="date"
                                                value={entry.validTo ?? ''}
                                                onChange={e =>
                                                    this.updateEntry(tariffId, entries, index, {
                                                        validTo: e.target.value || null,
                                                    })
                                                }
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <TextField
                                                type="number"
                                                value={entry.value}
                                                onChange={e =>
                                                    this.updateEntry(tariffId, entries, index, {
                                                        value: Number(e.target.value),
                                                    })
                                                }
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <IconButton
                                                size="small"
                                                onClick={() => this.removeEntry(tariffId, entries, index)}
                                                title="Remove entry"
                                            >
                                                &#10005;
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        <Button
                            size="small"
                            onClick={() => this.addEntry(tariffId, entries)}
                        >
                            + Add entry
                        </Button>
                    </div>
                ))}

                <div>
                    <TextField
                        label="New tariff id"
                        placeholder="grid_price"
                        value={this.state.newTariffId}
                        onChange={e => this.setState({ newTariffId: e.target.value })}
                    />
                    <Button onClick={() => this.addTariff()}>+ Add tariff</Button>
                </div>
            </div>
        );
    }
}
