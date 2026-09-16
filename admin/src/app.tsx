/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import AppBar from '@material-ui/core/AppBar';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';

import GenericApp from '@iobroker/adapter-react/GenericApp';
import type { GenericAppProps, GenericAppSettings } from '@iobroker/adapter-react/types';
import I18n from '@iobroker/adapter-react/i18n';

import type { RegistryConfig } from '../../src/lib/registry-types';
import { parseRegistryConfigLoose, serializeRegistryConfig } from '../../src/lib/registry-json';

import GeneralTab from './components/GeneralTab';
import MetersTab from './components/MetersTab';
import GroupsTab from './components/GroupsTab';
import TariffsTab from './components/TariffsTab';

/** Admin settings UI: General/Meters/Groups/Tariffs tabs over the single registryConfig JSON native value. */
class App extends GenericApp {
    // plain field + forceUpdate rather than React state: GenericApp's setState() type is fixed to its own
    // GenericAppState by the base class, so a locally-added state field can't flow through it cleanly
    private tab = 0;

    /** @param props - props ioBroker admin passes to every custom settings component */
    constructor(props: GenericAppProps) {
        const extendedProps: GenericAppSettings = {
            ...props,
            encryptedFields: [],
            translations: {
                en: require('./i18n/en.json'),
                de: require('./i18n/de.json'),
                ru: require('./i18n/ru.json'),
                pt: require('./i18n/pt.json'),
                nl: require('./i18n/nl.json'),
                fr: require('./i18n/fr.json'),
                it: require('./i18n/it.json'),
                es: require('./i18n/es.json'),
                pl: require('./i18n/pl.json'),
                uk: require('./i18n/uk.json'),
                'zh-cn': require('./i18n/zh-cn.json'),
            },
        };
        super(props, extendedProps);
    }

    /** Executed when the socket.io connection is ready - nothing to prefetch here. */
    onConnectionReady(): void {
        // executed when connection is ready
    }

    /** Parses the current native.registryConfig for the tab components - see registry-json.ts. */
    getRegistry(): RegistryConfig {
        const native = this.state.native as Record<string, unknown>;
        return parseRegistryConfigLoose(native.registryConfig as string | undefined);
    }

    /**
     * Serializes a new RegistryConfig back into native.registryConfig and registers the change.
     *
     * @param next - the updated registry to persist
     */
    setRegistry = (next: RegistryConfig): void => {
        this.updateNativeValue('registryConfig', serializeRegistryConfig(next));
    };

    /** @returns the tabbed settings UI once loaded, or GenericApp's own loading placeholder before that */
    render(): React.JSX.Element {
        if (!this.state.loaded) {
            return super.render();
        }

        const registry = this.getRegistry();
        const onNativeChange = (attr: string, value: unknown): void => this.updateNativeValue(attr, value);

        return (
            <div className="App">
                <AppBar
                    position="static"
                    color="default"
                >
                    <Tabs
                        value={this.tab}
                        onChange={(_e, tab: number) => {
                            this.tab = tab;
                            this.forceUpdate();
                        }}
                        indicatorColor="primary"
                        textColor="primary"
                        variant="scrollable"
                    >
                        <Tab label={I18n.t('General')} />
                        <Tab label={I18n.t('Meters')} />
                        <Tab label={I18n.t('Groups')} />
                        <Tab label={I18n.t('Tariffs')} />
                    </Tabs>
                </AppBar>

                <div style={{ padding: 16 }}>
                    {this.tab === 0 && (
                        <GeneralTab
                            native={this.state.native}
                            onChange={onNativeChange}
                        />
                    )}
                    {this.tab === 1 && (
                        <MetersTab
                            registry={registry}
                            onChange={this.setRegistry}
                            socket={this.socket}
                        />
                    )}
                    {this.tab === 2 && (
                        <GroupsTab
                            registry={registry}
                            onChange={this.setRegistry}
                        />
                    )}
                    {this.tab === 3 && (
                        <TariffsTab
                            registry={registry}
                            onChange={this.setRegistry}
                        />
                    )}
                </div>

                {this.renderError()}
                {this.renderToast()}
                {this.renderSaveCloseButtons()}
            </div>
        );
    }
}

export default App;
