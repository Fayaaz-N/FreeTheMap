const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");

module.exports = merge(common, {
  mode: "development",
  devtool: "inline-source-map",
  devServer: {
    port: 8080,
    hot: true,
    liveReload: true,
    open: true,

    // serve static files (index.html, css, img, etc)
    static: [{ directory: __dirname }],

    // ✅ proxy MUST be an ARRAY in your setup
    proxy: [
      {
        context: ["/tsdb"],
        target: "https://www.thesportsdb.com",
        changeOrigin: true,
        secure: true,
        pathRewrite: { "^/tsdb": "" },
        logLevel: "debug",
      },
    ],
  },
});
