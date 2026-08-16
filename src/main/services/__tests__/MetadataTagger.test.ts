import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GsmtcTrack } from '../GsmtcService'

const readFileMock = vi.fn()
vi.mock('fs/promises', () => {
  const readFile = (path: string) => readFileMock(path)
  return { readFile, default: { readFile } }
})

const nodeId3WriteMock = vi.fn().mockResolvedValue(true)
vi.mock('node-id3', () => ({
  default: {
    Promise: {
      write: (tags: unknown, filePath: string) => nodeId3WriteMock(tags, filePath)
    }
  }
}))

import { writeId3Tags } from '../MetadataTagger'

function track(overrides: Partial<GsmtcTrack> = {}): GsmtcTrack {
  return {
    artist: 'Artist',
    title: 'Title',
    album: 'Album',
    albumArtFile: '',
    isPlaying: true,
    ...overrides
  }
}

describe('writeId3Tags', () => {
  beforeEach(() => {
    readFileMock.mockReset()
    nodeId3WriteMock.mockClear()
  })

  it('uses the async NodeID3.Promise.write API, not the sync write, so it never blocks the event loop', async () => {
    await writeId3Tags('C:\\Music\\song.mp3', track())

    expect(nodeId3WriteMock).toHaveBeenCalledTimes(1)
    const [tags, filePath] = nodeId3WriteMock.mock.calls[0]
    expect(filePath).toBe('C:\\Music\\song.mp3')
    expect(tags).toMatchObject({ title: 'Title', artist: 'Artist', album: 'Album' })
  })

  it('reads album art via async readFile (not readFileSync) and embeds it', async () => {
    const imageBuffer = Buffer.from('fake-jpeg-bytes')
    readFileMock.mockResolvedValueOnce(imageBuffer)

    await writeId3Tags('C:\\Music\\song.mp3', track({ albumArtFile: 'C:\\tmp\\art.jpg', albumArtMime: 'image/png' }))

    expect(readFileMock).toHaveBeenCalledWith('C:\\tmp\\art.jpg')
    const [tags] = nodeId3WriteMock.mock.calls[0]
    expect(tags.image).toMatchObject({ mime: 'image/png', imageBuffer })
  })

  it('continues without art (rather than throwing) when the album art file cannot be read', async () => {
    readFileMock.mockRejectedValueOnce(new Error('ENOENT'))

    await expect(
      writeId3Tags('C:\\Music\\song.mp3', track({ albumArtFile: 'C:\\tmp\\missing.jpg' }))
    ).resolves.toBeUndefined()

    const [tags] = nodeId3WriteMock.mock.calls[0]
    expect(tags.image).toBeUndefined()
  })
})
