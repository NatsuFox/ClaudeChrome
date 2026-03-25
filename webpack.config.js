const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    'service-worker': './extension/service-worker.ts',
    'side-panel/panel': './extension/side-panel/panel.ts',
    'content/injector': './extension/content/injector.ts',
    'content/page-script': './extension/content/page-script.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'extension/manifest.json', to: 'manifest.json' },
        { from: 'extension/side-panel/panel.html', to: 'side-panel/panel.html' },
        { from: 'extension/side-panel/panel.css', to: 'side-panel/panel.css' },
        {
          from: 'node_modules/@xterm/xterm/css/xterm.css',
          to: 'side-panel/xterm.css',
        },
      ],
    }),
  ],
  devtool: 'source-map',
};
