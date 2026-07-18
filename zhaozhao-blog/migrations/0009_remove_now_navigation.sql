UPDATE site_settings
SET value_json = json_set(
      value_json,
      '$.items',
      json(COALESCE(
        NULLIF((
          SELECT json_group_array(json(filtered.value))
          FROM (
            SELECT item.value
            FROM json_each(site_settings.value_json, '$.items') AS item
            WHERE json_extract(item.value, '$.href') <> '/now/'
            ORDER BY CAST(item.key AS INTEGER)
          ) AS filtered
        ), '[]'),
        '[{"label":"首页","href":"/"}]'
      ))
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'navigation'
  AND EXISTS (
    SELECT 1
    FROM json_each(site_settings.value_json, '$.items') AS item
    WHERE json_extract(item.value, '$.href') = '/now/'
  );
