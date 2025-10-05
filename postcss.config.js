module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
module.exports = {
  plugins: [
    // Load the built PostCSS plugin directly from the installed package to
    // avoid the adapter mismatch some Tailwind versions emit in CRA setups.
    require('tailwindcss/dist/plugin.js'),
    require('autoprefixer'),
  ],
};
