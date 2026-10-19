require 'xcodeproj'

root = ENV.fetch('PDFKIT_SOURCE_ROOT')
pods = Xcodeproj::Project.open('Pods/Pods.xcodeproj')
host = pods.targets.find { |target| target.name == 'HamsterPdfKit' }
raise 'Missing actual HamsterPdfKit pod target' unless host
actual = host.source_build_phase.files.map { |file| File.realpath(file.file_ref.real_path) }.select { |file| file.end_with?('.swift') }.sort
expected = Dir.glob(File.join(root, 'ios/*.swift')).map { |file| File.realpath(file) }.sort
raise 'The complete PDFKit module must be compiled from source' unless expected.length == 4 && actual == expected

project = Xcodeproj::Project.open('PdfKitPolicyHost.xcodeproj')
tests = project.targets.find { |target| target.name == 'PdfKitPolicyTests' }
sources = tests.source_build_phase.files.map { |file| File.realpath(file.file_ref.real_path) }
puts "Policy target build inputs: #{sources.map { |file| File.basename(file) }.sort.join(', ')}"
raise 'The test target must compile the original policy suite' unless sources.include?(File.realpath(File.join(root, 'ios/Tests/PdfPolicyTests.swift')))
puts 'Verified all four original Swift module sources and the original PdfPolicyTests.swift build input'
