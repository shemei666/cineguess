module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: ["eslint:recommended", "google", "plugin:prettier/recommended"],
  rules: {
    quotes: ["error", "double"],
    "max-len": "off", // Let Prettier handle line lengths
    "require-jsdoc": "off", // Optional: relax JSDoc requirement
  },
  parserOptions: {
    ecmaVersion: 2022,
  },
};
