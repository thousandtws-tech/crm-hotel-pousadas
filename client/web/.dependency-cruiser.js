/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Dependências circulares quebram o lazy loading e dificultam o raciocínio.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'feature-para-outra-feature',
      comment:
        'Uma capacidade de negócio não importa detalhes internos de outra. ' +
        'Compartilhado vai em core/ ou shared/.',
      severity: 'error',
      from: { path: '^src/app/features/([^/]+)' },
      to: { path: '^src/app/features/(?!$1/)[^/]+' },
    },
    {
      name: 'shared-nao-depende-de-features',
      comment: 'UI compartilhada é genérica — não conhece capacidades de negócio.',
      severity: 'error',
      from: { path: '^src/app/shared' },
      to: { path: '^src/app/features' },
    },
    {
      name: 'core-nao-depende-de-features',
      comment: 'Infraestrutura transversal não conhece capacidades de negócio.',
      severity: 'error',
      from: { path: '^src/app/core' },
      to: { path: '^src/app/(features|layout)' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.app.json' },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
