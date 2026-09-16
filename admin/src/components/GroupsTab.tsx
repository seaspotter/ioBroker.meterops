import React from 'react';
import TextField from '@material-ui/core/TextField';
import Button from '@material-ui/core/Button';
import IconButton from '@material-ui/core/IconButton';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import Checkbox from '@material-ui/core/Checkbox';

import type { MeterGroupConfig, RegistryConfig } from '../../../src/lib/registry-types';

interface GroupsTabProps {
    registry: RegistryConfig;
    onChange: (next: RegistryConfig) => void;
}

interface GroupsTabState {
    newGroupId: string;
}

/** Editor for named meter groups (e.g. "all wallboxes combined") and their member checklists. */
export default class GroupsTab extends React.Component<GroupsTabProps, GroupsTabState> {
    /** @param props - current registry and the change handler */
    constructor(props: GroupsTabProps) {
        super(props);
        this.state = { newGroupId: '' };
    }

    private updateGroup(groupId: string, patch: Partial<MeterGroupConfig>): void {
        const groups = { ...this.props.registry.groups };
        groups[groupId] = { ...groups[groupId], ...patch };
        this.props.onChange({ ...this.props.registry, groups });
    }

    private toggleMember(groupId: string, group: MeterGroupConfig, meterId: string): void {
        const members = group.members.includes(meterId)
            ? group.members.filter(id => id !== meterId)
            : [...group.members, meterId];
        this.updateGroup(groupId, { members });
    }

    private removeGroup(groupId: string): void {
        const groups = { ...this.props.registry.groups };
        delete groups[groupId];
        this.props.onChange({ ...this.props.registry, groups });
    }

    private addGroup(): void {
        const id = this.state.newGroupId.trim();
        if (!id || this.props.registry.groups?.[id] || this.props.registry.meters[id]) {
            return;
        }
        this.updateGroup(id, { label: id, unit: 'kWh', members: [] });
        this.setState({ newGroupId: '' });
    }

    /** @returns each group's editable fields/member checklist, plus the new-group form */
    render(): React.JSX.Element {
        const groups = this.props.registry.groups ?? {};
        const meterIds = Object.keys(this.props.registry.meters);

        return (
            <div>
                {Object.entries(groups).map(([groupId, group]) => (
                    <div
                        key={groupId}
                        style={{ marginBottom: 24 }}
                    >
                        <h4>
                            {groupId}{' '}
                            <IconButton
                                size="small"
                                onClick={() => this.removeGroup(groupId)}
                                title="Remove group"
                            >
                                &#10005;
                            </IconButton>
                        </h4>
                        <div>
                            <TextField
                                label="Label"
                                value={group.label}
                                onChange={e => this.updateGroup(groupId, { label: e.target.value })}
                                style={{ marginRight: 16 }}
                            />
                            <TextField
                                label="Unit"
                                value={group.unit}
                                onChange={e => this.updateGroup(groupId, { unit: e.target.value })}
                            />
                        </div>
                        <div>
                            <p>Members:</p>
                            {meterIds.length === 0 && <em>No meters configured yet.</em>}
                            {meterIds.map(meterId => (
                                <FormControlLabel
                                    key={meterId}
                                    control={
                                        <Checkbox
                                            checked={group.members.includes(meterId)}
                                            onChange={() => this.toggleMember(groupId, group, meterId)}
                                        />
                                    }
                                    label={meterId}
                                />
                            ))}
                        </div>
                    </div>
                ))}

                <div>
                    <TextField
                        label="New group id"
                        placeholder="wallbox_total"
                        value={this.state.newGroupId}
                        onChange={e => this.setState({ newGroupId: e.target.value })}
                    />
                    <Button onClick={() => this.addGroup()}>+ Add group</Button>
                </div>
            </div>
        );
    }
}
