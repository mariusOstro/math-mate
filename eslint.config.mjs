import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default [
  ...nextVitals,
  ...nextTypescript,
  { ignores: ['.next/**', 'node_modules/**', 'prototype/**', 'prisma/**', 'next-env.d.ts'] },
  { rules: { 'react-hooks/set-state-in-effect': 'off', 'react-hooks/refs': 'off' } },
];
