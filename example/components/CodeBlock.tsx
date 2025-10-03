import React, { useEffect } from 'react';
import Prism from 'prismjs';

import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language = 'tsx' }: CodeBlockProps) {
  useEffect(() => {
    // Даем время для загрузки всех компонентов
    setTimeout(() => {
      Prism.highlightAll();
    }, 100);
  }, [code]);

  return (
    <pre className={`language-${language}`}>
      <code className={`language-${language}`}>
        {code}
      </code>
    </pre>
  );
}
