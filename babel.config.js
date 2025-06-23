module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: 'current',
        },
      },
    ],
  ],
  // Only use babel for JavaScript files in tests
  include: [
    'src/**/*.js',
    'tests/**/*.js'
  ],
  // Don't transform TypeScript files
  exclude: [
    '**/*.ts',
    '**/*.tsx'
  ]
};