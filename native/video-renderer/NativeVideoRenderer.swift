import AppKit
import AVFoundation
import CoreGraphics
import Foundation

enum RendererError: LocalizedError {
  case invalidArguments(String)
  case loadImageFailed(String)
  case createWriterFailed(String)
  case appendFrameFailed
  case exportFailed(String)
  case missingVideoTrack(String)
  case readFailed(String)

  var errorDescription: String? {
    switch self {
    case .invalidArguments(let message):
      return message
    case .loadImageFailed(let path):
      return "Failed to load image: \(path)"
    case .createWriterFailed(let message):
      return message
    case .appendFrameFailed:
      return "Failed to append a sample to the video writer."
    case .exportFailed(let message):
      return message
    case .missingVideoTrack(let path):
      return "Video track not found: \(path)"
    case .readFailed(let message):
      return message
    }
  }
}

struct ImageEntry: Codable {
  let filePath: String
  let durationSec: Double
}

struct CaptionCue: Codable { let start: Double; let end: Double; let text: String }
struct GraphicBar: Codable { let label: String; let value: Double }
struct GraphicOverlay: Codable { let enabled: Bool; let headline: String; let keyNumber: String; let source: String; let bars: [GraphicBar] }
struct ProbeRequest: Codable { let inputPath: String }

struct RenderPartRequest: Codable {
  let outputPath: String
  let width: Int
  let height: Int
  let fps: Int
  let videoBitrate: String
  let audioBitrate: String
  let audioPath: String
  let audioDelayMs: Int
  let imageEntries: [ImageEntry]
  let captions: [CaptionCue]?
  let graphic: GraphicOverlay?
}

struct NormalizeClipRequest: Codable {
  let inputPath: String
  let outputPath: String
  let width: Int
  let height: Int
  let fps: Int
  let videoBitrate: String
  let audioBitrate: String
}

struct ConcatSegmentsRequest: Codable {
  let outputPath: String
  let width: Int
  let height: Int
  let fps: Int
  let videoBitrate: String
  let audioBitrate: String
  let segmentPaths: [String]
}

struct RenderClosingCardRequest: Codable {
  let outputPath: String
  let width: Int
  let height: Int
  let fps: Int
  let videoBitrate: String
  /// 古い呼び出し元は送らない。省略時は 128k の無音トラックを付ける
  let audioBitrate: String?
  let durationSec: Double
  let headline: String?
  let cta: String?
  let source: String?
}

func writeStdout(_ line: String) {
  if let data = (line + "\n").data(using: .utf8) {
    FileHandle.standardOutput.write(data)
  }
}

func writeProgress(_ key: String, _ value: String) {
  writeStdout("\(key)=\(value)")
}

func parseBitrate(_ input: String) -> Int {
  let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  if trimmed.hasSuffix("m"), let value = Double(trimmed.dropLast()) {
    return Int(value * 1_000_000)
  }
  if trimmed.hasSuffix("k"), let value = Double(trimmed.dropLast()) {
    return Int(value * 1_000)
  }
  return Int(Double(trimmed) ?? 8_000_000)
}

func removeItemIfExists(_ url: URL) throws {
  if FileManager.default.fileExists(atPath: url.path) {
    try FileManager.default.removeItem(at: url)
  }
}

func decodeRequest<T: Decodable>(_ type: T.Type, from path: String) throws -> T {
  let data = try Data(contentsOf: URL(fileURLWithPath: path))
  return try JSONDecoder().decode(T.self, from: data)
}

func awaitFinishWriting(_ writer: AVAssetWriter) async throws {
  try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
    writer.finishWriting {
      if let error = writer.error {
        continuation.resume(throwing: error)
        return
      }
      continuation.resume()
    }
  }
}

func awaitExport(_ session: AVAssetExportSession) async throws {
  let progressTask = Task {
    while !Task.isCancelled {
      writeProgress("progress", String(format: "%.4f", session.progress))
      try? await Task.sleep(nanoseconds: 200_000_000)
      switch session.status {
      case .completed, .failed, .cancelled:
        return
      default:
        continue
      }
    }
  }

  await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
    session.exportAsynchronously {
      continuation.resume()
    }
  }

  progressTask.cancel()

  if let error = session.error {
    throw RendererError.exportFailed(error.localizedDescription)
  }

  switch session.status {
  case .completed:
    return
  case .cancelled:
    throw RendererError.exportFailed("Export cancelled.")
  case .failed:
    throw RendererError.exportFailed(session.error?.localizedDescription ?? "Unknown export error.")
  default:
    throw RendererError.exportFailed("Unexpected export status: \(session.status.rawValue)")
  }
}

// MARK: - Encoding settings

/// 出力する音声の形式。すべての区間を同じ形式にして、連結を再エンコードなし(passthrough)で行えるようにする
let outputAudioSampleRate = 48_000
let outputAudioChannels = 2

struct EncodeSettings {
  let width: Int
  let height: Int
  let fps: Int
  let videoBitrate: Int
  let audioBitrate: Int

  init(width: Int, height: Int, fps: Int, videoBitrate: String, audioBitrate: String) {
    self.width = width
    self.height = height
    self.fps = max(1, fps)
    self.videoBitrate = max(100_000, parseBitrate(videoBitrate))
    // AAC-LC 48kHz ステレオが受け付ける範囲に収める
    self.audioBitrate = min(320_000, max(64_000, parseBitrate(audioBitrate)))
  }

  func frameTime(_ index: Int) -> CMTime {
    CMTime(value: CMTimeValue(index), timescale: CMTimeScale(fps))
  }

  func frameCount(seconds: Double) -> Int {
    max(1, Int((seconds * Double(fps)).rounded()))
  }

  /// 映像のフレーム数と同じ長さの音声のサンプル数
  func audioFrameCount(videoFrames: Int) -> Int {
    Int((Double(videoFrames) * Double(outputAudioSampleRate) / Double(fps)).rounded())
  }

  var progressInterval: Int { max(1, fps / 2) }

  var colorProperties: [String: Any] {
    [
      AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
    ]
  }

  var videoOutputSettings: [String: Any] {
    [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoColorPropertiesKey: colorProperties,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: videoBitrate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoExpectedSourceFrameRateKey: fps,
        AVVideoMaxKeyFrameIntervalKey: fps * 2,
        // B フレームを使わない(表示と復号の順序が同じになり、連結時の編集リストが単純になる。静止画中心なので画質への影響はほぼない)
        AVVideoAllowFrameReorderingKey: false,
      ] as [String: Any],
    ]
  }

  var audioOutputSettings: [String: Any] {
    var layout = AudioChannelLayout()
    layout.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo
    return [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: outputAudioSampleRate,
      AVNumberOfChannelsKey: outputAudioChannels,
      AVChannelLayoutKey: Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size),
      AVEncoderBitRateKey: audioBitrate,
      // 設定したビットレートどおりにする(既定の可変方式では、無音の多い読み上げで大きく下回る)
      AVEncoderBitRateStrategyKey: AVAudioBitRateStrategy_Constant,
    ]
  }
}

// MARK: - Audio

let pcmReadSettings: [String: Any] = [
  AVFormatIDKey: kAudioFormatLinearPCM,
  AVSampleRateKey: outputAudioSampleRate,
  AVNumberOfChannelsKey: outputAudioChannels,
  AVLinearPCMBitDepthKey: 16,
  AVLinearPCMIsFloatKey: false,
  AVLinearPCMIsBigEndianKey: false,
  AVLinearPCMIsNonInterleaved: false,
]

/// 素材の音声を 48kHz・ステレオ・16bit に変換しながら読む
final class PCMReader {
  private let reader: AVAssetReader
  private let output: AVAssetReaderAudioMixOutput
  private var pending: [Int16] = []
  private var offset = 0
  private var finished = false

  init?(asset: AVAsset, tracks: [AVAssetTrack], duration: CMTime) throws {
    if tracks.isEmpty { return nil }
    reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: .zero, duration: duration)
    output = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: pcmReadSettings)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else {
      throw RendererError.readFailed("Cannot read the audio track.")
    }
    reader.add(output)
    guard reader.startReading() else {
      throw RendererError.readFailed(reader.error?.localizedDescription ?? "Failed to read the audio track.")
    }
  }

  /// frames 個まで読み、読めた数を返す(終わりに達したら 0)
  func read(into destination: UnsafeMutablePointer<Int16>, frames: Int) throws -> Int {
    var written = 0
    while written < frames {
      if offset >= pending.count {
        if finished { break }
        guard let sample = output.copyNextSampleBuffer() else {
          finished = true
          if reader.status == .failed {
            throw RendererError.readFailed(reader.error?.localizedDescription ?? "Failed to read the audio track.")
          }
          break
        }
        guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
        let length = CMBlockBufferGetDataLength(block)
        pending = [Int16](repeating: 0, count: length / MemoryLayout<Int16>.size)
        let status = pending.withUnsafeMutableBytes { bytes in
          CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: bytes.baseAddress!)
        }
        if status != kCMBlockBufferNoErr { throw RendererError.readFailed("Failed to copy audio samples.") }
        offset = 0
      }
      let available = (pending.count - offset) / outputAudioChannels
      let count = min(available, frames - written)
      if count <= 0 {
        offset = pending.count
        continue
      }
      pending.withUnsafeBufferPointer { source in
        (destination + written * outputAudioChannels).update(
          from: source.baseAddress! + offset,
          count: count * outputAudioChannels
        )
      }
      offset += count * outputAudioChannels
      written += count
    }
    return written
  }
}

/// 映像と同じ長さの音声を、書き込み用のサンプルとして少しずつ作る。
/// 先頭に leadFrames 分の無音を置き、素材が足りない分(素材なしを含む)は無音で埋める
final class AudioFeeder {
  private let totalFrames: Int
  private let leadFrames: Int
  private let source: PCMReader?
  private var position = 0
  private let chunkFrames = 4096
  private let format: CMAudioFormatDescription

  init(totalFrames: Int, leadFrames: Int = 0, source: PCMReader?) throws {
    self.totalFrames = max(0, totalFrames)
    self.leadFrames = max(0, leadFrames)
    self.source = source
    var description = AudioStreamBasicDescription(
      mSampleRate: Float64(outputAudioSampleRate),
      mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
      mBytesPerPacket: UInt32(outputAudioChannels * 2),
      mFramesPerPacket: 1,
      mBytesPerFrame: UInt32(outputAudioChannels * 2),
      mChannelsPerFrame: UInt32(outputAudioChannels),
      mBitsPerChannel: 16,
      mReserved: 0
    )
    var formatOut: CMAudioFormatDescription?
    let status = CMAudioFormatDescriptionCreate(
      allocator: kCFAllocatorDefault,
      asbd: &description,
      layoutSize: 0,
      layout: nil,
      magicCookieSize: 0,
      magicCookie: nil,
      extensions: nil,
      formatDescriptionOut: &formatOut
    )
    guard status == noErr, let formatOut else {
      throw RendererError.createWriterFailed("Failed to create the audio format.")
    }
    format = formatOut
  }

  func next() throws -> CMSampleBuffer? {
    if position >= totalFrames { return nil }
    let count = min(chunkFrames, totalFrames - position)
    var samples = [Int16](repeating: 0, count: count * outputAudioChannels)
    let sourceStart = max(position, leadFrames)
    if let source, sourceStart < position + count {
      let skip = sourceStart - position
      _ = try samples.withUnsafeMutableBufferPointer { buffer in
        try source.read(into: buffer.baseAddress! + skip * outputAudioChannels, frames: position + count - sourceStart)
      }
    }
    let presentationTime = CMTime(value: CMTimeValue(position), timescale: CMTimeScale(outputAudioSampleRate))
    position += count
    return try makeSampleBuffer(samples, frames: count, presentationTime: presentationTime)
  }

  private func makeSampleBuffer(_ samples: [Int16], frames: Int, presentationTime: CMTime) throws -> CMSampleBuffer {
    let byteCount = samples.count * MemoryLayout<Int16>.size
    var block: CMBlockBuffer?
    var status = CMBlockBufferCreateWithMemoryBlock(
      allocator: kCFAllocatorDefault,
      memoryBlock: nil,
      blockLength: byteCount,
      blockAllocator: kCFAllocatorDefault,
      customBlockSource: nil,
      offsetToData: 0,
      dataLength: byteCount,
      flags: kCMBlockBufferAssureMemoryNowFlag,
      blockBufferOut: &block
    )
    guard status == kCMBlockBufferNoErr, let block else {
      throw RendererError.createWriterFailed("Failed to allocate audio samples.")
    }
    status = samples.withUnsafeBytes { bytes in
      CMBlockBufferReplaceDataBytes(with: bytes.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: byteCount)
    }
    guard status == kCMBlockBufferNoErr else {
      throw RendererError.createWriterFailed("Failed to copy audio samples.")
    }
    var sample: CMSampleBuffer?
    status = CMAudioSampleBufferCreateReadyWithPacketDescriptions(
      allocator: kCFAllocatorDefault,
      dataBuffer: block,
      formatDescription: format,
      sampleCount: frames,
      presentationTimeStamp: presentationTime,
      packetDescriptions: nil,
      sampleBufferOut: &sample
    )
    guard status == noErr, let sample else {
      throw RendererError.createWriterFailed("Failed to create audio samples.")
    }
    return sample
  }
}

// MARK: - Writer

/// 1 つの区間(パート・締めカード・オープニングなど)を、映像と音声を 1 回ずつエンコードして書き出す。
/// 映像は指定のビットレートの H.264(一定フレームレート)、音声は指定のビットレートの AAC 48kHz ステレオ
final class SegmentWriter {
  private let writer: AVAssetWriter
  private let videoInput: AVAssetWriterInput
  private let adaptor: AVAssetWriterInputPixelBufferAdaptor
  private let audioInput: AVAssetWriterInput
  let settings: EncodeSettings

  init(outputURL: URL, settings: EncodeSettings) throws {
    self.settings = settings
    try FileManager.default.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try removeItemIfExists(outputURL)
    writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: settings.videoOutputSettings)
    videoInput.expectsMediaDataInRealTime = false
    // 12 / 24 / 25 / 30 / 60fps のどれでも 1 フレームが整数になる時間の単位
    videoInput.mediaTimeScale = 90_000
    adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: videoInput,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
        kCVPixelBufferWidthKey as String: settings.width,
        kCVPixelBufferHeightKey as String: settings.height,
      ]
    )
    audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: settings.audioOutputSettings)
    audioInput.expectsMediaDataInRealTime = false
    guard writer.canAdd(videoInput), writer.canAdd(audioInput) else {
      throw RendererError.createWriterFailed("Cannot attach inputs to AVAssetWriter.")
    }
    writer.add(videoInput)
    writer.add(audioInput)
  }

  /// frame(i) は i 番目のフレームの画像を返す(同じ画像を返してよい)。onFrame は書き込んだフレーム数を受け取る
  func write(
    totalFrames: Int,
    audio: AudioFeeder,
    frame: (Int) throws -> CVPixelBuffer,
    onFrame: (Int) -> Void
  ) async throws {
    guard writer.startWriting() else {
      throw RendererError.createWriterFailed(writer.error?.localizedDescription ?? "startWriting failed")
    }
    writer.startSession(atSourceTime: .zero)
    var nextFrame = 0
    var videoDone = false
    var audioDone = false
    do {
      // 映像と音声を交互に、書き込める方から書き込む(AVAssetWriter が両者の時刻を揃えて待たせる)
      while !(videoDone && audioDone) {
        if writer.status == .failed {
          throw writer.error ?? RendererError.appendFrameFailed
        }
        var progressed = false
        if !videoDone && videoInput.isReadyForMoreMediaData {
          if nextFrame >= totalFrames {
            videoInput.markAsFinished()
            videoDone = true
          } else {
            let buffer = try frame(nextFrame)
            guard adaptor.append(buffer, withPresentationTime: settings.frameTime(nextFrame)) else {
              throw writer.error ?? RendererError.appendFrameFailed
            }
            nextFrame += 1
            onFrame(nextFrame)
          }
          progressed = true
        }
        if !audioDone && audioInput.isReadyForMoreMediaData {
          if let sample = try audio.next() {
            guard audioInput.append(sample) else {
              throw writer.error ?? RendererError.appendFrameFailed
            }
          } else {
            audioInput.markAsFinished()
            audioDone = true
          }
          progressed = true
        }
        if !progressed {
          try await Task.sleep(nanoseconds: 1_000_000)
        }
      }
    } catch {
      if writer.status == .writing { writer.cancelWriting() }
      throw error
    }
    writer.endSession(atSourceTime: settings.frameTime(totalFrames))
    try await awaitFinishWriting(writer)
  }
}

// MARK: - Frames

func makePixelBuffer(width: Int, height: Int) throws -> CVPixelBuffer {
  var pixelBuffer: CVPixelBuffer?
  let attrs: [String: Any] = [
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ]
  let status = CVPixelBufferCreate(
    kCFAllocatorDefault,
    width,
    height,
    kCVPixelFormatType_32BGRA,
    attrs as CFDictionary,
    &pixelBuffer
  )

  guard status == kCVReturnSuccess, let pixelBuffer else {
    throw RendererError.createWriterFailed("Failed to create pixel buffer.")
  }

  return pixelBuffer
}

func loadCGImage(imagePath: String) throws -> CGImage {
  guard let image = NSImage(contentsOfFile: imagePath),
        let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    throw RendererError.loadImageFailed(imagePath)
  }
  return cgImage
}

func drawCGImageToPixelBuffer(cgImage: CGImage, width: Int, height: Int, caption: String? = nil, graphic: GraphicOverlay? = nil) throws -> CVPixelBuffer {

  let pixelBuffer = try makePixelBuffer(width: width, height: height)
  CVPixelBufferLockBaseAddress(pixelBuffer, [])
  defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }

  guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
    throw RendererError.createWriterFailed("Pixel buffer has no base address.")
  }

  let colorSpace = CGColorSpaceCreateDeviceRGB()
  let bitmapInfo =
    CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue

  guard let context = CGContext(
    data: baseAddress,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
    space: colorSpace,
    bitmapInfo: bitmapInfo
  ) else {
    throw RendererError.createWriterFailed("Failed to create bitmap context.")
  }

  context.setFillColor(NSColor.black.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))

  let sourceWidth = CGFloat(cgImage.width)
  let sourceHeight = CGFloat(cgImage.height)
  let scale = min(CGFloat(width) / sourceWidth, CGFloat(height) / sourceHeight)
  let drawWidth = sourceWidth * scale
  let drawHeight = sourceHeight * scale
  let drawRect = CGRect(
    x: (CGFloat(width) - drawWidth) / 2.0,
    y: (CGFloat(height) - drawHeight) / 2.0,
    width: drawWidth,
    height: drawHeight
  )

  context.draw(cgImage, in: drawRect)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
  let w = CGFloat(width), h = CGFloat(height), unit = CGFloat(min(width, height))
  func label(_ text: String, rect: NSRect, size: CGFloat, background: Bool = true) {
    if text.isEmpty { return }
    if background { context.setFillColor(NSColor.black.withAlphaComponent(0.82).cgColor); context.fill(rect.insetBy(dx: -unit * 0.015, dy: -unit * 0.012)) }
    let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .left; paragraph.lineBreakMode = .byWordWrapping
    let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: .semibold), .foregroundColor: NSColor.white, .paragraphStyle: paragraph]
    NSAttributedString(string: text, attributes: attrs).draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading])
  }
  if let graphic, graphic.enabled {
    label(graphic.headline, rect: NSRect(x: w * 0.08, y: h * 0.76, width: w * 0.84, height: h * 0.16), size: unit * 0.048)
    label(graphic.keyNumber, rect: NSRect(x: w * 0.08, y: h * 0.61, width: w * 0.84, height: h * 0.1), size: unit * 0.075)
    for (index, bar) in graphic.bars.prefix(4).enumerated() {
      let y = h * 0.51 - CGFloat(index) * unit * 0.065
      context.setFillColor(NSColor.systemTeal.withAlphaComponent(0.95).cgColor)
      context.fill(CGRect(x: w * 0.08, y: y, width: w * 0.84 * max(0, min(100, bar.value)) / 100, height: unit * 0.05))
      label("\(bar.label)  \(bar.value)", rect: NSRect(x: w * 0.09, y: y, width: w * 0.8, height: unit * 0.05), size: unit * 0.025, background: false)
    }
    label(graphic.source, rect: NSRect(x: w * 0.08, y: h * 0.035, width: w * 0.84, height: unit * 0.05), size: unit * 0.023)
  }
  if let caption { label(caption, rect: NSRect(x: w * 0.08, y: h * 0.11, width: w * 0.84, height: unit * 0.14), size: unit * 0.042) }
  NSGraphicsContext.restoreGraphicsState()
  return pixelBuffer
}

/// 静止画の並びを一定フレームレートの映像にする。字幕が変わらない間は同じ画像を使い回す(描画は切り替わりの時だけ)
func imageSequenceFrames(
  entries: [ImageEntry],
  settings: EncodeSettings,
  totalFrames: Int,
  captions: [CaptionCue],
  graphic: GraphicOverlay?
) -> (Int) throws -> CVPixelBuffer {
  var boundaries: [Int] = []
  var cumulative = 0.0
  for entry in entries {
    cumulative += max(0, entry.durationSec)
    boundaries.append(min(totalFrames, Int((cumulative * Double(settings.fps)).rounded())))
  }
  if !boundaries.isEmpty { boundaries[boundaries.count - 1] = totalFrames }
  var images: [String: CGImage] = [:]
  var entryIndex = 0
  var cachedKey: String?
  var cachedBuffer: CVPixelBuffer?
  return { index in
    while entryIndex < boundaries.count - 1 && index >= boundaries[entryIndex] {
      entryIndex += 1
    }
    let entry = entries[entryIndex]
    let time = Double(index) / Double(settings.fps)
    let caption = captions.first(where: { $0.start <= time && $0.end > time })?.text
    let key = "\(entryIndex)\u{1}\(caption ?? "")"
    if let cachedBuffer, cachedKey == key { return cachedBuffer }
    let image: CGImage
    if let loaded = images[entry.filePath] {
      image = loaded
    } else {
      image = try loadCGImage(imagePath: entry.filePath)
      images[entry.filePath] = image
    }
    let buffer = try drawCGImageToPixelBuffer(
      cgImage: image,
      width: settings.width,
      height: settings.height,
      caption: caption,
      graphic: graphic
    )
    cachedKey = key
    cachedBuffer = buffer
    return buffer
  }
}

/// 動画(またはコンポジション)を、映像合成の設定どおりに一定フレームレートで読み出す
final class CompositionFrameSource {
  private let reader: AVAssetReader
  private let output: AVAssetReaderVideoCompositionOutput
  private let fps: Int
  private var last: CVPixelBuffer?
  private var pending: (buffer: CVPixelBuffer, time: CMTime)?
  private var finished = false
  private let label: String

  init(asset: AVAsset, tracks: [AVAssetTrack], videoComposition: AVVideoComposition, duration: CMTime, fps: Int, label: String) throws {
    self.fps = fps
    self.label = label
    reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: .zero, duration: duration)
    output = AVAssetReaderVideoCompositionOutput(
      videoTracks: tracks,
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)]
    )
    output.videoComposition = videoComposition
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else {
      throw RendererError.readFailed("Cannot read the video track: \(label)")
    }
    reader.add(output)
    guard reader.startReading() else {
      throw RendererError.readFailed(reader.error?.localizedDescription ?? "Failed to read the video track: \(label)")
    }
  }

  /// index 番目のフレームの時刻に表示されている画像(元の動画が短い場合は最後の画像を使い続ける)
  func frame(_ index: Int) throws -> CVPixelBuffer {
    let target = CMTime(value: CMTimeValue(index), timescale: CMTimeScale(fps))
    while true {
      if let candidate = pending {
        if CMTimeCompare(candidate.time, target) <= 0 {
          last = candidate.buffer
          pending = nil
        } else {
          break
        }
      }
      if finished { break }
      guard let sample = output.copyNextSampleBuffer() else {
        finished = true
        if reader.status == .failed {
          throw RendererError.readFailed(reader.error?.localizedDescription ?? "Failed to read the video track: \(label)")
        }
        continue
      }
      if let buffer = CMSampleBufferGetImageBuffer(sample) {
        pending = (buffer, CMSampleBufferGetPresentationTimeStamp(sample))
      }
    }
    if last == nil, let candidate = pending { last = candidate.buffer }
    guard let last else { throw RendererError.missingVideoTrack(label) }
    return last
  }
}

func applyColorProperties(_ composition: AVMutableVideoComposition) {
  composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
  composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
  composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
}

/// 動画(またはコンポジション)を指定の設定で書き出し直す。音声がなければ無音を付ける
func transcode(
  asset: AVAsset,
  videoTracks: [AVAssetTrack],
  audioTracks: [AVAssetTrack],
  videoComposition: AVVideoComposition,
  duration: CMTime,
  settings: EncodeSettings,
  outputURL: URL,
  label: String
) async throws {
  let totalFrames = settings.frameCount(seconds: CMTimeGetSeconds(duration))
  let frames = try CompositionFrameSource(
    asset: asset,
    tracks: videoTracks,
    videoComposition: videoComposition,
    duration: duration,
    fps: settings.fps,
    label: label
  )
  let audio = try AudioFeeder(
    totalFrames: settings.audioFrameCount(videoFrames: totalFrames),
    source: try PCMReader(asset: asset, tracks: audioTracks, duration: duration)
  )
  let writer = try SegmentWriter(outputURL: outputURL, settings: settings)
  try await writer.write(
    totalFrames: totalFrames,
    audio: audio,
    frame: { try frames.frame($0) },
    onFrame: { written in
      if written % settings.progressInterval == 0 || written == totalFrames {
        writeProgress("progress", String(format: "%.4f", Double(written) / Double(totalFrames)))
      }
    }
  )
}

// MARK: - Commands

func exportPartVideo(_ request: RenderPartRequest) async throws {
  guard !request.imageEntries.isEmpty else {
    throw RendererError.invalidArguments("No images for the part.")
  }
  let settings = EncodeSettings(
    width: request.width,
    height: request.height,
    fps: request.fps,
    videoBitrate: request.videoBitrate,
    audioBitrate: request.audioBitrate
  )
  let totalDurationSec = max(0.1, request.imageEntries.reduce(0.0) { $0 + max(0, $1.durationSec) })
  let totalFrames = settings.frameCount(seconds: totalDurationSec)
  let frames = imageSequenceFrames(
    entries: request.imageEntries,
    settings: settings,
    totalFrames: totalFrames,
    captions: request.captions ?? [],
    graphic: request.graphic
  )
  let audioAsset = AVURLAsset(url: URL(fileURLWithPath: request.audioPath))
  let audioTracks = try await audioAsset.loadTracks(withMediaType: .audio)
  let audioDuration = try await audioAsset.load(.duration)
  let audio = try AudioFeeder(
    totalFrames: settings.audioFrameCount(videoFrames: totalFrames),
    leadFrames: Int((Double(max(0, request.audioDelayMs)) / 1000.0 * Double(outputAudioSampleRate)).rounded()),
    source: try PCMReader(asset: audioAsset, tracks: audioTracks, duration: audioDuration)
  )
  let writer = try SegmentWriter(outputURL: URL(fileURLWithPath: request.outputPath), settings: settings)
  // 進捗は ffmpeg の -progress と同じ形式(out_time_ms はマイクロ秒)で、映像 0.5 秒ごとに出す
  try await writer.write(
    totalFrames: totalFrames,
    audio: audio,
    frame: frames,
    onFrame: { written in
      if written % settings.progressInterval == 0 {
        writeProgress("out_time_ms", String(Int64(Double(written) / Double(settings.fps) * 1_000_000.0)))
      }
    }
  )
  writeProgress("out_time_ms", String(Int64(Double(totalFrames) / Double(settings.fps) * 1_000_000.0)))
}

func orientedSize(for track: AVAssetTrack) -> CGSize {
  let transformed = CGRect(origin: .zero, size: track.naturalSize).applying(track.preferredTransform)
  return CGSize(width: abs(transformed.width), height: abs(transformed.height))
}

func aspectFitTransform(for track: AVAssetTrack, renderSize: CGSize) -> CGAffineTransform {
  let sourceRect = CGRect(origin: .zero, size: track.naturalSize)
  let preferred = track.preferredTransform
  let transformedRect = sourceRect.applying(preferred)
  let oriented = CGSize(width: abs(transformedRect.width), height: abs(transformedRect.height))
  let scale = min(renderSize.width / oriented.width, renderSize.height / oriented.height)

  var transform = preferred.concatenating(CGAffineTransform(scaleX: scale, y: scale))
  let scaledRect = sourceRect.applying(transform)
  let tx = (renderSize.width - scaledRect.width) / 2.0 - scaledRect.minX
  let ty = (renderSize.height - scaledRect.height) / 2.0 - scaledRect.minY
  transform = transform.concatenating(CGAffineTransform(translationX: tx, y: ty))
  return transform
}

func exportNormalizedClip(_ request: NormalizeClipRequest) async throws {
  let settings = EncodeSettings(
    width: request.width,
    height: request.height,
    fps: request.fps,
    videoBitrate: request.videoBitrate,
    audioBitrate: request.audioBitrate
  )
  let asset = AVURLAsset(url: URL(fileURLWithPath: request.inputPath))
  let videoTracks = try await asset.loadTracks(withMediaType: .video)
  guard let sourceVideoTrack = videoTracks.first else {
    throw RendererError.missingVideoTrack(request.inputPath)
  }
  let audioTracks = try await asset.loadTracks(withMediaType: .audio)
  let duration = try await asset.load(.duration)
  let renderSize = CGSize(width: request.width, height: request.height)

  let instruction = AVMutableVideoCompositionInstruction()
  instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
  let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: sourceVideoTrack)
  layerInstruction.setTransform(aspectFitTransform(for: sourceVideoTrack, renderSize: renderSize), at: .zero)
  instruction.layerInstructions = [layerInstruction]

  let videoComposition = AVMutableVideoComposition()
  videoComposition.instructions = [instruction]
  videoComposition.renderSize = renderSize
  videoComposition.frameDuration = settings.frameTime(1)
  applyColorProperties(videoComposition)

  try await transcode(
    asset: asset,
    videoTracks: [sourceVideoTrack],
    audioTracks: audioTracks.isEmpty ? [] : [audioTracks[0]],
    videoComposition: videoComposition,
    duration: duration,
    settings: settings,
    outputURL: URL(fileURLWithPath: request.outputPath),
    label: request.inputPath
  )
}

func renderClosingCardImage(
  width: Int,
  height: Int,
  headline: String?,
  cta: String?,
  source: String?
) -> NSImage {
  let image = NSImage(size: NSSize(width: width, height: height))
  image.lockFocus()
  defer { image.unlockFocus() }

  NSColor(
    calibratedRed: 0x0f / 255.0,
    green: 0x17 / 255.0,
    blue: 0x2a / 255.0,
    alpha: 1.0
  ).setFill()
  NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()

  let textScale = CGFloat(min(width, height)) / 1080.0
  func drawCenteredText(_ text: String, fontSize: CGFloat, color: NSColor, centerY: CGFloat) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.systemFont(ofSize: fontSize * textScale, weight: .semibold),
      .foregroundColor: color,
      .paragraphStyle: paragraph,
    ]
    let attributed = NSAttributedString(string: text, attributes: attributes)
    let boxWidth = CGFloat(width) * 0.82
    let bounds = attributed.boundingRect(
      with: NSSize(width: boxWidth, height: CGFloat.greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading]
    )
    let rect = NSRect(
      x: (CGFloat(width) - boxWidth) / 2.0,
      y: centerY - bounds.height / 2.0,
      width: boxWidth,
      height: bounds.height
    )
    attributed.draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading])
  }

  if let headline, !headline.isEmpty {
    drawCenteredText(headline, fontSize: 68, color: .white, centerY: CGFloat(height) * 0.68)
  }
  if let cta, !cta.isEmpty {
    drawCenteredText(
      cta,
      fontSize: 38,
      color: NSColor(calibratedRed: 0xdb / 255.0, green: 0xea / 255.0, blue: 0xfe / 255.0, alpha: 1.0),
      centerY: CGFloat(height) * 0.44
    )
  }
  if let source, !source.isEmpty {
    drawCenteredText(
      source,
      fontSize: 28,
      color: NSColor(calibratedRed: 0xcb / 255.0, green: 0xd5 / 255.0, blue: 0xe1 / 255.0, alpha: 1.0),
      centerY: CGFloat(height) * 0.26
    )
  }

  return image
}

func renderClosingCard(_ request: RenderClosingCardRequest) async throws {
  let settings = EncodeSettings(
    width: request.width,
    height: request.height,
    fps: request.fps,
    videoBitrate: request.videoBitrate,
    audioBitrate: request.audioBitrate ?? "128k"
  )
  let image = renderClosingCardImage(
    width: request.width,
    height: request.height,
    headline: request.headline,
    cta: request.cta,
    source: request.source
  )
  guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    throw RendererError.createWriterFailed("Failed to render closing card image.")
  }
  let buffer = try drawCGImageToPixelBuffer(cgImage: cgImage, width: request.width, height: request.height)
  let totalFrames = settings.frameCount(seconds: request.durationSec)
  // ほかの区間と同じ形式にそろえるため、無音の音声トラックを付ける
  let audio = try AudioFeeder(totalFrames: settings.audioFrameCount(videoFrames: totalFrames), source: nil)
  let writer = try SegmentWriter(outputURL: URL(fileURLWithPath: request.outputPath), settings: settings)
  try await writer.write(
    totalFrames: totalFrames,
    audio: audio,
    frame: { _ in buffer },
    onFrame: { written in
      if written % settings.progressInterval == 0 || written == totalFrames {
        writeProgress("out_time_ms", String(Int64(Double(written) / Double(settings.fps) * 1_000_000.0)))
      }
    }
  )
}

func concatSegments(_ request: ConcatSegmentsRequest) async throws {
  let outputURL = URL(fileURLWithPath: request.outputPath)
  try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  let settings = EncodeSettings(
    width: request.width,
    height: request.height,
    fps: request.fps,
    videoBitrate: request.videoBitrate,
    audioBitrate: request.audioBitrate
  )

  let composition = AVMutableComposition()
  guard let compositionVideoTrack = composition.addMutableTrack(
    withMediaType: .video,
    preferredTrackID: kCMPersistentTrackID_Invalid
  ), let compositionAudioTrack = composition.addMutableTrack(
    withMediaType: .audio,
    preferredTrackID: kCMPersistentTrackID_Invalid
  ) else {
    throw RendererError.exportFailed("Failed to create composition tracks.")
  }
  var cursor = CMTime.zero
  var videoFormats: [CMFormatDescription] = []
  var audioFormats: [CMFormatDescription] = []
  var everySegmentHasAudio = true

  for segmentPath in request.segmentPaths {
    let asset = AVURLAsset(url: URL(fileURLWithPath: segmentPath))
    let duration = try await asset.load(.duration)

    guard let sourceVideoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw RendererError.missingVideoTrack(segmentPath)
    }
    try compositionVideoTrack.insertTimeRange(
      CMTimeRange(start: .zero, duration: duration),
      of: sourceVideoTrack,
      at: cursor
    )
    videoFormats.append(contentsOf: try await sourceVideoTrack.load(.formatDescriptions))

    if let sourceAudioTrack = try await asset.loadTracks(withMediaType: .audio).first {
      let audioDuration = try await sourceAudioTrack.load(.timeRange).duration
      try compositionAudioTrack.insertTimeRange(
        CMTimeRange(start: .zero, duration: CMTimeMinimum(duration, audioDuration)),
        of: sourceAudioTrack,
        at: cursor
      )
      audioFormats.append(contentsOf: try await sourceAudioTrack.load(.formatDescriptions))
    } else {
      everySegmentHasAudio = false
    }

    cursor = CMTimeAdd(cursor, duration)
  }

  // すべての区間がこのレンダラーの同じ設定で書き出したもの(形式が完全に一致する)なら、再エンコードせずにつなぐ
  func allEqual(_ formats: [CMFormatDescription]) -> Bool {
    guard let first = formats.first else { return false }
    return formats.allSatisfy { CMFormatDescriptionEqual($0, otherFormatDescription: first) }
  }
  let passthrough = everySegmentHasAudio && allEqual(videoFormats) && allEqual(audioFormats)
  writeProgress("concat_mode", passthrough ? "passthrough" : "reencode")

  if passthrough {
    try removeItemIfExists(outputURL)
    guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
      throw RendererError.exportFailed("Failed to create AVAssetExportSession.")
    }
    session.outputURL = outputURL
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true
    session.timeRange = CMTimeRange(start: .zero, duration: cursor)
    try await awaitExport(session)
    return
  }

  let videoComposition = AVMutableVideoComposition(propertiesOf: composition)
  videoComposition.renderSize = CGSize(width: request.width, height: request.height)
  videoComposition.frameDuration = settings.frameTime(1)
  applyColorProperties(videoComposition)
  try await transcode(
    asset: composition,
    videoTracks: [compositionVideoTrack],
    audioTracks: compositionAudioTrack.segments.isEmpty ? [] : [compositionAudioTrack],
    videoComposition: videoComposition,
    duration: cursor,
    settings: settings,
    outputURL: outputURL,
    label: "concat"
  )
}

@main
struct NativeVideoRenderer {
  static func main() async {
    do {
      guard CommandLine.arguments.count >= 3 else {
        throw RendererError.invalidArguments(
          "Usage: native-video-renderer <command> <request-json-path>"
        )
      }

      let command = CommandLine.arguments[1]
      let requestPath = CommandLine.arguments[2]

      switch command {
      case "probe":
        let request = try decodeRequest(ProbeRequest.self, from: requestPath)
        let asset = AVURLAsset(url: URL(fileURLWithPath: request.inputPath))
        let duration = try await asset.load(.duration)
        writeProgress("duration", String(CMTimeGetSeconds(duration)))
      case "render-part":
        let request = try decodeRequest(RenderPartRequest.self, from: requestPath)
        try await exportPartVideo(request)
      case "normalize-clip":
        let request = try decodeRequest(NormalizeClipRequest.self, from: requestPath)
        try await exportNormalizedClip(request)
      case "concat-segments":
        let request = try decodeRequest(ConcatSegmentsRequest.self, from: requestPath)
        try await concatSegments(request)
      case "render-closing-card":
        let request = try decodeRequest(RenderClosingCardRequest.self, from: requestPath)
        try await renderClosingCard(request)
      default:
        throw RendererError.invalidArguments("Unknown command: \(command)")
      }

      writeProgress("status", "ok")
    } catch {
      let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
      fputs(message + "\n", stderr)
      exit(1)
    }
  }
}
