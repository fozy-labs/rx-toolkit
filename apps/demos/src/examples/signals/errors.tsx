import { Signal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody, CardHeader, Chip, Input } from "@heroui/react";
import React from "react";

const raw$ = Signal.state('{ "name": "Ann" }', 'Errors/raw$');

// Бросает, пока в поле невалидный JSON. Ошибка хранится как состояние
// computed и пробрасывается при каждом чтении, а после исправления ввода
// computed пересчитывается сам.
const parsed$ = Signal.compute(
    () => JSON.parse(raw$()) as { name?: string },
    'Errors/parsed$',
);

// Зависимый computed может поймать ошибку зависимости обычным try/catch.
const status$ = Signal.compute(() => {
    try {
        return { ok: true, text: `имя: ${parsed$().name ?? '—'}` };
    } catch (error) {
        return { ok: false, text: (error as Error).message };
    }
}, 'Errors/status$');

const lastValid$ = Signal.state<string>('—', 'Errors/lastValid$');

// Без ErrorBoundary ошибка из чтения в рендере уронила бы весь пример.
class Boundary extends React.Component<
    { children: React.ReactNode },
    { error: Error | null }
> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    render() {
        if (!this.state.error) return this.props.children;

        return (
            <div className="space-y-2 text-danger">
                <div>ErrorBoundary: {this.state.error.message}</div>
                <Button size="sm" onPress={() => this.setState({ error: null })}>
                    Попробовать снова
                </Button>
            </div>
        );
    }
}

function Parsed() {
    // Пока parsed$ в ошибке, чтение бросает — ошибка уходит в Boundary.
    const parsed = useSignal(parsed$);

    return <div className="text-success">Разобрано: {JSON.stringify(parsed)}</div>;
}

export function Base() {
    const raw = useSignal(raw$);
    const status = useSignal(status$);
    const lastValid = useSignal(lastValid$);

    React.useEffect(() => {
        // Эффект переживает ошибку зависимости: он ловит её сам и
        // продолжает реагировать на следующие изменения.
        const effect = Signal.effect(() => {
            try {
                lastValid$.set(JSON.stringify(parsed$()));
            } catch {
                // Оставляем последнее валидное значение
            }
        });

        return () => effect.unsubscribe();
    }, []);

    return (
        <Card>
            <CardHeader className="font-bold text-lg">Ошибки в сигналах</CardHeader>
            <CardBody className="space-y-4">
                <Input
                    label="JSON"
                    value={raw}
                    onValueChange={(value) => raw$.set(value)}
                    description="Сломайте JSON, затем исправьте его"
                />
                <p className="text-sm">
                    computed с try/catch:{' '}
                    <Chip size="sm" color={status.ok ? 'success' : 'danger'}>{status.text}</Chip>
                </p>
                <p className="text-sm">
                    Последнее валидное (effect): <Chip size="sm">{lastValid}</Chip>
                </p>
                <Boundary>
                    <Parsed />
                </Boundary>
            </CardBody>
        </Card>
    );
}
