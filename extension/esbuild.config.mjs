import esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });
cpSync("manifest.json", "dist/manifest.json");
cpSync("public", "dist", { recursive: true });

const opts = {
  entryPoints: {
    content: "src/content.ts",
    background: "src/background.ts",
    options: "src/options/options.ts",
    onboarding: "src/onboarding/onboarding.ts",
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: ["chrome120"],
  minify: !watch,
  sourcemap: watch,
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("extension: watching…");
} else {
  await esbuild.build(opts);
  console.log("extension: built dist/");
}
