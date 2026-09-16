import React from 'react';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import TextField from '@material-ui/core/TextField';
import Select from '@material-ui/core/Select';
import MenuItem from '@material-ui/core/MenuItem';
import Checkbox from '@material-ui/core/Checkbox';
import Button from '@material-ui/core/Button';
import IconButton from '@material-ui/core/IconButton';

import DialogSelectID from '@iobroker/adapter-react/Dialogs/SelectID';
import type Connection from '@iobroker/adapter-react/Connection';

import { SINGLETON_ROLES, REPEATABLE_ROLES } from '../../../src/lib/registry-types';
import type { MeterConfig, MeterSource, RegistryConfig } from '../../../src/lib/registry-types';

const ALL_ROLES = [...SINGLETON_ROLES, ...REPEATABLE_ROLES];

interface MetersTabProps {
    registry: RegistryConfig;
    onChange: (next: RegistryConfig) => void;
    socket: Connection;
}

interface MetersTabState {
    expandedMeterId: string | null;
    pickingSource: { meterId: string; index: number } | null;
    newMeterId: string;
}

/** Editor for configured meters: role/label/unit/includeInResidual, plus each meter's nested source history. */
export default class MetersTab extends React.Component<MetersTabProps, MetersTabState> {
    /** @param props - current registry, the change handler, and the socket connection (for the state picker) */
    constructor(props: MetersTabProps) {
        super(props);
        this.state = { expandedMeterId: null, pickingSource: null, newMeterId: '' };
    }

    private updateMeter(meterId: string, patch: Partial<MeterConfig>): void {
        const meters = { ...this.props.registry.meters };
        meters[meterId] = { ...meters[meterId], ...patch };
        this.props.onChange({ ...this.props.registry, meters });
    }

    private removeMeter(meterId: string): void {
        const meters = { ...this.props.registry.meters };
        delete meters[meterId];
        this.props.onChange({ ...this.props.registry, meters });
    }

    private addMeter(): void {
        const id = this.state.newMeterId.trim();
        if (!id || this.props.registry.meters[id] || this.props.registry.groups?.[id]) {
            return;
        }
        const meters = {
            ...this.props.registry.meters,
            [id]: {
                role: 'known_subconsumer',
                label: id,
                unit: 'kWh',
                sources: [{ stateId: '', validFrom: new Date().toISOString().slice(0, 10), validTo: null, offset: 0 }],
            } satisfies MeterConfig,
        };
        this.props.onChange({ ...this.props.registry, meters });
        this.setState({ newMeterId: '', expandedMeterId: id });
    }

    private addSource(meterId: string, meter: MeterConfig): void {
        this.updateMeter(meterId, {
            sources: [
                ...meter.sources,
                { stateId: '', validFrom: new Date().toISOString().slice(0, 10), validTo: null, offset: 0 },
            ],
        });
    }

    private updateSource(meterId: string, meter: MeterConfig, index: number, patch: Partial<MeterSource>): void {
        const sources = meter.sources.slice();
        sources[index] = { ...sources[index], ...patch };
        this.updateMeter(meterId, { sources });
    }

    private removeSource(meterId: string, meter: MeterConfig, index: number): void {
        this.updateMeter(meterId, { sources: meter.sources.filter((_, i) => i !== index) });
    }

    /** @returns the meters table (with an expandable sources sub-table per row) and the new-meter form */
    render(): React.JSX.Element {
        const meters = this.props.registry.meters;

        return (
            <div>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Meter id</TableCell>
                            <TableCell>Role</TableCell>
                            <TableCell>Label</TableCell>
                            <TableCell>Unit</TableCell>
                            <TableCell>In residual</TableCell>
                            <TableCell>Sources</TableCell>
                            <TableCell />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {Object.entries(meters).map(([meterId, meter]) => (
                            <React.Fragment key={meterId}>
                                <TableRow>
                                    <TableCell>{meterId}</TableCell>
                                    <TableCell>
                                        <Select
                                            value={meter.role}
                                            onChange={e =>
                                                this.updateMeter(meterId, {
                                                    role: e.target.value as MeterConfig['role'],
                                                })
                                            }
                                        >
                                            {ALL_ROLES.map(role => (
                                                <MenuItem
                                                    key={role}
                                                    value={role}
                                                >
                                                    {role}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={meter.label}
                                            onChange={e => this.updateMeter(meterId, { label: e.target.value })}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={meter.unit}
                                            style={{ width: 70 }}
                                            onChange={e => this.updateMeter(meterId, { unit: e.target.value })}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {meter.role === 'known_subconsumer' && (
                                            <Checkbox
                                                checked={meter.includeInResidual !== false}
                                                onChange={e =>
                                                    this.updateMeter(meterId, { includeInResidual: e.target.checked })
                                                }
                                            />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            size="small"
                                            onClick={() =>
                                                this.setState({
                                                    expandedMeterId:
                                                        this.state.expandedMeterId === meterId ? null : meterId,
                                                })
                                            }
                                        >
                                            {meter.sources.length} source{meter.sources.length === 1 ? '' : 's'}{' '}
                                            {this.state.expandedMeterId === meterId ? '▲' : '▼'}
                                        </Button>
                                    </TableCell>
                                    <TableCell>
                                        <IconButton
                                            size="small"
                                            onClick={() => this.removeMeter(meterId)}
                                            title="Remove meter"
                                        >
                                            &#10005;
                                        </IconButton>
                                    </TableCell>
                                </TableRow>

                                {this.state.expandedMeterId === meterId && (
                                    <TableRow>
                                        <TableCell colSpan={7}>
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell>State id</TableCell>
                                                        <TableCell>Valid from</TableCell>
                                                        <TableCell>Valid to</TableCell>
                                                        <TableCell>Scale</TableCell>
                                                        <TableCell>Offset</TableCell>
                                                        <TableCell />
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {meter.sources.map((source, index) => (
                                                        <TableRow key={index}>
                                                            <TableCell>
                                                                <Button
                                                                    size="small"
                                                                    onClick={() =>
                                                                        this.setState({
                                                                            pickingSource: { meterId, index },
                                                                        })
                                                                    }
                                                                >
                                                                    {source.stateId || '(pick a state...)'}
                                                                </Button>
                                                            </TableCell>
                                                            <TableCell>
                                                                <TextField
                                                                    type="date"
                                                                    value={source.validFrom}
                                                                    onChange={e =>
                                                                        this.updateSource(meterId, meter, index, {
                                                                            validFrom: e.target.value,
                                                                        })
                                                                    }
                                                                />
                                                            </TableCell>
                                                            <TableCell>
                                                                <TextField
                                                                    type="date"
                                                                    value={source.validTo ?? ''}
                                                                    onChange={e =>
                                                                        this.updateSource(meterId, meter, index, {
                                                                            validTo: e.target.value || null,
                                                                        })
                                                                    }
                                                                />
                                                            </TableCell>
                                                            <TableCell>
                                                                <TextField
                                                                    type="number"
                                                                    style={{ width: 80 }}
                                                                    value={source.scale ?? 1}
                                                                    onChange={e =>
                                                                        this.updateSource(meterId, meter, index, {
                                                                            scale: Number(e.target.value),
                                                                        })
                                                                    }
                                                                />
                                                            </TableCell>
                                                            <TableCell>
                                                                <TextField
                                                                    type="number"
                                                                    style={{ width: 100 }}
                                                                    value={source.offset}
                                                                    onChange={e =>
                                                                        this.updateSource(meterId, meter, index, {
                                                                            offset: Number(e.target.value),
                                                                        })
                                                                    }
                                                                />
                                                            </TableCell>
                                                            <TableCell>
                                                                <IconButton
                                                                    size="small"
                                                                    onClick={() =>
                                                                        this.removeSource(meterId, meter, index)
                                                                    }
                                                                    title="Remove source"
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
                                                onClick={() => this.addSource(meterId, meter)}
                                            >
                                                + Add source
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </React.Fragment>
                        ))}
                    </TableBody>
                </Table>

                <div style={{ marginTop: 16 }}>
                    <TextField
                        label="New meter id"
                        placeholder="wallbox_1"
                        value={this.state.newMeterId}
                        onChange={e => this.setState({ newMeterId: e.target.value })}
                    />
                    <Button onClick={() => this.addMeter()}>+ Add meter</Button>
                </div>

                {this.state.pickingSource && (
                    <DialogSelectID
                        socket={this.props.socket}
                        selected={
                            meters[this.state.pickingSource.meterId].sources[this.state.pickingSource.index].stateId
                        }
                        types={['state']}
                        onClose={() => this.setState({ pickingSource: null })}
                        onOk={(selected: string | string[] | undefined) => {
                            const picked = Array.isArray(selected) ? selected[0] : selected;
                            if (picked && this.state.pickingSource) {
                                const { meterId, index } = this.state.pickingSource;
                                this.updateSource(meterId, meters[meterId], index, { stateId: picked });
                            }
                            this.setState({ pickingSource: null });
                        }}
                    />
                )}
            </div>
        );
    }
}
