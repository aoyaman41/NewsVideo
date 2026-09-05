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
      var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
      pixels.withUnsafeMutableBytes { bytes in
        let context = CGContext(data: bytes.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
      }
      var brightTop = 0, brightBottom = 0
      for y in 0..<image.height { for x in 0..<image.width {
        let offset = (y * image.width + x) * 4
        if pixels[offset] > 200 && pixels[offset + 1] > 200 && pixels[offset + 2] > 200 {
          if y < image.height / 3 { brightTop += 1 }; if y > image.height * 2 / 3 { brightBottom += 1 }
        }
      } }
      samples.append(["time": actual.seconds, "rgb": Array(pixel.prefix(3)).map(Int.init), "brightTop": brightTop, "brightBottom": brightBottom])
    }
    let output: [String: Any] = ["videoTracks": video.count, "audioTracks": audio.count, "width": size.width, "height": size.height, "duration": duration, "samples": samples]
    let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
  }
}
