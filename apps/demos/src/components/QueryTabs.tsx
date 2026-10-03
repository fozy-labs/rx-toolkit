import React from "react";
import { Tabs } from "@heroui/react";

/** The key `Tabs` reports: `@react-types/shared` is not a dependency of the demos. */
type Key = string | number;

export function QueryTabs({ children }: React.PropsWithChildren) {
    const [activeTab, setActiveTab] = React.useState<string | undefined>(() => {
        const queryParams = new URLSearchParams(window.location.search);
        return queryParams.get('tab') ?? undefined;
    });

    const handleTabChange = (tab: Key) => {
        if (typeof tab !== 'string') {
            console.warn('Tab key should be a string');
            return;
        }
        setActiveTab(tab);
        const queryParams = new URLSearchParams(window.location.search);
        queryParams.set('tab', tab);
        const newUrl = `${window.location.pathname}?${queryParams.toString()}`;
        window.history.pushState(null, '', newUrl);
    }

    return (
        <Tabs
            selectedKey={activeTab}
            onSelectionChange={handleTabChange}
        >
            {children}
        </Tabs>
    )
}
