/**
 * Library management tools (saved tracks, albums, followed artists)
 */

import { getAuthenticatedClient } from "../spotify/client.js";
import {
  loadTokens,
  getCredentials,
  createSpotifyClient,
  refreshAccessToken,
} from "../spotify/auth.js";
import { handleToolError } from "../spotify/errors.js";
import { validateArraySize } from "../utils/validation.js";
import { logger } from "../utils/logger.js";
import type {
  ToolResponse,
  GetSavedTracksArgs,
  GetSavedAlbumsArgs,
  GetFollowedArtistsArgs,
  SaveTracksArgs,
  SaveAlbumsArgs,
  FollowArtistsArgs,
} from "../types.js";

const LIBRARY_ENDPOINT = "https://api.spotify.com/v1/me/library";
const MAX_LIBRARY_URIS = 40;

/**
 * Call Spotify's unified library endpoint. Since February 2026 the separate
 * /v1/me/tracks and /v1/me/albums endpoints were collapsed into this one,
 * keyed by URI rather than path. spotify-web-api-node has not been updated,
 * so we go to fetch directly here.
 */
async function callLibrary(method: "PUT" | "DELETE", uris: string[]): Promise<void> {
  const client = await getAuthenticatedClient();
  let accessToken = client.getAccessToken();
  const url = `${LIBRARY_ENDPOINT}?uris=${encodeURIComponent(uris.join(","))}`;

  const send = (token: string | undefined) =>
    fetch(url, { method, headers: { Authorization: `Bearer ${token ?? ""}` } });

  let response = await send(accessToken);

  if (response.status === 401) {
    logger.info("Library endpoint returned 401; refreshing token and retrying once");
    const tokens = await loadTokens();
    if (tokens) {
      const refreshed = await refreshAccessToken(
        createSpotifyClient(getCredentials()),
        tokens.refreshToken,
      );
      accessToken = refreshed.accessToken;
      response = await send(accessToken);
    }
  }

  if (response.status === 200) return;

  const body = await response.text().catch(() => "");
  const err: any = new Error(
    `Spotify ${method} /v1/me/library failed: ${response.status} ${response.statusText}` +
      (body ? ` — ${body}` : ""),
  );
  err.statusCode = response.status;
  err.body = body;
  throw err;
}

export async function getSavedTracks(args: GetSavedTracksArgs): Promise<ToolResponse> {
  try {
    const client = await getAuthenticatedClient();
    const limit = args.limit || 20;
    const offset = args.offset || 0;

    const result: any = await client.getMySavedTracks({ limit, offset });
    const items = result.body?.items ?? [];

    if (items.length === 0) {
      return {
        content: [{ type: "text", text: "No saved tracks found" }],
      };
    }

    const formatted = items.map((item: any, index: number) => {
      const track = item?.track;
      if (!track) return `${offset + index + 1}. [Unknown track]`;
      const artists = track.artists?.map((a: any) => a.name).join(", ") ?? "Unknown artist";
      return `${offset + index + 1}. ${track.name} - ${artists} (${track.uri})`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Saved tracks (${result.body.total} total):\n\n${formatted.join("\n")}`,
        },
      ],
    };
  } catch (error) {
    return handleToolError(error, "spotify_get_saved_tracks");
  }
}

export async function getSavedAlbums(args: GetSavedAlbumsArgs): Promise<ToolResponse> {
  try {
    const client = await getAuthenticatedClient();
    const limit = args.limit || 20;
    const offset = args.offset || 0;

    const result: any = await client.getMySavedAlbums({ limit, offset });
    const items = result.body?.items ?? [];

    if (items.length === 0) {
      return {
        content: [{ type: "text", text: "No saved albums found" }],
      };
    }

    const formatted = items.map((item: any, index: number) => {
      const album = item?.album;
      if (!album) return `${offset + index + 1}. [Unknown album]`;
      const artists = album.artists?.map((a: any) => a.name).join(", ") ?? "Unknown artist";
      return `${offset + index + 1}. ${album.name} - ${artists} (${album.uri})`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Saved albums (${result.body.total} total):\n\n${formatted.join("\n")}`,
        },
      ],
    };
  } catch (error) {
    return handleToolError(error, "spotify_get_saved_albums");
  }
}

export async function getFollowedArtists(args: GetFollowedArtistsArgs): Promise<ToolResponse> {
  try {
    const client = await getAuthenticatedClient();
    const limit = args.limit || 20;

    const options: any = { limit };
    if (args.after) {
      options.after = args.after;
    }

    const result: any = await client.getFollowedArtists(options);
    const artists = result.body?.artists;
    const items = artists?.items ?? [];

    if (items.length === 0) {
      return {
        content: [{ type: "text", text: "No followed artists found" }],
      };
    }

    const formatted = items.map((artist: any, index: number) => {
      const genreList = artist.genres ?? [];
      const genres = genreList.length > 0 ? ` (${genreList.slice(0, 2).join(", ")})` : "";
      return `${index + 1}. ${artist.name}${genres} (${artist.uri})`;
    });

    const nextCursor = artists?.cursors?.after;
    const cursorNote = nextCursor
      ? `\n\nMore artists available. Use after: "${nextCursor}" to see the next page.`
      : "";

    return {
      content: [
        {
          type: "text",
          text: `Followed artists:\n\n${formatted.join("\n")}${cursorNote}`,
        },
      ],
    };
  } catch (error) {
    return handleToolError(error, "spotify_get_followed_artists");
  }
}

export async function saveTracks(args: SaveTracksArgs): Promise<ToolResponse> {
  try {
    validateArraySize(args.track_ids, MAX_LIBRARY_URIS, "track_ids");
    await callLibrary(
      "PUT",
      args.track_ids.map((id) => `spotify:track:${id}`),
    );
    return {
      content: [
        {
          type: "text",
          text: `Saved ${args.track_ids.length} track(s) to your library`,
        },
      ],
    };
  } catch (error) {
    return handleToolError(error, "spotify_save_tracks");
  }
}

export async function removeSavedTracks(args: SaveTracksArgs): Promise<ToolResponse> {
  try {
    validateArraySize(args.track_ids, MAX_LIBRARY_URIS, "track_ids");
    await callLibrary(
      "DELETE",
      args.track_ids.map((id) => `spotify:track:${id}`),
    );
    return {
      content: [
        {
          type: "text",
          text: `Removed ${args.track_ids.length} track(s) from your library`,
        },
      ],
    };
  } catch (error) {
    return handleToolError(error, "spotify_remove_saved_tracks");
  }
}

export async function saveAlbums(args: SaveAlbumsArgs): Promise<ToolResponse> {
  try {
    validateArraySize(args.album_ids, MAX_LIBRARY_URIS, "album_ids");
    await callLibrary(
      "PUT",
      args.album_ids.map((id) => `spotify:album:${id}`),
    );
    return {
      content: [
        {
          type: "text",
          text: `Saved ${args.album_ids.length} album(s) to your library`,
        },
      ],
    };
  } catch (error) {
    return handleToolError(error, "spotify_save_albums");
  }
}

export async function removeSavedAlbums(args: SaveAlbumsArgs): Promise<ToolResponse> {
  try {
    validateArraySize(args.album_ids, MAX_LIBRARY_URIS, "album_ids");
    await callLibrary(
      "DELETE",
      args.album_ids.map((id) => `spotify:album:${id}`),
    );
    return {
      content: [
        {
          type: "text",
          text: `Removed ${args.album_ids.length} album(s) from your library`,
        },
      ],
    };
  } catch (error) {
    return handleToolError(error, "spotify_remove_saved_albums");
  }
}

export async function followArtists(args: FollowArtistsArgs): Promise<ToolResponse> {
  try {
    validateArraySize(args.artist_ids, 50, "artist_ids");

    const client = await getAuthenticatedClient();
    await client.followArtists(args.artist_ids);

    return {
      content: [
        {
          type: "text",
          text: `Now following ${args.artist_ids.length} artist(s)`,
        },
      ],
    };
  } catch (error) {
    return handleToolError(error, "spotify_follow_artists");
  }
}

export async function unfollowArtists(args: FollowArtistsArgs): Promise<ToolResponse> {
  try {
    validateArraySize(args.artist_ids, 50, "artist_ids");

    const client = await getAuthenticatedClient();
    await client.unfollowArtists(args.artist_ids);

    return {
      content: [
        {
          type: "text",
          text: `Unfollowed ${args.artist_ids.length} artist(s)`,
        },
      ],
    };
  } catch (error) {
    return handleToolError(error, "spotify_unfollow_artists");
  }
}
