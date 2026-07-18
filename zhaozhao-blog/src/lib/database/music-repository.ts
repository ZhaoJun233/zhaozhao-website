import { randomUUID } from "node:crypto";
import {
  musicTrackInputSchema,
  type MusicTrackInput,
} from "../admin/schemas";
import { AdminConflictError, AdminNotFoundError } from "../admin/errors";
import { mediaUrlFromKey } from "../admin/post-images";
import type { MusicTrackRow } from "./types";

interface MusicTrackJoinedRow extends MusicTrackRow {
  cover_key: string | null;
}

interface CoverAssetRow {
  id: string;
  state: "uploading" | "ready" | "pending_delete";
  draft_token: string | null;
}

export interface AdminMusicTrack {
  id: string;
  title: string;
  artist: string;
  neteaseSongId: string;
  audioUrl?: string;
  coverAssetId?: string;
  coverUrl?: string;
  note?: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  embedUrl: string;
  neteaseUrl: string;
}

function primary(database: D1Database): D1DatabaseSession {
  return database.withSession("first-primary");
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint failed|SQLITE_CONSTRAINT/i.test(error.message);
}

export function neteaseSongUrl(songId: string): string {
  return `https://music.163.com/#/song?id=${encodeURIComponent(songId)}`;
}

export function neteaseEmbedUrl(songId: string): string {
  return `https://music.163.com/outchain/player?type=2&id=${encodeURIComponent(songId)}&auto=0&height=66`;
}

function trackFromRow(row: MusicTrackJoinedRow): AdminMusicTrack {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    neteaseSongId: row.netease_song_id,
    ...(row.audio_url ? { audioUrl: row.audio_url } : {}),
    ...(row.cover_asset_id ? { coverAssetId: row.cover_asset_id } : {}),
    ...(row.cover_key ? { coverUrl: mediaUrlFromKey(row.cover_key) } : {}),
    ...(row.note ? { note: row.note } : {}),
    sortOrder: Number(row.sort_order),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    embedUrl: neteaseEmbedUrl(row.netease_song_id),
    neteaseUrl: neteaseSongUrl(row.netease_song_id),
  };
}

const selectTracks = `SELECT track.*, asset.kv_key AS cover_key
  FROM music_tracks track
  LEFT JOIN media_assets asset ON asset.id = track.cover_asset_id`;

export async function listMusicTracks(database: D1Database): Promise<AdminMusicTrack[]> {
  const { results } = await primary(database).prepare(
    `${selectTracks} ORDER BY track.sort_order, track.title`,
  ).all<MusicTrackJoinedRow>();
  return results.map(trackFromRow);
}

export async function listEnabledMusicTracks(database: D1Database): Promise<AdminMusicTrack[]> {
  const { results } = await primary(database).prepare(
    `${selectTracks} WHERE track.enabled = 1 ORDER BY track.sort_order, track.title`,
  ).all<MusicTrackJoinedRow>();
  return results.map(trackFromRow);
}

export async function getMusicTrack(database: D1Database, id: string): Promise<AdminMusicTrack> {
  const row = await primary(database).prepare(
    `${selectTracks} WHERE track.id = ?`,
  ).bind(id).first<MusicTrackJoinedRow>();
  if (!row) throw new AdminNotFoundError("歌曲不存在。");
  return trackFromRow(row);
}

async function nextOrder(database: D1DatabaseSession): Promise<number> {
  const row = await database.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM music_tracks",
  ).first<{ value: number }>();
  return Number(row?.value ?? 0);
}

async function resolveCoverAsset(
  database: D1Database,
  coverAssetId: string | undefined,
  draftToken: string | undefined,
): Promise<CoverAssetRow | undefined> {
  if (!coverAssetId) return undefined;
  const row = await primary(database).prepare(
    "SELECT id, state, draft_token FROM media_assets WHERE id = ?",
  ).bind(coverAssetId).first<CoverAssetRow>();
  if (!row) throw new AdminNotFoundError("图片不存在。");
  if (row.state !== "ready") throw new AdminConflictError("图片尚未就绪或正在删除。");
  if (row.draft_token !== null && row.draft_token !== (draftToken ?? null)) {
    throw new AdminConflictError("临时图片不属于当前编辑会话。");
  }
  return row;
}

function queueOrphanedCoverStatements(
  database: D1Database,
  assetId: string | undefined,
  timestamp: string,
): D1PreparedStatement[] {
  if (!assetId) return [];
  return [
    database.prepare(
      `UPDATE media_assets SET state = 'pending_delete'
       WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM post_asset_links WHERE asset_id = ?)
         AND NOT EXISTS (SELECT 1 FROM music_tracks WHERE cover_asset_id = ?)`,
    ).bind(assetId, assetId, assetId),
    database.prepare(
      `INSERT INTO media_cleanup_jobs (asset_id, kv_key, reason, queued_at)
       SELECT id, kv_key, 'manual_remove', ? FROM media_assets
       WHERE id = ? AND state = 'pending_delete'
         AND NOT EXISTS (SELECT 1 FROM post_asset_links WHERE asset_id = ?)
         AND NOT EXISTS (SELECT 1 FROM music_tracks WHERE cover_asset_id = ?)
       ON CONFLICT(asset_id) DO NOTHING`,
    ).bind(timestamp, assetId, assetId, assetId),
  ];
}

export async function createMusicTrack(
  database: D1Database,
  input: MusicTrackInput,
): Promise<AdminMusicTrack> {
  const value = musicTrackInputSchema.parse(input);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const session = primary(database);
  const cover = await resolveCoverAsset(database, value.coverAssetId, value.draftToken);
  try {
    await database.batch([
      session.prepare(
      `INSERT INTO music_tracks
       (id, title, artist, netease_song_id, audio_url, cover_asset_id, note,
        sort_order, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, value.title, value.artist, value.neteaseSongId, value.audioUrl ?? null,
        cover?.id ?? null, value.note ?? null, await nextOrder(session), value.enabled ? 1 : 0,
        timestamp, timestamp),
      ...(cover && value.draftToken ? [database.prepare(
        `UPDATE media_assets SET draft_token = NULL
         WHERE id = ? AND draft_token = ? AND state = 'ready'`,
      ).bind(cover.id, value.draftToken)] : []),
    ]);
  } catch (error) {
    if (isConstraintError(error)) {
      throw new AdminConflictError("该网易云歌曲已经存在。");
    }
    throw error;
  }
  return getMusicTrack(database, id);
}

export async function updateMusicTrack(
  database: D1Database,
  id: string,
  input: MusicTrackInput,
): Promise<AdminMusicTrack> {
  const current = await getMusicTrack(database, id);
  const value = musicTrackInputSchema.parse(input);
  const cover = await resolveCoverAsset(database, value.coverAssetId, value.draftToken);
  const timestamp = new Date().toISOString();
  const replacedCoverId = current.coverAssetId !== cover?.id ? current.coverAssetId : undefined;
  try {
    await database.batch([
      database.prepare(
        `UPDATE music_tracks SET title = ?, artist = ?, netease_song_id = ?,
         audio_url = ?, cover_asset_id = ?, note = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      ).bind(value.title, value.artist, value.neteaseSongId, value.audioUrl ?? null,
        cover?.id ?? null, value.note ?? null, value.enabled ? 1 : 0, timestamp, id),
      ...(cover && value.draftToken ? [database.prepare(
        `UPDATE media_assets SET draft_token = NULL
         WHERE id = ? AND draft_token = ? AND state = 'ready'`,
      ).bind(cover.id, value.draftToken)] : []),
      ...queueOrphanedCoverStatements(database, replacedCoverId, timestamp),
    ]);
  } catch (error) {
    if (isConstraintError(error)) {
      throw new AdminConflictError("该网易云歌曲已经存在。");
    }
    throw error;
  }
  return getMusicTrack(database, id);
}

export async function deleteMusicTrack(database: D1Database, id: string): Promise<void> {
  const current = await getMusicTrack(database, id);
  const timestamp = new Date().toISOString();
  const results = await database.batch([
    database.prepare("DELETE FROM music_tracks WHERE id = ?").bind(id),
    ...queueOrphanedCoverStatements(database, current.coverAssetId, timestamp),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0) throw new AdminNotFoundError("歌曲不存在。");
}

export async function orderMusicTracks(
  database: D1Database,
  ids: string[],
): Promise<AdminMusicTrack[]> {
  const current = (await listMusicTracks(database)).map(({ id }) => id).sort();
  if (ids.length !== current.length || [...ids].sort().some((id, index) => id !== current[index])) {
    throw new AdminConflictError("排序列表必须包含全部歌曲。");
  }
  await database.batch(ids.map((id, index) => database.prepare(
    "UPDATE music_tracks SET sort_order = ?, updated_at = ? WHERE id = ?",
  ).bind(index, new Date().toISOString(), id)));
  return listMusicTracks(database);
}
