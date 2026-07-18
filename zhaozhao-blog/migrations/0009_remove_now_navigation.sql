UPDATE site_settings
SET value_json = json_set(
      value_json,
      '$.items',
      json(COALESCE(
        (
          SELECT json_group_array(json(item.value))
          FROM json_each(site_settings.value_json, '$.items') AS item
          WHERE json_extract(item.value, '$.href') <> '/now/'
        ),
        '[]'
      ))
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'navigation'
  AND EXISTS (
    SELECT 1
    FROM json_each(site_settings.value_json, '$.items') AS item
    WHERE json_extract(item.value, '$.href') = '/now/'
  );
