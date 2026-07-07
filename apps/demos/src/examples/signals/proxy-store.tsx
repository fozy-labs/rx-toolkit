import { unstable_ProxySignal as ProxySignal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody, CardHeader, Chip, Input } from "@heroui/react";

type Profile = {
    user: { name: string; age: number };
    tags: string[];
};

const initial: Profile = {
    user: { name: "Аня", age: 20 },
    tags: ["react", "signals"],
};

// Глубокий реактивный стор: читаем через дерево-прокси, пишем через mutate/set.
const profile = ProxySignal.state<Profile>(initial);

const rename = (name: string) => profile.mutate((d) => { d.user.name = name; });
const birthday = () => profile.mutate((d) => { d.user.age += 1; });
const addTag = () => profile.mutate((d) => { d.tags.push(`тег ${d.tags.length + 1}`); });
const removeTag = (index: number) => profile.mutate((d) => { d.tags.splice(index, 1); });
const reset = () => profile.set(initial);

export function Base() {
    // useSignal(ps) — контроллер совместим с { obs, peek }, поэтому хук
    // возвращает весь снимок дерева и обновляет компонент на любое изменение.
    const { user, tags } = useSignal(profile);

    return (
        <Card className="max-w-md pt-2">
            <CardHeader className="flex-col items-start gap-1">
                <span className="text-lg font-semibold">Профиль (unstable_ProxySignal)</span>
                <span className="text-xs text-warning">экспериментально</span>
            </CardHeader>
            <CardBody className="space-y-4">
                <Input
                    label="Имя"
                    value={user.name}
                    onValueChange={rename}
                />

                <div className="flex items-center justify-between">
                    <span className="text-sm">
                        Возраст: <span className="font-semibold text-secondary">{user.age}</span>
                    </span>
                    <Button size="sm" color="primary" onPress={birthday}>
                        День рождения (+1)
                    </Button>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Теги</span>
                        <Button size="sm" variant="flat" onPress={addTag}>
                            Добавить
                        </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {tags.map((tag, index) => (
                            <Chip
                                key={index}
                                onClose={() => removeTag(index)}
                                variant="flat"
                            >
                                {tag}
                            </Chip>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end">
                    <Button size="sm" variant="bordered" onPress={reset}>
                        Сбросить
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}
