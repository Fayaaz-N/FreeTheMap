const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: {
    app: "./js/app.js",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    clean: true,
    filename: "js/app.js",
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "index.html", to: "index.html" },
        { from: "css", to: "css" },
        { from: "img", to: "img" },
        { from: "js/data.json", to: "js/data.json" },
      ],
    }),
  ],
};
