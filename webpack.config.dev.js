const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = merge(common, {
  mode: "development",
  devtool: "inline-source-map",
  devServer: {
    port: 8080,
    hot: true,
    liveReload: true,
    open: true,
    static: [{ directory: __dirname }],
    proxy: [
      {
        context: ["/tsdb"],
        target: "https://www.thesportsdb.com",
        changeOrigin: true,
        secure: true,
        pathRewrite: { "^/tsdb": "" },
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "css", to: "css" },
        { from: "img", to: "img" },
        { from: "js/data.json", to: "js/data.json", noErrorOnMissing: true },
        { from: "js/vendor", to: "js/vendor" },
        { from: "icon.svg", to: "icon.svg" },
        { from: "favicon.ico", to: "favicon.ico" },
        { from: "robots.txt", to: "robots.txt" },
        { from: "icon.png", to: "icon.png" },
        { from: "404.html", to: "404.html" },
        { from: "site.webmanifest", to: "site.webmanifest" },
      ],
    }),
  ],
});
