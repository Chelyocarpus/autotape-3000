import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Select, SelectContent, SelectTrigger, SelectValue } from './ui/select'
import { DeviceSelectItems } from './DeviceSelectItems'
import type { AudioDevice } from '../types'

function renderItems(devices: AudioDevice[]) {
  render(
    <Select defaultOpen>
      <SelectTrigger>
        <SelectValue placeholder="Select a device…" />
      </SelectTrigger>
      <SelectContent>
        <DeviceSelectItems devices={devices} />
      </SelectContent>
    </Select>
  )
}

const cable: AudioDevice = { id: '1', name: 'VB-Audio Virtual Cable' }
const mic: AudioDevice = { id: '2', name: 'Microphone (Realtek)' }
const speakers: AudioDevice = { id: '3', name: 'Speakers (Realtek)' }

describe('DeviceSelectItems', () => {
  it('groups loopback devices under "Recommended" and the rest under "Other devices"', () => {
    renderItems([mic, cable, speakers])

    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByText('Other devices')).toBeInTheDocument()
    expect(screen.getByText('VB-Audio Virtual Cable')).toBeInTheDocument()
    expect(screen.getByText('Microphone (Realtek)')).toBeInTheDocument()
    expect(screen.getByText('Speakers (Realtek)')).toBeInTheDocument()
  })

  it('still labels the group "Recommended" but omits "Other devices" when every device is a loopback device', () => {
    renderItems([cable])

    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.queryByText('Other devices')).not.toBeInTheDocument()
    expect(screen.getByText('VB-Audio Virtual Cable')).toBeInTheDocument()
  })

  it('omits the "Recommended" header entirely when no loopback device is present', () => {
    renderItems([mic, speakers])

    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
    expect(screen.queryByText('Other devices')).not.toBeInTheDocument()
    expect(screen.getByText('Microphone (Realtek)')).toBeInTheDocument()
    expect(screen.getByText('Speakers (Realtek)')).toBeInTheDocument()
  })
})
