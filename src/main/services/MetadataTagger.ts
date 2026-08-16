import NodeID3 from 'node-id3'
import { readFile } from 'fs/promises'
import type { GsmtcTrack } from './GsmtcService'

/**
 * Writes ID3v2 tags to an MP3 file.
 * albumArtFile is a local temp path produced by gsmtc.ps1.
 *
 * Uses NodeID3.Promise.write (not the sync NodeID3.write) and async readFile
 * (not readFileSync) so a large embedded cover doesn't block the main process's
 * event loop — see AudioRecorder.ts's _retrimMp3FromSource for the same pattern.
 */
export async function writeId3Tags(filePath: string, track: GsmtcTrack): Promise<void> {
  const tags: NodeID3.Tags = {
    title: track.title || undefined,
    artist: track.artist || undefined,
    album: track.album || undefined
  }

  if (track.albumArtFile) {
    try {
      const imageBuffer = await readFile(track.albumArtFile)
      tags.image = {
        mime: track.albumArtMime || 'image/jpeg',
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer
      }
    } catch {
      // album art read failed — continue without it
    }
  }

  await NodeID3.Promise.write(tags, filePath)
}
