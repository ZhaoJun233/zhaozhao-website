import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { siteConfig } from "../../src/config/site";
import profile from "../../src/data/profile.json";

type CmsField = { name: string; pattern?: string[] };
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
  expect(absolutePath.startsWith(`${repositoryRoot}${sep}`)).toBe(true);
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
    expect(settings.media_folder).toBe("mizuki-blog/src/assets/profile");
    expect(settings.public_folder).toBe("../assets/profile");
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
  });

  it("keeps the editable nickname and avatar in profile data", () => {
    expect(profile.name).toBe("233昭");
    expect(profile.avatar).toBe("../assets/profile/avatar.jpg");
    expectRepositoryPath("mizuki-blog/src/assets/profile/avatar.jpg");

    expect(siteConfig.name).toBe(profile.name);
    expect(siteConfig.author.name).toBe(profile.name);
    expect(siteConfig.author.avatar).toBeTruthy();

    const siteConfigSource = readFileSync(
      resolve(appRoot, "src/config/site.ts"),
      "utf8",
    );
    expect(siteConfigSource).not.toContain(profile.name);
    expect(siteConfigSource).not.toContain("avatar.jpg");
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
    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).toContain("ARG PUBLIC_SITE_URL\n");
    expect(dockerfile).not.toContain("ARG PUBLIC_SITE_URL=http");
    expect(dockerfile).toContain("USER nginx");
    expect(dockerfile).not.toContain("blog_node_modules");

    expect(dockerignore).toContain(".env.*");
    expect(dockerignore).toContain("!.env.example");
    expect(dockerignore).toContain(".npmrc");
  });
});
