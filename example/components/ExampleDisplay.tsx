import React, { useState } from 'react';
import { CodeBlock } from './CodeBlock';

interface ExampleDisplayProps {
  title: string;
  description: string;
  demoComponent: React.ReactNode;
  code: string;
}

export function ExampleDisplay({ title, description, demoComponent, code }: ExampleDisplayProps) {
  const [activeTab, setActiveTab] = useState<'demo' | 'code'>('demo');

  return (
    <div className="example-page">
      <div className="example-header">
        <h1>{title}</h1>
        <p>{description}</p>

        <div className="tabs">
          <button
            className={`tab ${activeTab === 'demo' ? 'active' : ''}`}
            onClick={() => setActiveTab('demo')}
          >
            🎮 Демо
          </button>
          <button
            className={`tab ${activeTab === 'code' ? 'active' : ''}`}
            onClick={() => setActiveTab('code')}
          >
            📝 Код
          </button>
        </div>
      </div>

      <div className="example-content">
        {activeTab === 'demo' ? (
          <div className="demo-panel full-width">
            {demoComponent}
          </div>
        ) : (
          <div className="code-panel full-width">
            <CodeBlock code={code} />
          </div>
        )}
      </div>
    </div>
  );
}
