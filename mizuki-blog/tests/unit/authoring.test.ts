import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { siteConfig } from "../../src/config/site";
import profile from "../../src/data/profile.json";

type CmsField = {
  name: string;
  pattern?: string[];
  widget?: string;
  collection?: string;
  file?: string;
  search_fields?: string[];
  value_field?: string;
  display_fields?: string[];
};
type CmsCollection = {
  name: string;
  folder?: string;
  files?: Array<{ file: string; fields: CmsField[]; name: string }>;
  fields?: CmsField[];
  media_folder?: string;
  public_folder?: string;
};
type CmsConfig = {
  backend: { branch: string; name: string };
  local_backend: boolean | { url: string };
  media_folder: string;
  public_folder: string;
  collections: CmsCollection[];
};
type ComposeService = {
  build: { args?: Record<string, string>; context: string; target?: string };
  command?: string;
  environment?: Record<string, string>;
  healthcheck?: { test: string[] };
  ports?: string[];
  profiles?: string[];
  user?: string;
  volumes?: string[];
};
type ComposeConfig = {
  services: {
    author: ComposeService;
    cms: ComposeService;
    site: ComposeService;
  };
};

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(appRoot, "..");
const adminHtml = readFileSync(resolve(appRoot, "src/pages/admin/index.astro"), "utf8");
const cmsConfig = parse(
  readFileSync(resolve(appRoot, "public/admin/config.yml"), "utf8"),
) as CmsConfig;
const composeConfig = parse(
  readFileSync(resolve(appRoot, "docker-compose.yml"), "utf8"),
) as ComposeConfig;
const dockerfile = readFileSync(resolve(appRoot, "Dockerfile"), "utf8");
const dockerignore = readFileSync(resolve(appRoot, ".dockerignore"), "utf8");

function collection(name: string) {
  const match = cmsConfig.collections.find((item) => item.name === name);
  expect(match, `Missing Decap collection: ${name}`).toBeDefined();
  return match!;
}

function expectRepositoryPath(relativePath: string) {
  const absolutePath = resolve(repositoryRoot, relativePath);
  const pathFromRoot = relative(repositoryRoot, absolutePath);
  expect(pathFromRoot.startsWith("..")).toBe(false);
  expect(isAbsolute(pathFromRoot)).toBe(false);
  expect(existsSync(absolutePath), `${relativePath} must exist`).toBe(true);
}

describe("local authoring", () => {
  it("bundles a pinned Decap app and explicit /admin/ config route", () => {
    expect(adminHtml).toContain('href="/admin/config.yml"');
    expect(adminHtml).toContain('rel="cms-config-url"');
    expect(adminHtml).toContain('from "decap-cms-app"');
    expect(adminHtml).toContain('name: "preSave"');
    expect(adminHtml).toContain("validatePostCoverPair");
    expect(adminHtml).toContain("CMS.init()");
    expect(adminHtml).not.toContain("https://unpkg.com");
    expect(adminHtml).not.toContain(profile.name);
  });

  it("uses repository-root paths and fields that match the Astro schemas", () => {
    expect(cmsConfig.backend).toEqual({ name: "git-gateway", branch: "master" });
    expect(cmsConfig.local_backend).toEqual({
      url: "http://127.0.0.1:8081/api/v1",
    });
    expect(cmsConfig.media_folder).toBe("mizuki-blog/src/assets/uploads");
    expect(cmsConfig.public_folder).toBe("../../assets/uploads");

    const posts = collection("posts");
    expect(posts.folder).toBe("mizuki-blog/src/content/posts");
    expect(posts.fields?.map(({ name }) => name)).toEqual([
      "title",
      "description",
      "publishedAt",
      "updatedAt",
      "draft",
      "featured",
      "category",
      "tags",
      "series",
      "cover",
      "coverAlt",
      "canonicalUrl",
      "body",
    ]);
    expect(posts.fields?.find(({ name }) => name === "canonicalUrl")?.pattern?.[0])
      .toBe("^https?://\\S+$");
    expect(posts.fields?.find(({ name }) => name === "category")).toMatchObject({
      widget: "relation",
      collection: "taxonomy",
      file: "categories",
      search_fields: ["categories.*.name"],
      value_field: "categories.*.name",
      display_fields: ["categories.*.name"],
    });
    expectRepositoryPath(posts.folder!);

    const projects = collection("projects");
    expect(projects.folder).toBe("mizuki-blog/src/content/projects");
    expect(projects.fields?.map(({ name }) => name)).toEqual([
      "title",
      "description",
      "date",
      "status",
      "tags",
      "featured",
      "cover",
      "repositoryUrl",
      "demoUrl",
      "body",
    ]);
    for (const fieldName of ["repositoryUrl", "demoUrl"]) {
      expect(projects.fields?.find(({ name }) => name === fieldName)?.pattern?.[0])
        .toBe("^https?://\\S+$");
    }
    expectRepositoryPath(projects.folder!);

    const settings = collection("settings");
    expect(settings.media_folder).toBe("/mizuki-blog/src/assets/profile");
    expect(settings.public_folder).toBe("/src/assets/profile");
    expect(settings.files).toHaveLength(1);
    expect(settings.files?.[0]?.file).toBe("mizuki-blog/src/data/profile.json");
    expect(settings.files?.[0]?.fields.map(({ name }) => name)).toEqual([
      "name",
      "siteTitle",
      "description",
      "bio",
      "avatar",
    ]);
    expectRepositoryPath(settings.files![0]!.file);

    const taxonomy = collection("taxonomy");
    expect(taxonomy.files).toHaveLength(1);
    expect(taxonomy.files?.[0]).toMatchObject({
      name: "categories",
      file: "mizuki-blog/src/data/taxonomy.json",
    });
    expect(taxonomy.files?.[0]?.fields.map(({ name }) => name)).toEqual(["categories"]);
    expectRepositoryPath(taxonomy.files![0]!.file);
  });

  it("keeps the editable nickname and avatar in profile data", () => {
    expect(profile.name.trim()).not.toBe("");
    const avatarFilename = profile.avatar.split("/").at(-1);
    expect(avatarFilename).toMatch(/\.(?:avif|gif|jpe?g|png|webp)$/i);
    expectRepositoryPath(`mizuki-blog/src/assets/profile/${avatarFilename}`);

    expect(siteConfig.name).toBe(profile.name);
    expect(siteConfig.author.name).toBe(profile.name);
    expect(siteConfig.author.avatar).toBeTruthy();

    const siteConfigSource = readFileSync(
      resolve(appRoot, "src/config/site.ts"),
      "utf8",
    );
    expect(siteConfigSource).not.toContain(profile.name);
    expect(siteConfigSource).not.toContain(avatarFilename!);
    expect(existsSync(resolve(appRoot, "public/uploads/avatar.jpg"))).toBe(false);
  });

  it("separates production preview from loopback-only authoring", () => {
    const { author, cms, site } = composeConfig.services;

    expect(site.build).toMatchObject({ context: ".", target: "production" });
    expect(site.ports).toEqual(["127.0.0.1:4321:8080"]);
    expect(site.volumes).toBeUndefined();
    expect(site.healthcheck?.test).toContain("http://127.0.0.1:8080/");

    expect(author.profiles).toEqual(["authoring"]);
    expect(author.build).toMatchObject({ context: ".", target: "authoring" });
    expect(author.command).toContain("rm -f .astro/dev.json");
    expect(author.command).not.toContain("--force");
    expect(author.ports).toEqual(["127.0.0.1:4322:4321"]);
    expect(author.volumes).toEqual(["./src:/app/src", "./public:/app/public"]);
    expect(author.environment).toMatchObject({
      CHOKIDAR_USEPOLLING: "true",
      PUBLIC_SITE_URL: "http://127.0.0.1:4322",
    });

    expect(cms.profiles).toEqual(["authoring"]);
    expect(cms.build).toMatchObject({ context: ".", target: "authoring" });
    expect(cms.command).toBe("npm run cms");
    expect(cms.ports).toEqual(["127.0.0.1:8081:8081"]);
    expect(cms.volumes).toEqual([
      "./src/content:/workspace/mizuki-blog/src/content",
      "./src/data:/workspace/mizuki-blog/src/data",
      "./src/assets/profile:/workspace/mizuki-blog/src/assets/profile",
      "./src/assets/uploads:/workspace/mizuki-blog/src/assets/uploads",
    ]);
    expect(cms.environment).toEqual({
      BIND_HOST: "0.0.0.0",
      GIT_REPO_DIRECTORY: "/workspace",
      MODE: "fs",
      ORIGIN: "http://127.0.0.1:4322",
      PORT: "8081",
    });
    expect(author.user).toBe("${LOCAL_UID:-1000}:${LOCAL_GID:-1000}");
    expect(cms.user).toBe(author.user);
  });

  it("builds a static runtime image without local credentials", () => {
    expect(dockerfile).toContain("AS authoring");
    expect(dockerfile).toContain("AS production");
    expect(dockerfile).toContain("rm -f .astro/dev.json");
    expect(dockerfile).not.toContain('"--force"');
    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).toMatch(/ARG PUBLIC_SITE_URL\r?\n/);
    expect(dockerfile).not.toContain("ARG PUBLIC_SITE_URL=http");
    expect(dockerfile).toContain("USER nginx");
    expect(dockerfile).not.toContain("blog_node_modules");

    expect(dockerignore).toContain(".env.*");
    expect(dockerignore).toContain("!.env.example");
    expect(dockerignore).toContain(".npmrc");
  });
});
