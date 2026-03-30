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

  var errorDescription: String? {
    switch self {
    case .invalidArguments(let message):
      return message
    case .loadImageFailed(let path):
      return "Failed to load image: \(path)"
    case .createWriterFailed(let message):
      return message
    case .appendFrameFailed:
      return "Failed to append frame to video writer."
    case .exportFailed(let message):
      return message
    case .missingVideoTrack(let path):
      return "Video track not found: \(path)"
    }
  }
}

struct ImageEntry: Codable {
  let filePath: String
  let durationSec: Double
}

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

func makeFrameDuration(fps: Int) -> CMTime {
  CMTime(seconds: 1.0 / Double(max(1, fps)), preferredTimescale: 600)
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

func drawCGImageToPixelBuffer(cgImage: CGImage, width: Int, height: Int) throws -> CVPixelBuffer {

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
  return pixelBuffer
}

func renderImageSequenceVideo(
  entries: [ImageEntry],
  width: Int,
  height: Int,
  fps: Int,
  videoBitrate: Int,
  outputURL: URL
) async throws -> CMTime {
  try removeItemIfExists(outputURL)

  let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
  let compressionProperties: [String: Any] = [
    AVVideoAverageBitRateKey: videoBitrate,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
  ]
  let outputSettings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: compressionProperties,
  ]
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: outputSettings)
  input.expectsMediaDataInRealTime = false
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)

  guard writer.canAdd(input) else {
    throw RendererError.createWriterFailed("Cannot attach video input to AVAssetWriter.")
  }
  writer.add(input)

  guard writer.startWriting() else {
    throw RendererError.createWriterFailed(writer.error?.localizedDescription ?? "startWriting failed")
  }
  writer.startSession(atSourceTime: .zero)

  let frameDuration = makeFrameDuration(fps: fps)
  var presentationTime = CMTime.zero
  let totalDurationSec = max(0.1, entries.reduce(0.0) { $0 + $1.durationSec })
  var renderedDurationSec = 0.0
  var imageCache: [String: CGImage] = [:]

  for entry in entries {
    let frameCount = max(1, Int(round(entry.durationSec * Double(fps))))
    let cgImage: CGImage
    if let cached = imageCache[entry.filePath] {
      cgImage = cached
    } else {
      let loaded = try loadCGImage(imagePath: entry.filePath)
      imageCache[entry.filePath] = loaded
      cgImage = loaded
    }

    for frameIndex in 0 ..< frameCount {
      while !input.isReadyForMoreMediaData {
        try? await Task.sleep(nanoseconds: 5_000_000)
      }

      let pixelBuffer = try drawCGImageToPixelBuffer(
        cgImage: cgImage,
        width: width,
        height: height
      )

      guard adaptor.append(pixelBuffer, withPresentationTime: presentationTime) else {
        throw writer.error ?? RendererError.appendFrameFailed
      }

      renderedDurationSec = min(totalDurationSec, CMTimeGetSeconds(presentationTime))
      if frameIndex == 0 || frameIndex == frameCount - 1 {
        let outTimeUs = Int64(renderedDurationSec * 1_000_000.0)
        writeProgress("out_time_ms", String(outTimeUs))
      }

      presentationTime = CMTimeAdd(presentationTime, frameDuration)
    }
  }

  input.markAsFinished()
  try await awaitFinishWriting(writer)
  let finalDuration = CMTime(seconds: totalDurationSec, preferredTimescale: 600)
  writeProgress("out_time_ms", String(Int64(totalDurationSec * 1_000_000.0)))
  return finalDuration
}

func exportComposition(
  composition: AVMutableComposition,
  outputURL: URL,
  fileType: AVFileType = .mp4,
  presetName: String = AVAssetExportPresetHighestQuality,
  videoComposition: AVVideoComposition? = nil,
  timeRange: CMTimeRange? = nil
) async throws {
  try removeItemIfExists(outputURL)
  guard let session = AVAssetExportSession(
    asset: composition,
    presetName: presetName
  ) else {
    throw RendererError.exportFailed("Failed to create AVAssetExportSession.")
  }

  session.outputURL = outputURL
  session.outputFileType = fileType
  session.shouldOptimizeForNetworkUse = true
  session.videoComposition = videoComposition
  if let timeRange {
    session.timeRange = timeRange
  }

  try await awaitExport(session)
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

func exportPartVideo(_ request: RenderPartRequest) async throws {
  let outputURL = URL(fileURLWithPath: request.outputPath)
  try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )

  let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: tempDir) }

  let tempVideoURL = tempDir.appendingPathComponent("part-video-only.mp4")
  let videoDuration = try await renderImageSequenceVideo(
    entries: request.imageEntries,
    width: request.width,
    height: request.height,
    fps: request.fps,
    videoBitrate: parseBitrate(request.videoBitrate),
    outputURL: tempVideoURL
  )

  let composition = AVMutableComposition()
  let videoAsset = AVURLAsset(url: tempVideoURL)
  guard let videoTrack = videoAsset.tracks(withMediaType: .video).first else {
    throw RendererError.missingVideoTrack(tempVideoURL.path)
  }

  let compositionVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
  try compositionVideoTrack?.insertTimeRange(
    CMTimeRange(start: .zero, duration: videoDuration),
    of: videoTrack,
    at: .zero
  )

  let audioAsset = AVURLAsset(url: URL(fileURLWithPath: request.audioPath))
  if let audioTrack = audioAsset.tracks(withMediaType: .audio).first {
    let delay = CMTime(milliseconds: request.audioDelayMs)
    let compositionAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
    try compositionAudioTrack?.insertTimeRange(
      CMTimeRange(start: .zero, duration: min(audioAsset.duration, CMTimeSubtract(videoDuration, delay))),
      of: audioTrack,
      at: delay
    )
  }

  try await exportComposition(
    composition: composition,
    outputURL: outputURL,
    timeRange: CMTimeRange(start: .zero, duration: videoDuration)
  )
  writeProgress("out_time_ms", String(Int64(CMTimeGetSeconds(videoDuration) * 1_000_000.0)))
}

func exportNormalizedClip(_ request: NormalizeClipRequest) async throws {
  let inputURL = URL(fileURLWithPath: request.inputPath)
  let outputURL = URL(fileURLWithPath: request.outputPath)
  try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )

  let asset = AVURLAsset(url: inputURL)
  guard let sourceVideoTrack = asset.tracks(withMediaType: .video).first else {
    throw RendererError.missingVideoTrack(request.inputPath)
  }

  let composition = AVMutableComposition()
  let renderSize = CGSize(width: request.width, height: request.height)
  let duration = asset.duration

  let compositionVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
  try compositionVideoTrack?.insertTimeRange(
    CMTimeRange(start: .zero, duration: duration),
    of: sourceVideoTrack,
    at: .zero
  )

  if let sourceAudioTrack = asset.tracks(withMediaType: .audio).first {
    let compositionAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
    try compositionAudioTrack?.insertTimeRange(
      CMTimeRange(start: .zero, duration: duration),
      of: sourceAudioTrack,
      at: .zero
    )
  }

  let instruction = AVMutableVideoCompositionInstruction()
  instruction.timeRange = CMTimeRange(start: .zero, duration: duration)

  if let compositionVideoTrack {
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack)
    layerInstruction.setTransform(
      aspectFitTransform(for: sourceVideoTrack, renderSize: renderSize),
      at: .zero
    )
    instruction.layerInstructions = [layerInstruction]
  }

  let videoComposition = AVMutableVideoComposition()
  videoComposition.instructions = [instruction]
  videoComposition.renderSize = renderSize
  videoComposition.frameDuration = makeFrameDuration(fps: request.fps)

  try await exportComposition(
    composition: composition,
    outputURL: outputURL,
    videoComposition: videoComposition,
    timeRange: CMTimeRange(start: .zero, duration: duration)
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

  func drawCenteredText(_ text: String, fontSize: CGFloat, color: NSColor, centerY: CGFloat) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.systemFont(ofSize: fontSize, weight: .semibold),
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
  let image = renderClosingCardImage(
    width: request.width,
    height: request.height,
    headline: request.headline,
    cta: request.cta,
    source: request.source
  )

  let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: tempDir) }

  let tempPng = tempDir.appendingPathComponent("closing-card.png")
  guard let tiffData = image.tiffRepresentation,
        let bitmapRep = NSBitmapImageRep(data: tiffData),
        let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
    throw RendererError.createWriterFailed("Failed to render closing card image.")
  }
  try pngData.write(to: tempPng)

  _ = try await renderImageSequenceVideo(
    entries: [ImageEntry(filePath: tempPng.path, durationSec: request.durationSec)],
    width: request.width,
    height: request.height,
    fps: request.fps,
    videoBitrate: parseBitrate(request.videoBitrate),
    outputURL: URL(fileURLWithPath: request.outputPath)
  )
}

func concatSegments(_ request: ConcatSegmentsRequest) async throws {
  let outputURL = URL(fileURLWithPath: request.outputPath)
  try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )

  let composition = AVMutableComposition()
  let compositionVideoTrack = composition.addMutableTrack(
    withMediaType: .video,
    preferredTrackID: kCMPersistentTrackID_Invalid
  )
  let compositionAudioTrack = composition.addMutableTrack(
    withMediaType: .audio,
    preferredTrackID: kCMPersistentTrackID_Invalid
  )
  var cursor = CMTime.zero

  for segmentPath in request.segmentPaths {
    let asset = AVURLAsset(url: URL(fileURLWithPath: segmentPath))
    let duration = asset.duration

    guard let sourceVideoTrack = asset.tracks(withMediaType: .video).first else {
      throw RendererError.missingVideoTrack(segmentPath)
    }

    try compositionVideoTrack?.insertTimeRange(
      CMTimeRange(start: .zero, duration: duration),
      of: sourceVideoTrack,
      at: cursor
    )

    if let sourceAudioTrack = asset.tracks(withMediaType: .audio).first {
      try compositionAudioTrack?.insertTimeRange(
        CMTimeRange(start: .zero, duration: duration),
        of: sourceAudioTrack,
        at: cursor
      )
    }

    cursor = CMTimeAdd(cursor, duration)
  }

  try await exportComposition(
    composition: composition,
    outputURL: outputURL,
    timeRange: CMTimeRange(start: .zero, duration: cursor)
  )
}

extension CMTime {
  init(milliseconds: Int) {
    self = CMTime(seconds: Double(milliseconds) / 1000.0, preferredTimescale: 600)
  }
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
