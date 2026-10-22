// Mute/unmute the default input device via CoreAudio.
// usage: micmute get|toggle|mute|unmute   -> prints {"device":"…","muted":true|false,"method":"mute|volume"}
// Devices without a mute control fall back to input volume 0 (the previous volume is kept in a file).
import CoreAudio
import Foundation

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

func defaultInput() -> AudioObjectID {
    var id = AudioObjectID(0)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
                                          mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr, id != 0 else {
        fail("no default input device")
    }
    return id
}

func name(_ dev: AudioObjectID) -> String {
    var n: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var addr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName,
                                          mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &n) == noErr, let s = n?.takeRetainedValue() else { return "?" }
    return s as String
}

func addr(_ sel: AudioObjectPropertySelector, _ element: UInt32 = kAudioObjectPropertyElementMain) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioDevicePropertyScopeInput, mElement: element)
}

func settable(_ dev: AudioObjectID, _ a: AudioObjectPropertyAddress) -> Bool {
    var a = a
    guard AudioObjectHasProperty(dev, &a) else { return false }
    var ok = DarwinBoolean(false)
    return AudioObjectIsPropertySettable(dev, &a, &ok) == noErr && ok.boolValue
}

// Elements that carry the property: main (0) or per-channel (1, 2).
func elements(_ dev: AudioObjectID, _ sel: AudioObjectPropertySelector) -> [UInt32] {
    let main = addr(sel)
    if settable(dev, main) { return [kAudioObjectPropertyElementMain] }
    return [1, 2].filter { settable(dev, addr(sel, $0)) }
}

func getU32(_ dev: AudioObjectID, _ a: AudioObjectPropertyAddress) -> UInt32 {
    var a = a, v = UInt32(0), size = UInt32(MemoryLayout<UInt32>.size)
    AudioObjectGetPropertyData(dev, &a, 0, nil, &size, &v)
    return v
}

func setU32(_ dev: AudioObjectID, _ a: AudioObjectPropertyAddress, _ v: UInt32) {
    var a = a, v = v
    AudioObjectSetPropertyData(dev, &a, 0, nil, UInt32(MemoryLayout<UInt32>.size), &v)
}

func getF32(_ dev: AudioObjectID, _ a: AudioObjectPropertyAddress) -> Float32 {
    var a = a, v = Float32(0), size = UInt32(MemoryLayout<Float32>.size)
    AudioObjectGetPropertyData(dev, &a, 0, nil, &size, &v)
    return v
}

func setF32(_ dev: AudioObjectID, _ a: AudioObjectPropertyAddress, _ v: Float32) {
    var a = a, v = v
    AudioObjectSetPropertyData(dev, &a, 0, nil, UInt32(MemoryLayout<Float32>.size), &v)
}

let cmd = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "get"
let dev = defaultInput()
let devName = name(dev)
let muteEls = elements(dev, kAudioDevicePropertyMute)
let volEls = elements(dev, kAudioDevicePropertyVolumeScalar)
let stash = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".config/streamdock-alexa/mic-volume.json")

var muted: Bool
var method: String
if !muteEls.isEmpty {
    method = "mute"
    muted = getU32(dev, addr(kAudioDevicePropertyMute, muteEls[0])) != 0
    let want: Bool? = cmd == "toggle" ? !muted : cmd == "mute" ? true : cmd == "unmute" ? false : nil
    if let w = want {
        for e in muteEls { setU32(dev, addr(kAudioDevicePropertyMute, e), w ? 1 : 0) }
        muted = getU32(dev, addr(kAudioDevicePropertyMute, muteEls[0])) != 0
    }
} else if !volEls.isEmpty {
    method = "volume"
    muted = getF32(dev, addr(kAudioDevicePropertyVolumeScalar, volEls[0])) <= 0.0001
    let want: Bool? = cmd == "toggle" ? !muted : cmd == "mute" ? true : cmd == "unmute" ? false : nil
    if let w = want, w != muted {
        if w {
            let cur = getF32(dev, addr(kAudioDevicePropertyVolumeScalar, volEls[0]))
            try? FileManager.default.createDirectory(at: stash.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? "{\"volume\":\(cur)}".write(to: stash, atomically: true, encoding: .utf8)
            for e in volEls { setF32(dev, addr(kAudioDevicePropertyVolumeScalar, e), 0) }
        } else {
            var restore: Float32 = 0.75
            if let d = try? Data(contentsOf: stash),
               let o = try? JSONSerialization.jsonObject(with: d) as? [String: Double], let v = o["volume"], v > 0.01 {
                restore = Float32(v)
            }
            for e in volEls { setF32(dev, addr(kAudioDevicePropertyVolumeScalar, e), restore) }
        }
        muted = getF32(dev, addr(kAudioDevicePropertyVolumeScalar, volEls[0])) <= 0.0001
    }
} else {
    fail("input device \(devName) has no mute or volume control")
}

let escaped = devName.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
print("{\"device\":\"\(escaped)\",\"muted\":\(muted),\"method\":\"\(method)\"}")
