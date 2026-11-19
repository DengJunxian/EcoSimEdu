import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");
const readJson = async (path) => JSON.parse(await read(path));
const ids = await readJson("../cases/catalog.json");
const [catalog, scenes] = await Promise.all([
  Promise.all(ids.map(id => readJson(`../cases/${id}/case.json`))),
  Promise.all(ids.map(async id => [id, await readJson(`../cases/${id}/lesson-v2.json`)])),
]);

const main = "src/main.tsx";
const result = await build({
  absWorkingDir: root,
  nodePaths: [join(root, "node_modules")],
  jsx: "automatic",
  entryPoints: [main],
  outdir: "dist/assets",
  entryNames: "[name]-[hash]",
  chunkNames: "[name]-[hash]",
  bundle: true,
  format: "esm",
  splitting: true,
  minify: true,
  target: "es2022",
  metafile: true,
  write: false,
  plugins: [{
    name: "course-files",
    setup({ onResolve, onLoad }) {
      onResolve({ filter: /^virtual:course-files$/ }, () => ({ path: "course-files", namespace: "course-files" }));
      onLoad({ filter: /^course-files$/, namespace: "course-files" }, () => ({
        contents: JSON.stringify({ catalog, scenes: Object.fromEntries(scenes) }),
        loader: "json",
      }));
    },
  }],
});

const entryTag = `<script type="module" src="/${main}"></script>`;
const html = await read("index.html");
const entry = Object.entries(result.metafile.outputs).find(([, file]) => file.entryPoint === main);
if (!entry?.[1].cssBundle || !html.includes(entryTag)) throw new Error("Student entry or stylesheet is missing.");
const [script, { cssBundle }] = entry;
const url = file => `/assets/${basename(file)}`;
const page = html.replace(entryTag, `<script type="module" src="${url(script)}"></script>`)
  .replace("</head>", `  <link rel="stylesheet" href="${url(cssBundle)}" />\n  </head>`);

await rm(join(root, "dist"), { recursive: true, force: true });
await mkdir(join(root, "dist/assets"), { recursive: true });
await Promise.all(result.outputFiles.map(file => writeFile(file.path, file.contents)));
await writeFile(join(root, "dist/index.html"), page);
