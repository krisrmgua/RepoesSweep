// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Repos",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "RepoesSweep", targets: ["Repos"]),
    ],
    targets: [
        .target(name: "ReposCore", path: "Sources/ReposCore"),
        .executableTarget(name: "Repos", dependencies: ["ReposCore"], path: "Sources/Repos"),
    ]
)
