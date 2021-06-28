// import TerserPlugin from "terser-webpack-plugin";
import * as path from "path";
import * as webpack from "webpack";
import TsconfigPathsPlugin from "tsconfig-paths-webpack-plugin";
import * as child_process from "child_process";

const env = process.env.NODE_ENV ?? "development";

console.log("electron webpack env:", env);

const externals: webpack.ExternalsElement[] = [
  /worker\.js/,
  "bufferutil",
  "utf-8-validate",
  /keytar/,
];

if (env !== "production") {
  // in prod, will be copied into the desktop bundle
  const devKeytar = path.resolve(
    __dirname,
    "../../node_modules/keytar/build/Release/keytar.node"
  );
  const distFolder = path.resolve(__dirname, "./dist/keytar.node");
  child_process.execSync(`mkdir -p ${path.resolve(__dirname, "dist")}`);
  child_process.execSync(`cp ${devKeytar} ${distFolder}`);
}

const config: webpack.Configuration = {
  mode: "production",
  entry: { bundle: "./src/main.ts" },
  target: "electron-main",
  optimization: {
    minimize: false,
    // minimizer: [
    //   new TerserPlugin({
    //     terserOptions: {
    //       compress: {
    //         drop_console: true,
    //       },
    //     },
    //   }),
    // ],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: true,
            },
          },
        ],
        exclude: /node_modules/,
      },
    ],
  },
  externals,
  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: env,
      ...(env == "production"
        ? {
            // in electron, things are relative to process.resourcesPath, which is only available at runtime
            // and we cannot reuse it the same as CRYPTO_WORKER_PATH
            CRYPTO_WORKER_PATH_FROM_ELECTRON_EXTRA_RESOURCES: "worker.js",
          }
        : {
            CRYPTO_WORKER_PATH: "./worker.js",
          }),
    }),
  ],
  stats: {
    warningsFilter: [
      // Ignore warnings due to yarg's dynamic module loading
      /node_modules\/yargs/,
      // and express `Critical dependency: the request of a dependency is an expression` due to similar dynamic require
      /node_modules\/express/,
      // circular deps
      /node_modules\/is-reachable/,
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js", ".node"],
    plugins: [new TsconfigPathsPlugin({ configFile: "tsconfig.json" })],
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
  },
};

export default config;
