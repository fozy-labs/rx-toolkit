/// <reference types="vite/client" />

declare module '*.mdx' {
  import { ComponentType } from 'react';
  const Component: ComponentType;
  export default Component;
  export const meta: {
    title?: string;
    description?: string;
  };
}

