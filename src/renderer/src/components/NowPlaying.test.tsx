import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NowPlaying } from './NowPlaying'
import type { GsmtcTrack } from '../types'

const idleTrack: GsmtcTrack = {
  artist: '', title: '', album: '', albumArtFile: '', isPlaying: false
}

const playingTrack: GsmtcTrack = {
  artist: 'Daft Punk',
  title: 'One More Time',
  album: 'Discovery',
  albumArtFile: 'C:\\art\\cover.jpg',
  albumArtMime: 'image/jpeg',
  sourceAppId: 'Spotify.exe',
  positionMs: 42_000,
  isPlaying: true
}

describe('NowPlaying', () => {
  it('shows a placeholder when nothing is playing (idle state)', () => {
    render(<NowPlaying track={idleTrack} />)
    expect(screen.getByText(/nothing playing/i)).toBeInTheDocument()
    expect(screen.getByText(/paused/i)).toBeInTheDocument()
  })

  it('renders track metadata and artwork when a track is actively playing (horizontal layout)', () => {
    render(<NowPlaying track={playingTrack} />)
    expect(screen.getByText('One More Time')).toBeInTheDocument()
    expect(screen.getByText('Daft Punk')).toBeInTheDocument()
    expect(screen.getByText('Discovery')).toBeInTheDocument()
    expect(screen.getByText(/^playing$/i)).toBeInTheDocument()
    expect(screen.getByAltText('Album art')).toHaveAttribute(
      'src',
      expect.stringContaining('autotape-art://image?path=')
    )
  })

  it('renders the same active state in the vertical layout used by the sidebar', () => {
    render(<NowPlaying track={playingTrack} layout="vertical" />)
    expect(screen.getByText('One More Time')).toBeInTheDocument()
    expect(screen.getByAltText('Album art')).toBeInTheDocument()
  })
})
