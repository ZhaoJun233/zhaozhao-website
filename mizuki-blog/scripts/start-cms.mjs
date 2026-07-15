import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRepositoryRoot(startDirectory) {
  let directory = resolve(startDirectory);

  while (true) {
    if (existsSync(resolve(directory, ".git"))) {
      return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`No repository root found above ${startDirectory}`);
    }
    directory = parent;
  }
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = process.env.GIT_REPO_DIRECTORY
  ? resolve(process.env.GIT_REPO_DIRECTORY)
  : findRepositoryRoot(resolve(scriptDirectory, ".."));

process.env.PORT ??= "8081";
process.env.BIND_HOST ??= "127.0.0.1";
process.env.GIT_REPO_DIRECTORY ??= repositoryRoot;
process.env.MODE ??= "fs";

await import("decap-server");
