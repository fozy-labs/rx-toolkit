import React from 'react';
import { PatchesSection } from '../components/PatchesSection';
import { CodeBlock } from '../components/CodeBlock';

const patchesCode = `
export const todoListResource = createResource({
  queryFn: fetchTodoList,
});

export function PatchesSection() {
  const todoQuery = useResourceAgent(todoListResource, undefined);
  const todoRef = useResourceRef(todoListResource, undefined);

  const createPatch = (patchFn: (data: TodoList) => void) => {
    const transaction = todoRef.patch(patchFn);
    // ...
  };

  const commitPatch = () => {
    //...
    transaction.commit(); // Подтверждаем изменения
  };

  const abortPatch = () => {
    //...
    transaction.abort(); // Отменяем изменения
  };

  // ...
}`;

export function PatchesPage() {
  return (
    <div className="example-page">
      <div className="example-header">
        <h1>🔧 Патчи ресурсов</h1>
        <p>
          Демонстрация работы с патчами ресурсов. Патчи позволяют создавать временные изменения,
          которые можно подтвердить (commit) или отменить (abort). Все изменения применяются
          оптимистично и мгновенно отображаются в UI.
        </p>
      </div>

      <div className="example-content">
        <div>
          <PatchesSection />
        </div>

        <div className="code-panel">
          <CodeBlock code={patchesCode} />
        </div>
      </div>
    </div>
  );
}
