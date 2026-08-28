import React from 'react';
import { LiveEditor, LiveError, LivePreview, LiveProvider } from 'react-live';
import { themes } from 'prism-react-renderer';
import {
    and,
    assign,
    cancel,
    Computed,
    createApi,
    createMachine,
    CURRENT_SNAPSHOT_VERSION,
    DefaultOptions,
    Effect,
    LocalSignal,
    LocalState,
    log,
    MachineSignal,
    not,
    or,
    raise,
    reactHooksPlugin,
    Signal,
    SKIP,
    State,
    stateIn,
    statelyInspector,
    unstable_KeyedSignal,
    unstable_ProxySignal as ProxySignal,
    useCommand,
    useResource,
    useSignal,
} from '@fozy-labs/rx-toolkit';
import {
    Button,
    Card,
    CardBody,
    CardFooter,
    CardHeader,
    Checkbox,
    Chip,
    cn,
    Divider,
    Input,
    Select,
    SelectItem,
    Slider,
    Spinner,
    Switch,
    Tab,
    Tabs,
} from '@heroui/react';
import { debounceTime, scan, startWith, Subject } from 'rxjs';
import { fetches } from '../utils/fetches';

function processExample(code: string): string {
    code = code.replace(/^import .+ from .+;$/gm, '');

    if (code.includes('export ')) {
        code = code.replace(/^export /gm, '');
    }

    if (code.includes('function Base')) {
        code = code + '\n\nrender(Base);';
    }

    return code;
}

interface PlaygroundProps {
    initialCode: string;
    scope?: Record<string, any>;
    noInline?: boolean;
    title?: string
}

export function LiveExample({
    initialCode: dryInitialCode,
    scope = {},
    noInline = true,
    title,
}: PlaygroundProps) {
    const initialCode = React.useMemo(() => processExample(dryInitialCode).trim(), [dryInitialCode]);
    const [code, setCode] = React.useState(initialCode);

    const defaultScope = {
        and,
        assign,
        Button,
        cancel,
        Card,
        CardBody,
        CardFooter,
        CardHeader,
        Checkbox,
        Chip,
        cn,
        Computed,
        createApi,
        createMachine,
        CURRENT_SNAPSHOT_VERSION,
        debounceTime,
        DefaultOptions,
        Divider,
        Effect,
        fetches,
        Input,
        LocalSignal,
        LocalState,
        log,
        MachineSignal,
        not,
        or,
        raise,
        React,
        reactHooksPlugin,
        scan,
        Select,
        SelectItem,
        Signal,
        SKIP,
        Slider,
        Spinner,
        startWith,
        State,
        stateIn,
        statelyInspector,
        Subject,
        Switch,
        Tab,
        Tabs,
        unstable_KeyedSignal,
        ProxySignal,
        useCommand,
        useResource,
        useSignal,
        ...scope
    };

    const handleReset = () => {
        setCode((oldCode) => {
            if (oldCode === initialCode) {
                return initialCode + ' '; // Force re-render
            }

            return initialCode;
        });
    };

    return (
        <Card className="my-4 not-prose">
            <CardHeader className="flex-row justify-between">
                <div className="font-medium text-lg">
                    {title}
                </div>

                <Button
                    size="sm"
                    variant="flat"
                    onPress={handleReset}
                >
                    Reset
                </Button>
            </CardHeader>
            <Divider />
            <CardBody className="p-0">
                <LiveProvider
                    code={code}
                    scope={defaultScope}
                    theme={themes.oneLight}
                    noInline={noInline}
                >
                    <div className="flex flex-col">
                        <div className="min-h-[400px]">
                            <div
                                className="grid grid-cols-2 divide-y divide-x divide-divider">
                                <div>
                                    <LiveEditor
                                        className="live-editor"
                                        style={{
                                            fontFamily: 'JetBrains Mono, Consolas, "Liberation Mono", monospace',
                                            fontSize: '14px',
                                            minHeight: '400px',
                                        }}
                                    />
                                </div>
                                <div className="p-6">
                                    <LivePreview />
                                    <LiveError
                                        className="mt-4 p-3 bg-danger-50 text-danger rounded-md text-sm font-mono whitespace-pre-wrap"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </LiveProvider>
            </CardBody>
        </Card>
    );
}

