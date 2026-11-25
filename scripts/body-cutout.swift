import CoreImage
import CoreVideo
import Foundation
import Vision

struct BodyLandmarks: Encodable {
    let shoulder: Double?
    let hip: Double?
}

enum CutoutError: Error {
    case unreadablePhoto
    case missingMask
    case invalidArguments
}

func cutout(input: URL, output: URL) throws -> BodyLandmarks {
    guard let original = CIImage(contentsOf: input, options: [.applyOrientationProperty: true]) else {
        throw CutoutError.unreadablePhoto
    }
    let origin = original.extent.origin
    let dimension = max(original.extent.width, original.extent.height)
    let scale = min(1, 800 / dimension)
    let photo = original.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
        .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let extent = photo.extent.integral

    let segmentation = VNGeneratePersonSegmentationRequest()
    segmentation.qualityLevel = .accurate
    segmentation.outputPixelFormat = kCVPixelFormatType_OneComponent8
    let handler = VNImageRequestHandler(ciImage: photo, orientation: .up)
    try handler.perform([segmentation])
    guard let result = segmentation.results?.first else { throw CutoutError.missingMask }

    let mask = CIImage(cvPixelBuffer: result.pixelBuffer)
    let resized = mask.transformed(by: CGAffineTransform(
        scaleX: photo.extent.width / mask.extent.width,
        y: photo.extent.height / mask.extent.height
    ))
    let background = CIImage(color: .clear).cropped(to: extent)
    let isolated = photo.applyingFilter("CIBlendWithMask", parameters: [
        kCIInputBackgroundImageKey: background,
        kCIInputMaskImageKey: resized,
    ]).cropped(to: extent)
    try CIContext().writePNGRepresentation(of: isolated, to: output, format: .RGBA8,
        colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)

    let pose = VNDetectHumanBodyPoseRequest()
    try? handler.perform([pose])
    let points = try? pose.results?.first?.recognizedPoints(.all)
    func midHeight(_ left: VNHumanBodyPoseObservation.JointName, _ right: VNHumanBodyPoseObservation.JointName) -> Double? {
        let valid = [points?[left], points?[right]].compactMap { $0 }.filter { $0.confidence >= 0.25 }
        guard !valid.isEmpty else { return nil }
        return 1 - valid.reduce(0.0) { $0 + Double($1.location.y) } / Double(valid.count)
    }
    return BodyLandmarks(shoulder: midHeight(.leftShoulder, .rightShoulder), hip: midHeight(.leftHip, .rightHip))
}

do {
    guard CommandLine.arguments.count == 3 else { throw CutoutError.invalidArguments }
    let input = URL(fileURLWithPath: CommandLine.arguments[1])
    let output = URL(fileURLWithPath: CommandLine.arguments[2])
    let metadata = try JSONEncoder().encode(cutout(input: input, output: output))
    FileHandle.standardOutput.write(metadata)
} catch {
    FileHandle.standardError.write(Data((String(describing: error) + "\n").utf8))
    exit(1)
}
