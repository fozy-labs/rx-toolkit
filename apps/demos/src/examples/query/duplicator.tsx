import { createResource, createResourceDuplicator, useResourceAgent, resetAllQueriesCache } from "@fozy-labs/rx-toolkit";
import { Button, Tab, Tabs } from "@heroui/react";

const itemsApi = createResourceDuplicator({
    resource: createResource({
        queryFn: async (ids: number[]) => {
            await new Promise(resolve => setTimeout(resolve, 500));
            return ids.map(id => ({
                id,
                name: `Item ${id}`,
                random: Math.random(),
            }));
        },
        cacheLifetime: 100,
        devtoolsName: 'duplicator/getItemsApi',
    }),
    cacheLifetime: 10_000,
    getArgKey: (id: number) => id,
    getDataKey: (item: { id: number }) => item.id,
})

function createTab(name: string, data: number[]) {
    function Tab() {
        const query = useResourceAgent(itemsApi, data);

        return (
            <div>
                <h2 className="text-lg font-semibold mb-2">{name}</h2>
                {query.isLoading && <p>Loading...</p>}
                {query.isError && <p className="text-red-500">Error: {String(query.error)}</p>}
                {query.data && (
                    <ul className="list-disc list-inside">
                        {query.data.map(item => (
                            <li key={item.id}>
                                {item.name} (Random: {item.random.toFixed(4)})
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        )
    }

    Tab.displayName = name.split(' ')[0];
    Tab.__name = name;
    return Tab;
}

const Tab1 = createTab('Tab1 (IDs: 1, 2, 3)', [1, 2, 3]);
const Tab2 = createTab('Tab2 (IDs: 4, 5, 6)', [4, 5, 6]);
const Tab3 = createTab('Tab3 (IDs: 1, 4, 7)', [1, 4, 7]);

export function Base() {
    return (
        <div className="row">
            <Tabs>
                <Tab key="tab1" title={Tab1.__name}>
                    <Tab1 />
                </Tab>
                <Tab key="tab2" title={Tab2.__name}>
                    <Tab2 />
                </Tab>
                <Tab key="tab3" title={Tab3.__name}>
                    <Tab3 />
                </Tab>
            </Tabs>
            <Button
                onPress={resetAllQueriesCache}
                isIconOnly
            >
                R
            </Button>
        </div>
    )
}
