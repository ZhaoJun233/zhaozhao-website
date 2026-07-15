import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { siteConfig } from "../../src/config/site";
import profile from "../../src/data/profile.json";

type CmsField = { name: string };
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
  build: { context: string };
  command: string;
  environment?: Record<string, string>;
  ports: string[];
  volumes: string[];
};
type ComposeConfig = {
  services: { blog: ComposeService; cms: ComposeService };
};

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(appRoot, "..");
const adminHtml = readFileSync(resolve(appRoot, "public/admin/index.html"), "utf8");
const cmsConfig = parse(
  readFileSync(resolve(appRoot, "public/admin/config.yml"), "utf8"),
) as CmsConfig;
const composeConfig = parse(
  readFileSync(resolve(appRoot, "docker-compose.yml"), "utf8"),
) as ComposeConfig;

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
  it("serves a pinned Decap app and explicit /admin/ config route", () => {
    expect(adminHtml).toContain('href="/admin/config.yml"');
    expect(adminHtml).toContain('rel="cms-config-url"');
    expect(adminHtml).toContain(
      "https://unpkg.com/decap-cms@3.14.1/dist/decap-cms.js",
    );
    expect(adminHtml).toContain("defer");
    expect(adminHtml).not.toContain(profile.name);
  });

  it("uses repository-root paths and fields that match the Astro schemas", () => {
    expect(cmsConfig.backend).toEqual({ name: "git-gateway", branch: "master" });
    expect(cmsConfig.local_backend).toEqual({
      url: "http://localhost:8081/api/v1",
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

  it("keeps the blog and local proxy on stable Compose routes", () => {
    const { blog, cms } = composeConfig.services;

    expect(blog.build.context).toBe(".");
    expect(blog.ports).toContain("4321:4321");
    expect(blog.volumes).toContain(".:/workspace/mizuki-blog");
    expect(blog.volumes).toContain(
      "blog_node_modules:/workspace/mizuki-blog/node_modules",
    );
    expect(blog.environment).toMatchObject({ CHOKIDAR_USEPOLLING: "true" });

    expect(cms.build.context).toBe(".");
    expect(cms.command).toBe("npm run cms");
    expect(cms.ports).toContain("8081:8081");
    expect(cms.volumes).toContain("..:/workspace");
    expect(cms.volumes).toContain(
      "blog_node_modules:/workspace/mizuki-blog/node_modules",
    );
    expect(cms.environment).toEqual({
      BIND_HOST: "0.0.0.0",
      GIT_REPO_DIRECTORY: "/workspace",
      MODE: "fs",
      PORT: "8081",
    });
  });
});
