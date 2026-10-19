require 'xcodeproj'

project = Xcodeproj::Project.new('PdfKitPolicyHost.xcodeproj')
app = project.new_target(:application, 'PdfKitPolicyHost', :ios, '16.4')
tests = project.new_target(:unit_test_bundle, 'PdfKitPolicyTests', :ios, '16.4')
app.source_build_phase.add_file_reference(project.main_group.new_file('main.m'))
policy_source = File.join(ENV.fetch('PDFKIT_SOURCE_ROOT'), 'ios/Tests/PdfPolicyTests.swift')
tests.source_build_phase.add_file_reference(project.main_group.new_file(policy_source))
tests.add_dependency(app)

[app, tests].each do |target|
  target.build_configurations.each do |config|
    config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
    config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.4'
    config.build_settings['SWIFT_VERSION'] = '5.9'
    config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
    config.build_settings['OTHER_LDFLAGS'] = '$(inherited) -lc++'
    config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = "com.hamsternote.#{target.name.downcase}"
  end
end
tests.build_configurations.each do |config|
  config.build_settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/PdfKitPolicyHost.app/PdfKitPolicyHost'
  config.build_settings['BUNDLE_LOADER'] = '$(TEST_HOST)'
end

project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(tests, false)
scheme.add_test_target(tests)
scheme.test_action.build_configuration = 'Debug'
scheme.save_as(project.path, 'PdfKitPolicyHost', true)
