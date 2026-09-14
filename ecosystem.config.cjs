const cwd = __dirname;

const names = [
  'plugin-wordhint2', 'plugin-rime2', 'plugin-repeat', 'plugin-request',
  'plugin-message', 'plugin-1A2B', 'plugin-24point', 'plugin-help'
];

module.exports = {
  apps: names.map((name) => ({
    name,
    script: `./dist/${name}.js`,
    cwd,
    interpreter: 'node'
  }))
};
