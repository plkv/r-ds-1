const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');
const HTMLInlineCSSWebpackPlugin = require('html-inline-css-webpack-plugin').default;

module.exports = {
  mode: 'production',
  entry: {
    ui: './src/ui/index.jsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  target: 'web',
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react'],
          },
        },
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/ui/index.html',
      filename: 'ui.html',
      chunks: ['ui'],
      inject: 'body',
    }),
    new HtmlInlineScriptPlugin({
      scriptMatchPattern: [/ui\.js$/],
    }),
    new HTMLInlineCSSWebpackPlugin(),
  ],
}; 