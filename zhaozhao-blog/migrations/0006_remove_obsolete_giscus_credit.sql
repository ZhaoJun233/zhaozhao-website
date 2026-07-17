UPDATE site_settings
SET value_json = json_set(
  json_remove(value_json, '$.libraries.items[3]'),
  '$.description',
  '查看本站插画来源与实际使用的开源依赖。',
  '$.hero.introduction',
  '插画与开源工具共同构成这间网络小屋。这里保留可核对的来源和用途，方便后来维护与替换。'
),
updated_at = CURRENT_TIMESTAMP
WHERE key = 'credits';
