import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson, AdminHttpError } from "../../../../lib/admin/http";
import { settingSchemas, type SettingKey } from "../../../../lib/admin/schemas";
import { getSetting, updateSetting } from "../../../../lib/database/admin-repository";

function settingKey(value: string | undefined): SettingKey {
  if (!value || !(value in settingSchemas)) throw new AdminHttpError(404, "页面设置不存在。" );
  return value as SettingKey;
}

export const GET: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  (database) => getSetting(database, settingKey(params.key)),
);
export const PUT: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => updateSetting(database, settingKey(params.key), await readAdminJson(request)),
);
