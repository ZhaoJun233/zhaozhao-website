import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type NavigationSetting = {
  items: Array<{ label: string; href: string }>;
  mobile: Record<string, string>;
  footer: Record<string, string>;
};

const migration = env.TEST_MIGRATIONS.find(
  ({ name }) => name === "0009_remove_now_navigation.sql",
);

async function applyMigration(): Promise<void> {
  if (!migration) throw new Error("0009_remove_now_navigation.sql migration is missing");

  await env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)));
}

async function readNavigation(): Promise<NavigationSetting> {
  const stored = await env.DB.prepare(
    "SELECT value_json FROM site_settings WHERE key = 'navigation'",
  ).first<{ value_json: string }>();

  return JSON.parse(stored!.value_json) as NavigationSetting;
}

async function migrateNavigation(value: NavigationSetting): Promise<NavigationSetting> {
  await env.DB.prepare("UPDATE site_settings SET value_json = ? WHERE key = 'navigation'")
    .bind(JSON.stringify(value))
    .run();
  await applyMigration();

  return readNavigation();
}

describe("remove-now navigation migration", () => {
  it("orders filtered navigation items by their json_each array index before aggregation", () => {
    const sql = migration?.queries.join("\n") ?? "";

    expect(sql).toMatch(
      /FROM\s+\(\s*SELECT\s+item\.value\s+FROM\s+json_each[\s\S]*?ORDER\s+BY\s+CAST\(item\.key\s+AS\s+INTEGER\)\s*\)\s+AS\s+filtered/i,
    );
  });

  it("falls back to the home link when /now/ is the only navigation item", async () => {
    const result = await migrateNavigation({
      items: [{ label: "此刻", href: "/now/" }],
      mobile: { title: "导航" },
      footer: { note: "页脚" },
    });

    expect(result.items).toEqual([{ label: "首页", href: "/" }]);
  });

  it("preserves custom navigation items and their order", async () => {
    const result = await migrateNavigation({
      items: [
        { label: "项目", href: "/projects/" },
        { label: "此刻", href: "/now/" },
        { label: "自定义", href: "/custom/" },
      ],
      mobile: { title: "导航" },
      footer: { note: "页脚" },
    });

    expect(result.items).toEqual([
      { label: "项目", href: "/projects/" },
      { label: "自定义", href: "/custom/" },
    ]);
  });

  it("is idempotent when executed repeatedly", async () => {
    const first = await migrateNavigation({
      items: [
        { label: "首页", href: "/" },
        { label: "此刻", href: "/now/" },
      ],
      mobile: { title: "导航" },
      footer: { note: "页脚" },
    });

    await applyMigration();

    expect(await readNavigation()).toEqual(first);
  });
});
