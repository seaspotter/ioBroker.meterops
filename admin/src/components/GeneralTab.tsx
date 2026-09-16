import React from 'react';
import TextField from '@material-ui/core/TextField';
import Button from '@material-ui/core/Button';

import SimpleCronDialog from '@iobroker/adapter-react/Dialogs/SimpleCron';
import I18n from '@iobroker/adapter-react/i18n';

interface GeneralTabProps {
    native: Record<string, unknown>;
    onChange: (attr: string, value: unknown) => void;
}

interface GeneralTabState {
    editingCron: boolean;
}

/** History instance and snapshot-schedule settings, editing native.historyInstance/native.snapshotCron directly. */
export default class GeneralTab extends React.Component<GeneralTabProps, GeneralTabState> {
    /** @param props - current native config and the change handler */
    constructor(props: GeneralTabProps) {
        super(props);
        this.state = { editingCron: false };
    }

    /** @returns the history-instance field and the cron schedule field/editor */
    render(): React.JSX.Element {
        const historyInstance = (this.props.native.historyInstance as string | undefined) ?? '';
        const snapshotCron = (this.props.native.snapshotCron as string | undefined) ?? '0 0 1 * *';

        return (
            <div>
                <div>
                    <TextField
                        label={I18n.t('History instance')}
                        helperText={I18n.t(
                            'Instance that meter/group/kpi/tariff states get automatically configured for history logging on, e.g. "influxdb.0". Leave empty to configure history manually per state.',
                        )}
                        style={{ minWidth: 400 }}
                        value={historyInstance}
                        onChange={e => this.props.onChange('historyInstance', e.target.value)}
                        margin="normal"
                    />
                </div>
                <div>
                    <TextField
                        label={I18n.t('Snapshot schedule (cron)')}
                        helperText={I18n.t(
                            "How often every meter's current value is snapshotted for period-based KPIs (self_consumption_ratio, autarky, cop, ...).",
                        )}
                        style={{ minWidth: 400 }}
                        value={snapshotCron}
                        InputProps={{ readOnly: true }}
                        margin="normal"
                    />
                    <div>
                        <Button
                            variant="outlined"
                            onClick={() => this.setState({ editingCron: true })}
                        >
                            {I18n.t('Edit schedule')}
                        </Button>
                    </div>
                </div>

                {this.state.editingCron && (
                    <SimpleCronDialog
                        cron={snapshotCron}
                        simple
                        title={I18n.t('Snapshot schedule')}
                        onClose={() => this.setState({ editingCron: false })}
                        onOk={(newCron: string) => {
                            this.props.onChange('snapshotCron', newCron);
                            this.setState({ editingCron: false });
                        }}
                    />
                )}
            </div>
        );
    }
}
