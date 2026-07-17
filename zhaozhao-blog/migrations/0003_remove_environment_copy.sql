UPDATE site_settings
SET value_json = json_set(
  value_json,
  '$.footer.note',
  'Made beside the sea.'
),
updated_at = '2026-07-17T08:00:00.000Z'
WHERE key = 'navigation';

UPDATE site_settings
SET value_json = json_set(
  value_json,
  '$.workbench.description',
  '工具的价值在于减少写作和维护之间的摩擦。这个站点保持轻量、可读与稳定，让后台保存后的内容及时更新。',
  '$.timeline.entries[2].title',
  '接入内容管理后台',
  '$.timeline.entries[2].description',
  '将文章、项目、分类、页面设置和友链迁移到统一管理后台。'
),
updated_at = '2026-07-17T08:00:00.000Z'
WHERE key = 'about';
