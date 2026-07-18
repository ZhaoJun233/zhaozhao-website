UPDATE site_settings
SET value_json = json_set(
  value_json,
  '$.email',
  'zhaozhao7991@gmail.com'
),
updated_at = CURRENT_TIMESTAMP
WHERE key = 'profile';
