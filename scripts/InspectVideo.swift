import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

@main
struct InspectVideo {
  static func main() async throws {
    let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
    let video = try await asset.loadTracks(withMediaType: .video)
    let audio = try await asset.loadTracks(withMediaType: .audio)
    let duration = try await asset.load(.duration).seconds
    let size = try await video.first?.load(.naturalSize) ?? .zero
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)
    let times = CommandLine.arguments.dropFirst(2).compactMap(Double.init)
    var samples: [[String: Any]] = []
    for time in times {
      let (image, actual) = try await generator.image(at: CMTime(seconds: time, preferredTimescale: 600))
      var pixel = [UInt8](repeating: 0, count: 4)
      pixel.withUnsafeMutableBytes { bytes in
        let context = CGContext(data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: -image.width / 2, y: -image.height / 2, width: image.width, height: image.height))
      }
      samples.append(["time": actual.seconds, "rgb": Array(pixel.prefix(3)).map(Int.init)])
    }
    let output: [String: Any] = ["videoTracks": video.count, "audioTracks": audio.count, "width": size.width, "height": size.height, "duration": duration, "samples": samples]
    let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
  }
}
