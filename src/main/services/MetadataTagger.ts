import NodeID3 from 'node-id3'
import { readFileSync } from 'fs'
import type { GsmtcTrack } from './GsmtcService'

/**
 * Writes ID3v2 tags to an MP3 file.
 * albumArtFile is a local temp path produced by gsmtc.ps1.
 */
export async function writeId3Tags(filePath: string, track: GsmtcTrack): Promise<void> {
  const tags: NodeID3.Tags = {
    title: track.title || undefined,
    artist: track.artist || undefined,
    album: track.album || undefined
  }

  if (track.albumArtFile) {
    try {
      const imageBuffer = readFileSync(track.albumArtFile)
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

  NodeID3.write(tags, filePath)
}
