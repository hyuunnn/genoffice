import { describe, expect, it } from 'vitest'
import {
  HWP_RE,
  HML_UNAVAILABLE,
  bytesForSaveFormat,
  ensureHwpSavePath,
  saveFormatForPath,
} from '../src/shared/formats'

describe('HWP_RE', () => {
  it('matches rhwp formats case-insensitively', () => {
    expect(HWP_RE.test('/tmp/a.hwp')).toBe(true)
    expect(HWP_RE.test('/tmp/a.HWPX')).toBe(true)
    expect(HWP_RE.test('C:\\docs\\form.Hml')).toBe(true)
  })

  it('rejects other office formats', () => {
    expect(HWP_RE.test('/tmp/a.docx')).toBe(false)
    expect(HWP_RE.test('/tmp/a.hwt')).toBe(false)
    expect(HWP_RE.test('/tmp/a.hwp.bak')).toBe(false)
  })
})

describe('save path helpers', () => {
  it('defaults untitled dialog paths to .hwp', () => {
    expect(ensureHwpSavePath('/tmp/note')).toBe('/tmp/note.hwp')
    expect(ensureHwpSavePath('/tmp/note.hwpx')).toBe('/tmp/note.hwpx')
  })

  it('picks export bytes from the save extension', () => {
    const payload = {
      hwp: new Uint8Array([1]),
      hwpx: new Uint8Array([2]),
      hml: new Uint8Array([3]),
    }
    expect(saveFormatForPath('a.HWPX')).toBe('hwpx')
    expect(bytesForSaveFormat('hwp', payload)).toBe(payload.hwp)
    expect(bytesForSaveFormat('hwpx', payload)).toBe(payload.hwpx)
    expect(bytesForSaveFormat('hml', payload)).toBe(payload.hml)
  })

  it('throws when HML bytes are missing', () => {
    const payload = { hwp: new Uint8Array([1]), hwpx: new Uint8Array([2]) }
    expect(() => bytesForSaveFormat('hml', payload)).toThrow(HML_UNAVAILABLE)
  })
})
