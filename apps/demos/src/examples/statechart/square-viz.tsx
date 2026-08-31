import React from 'react';
import { unstable_MachineSignal as MachineSignal } from '@fozy-labs/rx-toolkit';
import { StatechartViz } from '@fozy-labs/statechart-viz';
import { definition as square } from './square.generated';

// `square.generated.ts` is produced from `square.mmd` by the converter
// (`npm run statechart:generate`). The definition carries the source text, so
// the viz renders the original diagram and follows the running machine:
// click an enabled transition, or select a state and send an event with a
// payload from the panel.
export function Base() {
    const [square$] = React.useState(() => MachineSignal.state(square, { autoStart: false }));

    React.useEffect(() => {
        square$.start();
        return () => square$.stop();
    }, [square$]);

    return (
        <div style={{ height: 560 }}>
            <StatechartViz machine={square$} />
        </div>
    );
}
