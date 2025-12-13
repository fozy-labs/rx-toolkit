import React from 'react';
import { LiveEditor, LiveError, LivePreview, LiveProvider } from 'react-live';
import { themes } from 'prism-react-renderer';
import {
    Computed,
    createOperation,
    createResource,
    Effect,
    resetAllQueriesCache,
    Signal,
    SKIP,
    useOperationAgent,
    useResourceAgent,
    useResourceRef,
    useSignal,
} from '@fozy-labs/rx-toolkit';
import {
    Button,
    Card,
    CardBody,
    CardHeader,
    Checkbox,
    Chip,
    Divider,
    Input,
    Select,
    SelectItem,
    Switch,
} from '@heroui/react';
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
        Button,
        Card,
        CardBody,
        CardHeader,
        Checkbox,
        Chip,
        Computed,
        createOperation,
        createResource,
        Divider,
        Effect,
        fetches,
        Input,
        React,
        resetAllQueriesCache,
        Select,
        SelectItem,
        Signal,
        SKIP,
        Switch,
        useOperationAgent,
        useResourceAgent,
        useResourceRef,
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
                                    <LivePreview/>
                                    <LiveError
                                        className="mt-4 p-3 bg-danger-50 text-danger rounded-md text-sm font-mono whitespace-pre-wrap"/>
                                </div>
                            </div>
                        </div>
                    </div>
                </LiveProvider>
            </CardBody>
        </Card>
    );
}

