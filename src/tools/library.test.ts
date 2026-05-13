import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../spotify/client.js", () => ({
  getAuthenticatedClient: vi.fn(),
}));
vi.mock("../spotify/errors.js", () => ({
  handleToolError: vi.fn().mockReturnValue({
    content: [{ type: "text", text: "error" }],
    isError: true,
  }),
}));
vi.mock("../spotify/auth.js", () => ({
  loadTokens: vi.fn(),
  getCredentials: vi.fn(),
  createSpotifyClient: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

import { getAuthenticatedClient } from "../spotify/client.js";
import { handleToolError } from "../spotify/errors.js";
import { loadTokens, refreshAccessToken } from "../spotify/auth.js";
import {
  getSavedTracks,
  getSavedAlbums,
  getFollowedArtists,
  saveTracks,
  removeSavedTracks,
  saveAlbums,
  removeSavedAlbums,
  followArtists,
  unfollowArtists,
} from "./library.js";

describe("library tools", () => {
  let mockClient: any;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockClient = {
      getMySavedTracks: vi.fn(),
      getMySavedAlbums: vi.fn(),
      getFollowedArtists: vi.fn(),
      followArtists: vi.fn(),
      unfollowArtists: vi.fn(),
      getAccessToken: vi.fn().mockReturnValue("test-access-token"),
    };
    vi.mocked(getAuthenticatedClient).mockResolvedValue(mockClient);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedClient).mockResolvedValue(mockClient);
    mockClient.getAccessToken.mockReturnValue("test-access-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Helper for a successful 200-empty-body fetch response
  const ok = () => ({
    status: 200,
    statusText: "OK",
    text: async () => "",
  });

  // Helper for a non-200 fetch response with a JSON error body
  const fail = (status: number, statusText: string, bodyText: string) => ({
    status,
    statusText,
    text: async () => bodyText,
  });

  describe("getSavedTracks", () => {
    it("returns formatted saved tracks", async () => {
      mockClient.getMySavedTracks.mockResolvedValue({
        body: {
          total: 100,
          items: [
            {
              track: {
                name: "Bohemian Rhapsody",
                artists: [{ name: "Queen" }],
                uri: "spotify:track:abc123",
              },
            },
            {
              track: {
                name: "Stairway to Heaven",
                artists: [{ name: "Led Zeppelin" }],
                uri: "spotify:track:def456",
              },
            },
          ],
        },
      });

      const result = await getSavedTracks({});
      const text = result.content[0].text;
      expect(text).toContain("Saved tracks (100 total):");
      expect(text).toContain("1. Bohemian Rhapsody - Queen (spotify:track:abc123)");
      expect(text).toContain("2. Stairway to Heaven - Led Zeppelin (spotify:track:def456)");
    });

    it("uses offset for numbering", async () => {
      mockClient.getMySavedTracks.mockResolvedValue({
        body: {
          total: 50,
          items: [
            {
              track: {
                name: "Song",
                artists: [{ name: "Artist" }],
                uri: "spotify:track:xyz",
              },
            },
          ],
        },
      });

      const result = await getSavedTracks({ offset: 10 });
      expect(result.content[0].text).toContain("11. Song");
    });

    it("returns message when no saved tracks", async () => {
      mockClient.getMySavedTracks.mockResolvedValue({
        body: { total: 0, items: [] },
      });

      const result = await getSavedTracks({});
      expect(result.content[0].text).toBe("No saved tracks found");
    });

    it("calls handleToolError on API failure", async () => {
      const error = new Error("API fail");
      mockClient.getMySavedTracks.mockRejectedValue(error);
      const result = await getSavedTracks({});
      expect(handleToolError).toHaveBeenCalledWith(error, "spotify_get_saved_tracks");
      expect(result.isError).toBe(true);
    });
  });

  describe("getSavedAlbums", () => {
    it("returns formatted saved albums", async () => {
      mockClient.getMySavedAlbums.mockResolvedValue({
        body: {
          total: 25,
          items: [
            {
              album: {
                name: "A Night at the Opera",
                artists: [{ name: "Queen" }],
                uri: "spotify:album:abc123",
              },
            },
          ],
        },
      });

      const result = await getSavedAlbums({});
      const text = result.content[0].text;
      expect(text).toContain("Saved albums (25 total):");
      expect(text).toContain("1. A Night at the Opera - Queen (spotify:album:abc123)");
    });

    it("returns message when no saved albums", async () => {
      mockClient.getMySavedAlbums.mockResolvedValue({
        body: { total: 0, items: [] },
      });

      const result = await getSavedAlbums({});
      expect(result.content[0].text).toBe("No saved albums found");
    });

    it("calls handleToolError on API failure", async () => {
      const error = new Error("API fail");
      mockClient.getMySavedAlbums.mockRejectedValue(error);
      const result = await getSavedAlbums({});
      expect(handleToolError).toHaveBeenCalledWith(error, "spotify_get_saved_albums");
      expect(result.isError).toBe(true);
    });
  });

  describe("getFollowedArtists", () => {
    it("returns formatted followed artists with genres", async () => {
      mockClient.getFollowedArtists.mockResolvedValue({
        body: {
          artists: {
            items: [
              {
                name: "Queen",
                genres: ["rock", "classic rock", "glam rock"],
                uri: "spotify:artist:abc123",
              },
              {
                name: "Radiohead",
                genres: [],
                uri: "spotify:artist:def456",
              },
            ],
            cursors: { after: null },
          },
        },
      });

      const result = await getFollowedArtists({});
      const text = result.content[0].text;
      expect(text).toContain("Followed artists:");
      expect(text).toContain("1. Queen (rock, classic rock) (spotify:artist:abc123)");
      expect(text).toContain("2. Radiohead (spotify:artist:def456)");
      expect(text).not.toContain("More artists available");
    });

    it("shows pagination cursor when more results available", async () => {
      mockClient.getFollowedArtists.mockResolvedValue({
        body: {
          artists: {
            items: [{ name: "Artist", genres: [], uri: "spotify:artist:abc" }],
            cursors: { after: "next_cursor_id" },
          },
        },
      });

      const result = await getFollowedArtists({});
      expect(result.content[0].text).toContain('after: "next_cursor_id"');
    });

    it("passes after parameter for pagination", async () => {
      mockClient.getFollowedArtists.mockResolvedValue({
        body: {
          artists: {
            items: [{ name: "Artist", genres: [], uri: "spotify:artist:abc" }],
            cursors: { after: null },
          },
        },
      });

      await getFollowedArtists({ after: "some_cursor" });
      expect(mockClient.getFollowedArtists).toHaveBeenCalledWith({
        limit: 20,
        after: "some_cursor",
      });
    });

    it("returns message when no followed artists", async () => {
      mockClient.getFollowedArtists.mockResolvedValue({
        body: {
          artists: { items: [], cursors: { after: null } },
        },
      });

      const result = await getFollowedArtists({});
      expect(result.content[0].text).toBe("No followed artists found");
    });

    it("calls handleToolError on API failure", async () => {
      const error = new Error("API fail");
      mockClient.getFollowedArtists.mockRejectedValue(error);
      const result = await getFollowedArtists({});
      expect(handleToolError).toHaveBeenCalledWith(error, "spotify_get_followed_artists");
      expect(result.isError).toBe(true);
    });
  });

  describe("saveTracks", () => {
    it("PUTs track URIs to /v1/me/library and returns confirmation", async () => {
      fetchMock.mockResolvedValueOnce(ok());

      const result = await saveTracks({ track_ids: ["id1", "id2"] });

      expect(result.content[0].text).toBe("Saved 2 track(s) to your library");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.spotify.com/v1/me/library?uris=spotify%3Atrack%3Aid1%2Cspotify%3Atrack%3Aid2",
      );
      expect(init.method).toBe("PUT");
      expect(init.headers.Authorization).toBe("Bearer test-access-token");
    });

    it("surfaces Spotify error body on non-200 response", async () => {
      fetchMock.mockResolvedValueOnce(
        fail(403, "Forbidden", '{"error":{"status":403,"message":"Insufficient scope"}}'),
      );

      const result = await saveTracks({ track_ids: ["id1"] });

      expect(result.isError).toBe(true);
      const errorArg = vi.mocked(handleToolError).mock.calls[0][0] as any;
      expect(errorArg.message).toContain("403");
      expect(errorArg.message).toContain("Insufficient scope");
      expect(errorArg.statusCode).toBe(403);
    });

    it("refreshes token and retries once on 401", async () => {
      fetchMock.mockResolvedValueOnce(fail(401, "Unauthorized", "")).mockResolvedValueOnce(ok());
      vi.mocked(loadTokens).mockResolvedValue({
        accessToken: "old",
        refreshToken: "refresh",
        expiresAt: 0,
      });
      vi.mocked(refreshAccessToken).mockResolvedValue({
        accessToken: "new-token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3_600_000,
      });

      const result = await saveTracks({ track_ids: ["id1"] });

      expect(result.content[0].text).toBe("Saved 1 track(s) to your library");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer new-token");
    });

    it("rejects batches larger than 40 IDs", async () => {
      const ids = Array.from({ length: 41 }, (_, i) => `id${i}`);
      const result = await saveTracks({ track_ids: ids });
      expect(result.isError).toBe(true);
      const errorArg = vi.mocked(handleToolError).mock.calls[0][0] as any;
      expect(errorArg.message).toContain("exceeds maximum size of 40");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("removeSavedTracks", () => {
    it("DELETEs track URIs from /v1/me/library and returns confirmation", async () => {
      fetchMock.mockResolvedValueOnce(ok());

      const result = await removeSavedTracks({ track_ids: ["id1", "id2", "id3"] });

      expect(result.content[0].text).toBe("Removed 3 track(s) from your library");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.spotify.com/v1/me/library?uris=spotify%3Atrack%3Aid1%2Cspotify%3Atrack%3Aid2%2Cspotify%3Atrack%3Aid3",
      );
      expect(init.method).toBe("DELETE");
    });

    it("calls handleToolError on non-200 response", async () => {
      fetchMock.mockResolvedValueOnce(fail(500, "Server Error", ""));
      const result = await removeSavedTracks({ track_ids: ["id1"] });
      expect(handleToolError).toHaveBeenCalled();
      const [errorArg, toolName] = vi.mocked(handleToolError).mock.calls[0] as any;
      expect(toolName).toBe("spotify_remove_saved_tracks");
      expect(errorArg.statusCode).toBe(500);
      expect(result.isError).toBe(true);
    });
  });

  describe("saveAlbums", () => {
    it("PUTs album URIs to /v1/me/library and returns confirmation", async () => {
      fetchMock.mockResolvedValueOnce(ok());

      const result = await saveAlbums({ album_ids: ["album1"] });

      expect(result.content[0].text).toBe("Saved 1 album(s) to your library");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.spotify.com/v1/me/library?uris=spotify%3Aalbum%3Aalbum1");
      expect(init.method).toBe("PUT");
    });

    it("calls handleToolError on non-200 response", async () => {
      fetchMock.mockResolvedValueOnce(fail(400, "Bad Request", '{"error":"bad uri"}'));
      const result = await saveAlbums({ album_ids: ["album1"] });
      expect(handleToolError).toHaveBeenCalled();
      const [, toolName] = vi.mocked(handleToolError).mock.calls[0] as any;
      expect(toolName).toBe("spotify_save_albums");
      expect(result.isError).toBe(true);
    });
  });

  describe("removeSavedAlbums", () => {
    it("DELETEs album URIs from /v1/me/library and returns confirmation", async () => {
      fetchMock.mockResolvedValueOnce(ok());

      const result = await removeSavedAlbums({ album_ids: ["album1", "album2"] });

      expect(result.content[0].text).toBe("Removed 2 album(s) from your library");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.spotify.com/v1/me/library?uris=spotify%3Aalbum%3Aalbum1%2Cspotify%3Aalbum%3Aalbum2",
      );
      expect(init.method).toBe("DELETE");
    });

    it("calls handleToolError on non-200 response", async () => {
      fetchMock.mockResolvedValueOnce(fail(403, "Forbidden", ""));
      const result = await removeSavedAlbums({ album_ids: ["album1"] });
      expect(handleToolError).toHaveBeenCalled();
      const [, toolName] = vi.mocked(handleToolError).mock.calls[0] as any;
      expect(toolName).toBe("spotify_remove_saved_albums");
      expect(result.isError).toBe(true);
    });
  });

  describe("followArtists", () => {
    it("follows artists and returns confirmation", async () => {
      mockClient.followArtists.mockResolvedValue({});

      const result = await followArtists({ artist_ids: ["artist1", "artist2"] });
      expect(result.content[0].text).toBe("Now following 2 artist(s)");
      expect(mockClient.followArtists).toHaveBeenCalledWith(["artist1", "artist2"]);
    });

    it("calls handleToolError on API failure", async () => {
      const error = new Error("API fail");
      mockClient.followArtists.mockRejectedValue(error);
      const result = await followArtists({ artist_ids: ["artist1"] });
      expect(handleToolError).toHaveBeenCalledWith(error, "spotify_follow_artists");
      expect(result.isError).toBe(true);
    });
  });

  describe("unfollowArtists", () => {
    it("unfollows artists and returns confirmation", async () => {
      mockClient.unfollowArtists.mockResolvedValue({});

      const result = await unfollowArtists({ artist_ids: ["artist1"] });
      expect(result.content[0].text).toBe("Unfollowed 1 artist(s)");
      expect(mockClient.unfollowArtists).toHaveBeenCalledWith(["artist1"]);
    });

    it("calls handleToolError on API failure", async () => {
      const error = new Error("API fail");
      mockClient.unfollowArtists.mockRejectedValue(error);
      const result = await unfollowArtists({ artist_ids: ["artist1"] });
      expect(handleToolError).toHaveBeenCalledWith(error, "spotify_unfollow_artists");
      expect(result.isError).toBe(true);
    });
  });
});
